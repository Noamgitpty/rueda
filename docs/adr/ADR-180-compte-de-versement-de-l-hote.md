# ADR-180 — Compte de versement de l'hôte : au nom de l'hôte vérifié, chiffré, vérifié par le PSP, retenue de 48 h après un changement

- **Statut** : PROPOSÉ (US-707, agent de story, rôles back-end / front-end, claude-opus-5-5, 2026-11-19). Revues exigées : celles de `node scripts/ci/check-story-reviews.mjs` (code, architecture, sécurité, argent, ux, qa) ; argent, RLS / rôles, `SECURITY DEFINER` et concurrence sur un autre modèle que l'auteur.
- **Complète** : ADR-105 et ADR-115 (profil fiscal chiffré de l'hôte, numéro facultatif à l'activation), ADR-117 (rapprochement tolérant du nom légal), ADR-066 (port de place de marché), ADR-088 (garde du versement en base), ADR-133 (écart AVL --> IAM, repris pour PYO --> IAM).
- **Sources** : 19 US-707 ; 16 fiche PYO-001 ; 17 §2.3 (`payout.manage_account`), §2.8 (capacités : inconnue = « non »), §3.1.3 / §3.1.4 (C2 / C3), §3.2.9 (`payout_account`), §7.2 (`payout_account_change_hold_h` = 48 h, décidé) ; 08 BR-PAYOUT-01, BR-ACC-06 ; 10b UX-40, UX-43 ; 22 OQ-P2P-07, OQ-PAY-09 ; `docs/team/COMME_TURO.md`.

## Contexte

Le module PYO était un squelette. L'hôte doit enregistrer un compte bancaire ou un portefeuille à son nom, vérifié par le PSP de place de marché, avant tout versement ; aucun PSP réel n'existe avant le lot C, aucun coffre de clés (KMS) non plus ; les versements restent fermés (`payouts_enabled[pays]` = `false`).

## Décision

