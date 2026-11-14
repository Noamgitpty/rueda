# CFG — socle de marque modifiable (US-034)

Le thème (nom, palette, polices, logo, icônes) et les textes non juridiques sont des **données versionnées** en base, publiables et réversibles sans déploiement (DEC-FONDATEUR-07, 17 §3.2.13, ADR-036, ADR-067). Aucune couleur ni police n'est écrite dans le code : le thème est un document DTCG, au format des palettes US-028.

## Responsabilité et entités

| Entité (17 §3.2.13)          | Table (`core`)         | Rôle                                                                                     |
| ---------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| `brand_version`              | `config_brand_version` | thème versionné : `DRAFT` → `PUBLISHED` → `ARCHIVED` ; une seule publiée ; jamais écrasé |
| `brand_asset` + `file_asset` | `config_brand_asset`   | logo, favicon, icône PWA, image d'accueil, police ; fichier en bucket public `BRAND`     |
| `content_block`              | `config_content_block` | texte par clé, langue (es, en, fr, pt ensemble) et pays ; textes juridiques refusés      |

Migration `packages/db/migrations/0042_config_brand.sql` ; commandes `core.cfg_brand_*` et `core.cfg_content_*` (SECURITY DEFINER, `iam_staff_owner`, EXECUTE au seul `app_api`).

## Changer le design

| Besoin                       | Requête (console, session élevée par TOTP, rôle ADMIN de tous les pays)                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Revenir à une palette US-028 | `POST /console/brand/drafts` `{ requestId, brandName, fromPalette: "lienzo-grafito" }`, puis publier                                                                                                    |
| Retoucher ou design neuf     | `POST /console/brand/drafts` `{ requestId, brandName, tokens: { …document DTCG complet… } }`, puis publier                                                                                              |
| Publier                      | `POST /console/brand/versions/:id/publish` `{ requestId }`                                                                                                                                              |
| Retour arrière en un clic    | `POST /console/brand/rollback` `{ requestId }` (vers la version publiée précédente ; `targetVersionId` facultatif)                                                                                      |
| Historique, prévisualisation | `GET /console/brand/versions`, `GET /console/brand/versions/:id` (brouillons compris)                                                                                                                   |
| Logo, icônes, police         | `POST /console/brand/assets` `{ requestId, kind, contentBase64, alt: { es, en, fr }, licenseNote }`                                                                                                     |
| Texte de l'accueil, FAQ      | `POST /console/content/drafts` `{ requestId, key, country?, bodies: { es, en, fr } }`, puis `/console/content/publish` `{ requestId, key, country?, versionNo }` ; retour : `/console/content/rollback` |

Contrôles avant toute écriture : format des jetons (`BRAND_TOKENS_INVALID`), polices approuvées (`FONT_NOT_APPROVED`), contraste WCAG 2.2 AA par **le contrôle d'US-030** (`checkContrast` de `@rueda/design-tokens`, réutilisé) à la publication et au retour arrière (`BRAND_CONTRAST_INSUFFICIENT`, chaque paire en cause dans `details.failures`). Chaque publication, retour arrière et refus est journalisé dans la chaîne d'audit (US-009).

## Blocs de contenu éditables (US-121, ADR-095)

