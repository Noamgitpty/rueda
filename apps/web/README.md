# @rueda/web

Application Next.js (App Router), mobile-first et installable (PWA, ADR-039, ADR-072) : voyageur et espace hôte, même application, en es / en / fr / pt.

## Coquille et PWA (US-048)

| Élément        | Où                                                                              | Rôle                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Marque         | `brand-source.ts` (`getRequestBrand`)                                           | nom, thème, logo : `GET /brand` (US-034) si `WEB_BRAND_API_URL`, revalidé et recompilé ici ; sinon thème embarqué (fail-closed)       |
| Coquille       | `app/(app)/layout.tsx`, `app/(app)/_shell/`                                     | lien d'évitement, en-tête en verre, choix de langue (`POST /locale`, sans JS), région live « Sin conexión » / « de nuevo en línea »   |
| Écrans         | `app/(app)/…` ; accueil `app/home-content.tsx`                                  | chaque écran rend `<main id={MAIN_ID} tabIndex={-1}>` ; `/ui` et `/lab/pwa-ios` restent hors de la coquille                           |
| Manifeste      | `/manifest.webmanifest` (`pwa/manifest.ts`)                                     | nom, description (langue de la requête), `theme_color` = `primary`, `background_color` = `surface`, icônes                            |
| Icônes         | `/icons/{icon-192,icon-512,maskable-512,apple-touch-icon}.png` (`pwa/icon.tsx`) | PNG dessinés depuis le logo et les couleurs du thème (`next/og`), versionnés par la marque                                            |
| Service worker | `/sw.js` (`pwa/sw-script.ts`), portée `/`                                       | pages réseau seulement, jamais en cache ; sans réseau, écran `/offline` avec reprise ; `/_next/static/` en cache d'abord ; prod seule |

Changer le nom, les couleurs, le logo ou les icônes : publier une version de marque (US-034, `apps/api/src/modules/cfg/internal/brand/README.md`) ou changer de palette (`packages/design-tokens/README.md`). Aucun déploiement du site n'est nécessaire avec `WEB_BRAND_API_URL`.

Contrôle à 360 px (défilement horizontal, cibles ≥ 44 px, écran hors ligne par le vrai service worker) et captures : serveur démarré (`pnpm --filter @rueda/web build` puis `start`), puis `node apps/web/scripts/shell-check.mjs http://localhost:3000`. Captures dans `docs/design/US-048/`. Outil local ; le harnais e2e Playwright de la CI reste à créer.

## Interfaces d'appareil (`device/`)

Le comptoir n'accède à l'appareil que par trois interfaces (17 §6.2, ADR-005). Point d'entrée unique : `device/index.ts`.

| Interface       | Rôle                                                                         | Adaptateur web                                     |
| --------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| `CameraCapture` | capture **en direct** dans la page, jamais d'import de galerie               | `camera-capture.web.ts` (`getUserMedia` + canevas) |
| `OfflineQueue`  | file locale chiffrée (AES-GCM, clé non exportable), empreinte, reprise       | `offline-queue.idb.ts` (IndexedDB)                 |
| `DeviceGeo`     | position + précision, chaque issue est un résultat typé (jamais d'exception) | `device-geo.ts` (`navigator.geolocation`)          |

La logique (dimensions et poids des photos, ordre de la file, empreinte SHA-256, chiffrement, vidage, erreurs de position) est testée en unitaire (`pnpm test:unit`). Un repli natif (enveloppe Capacitor, terminal fourni) ne remplacerait que les adaptateurs.

Politique de photo (TRP-002) : grand côté ≤ 1 600 px, ≤ 500 ko (500 000 octets), JPEG. Valeurs PROPOSÉ, codées dans `DEFAULT_PHOTO_POLICY` en attendant un paramètre de 17 §7.2.

## Thème (US-030)

La page reçoit dans `<head>` les variables CSS du thème actif (`theme.tsx`, paquet `@rueda/design-tokens`). Les composants n'écrivent que `var(--…)` : `pnpm lint` refuse toute couleur, police, taille, espacement, rayon, ombre ou durée en dur. Changer de palette : voir `packages/design-tokens/README.md`, « Changer de palette en 1 étape ».

## Bibliothèque de composants (US-032)

Les écrans utilisent les composants de `@rueda/ui` (voir `packages/ui/README.md`). La vitrine vivante est servie sur **`/ui`** (`?lang=`, `?theme=auto|light|dark`, `?width=mobile|full`) : ouverte en `next dev`, sinon seulement avec `WEB_UI_CATALOG_ENABLED=true`.

## Laboratoire PWA iOS (US-026)

Page de test jetable : `/lab/pwa-ios` (avec son manifeste, son service worker et ses icônes, tous sous `/lab/pwa-ios`). Protocole : [docs/qa/US-026-protocole-pwa-ios.md](../../docs/qa/US-026-protocole-pwa-ios.md).

## Variables d'environnement

| Variable                  | Défaut  | Effet                                                                                                                                                                                                                                                   |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WEB_LAB_PWA_IOS_ENABLED` | absente | `true` (exactement) ouvre le laboratoire US-026. Toute autre valeur, ou l'absence : la page, le manifeste, le service worker et les icônes répondent **404**. Lue à chaque requête côté serveur (pas de `NEXT_PUBLIC_`), donc rien n'est figé au build. |
| `WEB_UI_CATALOG_ENABLED`  | absente | `true` (exactement) ouvre la vitrine `/ui` (US-032) hors développement, pour la préproduction. Sinon : **404** (toujours ouverte avec `next dev`). Page `noindex`, lue à chaque requête. Ne pas définir en production.                                  |
| `THEME_PALETTE`           | absente | Palette du thème (US-030), par exemple `lienzo-azur`. Absente : `packages/design-tokens/config/theme.json` (Lienzo · Tinta). Inconnue : erreur au rendu (fail-closed). Lue à chaque requête, comme le back-office.                                      |
| `WEB_BRAND_API_URL`       | absente | URL interne de l'API (US-034), par exemple `http://api:3001`. Définie : nom, thème et logo viennent de `GET /brand` (cache 30 s, délai 1,5 s, revalidés) ; panne ou réponse invalide : thème embarqué. http(s) sans identifiants, sinon ignorée.        |
| `THEME_COLOR_SCHEME`      | absente | `auto` (défaut : clair ou sombre selon l'appareil), `light` ou `dark`.                                                                                                                                                                                  |

- **Ne jamais définir `WEB_LAB_PWA_IOS_ENABLED` en production.** Seulement en local ou en préproduction, le temps de la campagne de test. Recommandation pour US-003 : un contrôle de déploiement qui refuse cette variable dans l'environnement de production.
- Couper le drapeau suffit à retirer le laboratoire : le service worker déjà installé sur un téléphone reçoit un 404 à sa prochaine vérification et le navigateur le désinscrit.

Démarrer le laboratoire en local (PowerShell, depuis la racine du dépôt) :

```powershell
pnpm --filter @rueda/web build
$env:WEB_LAB_PWA_IOS_ENABLED = 'true'; pnpm --filter @rueda/web start
```
