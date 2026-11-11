/**
 * Preuves du cadre des actions de console `manual_action` (US-101, migration 0060 ; fixtures 9960)
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
 * Reprise après les revues de la PR #99 (ADR-092) : catalogue comparé à un tableau tiré de 17 §2.3
 * et §10 ; garde des liaisons jouée contrôle par contrôle, réappliquée à toutes les liaisons et
 * à chaque appel ; types de sujet déclarés ; énumération fermée de `decision` ; FINANCE garantie
 * par `requires_approval` ; rejeu concurrent d'un même request_id sur deux connexions.
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
 * contexte STAFF que pose l'API (ADR-062, ADR-092) ; `context: false` = aucun contexte posé.
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

const FINANCE_REQUEST =
  'core.support_manual_action_finance_request(bytea,uuid,text,uuid,jsonb,text,uuid,text)';
const DECISION = { decision: ['APPROVED', 'REJECTED'] };

interface Expected {
  readonly permission: string;
  readonly subject: string;
  readonly mode: 'DOMAIN_COMMAND' | 'RECORD_ONLY';
  readonly keys: readonly string[];
  readonly values: Record<string, readonly string[]>;
  readonly approval: boolean;
  /** Source dans la spécification (17 §2.3 matrice, §10 catalogue), ou décision PROPOSÉE. */
  readonly source: string;
}

/**
 * Matrice attendue, tirée de la SPÉCIFICATION et non du catalogue en base : permissions de 17 §2.3
 * (lignes de la matrice) ; actions, modes et sujets de 17 §10 et §3.2.13 ; FINANCE à deux
 * personnes de 17 §2.3 (RLS-24). Là où 17 ne nomme pas l'action, la valeur est celle d'ADR-092
 * §1 (PROPOSÉ), citée comme telle.
 */
