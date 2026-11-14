# ADR-115 — Allègements « comme Turo » : numéro fiscal de l'hôte facultatif à l'activation, préavis de réservation par défaut inchangé

- **Statut** : PROPOSÉ (US-123, allègement, agent back-end, claude-opus-5-5, 2026-11-13). Consigne du fondateur DEC-FONDATEUR-22 « jamais plus lourd que Turo » (`docs/team/DECISIONS.md`, `docs/team/POUR_LE_FONDATEUR.md` §4.6). Complète ADR-105 (point 2, point 6) sans le remplacer ; ADR-101 inchangé. Revues exigées : celles d'US-123 (`review-requirements.json` : code, architecture, sécurité, argent, ux, qa), sécurité et argent sur un autre modèle que l'auteur.
- **Sources** : 19 US-123 (critère 3) ; 17 §2.4 (règle d'activation), §2.8 (capacités du PSP : inconnue = « non ») ; 16 HST-049 / FIN-008 ; 22 OQ-P2P-07, OQ-PAY-09 ; DNIT (Paraguay), résolution générale RG 69/2020 : l'inscription au RUC est une obligation du contribuable, à remplir dans les 30 jours ouvrables suivant ses premiers revenus imposables. Turo : page d'aide [Setting trip preferences](https://help.turo.com/en_us/setting-trip-duration-BJZpGUJIc.md), relue le 2026-11-13 (rien n'est copié).

## Contexte

ADR-105 faisait du numéro fiscal (le RUC au Paraguay) une **pièce du dossier** de l'hôte : sans lui, le dossier restait `DOCS_PENDING` et le compte ne pouvait pas être activé (`p2p_host_requires_tax_id` = `true` en PA et en PY). Or l'inscription au RUC est l'affaire de l'hôte, dans un délai qui court **après** ses premiers revenus : la plateforme n'a pas à la contrôler avant la première location. Turo n'exige pas non plus de numéro fiscal pour publier une annonce ; il le collecte pour ses obligations déclaratives, au versement. Le fondateur a fixé la règle : tout contrôle plus lourd que Turo devient un paramètre par pays à `false`, activé seulement si la loi ou un contrat l'impose.

Le préavis de réservation par défaut (`advance_notice_minutes`, 180 min en PA et en PY, US-119 / ADR-101) devait aussi être aligné sur la valeur par défaut de Turo.

## Décision

1. **Paramètre de pays `host_tax_id_required_for_activation`** (BOOL, portée COUNTRY, `failMode` BLOCK, PROPOSÉ, graine générée 0086) : `true` ⇒ le numéro fiscal est une pièce du dossier (comportement d'ADR-105) ; **absent ou mal formé ⇒ exigé** (fail-closed, règle des clés de garde) ; graine **`false` en PA et en PY**. Il remplace, pour le dossier et l'activation, la lecture de `p2p_host_requires_tax_id` : cette clé de 0009 reste (migration immuable, ADR-044) mais n'est plus lue par le KYC de l'hôte ; elle reste `TO_DECIDE` (OQ-PAY-09). Aucune constante de pays : le type de numéro admis vient toujours de `config_country.host_tax_id_kinds`.
2. **Saisie toujours possible, toujours chiffrée** : la commande `kyc_cmd_host_save_tax_profile` est inchangée (personne physique, type du pays, enveloppe par la clé du sujet `ORG`). Comme le numéro n'est plus une pièce du dossier, un **premier** numéro est admis aussi en revue (`IN_REVIEW`) ou après l'approbation (`APPROVED`) ; un numéro déjà enregistré ne se remplace plus après l'envoi (règle d'ADR-105) ; dossier `REJECTED` ou `REVOKED` : verrouillé.
3. **Exigence au versement, seulement si le PSP l'impose** : nouvelle capacité du registre (17 §2.8) `SUPPORTS_PAYOUT_WITHOUT_HOST_TAX_ID` (bool, non bloquante pour tous les hôtes). Si un sous-marchand `ACTIVE` de l'hôte est chez un PSP qui ne l'a **pas validée** (`VALIDATED_*` et valeur `true`), le numéro est exigé : blocage `HOST_TAX_ID_REQUIRED` à l'activation, hôte **non activable** tant qu'il manque. Capacité absente, `UNKNOWN`, `DOCUMENTED` ou fausse ⇒ exigé (inconnue = « non », comme la règle d'activation existante). Sans sous-marchand `ACTIVE`, le PSP n'est pas connu et l'activation reste fermée par `SUBMERCHANT_NOT_ACTIVE`. L'activation précède tout versement : c'est le point de contrôle avant le premier versement. L'état de l'hôte (`tax_required`) dit vrai dans les deux cas (pays ou PSP).
4. **Rappel de l'obligation fiscale** sur l'écran A07, en es, en, fr et pt-BR (catalogue v33) : badge « Facultatif » quand ni le pays ni le PSP n'exigent le numéro, phrase qui dit qu'il peut être ajouté plus tard, et rappel, toujours affiché, que les impôts sont la responsabilité de l'hôte et qu'il peut devoir, selon les règles fiscales locales, s'inscrire auprès de l'administration fiscale dans un délai après ses premiers revenus de location ; aucun texte propre à un pays.
5. **Indiscernabilité (VER-028) conservée** : aucun calcul ajouté ne lit le filtrage des sanctions. Les preuves L0 et de contrat comparent étape par étape un hôte retenu et un hôte propre, avec le paramètre activé, désactivé, et pour un hôte qui ne donne jamais de RUC (jusqu'à l'exigence du PSP).
6. **Préavis de réservation par défaut : 180 min, inchangé.** La page d'aide officielle de Turo relue le 2026-11-13 confirme que le préavis minimum est un réglage de l'hôte, par lieu (domicile, livraison, lieu personnalisé), et que les réservations plus courtes sont refusées ; elle ne publie **aucune valeur par défaut** (seule règle chiffrée : au moins un jour pour un véhicule de plus de 15 000 £ au Royaume-Uni). Faute de source officielle, `advance_notice_minutes` reste à 180 min (PROPOSÉ, `TO_DECIDE`, J-ADM-031) ; chaque hôte le règle déjà par lieu de 0 à 10 080 min (ADR-101). Le plancher de 1 440 min de la classe `LUXE` est inchangé. Aucune migration.

