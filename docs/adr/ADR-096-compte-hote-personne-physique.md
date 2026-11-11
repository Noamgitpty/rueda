# ADR-096 — Compte d'hôte d'une personne physique : ouverture en libre-service ou par la console, titulaire et nom affiché

- **Statut** : PROPOSÉ (US-107, agent back-end, claude-opus-5-5, 2026-11-11). Revues exigées : code, architecture (`packages/db/`), **sécurité** (RLS, rôles, `SECURITY DEFINER`, liaison au cadre des actions de console), sur un autre modèle que l'auteur.
- **Sources** : 19 US-107 (critères d'acceptation) ; 17 §2.2, §2.3 (« Compte d'hôte » : `organization` `P2P_HOST_INDIVIDUAL`, une personne physique, mono-pays ; RLS-2, RLS-9), §3.2.1 (`organization`, `membership`), §2.4 (règle d'activation), §10 (`CREATE_HOST_ACCOUNT`) ; 08 BR-ACC-06 ; 16 HST-049, ADM-004, A.8 ; 22 OQ-P2P-01 (21 ans, compte vérifié) ; DEC-FONDATEUR-13 (particuliers seulement), DEC-FONDATEUR-19 (aucune limite de véhicules) ; ADR-089 (gardes F-RLS-01, F-RLS-02), ADR-092 (cadre des actions de console). Pré-mortem du lot 1 : L1-PM-11.

## Contexte

Les tables `iam_organization` et `iam_membership` existent depuis 0010, avec leurs politiques de lecture (0025) et les gardes de propriété d'ADR-089. Aucune commande ne les écrit : seules des fixtures de test créaient des comptes d'hôte. US-107 doit permettre à un voyageur vérifié d'ouvrir son compte d'hôte, en libre-service ou par l'ops pendant la bêta fermée, sans jamais accepter une personne morale.

## Décision

1. **Une commande de domaine, deux appelants** (migration 0061). `core.iam_host_open_account` (SECURITY INVOKER, `EXECUTE` à `iam_auth_owner` seul) ouvre, dans la même instruction :
   - l'organisation `P2P_HOST_INDIVIDUAL`, au statut `ONBOARDING` ;
   - l'appartenance `P2P_HOST` titulaire, `ACTIVE` ;
   - l'audit `HOST_ACCOUNT_OPENED`, sans donnée C2.

   Ses deux appelants appliquent les mêmes règles :
   - **libre-service** : `core.iam_cmd_open_host_account(jeton, pays, déclaration)`, `SECURITY DEFINER`, propriétaire `iam_auth_owner`, `EXECUTE` à `app_api` seul. La personne est celle de la session (empreinte du jeton), jamais un identifiant reçu du client. Route `POST /host/accounts` ;
   - **console** : `core.iam_manual_action_create_host_account`, liée à `CREATE_HOST_ACCOUNT` par le cadre d'ADR-092 (signature imposée, `SECURITY DEFINER`, propriétaire `iam_auth_owner` NOLOGIN, `EXECUTE` à `iam_staff_owner` seul : la garde de liaison le vérifie à l'insertion et à chaque appel).

2. **Règles d'ouverture** (refus sans écriture, dans cet ordre) :

   | Règle                                                                                    | Refus                       | Source                                 |
   | ---------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------- |
   | déclaration d'une personne physique (`INDIVIDUAL`)                                       | `HOST_ENTITY_NOT_ALLOWED`   | DEC-FONDATEUR-13, BR-ACC-06, 16 A.8    |
   | pays configuré                                                                           | `COUNTRY_UNKNOWN`           | 17 §1.1                                |
   | compte de la personne `ACTIVE` (e-mail vérifié, ni restreint ni fermé), non pseudonymisé | `HOST_ACCOUNT_NOT_ELIGIBLE` | OQ-P2P-01 « compte vérifié » (PROPOSÉ) |
   | paramètre `host_min_age_years[pays]` présent                                             | `PARAM_MISSING`             | 17 §7.1 (fail-closed)                  |
   | date de naissance connue : âge ≥ `host_min_age_years`                                    | `HOST_UNDER_AGE`            | OQ-P2P-01, 16 A.8                      |
   | aucun compte d'hôte de la personne dans ce pays                                          | `HOST_ACCOUNT_EXISTS`       | BR-ACC-06, 17 §2.3 (PROPOSÉ)           |

   Un compte existant bloque une seconde demande **quel que soit son statut** (même `OFFBOARDED`) : une personne, un compte d'hôte par pays (UQ `(country_code, holder_user_id)` de 0010). Un même particulier ouvre un compte par pays (17 §2.3). Deux demandes concurrentes sont sérialisées par un verrou consultatif de transaction (personne, pays) : la seconde rend `HOST_ACCOUNT_EXISTS`. Aucune limite de véhicules n'est posée (DEC-FONDATEUR-19).

3. **Particuliers seulement, à chaque niveau.** La contrainte `organization_kind_valid` de 0010 refuse toute autre sorte d'organisation. La politique d'insertion d'`iam_auth_owner` exige `P2P_HOST_INDIVIDUAL`, `ONBOARDING`, sans `tax_id`, `plan_code` ni `legal_entity_id`. L'API refuse avec `HOST_ENTITY_NOT_ALLOWED` toute donnée de personne morale (`legalName`, `tradeName`, `companyName`, `businessName`, `companyTaxId`, `legalEntity`), avant la base. Le numéro fiscal n'est pas reçu à l'ouverture : il est collecté et classé (RUC d'une personne physique ou d'une entreprise) à la vérification de l'hôte (US-123).

