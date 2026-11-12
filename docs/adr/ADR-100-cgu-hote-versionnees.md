# ADR-100 — CGU de l'hôte versionnées (`TOS_HOST`) et garde de la soumission d'une annonce

- **Statut** : PROPOSÉ (US-126, agent back-end, claude-opus-5-5, 2026-11-12). Revues exigées (`review-requirements.json`, story US-126) : code, **sécurité** (`SECURITY DEFINER`, garde appelée par un autre propriétaire, consentement), ux (« Revue design : OUI ») ; architecture (`packages/db/`). Sécurité sur un autre modèle que l'auteur.
- **Sources** : 19 US-126 (critères) ; 16 LEG-001 / LEG-002 (« l'hôte accepte en plus les CGU de l'hôte avant sa première annonce » ; « version majeure → ré-acceptation » ; `TERMS_REACCEPT_REQUIRED`), LEG-014 (intermédiaire, jamais bailleur ni partie au contrat), HST onboarding (étape 7 d'A07) ; 08 BR-ACC-06, BR-PROT-06 ; 17 §3.2.6 ; 22 OQ-BR-24, OQ-MK-01 ; ADR-091 (mécanisme d'US-102) ; ADR-096 (compte d'hôte), ADR-099 (soumission) ; pré-mortem L1-PM-28, L1-PM-31, L1-PM-11 ; Q-016.

## Contexte

US-102 a livré les gabarits juridiques versionnés et les consentements du voyageur (0059, ADR-091) ; le genre `TOS_HOST` y était prévu, sans texte ni commande. US-115 a livré la soumission d'une annonce (0067) sans contrôle des CGU de l'hôte. Le texte juridique lui-même relève du fondateur et de son avocat (OQ-BR-24, OQ-MK-01).

## Décision

1. **Même mécanisme qu'US-102** (migration 0070) : `TOS_HOST` est un genre de `core.contract_document_template` (version par genre et portée, quatre langues publiées ensemble, l'espagnol seul fait foi, `legal_review_ref` NULL = BROUILLON, publication par la console avec `legal.publish`, `core.ctr_staff_cmd_publish_document` élargie au genre). Graine : **version 1 majeure, BROUILLON, commune aux pays**, gabarit marqué « à valider par l'avocat » dans chaque langue : l'hôte loue son propre véhicule au voyageur, le contrat de location lie l'hôte et le voyageur, la plateforme est intermédiaire et marchand de référence, la protection est vendue pour un assureur partenaire. Aucune clause « définitive et sans appel » (OQ-BR-24) ; rien n'est repris des textes de Turo.
2. **Portée = pays du compte d'hôte** (un compte par pays, 17 §2.3), jamais le pays déclaré du voyageur (`ctr_account_country`) : document propre au pays s'il en existe un en vigueur, sinon commun. Une acceptation d'un gabarit commun vaut pour tous les comptes d'hôte de la personne tant que les documents restent communs ; un document propre à un pays exige une acceptation dans ce pays (genre et pays du gabarit comparés, jamais l'entier de version seul, comme 0059).
3. **Réacceptation exigée** (PROPOSÉ, comme Turo, `COMME_TURO.md`) : jamais acceptées dans la portée, ou acceptées dans une version inférieure à la plus haute version **majeure** en vigueur ; aucun document en vigueur ⇒ exigée (fail-closed). Une version mineure ne bloque rien (même règle que le voyageur, ADR-091). Écart assumé au texte de 19 (« version courante ») : 16 LEG-001 limite la réacceptation forcée aux versions majeures.
4. **Acceptation** : `core.ctr_cmd_accept_host_terms(jeton, compte, version, langue)` (`iam_auth_owner`, `EXECUTE` au seul `app_api`) ; la personne est celle de la session, le compte l'un de ses comptes d'hôte titulaires (sinon `FORBIDDEN`, HTTP 404) ; version **affichée** exigée (sinon `TERMS_VERSION_CHANGED`, rien n'est écrit) ; consentement `TOS_HOST` : gabarit exact de la langue affichée (repli sur l'espagnol), `platform.now()`, contexte **`HOST_ONBOARDING`** à la première acceptation, `REACCEPT` ensuite (contrainte `consent_context_valid` élargie sous le même nom), pays du compte d'hôte, C2 retenues (`c2_withheld`, comme 0059). Lecture : `core.ctr_host_terms` (version, date, langue, brouillon, version exigée et acceptée).
5. **Garde dans la commande** (L1-PM-28) : `core.ctr_host_terms_required(personne, pays)` (`SECURITY DEFINER`, `iam_auth_owner`, `EXECUTE` au seul `catalog_cmd_owner`, jamais à un rôle applicatif : la personne est celle que la commande appelante a résolue par le jeton). `core.catalog_cmd_submit_listing` l'appelle **après la complétude (photos) et avant l'activation** : `TERMS_REACCEPT_REQUIRED` (HTTP 409), l'annonce reste `DRAFT`. Placée avant l'activation, la garde est prouvable sur PostgreSQL sans jamais basculer un interrupteur de mise en service, et l'hôte apprend l'étape qui dépend de lui.
6. **API et écran** : routes `GET /host/accounts/{orgId}/terms` et `POST /host/accounts/{orgId}/terms/accept` (module CTR) ; `GET /legal/documents/TOS_HOST` sert le texte (jamais dans la liste de l'inscription du voyageur). A10 `/host` : bloc « Conditions de l'hôte » (version, date dans le fuseau du pays du compte, BROUILLON, lien vers le texte, case obligatoire jamais pré-cochée), en es, en, fr et pt-BR ; la page du texte affiche la date d'entrée en vigueur et, hors de l'espagnol, « traduction : l'espagnol fait foi ».

## Conséquences

- Tests : `packages/db/test/l0/l0-us126-host-terms.test.ts` (PA, PY, rôles de production, critères 1 à 3, portée par pays, IDOR, droits) ; contrat `host-terms.contract.test.ts` ; adaptés : `l0-us115-host-listings` (l'hôte accepte les CGU v1 avant de soumettre), `l0-ctr-consents` (requête GL-15 étendue à `TOS_HOST`, genre non publiable changé), contrats CTR et CAT, e2e A10.
- Mise en service : GL-15 inclut désormais les CGU de l'hôte (aucun brouillon en vigueur).

## Limites et reports

- **Confirmation d'une réservation par l'hôte** (critère 1, second chemin) : la commande n'existe pas encore (lot 2, mode « sur demande ») ; elle appellera `core.ctr_host_terms_required` et son propriétaire recevra `EXECUTE` (suite au BOARD). La publication après revue de l'ops (US-118) relira la même garde.
- Activation du compte d'hôte (US-123) : l'étape 7 d'A07 (« CGU de l'hôte acceptées ») pourra lire la même fonction.
- Textes définitifs : version 2 majeure publiée par la console après validation de l'avocat (OQ-BR-24, OQ-MK-01, GL-15).
- Reports dans les spécifications (demande de fusion sur `docs/specs/`) : 16 A.8 (`TERMS_REACCEPT_REQUIRED` à la soumission en 409 ; 16 LEG-001 dit `TERMS_NOT_ACCEPTED` pour une première acceptation, 19 US-126 dit `TERMS_REACCEPT_REQUIRED` : 19 est suivi) ; 17 §3.2.6 (contexte `HOST_ONBOARDING`, portée du compte d'hôte) ; 19 US-126 (« es et en » ⇒ quatre langues, Q-016) ; 10b §4.3 (clés `web.host.terms.*`, `web.legal.validFrom`, `web.legal.translation`, `web.legal.backHost`, `common.listing.hostTermsRequired`).

## Alternatives écartées

- **Garde dans l'écran ou dans un garde Nest** : contournable par un client direct de l'API ; la commande en base est le seul chemin d'écriture.
- **Garde après l'activation** : jamais atteignable en production ni en test sans basculer `p2p_private_hosts_enabled`, ce qui est interdit hors décision du fondateur.
- **Accepter les CGU de l'hôte à l'inscription du voyageur** : un compte sert à voyager et à être hôte ; seuls les hôtes doivent les accepter, au moment où ils le deviennent (16 LEG-001).
- **Exiger la version courante, mineure comprise** : contredit 16 LEG-001 et le mécanisme du voyageur ; une correction de forme forcerait chaque hôte à réaccepter.
