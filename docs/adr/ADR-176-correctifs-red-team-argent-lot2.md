# ADR-176 — Correctifs de la red team argent du lot 2 : lignes sans source refusées au gel, signal « paiement hors plateforme », gel HOST et écart FIN au chargeback

- **Statut** : PROPOSÉ (US-222d, agent de story correctifs, rôle back-end, claude-opus-5-5, 2026-11-19). Revues exigées : celles de `node scripts/ci/check-story-reviews.mjs` (argent, sécurité, RLS / `SECURITY DEFINER` et concurrence sur un autre modèle que l'auteur).
- **Complète** : ADR-125 / ADR-129 / ADR-133 (devis rejoué par la base), ADR-114 et ADR-122 (filtre des textes publics de l'hôte), ADR-097 (files de revue), ADR-087 et ADR-161 (rapprochement FIN), ADR-053 (liste blanche RLS-15).
- **Sources** : rapport `docs/team/redteam/L2-argent.md` (PR #254 : F-L2-ARG-01 à 04) ; 08 E7 règles 5 et 7, BR-PAY-11, TJ13a / TJ13c, TJ14a / TJ14b ; 16 A.8 (`QUOTE_MISMATCH`, `QUOTE_LINE_NOT_SUPPORTED`) ; 17 v6 §2.3, §2.9 ; pré-mortem L2 (RT-L2-M01, M12, M18 ; L2-PM-03, L2-PM-30, L2-PM-43) ; `docs/team/COMME_TURO.md`.

## Contexte

La red team argent du lot 2 a prouvé quatre défauts par des `it.fails` : (01) la commande de gel figeait des lignes de la demande sans source en base (promotion de l'hôte ou de la plateforme, options, livraison) ; (02, 03) une proposition de paiement hors plateforme sans coordonnée passait dans la zone, la ville, le libellé et l'adresse du lieu, et la file GRAY_MARKET de la console n'avait aucun écrivain ; (04) un chargeback perdu n'était imputé nulle part, la jambe HOST restait due et le rapprochement FIN rendait 0 écart.

## Décision

1. **Lignes sans source refusées au gel** (migration 0155, `core.pricing_cmd_freeze_quote`) : la base recalcule chaque ligne depuis sa source ; en bêta, PROMO_PLATFORM, PROMO_HOST, EXTRAS, ADDITIONAL_DRIVER_FEE, YOUNG_DRIVER_FEE et DELIVERY_FEE n'en ont aucune : leur montant recalculé est 0 et tout autre montant ⇒ `QUOTE_MISMATCH`, rien de figé (défaut fail-closed, comme les crédits N-367). La règle est jugée après celle des jambes (`LEG_AMOUNT_NEGATIVE` de TJ13a / TJ13c reste l'issue d'une promotion qui rend PLATFORM négative) et avant la comparaison des sorties. La route HTTP n'envoie aucune de ces lignes : rien ne change pour elle. Chaque ligne rouvre avec le module qui lui donne une source (promotion, options, livraison), en revue argent. Le refus du checkout (`QUOTE_LINE_NOT_SUPPORTED`, N-129) reste en défense en profondeur.
2. **Signal « paiement hors plateforme »** (comme Turo : ses règles interdisent d'inviter à payer hors de la plateforme ; un contenu qui le fait est retiré et signalé) :
   - catalogue de motifs `core.catalog_offplatform_pattern` (écrit par migration seulement, lu par `catalog_cmd_owner`) : moyens de paiement nommés, espèces, virement ou paiement direct, commission ou plateforme contournées, en es, en, fr et pt-BR ; aucun pays, aucune constante dans le code ; comparé au texte normalisé (NFKC, invisibles retirés, minuscules, accents retirés), en mots entiers ;
   - **zone et ville** (textes publics) : refus `LOCATION_AREA_OFF_PLATFORM` / `LOCATION_CITY_OFF_PLATFORM` (HTTP 422 `LOCATION_OFF_PLATFORM_PAYMENT`, champ désigné, `common.listing.offPlatformPayment`, catalogue v93) **et** élément GRAY_MARKET sur le compte d'hôte (un élément vivant par compte : aucune inondation de la file) ;
   - **libellé et adresse du lieu** (lus après la réservation, chiffres légitimes) : jamais refusés ; le lieu est créé et signalé (élément GRAY_MARKET sur le lieu). Jamais plus lourd que Turo : une adresse légitime n'est jamais bloquée ;
   - file GRAY_MARKET **déclarée** : permission `ops.review_listing_host`, délai `listing_review_sla_h` du pays (PROPOSÉ, celui de la revue d'annonce) ; file indisponible (paramètre absent) ⇒ exception, rien d'écrit (jamais un signal perdu).
3. **Chargeback** (à défaut de l'imputation de TJ14a / TJ14b, US-709) :
   - **gel de la jambe HOST** dès qu'un CHARGEBACK non échoué est enregistré sur un trip (déclencheur `payment_operation_chargeback_freeze`, fonction SECURITY DEFINER `core.settlement_freeze_host_on_chargeback`, cmd_money_owner, aucun EXECUTE) : 08 E7 règle 7 « ouvert » met les lots de l'hôte ON_HOLD ; une jambe gelée refuse déjà tout mouvement (`leg_frozen`), donc tout versement. Droit de colonne `frozen, frozen_reason` accordé à cmd_money_owner avec une politique qui n'admet que le gel de la jambe HOST d'un trip à chargeback ; la garde des soldes refuse tout dégel et tout autre gel (`trip_leg_balance_freeze_forbidden`) : le dégel (chargeback gagné, trip réalisé de TJ14b) est la décision FIN d'US-709 ;
   - **contrôle FIN `CHARGEBACK_UNIMPUTED`** (quinzième contrôle du rapprochement nocturne) : faits `core.finance_chargeback_facts()` (travailleur `reconciliation` seulement) ; un chargeback SUCCEEDED sans mouvement de jambe est un écart (alerte P1 `FIN_MONEY_RECONCILIATION` du pays) ; les chargebacks dont la jambe HOST n'est pas gelée sont comptés (`examined.chargebackHostUnfrozen`).

## Options écartées

- **Recalculer les promotions et options depuis leur source** : aucune source n'existe en bêta (ni code promo, ni module d'options, ni livraison) ; l'inventer serait une décision produit.
- **Masquer le texte** (remplacer la proposition) : un masque partiel laisse le sens (« … al entregar: 10% menos ») et cache à l'hôte ce qui est refusé ; refus + signalement est plus simple et plus clair.
- **Refuser aussi le libellé et l'adresse** : « Calle 50 », « apto 34 » ou un numéro de rue sont légitimes ; un refus sur un faux positif bloquerait un hôte honnête (plus lourd que Turo).
- **Imputation complète de TJ14a / TJ14b ici** : elle demande le registre de l'hôte (reprise de E5, `host_ledger`), le double remboursement (`guest_receivable`) et le dégel conditionnel (US-709, lot 3) ; la faire à moitié serait pire que l'écart signalé.

## Conséquences

- Un devis forgé qui porte une remise, une option ou une livraison n'est plus figé ; les preuves L0 d'US-202 / US-208 qui figeaient les lignes de T01 / T40 prouvent désormais leur refus (jambe HOST du devis figé = part du loyer : 9 000 en PA, 750 001 en PY, TJ01 / TJ09a sans ces lignes).
- La console voit des éléments GRAY_MARKET (sujets `ORGANIZATION` et `LOCATION`) ; leur fiche détaillée par sujet et leur clôture relèvent de la console (US-118 suite).
- Tant qu'US-709 n'impute pas les chargebacks, chacun reste un écart FIN et sa jambe HOST reste gelée : rien n'est versé à l'hôte sur ce trip sans décision FIN.
- Limites : le catalogue réduit le risque sans prétendre à l'exhaustivité (comme ADR-114) ; marque et modèle saisis et textes à venir (description de l'annonce, messagerie) ne passent pas encore par ce signal ; les lieux créés avant 0155 ne sont pas relus.