const MATRIX: Readonly<Record<string, Expected>> = {
  CANCEL_TRIP_GUEST: {
    permission: 'ops.platform_cancel',
    subject: 'TRIP',
    mode: 'DOMAIN_COMMAND',
    keys: [],
    values: {},
    approval: false,
    source: 'ADR-092 §1 (PROPOSÉ ; 17 §10 NN3 « l’ops déclenche »)',
  },
  CANCEL_TRIP_HOST: {
    permission: 'ops.platform_cancel',
    subject: 'TRIP',
    mode: 'DOMAIN_COMMAND',
    keys: [],
    values: {},
    approval: false,
    source: 'ADR-092 §1 (PROPOSÉ)',
  },
  CANCEL_TRIP_PLATFORM: {
    permission: 'ops.platform_cancel',
    subject: 'TRIP',
    mode: 'DOMAIN_COMMAND',
    keys: [],
    values: {},
    approval: false,
    source: '17 §2.3 « ops.platform_cancel (motif plateforme) »',
  },
  DECLARE_NO_SHOW: {
    permission: 'trip.declare_no_show',
    subject: 'TRIP',
    mode: 'DOMAIN_COMMAND',
    keys: [],
    values: {},
    approval: false,
    source: '17 §2.3 « trip.declare_no_show »',
  },
  REFUSE_AT_PICKUP: {
    permission: 'kyc.license_check_at_handover',
    subject: 'TRIP',
    mode: 'DOMAIN_COMMAND',
    keys: [],
    values: {},
    approval: false,
    source: '17 §2.3 « kyc.license_check_at_handover » (OPS oui)',
  },
  KYC_DECISION: {
    permission: 'kyc.decide',
    subject: 'IDENTITY_VERIFICATION',
    mode: 'DOMAIN_COMMAND',
    keys: ['decision'],
    values: DECISION,
    approval: false,
    source: '17 §2.3 « kyc.decide »',
  },
  HOST_VERIFICATION_DECISION: {
    permission: 'ops.review_listing_host',
    subject: 'ORGANIZATION',
    mode: 'DOMAIN_COMMAND',
    keys: ['decision'],
    values: DECISION,
    approval: false,
    source: '17 §2.3 « ops.review_listing_host (revue d’annonce et vérification d’hôte) »',
  },
  PUBLISH_LISTING: {
    permission: 'ops.review_listing_host',
    subject: 'LISTING',
    mode: 'DOMAIN_COMMAND',
    keys: [],
    values: {},
    approval: false,
    source: '17 §2.3 « ops.review_listing_host »',
  },
  ESCALATE_OVERDUE: {
    permission: 'ops.force_terminate_trip',
    subject: 'TRIP',
    mode: 'DOMAIN_COMMAND',
    keys: [],
    values: {},
    approval: false,
    source: 'ADR-092 §1 (PROPOSÉ ; 17 §2.3 « ops.force_terminate_trip »)',
  },
  REVIEW_FLAGGED_BOOKING: {
    permission: 'kyc.decide',
    subject: 'TRIP',
    mode: 'DOMAIN_COMMAND',
    keys: ['decision'],
    values: DECISION,
    approval: false,
    source: 'ADR-092 §1 (PROPOSÉ)',
  },
  RECORD_CLAIM: {
    permission: 'claim.declare',
    subject: 'TRIP',
    mode: 'RECORD_ONLY',
    keys: [],
    values: {},
    approval: false,
    source: '17 §2.3 « claim.declare » ; §10 enregistrement seul',
  },
  ISSUE_DECISION: {
    permission: 'dispute.decide',
    subject: 'TRIP',
    mode: 'RECORD_ONLY',
    keys: [],
    values: {},
    approval: false,
    source: '17 §2.3 « dispute.decide (ADM-008) »',
  },
  RECORD_CHARGEBACK: {
    permission: 'dispute.decide',
    subject: 'TRIP',
    mode: 'RECORD_ONLY',
    keys: [],
    values: {},
    approval: false,
    source: 'ADR-092 §1 (PROPOSÉ)',
  },
  OPEN_INCIDENT: {
    permission: 'claim.declare',
    subject: 'TRIP',
    mode: 'RECORD_ONLY',
    keys: [],
    values: {},
    approval: false,
    source: '17 §2.3 « claim.declare » (incident)',
  },
  RECORD_REVIEW: {
    permission: 'ops.review_listing_host',
    subject: 'TRIP',
    mode: 'RECORD_ONLY',
    keys: [],
    values: {},
    approval: false,
    source: 'ADR-092 §1 (PROPOSÉ)',
  },
  HANDLE_DSR: {
    permission: 'data.export',
    subject: 'SUPPORT_CASE',
    mode: 'RECORD_ONLY',
    keys: [],
    values: {},
    approval: false,
    source: '17 §2.3 « data.export » (ADMIN, journalisé) ; ADR-092 §1',
  },
  ISSUE_BORDEREAU: {
    permission: 'finance.insurer_bordereau',
    subject: 'INSURER_BORDEREAU',
    mode: 'DOMAIN_COMMAND',
    keys: [],
    values: {},
    approval: true,
    source: '17 §2.3 « finance.insurer_bordereau (double validation) »',
  },
  DECIDE_ADVANCE: {
    permission: 'finance.platform_advance',
    subject: 'PLATFORM_ADVANCE',
    mode: 'DOMAIN_COMMAND',
    keys: [],
    values: {},
    approval: true,
    source: '17 §2.3 « finance.platform_advance (double validation) »',
  },
  WRITE_OFF_RECEIVABLE: {
    permission: 'finance.platform_advance',
    subject: 'PLATFORM_ADVANCE',
    mode: 'DOMAIN_COMMAND',
    keys: [],
    values: {},
    approval: true,
    source:
      '17 §2.3 « finance.platform_advance (passer une créance en perte ; double validation) »',
  },
};

interface CatalogRow {
  action_code: string;
  permission_code: string;
  mode: string;
  subject_type: string;
  input_keys: string[];
  input_values: Record<string, string[]>;
  requires_approval: boolean;
  handler: string | null;
}

