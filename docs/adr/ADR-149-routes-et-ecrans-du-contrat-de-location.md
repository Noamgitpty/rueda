# ADR-149 — Routes et écrans du contrat de location (S09, A03), PDF servi par re-rendu, vérification du PDF signé

- **Statut** : PROPOSÉ (US-211 partie 211b, agent front-end / back-end, claude-opus-5-5, 2026-11-17). Revues exigées : celles de `review-requirements.json` pour US-211.
- **Sources** : 19 US-211 (critères 2 et 3) ; 16 BKG-018, BKG-019 (bêta SIMPLIFIÉ « case + horodatage serveur ») ; 10b S09, A03, UX-51 (« PDF balisé ou HTML accessible équivalent »), UX-56 (case jamais pré-cochée) ; 17 §2.3 point 5 (IDOR : 404) ; ADR-143 (211a : tables, commandes, PDF `ctr.pdf/1`) ; revues de #195 (suites de 211b).

## Contexte

211a a livré la génération, le PDF déterministe et les commandes `core.booking_trip_contract` (lecture) et `core.booking_cmd_sign_contract` (signature) sous `app_api`. Il manquait l'accès HTTP, les écrans des deux parties et plusieurs réserves des revues (bandeau BROUILLON en tête, nom du pays au lieu du fuseau, nom du voyageur dans le bloc de signature, vérification d'un PDF signé, concurrence).

## Décision

1. **Routes** (module CTR, `TripContractController`, gardes `SessionGuard` puis `TermsGuard`) : `GET /trips/{tripId}/contract` (résumé, texte, empreinte, signature), `GET /trips/{tripId}/contract/pdf`, `POST /trips/{tripId}/contract/sign`. `?version=n` lit une version précédente. La partie (voyageur ou titulaire du compte d'hôte) est jugée en base ; toute autre personne, un trip inconnu, une version absente ou un identifiant mal formé reçoivent la **même** 404 `CONTRACT_NOT_FOUND`. Sans magasin, 503 (fail-closed). Aucune migration : les fonctions de 0122 suffisent.
2. **Résumé + équivalent HTML** (UX-51) : la réponse porte un résumé tiré des seuls faits non nominatifs (`terms`, `derived`) et le texte figé **tel que le PDF l'imprime** (bloc de signature rempli par `fillSignatureBlock`, la même fonction que le PDF), découpé en partie espagnole (fait foi) et traduction de courtoisie ; l'écran rend chaque partie dans sa langue (`lang`).
3. **PDF servi par re-rendu**, jamais stocké (ADR-143 n° 5) : le texte figé est rendu de nouveau ; s'il ne redonne pas l'empreinte enregistrée, **rien n'est servi** (503, journal `INTEGRITY`). Signé, le PDF porte le bloc de signature ; l'en-tête `X-Contract-Sha256` donne l'empreinte des octets servis ; `Cache-Control: no-store`. Texte pseudonymisé ⇒ 409 `CONTRACT_TEXT_ERASED` (l'empreinte reste lisible).
4. **Signature** : corps `{ accepted: true, documentId, sha256 }` (case cochée, empreinte du document AFFICHÉ). La base compare l'empreinte (sinon `CONTRACT_HASH_MISMATCH`, rien n'est écrit), refuse une version remplacée (`CONTRACT_SUPERSEDED`) et un trip annulé ou remis (`CONTRACT_NOT_SIGNABLE`) ; rejeu ⇒ la signature d'origine. IP et user-agent restent retenus (ADR-143).
5. **Vérification d'un PDF signé présenté** (`verifySignedContractPdf`) : le PDF signé est une fonction pure du texte figé et du bloc de signature enregistrés ; il est rendu de nouveau et comparé octet pour octet (empreinte) ; le texte doit d'abord redonner l'empreinte du document. **L'empreinte du PDF signé n'est pas stockée** : tant que le texte figé existe, le re-rendu la redonne exactement ; elle ne devient nécessaire qu'à la pseudonymisation (classe B), traitée avec elle (suite, US-536).
6. **Mise en page du texte** (nouvelles versions seulement ; une version enregistrée garde son texte figé) : bandeau BROUILLON du gabarit imprimé sous le titre (style `note`, déjà connu de `ctr.pdf/1` : aucun octet du rendu ne change, empreinte de référence inchangée) et retiré des clauses ; nom du voyageur hors du bloc `sig` (un nom ne peut porter un marqueur remplacé) ; période « hora local de {pays} » avec le nom du pays de la configuration (`names`), plus le fuseau IANA ; jours retenus sans libellé (ni 1 ni ½) ⇒ génération refusée (fail-closed, revues argent et code de #195).
7. **Écrans** : S09 · contrat `/trips/{id}/contract` (voyageur : relation entre particuliers rappelée, bandeau BROUILLON, résumé en tête, PDF, texte complet, case + bouton, état signé avec heure locale et sceau ; ancienne version consultable, non signable) ; A03 · contrat `/host/trips/{id}/contract` (hôte : lecture, état de la signature et effet sur la remise) ; liens depuis S06 (paiement confirmé) et A05 (détail du trip) ; PDF relayé par le site (`/trips/{id}/contract/pdf`, session du visiteur, tout refus ⇒ 404 vide).

## Défauts PROPOSÉS (comme Turo, jamais plus lourd)

- Le voyageur lit et signe dans l'application, avant la remise ; l'hôte voit l'état (comme Turo : l'accord de location est accepté dans l'app, consultable par les deux parties).
- Aucune réouverture du contrat par l'ops ni publication du gabarit par la console dans cette partie (suites).

## Conséquences

- Les contrats générés après cette version ont un texte légèrement différent (bandeau en tête, pays nommé) ; les versions déjà enregistrées se reproduisent à l'identique.
- Concurrence prouvée à deux sessions (`l0-us211-contract-concurrency`) : deux signatures ⇒ une seule ; signature pendant une régénération ⇒ `CONTRACT_SUPERSEDED`.
- À reporter dans 16 A.8 : `CONTRACT_NOT_FOUND`, `CONTRACT_NOT_GENERATED`, `CONTRACT_SUPERSEDED`, `CONTRACT_NOT_SIGNABLE`, `CONTRACT_TEXT_ERASED`, `CONTRACT_UNAVAILABLE`.
