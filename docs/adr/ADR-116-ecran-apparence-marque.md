# ADR-116 — Écran « Apparence / Marque » : aperçu porté par un attribut, logo SVG borné, antivirus des actifs

- **Statut** : PROPOSÉ (US-120, agent front-end, claude-opus-5-5, 2026-11-13). Revues exigées par `review-requirements.json` : code, sécurité, ux (story), sur un autre modèle que l'auteur. Numéro réservé par l'orchestrateur.
- **Sources** : 19 US-120 ; 10b §8 écran O02, §3.10 (WCAG 2.2 AA), UX-49, UX-50, UX-68 ; DEC-FONDATEUR-07 (le fondateur change le design quand il veut), DEC-FONDATEUR-20 (antivirus ClamAV, fail-closed) ; ADR-036, ADR-047, ADR-067 (socle de marque, US-034), ADR-095 (blocs de contenu, US-121) ; BOARD N-30, N-46.

## Contexte

US-034 a livré les commandes de marque (brouillon, publication sous contrôle de contraste, retour arrière journalisé, actifs) et US-121 les blocs de contenu. Il manquait l'outil du fondateur : un écran du back-office pour changer nom, palette, polices, logo, images et textes de l'accueil, avec un aperçu en direct qui ne touche pas la production.

## Décision

1. **Route dédiée `/brand` du back-office**, réservée à une session élevée par TOTP d'un `ADMIN` (lien depuis la console). L'écran ne fait que choisir l'affichage : l'API et la base restent seules juges (`brand.edit`, `brand.publish`, portée de tous les pays) et journalisent publication, retour arrière et refus.
2. **Brouillon = document DTCG complet**, construit dans le navigateur : point de départ (version existante ou palette US-028) plus retouches (nom, 8 couleurs sémantiques par mode, polices des titres et du texte, logo clair et sombre). Bêta SIMPLIFIÉ : pas de surcharge par pays, pas d'habillage WhatsApp (US-538). Les polices proposées sont celles des palettes (liste approuvée de départ d'US-034) ; l'API refuse toute autre (`FONT_NOT_APPROVED`).
3. **Contrôles d'US-030 réutilisés, jamais recopiés** : `buildTheme` et `checkContrast` tournent dans la console pour l'aperçu et l'alerte (paires sous le seuil listées, palettes en échec signalées dans le choix du point de départ, par exemple Lienzo · Azur, `primary / glass` 3,89:1). La publication reste jugée par l'API ; son refus `BRAND_CONTRAST_INSUFFICIENT` affiche chaque paire (`details.failures`).
4. **Aperçu porté par un attribut** (`previewStyleSheet` de `@rueda/design-tokens`) : mêmes variables que `themeStyleSheet`, posées sur `[data-brand-preview="light|dark"]` et non sur `:root` ; le thème de la page et la production ne changent pas. Cadres S01, S03, S05, A02 et e-mail, maquettes faites des composants de `@rueda/ui`, en clair ou sombre, mobile ou bureau ; cadres `inert`, sans titre HTML. Valeurs issues de `buildTheme` (aucun `<`, `;` ni accolade), attribut contrôlé : la feuille est injectée telle quelle.
5. **Logo = jeton SVG borné** (`brand.logo`, `brand.logoDark`, `brand.logoMono`) : `logoProblem` / `logoProblems` (`@rueda/design-tokens`) refusent, à l'API (`BRAND_TOKENS_INVALID`) et dans la console, un SVG de plus de 20 000 caractères, sans racine `<svg>` unique, ou contenant script, gestionnaire `on…=`, `foreignObject`, DTD ou entité, CDATA, instruction de traitement, `javascript:` ou `data:`, lien ou `url()` hors `#`, `@import`, `image`, `iframe`, `embed`, `object`, `audio`, `video`, `animate`, `set`. Liste de refus documentée : un SVG hors règles est refusé, jamais « nettoyé ». Le logo n'est jamais injecté : le site et la console l'affichent en `<img src="data:image/svg+xml,…">` (un script de SVG en image ne s'exécute pas).
6. **Antivirus des actifs** (port `BrandScanner` de `BrandOptions`, même forme que `UploadScanner` d'AUD) : après la taille, le type réel lu dans les octets et la commande de la base (qui juge droits, TOTP et portée : un rôle sans droit reçoit 403 sans que l'antivirus soit consulté), et **avant le dépôt** : aucun octet n'est stocké ni servi sans verdict `CLEAN`. La ligne `file_asset` d'un fichier refusé reste sans objet déposé, comme après une panne du stockage (jamais servie). Panne ou délai : `503 BRAND_ASSET_UNAVAILABLE` (`reason: SCAN`) ; verdict autre que `CLEAN` ou type détecté différent du type réel : `422 BRAND_ASSET_INVALID` (`reason: SCAN`). Production : `UnavailableBrandScanner` tant que l'adaptateur ClamAV n'est pas livré (fail-closed : aucun actif n'entre). Une police WOFF2 n'est acceptée que si l'antivirus la reconnaît comme telle.
7. **CSP (N-30, partie `img-src`)** : aucune image de marque n'est servie depuis une autre origine. Le logo est un `data:` d'un jeton validé ; les actifs (`GET /brand/assets/:id`) ne sont pas encore servis au site (stockage indisponible tant qu'US-003). `img-src 'self' data: blob:` (site) et `'self' data:` (back-office) restent donc suffisants ; à revoir quand le stockage objet servira des actifs depuis son domaine. `form-action` et le nonce restent ouverts (N-30, lot C et middleware).
8. **Refus de texte expliqués (N-46)** : `legalTrigger` cite le mot qui fait d'une clé un texte juridique (motif `LEGAL_BLOCK_KEY`, le même qu'à l'API et en base) ; `bodyIssue` classe un corps refusé par `richTextProblem` (ZWJ, vide, trop long, autre format) et l'écran explique, dans les quatre langues, que les émojis composés (U+200D) ne passent pas.

## Conséquences

- Le fondateur change le design et les textes de l'accueil seul ; rien n'est visible sur le site avant « Publier » ; le retour arrière est un bouton.
- La capture de régression visuelle de la console change (lien « Apparence et marque » pour un ADMIN) et l'écran `/brand` a ses propres références (`console-apparence`).
- Aucune migration, aucun paramètre nouveau. `assetMaxBytes` (64 Kio) reste la borne des images ; une route de téléversement dédiée reste à faire pour de plus grandes images d'accueil (report d'US-034).

## Alternatives écartées

- **Aperçu dans un `<iframe>` du site** : demandait une route d'aperçu non publiée côté site (jeton de brouillon, nouvelle surface d'attaque) et une CSP `frame-src` ; écarté pour la Bêta.
- **Nettoyer le SVG** (retirer les éléments interdits) : un nettoyeur est une source de contournements ; refuser est plus simple et vérifiable.
- **Antivirus optionnel avec repli « accepté »** : contraire à DEC-FONDATEUR-20.
