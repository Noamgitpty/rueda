# ADR-072 — Coquille web mobile-first, PWA installable et marque lue depuis `GET /brand`

- **Statut** : PROPOSÉ (US-048, agent front-end, claude-opus-5-5, 2026-11-03). Revues exigées : code et UX / design (Revue design : OUI), sur un autre modèle que l'auteur. À reporter dans 17 §8.1.
- **Sources** : 19 US-048 ; 10b §3.1 (UX-01 à UX-05), §3.2, §3.10 (UX-46 à UX-50), §4.1 (états communs : « hors ligne ») ; 17 §6.2, ADR-005, ADR-039 (« manifeste et icônes générés depuis la version de marque publiée ») ; ADR-047 (thème), ADR-067 (marque versionnée), ADR-071 (quatre langues) ; DEC-NATIVE (pas d'application native avant P2).

## Contexte

Le site n'avait ni coquille (en-tête, choix de langue, état hors ligne), ni manifeste, ni service worker hors du laboratoire jetable d'US-026. Son nom affiché était le paramètre brut `{brand_name}`. US-034 publie la marque en base (`GET /brand`), mais le site lisait encore la palette embarquée (report inscrit dans `RESUME_HERE.md`). Le fondateur veut un design révisable à tout moment, sans couleur ni police en dur.

## Décision

1. **Source de la marque unique : `apps/web/brand-source.ts`.** `getRequestBrand()` rend nom, thème compilé, logo et version. Si `WEB_BRAND_API_URL` est définie, elle lit `GET /brand` (délai 1,5 s, cache mémoire 30 s comme `readCacheTtlSeconds` d'US-034). Le document de jetons reçu est **revalidé** (format puis contraste AA, contrôles d'US-030) et la feuille est **recompilée localement** : le CSS servi par l'API n'est jamais réinjecté. Toute panne, 503 `BRAND_VERSION_UNAVAILABLE`, réponse invalide ou contraste insuffisant : **thème embarqué** (fail-closed : jamais de page sans thème validé). Sans variable : thème embarqué, nom lu dans le groupe `brand` de la palette (Kmino aujourd'hui). La mise en page, le manifeste, les icônes et le service worker passent tous par cette fonction ; `brand.ts` (`{brand_name}` en dur) est supprimé.
2. **Logo affiché en image seulement** (`<img src="data:image/svg+xml…">`) : un SVG publié par la console n'est jamais injecté dans le DOM (aucun script possible).
3. **Manifeste dynamique** `/manifest.webmanifest` : nom et nom court = marque, description dans la langue de la requête, `theme_color` = `primary`, `background_color` = `surface` (mode clair), `display: standalone`, portée `/`. Icônes PNG **dessinées depuis la marque** par `next/og` (`/icons/icon-192.png`, `icon-512.png`, `maskable-512.png` à fond plein et logo dans la zone sûre de 80 %, `apple-touch-icon.png` 180 px), adresses suffixées par la version de la marque : une nouvelle marque publiée change les icônes sans déploiement. Couleur de la barre du système (`theme-color`) en clair et en sombre.
4. **Service worker minimal** `/sw.js`, portée `/`, enregistré seulement en build de production et en contexte sûr :
   - pages : **réseau seulement**, jamais mises en cache (elles porteront des données personnelles) ; sans réseau, l'écran `/offline` pré-chargé est rendu à la place, avec reprise (lien qui fonctionne sans JavaScript, rechargement automatique au retour du réseau) ;
   - `/_next/static/` (fichiers nommés par empreinte) : cache d'abord ;
   - l'écran hors ligne et ses fichiers sont pré-chargés à l'installation, puis rechargés quand la langue de la page change (message `shell-locale`) ;
   - la version de la marque est écrite dans le script : nouvelle marque = nouveau script = ancien cache purgé (seuls les caches `shell-*` ; celui du laboratoire est laissé).
     Le contenu critique en cache après confirmation (UX-06) et la file des photos hors ligne (US-524) viendront par `device/OfflineQueue`, sans changer ce choix.
5. **Groupe de routes `app/(app)/`** : la coquille (`AppShell` : lien d'évitement, en-tête collant en verre, choix de langue sans JavaScript par `POST /locale`, région live du réseau) n'enveloppe que les écrans du produit ; `/ui` et `/lab/pwa-ios` restent nus. Chaque écran rend son propre `<main id="contenido">` (cible du lien d'évitement) ; l'accueil reste à `app/home-content.tsx` et `app/home.module.css`, chemins lus par les preuves par mutation du lint de `@rueda/design-tokens`.
6. **Aucune invitation à installer** dans la coquille : UX-03 la réserve à l'après-réservation (voyageur) ou à la première voiture publiée (hôte), stories des lots 2 et 1.
7. **Composants d'application** (`app/(app)/_shell/`) composés uniquement de `@rueda/ui` (`Banner`, `Icon`, `ButtonLink`, `CarIllustration`) et de jetons ; `packages/ui/` n'est pas modifié (propriété US-032 / US-033). À promouvoir dans la bibliothèque par l'agent design si la revue UX le demande.

## Conséquences

- Android est couvert par la PWA (DEC-NATIVE) : Chrome ne signale aucune erreur d'installabilité (`Page.getInstallabilityErrors` vide, vérifié en local). iOS : `apple-touch-icon`, `apple-mobile-web-app-title` et manifeste ; Next 16 n'émet plus `apple-mobile-web-app-capable` (iOS 16.4+ lit `display` du manifeste). Campagne sur appareils réels : protocole US-026, en préproduction HTTPS (US-003).
- `WEB_BRAND_API_URL` est une adresse interne (serveur à serveur) ; à définir par US-003. Absente, rien ne change pour l'utilisateur.
- Le cache de 30 s est par instance ; une publication apparaît au plus 30 s plus tard sur le site.
- Retour arrière : retirer le groupe `(app)`, les routes `manifest.webmanifest`, `sw.js`, `icons` et `offline`. Un service worker déjà installé reçoit alors 404 à sa prochaine vérification et le navigateur le désinscrit.