- **Registre** : seules les clés de `EDITABLE_BLOCKS` (`@rueda/i18n`, `packages/i18n/src/editable-blocks.ts`) sont éditables et servies ; chacune remplace un texte du catalogue livré (`catalogKey`) avec un format (`plain` : une ligne ; `rich` : paragraphes, listes, gras, italique, liens internes) et une longueur maximale. Clé hors registre : `CONTENT_KEY_NOT_EDITABLE` (422). Rendre un texte éditable : une ligne du registre (le test du registre vérifie la clé du catalogue dans les quatre langues).
- **Textes juridiques** (CGU, contrat, politique d'annulation, confidentialité, assurance…, motif `LEGAL_BLOCK_KEY`) : `CONTENT_KEY_FORBIDDEN` ; la base refuse aussi et journalise la tentative (`CONTENT_KEY_REFUSED`, migration 0062).
- **Assainissement** : chaque corps passe la liste blanche de son format (`richTextProblem`) en plus des règles de 0042 (`CONTENT_MARKDOWN_FORBIDDEN`) ; `GET /brand/content` sert l'arbre fermé (`doc`) de chaque bloc, jamais du HTML ; un corps publié devenu hors règles n'est pas servi.
- **Signalement** : `GET /console/content/gaps` (`brand.edit`, ADMIN de tous les pays) : blocs publiés sans une langue, corps hors règles, clés hors registre. Le site affiche alors le texte du catalogue livré dans la langue de la page (`apps/web/content-source.ts`).

| Changer un texte de l'accueil   | Requête (console, session élevée)                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Brouillon dans les 4 langues    | `POST /console/content/drafts` `{ requestId, key: "home.hero.title", country?, bodies: { es, en, fr, pt } }` |
| Publier (visible en 30 s)       | `POST /console/content/publish` `{ requestId, key, country?, versionNo }`                                    |
| Revenir à la version précédente | `POST /console/content/rollback` `{ requestId, key, country? }`                                              |
| Voir ce qui manque              | `GET /console/content/gaps`                                                                                  |

## Lecture publique (sans session)

`GET /brand` (version publiée : jetons, feuille de style prête `css`, actifs ; ETag, 304 ; 503 `BRAND_VERSION_UNAVAILABLE` s'il n'y en a pas, le client garde le thème embarqué), `GET /brand/content?locale=es|en|fr|pt&country=XX` (blocs du registre seulement, avec leur arbre assaini `doc` ; bloc du pays prioritaire, repli `es` signalé par `fallback`), `GET /brand/assets/:id`. Cache vidé à chaque publication de l'instance, borné à `readCacheTtlSeconds` ailleurs.

## Paramètres

`../../data/brand.json` (PROPOSÉS, validés au démarrage, `CONFIG_INVALID` sinon) : `approvedFonts` (famille et licence ; au départ toutes les polices des palettes US-028), `readCacheTtlSeconds` (30, au plus 60), `assetMaxBytes` (65 536 : la limite JSON de l'API borne aussi le téléversement en base64). Ajouter une police : vérifier sa licence, l'inscrire, demande de fusion.

## Écran et contrôles d'US-120 (ADR-116)

- L'écran « Apparence et marque » du back-office (`apps/backoffice/app/brand/`) appelle ces routes.
- **Antivirus des actifs** : port `BrandScanner` (`BrandOptions.scanner`), après la taille et le type réel, avant toute écriture. Panne ou délai : `503 BRAND_ASSET_UNAVAILABLE` (`reason: SCAN`) ; verdict autre que `CLEAN` ou type détecté différent : `422 BRAND_ASSET_INVALID` (`reason: SCAN`). Production : `UnavailableBrandScanner` (DEC-FONDATEUR-20, fail-closed) ; tests : `FakeUploadScanner`.
- **Logo SVG** (jetons `brand.logo`, `brand.logoDark`, `brand.logoMono`) : `logoProblems` de `@rueda/design-tokens` à l'enregistrement d'un brouillon (`BRAND_TOKENS_INVALID` nommant le jeton).

## Ports

- `BrandStore` / `PgBrandStore` (`store.ts`) : un appel de commande = une instruction en autocommit (ADR-056).
- `BrandScanner` (`brand.service.ts`) : antivirus des actifs ; `UnavailableBrandScanner` en production.
- `BrandFileStore` (`brand.service.ts`) : création seule ; FAKE `InMemoryFileStore` en test ; `UnavailableBrandFileStore` en production tant qu'US-003 n'a pas livré le stockage objet.

## Événements

Aucun en Bêta (cache invalidé localement, borné entre instances). Piste : `config.brand.published` par l'outbox.

## Tests

```bash
pnpm --filter @rueda/api test:unit            # brand.test.ts : contrôles, services, cache, HTTP ; content-blocks.test.ts (US-121)
pnpm --filter @rueda/api test:int             # pg-brand-store.int.test.ts : bout en bout, PostgreSQL réel
pnpm --filter @rueda/db test:l0               # l0-brand.test.ts : RLS, gardes, concurrence, refus journalisés
```
