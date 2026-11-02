# @rueda/web

Application Next.js (App Router), mobile-first : guest, console agence, comptoir (PWA, ADR-039).

## Interfaces d'appareil (`device/`)

Le comptoir n'accède à l'appareil que par trois interfaces (17 §6.2, ADR-005). Point d'entrée unique : `device/index.ts`.

| Interface       | Rôle                                                                         | Adaptateur web                                     |
| --------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| `CameraCapture` | capture **en direct** dans la page, jamais d'import de galerie               | `camera-capture.web.ts` (`getUserMedia` + canevas) |
| `OfflineQueue`  | file locale chiffrée (AES-GCM, clé non exportable), empreinte, reprise       | `offline-queue.idb.ts` (IndexedDB)                 |
| `DeviceGeo`     | position + précision, chaque issue est un résultat typé (jamais d'exception) | `device-geo.ts` (`navigator.geolocation`)          |

La logique (dimensions et poids des photos, ordre de la file, empreinte SHA-256, chiffrement, vidage, erreurs de position) est testée en unitaire (`pnpm test:unit`). Un repli natif (enveloppe Capacitor, terminal fourni) ne remplacerait que les adaptateurs.

Politique de photo (TRP-002) : grand côté ≤ 1 600 px, ≤ 500 ko (500 000 octets), JPEG. Valeurs PROPOSÉ, codées dans `DEFAULT_PHOTO_POLICY` en attendant un paramètre de 17 §7.2.

## Laboratoire PWA iOS (US-026)

Page de test jetable : `/lab/pwa-ios` (avec son manifeste, son service worker et ses icônes, tous sous `/lab/pwa-ios`). Protocole : [docs/qa/US-026-protocole-pwa-ios.md](../../docs/qa/US-026-protocole-pwa-ios.md).

## Variables d'environnement

| Variable                  | Défaut  | Effet                                                                                                                                                                                                                                                   |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WEB_LAB_PWA_IOS_ENABLED` | absente | `true` (exactement) ouvre le laboratoire US-026. Toute autre valeur, ou l'absence : la page, le manifeste, le service worker et les icônes répondent **404**. Lue à chaque requête côté serveur (pas de `NEXT_PUBLIC_`), donc rien n'est figé au build. |

- **Ne jamais définir `WEB_LAB_PWA_IOS_ENABLED` en production.** Seulement en local ou en préproduction, le temps de la campagne de test. Recommandation pour US-003 : un contrôle de déploiement qui refuse cette variable dans l'environnement de production.
- Couper le drapeau suffit à retirer le laboratoire : le service worker déjà installé sur un téléphone reçoit un 404 à sa prochaine vérification et le navigateur le désinscrit.

Démarrer le laboratoire en local (PowerShell, depuis la racine du dépôt) :

```powershell
pnpm --filter @rueda/web build
$env:WEB_LAB_PWA_IOS_ENABLED = 'true'; pnpm --filter @rueda/web start
```