1. **Table** `core.payout_payout_account` (migration 0159 ; préfixe du schéma cible `payout` de PYO) : rail (`BANK_ACCOUNT`, `WALLET`), établissement, numéro **chiffré** par la clé du sujet `ORG:<compte d'hôte>` (`account_number_enc`, C3, crypto-shredding), 4 derniers caractères en clair pour l'affichage (C2), nom du titulaire (C2), **type** de la pièce du titulaire (le numéro n'est pas recopié), statut `PENDING` → `VERIFIED` | `REJECTED` | `REPLACED`, motif fermé, référence du PSP, retenue `change_hold_until`. Un seul compte courant par compte d'hôte. RLS `ENABLE` + `FORCE`, aucun droit applicatif ; écritures par les commandes de `cmd_money_owner` seulement ; garde d'immuabilité et de transitions.
2. **Au nom de l'hôte** : la base rapproche le titulaire déclaré du nom légal vérifié (`core.kyc_legal_name_match`, ADR-117) ; elle exige un KYC courant approuvé et un profil fiscal enregistré d'un type admis dans le pays (sinon `HOST_KYC_REQUIRED`, `HOST_TAX_ID_REQUIRED`). La **cédula / le RUC** déclaré est comparé par l'API, sous la clé du sujet (port `PayoutAccountVault.matchesTaxId`, temps constant), au numéro fiscal chiffré de l'hôte, que la base ne rend qu'au titulaire (`core.payout_payout_account_context`, par la fonction de KYC `core.kyc_host_payout_identity`, EXECUTE `cmd_money_owner`). Discordant ⇒ `PAYOUT_HOLDER_MISMATCH`, rien n'est écrit. Défense en profondeur : le PSP vérifie ensuite le compte contre le titulaire (port `PayoutAccountVerifier`, FAKE) ; refus ⇒ `REJECTED`.
3. **Paraguay sans RUC** (OQ-P2P-07, OQ-PAY-09, fail-closed) : le seul type admis au PY est le RUC (configuration) ; sans RUC, aucun compte de versement ; l'activation reste bloquée par `HOST_TAX_ID_REQUIRED` tant que le PSP n'a pas validé `SUPPORTS_PAYOUT_WITHOUT_HOST_TAX_ID` (ADR-115, inconnue = « non »).
4. **Titulaire seulement** : permission `payout.manage_account` semée pour P2P_HOST et lui seul ; la commande ne connaît que les comptes TITULAIRES de la session (`core.iam_host_accounts`) : un co-hôte reçoit la même réponse qu'un compte inconnu (404), une permission absente ou échue rend 403.
5. **Rails par pays** : paramètre JSON `payout_account_rails[pays]` (unité `payout_rails` validée par CFG, graine générée 0160) : motif du numéro, liste fermée d'établissements ou motif du code d'établissement ; absent ⇒ `HOST_PAYOUT_RAIL_UNAVAILABLE`. Valeurs PROPOSÉES (virement au PA ; virement et portefeuilles au PY), à confirmer avec le PSP au lot C. Aucune constante de pays dans le code.
6. **Changement de compte** d'un hôte qui a déjà eu un compte vérifié : l'ancien passe `REPLACED`, le nouveau porte `change_hold_until` = `platform.now()` + `payout_account_change_hold_h[pays]` (absente ou mal formée ⇒ `infinity`). Le premier compte n'est pas retenu (le premier versement est déjà à J+5, BR-PAYOUT-02). La garde `core.payout_payout_account_hold(org, devise, prévu le)` (EXECUTE `app_worker`) rend `PAYOUT_ACCOUNT_MISSING`, `PAYOUT_ACCOUNT_UNVERIFIED`, `PAYOUT_ACCOUNT_CHANGE_HOLD` : un versement prévu avant la fin de la retenue est `ON_HOLD`. Les lots (`payout_batch`, US-708) la liront ; la garde du `LEG_RELEASE` (0054) n'est pas modifiée ici.
7. **Aucun numéro** dans les réponses, l'audit (`PAYOUT_ACCOUNT_REGISTERED`, `PAYOUT_ACCOUNT_VERIFICATION_RECORDED` : rail, établissement, statut, retenue), les événements ni les journaux ; la pièce et le numéro ne transitent que vers le coffre et le PSP.
8. **Production** : aucun coffre ni prestataire avant le lot C : l'état est lisible, l'enregistrement rend 503 `PAYOUT_VAULT_UNAVAILABLE` ; aucun interrupteur n'est lu ni écrit.
9. **Dépendance PYO --> IAM** (`SessionGuard`) : écart assumé de 17 §2.2, comme AVL --> IAM (ADR-133), à reporter par une demande de fusion revue.

## Écarts PROPOSÉS avec 17 §3.2.9 (à reporter)

`account_bidx` non créé (aucun usage avant une story anti-fraude : minimisation) ; `holder_tax_id` remplacé par `holder_tax_id_kind` ; colonnes en plus : `user_id`, `rail_kind`, `institution_code`, `account_last4`, `holder_name`, `reject_reason`, `provider_ref`, `replaced_at`, `row_version`.

## Options écartées

- Comparer la cédula / le RUC en base : la base ne voit jamais le numéro fiscal en clair (ADR-105) ; un index aveugle obligerait à changer le profil fiscal de KYC.
- Retenir le `LEG_RELEASE` de la jambe HOST dans `core.settlement_release_blocker` dès cette story : modifie une garde d'argent couverte par plusieurs preuves de lots antérieurs ; le versement par lots (US-708) est l'endroit où la retenue s'applique (suite inscrite).
- Port de vérification ajouté au `PaymentProvider` de PAY dès maintenant : aucun PSP réel ni capacité contractuelle à décrire avant le lot C ; un port PYO étroit, FAKE seulement, suffit, et l'adaptateur réel le portera.
- Retenir aussi le premier compte : plus lourd que Turo sans gain (aucun versement antérieur à détourner).

## Conséquences

- Suites : reconnexion forte (OTP) avant un changement de compte (10b UX-43, aucune étape d'authentification renforcée n'existe encore côté IAM) ; notification de l'hôte à chaque changement ; lecture masquée par FINANCE / OPS_AGENT (console) ; application de la garde aux lots et au `LEG_RELEASE` HOST (US-708) ; lien depuis la liste de tâches A07 (captures de référence à reprendre de l'artefact CI).
- Retour arrière : voir l'en-tête de 0159 (fonctions, table, politique, droits, ligne de matrice) et de 0160 (paramètre).
