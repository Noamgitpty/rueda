/**
 * US-004 — journal d'accès aux données personnelles du staff (migration 0051), sous les rôles de
 * production (assertion L0-05 en tête de chaque test par withRole), en PA (USD) et en PY (PYG).
 *
 * Critère (19 US-004, 16 ADM-032) : « Given une consultation d'un dossier KYC, When elle a lieu,
 * Then elle figure au data_access_log. » Preuves :
 * - la porte core.iam_staff_cmd_data_access accorde l'accès à l'OPS du dossier qui lui est assigné
 *   (et à l'ADMIN du pays du dossier), écrit UNE ligne data_access_log et UNE ligne chaînée
 *   STAFF_DATA_ACCESS du journal d'audit qui la référence ; l'acteur est celui de la session ;
 * - tout refus (SUPPORT « masqué », FINANCE, autre pays, dossier non assigné, fermé, introuvable,
 *   catégorie discordante, session non élevée) est journalisé SANS ligne d'accès ;
 * - entrée mal formée ou type d'accès sans permission semée : 22023, rien d'écrit ;
 * - inaltérable : ni app_api ni app_worker ne modifient ni ne lisent le registre (42501), même le
 *   propriétaire est refusé (UPDATE, DELETE : IMMUTABLE_RECORD), la chaîne d'audit reste
 *   vérifiable (TRUNCATE par le propriétaire : refusé par le même trigger, prouvé par US-009 sur
 *   audit_log ; non rejoué ici, il prendrait un verrou exclusif sur la table partagée) ;
 * - consultable par les bons rôles (audit.read) : ADMIN du pays, l'OPS auteur ; ni l'ADMIN de
 *   l'autre pays, ni un autre OPS, ni le SUPPORT.
 * Attendus : 17 §2.3 (matrice `kyc.read_sensitive`, `audit.read`), §3.2.13 ; ADR-062, ADR-080.
 */
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { translateDbError } from '../../src/index.ts';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { attempt, verifyChainIn } from '../support/audit.ts';
import { COUNTRIES } from '../support/avl.ts';
import { buildWorld } from '../support/rls.ts';
import type { World } from '../support/rls.ts';
import { auditOf, elevatedStaff, installTestProofKey, login, uuid } from '../support/staff.ts';

const FIELD = 'identity_document.number_enc';
const PURPOSE = 'Vérification du dossier KYC assigné';
let world: World;

beforeAll(async () => {
  const api = await connectAs('app_api');
  try {
    await installTestProofKey(api);
    world = await buildWorld(api, COUNTRIES);
  } finally {
    await releaseClient(api);
  }
});

interface GateResult {
  readonly outcome: string;
  readonly access_id: string | null;
}

async function gate(
  client: pg.ClientBase,
  hash: Buffer,
  caseId: string,
  options: {
    readonly kind?: string;
    readonly subject?: string;
    readonly requestId?: string;
    readonly purpose?: string;
    readonly subjectType?: string;
  } = {},
): Promise<GateResult> {
  const { rows } = await client.query<GateResult>(
    'SELECT outcome, access_id FROM core.iam_staff_cmd_data_access($1, $2, $3, $4, $5, $6, $7, $8)',
    [
      hash,
      options.requestId ?? uuid(),
      caseId,
      options.subjectType ?? 'USER',
      options.subject ?? uuid(),
      FIELD,
      options.kind ?? 'READ_C3',
      options.purpose ?? PURPOSE,
    ],
  );
  return rows[0] ?? { outcome: '', access_id: null };
}

/** Dossier de support (validé) : pays, trip a1 du pays, assigné, état, catégorie. */
async function supportCase(
  client: pg.ClientBase,
  countryIndex: number,
  assignee: string | null,
  status = 'OPEN',
  category = 'TRIP',
): Promise<string> {
  const w = world.countries[countryIndex];
  if (w === undefined) throw new Error('pays absent du monde');
  const id = uuid();
  await client.query('SELECT test_fixture.rls_insert_support_case($1, $2, $3, $4, $5, $6, $7)', [
    id,
    w.c.country,
    w.trips.a1.id,
    assignee,
    status,
    category,
    category === 'BREAK_GLASS' ? 'Bris de glace motivé pour le test' : null,
  ]);
  return id;
}

async function accessRows(client: pg.ClientBase, actor: string) {
  const { rows } = await client.query<{
    id: string;
    actor_role: string;
    subject_type: string;
    subject_id: string;
    field_or_file: string;
    purpose: string;
    access_kind: string;
    case_ref: string | null;
    request_id: string | null;
  }>('SELECT * FROM test_fixture.us004_data_access_rows($1)', [actor]);
  return rows;
}

/** La ligne d'audit `id` est-elle la première rendue par core.iam_staff_audit_read à `hash` ? */
async function readsAuditRow(client: pg.ClientBase, hash: Buffer, id: string): Promise<boolean> {
  const { rows } = await client.query<{ id: string }>(
    'SELECT id::text AS id FROM core.iam_staff_audit_read($1, $2::bigint + 1, 1)',
    [hash, id],
  );
  return rows[0]?.id === id;
}

