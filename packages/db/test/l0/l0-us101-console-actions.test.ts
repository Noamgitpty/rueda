/**
 * Preuves du cadre des actions de console `manual_action` (US-101, migration 0059 ; fixtures 9960)
 * sous le rôle de production app_api (assertion L0-05 en tête de chaque test par withRole), avec
 * des membres du staff enrôlés et élevés par les VRAIES commandes (support/staff.ts), en USD (PA)
 * et en PYG (PY). Chaque test crée ses propres membres du staff, pièces et avances.
 *
 * Attendus tirés de 19 US-101 (critères d'acceptation), de 17 §10 (NN9, catalogue minimal des
 * actions de console), §3.2.13 (`manual_action`), §2.3 (matrice, RLS-24) et de 16 ADM-001
 * (« action interdite => 403 journalisé »), jamais du code testé :
 * - critère 1 : une action d'état appelle la commande de domaine LIÉE dans la même transaction
 *   (sonde de test : effet, manual_action et audit ensemble, ou rien du tout), et l'agent ne
 *   saisit jamais un montant ; une action d'état sans commande livrée reste indisponible ;
 * - critère 2 : une action d'enregistrement seul exige un motif ET des pièces, et est journalisée ;
 * - critère 3 : une action FINANCE n'est qu'une demande (`cmd_request_finance_action`) tant
 *   qu'une seconde personne distincte ne l'a pas validée (`cmd_approve_finance_action`, RLS-24).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { setSessionContext } from '../../src/index.ts';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import { buildWorld } from '../support/rls.ts';
import type { World } from '../support/rls.ts';
import { auditOf, elevatedStaff, installTestProofKey, uuid } from '../support/staff.ts';

const ALL = COUNTRIES.map((c) => c.country);
const REASON = 'Motif de test suffisamment long';
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

const trip = (i: number): string => world.countries[i]?.trips.a1.id ?? '';

interface Outcome {
  readonly outcome: string;
  readonly action_id: string | null;
  readonly domain_ref: string | null;
  readonly detail: string | null;
}

interface Staff {
  readonly userId: string;
  readonly hash: Buffer;
}

const ACT =
  'SELECT * FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, $6::jsonb, $7::uuid[])';

/**
 * Action de console : un appel = une instruction dans une transaction courte VALIDÉE, sous le
 * contexte STAFF que pose l'API (ADR-062, ADR-091) ; `context: false` = aucun contexte posé.
 */
async function act(
  client: pg.ClientBase,
  staff: Staff,
  action: string,
  subject: string,
  options: {
    readonly requestId?: string;
    readonly input?: Record<string, unknown> | null;
    readonly evidence?: readonly string[];
    readonly reason?: string;
    readonly scope?: readonly string[];
    readonly context?: boolean;
  } = {},
): Promise<Outcome> {
  return withTestTransaction(client, { commit: true }, async (tx) => {
    if (options.context !== false) {
      await setSessionContext(tx, {
        kind: 'STAFF',
        actorId: staff.userId,
        countryScope: options.scope ?? ALL,
        sessionTokenHash: staff.hash.toString('hex'),
      });
    }
    const { rows } = await tx.query<Outcome>(ACT, [
      staff.hash,
      options.requestId ?? uuid(),
      action,
      subject,
      options.reason ?? REASON,
      options.input === undefined ? {} : options.input,
      options.evidence ?? [],
    ]);
    return rows[0] ?? { outcome: '', action_id: null, domain_ref: null, detail: null };
  });
}

async function evidence(client: pg.ClientBase, bucket = 'PRIVATE_EVIDENCE'): Promise<string> {
  const id = uuid();
  await client.query('SELECT test_fixture.us101_insert_file($1, $2)', [id, bucket]);
  return id;
}

async function manualAction(client: pg.ClientBase, id: string) {
  const { rows } = await client.query<{
    action_code: string;
    mode: string;
    country_code: string;
    actor_role: string;
    outcome: string | null;
    domain_ref: string | null;
    input: Record<string, unknown>;
    evidence_file_ids: string[];
    emitted_event_ids: string[];
    audit_log_id: string | null;
  }>('SELECT * FROM test_fixture.us101_manual_action($1)', [id]);
  return rows;
}

async function effects(client: pg.ClientBase, subject: string) {
  const { rows } = await client.query<{ request_id: string; actor: string; actor_role: string }>(
    'SELECT * FROM test_fixture.us101_probe_effects($1)',
    [subject],
  );
  return rows;
}