4. **Nom affiché = prénom légal du titulaire** (minimisation, PROPOSÉ). La commande recopie `legal_first_name` dans `organization.display_name` ; aucun nom n'est reçu du client, donc jamais une raison sociale. 17 §3.2.1 prévoit « prénom et initiale » : le critère de 19 US-107 (« son prénom ») et la minimisation l'emportent. Écart signalé à l'orchestrateur. Le nom de famille, la date de naissance et le numéro fiscal ne sont jamais exposés au voyageur. La projection vers le voyageur (fiche d'annonce, réservation) viendra avec l'annonce (US-124) et devra se limiter à `display_name`.

5. **Le compte n'est jamais ouvert `ACTIVE`.** L'activation reste la règle de 17 §2.4 (vérification `APPROVED`, sous-marchand `ACTIVE`, interrupteurs du pays : US-123). Un compte non `ACTIVE` ne reçoit aucune réservation : la pose de hold le refuse déjà (`hold_host_not_active`, 0037), avec le code `HOST_NOT_ACTIVATED` de 16 A.8. 19 US-107 nomme ce refus `ORGANIZATION_NOT_ACTIVE` ; le catalogue de référence des codes (16 A.8) et le code existant font foi. Écart signalé. La soumission d'un véhicule n'existe pas encore : US-115 et US-124 reprennent le même contrôle.

6. **Rôle `P2P_HOST` à la reconnexion.** `core.iam_host_accounts(jeton)` rend les comptes dont la personne de la session est titulaire (`P2P_HOST`, `ACTIVE`). `GET /auth/session` rend `roles` (`GUEST` toujours ; `P2P_HOST` en plus pour un titulaire) et `hostAccounts` (identifiant, pays, statut, nom affiché). Le contexte de session `HOST` de la base (`app.org_id`) reste posé par la couche d'accès, et `app.is_org_holder()` le revérifie dans `membership`.

7. **Action de console `CREATE_HOST_ACCOUNT`** (17 §10). Permission `ops.review_listing_host` ; aucune saisie (`input` vide). Le sujet est de type `USER_ACCOUNT` : c'est la personne inscrite, qui a fait la demande. Ce type est ajouté à la contrainte du catalogue (remplacée sous le même nom, élargie) et déclaré dans `support_manual_action_subject`. Son résolveur `core.support_country_of_user_account` rend le pays du compte de la personne (`core.ctr_account_country` : sa dernière acceptation des CGU). Sans pays déclaré, la console refuse (`FORBIDDEN`, journalisé) : la personne ouvre alors son compte en libre-service (PROPOSÉ). Le pays n'est jamais saisi par l'agent. Un refus métier rend `REFUSED` avec le code de la règle, journalisé par le cadre.

8. **RLS entre hôtes (L1-PM-11).** Aucune politique de lecture n'est ajoutée pour les rôles applicatifs. Le titulaire lit son seul compte et ses appartenances (0025) ; un `org_id` forgé ne rend rien (`app.is_org_holder()`). `app_api` n'a aucun droit d'écriture sur `iam_organization` ni `iam_membership`. Les nouveaux droits vont au seul propriétaire NOLOGIN `iam_auth_owner` : lecture et insertion d'ouverture de l'organisation et de l'appartenance, lecture du paramètre `host_min_age_years` et insertion de l'audit `HOST_ACCOUNT_OPENED`. `iam_staff_owner` reçoit la lecture du pays des consentements, pour le résolveur. Les tests IDOR (hôte A contre hôte B, en PA et en PY) sont dans `l0-us107-host-account`.

## Conséquences

- Positives : un seul chemin d'écriture pour le compte d'hôte, sans aucun droit d'écriture applicatif ; les deux entrées partagent les mêmes refus ; la console n'imite rien (vraie commande de domaine, ADR-092).
- Négatives et limites :
  - l'âge n'est contrôlé que si la date de naissance est connue. Aucune commande ne l'écrit avant le KYC : US-123 revérifie l'âge avant toute activation ;
  - le pays d'une ouverture par la console dépend du parcours d'inscription ;
  - l'événement `iam.organization.created` (17 §4.5) n'est pas émis : aucun consommateur au lot 1 (à reprendre avec US-123).
- Reports à l'orchestrateur :
  - 17 §3.2.13 et §10 : type de sujet `USER_ACCOUNT`, sujet et permission de `CREATE_HOST_ACCOUNT` ;
  - 17 §3.2.1 : nom affiché = prénom seul ;
  - 16 A.8 : `HOST_ACCOUNT_EXISTS`, `HOST_ACCOUNT_NOT_ELIGIBLE`, `HOST_ACCOUNT_OPENED`, `HOST_ACCOUNT_UNAVAILABLE` ;
  - 19 US-107 : `ORGANIZATION_NOT_ACTIVE` → `HOST_NOT_ACTIVATED` ;
  - 10b §4.3 : clés `common.host.*` et `backoffice.action.CREATE_HOST_ACCOUNT`.
