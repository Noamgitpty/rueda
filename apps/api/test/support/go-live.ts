/**
 * Ouverture d'un interrupteur de mise en service par la VRAIE procédure à deux personnes d'US-125
 * (`core.config_cmd_request_go_live_switch` puis `core.config_cmd_approve_go_live_switch`), dans la
 * transaction ANNULÉE de l'appelant (sous app_api). TESTS SEULEMENT (dossier `test/`).
 *
 * Support unique des tests d'intégration d'`apps/api` (US-312, revue d'architecture) : il remplace
 * les copies de `redteam-l2.ts` et de `parcours-dores-reservation.int.test.ts`. Ordre de
 * verrouillage : tête de chaîne d'audit AVANT le verrou consultatif de la commande (même ordre que
 * `packages/db/test/support/golive.ts`, PR #200 ; jamais l'ordre inverse : 40P01). Ce dernier
 * support, propre aux preuves L0 de `@rueda/db`, n'est pas exporté par le paquet : il reste séparé
 * (suite inscrite dans la passation d'US-312).
 *
 * Règle (CLAUDE.md point 7) : un interrupteur ne passe à true que dans une transaction annulée ;
 * l'appelant ne valide jamais la transaction qui a appelé `openSwitch`.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setSessionContext } from '@rueda/db';
import type pg from 'pg';

const SIGNUP = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const PHC =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';

/** Membre du personnel inscrit par la vraie commande, rôle interne du pays, session élevée. */
async function staffWithSession(
  tx: pg.ClientBase,
  role: 'ADMIN' | 'SUPERADMIN',
  country: string,
): Promise<{ id: string; hash: Buffer }> {
  const id = randomUUID();
  const r = await tx.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Staff', 'Test', 'es', $4, $5, 86400,
                                                NULL, $6, $7::jsonb, false) AS ok`,
    [id, `golive-${id}@example.test`, PHC, randomUUID(), randomBytes(32), country, SIGNUP],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await tx.query('SELECT test_fixture.iam_set_account_status($1, $2)', [id, 'ACTIVE']);
  await tx.query(`SELECT test_fixture.iam_grant_staff_role($1, $2, $3, $4::text[], NULL, NULL)`, [
    randomUUID(),
    id,
    role,
    [country],
  ]);
  const hash = createHash('sha256').update(randomBytes(32)).digest();
  await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [id, hash]);
  return { id, hash };
}

/** Interrupteur `key` ouvert dans `country` (demande ADMIN, approbation SUPERADMIN). */
export async function openSwitch(tx: pg.ClientBase, key: string, country: string): Promise<void> {
  const as = async (who: { id: string; hash: Buffer }) =>
    setSessionContext(tx, {
      kind: 'STAFF',
      actorId: who.id,
      countryScope: [country],
      sessionTokenHash: who.hash.toString('hex'),
    });
  const requester = await staffWithSession(tx, 'ADMIN', country);
  const approver = await staffWithSession(tx, 'SUPERADMIN', country);
  await tx.query('SELECT test_fixture.audit_chain_head_lock()');
  await as(requester);
  const r = await tx.query<{ outcome: string; request_id: string | null }>(
    'SELECT outcome, request_id FROM core.config_cmd_request_go_live_switch($1, $2, $3, $4, $5, $6)',
    [requester.hash, randomUUID(), key, country, true, 'DEC-FONDATEUR-15'],
  );
  if (r.rows[0]?.outcome !== 'REQUESTED') throw new Error(`demande : ${r.rows[0]?.outcome}`);
  await as(approver);
  const a = await tx.query<{ outcome: string }>(
    'SELECT outcome FROM core.config_cmd_approve_go_live_switch($1, $2)',
    [approver.hash, r.rows[0].request_id],
  );
  if (a.rows[0]?.outcome !== 'APPLIED') throw new Error(`approbation : ${a.rows[0]?.outcome}`);
}