// 17 §10, catalogue minimal (hors CREATE_HOST_ACCOUNT, US-107), réparti par 19 US-101.
const STATE_ACTIONS = [
  'CANCEL_TRIP_GUEST',
  'CANCEL_TRIP_HOST',
  'CANCEL_TRIP_PLATFORM',
  'DECLARE_NO_SHOW',
  'REFUSE_AT_PICKUP',
  'KYC_DECISION',
  'HOST_VERIFICATION_DECISION',
  'PUBLISH_LISTING',
  'ESCALATE_OVERDUE',
  'REVIEW_FLAGGED_BOOKING',
] as const;
const RECORD_ONLY = [
  'RECORD_CLAIM',
  'ISSUE_DECISION',
  'RECORD_CHARGEBACK',
  'OPEN_INCIDENT',
  'RECORD_REVIEW',
  'HANDLE_DSR',
] as const;
const FINANCE = ['ISSUE_BORDEREAU', 'DECIDE_ADVANCE', 'WRITE_OFF_RECEIVABLE'] as const;

describe('catalogue (17 §10 NN9, 19 US-101)', () => {
  it('catalogue minimal complet : actions d’état et FINANCE en commande de domaine, actions rares en enregistrement seul ; seules les commandes FINANCE sont liées', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{
        action_code: string;
        mode: string;
        bound: boolean;
        input_keys: string[];
      }>(
        `SELECT action_code, mode, bound, input_keys FROM test_fixture.us101_catalog()
          WHERE action_code <> 'TEST_PROBE_ACTION'`,
      );
      const byCode = new Map(rows.map((r) => [r.action_code, r]));
      expect([...byCode.keys()].sort()).toEqual(
        [...STATE_ACTIONS, ...RECORD_ONLY, ...FINANCE].sort(),
      );
      for (const a of STATE_ACTIONS) {
        expect(byCode.get(a), a).toMatchObject({ mode: 'DOMAIN_COMMAND', bound: false });
      }
      for (const a of RECORD_ONLY) {
        expect(byCode.get(a), a).toMatchObject({ mode: 'RECORD_ONLY', bound: false });
      }
      for (const a of FINANCE) {
        expect(byCode.get(a), a).toMatchObject({ mode: 'DOMAIN_COMMAND', bound: true });
      }
      // aucune clé de saisie ne nomme un montant
      for (const r of rows) {
        for (const k of r.input_keys) expect(k, r.action_code).not.toMatch(/amount|minor|total/i);
      }
    });
  });

  it('la base refuse une clé de saisie qui nomme un montant, et la liaison d’un gestionnaire non conforme ou d’une action d’enregistrement seul', async () => {
    await withRole('app_api', async (client) => {
      const keys = async (k: string[]) =>
        (
          await client.query<{ r: string }>('SELECT test_fixture.us101_try_catalog_keys($1) AS r', [
            k,
          ])
        ).rows[0]?.r;
      expect(await keys(['decision'])).toBe('OK');
      for (const k of [['refundAmount'], ['amountMinor'], ['montant'], ['total'], ['fee']]) {
        expect(await keys(k), k[0]).toBe('23514:manual_action_catalog_input_keys_format');
      }
      const bind = async (action: string, handler: string) =>
        (
          await client.query<{ r: string }>('SELECT test_fixture.us101_try_bind($1, $2) AS r', [
            action,
            handler,
          ])
        ).rows[0]?.r;
      const finance =
        'core.support_manual_action_finance_request(bytea,uuid,text,uuid,jsonb,text,uuid,text)';
      expect(await bind('CANCEL_TRIP_PLATFORM', finance)).toBe('OK');
      expect(await bind('RECORD_CLAIM', finance)).toBe('23514:manual_action_handler_domain_only');
      // mauvaise signature (fonction interne du cadre)
      expect(await bind('CANCEL_TRIP_PLATFORM', 'core.support_subject_country(text,uuid)')).toBe(
        '23514:manual_action_handler_signature',
      );
      // le gestionnaire n'est jamais exécutable par un rôle applicatif
      const { rows } = await client.query<{ api: boolean; worker: boolean; anon: boolean }>(
        `SELECT pg_catalog.has_function_privilege('app_api', $1::regprocedure, 'EXECUTE') AS api,
                pg_catalog.has_function_privilege('app_worker', $1::regprocedure, 'EXECUTE') AS worker,
                pg_catalog.has_function_privilege('app_anon', $1::regprocedure, 'EXECUTE') AS anon`,
        [finance],
      );
      expect(rows).toEqual([{ api: false, worker: false, anon: false }]);
    });
  });

  it('app_api ne lit ni n’écrit directement manual_action, le catalogue ni les liaisons (42501)', async () => {
    await withRole('app_api', async (client) => {
      for (const t of [
        'support_manual_action',
        'support_manual_action_catalog',
        'support_manual_action_handler',
      ]) {
        await expect(client.query(`SELECT 1 FROM core.${t}`), t).rejects.toMatchObject({
          code: '42501',
        });
      }
      await expect(
        client.query(
          `INSERT INTO core.support_manual_action_handler (action_code, handler, story)
           VALUES ('CANCEL_TRIP_PLATFORM', 'core.support_subject_country(text,uuid)'::regprocedure, 'US-101')`,
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});

describe('critère 1 — action d’état : commande de domaine liée, dans la même transaction', () => {
  it.each(COUNTRIES.map((c, i) => [c.country, c.currency, i] as const))(
    '%s (%s) : DONE => effet de domaine, manual_action et audit ensemble ; refus du domaine => journalisé, aucune ligne ; erreur après écriture => RIEN (même transaction)',
    async (country, _currency, i) => {
      await withRole('app_api', async (client) => {
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const subject = trip(i);
        const before = (await effects(client, subject)).length;

        const done = uuid();
        const r = await act(client, ops, 'TEST_PROBE_ACTION', subject, {
          requestId: done,
          input: { probeMode: 'done' },
        });
        expect(r).toEqual({ outcome: 'DONE', action_id: done, domain_ref: done, detail: null });
        const eff = await effects(client, subject);
        expect(eff.length).toBe(before + 1);
        expect(eff.at(-1)).toEqual({
          request_id: done,
          actor: ops.userId,
          actor_role: 'OPS_AGENT',
        });
        const audit = await auditOf(client, ops.userId);
        const last = audit.at(-1);
        expect(last).toMatchObject({
          action_code: 'MANUAL_ACTION_DONE',
          subject_type: 'TRIP',
          subject_id: subject,
          reason: REASON,
          request_id: done,
          after: { action: 'TEST_PROBE_ACTION', mode: 'DOMAIN_COMMAND', country, outcome: 'DONE' },
        });
        expect(await manualAction(client, done)).toEqual([
          {
            action_code: 'TEST_PROBE_ACTION',
            mode: 'DOMAIN_COMMAND',
            country_code: country,
            actor_role: 'OPS_AGENT',
            outcome: 'DONE',
            domain_ref: done,
            input: { probeMode: 'done' },
            evidence_file_ids: [],
            emitted_event_ids: [done],
            audit_log_id: last?.id,
          },
        ]);
        // même request_id : DUPLICATE, aucun second effet ni seconde ligne d'audit
        expect(
          await act(client, ops, 'TEST_PROBE_ACTION', subject, {
            requestId: done,
            input: { probeMode: 'done' },
          }),
        ).toEqual({ outcome: 'DUPLICATE', action_id: done, domain_ref: done, detail: 'DONE' });
        expect((await effects(client, subject)).length).toBe(before + 1);
        expect(await auditOf(client, ops.userId)).toHaveLength(audit.length);

        // refus du domaine : journalisé, aucune ligne manual_action, aucun effet
        const refused = uuid();
        expect(
          await act(client, ops, 'TEST_PROBE_ACTION', subject, {
            requestId: refused,
            input: { probeMode: 'refuse' },
          }),
        ).toEqual({
          outcome: 'REFUSED',
          action_id: null,
          domain_ref: null,
          detail: 'NOT_ELIGIBLE',
        });
        expect((await auditOf(client, ops.userId)).at(-1)).toMatchObject({
          action_code: 'MANUAL_ACTION_REFUSED',
          request_id: refused,
          after: { attempted: 'TEST_PROBE_ACTION', domainOutcome: 'NOT_ELIGIBLE', country },
        });
        expect(await manualAction(client, refused)).toEqual([]);

        // erreur de la commande APRÈS son écriture : tout est annulé (effet, ligne, audit)
        const failed = uuid();
        const auditBefore = (await auditOf(client, ops.userId)).length;
        await expect(
          act(client, ops, 'TEST_PROBE_ACTION', subject, {
            requestId: failed,
            input: { probeMode: 'fail' },
          }),
        ).rejects.toMatchObject({ code: 'P0001' });
        expect((await effects(client, subject)).map((e) => e.request_id)).not.toContain(failed);
        expect(await manualAction(client, failed)).toEqual([]);
        expect(await auditOf(client, ops.userId)).toHaveLength(auditBefore);
      });
    },
  );

  it('l’agent ne saisit jamais un montant : clé non déclarée, nombre ou chaîne numérique => 22023, rien n’est écrit', async () => {
    await withRole('app_api', async (client) => {
      const ops = await elevatedStaff(client, 'OPS_AGENT', ALL);
      const subject = trip(0);
      const before = (await effects(client, subject)).length;
      const auditBefore = (await auditOf(client, ops.userId)).length;
      for (const input of [
        { amount: '100' },
        { amountMinor: 'cent' },
        { probeMode: 'done', refundMinor: 'x' },
        { probeMode: 100 },
        { probeMode: '1500' },
        { probeMode: '12,50' },
        { probeMode: ' -3.5 ' },
        { probeMode: '850 000' },
        { probeMode: { minor: 'x' } },
        { probeMode: '' },
      ]) {
        await expect(
          act(client, ops, 'TEST_PROBE_ACTION', subject, { input }),
          JSON.stringify(input),
        ).rejects.toMatchObject({ code: '22023' });
      }
      // une action d'état sans clé déclarée n'admet aucune saisie
      await expect(
        act(client, ops, 'CANCEL_TRIP_PLATFORM', subject, { input: { cause: 'x' } }),
      ).rejects.toMatchObject({ code: '22023' });
      expect((await effects(client, subject)).length).toBe(before);
      expect(await auditOf(client, ops.userId)).toHaveLength(auditBefore);
    });
  });

  it('portée pays : OPS du premier pays sur un trip du second => FORBIDDEN (COUNTRY_SCOPE) journalisé, la commande liée n’est pas appelée', async () => {
    await withRole('app_api', async (client) => {
      const ops = await elevatedStaff(client, 'OPS_AGENT', [ALL[0] ?? '']);
      const subject = trip(1);
      const before = (await effects(client, subject)).length;
      expect(
        (await act(client, ops, 'TEST_PROBE_ACTION', subject, { input: { probeMode: 'done' } }))
          .outcome,
      ).toBe('FORBIDDEN');
      expect((await auditOf(client, ops.userId)).at(-1)).toMatchObject({
        action_code: 'STAFF_FORBIDDEN',
        after: { reason: 'COUNTRY_SCOPE', attempted: 'TEST_PROBE_ACTION' },
      });
      expect((await effects(client, subject)).length).toBe(before);
    });
  });

  it('actions d’état dont la commande n’est pas livrée : UNAVAILABLE journalisé (aucun faux changement d’état) ; sans permission : FORBIDDEN', async () => {
    await withRole('app_api', async (client) => {
      const ops = await elevatedStaff(client, 'OPS_AGENT', ALL);
      const finance = await elevatedStaff(client, 'FINANCE', ALL);
      const subjects: Record<string, string> = {
        KYC_DECISION: uuid(),
        PUBLISH_LISTING: uuid(),
        HOST_VERIFICATION_DECISION: world.countries[0]?.orgA ?? '',
      };
      for (const a of STATE_ACTIONS) {
        const input =
          a === 'KYC_DECISION' ||
          a === 'HOST_VERIFICATION_DECISION' ||
          a === 'REVIEW_FLAGGED_BOOKING'
            ? { decision: 'APPROVED' }
            : {};
        const subject = subjects[a] ?? trip(0);
        expect((await act(client, ops, a, subject, { input })).outcome, a).toBe('UNAVAILABLE');
        expect((await auditOf(client, ops.userId)).at(-1)?.action_code, a).toBe(
          'MANUAL_ACTION_UNAVAILABLE',
        );
        expect((await act(client, finance, a, subject, { input })).outcome, a).toBe('FORBIDDEN');
      }
    });
  });
});

describe('critère 2 — action d’enregistrement seul : motif obligatoire et pièces, journalisée', () => {
  it.each(COUNTRIES.map((c, i) => [c.country, c.currency, i] as const))(
    '%s (%s) : sans pièce, pièce d’un autre seau, pièce inconnue ou motif trop court => 22023 ; avec pièce et motif => RECORDED, manual_action rattachée à l’audit',
    async (country, _currency, i) => {
      await withRole('app_api', async (client) => {
        const admin = await elevatedStaff(client, 'ADMIN', [country]);
        const cases = [world.cases.firstA1, world.cases.secondA1];
        for (const a of RECORD_ONLY) {
          const subject = a === 'HANDLE_DSR' ? (cases[i] ?? '') : trip(i);
          const auditBefore = (await auditOf(client, admin.userId)).length;
          const other = await evidence(client, 'DOCUMENTS');
          for (const ev of [[], [other], [uuid()]]) {
            await expect(
              act(client, admin, a, subject, { evidence: ev }),
              `${a} ${ev.length}`,
            ).rejects.toMatchObject({ code: '22023' });
          }
          const piece = await evidence(client);
          await expect(
            act(client, admin, a, subject, { evidence: [piece], reason: 'court' }),
          ).rejects.toMatchObject({ code: '22023' });
          expect(await auditOf(client, admin.userId), a).toHaveLength(auditBefore);

          const id = uuid();
          expect(
            await act(client, admin, a, subject, { requestId: id, evidence: [piece] }),
          ).toEqual({ outcome: 'RECORDED', action_id: id, domain_ref: null, detail: null });
          const last = (await auditOf(client, admin.userId)).at(-1);
          expect(last, a).toMatchObject({
            action_code: 'MANUAL_ACTION_RECORDED',
            subject_id: subject,
            reason: REASON,
            after: { action: a, mode: 'RECORD_ONLY', country, outcome: 'RECORDED', evidence: 1 },
          });
          expect(await manualAction(client, id), a).toMatchObject([
            {
              action_code: a,
              mode: 'RECORD_ONLY',
              country_code: country,
              actor_role: 'ADMIN',
              outcome: 'RECORDED',
              evidence_file_ids: [piece],
              emitted_event_ids: [],
              audit_log_id: last?.id,
            },
          ]);
        }
      });
    },
  );

  it('HANDLE_DSR : réservé à l’ADMIN (data.export) ; un OPS est refusé et journalisé', async () => {
    await withRole('app_api', async (client) => {
      const ops = await elevatedStaff(client, 'OPS_AGENT', ALL);
      const piece = await evidence(client);
      expect(
        (await act(client, ops, 'HANDLE_DSR', world.cases.firstA1, { evidence: [piece] })).outcome,
      ).toBe('FORBIDDEN');
      expect((await auditOf(client, ops.userId)).at(-1)).toMatchObject({
        action_code: 'STAFF_FORBIDDEN',
        after: { reason: 'PERMISSION', attempted: 'HANDLE_DSR', permission: 'data.export' },
      });
    });
  });

  it('forme d’US-012 sans pièces : même cadre, une action d’enregistrement seul autorisée est refusée (22023)', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      await expect(
        client.query('SELECT * FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, NULL)', [
          admin.hash,
          uuid(),
          'RECORD_CLAIM',
          trip(0),
          REASON,
        ]),
      ).rejects.toMatchObject({ code: '22023' });
    });
  });
});

describe('critère 3 — action FINANCE : une demande, puis une seconde personne distincte (RLS-24)', () => {
  const APPROVE = 'SELECT * FROM core.settlement_cmd_approve_finance_action($1, $2)';

  async function approve(
    client: pg.ClientBase,
    staff: Staff,
    approval: string,
  ): Promise<{ outcome: string; approval_id: string | null }> {
    return withTestTransaction(client, { commit: true }, async (tx) => {
      await setSessionContext(tx, {
        kind: 'STAFF',
        actorId: staff.userId,
        countryScope: ALL,
        sessionTokenHash: staff.hash.toString('hex'),
      });
      const { rows } = await tx.query<{ outcome: string; approval_id: string | null }>(APPROVE, [
        staff.hash,
        approval,
      ]);
      return rows[0] ?? { outcome: '', approval_id: null };
    });
  }

  async function advance(client: pg.ClientBase, i: number, amount: string): Promise<string> {
    const id = uuid();
    await client.query(
      `SELECT test_fixture.us062_insert_advance($1, $2, 'HOST_COMPENSATION', $3::bigint)`,
      [id, trip(i), amount],
    );
    return id;
  }

  async function advanceRow(client: pg.ClientBase, id: string) {
    const { rows } = await client.query<{
      status: string;
      decided_by: string | null;
      decision_second_by: string | null;
    }>('SELECT status, decided_by, decision_second_by FROM test_fixture.us062_advance_row($1)', [
      id,
    ]);
    return rows[0];
  }

  // montants en unités mineures : USD (cents) et PYG (sans décimale) ; aucun n'est saisi par l'agent
  const AMOUNTS: Record<string, string> = { USD: '2500', PYG: '185000' };

  it.each(COUNTRIES.map((c, i) => [c.country, c.currency, i] as const))(
    '%s (%s) : A demande DECIDE_ADVANCE par la console => REQUESTED, aucun effet ; A approuve => SELF_APPROVAL ; B approuve => effet, deux personnes distinctes',
    async (country, currency, i) => {
      await withRole('app_api', async (client) => {
        const a = await elevatedStaff(client, 'FINANCE', [country]);
        const b = await elevatedStaff(client, 'FINANCE', [country]);
        const adv = await advance(client, i, AMOUNTS[currency] ?? '1');
        const id = uuid();
        const req = await act(client, a, 'DECIDE_ADVANCE', adv, {
          requestId: id,
          scope: [country],
        });
        expect(req).toMatchObject({ outcome: 'REQUESTED', action_id: id, detail: null });
        const approval = req.domain_ref ?? '';
        expect(approval).toBe(id);
        expect(await advanceRow(client, adv)).toEqual({
          status: 'OPEN',
          decided_by: null,
          decision_second_by: null,
        });
        expect(await manualAction(client, id)).toMatchObject([
          {
            action_code: 'DECIDE_ADVANCE',
            mode: 'DOMAIN_COMMAND',
            country_code: country,
            actor_role: 'FINANCE',
            outcome: 'REQUESTED',
            domain_ref: approval,
          },
        ]);
        const trail = (await auditOf(client, a.userId)).slice(-2).map((r) => r.action_code);
        expect(trail).toEqual(['FINANCE_ACTION_REQUESTED', 'MANUAL_ACTION_REQUESTED']);

        // une seconde demande sur le même sujet : refusée (une demande en attente par sujet)
        expect(await act(client, b, 'DECIDE_ADVANCE', adv, { scope: [country] })).toMatchObject({
          outcome: 'REFUSED',
          domain_ref: approval,
          detail: 'ALREADY_PENDING',
        });

        expect((await approve(client, a, approval)).outcome).toBe('SELF_APPROVAL');
        expect(await advanceRow(client, adv)).toMatchObject({ decided_by: null });
        expect(await approve(client, b, approval)).toEqual({
          outcome: 'APPROVED',
          approval_id: approval,
        });
        expect(await advanceRow(client, adv)).toEqual({
          status: 'OPEN',
          decided_by: a.userId,
          decision_second_by: b.userId,
        });
      });
    },
  );

  it('OPS : FORBIDDEN journalisé ; FINANCE de l’autre pays : FORBIDDEN ; sans contexte STAFF : la demande est refusée par la commande FINANCE (REFUSED), aucun effet', async () => {
    await withRole('app_api', async (client) => {
      const first = ALL[0] ?? '';
      const ops = await elevatedStaff(client, 'OPS_AGENT', ALL);
      const financeSecond = await elevatedStaff(client, 'FINANCE', [ALL[1] ?? '']);
      const financeFirst = await elevatedStaff(client, 'FINANCE', [first]);
      const adv = await advance(client, 0, AMOUNTS[COUNTRIES[0].currency] ?? '1');
      expect((await act(client, ops, 'DECIDE_ADVANCE', adv)).outcome).toBe('FORBIDDEN');
      expect((await auditOf(client, ops.userId)).at(-1)).toMatchObject({
        action_code: 'STAFF_FORBIDDEN',
        after: { reason: 'PERMISSION', permission: 'finance.platform_advance' },
      });
      expect((await act(client, financeSecond, 'WRITE_OFF_RECEIVABLE', adv)).outcome).toBe(
        'FORBIDDEN',
      );
      // aucune saisie admise pour une action FINANCE : le montant vient de la base
      await expect(
        act(client, financeFirst, 'DECIDE_ADVANCE', adv, { input: { advance: 'x' } }),
      ).rejects.toMatchObject({ code: '22023' });
      expect(
        await act(client, financeFirst, 'DECIDE_ADVANCE', adv, { context: false }),
      ).toMatchObject({ outcome: 'REFUSED', detail: 'AUTH_REQUIRED' });
      expect(await advanceRow(client, adv)).toEqual({
        status: 'OPEN',
        decided_by: null,
        decision_second_by: null,
      });
    });
  });
});