async function catalog(client: pg.ClientBase): Promise<Map<string, CatalogRow>> {
  const { rows } = await client.query<CatalogRow>(
    `SELECT * FROM test_fixture.us101_catalog() WHERE action_code !~ '^TEST_'`,
  );
  return new Map(rows.map((r) => [r.action_code, r]));
}

describe('catalogue (17 §10 NN9, 17 §2.3, 19 US-101)', () => {
  it('le catalogue minimal de 17 §10 : exactement les 19 actions de 19 US-101', async () => {
    await withRole('app_api', async (client) => {
      const byCode = await catalog(client);
      expect([...byCode.keys()].sort()).toEqual(
        [...STATE_ACTIONS, ...RECORD_ONLY, ...FINANCE].sort(),
      );
      expect(Object.keys(MATRIX).sort()).toEqual([...byCode.keys()].sort());
    });
  });

  it.each(Object.entries(MATRIX))(
    '%s : permission, sujet, mode, clés, valeurs et approbation de la spécification',
    async (action, e) => {
      await withRole('app_api', async (client) => {
        const r = (await catalog(client)).get(action);
        expect(r, `${action} (${e.source})`).toMatchObject({
          permission_code: e.permission,
          subject_type: e.subject,
          mode: e.mode,
          input_keys: [...e.keys],
          input_values: e.values,
          requires_approval: e.approval,
        });
        // une action d'argent n'est liée qu'à la demande FINANCE ; aucune autre n'est liée au lot 1
        expect(r?.handler ?? null, action).toBe(e.approval ? FINANCE_REQUEST : null);
      });
    },
  );

  it('la base refuse une clé qui nomme un montant, une énumération incomplète, et toute valeur qui ne soit pas un mot', async () => {
    await withRole('app_api', async (client) => {
      const tryCatalog = async (k: string[], v: unknown) =>
        (
          await client.query<{ r: string }>(
            'SELECT test_fixture.us101_try_catalog($1, $2::jsonb) AS r',
            [k, JSON.stringify(v)],
          )
        ).rows[0]?.r;
      expect(await tryCatalog(['decision'], DECISION)).toBe('OK');
      for (const k of [['refundAmount'], ['amountMinor'], ['montant'], ['total'], ['fee']]) {
        expect(await tryCatalog(k, { [k[0] ?? '']: ['X'] }), k[0]).toBe(
          '23514:manual_action_catalog_input_keys_format',
        );
      }
      for (const v of [
        {}, // clé déclarée sans énumération
        { decision: [] }, // énumération vide
        { decision: ['APPROVED'], other: ['X'] }, // clé non déclarée
        { decision: ['1500'] }, // nombre
        { decision: ['APPROVED_2'] }, // chiffre
        { decision: [12] }, // pas une chaîne
        { decision: 'APPROVED' }, // pas une liste
      ]) {
        expect(await tryCatalog(['decision'], v), JSON.stringify(v)).toBe(
          '23514:manual_action_catalog_input_values_valid',
        );
      }
    });
  });
});

