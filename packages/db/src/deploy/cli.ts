/**
 * `node packages/db/src/deploy/cli.ts` : job de base du déploiement (US-003). Voir setup.ts et
 * docs/ops/DEPLOY.md. Le message d'erreur est déjà expurgé des secrets ; code de sortie 1 en échec.
 */
import { main } from './setup.ts';

main(process.env).catch((error: unknown) => {
  console.error(`[deploy-db] échec : ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
