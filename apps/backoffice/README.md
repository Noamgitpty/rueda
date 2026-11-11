# @rueda/backoffice — console interne

Application Next.js (App Router) séparée, sur un **domaine distinct** de l'application voyageur (17 §6.1). Quadrilingue es / en / fr / pt-BR (`@rueda/i18n`, une vue = une langue). Mise en forme uniquement par les jetons de design (`@rueda/design-tokens`), composants de `@rueda/ui`.

## Console (US-012, ADR-062)

`app/console/` contient trois fichiers :

- `view.tsx` : écrans de présentation pure, testés dans chaque locale ;
- `console-client.tsx` : enchaînement côté navigateur ;
- `api.ts` : appels à l'API et choix de l'écran.

Parcours : connexion (mot de passe), puis enrôlement TOTP avec le code d'activation remis hors bande par un administrateur, ou saisie du code TOTP, puis console. La console montre les rôles et leurs pays, l'action motivée et le journal. Depuis US-101 (ADR-091), les actions sont groupées comme 19 US-101 (changer un état, enregistrer seulement avec pièces, décisions FINANCE à deux personnes) ; le champ des pièces reçoit les identifiants des fichiers déjà reçus ; aucun champ de montant. FINANCE et ADMIN voient les demandes FINANCE en attente et les approuvent en seconde personne (la base refuse le demandeur). Un compte staff sans TOTP ne voit qu'un refus. L'API et la base restent seules juges (session, MFA, rôles, portée pays, journal).

| Variable        | Rôle                                                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUEDA_API_URL` | URL de l'API ; `/api/*` y est réécrit (mandataire de même origine, le cookie `__Host-session` reste lié au domaine du back-office). Absente : aucune réécriture, la console ne peut rien faire. |

Commandes : `pnpm --filter @rueda/backoffice test:unit`, `pnpm --filter @rueda/backoffice build`.
