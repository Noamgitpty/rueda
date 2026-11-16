lot: L0
module: Site web (e2e)

- Corrigé : `host-calendar.spec.ts` (US-119) et `host-trips.spec.ts` (US-219) n'étaient lancés par aucun projet Playwright ; ils tournent désormais sur `mobile-360` et `mobile-390` (US-041)
- Corrigé : le parcours A05 « trip inconnu » d'US-219 visait aussi l'écran de chargement encore présent dans la page (deux `main h1`) ; il vise l'écran prêt, comme `host-listings.spec.ts` (US-041)
- Ajouté : garde-fou `apps/web/e2e-projects.test.ts`, qui échoue si un parcours de `e2e/` n'est lancé par aucun projet (US-041)
