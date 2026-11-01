# rueda (nom de code interne)

Place de marché de location de voitures pour le Panama et le Paraguay. Nom de marque : non choisi (DEC-MARQUE) ; les applications affichent le provisoire `{brand_name}`.

Monorepo **pnpm + Turborepo**, TypeScript de bout en bout : back-end NestJS en monolithe modulaire (`apps/api`, API + travailleur pg-boss), front Next.js (`apps/web` : guest, console agence, comptoir ; `apps/backoffice` : back-office interne), PostgreSQL ([ADR-001](docs/adr/ADR-001-monolithe-modulaire.md)).

## Démarrer

Prérequis : Node.js 26.13 et pnpm 10.34.9 en tête du `PATH` ([ADR-041](docs/adr/ADR-041-chaine-outils-node-pnpm.md)).

```bash
pnpm install --frozen-lockfile
pnpm lint          # ESLint (frontières de modules, horloge SQL) + contrôle des fichiers .sql
pnpm typecheck
pnpm test:unit
pnpm build
pnpm format
pnpm test:int      # réservé (US-005)
pnpm test:l0       # réservé (US-005)
```

## Documentation

- Conventions (branches, worktrees, commits, modules, SQL, nommage, codes d'erreur, cycle de story) : [CONTRIBUTING.md](CONTRIBUTING.md)
- Point d'entrée du développement : [docs/specs/CLAUDE_BUILD_HANDOFF.md](docs/specs/CLAUDE_BUILD_HANDOFF.md)
- Spécification (instantané figé, ne pas modifier hors demande de fusion approuvée) : `docs/specs/`
- Décisions d'architecture : [docs/adr/](docs/adr/)
- État du projet : `docs/team/RESUME_HERE.md` (créé par US-029)
