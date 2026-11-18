lot: L0
module: Équipe et CI

- Sécurité : `next` 16.4.2 → 16.4.5 dans `apps/web` et `apps/backoffice` (GHSA-mfr8-8qww-v76h et GHSA-vc7v-qv4w-wrv8, modérés, fuites du cache `'use cache'` entre _root params_, fonctionnalité non utilisée par le site) ; origine du `SecurityFatalError` de `next build` sous agent documentée dans `docs/ops/CI.md` (US-001, US-002)
