# @rueda/i18n

Internationalisation partagée (US-014) entre `apps/web`, `apps/backoffice` et, plus tard, les gabarits de notification de l'API. Locales : `es-PA`, `es-PY`, `en` (17 §1.4), `fr` (DEC-FONDATEUR-17) et `pt`, portugais du Brésil (DEC-FONDATEUR-18 ; 17 §1.4 ne liste pas encore `fr` et prévoit `pt-BR` en P2, voir la passation). Le produit est **quadrilingue** : espagnol, anglais, français et portugais du Brésil, livrés ensemble. **La version espagnole fait foi.** Langues de catalogue : `CATALOG_LANGUAGES` (`es`, `en`, `fr`, `pt`), source unique que l'API et le web importent (ADR-071).

Le paquet est publié en TypeScript source, comme `@rueda/db`. Les applications Next le transpilent (`transpilePackages`) et activent `allowImportingTsExtensions`. Aucune dépendance externe : tout repose sur `Intl` (ICU embarqué dans Node 26).

## Responsabilité

Traduire et formater pour les applications et les notifications : catalogues es / en / fr, pluriels, montants (affichage seulement), nombres, dates dans le fuseau du véhicule, négociation de la locale.

## Entités

Aucune entité persistée : catalogues et configuration des locales sont des fichiers du dépôt ; seul le choix de l'utilisateur vit dans un cookie `locale`.

## Événements

Aucun événement de domaine : le paquet est une bibliothèque pure, sans état.

## Ports

Aucun port : tout repose sur `Intl` (ICU embarqué dans Node 26), sans dépendance externe.

## Contenu

| Fichier                 | Rôle                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/locales.json`   | **Donnée** : locales déclarées, locale par défaut, séparateurs, symboles monétaires, gabarits de date et d'heure (ADR-024)                    |
| `src/catalogs/es.ts`    | catalogue espagnol (fait foi) ; tutoiement « tú » dans l'interface (UXQ-04, PROPOSÉ)                                                          |
| `src/catalogs/en.ts`    | catalogue anglais, typé `Record<MessageKey, Message>` : une clé manquante ou en trop fait échouer `pnpm typecheck`                            |
| `src/catalogs/fr.ts`    | catalogue français, typé comme `en.ts` ; tutoiement dans l'interface, vouvoiement dans les textes contractuels (COMME_TURO, PROPOSÉ)          |
| `src/catalogs/pt.ts`    | catalogue portugais du Brésil, typé comme `en.ts` ; « você » dans l'interface, registre formel dans les textes contractuels                   |
| `src/locale-profile.ts` | types et validation de la configuration (`parseLocaleConfig`, `getProfile`), fail-closed                                                      |
| `src/translator.ts`     | `createTranslator(profile, overrides?)` → `t(key, values)`, pluriels CLDR, et raccourcis `money`, `number`, `date`, `time`…                   |
| `src/money-format.ts`   | `formatMoney` : adaptateur d'**affichage seulement** (voir plus bas)                                                                          |
| `src/number-format.ts`  | `formatNumber` pour les quantités non monétaires (km, jours, compteurs)                                                                       |
| `src/date-format.ts`    | dates et heures dans le **fuseau du véhicule**, `utcOffsetMinutes`, `checkTimeZoneData` (contrôle tzdata de 17 §1.3)                          |
| `src/negotiate.ts`      | `negotiateLocale` : choix mémorisé (cookie `locale`) → `Accept-Language` → locale par défaut (10b UX-11)                                      |
| `src/locale-choice.ts`  | `localeChoiceResponse` : traitement de `POST /locale` (validation, cookie `HttpOnly; SameSite=Lax`, 303 vers `/`)                             |
| `src/testing/index.ts`  | export `@rueda/i18n/testing` : `compareCatalogs` (parité) et `findForeignStrings` (mélange de langues dans un écran rendu, en **mot entier**) |

## Utilisation

```ts
import { createTranslator, getProfile, parseLocaleConfig } from '@rueda/i18n';
import raw from '@rueda/i18n/config/locales.json' with { type: 'json' };

