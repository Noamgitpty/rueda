# packages/db — base de données PostgreSQL

Emplacement réservé par US-001 ; le contenu arrive avec **US-005** (banc PostgreSQL réel, rôles `migrator`, `app_api`, `app_worker`, `app_anon`, outil de migration).

- `migrations/` : migrations SQL versionnées, **additives et réversibles** (19 §1.4 point 5). Jamais deux agents sur la même migration (19 §1.5).
- `sql-clock-allowlist.json` : liste blanche de la règle d'horloge (voir CONTRIBUTING, « SQL et horloge »). Seule la migration qui définit `platform.now()` peut utiliser `clock_timestamp()`.

## Conventions (17 §2.1, §10 point 3)

- **Cible** : un schéma PostgreSQL par module (`iam`, `kyc`, `cat`, `avl`, …), nommé d'après le répertoire du module dans `apps/api/src/modules/`.
- **Bêta pilote (D1)** : un schéma unique, et chaque table préfixée par le code du module en minuscules : `avl_trip`, `cfg_country`, `pay_payment_operation`. Le passage au schéma par module est une migration de renommage, sans changement des noms d'entités.
- Fonctions de plateforme (`platform.now()`) : schéma `platform`.
- `now()`, `current_timestamp` et les autres horloges sont interdits dans le SQL métier ; utiliser `platform.now()` (17 §1.3, ADR-030).
