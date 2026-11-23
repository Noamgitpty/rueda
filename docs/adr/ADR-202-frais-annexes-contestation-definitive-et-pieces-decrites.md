# ADR-202 — Frais annexes : une demande contestée puis annulée ne se redemande plus, et chaque pièce retenue est décrite au voyageur et à l'ops

- **Statut** : PROPOSÉ (US-706 suite, agent de story, rôle back-end, claude-opus-5-5, 2026-11-23). Revues exigées : celles de `node scripts/ci/check-story-reviews.mjs` ; argent, RLS / rôles, `SECURITY DEFINER` et concurrence sur un autre modèle que l'auteur.
- **Complète** : ADR-197 (frais annexes, migration 0177). Ne remplace aucun point d'ADR-197 sauf le n° 15 (« seule l'annulation par l'hôte libère le type », précisé ci-dessous) et le n° 3 / n° 12 pour la preuve d'un nettoyage.
- **Sources** : red team du lot 3 (US-313, `docs/team/redteam/L3-donnees-sinistres.md`) : **F-L3-FRA-01** (élevé) et **F-L3-FRA-02** (moyen), preuves `rt-l3-05-frais-annexes` › RT-L3-S02 et RT-L3-S01 ; 08 BR-REIMB-01 (nettoyage / tabac : « photos dans les fenêtres de 24 h »), BR-REIMB-02 (la fenêtre du voyageur « ne peut pas être rouverte »), BR-REIMB-03 (annuler, réviser ou escalader ; le support tranche), BR-REIMB-05 (doublons), SM-5 (CANCELLED_BY_HOST final ; une révision est une nouvelle facture) ; 16 CLM-021 (le voyageur voit les preuves avant de payer).

## Contexte

La red team a montré deux défauts du chemin livré par 0177 :

1. **F-L3-FRA-01** : une demande contestée par le voyageur pouvait être annulée par l'hôte puis redemandée (même type, même montant, mêmes pièces). Le contrôle de doublon et l'index unique excluaient toute demande annulée : la redemande ouvrait une fenêtre neuve de 72 h, sans décision de l'ops ; le rejet définitif de l'ops se contournait en annulant avant lui ; un voyageur qui croyait l'affaire close pouvait être débité à l'échéance neuve (`NO_RESPONSE`).
2. **F-L3-FRA-02** : avec `incidental_evidence_trip_photos_only` = faux (défaut comme Turo), un seul fichier de l'hôte tenait lieu de preuve d'un nettoyage, sans aucune photo de l'intérieur ; ce fichier n'était décrit ni au voyageur (la vue rendait « 1 pièce » et une liste vide) ni à la console (seules les photos des séries étaient listées).

## Décision

1. **Annuler une demande contestée vaut abandon définitif** (F-L3-FRA-01 ; comme Turo, SM-5 : CANCELLED_BY_HOST est un état final). Une demande du même type sur le même trip est refusée `INCIDENTAL_DUPLICATE` dès qu'il existe une demande vivante, rejetée par l'ops, **ou annulée après une contestation** (`disputed_at` posé). Seule une demande annulée **avant** toute contestation libère le type : l'hôte corrige une erreur avant que le voyageur ait répondu, et la nouvelle demande a sa propre fenêtre, comme une première demande. Aucun autre chemin ne rouvre la fenêtre du voyageur après une contestation : la contestation se termine par une décision de l'ops (débit ou rejet) ou par l'abandon de l'hôte.
   - **Garantie en base** : l'index unique `claim_incidental_live_unique` est recréé sous son nom avec le prédicat `status <> 'CANCELLED_BY_HOST' OR disputed_at IS NOT NULL` ; `core.claim_cmd_submit_incidental` applique la même règle avant d'écrire (refus sans écriture).
   - **Concurrence** : toute commande qui écrit une demande (demande, annulation, paiement, contestation, décision, débit) prend d'abord le verrou du trip ; une annulation et une redemande, ou une annulation et une décision de l'ops, se sérialisent et la seconde relit l'état validé par la première (`INCIDENTAL_DUPLICATE`, `INCIDENTAL_NOT_DISPUTED`, `INCIDENTAL_NOT_CANCELLABLE`). Prouvé à deux connexions.
   - **Écran** : sur une demande contestée, l'hôte lit que l'annulation est définitive avant d'annuler (`web.incidental.cancelDisputedFinal`, quatre langues) ; un type abandonné n'est plus proposé dans le formulaire.
   - **Limite assumée** : un autre type de la liste (tabac au lieu de nettoyage) reste une autre demande, avec ses propres pièces et sa propre fenêtre ; le voyageur la conteste à son tour. La révision d'une demande (`SUPERSEDED` de SM-5) reste une suite : elle passera par l'ops, jamais par une fenêtre neuve.