describe('garde des liaisons : à la liaison, sur toute la table, et à chaque appel', () => {
  const sig = (name: string, input = 'jsonb') =>
    `test_fixture.${name}(bytea,uuid,text,uuid,${input},text,uuid,text)`;

  it.each([
    ['us101_bad_return', 'jsonb', 'retour'],
    ['us101_bad_types', 'text', 'types'],
    ['us101_bad_modes', 'jsonb', 'modes'],
    ['us101_bad_columns', 'jsonb', 'colonnes'],
    ['us101_bad_search_path', 'jsonb', 'search_path'],
    ['us101_bad_invoker', 'jsonb', 'SECURITY DEFINER'],
    ['us101_bad_owner', 'jsonb', 'propriétaire'],
    ['us101_bad_no_staff_exec', 'jsonb', 'EXECUTE iam_staff_owner'],
    ['us101_bad_app_exec', 'jsonb', 'EXECUTE rôle applicatif'],
  ] as const)(
    'contrôle « %s » : la garde nomme le défaut, et la liaison est refusée',
    async (name, input, why) => {
      await withRole('app_api', async (client) => {
        const check = await client.query<{ r: string | null }>(
          'SELECT test_fixture.us101_check($1, $2) AS r',
          ['CANCEL_TRIP_PLATFORM', sig(name, input)],
        );
        expect(check.rows[0]?.r).toBe(why);
        const bind = await client.query<{ r: string }>(
          'SELECT test_fixture.us101_try_bind($1, $2) AS r',
          ['CANCEL_TRIP_PLATFORM', sig(name, input)],
        );
        expect(bind.rows[0]?.r).toBe('23514:manual_action_handler_signature');
      });
    },
  );

  it('domaine et approbation : action d’enregistrement seul refusée ; action d’argent liée à autre chose que la demande FINANCE refusée ; gestionnaires conformes admis', async () => {
    await withRole('app_api', async (client) => {
      const check = async (action: string, handler: string) =>
        (
          await client.query<{ r: string | null }>('SELECT test_fixture.us101_check($1, $2) AS r', [
            action,
            handler,
          ])
        ).rows[0]?.r;
      const bind = async (action: string, handler: string) =>
        (
          await client.query<{ r: string }>('SELECT test_fixture.us101_try_bind($1, $2) AS r', [
            action,
            handler,
          ])
        ).rows[0]?.r;
      const probe = sig('us101_probe_handler');
      expect(await check('RECORD_CLAIM', probe)).toBe('domaine');
      expect(await bind('RECORD_CLAIM', probe)).toBe('23514:manual_action_handler_domain_only');
      for (const a of [...FINANCE, 'TEST_PROBE_APPROVAL']) {
        expect(await check(a, probe), a).toBe('approbation');
        expect(await bind(a, probe), a).toBe('23514:manual_action_handler_approval');
        expect(await check(a, FINANCE_REQUEST), a).toBeNull();
      }
      expect(await check('CANCEL_TRIP_PLATFORM', probe)).toBeNull();
      expect(await bind('CANCEL_TRIP_PLATFORM', probe)).toBe('OK');
    });
  });

  it('invariant : la garde réappliquée à TOUTES les liaisons en base ne trouve rien ; une liaison exposée après coup (GRANT à app_api) est trouvée', async () => {
    await withRole('app_api', async (client) => {
      const all = await client.query('SELECT * FROM test_fixture.us101_check_all_bindings()');
      expect(all.rows).toEqual([]);
      const exposed = await client.query<{ action_code: string; why: string }>(
        'SELECT * FROM test_fixture.us101_check_all_with_exposed()',
      );
      expect(exposed.rows).toEqual([
        { action_code: 'TEST_PROBE_EXPOSED', why: 'EXECUTE rôle applicatif' },
      ]);
      // aucun gestionnaire lié n'est exécutable par un rôle applicatif (lecture directe des droits)
      const { rows } = await client.query<{ api: boolean; worker: boolean; anon: boolean }>(
        `SELECT pg_catalog.has_function_privilege('app_api', $1::regprocedure, 'EXECUTE') AS api,
                pg_catalog.has_function_privilege('app_worker', $1::regprocedure, 'EXECUTE') AS worker,
                pg_catalog.has_function_privilege('app_anon', $1::regprocedure, 'EXECUTE') AS anon`,
        [FINANCE_REQUEST],
      );
      expect(rows).toEqual([{ api: false, worker: false, anon: false }]);
    });
  });

  it('à l’appel : une liaison devenue non conforme rend l’action indisponible (journalisé), la commande n’est jamais appelée ; une action d’argent liée de force à une commande qui rendrait DONE est refusée', async () => {
    await withRole('app_api', async (client) => {
      const ops = await elevatedStaff(client, 'OPS_AGENT', ALL);
      const subject = trip(0);
      await client.query('SELECT test_fixture.us101_force_bind($1, $2)', [
        'TEST_PROBE_EXPOSED',
        sig('us101_bad_app_exec'),
      ]);
      await client.query('SELECT test_fixture.us101_force_bind($1, $2)', [
        'TEST_PROBE_APPROVAL',
        sig('us101_probe_handler'),
      ]);
      try {
        const before = (await effects(client, subject)).length;
        expect((await act(client, ops, 'TEST_PROBE_EXPOSED', subject)).outcome).toBe('UNAVAILABLE');
        expect((await auditOf(client, ops.userId)).at(-1)).toMatchObject({
          action_code: 'MANUAL_ACTION_UNAVAILABLE',
          after: { attempted: 'TEST_PROBE_EXPOSED', handler: 'EXECUTE rôle applicatif' },
        });
        expect(
          (await act(client, ops, 'TEST_PROBE_APPROVAL', subject, { input: { probeMode: 'done' } }))
            .outcome,
        ).toBe('UNAVAILABLE');
        expect((await auditOf(client, ops.userId)).at(-1)).toMatchObject({
          after: { attempted: 'TEST_PROBE_APPROVAL', handler: 'approbation' },
        });
        expect((await effects(client, subject)).length).toBe(before);
      } finally {
        await client.query('SELECT test_fixture.us101_unbind($1)', ['TEST_PROBE_EXPOSED']);
        await client.query('SELECT test_fixture.us101_unbind($1)', ['TEST_PROBE_APPROVAL']);
      }
    });
  });
});

