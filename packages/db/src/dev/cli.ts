/**
 * `node packages/db/src/dev/cli.ts [--verify-only]` : base de développement locale (US-035).
 * Voir setup.ts et docs/ops/INSTALL.md. Le message d'erreur est déjà expurgé des secrets.
 */
import { main } from './setup.ts';

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`[db-setup] échec : ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