2. **Chaque pièce retenue est décrite** (F-L3-FRA-02 ; 16 CLM-021) :
   - aux **parties** (`core.claim_incidental_view`) : une photo d'une série comme avant (côté, emplacement, auteur, heure serveur) ; un fichier de l'hôte par `{ kind: 'HOST_FILE', takenBy: 'HOST', mime, receivedAt }` (type et heure serveur de dépôt, **jamais son identifiant**) ; `evidence` décrit autant de pièces que `evidenceCount` ;
   - à la **console** (`core.claim_incidental_staff_view`) : `evidenceCount`, et pour un fichier de l'hôte, en plus, l'identifiant, la taille, l'empreinte SHA-256 et l'indicateur de suppression ; les photos portent aussi leur groupe et leur heure serveur ;
   - description lue par `core.claim_incidental_host_file_meta(uuid, uuid[])` (`cmd_hold_owner`, EXECUTE `cmd_money_owner`) : seulement les fichiers rattachés à CE trip, jamais le contenu ni le déposant.
   - L'API (TRP) et le site lisent le nouvel élément de façon défensive (type admis : JPEG ou WebP ; forme inattendue ⇒ vue en erreur, jamais partielle) ; OpenAPI mise à jour (`oneOf`). Libellé `web.incidental.evidenceHostFile` (format et heure de dépôt) en es, en, fr et pt-BR.
3. **Règle de 08 appliquée au nettoyage et au tabac** (BR-REIMB-01, « photos dans les fenêtres de 24 h » ; fail-closed) : sans photo de l'intérieur au retour, la demande exige au moins un fichier de l'hôte retenu et **reçu par le serveur entre la fin effective et la fin effective + `incidental_cleaning_photo_window_h`** (nouveau paramètre DURATION du pays, PROPOSÉ **24 h** au Panama et au Paraguay, comme Turo ; absent ou mal formé ⇒ `PARAM_MISSING`, aucune demande). Un fichier envoyé pendant le trip ou après la fenêtre ne prouve pas l'état au retour (`INCIDENTAL_NOT_BILLABLE`) ; il peut rester joint comme pièce complémentaire. Les fichiers sont des images JPEG ou WebP (politique de 0177). **Jamais plus lourd que Turo** : aucune photo des séries n'est exigée en plus ; `incidental_evidence_trip_photos_only` reste faux.
4. Aucune constante de pays hors du bloc généré des paramètres ; aucun interrupteur écrit ; aucun montant ni aucune jambe changés ; RLS `ENABLE` + `FORCE` inchangées ; aucun droit applicatif nouveau.

## Conséquences

- RT-L3-S02 (F-L3-FRA-01) et RT-L3-S01 (F-L3-FRA-02) : les `it.fails` de `rt-l3-05-frais-annexes` (PR #296) deviennent des tests de comportement à la fusion de #296 dans cette branche.
- Preuves : `packages/db/test/l0/l0-us706-incidental-contest.test.ts` (PA / USD et PY / PYG : abandon définitif, témoin de l'annulation avant contestation, rejeu, aucun second avis, l'ops ne décide plus ; pièces décrites aux parties et à la console ; bornes de la fenêtre des photos : 24 h admis, 24 h + 1 ms refusé ; fenêtre illisible ⇒ `PARAM_MISSING`) et `l0-us706-incidental-contest-race.test.ts` (trois courses à deux connexions, groupe isolé) ; contrat HTTP (`trip-incidental.contract.test.ts`, `console.contract.test.ts`) ; lecture défensive (API, site) ; e2e `trip-incidental.spec.ts` (quatre langues, 360 px, axe).
- Suites (inchangées ou précisées) : lecture d'un fichier de l'hôte par lien signé et vignettes (avec la route d'envoi des octets, ADR-197 n° 19 ; elle vérifiera aussi la signature du format, l'empreinte étant calculée par le serveur) ; révision d'une demande (`SUPERSEDED`) par l'ops ; étape « réponse de l'hôte » de SM-5.

## Alternatives écartées

- **Redemande après contestation envoyée directement à l'ops** (sans fenêtre du voyageur) : plus lourde (un état et une file de plus) pour un cas que Turo ne prévoit pas ; la révision, quand elle viendra, suivra ce chemin.
- **Interdire l'annulation d'une demande contestée** : contraire à BR-REIMB-03 (« annuler, réviser ou escalader ») ; l'hôte qui renonce doit pouvoir le faire.
- **Exiger toujours une photo des séries pour un nettoyage** : plus lourd que Turo (`incidental_evidence_trip_photos_only` = vrai reste possible par pays, DEC-FONDATEUR-22).

## Retour arrière

Voir l'en-tête de `packages/db/migrations/0182_claim_incidental_contest_and_evidence.sql` (jamais en production : nouvelle migration). Côté API et site : la lecture de `HOST_FILE` reste compatible avec une vue sans cet élément.