describe('types de sujet déclarés et résolveurs de pays', () => {
  // types de 17 §3.2 qui ont une table en Bêta (attendu tiré du modèle, pas du code) ; les deux
  // autres types du catalogue arriveront avec leur table (US-123, US-124) et devront se déclarer
  const DECLARED = [
    'INSURER_BORDEREAU',
    'ORGANIZATION',
    'PLATFORM_ADVANCE',
    'SUPPORT_CASE',
    'TRIP',
  ];
  const PENDING = ['IDENTITY_VERIFICATION', 'LISTING'];

  it('chaque type de sujet du catalogue est déclaré, sauf ceux dont la table n’existe pas encore ; chaque résolveur est conforme', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ subject_type: string; why: string | null }>(
        'SELECT subject_type, why FROM test_fixture.us101_subjects()',
      );
      expect(rows.map((r) => r.subject_type)).toEqual(DECLARED);
      expect(rows.filter((r) => r.why !== null)).toEqual([]);
      const types = new Set([...(await catalog(client)).values()].map((r) => r.subject_type));
      expect([...types].filter((t) => !DECLARED.includes(t)).sort()).toEqual(PENDING);
    });
  });

  it.each(COUNTRIES.map((c, i) => [c.country, i] as const))(
    '%s : un type déclaré répond toujours « connu », avec le pays de son sujet ; sujet introuvable : connu, sans pays',
    async (country, i) => {
      await withRole('app_api', async (client) => {
        const advance = uuid();
        await client.query(
          `SELECT test_fixture.us062_insert_advance($1, $2, 'HOST_COMPENSATION', 100::bigint)`,
          [advance, trip(i)],
        );
        const bordereau = uuid();
        await client.query('SELECT test_fixture.us062_insert_bordereau($1, $2, $3, 100::bigint)', [
          bordereau,
          country,
          COUNTRIES[i]?.currency,
        ]);
        const cw = world.countries[i];
        const subjects: Record<string, string> = {
          TRIP: trip(i),
          ORGANIZATION: cw?.orgA ?? '',
          SUPPORT_CASE: i === 0 ? world.cases.firstA1 : world.cases.secondA1,
          PLATFORM_ADVANCE: advance,
          INSURER_BORDEREAU: bordereau,
        };
        for (const type of DECLARED) {
          const resolve = async (id: string) =>
            (
              await client.query<{ known: boolean; country: string | null }>(
                'SELECT * FROM test_fixture.us101_resolve($1, $2)',
                [type, id],
              )
            ).rows[0];
          expect(await resolve(subjects[type] ?? ''), type).toEqual({ known: true, country });
          expect(await resolve(uuid()), type).toEqual({ known: true, country: null });
        }
        for (const type of PENDING) {
          expect(
            (await client.query('SELECT * FROM test_fixture.us101_resolve($1, $2)', [type, uuid()]))
              .rows[0],
            type,
          ).toEqual({ known: false, country: null });
        }
      });
    },
  );

  it('la base refuse un résolveur non conforme (signature, droits)', async () => {
    await withRole('app_api', async (client) => {
      const declare = async (resolver: string) =>
        (
          await client.query<{ r: string }>('SELECT test_fixture.us101_try_declare($1, $2) AS r', [
            'LISTING',
            resolver,
          ])
        ).rows[0]?.r;
      expect(await declare('core.support_staff_holds_permission(uuid,text)')).toBe(
        '23514:manual_action_subject_resolver',
      );
      expect(await declare('core.support_country_of_trip(uuid)')).toBe('OK');
    });
  });
});

