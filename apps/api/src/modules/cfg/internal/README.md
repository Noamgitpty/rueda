# Module CFG — configuration pays (US-013)

Tout ce qui dépend du pays est une **donnée versionnée**, jamais une constante de code (ADR-024, ADR-033, ADR-049). Panama (`PA`, USD, `America/Panama`) et Paraguay (`PY`, PYG sans décimale, `America/Asuncion`) existent dès le lot 0. Choisir le pays de lancement ne demande aucune réécriture.

## Socle de marque (US-034)

Thème versionné, actifs et blocs de contenu : voir [`brand/README.md`](brand/README.md) (ADR-067).

## Données (source unique)

| Fichier                | Contenu                                                                                                                                                                      | Table(s) en base                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `data/currencies.json` | code ISO 4217, exposant de l'unité mineure (17 §1.2)                                                                                                                         | `core.config_currency`                                                                                             |
| `data/countries.json`  | devise, fuseau IANA, locales (dont la locale juridique), noms es / en / fr, pièces fiscales de l'hôte, taxe par ligne, entité juridique, fériés, attentes du contrôle tzdata | `core.config_country`, `core.pricing_tax_line_config`, `core.finance_legal_entity`, `core.config_holiday_calendar` |
| `data/params.json`     | registre des clés de 17 §7.2 (type, unité, portées, `fail_mode`…) et valeurs **PROPOSÉES** par pays                                                                          | `core.config_param_definition`, `core.config_param_value`                                                          |

Les locales ne sont pas recopiées : chaque locale d'un pays doit exister dans `@rueda/i18n` (`packages/i18n/config/locales.json`), sinon le chargement échoue. Les clés commençant par `$` dans les JSON sont des commentaires.

Les valeurs « à fixer » de 17 §7.2 **ne sont pas chargées** : leur absence suit `fail_mode`. Les valeurs de Turo ne sont jamais chargées.

## Règles (fail-closed)

