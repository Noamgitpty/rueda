# Passation US-042 (correctif) — total payé négatif et bornes du remboursement (2026-11-06, agent argent, claude-opus-5-5)

Branche `story/US-042-total-paye-negatif`, worktree `../wt/US-042-neg`. **Statut : EN REVUE**. Revues exigées : code, **argent** et qa (`packages/money/`, `docs/team/review-requirements.json`), sur un autre modèle que l'auteur. Décisions : ADR-090 (PROPOSÉ).

- **Constat** : instabilité de `main`, révélée par le job « qualité » de la PR #93 (run 42167466075). Dans `test/settlement/properties.test.ts`, cas PY, graine `-1390209851`, le générateur bornait chaque promo par P mais pas leur somme. Résultat : total payé −1, et le moteur acceptait.
- **Fait** :
  - garde `assertPayableAmounts` (`src/settlement/amounts.ts`), appelée par `validateTrip`. Codes : `LINE_SIGN_INVALID`, `PROMO_EXCEEDS_TRIP_PRICE`, `TOTAL_PAID_NOT_POSITIVE` ;
  - bornes du remboursement dans `settle` : `REFUND_OUT_OF_RANGE`. Ce code vient de deux autres instabilités trouvées en rejouant la propriété (graines `-1970700454` et `-1546341607`), avec la promo proche de 100 % ;
  - générateurs alignés sur 08 : `properties`, `monotonicity`, `oracle-diff` ;
  - régressions déterministes en USD et en PYG, propriétés de refus en PA et en PY, et test de l'impression de la graine (`test/settlement/payable-amounts.test.ts`).
- **Vérifié** :
  - `pnpm --filter @rueda/money test:unit` et `test:oracle` (0 écart) ;
  - `lint` et `typecheck` ;
  - les trois contre-exemples évalués par `independent_settlement_check.py` (`python -I -X utf8`) : l'oracle rend les mêmes montants hors bornes ;
  - 120 rejeux à graine aléatoire des propriétés du règlement sans échec ; mutation sur les fichiers modifiés (voir le rapport de la PR).
- **Reports** :
  - Q-013 (total nul) et Q-014 (arrondi des promos proches de 100 %) ;
  - le moteur de devis devra appeler `assertPayableAmounts` (critère à ajouter à sa story) ;
  - la non-cumulabilité des codes promo (BR-PAY-07, OQ-BR-10) n'est pas imposée ;
  - nouveaux codes à reporter dans 16 A.8.
- **Conflits possibles** :
  - `record.ts` n'est pas touché ;
  - PR #91 et #92 : fin du tableau de `docs/team/QUESTIONS.md` (elles ajoutent Q-012), conflit de lignes seulement ;
  - aucun autre fichier commun.
- **Prochaine commande exacte** : `pnpm install --frozen-lockfile && pnpm --filter @rueda/money test:unit && pnpm --filter @rueda/money test:oracle`.
- **Paramètres créés** : aucun. **Migrations** : aucune.

## Seconde passe (2026-11-06, après les revues argent ✓, code ✓, qa ✗ au SHA cd98e59)

- qa n° 1 : régression exacte de la graine -1546341607 (P 2, promo −2, F 1, taxe 1, 1 jour, remboursable, `GUEST_CANCELLED` à +60 min, total 2 ; oracle : remboursement −2), en USD et en PYG. Le cas P 6 / −3 / −3 / 9 jours est réétiqueté comme variante.
- Contexte `SettlementError.details` pour `REFUND_OUT_OF_RANGE`, et deux suivis dans `docs/team/BOARD.md` : alerte FIN par le service appelant, appel de la garde par le devis.
- `TAX_PAID_NEGATIVE` à l'entrée.
- `guestRefund ≥ 0` affirmé dans la propriété d'équilibre ; commentaire de la zone d'exception présenté comme un majorant.
- Corrections d'ADR-090 : `LINE_SIGN_INVALID` « prix ≥ 0 » présenté comme déduction PROPOSÉE ; raison pour laquelle les jambes ne sont pas gardées.
- README : scores de mutation mis à jour ; renvoi à un fichier inexistant retiré.
