# Revue architecture — US-118 « e2e A10 stable » (PR n° 170) — 2026-11-15

Relecteur : revue-architecture / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5)
Entrées : da4c5c78..fd5ba63d

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MINEUR  | Cause traitée à la racine : l'envoi du prix n'était jamais attendu (l'URL portait déjà `saved=1`), puis React réinitialisait le formulaire à la valeur relue. `submitAndSettle` attend la réponse du serveur puis la levée d'`aria-busy`, sans `sleep`, délai relevé, nouvel essai, assertion retirée ni comportement déplacé ; `networkidle` retiré car sans effet sur un document inchangé. |
| 2   | MINEUR  | L'assistant est à sa place (`e2e/fixtures.ts`), documenté, typé (`Locator`, `Page`) et réutilisé par A10 et A06 ; il dépend de `aria-busy` du bouton `@rueda/ui` (levé par `loading`) et de l'en-tête `next-action` : couplage assumé et écrit dans son commentaire. Aucun fichier du site, de `.github/`, `scripts/` ni de `docs/specs/` touché ; exemption de changelog motivée.            |

Verdict : APPROUVÉ