- **Validation** (`parseCountryConfig`) : tout défaut (champ inconnu, type, devise ou locale inconnue, fuseau inconnu du runtime, type de ligne fiscale manquant, flottant, valeur hors liste, interrupteur mal déclaré…) lève `CONFIG_INVALID` en listant **tous** les défauts. Rien n'est complété par défaut.
- **Résolution** (`resolveParam`) : ordre `NETWORK > PSP > ORG > CATEGORY > COUNTRY`, à la date de l'événement fournie par l'appelant (l'horloge fait foi côté base). Absence : `BLOCK` ⇒ `PARAM_MISSING`, `FALSE` ⇒ `false`, `ZERO` ⇒ 0. Clé inconnue ⇒ `PARAM_UNKNOWN` ; pays inconnu ⇒ `COUNTRY_UNKNOWN` ; clé « — » dans un pays ⇒ `PARAM_NOT_APPLICABLE`. Une clé `optional` (repli documenté) se lit par `findOptionalParam`.
- **Interrupteurs** (`isGoLiveSwitchOn`, `core.config_go_live` en SQL) : `p2p_private_hosts_enabled`, `insurer_contract_active`, `funds_holding_enabled`, `payouts_enabled` ; portée pays, `false` dans les graines ; clé absente ou inconnue, pays inconnu, valeur non booléenne ⇒ `false`, sans exception. En base, toute écriture à une autre valeur que `false` est refusée (`FORBIDDEN`) jusqu'aux commandes à deux personnes de US-125 (RLS-27).
- **Non-rétroactivité** (`assertNotRetroactive`, garde SQL) : `valid_from` antérieur à `platform.now()` ⇒ `PARAM_RETROACTIVE` ; absent ⇒ `platform.now()`. Pour « maintenant », **omettre** `valid_from` : un appelant qui passerait sa propre heure serait refusé de quelques microsecondes.
- **Immuabilité** (garde SQL) : ni modification ni suppression ni `TRUNCATE` des valeurs, taxes, fériés, devises, pays, définitions et entités juridiques (`PARAM_IMMUTABLE`) ; seule la fermeture d'une version ouverte (`valid_to` ≥ maintenant) est permise.
- **Interrupteurs dans les données** : seule la valeur `false` est acceptée par le parseur (`CONFIG_INVALID`) jusqu'à US-125.
- **Paramètres d'argent JSON** : forme et bornes vérifiées selon l'unité (montants en chaînes d'entiers int64, parts dans [0 ; 1], listes croissantes, barème ordonné et ouvert, `jsonKeys`).
- **Montants** : chaînes d'entiers en unités mineures de la devise du pays (`currency` posée d'office) ; aucune conversion ; aucun flottant.

## Démarrage (API et travailleur)

`CountryConfigService` (fourni et exporté par `CfgModule`) charge et valide les données, puis à l'initialisation :

1. contrôle la **tzdata du runtime** contre les attentes de `countries.json` (`TZDATA_MISMATCH` ; 17 §1.3, ADR-019, OQ-BR-20) ;
2. si `RUEDA_ENV` vaut `production` — **ou est absent ou inconnu** —, exige toutes les données obligatoires (`PARAM_MISSING`, avec la liste) : clés `BLOCK` non optionnelles, entité juridique, fériés de l'année.

Aujourd'hui, la production refuse donc de démarrer (34 manques : valeurs « à fixer », entités juridiques, fériés). C'est voulu : J-ADM-031, ADR-013 et les calendriers de fériés ne sont pas tranchés. En local : `RUEDA_ENV=development`.

La tzdata de PostgreSQL se contrôle par `checkPostgresTimeZoneData(config, query)` (requête `POSTGRES_OFFSET_SQL`) ; elle est prouvée par `packages/db/test/int/config-country.test.ts` et sera branchée au démarrage par la story qui connecte l'API à la base.

## Base de données

Migrations `packages/db/migrations/0008_config_country.sql` (tables, gardes, RLS `ENABLE` + `FORCE`, lecture seule pour `app_api` et `app_worker`, rien pour `app_anon`) et `0009_config_seed.sql` (**générée**, ne pas éditer). Après une modification des données, et avant toute application en environnement partagé :

```bash
RUEDA_WRITE_CFG_SEED=1 pnpm --filter @rueda/api test:unit   # régénère 0009
```

Une migration appliquée est immuable (ADR-044) : une fois 0009 appliquée, un changement de valeur sera une **nouvelle version** (`valid_from` futur) portée par une nouvelle migration de graines (à outiller, voir la passation US-013).

## Aucune constante pays

`pnpm lint` contient deux contrôles dont les jetons sont **tirés de ces données** (`packages/config/country-constants`) : la règle ESLint `rueda/no-country-constants` (chaînes, gabarits, texte JSX, expressions régulières, clés de propriété nues, champs et méthodes de classe, membres d'`enum`, sans tenir compte de la casse) et le contrôle des littéraux SQL des migrations (liste blanche : `packages/db/country-data-allowlist.json`, graines générées seulement). Les commentaires `eslint-disable` qui couperaient la règle sont refusés. Seuls les fichiers déclarés dans `packages/config/country-constants/exemptions.json` en sont exemptés. **Limite** : les nombres (`0.07`) ne sont pas détectés ; un taux codé en dur relève de la revue.

## Codes d'erreur

`PARAM_MISSING`, `PARAM_RETROACTIVE` (16 ADM-014) ; PROPOSÉS par US-013, à reporter en 16 A.8 : `CONFIG_INVALID`, `PARAM_UNKNOWN`, `PARAM_NOT_APPLICABLE`, `PARAM_IMMUTABLE`, `COUNTRY_UNKNOWN`, `TZDATA_MISMATCH`. `FORBIDDEN` (16 ADM-014) pour un interrupteur écrit hors procédure.
