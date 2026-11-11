lot: L1
module: Configuration pays (CFG)

- Ajouté : chaque paramètre PA / PY porte son statut (`DECIDED`, `PROPOSED`, `TO_DECIDE`), la référence de la décision ou de la question ouverte et sa source ; les taux de taxe ont le leur par pays (US-110, ADR-093)
- Ajouté : la production refuse de démarrer tant qu'une valeur en vigueur reste « À DÉCIDER » (`PARAM_UNDECIDED`) ou qu'un taux de taxe est à décider (`TAX_UNDECIDED`) ; la préproduction accepte les valeurs de test (US-110, ADR-093)
- Ajouté : T61 rejoué avec `platform_funded_host_compensation` résolu de la configuration PA et PY (absent ⇒ `false`) : compensation nulle (US-110)
