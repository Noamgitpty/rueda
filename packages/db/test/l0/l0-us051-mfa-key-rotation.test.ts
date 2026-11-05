/**
 * US-051 — rotation SANS COUPURE de la clé de preuve d'élévation MFA du staff (migration 0053,
 * ADR-082 ; runbook docs/ops/SECRET_ROTATION.md), sous le rôle de production app_api (assertion
 * L0-05 par withRole), les gestes de l'exploitation joués par la fixture 9930 (fonction de
 * production sous migrator) dans une transaction ANNULÉE.
 *
 * Attendu (19 US-051 : « le service continue sans interruption visible et l'ancien secret est
 * refusé » ; ADR-062) :
 * - STAGE : la base accepte la preuve sous l'ancienne ET sous la nouvelle clé (les instances de
 *   l'API pas encore déployées comme les nouvelles élèvent leurs sessions) ;
 * - PROMOTE : seule la nouvelle clé est acceptée ; l'ancienne est REFUSÉE (et journalisée) ;
 * - sans PROMOTE, l'ancienne est refusée 24 h après STAGE (fenêtre bornée en base) ;
 * - gestes incohérents refusés ; app_api n'appelle pas la fonction de rotation (42501).
 * Les preuves sont recalculées par node:crypto (test/support/staff.ts), clés de TEST publiques.
 */
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import {
  createStaff,
  elevate,
  installTestProofKey,
  login,
  proof,
  stepNow,
  TEST_PROOF_KEY,
} from '../support/staff.ts';

const NEW_KEY = createHash('sha256')
  .update('rueda-test-mfa-proof-key-us051 (nouvelle clé de test publique)', 'utf8')
  .digest();
const ALL = ['PA', 'PY'];

beforeAll(async () => {
  const api = await connectAs('app_api');
  try {
    await installTestProofKey(api);
  } finally {
    await releaseClient(api);
  }
});

const rotate = async (tx: pg.ClientBase, action: string, key: Buffer | null): Promise<string> => {
  const { rows } = await tx.query<{ r: string | null }>(
    'SELECT test_fixture.us051_rotate_mfa_key($1, $2) AS r',
    [action, key],
  );
  return rows[0]?.r ?? '';
};

const slots = async (tx: pg.ClientBase): Promise<number[]> => {
  const { rows } = await tx.query<{ s: number[] }>(
    'SELECT test_fixture.us051_mfa_key_slots() AS s',
  );
  return rows[0]?.s ?? [];
};

/** Compte de staff neuf ; enrôlement par une preuve calculée sous `key` ; rend l'issue. */
async function enrollWith(tx: pg.ClientBase, key: typeof TEST_PROOF_KEY): Promise<string> {
  const s = await createStaff(tx, 'ADMIN', ALL);
  const hash = await login(tx, s.userId);
  const reveal = await tx.query<{ outcome: string }>(
    'SELECT outcome FROM core.iam_staff_cmd_enroll_reveal($1, $2)',
    [hash, s.codeHash],
  );
  expect(reveal.rows[0]?.outcome).toBe('OK');
  const step = stepNow();
  return elevate(tx, hash, s.factorId, step, proof(hash, s.factorId, step, key));
}

/** Message de l'erreur levée dans un SAVEPOINT (la transaction reste utilisable). */
async function refusal(tx: pg.ClientBase, action: string, key: Buffer | null): Promise<string> {
  await tx.query('SAVEPOINT r');
  try {
    await rotate(tx, action, key);
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT r');
    return (error as { message?: string }).message ?? '';
  }
  await tx.query('RELEASE SAVEPOINT r');
  return 'AUCUNE_ERREUR';
}

describe('US-051 — rotation de la clé de preuve MFA (0053)', () => {
  it('STAGE : ancienne et nouvelle clé acceptées ; PROMOTE : l’ancienne est refusée', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, {}, async (tx) => {
        expect(await slots(tx)).toEqual([1]);
        // avant la rotation : seule la clé courante
        expect(await enrollWith(tx, TEST_PROOF_KEY)).toBe('ENROLLED');
        expect(await enrollWith(tx, NEW_KEY)).toBe('REFUSED');

        // 1. clé suivante posée : les deux sont acceptées (aucune interruption)
        expect(await rotate(tx, 'STAGE', NEW_KEY)).toBe('CURRENT+NEXT');
        expect(await slots(tx)).toEqual([1, 2]);
        expect(await enrollWith(tx, TEST_PROOF_KEY)).toBe('ENROLLED');
        expect(await enrollWith(tx, NEW_KEY)).toBe('ENROLLED');

        // 2. promotion : la nouvelle seule ; l'ancienne refusée
        expect(await rotate(tx, 'PROMOTE', null)).toBe('CURRENT');
        expect(await slots(tx)).toEqual([1]);
        expect(await enrollWith(tx, NEW_KEY)).toBe('ENROLLED');
        expect(await enrollWith(tx, TEST_PROOF_KEY)).toBe('REFUSED');
      });
    });
  });

  it('fenêtre à deux clés bornée en base : 24 h après STAGE, l’ancienne est refusée sans PROMOTE', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, {}, async (tx) => {
        // clé suivante posée il y a 25 h (horloge virtuelle le temps du geste), puis horloge réelle
        const past = new Date(Date.now() - 25 * 3600_000).toISOString();
        await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [past]);
        expect(await rotate(tx, 'STAGE', NEW_KEY)).toBe('CURRENT+NEXT');
        await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', '', true)`);
        expect(await enrollWith(tx, TEST_PROOF_KEY)).toBe('REFUSED');
        expect(await enrollWith(tx, NEW_KEY)).toBe('ENROLLED');
      });
    });
  });

  it('ABORT : la clé suivante est retirée, la courante reste seule acceptée', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, {}, async (tx) => {
        expect(await rotate(tx, 'STAGE', NEW_KEY)).toBe('CURRENT+NEXT');
        expect(await rotate(tx, 'ABORT', null)).toBe('CURRENT');
        expect(await enrollWith(tx, NEW_KEY)).toBe('REFUSED');
        expect(await enrollWith(tx, TEST_PROOF_KEY)).toBe('ENROLLED');
      });
    });
  });

  it('gestes incohérents refusés, sans jamais rendre une clé', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, {}, async (tx) => {
        expect(await refusal(tx, 'INSTALL', NEW_KEY)).toBe('mfa_proof_key_already_installed');
        expect(await refusal(tx, 'STAGE', TEST_PROOF_KEY)).toBe('mfa_proof_key_unchanged');
        expect(await refusal(tx, 'STAGE', Buffer.alloc(16, 1))).toBe('mfa_proof_key_invalid');
        expect(await refusal(tx, 'PROMOTE', null)).toBe('mfa_proof_key_nothing_staged');
        expect(await refusal(tx, 'ROTATE', NEW_KEY)).toBe('mfa_proof_key_action_invalid');
        expect(await slots(tx)).toEqual([1]);
      });
    });
  });

  it('app_api n’appelle pas la fonction de rotation (42501) et ne lit pas les clés', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, {}, async (tx) => {
        await tx.query('SAVEPOINT a');
        await expect(
          tx.query(`SELECT core.iam_mfa_proof_key_rotate('ABORT', NULL)`),
        ).rejects.toMatchObject({ code: '42501' });
        await tx.query('ROLLBACK TO SAVEPOINT a');
        await expect(tx.query('SELECT key FROM core.iam_mfa_proof_key')).rejects.toMatchObject({
          code: '42501',
        });
      });
    });
  });
});
