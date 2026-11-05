/**
 * `node packages/db/src/rotation/cli.ts mfa-proof-key <INSTALL|STAGE|PROMOTE|ABORT>` (US-051,
 * ADR-082 ; runbook docs/ops/SECRET_ROTATION.md). Voir mfa-proof-key.ts. Code de sortie 1 en
 * échec ; message déjà expurgé des secrets ; aucune clé affichée.
 */
import { rotateMfaProofKey } from './mfa-proof-key.ts';

const [secret, action] = process.argv.slice(2);
if (secret !== 'mfa-proof-key') {
  console.error('[rotation] usage : cli.ts mfa-proof-key <INSTALL|STAGE|PROMOTE|ABORT>');
  process.exitCode = 1;
} else {
  rotateMfaProofKey(process.env, action).then(
    (state) => {
      console.log(`[rotation] clé de preuve MFA : ${state}`);
    },
    (error: unknown) => {
      console.error(`[rotation] échec : ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
