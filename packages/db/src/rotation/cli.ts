/**
 * `node packages/db/src/rotation/cli.ts <mfa-proof-key|session-open-key> <INSTALL|STAGE|PROMOTE|ABORT>`
 * (US-051, US-410 ; ADR-082, ADR-205 ; runbook docs/ops/SECRET_ROTATION.md). Voir mfa-proof-key.ts
 * et session-open-key.ts. Code de sortie 1 en échec ; message déjà expurgé des secrets ; aucune clé
 * affichée.
 */
import { rotateMfaProofKey } from './mfa-proof-key.ts';
import { rotateSessionOpenKey } from './session-open-key.ts';

const SECRETS = {
  'mfa-proof-key': { rotate: rotateMfaProofKey, label: 'clé de preuve MFA' },
  'session-open-key': {
    rotate: rotateSessionOpenKey,
    label: 'clé de preuve d’ouverture de session',
  },
} as const;

const [secret, action] = process.argv.slice(2);
const target = secret === 'mfa-proof-key' || secret === 'session-open-key' ? SECRETS[secret] : null;
if (target === null) {
  console.error(
    '[rotation] usage : cli.ts <mfa-proof-key|session-open-key> <INSTALL|STAGE|PROMOTE|ABORT>',
  );
  process.exitCode = 1;
} else {
  target.rotate(process.env, action).then(
    (state) => {
      console.log(`[rotation] ${target.label} : ${state}`);
    },
    (error: unknown) => {
      console.error(`[rotation] échec : ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