describe('accès direct', () => {
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
           VALUES ('CANCEL_TRIP_PLATFORM', 'core.support_country_of_trip(uuid)'::regprocedure, 'US-101')`,
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

  it('l’agent ne saisit jamais un montant : clé non déclarée, nombre, chaîne numérique ou valeur hors énumération => 22023, rien n’est écrit', async () => {
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
        { probeMode: 'DONE' }, // énumération fermée : la casse compte
        { probeMode: 'done ' },
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
      // `decision` : énumération fermée {APPROVED, REJECTED} (sujet ORGANIZATION, connu)
      const org = world.countries[0]?.orgA ?? '';
      for (const decision of ['MAYBE', 'approved', 'APPROVED;REJECTED', '1']) {
        await expect(
          act(client, ops, 'HOST_VERIFICATION_DECISION', org, { input: { decision } }),
          decision,
        ).rejects.toMatchObject({ code: '22023' });
      }
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

describe('rejeu concurrent : un même request_id envoyé deux fois en parallèle', () => {
  it.each(COUNTRIES.map((c, i) => [c.country, i] as const))(
    '%s : sur deux connexions, la seconde attend la première puis rend DUPLICATE (jamais une violation d’unicité) ; un seul effet, une seule ligne',
    async (country, i) => {
      await withRole('app_api', async (client) => {
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const subject = trip(i);
        const requestId = uuid();
        const a = await connectAs('app_api');
        const b = await connectAs('app_api');
        try {
          const call = (c: pg.ClientBase) =>
            c.query<Outcome>(ACT, [
              ops.hash,
              requestId,
              'TEST_PROBE_ACTION',
              subject,
              REASON,
              { probeMode: 'done' },
              [],
            ]);
          // A garde sa transaction ouverte après l'action ; B est lancée pendant ce temps
          await a.query('BEGIN');
          const first = await call(a);
          expect(first.rows[0]?.outcome).toBe('DONE');
          const pidB = (await b.query<{ pid: number }>('SELECT pg_catalog.pg_backend_pid() AS pid'))
            .rows[0]?.pid;
          const second = call(b);
          // B est bloquée par A (verrou consultatif du request_id), jamais en erreur
          let waiting = false;
          for (let k = 0; k < 100 && !waiting; k += 1) {
            const { rows } = await client.query<{ w: boolean }>(
              `SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
                               WHERE pid = $1 AND wait_event_type = 'Lock') AS w`,
              [pidB],
            );
            waiting = rows[0]?.w === true;
            if (!waiting) await new Promise((r) => setTimeout(r, 50));
          }
          expect(waiting).toBe(true);
          await a.query('COMMIT');
          const r = await second;
          expect(r.rows[0]).toEqual({
            outcome: 'DUPLICATE',
            action_id: requestId,
            domain_ref: requestId,
            detail: 'DONE',
          });
          expect(
            (await effects(client, subject)).filter((e) => e.request_id === requestId),
          ).toHaveLength(1);
          expect(await manualAction(client, requestId)).toHaveLength(1);
        } finally {
          await a.query('ROLLBACK').catch(() => undefined);
          await releaseClient(a);
          await releaseClient(b);
        }
      });
    },
  );
});
