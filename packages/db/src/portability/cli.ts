/**
 * `node packages/db/src/portability/cli.ts <commande>` : export et import de portabilité (US-036,
 * ADR-120 ; runbook docs/ops/PORTABILITY.md). Voir main.ts (commandes, variables). Code de
 * sortie 1 en échec ; message déjà expurgé des secrets ; aucune clé affichée.
 */
import { main } from './main.ts';

main(process.argv.slice(2), process.env).catch((error: unknown) => {
  console.error(`[portabilite] échec : ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