## Mise en œuvre

- Migration **0086** (`0086_config_host_tax_id_params.sql`) : graine du paramètre, générée depuis `params.json` par `seed-sql.ts` (`POST_SEED_PARAMS`, ADR-075) et comparée par `seed-sql.test.ts` ; liste blanche des constantes de pays comme les autres graines générées.
- Migration **0087** (`0087_kyc_host_tax_id_optional.sql`, écrite à la main, sans constante de pays) : capacité ajoutée au catalogue ; politique `kyc_cmd_host_read` de `config_param_value` recréée avec la clé ; fonctions `core.kyc_host_tax_saved(uuid)` et `core.kyc_host_psp_requires_tax_id(uuid)` (SECURITY INVOKER, EXECUTE au seul `kyc_cmd_owner`) ; `kyc_host_gates`, `kyc_host_blockers`, `kyc_host_state` et `kyc_cmd_host_save_tax_profile` remplacées par leur propriétaire, même signature, corps de 0075 recopiés. Deux fichiers et non un : le contrôle « aucune constante de pays » n'exempte que des graines entièrement générées.
- API : capacité ajoutée à `CAPABILITIES` (module PAY, non bloquante) ; le FAKE du magasin KYC porte `taxRequired`. Site : écran A07. Double e2e : graine `false`.

## Écarts PROPOSÉS à reporter dans les spécifications

- 17 §2.4 : le profil fiscal n'est plus une condition d'activation par défaut ; condition remplacée par `host_tax_id_required_for_activation[pays]` ou l'exigence du PSP au versement.
- 17 §2.8 : capacité `SUPPORTS_PAYOUT_WITHOUT_HOST_TAX_ID` (bool, non bloquante, inconnue ⇒ numéro exigé à l'activation).
- 17 §7.2 : clé `host_tax_id_required_for_activation` ; `p2p_host_requires_tax_id` plus lue par le KYC de l'hôte.
- 10b §4.3 : `web.a07.optional`, `web.a07.tax.optionalHint`, `web.a07.tax.reminder`.

## Options écartées

- **Passer `p2p_host_requires_tax_id` à `false`** : 0009 est immuable et la clé est `TO_DECIDE` (OQ-PAY-09, qui dépasse le seul KYC) ; une clé nouvelle, nommée pour ce qu'elle garde, est plus lisible.
- **Rendre la capacité bloquante pour tous** : elle fermerait l'activation de tous les hôtes, même ceux qui ont donné leur numéro.
- **Exiger le numéro au premier versement réel** : le versement est livré au lot C ; d'ici là, l'activation est le dernier point de contrôle avant tout versement.
- **Préavis de 60 min** (valeur citée par des guides non officiels) : non vérifiable sur une source officielle de Turo.

## Conséquences

- Par défaut en PA et en PY, un hôte sans RUC a un dossier complet et peut être approuvé ; il n'est activé que si le PSP retenu valide le versement sans numéro fiscal, sinon il doit donner son numéro avant l'activation.
- Au lot C, la validation de `SUPPORTS_PAYOUT_WITHOUT_HOST_TAX_ID` fait partie de la porte go / no-go du PSP.
- Activer le contrôle dans un pays (loi, assureur, PSP) : nouvelle version de `host_tax_id_required_for_activation` à `true`, sans code.