describe.each(COUNTRIES.map((c, i) => ({ ...c, i })))(
  'US-004 — journal d’accès aux données — $country ($currency)',
  ({ country, i }) => {
    const other = COUNTRIES[1 - i]?.country ?? '';

    it('critère : consultation d’un dossier KYC par l’OPS du dossier => GRANTED, data_access_log et audit chaîné', async () => {
      await withRole('app_api', async (client) => {
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const caseId = await supportCase(client, i, ops.userId);
        const subject = uuid();
        const requestId = uuid();
        const r = await gate(client, ops.hash, caseId, { subject, requestId });
        expect(r.outcome).toBe('GRANTED');
        expect(r.access_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(await accessRows(client, ops.userId)).toEqual([
          {
            id: r.access_id,
            actor_role: 'OPS_AGENT',
            subject_type: 'USER',
            subject_id: subject,
            field_or_file: FIELD,
            purpose: PURPOSE,
            access_kind: 'READ_C3',
            case_ref: caseId,
            request_id: requestId,
          },
        ]);
        const audit = (await auditOf(client, ops.userId)).at(-1);
        expect(audit).toMatchObject({
          actor_role: 'OPS_AGENT',
          action_code: 'STAFF_DATA_ACCESS',
          subject_type: 'USER',
          subject_id: subject,
          reason: PURPOSE,
          request_id: requestId,
          after: {
            country,
            countries: [country],
            access_kind: 'READ_C3',
            field_or_file: FIELD,
            case_id: caseId,
            data_access_id: r.access_id,
          },
        });
      });
    });

    it('ADMIN du pays : tout dossier de sa portée ; bris de glace seulement sur un dossier BREAK_GLASS', async () => {
      await withRole('app_api', async (client) => {
        const admin = await elevatedStaff(client, 'ADMIN', [country]);
        const unassigned = await supportCase(client, i, null);
        const glass = await supportCase(client, i, admin.userId, 'OPEN', 'BREAK_GLASS');
        expect((await gate(client, admin.hash, unassigned)).outcome).toBe('GRANTED');
        expect((await gate(client, admin.hash, glass, { kind: 'BREAK_GLASS' })).outcome).toBe(
          'GRANTED',
        );
        // catégorie discordante, dans les deux sens : refus
        expect((await gate(client, admin.hash, glass)).outcome).toBe('FORBIDDEN');
        expect((await gate(client, admin.hash, unassigned, { kind: 'BREAK_GLASS' })).outcome).toBe(
          'FORBIDDEN',
        );
        expect((await accessRows(client, admin.userId)).map((a) => a.access_kind)).toEqual([
          'READ_C3',
          'BREAK_GLASS',
        ]);
      });
    });

    it('refus journalisés, aucune ligne d’accès : rôle sans permission, autre pays, dossier non assigné, fermé, introuvable', async () => {
      await withRole('app_api', async (client) => {
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const otherOps = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const opsOther = await elevatedStaff(client, 'OPS_AGENT', [other]);
        const support = await elevatedStaff(client, 'SUPPORT_AGENT', [country]);
        const finance = await elevatedStaff(client, 'FINANCE', [country]);
        const adminOther = await elevatedStaff(client, 'ADMIN', [other]);
        const mine = await supportCase(client, i, ops.userId);
        const closed = await supportCase(client, i, ops.userId, 'CLOSED');
        const cases: [typeof ops, string, string][] = [
          [support, mine, 'PERMISSION'],
          [finance, mine, 'PERMISSION'],
          [opsOther, mine, 'PERMISSION'],
          [adminOther, mine, 'PERMISSION'],
          [otherOps, mine, 'CASE'],
          [ops, closed, 'CASE'],
          [ops, uuid(), 'CASE'],
        ];
        for (const [s, caseId, reason] of cases) {
          const requestId = uuid();
          expect(await gate(client, s.hash, caseId, { requestId })).toEqual({
            outcome: 'FORBIDDEN',
            access_id: null,
          });
          expect((await auditOf(client, s.userId)).at(-1)).toMatchObject({
            action_code: 'STAFF_FORBIDDEN',
            request_id: requestId,
            after: { reason, attempted: 'DATA_ACCESS', permission: 'kyc.read_sensitive' },
          });
        }
        for (const s of [ops, otherOps, opsOther, support, finance, adminOther]) {
          expect(await accessRows(client, s.userId)).toEqual([]);
        }
      });
    });

    it('session non élevée : MFA_REQUIRED journalisé ; aucune session : AUTH_REQUIRED, rien d’écrit', async () => {
      await withRole('app_api', async (client) => {
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const caseId = await supportCase(client, i, ops.userId);
        const plain = await login(client, ops.userId);
        expect(await gate(client, plain, caseId)).toEqual({
          outcome: 'MFA_REQUIRED',
          access_id: null,
        });
        expect((await auditOf(client, ops.userId)).at(-1)).toMatchObject({
          action_code: 'STAFF_ACCESS_DENIED',
          after: { reason: '2FA_REQUIRED', attempted: 'DATA_ACCESS' },
        });
        expect(await gate(client, Buffer.alloc(32, 7), caseId)).toEqual({
          outcome: 'AUTH_REQUIRED',
          access_id: null,
        });
        expect(await accessRows(client, ops.userId)).toEqual([]);
      });
    });

    it('entrées refusées (22023), rien d’écrit : type d’accès sans permission semée, motif court, type de sujet mal formé', async () => {
      await withRole('app_api', async (client) => {
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const caseId = await supportCase(client, i, ops.userId);
        const before = (await auditOf(client, ops.userId)).length;
        await withTestTransaction(client, {}, async (tx) => {
          for (const options of [
            { kind: 'READ_C2_SUPPORT' },
            { kind: 'BULK_EXPORT' },
            { purpose: 'court' },
            { subjectType: 'user; drop' },
          ]) {
            const e = await attempt(
              tx,
              'SELECT * FROM core.iam_staff_cmd_data_access($1, $2, $3, $4, $5, $6, $7, $8)',
              [
                ops.hash,
                uuid(),
                caseId,
                options.subjectType ?? 'USER',
                uuid(),
                FIELD,
                options.kind ?? 'READ_C3',
                options.purpose ?? PURPOSE,
              ],
            );
            expect(e, JSON.stringify(options)).toMatchObject({ code: '22023' });
          }
        });
        expect(await auditOf(client, ops.userId)).toHaveLength(before);
        expect(await accessRows(client, ops.userId)).toEqual([]);
      });
    });

    it('inaltérable : registre ni modifiable ni lisible par les rôles applicatifs, refus du propriétaire, chaîne vérifiable', async () => {
      let accessId = '';
      let auditId = '';
      await withRole('app_api', async (client) => {
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const caseId = await supportCase(client, i, ops.userId);
        accessId = (await gate(client, ops.hash, caseId)).access_id ?? '';
        auditId = (await auditOf(client, ops.userId)).at(-1)?.id ?? '';
        await withTestTransaction(client, {}, async (tx) => {
          for (const sql of [
            `UPDATE core.audit_data_access_log SET purpose = 'x' WHERE id = $1`,
            `DELETE FROM core.audit_data_access_log WHERE id = $1`,
            `SELECT 1 FROM core.audit_data_access_log WHERE id = $1`,
          ]) {
            expect(await attempt(tx, sql, [accessId]), sql).toMatchObject({ code: '42501' });
          }
          expect(await attempt(tx, 'TRUNCATE core.audit_data_access_log')).toMatchObject({
            code: '42501',
          });
          for (const op of ['UPDATE', 'DELETE']) {
            const e = await attempt(
              tx,
              'SELECT test_fixture.us004_owner_tamper_data_access($1, $2)',
              [op, accessId],
            );
            expect(translateDbError(e), op).toMatchObject({ code: 'IMMUTABLE_RECORD' });
          }
        });
        expect((await accessRows(client, ops.userId)).map((a) => a.id)).toEqual([accessId]);
      });
      await withRole('app_worker', async (client) => {
        await withTestTransaction(client, {}, async (tx) => {
          for (const sql of [
            `UPDATE core.audit_data_access_log SET purpose = 'x' WHERE id = $1`,
            `DELETE FROM core.audit_data_access_log WHERE id = $1`,
          ]) {
            expect(await attempt(tx, sql, [accessId]), sql).toMatchObject({ code: '42501' });
          }
          const chain = await verifyChainIn(tx);
          expect(chain.ok, JSON.stringify(chain)).toBe(true);
          if (chain.ok) expect(BigInt(chain.lastId)).toBeGreaterThanOrEqual(BigInt(auditId));
        });
      });
    });

    it('consultable par les bons rôles (audit.read) : ADMIN du pays et OPS auteur ; ni ADMIN de l’autre pays, ni autre OPS, ni SUPPORT', async () => {
      await withRole('app_api', async (client) => {
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const caseId = await supportCase(client, i, ops.userId);
        expect((await gate(client, ops.hash, caseId)).outcome).toBe('GRANTED');
        const id = (await auditOf(client, ops.userId)).at(-1)?.id ?? '';
        const admin = await elevatedStaff(client, 'ADMIN', [country]);
        const adminOther = await elevatedStaff(client, 'ADMIN', [other]);
        const otherOps = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const support = await elevatedStaff(client, 'SUPPORT_AGENT', [country]);
        expect(await readsAuditRow(client, ops.hash, id)).toBe(true);
        expect(await readsAuditRow(client, admin.hash, id)).toBe(true);
        expect(await readsAuditRow(client, adminOther.hash, id)).toBe(false);
        expect(await readsAuditRow(client, otherOps.hash, id)).toBe(false);
        expect(await readsAuditRow(client, support.hash, id)).toBe(false);
      });
    });
  },
);