const config = parseLocaleConfig(raw);
const i18n = createTranslator(getProfile(config, 'es-PY'));
i18n.t('common.price.finalForDays', { count: 3 }); // « Precio final · 3 días »
i18n.money({ amountMinor: 1050000n, currency: 'PYG', exponent: 0 }); // « ₲ 1.050.000 »
i18n.dateTime('2026-01-10T15:05:00Z', vehicle.timezone); // « 10/01/2026 12:05 »
```

Dans une application Next, la locale de la requête vient de `getRequestI18n()` (`apps/*/i18n.ts`), et d'aucune autre source : une vue = une langue.

Gabarits de notification (US-021, ADR-061) : espace `ntf`, clés `ntf.<gabarit>.email.subject`, `ntf.<gabarit>.email.body` et `ntf.<gabarit>.sms.body`, rendues par le module NTF de l'API dans la langue du **destinataire**. L'API compilée importe les sources `.ts` de ce paquet (`apps/api/tsconfig.build.json` : `rewriteRelativeImportExtensions`), chargées par Node 26.

## Règles

- **Aucune chaîne en dur** dans les applications : toute chaîne visible passe par une clé. Une clé s'ajoute **dans `es.ts`, `en.ts`, `fr.ts` et `pt.ts` dans le même commit**. Le nommage suit `<espace>.<écran>.<élément>`, avec les espaces `common`, `web` et `backoffice`. Si le sens d'une clé change, ou si une clé est ajoutée ou retirée, on incrémente `CATALOG_VERSION`.
- **Variables** : on écrit `{nom}`. Une variable manquante lève `MissingVariableError` : jamais de « {6} » affiché (17 §1.4). Un nombre passé en variable doit être entier. Un montant se formate d'abord avec `money`, puis passe en chaîne.
- **Pluriels** : objet `{ one, other }`, avec `{count}` obligatoire. Une catégorie CLDR absente (par exemple `many` en espagnol ou en français pour 1 000 000) se replie sur `other`. En français et en portugais du Brésil, `one` couvre **0 et 1** (« 0 jour », « 1 jour », « 2 jours » ; « 0 dia », « 1 dia », « 2 dias »).
- **Français** : tutoiement dans l'interface, vouvoiement réservé au contrat et aux textes juridiques. Typographie : espace insécable (`\u00a0`, écrite en échappement dans le source) avant « : ; ? ! », apostrophe « ’ ». Termes : colonne française de `docs/glossary.md`.
- **Portugais du Brésil** (`pt`) : variante pt-BR, jamais le portugais du Portugal (« carro », « celular », « tela », pas « viatura », « telemóvel », « ecrã ») ; « você » et l'impératif courant du Brésil (« Digite », « Confira ») dans l'interface ; textes juridiques relus par l'avocat avant la mise en service. L'étiquette est `pt` et non `pt-BR` : dans le CLDR, `pt` **est** le portugais du Brésil (`pt-PT` est la variante européenne), les formats sont identiques (test) ; une étiquette régionale serait une constante pays pour le contrôle ADR-024 (ADR-071). `Accept-Language` `pt`, `pt-BR` et `pt-PT` choisissent `pt`. Termes : colonne portugaise de `docs/glossary.md`.
- **Surcharges régionales** : `createTranslator(profile, overrides)` accepte un sous-ensemble de clés avec les mêmes emplacements. Aucune n'existe aujourd'hui : es-PA et es-PY partagent le catalogue `es`.
- **Montants** : `formatMoney` reçoit `MinorUnitAmount { amountMinor: bigint; currency; exponent }`. Ce n'est **pas** `Money` (US-015) : tout objet qui porte ces trois champs s'affiche. L'adaptateur ne fait **aucun calcul** : les chiffres du `bigint` sont découpés à la position de l'exposant, sans division, sans arrondi et sans conversion. Un `number` est refusé. L'exposant vient de `config.currency` (USD = 2, PYG = 0).
- **Dates** : le fuseau IANA est un **paramètre obligatoire**. Il vient du véhicule, jamais du navigateur ni du code. L'instant doit porter son fuseau (`Z` ou `±hh:mm`). Le format est jj/mm/aaaa ; l'heure est sur 24 h en espagnol, en français et en portugais, sur 12 h en anglais (16 I18N-003). En `pt`, date et heure sont séparées par une virgule (« 10/01/2026, 12:05 »), comme dans le CLDR pt-BR.
- **Locale par défaut** : `defaultLocale` de `config/locales.json`, aujourd'hui `es-PA` (PROPOSÉ, le pays de lancement reste ouvert, DEC-PAYS). Une région inconnue d'une langue connue (es-AR, en-GB, fr-FR, fr-CA, pt-BR, pt-PT) prend la locale par défaut si elle est de cette langue, sinon la première locale déclarée de cette langue.

## Formats attendus (tests)

| Montant              | es-PA          | es-PY          | en           | fr             | pt (pt-BR)     |
| -------------------- | -------------- | -------------- | ------------ | -------------- | -------------- |
| 123456 USD (exp. 2)  | `US$ 1.234,56` | `US$ 1.234,56` | `$1,234.56`  | `1 234,56 $US` | `US$ 1.234,56` |
| 1050000 PYG (exp. 0) | `₲ 1.050.000`  | `₲ 1.050.000`  | `₲1,050,000` | `1 050 000 ₲`  | `₲ 1.050.000`  |

En `fr`, les milliers sont séparés par une espace fine insécable (U+202F) et le symbole est précédé d'une espace insécable (U+00A0), comme dans le CLDR du français. Aucune spécification ne donne ces valeurs : les tests les comparent aussi à `Intl.NumberFormat('fr')`, que `formatMoney` n'utilise pas.

En `pt`, le symbole précède le montant, suivi d'une espace insécable (U+00A0) ; point des milliers, virgule décimale ; ₲ est le symbole étroit du CLDR. Les tests comparent à `Intl.NumberFormat('pt-BR')` et `Intl.DateTimeFormat('pt-BR')`.

Le séparateur décimal de es-PA suit 19 US-014, 16 I18N-004 et 17 §1.2, mais contredit 10b UX-16 : voir Q-001 dans `docs/team/QUESTIONS.md`. Ces formats sont des données : seul `config/locales.json` change.

## Commandes de test

`pnpm --filter @rueda/i18n test:unit` couvre :

- la parité es / en / fr / pt deux à deux (clés, pluriels, emplacements), une clé retirée de l'une des quatre langues détectée, et la détection des défauts sur fixture ;
- l'absence de chaîne d'une autre langue dans un écran rendu en français ou en portugais, et réciproquement (mot entier : « Identidad » n'est pas signalé dans « Identidade ») ;
- les pluriels français et portugais (0, 1, 2 et le repli de `many`) ;
- USD et PYG dans chaque locale, y compris au-delà de 2^53 ;
- America/Asuncion à UTC−3 sur des dates après 2024, dont les anciennes bascules d'heure d'été, et à UTC−4 en 2023 (tzdata historisée) ;
- America/Panama à UTC−5 ;
- la négociation de locale (dont `fr`, `fr-FR`, `pt`, `pt-BR` et `pt-PT` par `Accept-Language`, et `fr` / `pt` par le cookie) et la validation de la configuration.

Les fixtures `test/fixtures/currencies.json` et `test/fixtures/timezones.json` portent les devises et les fuseaux : le code n'en contient aucun.
