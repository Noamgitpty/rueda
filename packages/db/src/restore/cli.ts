/**
 * `node packages/db/src/restore/cli.ts` : vérification d'une base RESTAURÉE (US-051, ADR-082 ;
 * runbook docs/ops/BACKUP_RESTORE.md). Voir main.ts (variables) et verify.ts (contrôles). Code de
 * sortie 1 si un contrôle échoue ; message d'erreur déjà expurgé des secrets.
 */
import { main } from './main.ts';

main(process.env).then(
  (ok) => {
    if (!ok) process.exitCode = 1;
  },
  (error: unknown) => {
    console.error(
      `[restore-verify] échec : ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  },
);
