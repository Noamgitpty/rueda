# @rueda/backoffice — console interne

Application Next.js (App Router) séparée, sur un **domaine distinct** de l'application voyageur (17 §6.1). Quadrilingue es / en / fr / pt-BR (`@rueda/i18n`, une vue = une langue). Mise en forme uniquement par les jetons de design (`@rueda/design-tokens`), composants de `@rueda/ui`.

## Console (US-012, ADR-062)

`app/console/` contient trois fichiers :

- `view.tsx` : écrans de présentation pure, testés dans chaque locale ;
- `console-client.tsx` : enchaînement côté navigateur ;
- `api.ts` : appels à l'API et choix de l'écran.

Parcours : connexion (mot de passe), puis enrôlement TOTP avec le code d'activation remis hors bande par un administrateur, ou saisie du code TOTP, puis console. La console montre les rôles et leurs pays, l'action motivée et le journal. Depuis US-101 (ADR-092), les actions sont groupées comme 19 US-101 (changer un état, enregistrer seulement avec pièces, décisions FINANCE à deux personnes) ; le champ des pièces reçoit les identifiants des fichiers déjà reçus ; aucun champ de montant. FINANCE et ADMIN voient les demandes FINANCE en attente et les approuvent en seconde personne (la base refuse le demandeur). Un compte staff sans TOTP ne voit qu'un refus. L'API et la base restent seules juges (session, MFA, rôles, portée pays, journal). Depuis US-109 (ADR-097, écran O01) : files de revue avec le retard signalé et la prise en charge (OPS, ADMIN), dossier KYC ouvert depuis un élément de la file KYC pris par l'agent, fiche 360° (recherche par e-mail ou identifiant, motif de consultation journalisé ; statut KYC sans pièce, restrictions, comptes d'hôte fermés à la réservation, trips, dossiers, notes internes), restriction et levée motivées, ouverture et résolution d'un dossier, ajout d'une pièce (fichier lu dans le navigateur, envoyé en base64 ; contrôles et antivirus côté API). Composants dans `app/console/ops-view.tsx` ; quatre langues.

| Variable        | Rôle                                                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUEDA_API_URL` | URL de l'API ; `/api/*` y est réécrit (mandataire de même origine, le cookie `__Host-session` reste lié au domaine du back-office). Absente : aucune réécriture, la console ne peut rien faire. |

## Apparence et marque (US-120, ADR-116, écran O02)

`app/brand/` : route `/brand`, lien « Apparence et marque » dans la console pour un `ADMIN` à session élevée (l'API reste seule juge des droits `brand.edit` / `brand.publish`).

- `brand-view.tsx` (présentation pure), `brand-client.tsx` (appels à `/api/console/brand/*`, `/api/console/content/*`, `/api/brand/content`), `brand-logic.ts` (brouillon, contrôles, refus expliqués), `preview.tsx` (aperçu).
- Historique des versions, publication d'un brouillon (refus `BRAND_CONTRAST_INSUFFICIENT` : chaque paire affichée), retour arrière en un clic (journalisé par la base).
- Nouveau brouillon : point de départ (version ou palette US-028, palettes sous le contraste signalées), nom, 8 couleurs par mode, polices de la liste approuvée, logo SVG clair et sombre (refusé hors de la liste blanche d'éléments et d'attributs : script, gestionnaire, lien, ressource externe, espace de noms, entité ; `logoProblem`, ADR-122).
- Aperçu en direct de S01, S03, S05, A02 et d'un e-mail, en clair ou sombre, mobile ou bureau : variables du brouillon posées sur `[data-brand-preview]` (`previewStyleSheet`), jamais sur `:root` ; rien n'est publié.
- Images de marque (PNG, JPEG, WebP, 64 Kio au plus, texte alternatif en quatre langues) : antivirus côté API, fail-closed.
- Textes de l'accueil (registre d'US-121), quatre langues ensemble ; refus expliqués (mot d'un texte juridique cité, émojis composés ZWJ).

Commandes : `pnpm --filter @rueda/backoffice test:unit`, `pnpm --filter @rueda/backoffice build`.
