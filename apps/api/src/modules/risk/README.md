# RISK — Fraud / Risk (`apps/api/src/modules/risk`)

**RISK — Fraud / Risk** : règles de risque, évaluation à la réservation, file de revue, journal explicable, **limitation de débit et anti-abus**. Dépendances autorisées : IAM, KYC, CFG (socle implicite : CFG, AUD, BUS ; source : 17 §2.2).

## Responsabilité

RISK évalue le risque d'une réservation, d'un hold ou d'un utilisateur (17 §2.2, §2.14) :

- en bêta, 5 à 10 règles codées en dur, mais **déclarées** dans `risk_rule` (code, version, description) ;
- chaque décision (`AUTO_OK`, `REVIEW`, `REJECT`) est journalisée avec les règles déclenchées, pour rester explicable (BR-TRUST-01) ;
- une décision `REVIEW` alimente la file de revue humaine de SUP ; la capture n'a lieu qu'après la revue (PAY-006).

RISK ne pose pas lui-même les restrictions de compte : la table `core.iam_restriction` appartient à IAM (migration 0010). L'évaluation des réservations arrive avec US-209 ; US-127 y ajoute la règle des comptes liés.

**Limitation de débit et anti-abus (US-052, ADR-075, 17 §6.6)**, livrée :

| Protection                                               | Comportement                                                                                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Envoi d'OTP par SMS, e-mail coûteux (`AbuseGuard`)       | limite par numéro ou adresse **et** par IP, à l'heure ; puis plafond SMS du pays ; au-delà `429 RATE_LIMITED`, **aucun envoi**, refus journalisé ; distinct d'`OTP_LOCKED`          |
| Compteur ou paramètre indisponible pour un envoi coûteux | `503 RATE_LIMIT_UNAVAILABLE`, **aucun envoi** (fail-closed)                                                                                                                         |
| Plafond journalier SMS du pays (port `SmsBudget` de NTF) | jour **local** du pays ; message critique de trip toujours envoyé et compté ; non critique refusé ou basculé sur l'e-mail ; alerte `notification.sms_cap.reached` une fois par jour |
| Toute route de l'API (garde global)                      | limite par IP selon la portée (`api`, `search`, `quote`, `webhook`) ; `429 RATE_LIMITED` + `Retry-After` ; base indisponible ⇒ repli en mémoire (même seuil)                        |
| Routes avec session (intercepteur global)                | limite par compte, après `SessionGuard`                                                                                                                                             |
| Heuristiques anti-robot                                  | en-têtes de navigateur absents, rythme régulier, inscriptions en rafale ⇒ client ralenti (poids) ou défi exigé (`403 BOT_CHALLENGE_REQUIRED`) ; défi indisponible ⇒ refus           |
| Tableau de sécurité                                      | `GET /console/security/abuse` (SUP), permission `security.read_abuse`, TOTP ; agrégats par heure sans empreinte                                                                     |

Seuils : paramètres `rate_limit_*` **par pays** du registre CFG (graine `0046`), jamais des constantes. Une route sans pays prend la valeur la plus stricte des pays déclarés. Clés de compteur : HMAC-SHA-256 sous `RUEDA_RATE_LIMIT_KEY` (aucun téléphone, e-mail ni IP en clair) ; pendant une rotation (US-051, ADR-082), `RUEDA_RATE_LIMIT_KEY_PREVIOUS` fait compter chaque événement sous les deux empreintes (refus si l'une dépasse) : aucune limite n'est remise à zéro. Horloge des fenêtres : `platform.now()`.

## Entités

| Entité (17 §3.2.13)      | État                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `risk_rule`              | cible 17, pas encore créée                                                                                  |
| `risk_assessment`        | cible 17, pas encore créée                                                                                  |
| `core.risk_rate_counter` | créée (0047, US-052) : compteur à fenêtre fixe par (portée, empreinte, fenêtre) ; RLS ENABLE + FORCE        |
| `core.risk_abuse_event`  | créée (0047, US-052) : refus et soupçons agrégés par (genre, portée, empreinte, heure) ; RLS ENABLE + FORCE |

Écritures par commandes `SECURITY DEFINER` seulement (`risk_limit_owner`, NOLOGIN) : `core.risk_cmd_hit` (app_api), `core.risk_cmd_sms_reserve` (app_api ; app_worker sous `ntf_sender`), `core.risk_cmd_record_abuse` (app_api), `core.risk_cmd_prune` (app_worker sous `risk_pruner`). Lecture : `core.risk_staff_abuse_board` (famille console `iam_staff_owner`). Aucun droit de table pour les rôles applicatifs.

## Événements

Aucun événement émis par RISK lui-même. L'alerte du plafond SMS est publiée par NTF (`notification.sms_cap.reached`, charge utile : `dispatch_id`, `country_code`, `template`).

Cible (17 §4.5) :

- émis : `risk.review.required` / `.decided` (consommateurs : SUP pour la file, PAY pour la capture après revue) ;
- consommés : `iam.user.registered`, `iam.phone.verified` (IAM), `kyc.verification.status_changed` (KYC), `booking.hold.*` (AVL), `settlement.advance.*` (STL), `trip.offline.clock_skew_detected` (TRP).

## Ports

- `RateCounterStore` (`internal/counter-store.ts`) : `PgRateCounterStore` (production, commandes 0047, délai borné à 500 ms) et `MemoryRateCounterStore` (tests et repli dégradé des routes peu coûteuses).
- `BotChallengePort` (`internal/bot-challenge.port.ts`) : `UnavailableBotChallenge` en production (SUP-013 apportera reCAPTCHA) ; `FakeBotChallenge` dans `testing/`, jamais importé par la production.
- `AbuseBoardStore` (`internal/abuse-board.ts`) : lecture du tableau de sécurité.
- Adaptateur du port `SmsBudget` de NTF : `ntfSmsBudget(config)` (RISK ne dépend pas de NTF : port satisfait par structure).

Montage : `RiskHttpModule.register(postgresRiskAdapters(pool, env, config))` dans `api.module.ts`, **en premier** (garde global). Le travailleur ne monte pas les routes ; il reçoit `ntfSmsBudget` au câblage de NTF (US-003).

## Commandes de test

Unitaires (sans base) : primitives, service, HTTP réel (Nest + Express, port éphémère) :

```bash
pnpm --filter @rueda/api exec vitest run src/modules/risk
```

Preuves L0 sous les rôles de production (PostgreSQL ; en CI, ou en local selon `docs/ops/INSTALL.md`) :

```bash
pnpm --filter @rueda/db test:l0 -- l0-risk-rate-limit
```
