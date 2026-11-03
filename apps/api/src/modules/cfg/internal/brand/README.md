# CFG — socle de marque modifiable (US-034)

Le thème (nom, palette, polices, logo, icônes) et les textes non juridiques sont des **données versionnées** en base, publiables et réversibles sans déploiement (DEC-FONDATEUR-07, 17 §3.2.13, ADR-036, ADR-067). Aucune couleur ni police n'est écrite dans le code : le thème est un document DTCG, au format des palettes US-028.

## Responsabilité et entités

| Entité (17 §3.2.13)          | Table (`core`)         | Rôle                                                                                     |
| ---------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| `brand_version`              | `config_brand_version` | thème versionné : `DRAFT` → `PUBLISHED` → `ARCHIVED` ; une seule publiée ; jamais écrasé |
| `brand_asset` + `file_asset` | `config_brand_asset`   | logo, favicon, icône PWA, image d'accueil, police ; fichier en bucket public `BRAND`     |
| `content_block`              | `config_content_block` | texte par clé, langue (es, en, fr ensemble) et pays ; `legal.*` refusé                   |

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

## Lecture publique (sans session)

`GET /brand` (version publiée : jetons, feuille de style prête `css`, actifs ; ETag, 304 ; 503 `BRAND_VERSION_UNAVAILABLE` s'il n'y en a pas, le client garde le thème embarqué), `GET /brand/content?locale=es|en|fr&country=XX` (bloc du pays prioritaire, repli `es` signalé par `fallback`), `GET /brand/assets/:id`. Cache vidé à chaque publication de l'instance, borné à `readCacheTtlSeconds` ailleurs.

## Paramètres

`../../data/brand.json` (PROPOSÉS, validés au démarrage, `CONFIG_INVALID` sinon) : `approvedFonts` (famille et licence ; au départ toutes les polices des palettes US-028), `readCacheTtlSeconds` (30, au plus 60), `assetMaxBytes` (65 536 : la limite JSON de l'API borne aussi le téléversement en base64). Ajouter une police : vérifier sa licence, l'inscrire, demande de fusion.

## Ports

- `BrandStore` / `PgBrandStore` (`store.ts`) : un appel de commande = une instruction en autocommit (ADR-056).
- `BrandFileStore` (`brand.service.ts`) : création seule ; FAKE `InMemoryFileStore` en test ; `UnavailableBrandFileStore` en production tant qu'US-003 n'a pas livré le stockage objet.

## Événements

Aucun en Bêta (cache invalidé localement, borné entre instances). Piste : `config.brand.published` par l'outbox.

## Tests

```bash
pnpm --filter @rueda/api test:unit            # brand.test.ts : contrôles, services, cache, HTTP
pnpm --filter @rueda/api test:int             # pg-brand-store.int.test.ts : bout en bout, PostgreSQL réel
pnpm --filter @rueda/db test:l0               # l0-brand.test.ts : RLS, gardes, concurrence, refus journalisés
```
