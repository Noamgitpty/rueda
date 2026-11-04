-- Surcouche de DÉVELOPPEMENT LOCAL (US-035, ADR-070 ; mécanisme d'US-003, ADR-078) : appliquée
-- seulement par `packages/db/src/dev/setup.ts` (pile `compose.yaml`), sous `migrator`, APRÈS les
-- migrations de production. JAMAIS appliquée en préproduction ni en production : le job de
-- déploiement (`packages/db/src/deploy/`) déclare `preproduction` ou `production`, et `setup.ts`
-- refuse de tourner hors `RUEDA_ENV=development`.
--
-- Non suivie dans `platform.schema_migration` (comme l'amorçage) : rejouée à chaque passage, donc
-- idempotente (`platform.declare_environment` accepte la même valeur une seconde fois).
--
-- La base de développement se déclare « development » (migration 0050), sinon l'API lancée avec
-- RUEDA_ENV=development refuse de démarrer (garde C19 : application et base discordantes). Une base
-- déjà déclarée autrement fait échouer la surcouche (déclaration unique, jamais modifiée).
--
-- Avant 0050, cette surcouche remplaçait `platform.deployment_env()` par la constante
-- « development » ; 0050 rétablit la lecture de la déclaration, puis cette surcouche l'écrit.

SELECT platform.declare_environment('development');
