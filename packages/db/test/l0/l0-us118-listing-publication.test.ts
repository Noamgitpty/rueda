/**
 * Preuves de la publication immédiate d'une annonce, du retrait et de la revue de l'ops sur signal
 * (US-118, migrations 0084 et 0085 ; fixtures 9972) sous le rôle de production app_api (assertion
 * L0-05 en tête de chaque connexion, withRole), en USD (PA) et en PYG (PY). Chaque test crée ses
 * propres hôtes, véhicules, annonces et membres du staff par les VRAIES commandes, dans une
 * transaction ANNULÉE : les interrupteurs `p2p_private_hosts_enabled` et `insurer_contract_active`
 * n'y sont ouverts que par la procédure à deux personnes d'US-125, et rien ne survit au test.
 *
 * Attendus tirés de 19 US-118 (critères 1 à 4 : `LISTING_TRANSITION_FORBIDDEN` ; hôte non vérifié
 * ou véhicule non validé ⇒ refus avec le motif ; CGU ⇒ `TERMS_REACCEPT_REQUIRED` ; trip futur ⇒
 * `LISTING_HAS_FUTURE_TRIPS`), de 16 HST-016 / HST-026 (« Given insurer_contract_active à false
 * dans le pays, When l'ops tente d'approuver une annonce, Then INSURER_CONTRACT_INACTIVE et
 * l'annonce reste PENDING_REVIEW » ; « chaque changement de statut journalisé avec motif »),
 * ADM-003 (`DECISION_RATIONALE_REQUIRED`), de 08 SM-2 et BR-LIST-09 (LISTED → UNLISTED interdit
 * tant qu'un trip est à venir), de 22 OQ-BR-29 (défaut : retrait refusé si trip futur), du BOARD
 * N-62 (zone affichée sans adresse exacte) et de la décision du fondateur DEC-FONDATEUR-22
 * (« jamais plus lourd que Turo » : publication dès les contrôles automatiques ; véhicule hors
 * catalogue non bloquant ; revue de l'ops seulement si le pays l'exige), jamais du code testé.
 *
 * Absence d'effet : chaque refus est suivi du TÉMOIN qui ne diffère que par la condition éprouvée
 * (interrupteur ouvert, véhicule confirmé, zone corrigée, trip passé) : si la garde disparaissait,
 * le refus deviendrait la publication du témoin et le test échouerait.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { approveSwitch, freshSession, requestSwitch } from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import {
  benchPgVersion,
  recordPerf,
  SMOKE_SAMPLES,
  SMOKE_WARMUP,
  summarize,
  timed,
} from '../support/perf.ts';
import { staff as rlsStaff, staffSessionHash } from '../support/rls.ts';
import { elevatedStaff as elevatedRaw, installTestProofKey } from '../support/staff.ts';

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const byCountry = COUNTRIES.map((c) => [c.country, c.currency, c] as const);
/** 08 BR-LIST-05 : au moins 6 photos (`listing_min_photos`, PROPOSÉ). */
const MIN_PHOTOS = 6;
/** Pièces du véhicule : aucune exigée par défaut (DEC-FONDATEUR-22, paramètres `elig_doc_*`). */
const DOC_PARAMS = [
  'elig_doc_title',
  'elig_doc_plate_vin_photo',
  'elig_doc_inspection',
  'elig_doc_compulsory_insurance',
  'elig_doc_owner_authorization',
  'elig_doc_lender_consent',
] as const;

type Tx = pg.ClientBase;

interface Host {
  readonly userId: string;
  readonly hash: Buffer;
  readonly org: string;
  readonly location: string;
}

/** Personne inscrite (compte ACTIVE) et session ouverte par les vraies commandes. */
async function person(c: Tx, country: string): Promise<{ userId: string; hash: Buffer }> {
  const userId = uuid();
  const r = await c.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400, NULL,
                                                $6, $7::jsonb, false) AS ok`,
    [userId, `h118-${userId}@example.test`, phcArgon2id(), uuid(), randomBytes(32), country, DOCS],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await c.query(`SELECT test_fixture.iam_set_account_status($1, 'ACTIVE')`, [userId]);
  const t = newToken();
  const s = await c.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [uuid(), userId, t.hash, SESSION_TTL_S],
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  return { userId, hash: t.hash };
}

const createLocation = async (
  c: Tx,
  h: { hash: Buffer; org: string },
  area: string | null,
  city = 'Ciudad Uno',
): Promise<{ outcome: string; id: string | null }> => {
  const { rows } = await c.query<{ outcome: string; location_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_location($1, $2, 'HOME', 'Casa', 'Calle Ficticia 123',
                                                    $4, $3, NULL, NULL)`,
    [h.hash, h.org, area, city],
  );
  return { outcome: rows[0]?.outcome ?? '', id: rows[0]?.location_id ?? null };
};

/**
 * Hôte : personne, compte d'hôte, CGU de l'hôte v1 acceptées (sauf `terms: false`), lieu dont la
 * zone est un quartier ; compte forcé ACTIVE (sa vérification est prouvée par l0-us123).
 */
async function host(c: Tx, country: string, o: { terms?: boolean } = {}): Promise<Host> {
  const p = await person(c, country);
  const acc = await c.query<{ outcome: string; org_id: string | null }>(
    'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
    [p.hash, country, 'INDIVIDUAL'],
  );
  const org = acc.rows[0]?.org_id;
  if (acc.rows[0]?.outcome !== 'DONE' || !org) throw new Error('compte d’hôte refusé');
  if (o.terms !== false) {
    const t = await c.query<{ outcome: string }>(
      'SELECT * FROM core.ctr_cmd_accept_host_terms($1, $2, 1, $3)',
      [p.hash, org, 'es'],
    );
    if (t.rows[0]?.outcome !== 'DONE') throw new Error('CGU de l’hôte refusées');
  }
  await c.query('SELECT test_fixture.us115_set_org_status($1, $2)', [org, 'ACTIVE']);
  const loc = await createLocation(c, { hash: p.hash, org }, 'Barrio Norte');
  if (loc.outcome !== 'DONE' || !loc.id) throw new Error(`lieu : ${loc.outcome}`);
  return { ...p, org, location: loc.id };
}

const plate = (): string => `P${randomBytes(4).toString('hex').toUpperCase()}`;
const vin = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  return Array.from(randomBytes(17), (b) => alphabet[b % alphabet.length]).join('');
};
/** Année civile en cours dans le fuseau du pays (oracle indépendant de la base). */
const localYear = (cc: CountryCase): number =>
  Number(new Intl.DateTimeFormat('en-CA', { timeZone: cc.timezone, year: 'numeric' }).format());

/** Véhicule au catalogue (ou hors catalogue : marque et modèle saisis), plaque et VIN. */
async function vehicle(
  c: Tx,
  h: Host,
  cc: CountryCase,
  o: { offCatalog?: boolean; location?: string; make?: string; model?: string } = {},
): Promise<string> {
  const variant = o.offCatalog
    ? null
    : (await c.query<{ v: string }>('SELECT test_fixture.us124_variant($1) AS v', [cc.country]))
        .rows[0]?.v;
  const { rows } = await c.query<{ outcome: string; vehicle_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL,
                                                   'MANUAL', 5::smallint, 'GASOLINE', NULL,
                                                   false, false)`,
    [
      h.hash,
      h.org,
      o.location ?? h.location,
      plate(),
      vin(),
      variant ?? null,
      o.offCatalog ? (o.make ?? 'Chery') : null,
      o.offCatalog ? (o.model ?? 'Tiggo 2') : null,
      localYear(cc) - 2,
    ],
  );
  const id = rows[0]?.vehicle_id;
  if (rows[0]?.outcome !== 'DONE' || !id) throw new Error(`véhicule : ${rows[0]?.outcome}`);
  // classe de valeur connue (couverture de l'assureur, US-108 : une donnée inconnue n'est jamais
  // couverte ; la graine ne classe pas toutes les variantes, un véhicule hors catalogue non plus)
  await c.query('SELECT test_fixture.us108_set_value_class($1, $2)', [id, 'STANDARD']);
  return id;
}

/** Déclarations de l'hôte et contrôles automatiques d'US-124 : véhicule ELIGIBLE sans revue. */
async function confirmVehicle(c: Tx, h: Host, vehicleId: string): Promise<void> {
  const d = await c.query<{ outcome: string }>(
    'SELECT * FROM core.catalog_cmd_declare_vehicle($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [h.hash, h.org, vehicleId, 'HOST', false, 42_000, true, true, null],
  );
  expect(d.rows[0]?.outcome).toBe('DONE');
  const s = await c.query<{ outcome: string }>(
    'SELECT * FROM core.catalog_cmd_submit_vehicle_eligibility($1, $2, $3)',
    [h.hash, h.org, vehicleId],
  );
  expect(s.rows[0]?.outcome).toBe('ELIGIBLE');
}

/** Annonce DRAFT au prix du pays, pourvue des photos minimales. */
async function listing(c: Tx, h: Host, cc: CountryCase, vehicleId: string): Promise<string> {
  const lst = await c.query<{ outcome: string; listing_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_listing($1, $2, $3, $4, 'UNLIMITED', NULL, NULL, NULL)`,
    [h.hash, h.org, vehicleId, 40 * cc.priceStepMinor],
  );
  const id = lst.rows[0]?.listing_id;
  if (!id) throw new Error(`annonce : ${lst.rows[0]?.outcome}`);
  for (let i = 0; i < MIN_PHOTOS; i += 1) {
    const p = await c.query<{ outcome: string }>(
      'SELECT * FROM core.catalog_cmd_add_listing_photo($1, $2, $3, $4, $5, $6, $7, $8)',
      [h.hash, h.org, id, uuid(), uuid(), 'image/jpeg', 123_456, randomBytes(32)],
    );
    if (p.rows[0]?.outcome !== 'DONE') throw new Error(`photo : ${p.rows[0]?.outcome}`);
  }
  return id;
}

const cmd = async (c: Tx, fn: string, h: { hash: Buffer; org: string }, id: string) =>
  (await c.query<{ outcome: string }>(`SELECT * FROM core.${fn}($1, $2, $3)`, [h.hash, h.org, id]))
    .rows[0]?.outcome ?? '';
const publish = (c: Tx, h: { hash: Buffer; org: string }, id: string) =>
  cmd(c, 'catalog_cmd_submit_listing', h, id);
const unlist = (c: Tx, h: { hash: Buffer; org: string }, id: string) =>
  cmd(c, 'catalog_cmd_unlist_listing', h, id);
const remove = (c: Tx, h: { hash: Buffer; org: string }, id: string) =>
  cmd(c, 'catalog_cmd_delete_listing', h, id);

const row = async (c: Tx, id: string) =>
  (
    await c.query<{ status: string; submitted_at: Date | null; published_at: Date | null }>(
      'SELECT * FROM test_fixture.us118_listing($1)',
      [id],
    )
  ).rows[0];
const isPublic = async (c: Tx, id: string): Promise<boolean> =>
  (await c.query('SELECT * FROM core.catalog_public_listing($1)', [id])).rows.length > 0;
const auditOf = async (c: Tx, id: string) =>
  (
    await c.query<{ action_code: string; actor_role: string; payload: string }>(
      'SELECT * FROM test_fixture.us124_audit($1)',
      [id],
    )
  ).rows;
const itemsOf = async (c: Tx, subject: string) =>
  (
    await c.query<{
      id: string;
      queue: string;
      subject_type: string;
      status: string;
      decision: string | null;
    }>('SELECT * FROM test_fixture.us124_vehicle_items($1)', [subject])
  ).rows;

/**
 * Pièces non exigées, revue du pays fixée à `review` et contrat d'assureur en vigueur (US-108),
 * dans la transaction annulée.
 */
async function countryRules(c: Tx, country: string, review: boolean): Promise<void> {
  for (const key of DOC_PARAMS) {
    await c.query('SELECT test_fixture.us124_param_version($1, $2, $3::jsonb)', [
      key,
      country,
      'false',
    ]);
  }
  await c.query('SELECT test_fixture.us118_param_version($1, $2, $3::jsonb)', [
    'listing_manual_review_required',
    country,
    review ? 'true' : 'false',
  ]);
  // contrat d'assureur en vigueur couvrant les véhicules de test (US-108, 0081)
  await c.query('SELECT test_fixture.us108_insurer_contract($1, $2, $3)', [
    country,
    50,
    ['STANDARD', 'PREMIUM', 'LUXE'],
  ]);
}

/**
 * Ouvre un interrupteur dans la transaction ANNULÉE de l'appelant par la procédure à deux
 * personnes d'US-125 (demande d'un ADMIN, approbation d'un SUPERADMIN).
 */
async function openSwitch(
  c: Tx,
  key: 'p2p_private_hosts_enabled' | 'insurer_contract_active',
  country: string,
): Promise<void> {
  const actor = async (role: string): Promise<StaffActor> => {
    const id = await rlsStaff(c, role, [country]);
    return { userId: id, hash: Buffer.from(staffSessionHash(id) ?? '', 'hex'), scope: [country] };
  };
  const requester = await actor('ADMIN');
  const approver = await freshSession(c, await actor('SUPERADMIN'));
  const r = await requestSwitch(c, requester, key, country, true);
  if (r.outcome !== 'REQUESTED' || r.request_id === null) throw new Error(`demande : ${r.outcome}`);
  const a = await approveSwitch(c, approver, r.request_id);
  if (a.outcome !== 'APPLIED') throw new Error(`approbation : ${a.outcome}`);
}

/** Corps du test dans une transaction annulée, sous app_api (L0-05 par withRole). */
const rolledBack = (body: (tx: Tx) => Promise<void>) =>
  withRole('app_api', (client) => withTestTransaction(client, {}, body));

type Staff = Awaited<ReturnType<typeof elevatedRaw>>;
async function ops(c: Tx, role: string, country: string): Promise<Staff> {
  await installTestProofKey(c);
  return elevatedRaw(c, role, [country]);
}
interface Result {
  readonly outcome: string;
  readonly body: Record<string, unknown> | null;
}
const claimItem = async (c: Tx, s: Staff, item: string): Promise<string> =>
  (
    await c.query<{ outcome: string }>('SELECT * FROM core.support_staff_claim_item($1, $2, $3)', [
      s.hash,
      uuid(),
      item,
    ])
  ).rows[0]?.outcome ?? '';
const decide = async (
  c: Tx,
  s: Staff,
  item: string,
  decision: string,
  reason: string | null,
): Promise<Result> =>
  (
    await c.query<Result>('SELECT * FROM core.support_staff_decide_listing($1, $2, $3, $4, $5)', [
      s.hash,
      uuid(),
      item,
      decision,
      reason,
    ])
  ).rows[0] ?? { outcome: '', body: null };

// ---------------------------------------------------------------------------------------------
describe('socle (0084, 0085) : paramètre, droits, propriétaires', () => {
  it.each(byCountry)(
    '%s (%s) : listing_manual_review_required = false (DEC-FONDATEUR-22, PROPOSÉ) ; interrupteurs fermés',
    async (country) => {
      await withRole('app_api', async (client) => {
        const { rows } = await client.query<{ value: unknown }>(
          `SELECT v.value FROM core.config_param_value v
            WHERE v.key = 'listing_manual_review_required' AND v.country_code = $1
              AND v.valid_from <= platform.now() AND (v.valid_to IS NULL OR v.valid_to > platform.now())
            ORDER BY v.valid_from DESC LIMIT 1`,
          [country],
        );
        expect(rows[0]?.value).toBe(false);
        for (const key of ['p2p_private_hosts_enabled', 'insurer_contract_active']) {
          const g = await client.query<{ on: boolean }>(
            'SELECT core.config_go_live($1, $2) AS "on"',
            [key, country],
          );
          expect(g.rows[0]?.on, key).toBe(false);
        }
      });
    },
  );

  it('fonctions : propriétaire, SECURITY DEFINER au plus juste, EXECUTE minimal ; app_worker et app_anon n’exécutent rien', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<{
          fn: string;
          owner: string;
          secdef: boolean;
          api: boolean;
          worker: boolean;
          anon: boolean;
          staff: boolean;
        }>(
          `SELECT p.oid::regprocedure::text AS fn, pg_catalog.pg_get_userbyid(p.proowner) AS owner,
                  p.prosecdef AS secdef,
                  pg_catalog.has_function_privilege('app_api', p.oid, 'EXECUTE') AS api,
                  pg_catalog.has_function_privilege('app_worker', p.oid, 'EXECUTE') AS worker,
                  pg_catalog.has_function_privilege('app_anon', p.oid, 'EXECUTE') AS anon,
                  pg_catalog.has_function_privilege('iam_staff_owner', p.oid, 'EXECUTE') AS staff
             FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'core' AND p.proname IN ('catalog_area_label_is_address',
                  'catalog_public_text_norm', 'catalog_text_has_contact',
                  'catalog_text_has_address_marker', 'catalog_vehicle_text_is_invalid',
                  'catalog_listing_publish_blocker', 'catalog_cmd_unlist_listing',
                  'catalog_listing_decide', 'support_staff_decide_listing')
            ORDER BY 1`,
        );
        expect(rows).toEqual([
          {
            fn: 'core.catalog_area_label_is_address(text)',
            owner: 'catalog_cmd_owner',
            secdef: false,
            api: false,
            worker: false,
            anon: false,
            staff: false,
          },
          {
            fn: 'core.catalog_cmd_unlist_listing(bytea,uuid,uuid)',
            owner: 'catalog_cmd_owner',
            secdef: true,
            api: true,
            worker: false,
            anon: false,
            staff: false,
          },
          {
            fn: 'core.catalog_listing_decide(uuid,text,uuid,text,text,text)',
            owner: 'catalog_cmd_owner',
            secdef: true,
            api: false,
            worker: false,
            anon: false,
            staff: true,
          },
          {
            fn: 'core.catalog_listing_publish_blocker(uuid,uuid,text,text)',
            owner: 'catalog_cmd_owner',
            secdef: false,
            api: false,
            worker: false,
            anon: false,
            staff: false,
          },
          {
            fn: 'core.catalog_public_text_norm(text)',
            owner: 'catalog_cmd_owner',
            secdef: false,
            api: false,
            worker: false,
            anon: false,
            staff: false,
          },
          {
            fn: 'core.catalog_text_has_address_marker(text)',
            owner: 'catalog_cmd_owner',
            secdef: false,
            api: false,
            worker: false,
            anon: false,
            staff: false,
          },
          {
            fn: 'core.catalog_text_has_contact(text)',
            owner: 'catalog_cmd_owner',
            secdef: false,
            api: false,
            worker: false,
            anon: false,
            staff: false,
          },
          {
            fn: 'core.catalog_vehicle_text_is_invalid(text)',
            owner: 'catalog_cmd_owner',
            secdef: false,
            api: false,
            worker: false,
            anon: false,
            staff: false,
          },
          {
            fn: 'core.support_staff_decide_listing(bytea,uuid,uuid,text,text)',
            owner: 'iam_staff_owner',
            secdef: true,
            api: true,
            worker: false,
            anon: false,
            staff: true,
          },
        ]);
        // app_api n'appelle ni le domaine de l'ops, ni les aides internes (42501)
        for (const sql of [
          `SELECT core.catalog_area_label_is_address('Calle 50')`,
          `SELECT core.catalog_listing_publish_blocker('${uuid()}', '${uuid()}', 'PA', 'ACTIVE')`,
          `SELECT * FROM core.catalog_listing_decide('${uuid()}', 'PA', '${uuid()}', 'ADMIN', 'APPROVE', NULL)`,
        ]) {
          await client.query('BEGIN');
          try {
            await expect(client.query(sql), sql).rejects.toMatchObject({ code: '42501' });
          } finally {
            await client.query('ROLLBACK');
          }
        }
      },
      { database: 'production' },
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe('publication immédiate (DEC-FONDATEUR-22) : contrôles automatiques, motif rendu, journal', () => {
  it.each(byCountry)(
    '%s (%s) : pays fermé ⇒ HOST_NOT_ACTIVATED ; interrupteur de l’assureur fermé ⇒ INSURER_CONTRACT_INACTIVE ; véhicule non confirmé ⇒ VEHICLE_ELIGIBILITY_REQUIRED ; tout passe ⇒ LISTED sans revue, fiche publique, journal ; seconde publication ⇒ LISTING_TRANSITION_FORBIDDEN',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        await countryRules(tx, country, false);
        const h = await host(tx, country);
        const v = await vehicle(tx, h, cc);
        const id = await listing(tx, h, cc, v);
        // interrupteurs fermés (graine) : hôte non activable, l'annonce reste DRAFT
        expect(await publish(tx, h, id)).toBe('HOST_NOT_ACTIVATED');
        await openSwitch(tx, 'p2p_private_hosts_enabled', country);
        // contrat en vigueur mais interrupteur de l'assureur fermé (17 §0.1) : DRAFT, rien de public
        expect(await publish(tx, h, id)).toBe('INSURER_CONTRACT_INACTIVE');
        expect(await row(tx, id)).toMatchObject({
          status: 'DRAFT',
          submitted_at: null,
          published_at: null,
        });
        expect(await isPublic(tx, id)).toBe(false);
        await openSwitch(tx, 'insurer_contract_active', country);
        // véhicule pas encore confirmé par l'hôte (US-124) : motif rendu, DRAFT
        expect(await publish(tx, h, id)).toBe('VEHICLE_ELIGIBILITY_REQUIRED');
        expect((await row(tx, id))?.status).toBe('DRAFT');
        // TÉMOIN : tout passe ⇒ publiée sur-le-champ, aucune revue de l'ops
        await confirmVehicle(tx, h, v);
        expect(await publish(tx, h, id)).toBe('LISTED');
        const after = await row(tx, id);
        expect(after?.status).toBe('LISTED');
        expect(after?.published_at).not.toBeNull();
        expect(await isPublic(tx, id)).toBe(true);
        expect(await itemsOf(tx, id)).toEqual([]);
        const log = await auditOf(tx, id);
        expect(log.map((l) => [l.action_code, l.actor_role])).toEqual([
          ['LISTING_PUBLISHED', 'P2P_HOST'],
        ]);
        expect(log[0]?.payload).toContain('"status": "DRAFT"');
        expect(log[0]?.payload).toContain('"status": "LISTED"');
        expect(log[0]?.payload).toContain('AUTO_CHECKS');
        // critère 1 : transition absente de SM-2
        expect(await publish(tx, h, id)).toBe('LISTING_TRANSITION_FORBIDDEN');
        expect(await remove(tx, h, id)).toBe('LISTING_TRANSITION_FORBIDDEN');
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : critère 3 — CGU de l’hôte non acceptées ⇒ TERMS_REACCEPT_REQUIRED (témoin acceptées : LISTED) ; critère 2 — compte non ACTIVE (vérification non APPROVED) ⇒ HOST_NOT_ACTIVATED',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        await countryRules(tx, country, false);
        await openSwitch(tx, 'p2p_private_hosts_enabled', country);
        await openSwitch(tx, 'insurer_contract_active', country);
        const h = await host(tx, country, { terms: false });
        const v = await vehicle(tx, h, cc);
        await confirmVehicle(tx, h, v);
        const id = await listing(tx, h, cc, v);
        expect(await publish(tx, h, id)).toBe('TERMS_REACCEPT_REQUIRED');
        expect((await row(tx, id))?.status).toBe('DRAFT');
        // compte d'hôte en attente d'activation (dossier non approuvé, US-123) : refus
        await tx.query('SELECT test_fixture.us115_set_org_status($1, $2)', [
          h.org,
          'PENDING_ACTIVATION',
        ]);
        const t = await tx.query<{ outcome: string }>(
          'SELECT * FROM core.ctr_cmd_accept_host_terms($1, $2, 1, $3)',
          [h.hash, h.org, 'es'],
        );
        expect(t.rows[0]?.outcome).toBe('DONE');
        expect(await publish(tx, h, id)).toBe('HOST_NOT_ACTIVATED');
        expect((await row(tx, id))?.status).toBe('DRAFT');
        // TÉMOIN : compte ACTIVE, CGU acceptées
        await tx.query('SELECT test_fixture.us115_set_org_status($1, $2)', [h.org, 'ACTIVE']);
        expect(await publish(tx, h, id)).toBe('LISTED');
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : véhicule hors catalogue (marque et modèle saisis) ⇒ ELIGIBLE puis LISTED ; la demande d’ajout reste OPEN, sans bloquer',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        await countryRules(tx, country, false);
        await openSwitch(tx, 'p2p_private_hosts_enabled', country);
        await openSwitch(tx, 'insurer_contract_active', country);
        const h = await host(tx, country);
        const v = await vehicle(tx, h, cc, { offCatalog: true });
        const requests = await tx.query<{ status: string }>(
          'SELECT * FROM core.catalog_host_addition_requests($1, $2)',
          [h.hash, h.org],
        );
        expect(requests.rows.map((r) => r.status)).toEqual(['OPEN']);
        await confirmVehicle(tx, h, v);
        const id = await listing(tx, h, cc, v);
        expect(await publish(tx, h, id)).toBe('LISTED');
        expect(await isPublic(tx, id)).toBe(true);
        const still = await tx.query<{ status: string }>(
          'SELECT * FROM core.catalog_host_addition_requests($1, $2)',
          [h.hash, h.org],
        );
        expect(still.rows.map((r) => r.status)).toEqual(['OPEN']);
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('revue sécurité n° 1 — marque et modèle saisis (hors catalogue) : ni adresse ni contact', () => {
  it.each(byCountry)(
    '%s (%s) : modèle avec téléphone, courriel ou adresse ⇒ VEHICLE_DESCRIPTION_INVALID (DRAFT) ; témoins « Peugeot 208 », « Ram 1500 » ⇒ LISTED',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        await countryRules(tx, country, false);
        await openSwitch(tx, 'p2p_private_hosts_enabled', country);
        await openSwitch(tx, 'insurer_contract_active', country);
        const h = await host(tx, country);
        for (const [make, model] of [
          ['Chery', 'Tiggo 2 llamar 6123-4567'],
          ['Chery', 'Tiggo ana@example.test'],
          ['Toyota wa.me', 'Yaris'],
          ['Kia', 'Rio casa 12'],
        ] as const) {
          const v = await vehicle(tx, h, cc, { offCatalog: true, make, model });
          await confirmVehicle(tx, h, v);
          const id = await listing(tx, h, cc, v);
          expect(await publish(tx, h, id), `${make} ${model}`).toBe('VEHICLE_DESCRIPTION_INVALID');
          expect((await row(tx, id))?.status).toBe('DRAFT');
          expect(await isPublic(tx, id)).toBe(false);
        }
        for (const [make, model] of [
          ['Peugeot', '208'],
          ['Ram', '1500'],
        ] as const) {
          const v = await vehicle(tx, h, cc, { offCatalog: true, make, model });
          await confirmVehicle(tx, h, v);
          const id = await listing(tx, h, cc, v);
          expect(await publish(tx, h, id), `${make} ${model}`).toBe('LISTED');
        }
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('BOARD N-62 — zone affichée sans adresse exacte (filtre automatique)', () => {
  /** Adresses exactes ou angles de rues : refusés (numéro de rue, voie ou logement numérotés). */
  const ADDRESSES = [
    'Calle 50 #12',
    'Cll. 50 12',
    'Calle: 74 Este 15',
    'Casa No. 12',
    'PH 12B',
    'Bloque 5',
    'Av. Mariscal López 1234',
    'Edificio Sol, apto 12',
    'Casa 23',
    'Torre 2',
    'N° 3794',
    'nro 45',
    '#12',
    'Mcal. López esq. Kubitschek',
    'Palma c/ Alberdi',
    '12345',
    // contournements : chiffres pleine chasse, touches d'émoji, espace de largeur nulle
    '\uFF11\uFF12\uFF13\uFF14',
    'Casa 1\uFE0F\u20E32\uFE0F\u20E3',
    'N\u200B° 12',
    // contacts hors plateforme
    'Llamar al 6123-4567',
    'ana@example.test',
    'www.ejemplo.test',
    'WhatsApp Ana',
  ];
  /** Quartiers et zones : admis. */
  const AREAS = [
    'Barrio Norte',
    'Costa del Este',
    'Villa Morra',
    'Vía España',
    'Zona 1',
    'Obarrio',
    // voie seule : quartier connu (faux positif corrigé, revue sécurité n° 3)
    'Calle 50',
    'Avenida 25 de Mayo',
    'Esquina Tropical',
  ];
  /** Villes : même filtre (texte libre public, revue sécurité n° 1). */
  const BAD_CITIES = ['Calle 50 #12', 'Ciudad 6123-4567', 'Casa 4'];
  const CITIES = ['Ciudad de Panamá', 'Ciudad del Este', 'San Lorenzo'];

  it.each(byCountry)(
    '%s (%s) : création du lieu ⇒ LOCATION_AREA_ADDRESS ou LOCATION_CITY_INVALID (normalisation NFKC, invisibles, contacts), rien n’est écrit (témoins : quartiers et villes admis, « Calle 50 ») ; lieu antérieur au filtre ⇒ publication refusée, zone et ville corrigées ⇒ LISTED',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        await countryRules(tx, country, false);
        const h = await host(tx, country);
        const locations = async () =>
          (await tx.query('SELECT * FROM core.catalog_host_locations($1, $2)', [h.hash, h.org]))
            .rows.length;
        const before = await locations();
        for (const area of ADDRESSES) {
          expect((await createLocation(tx, h, area)).outcome, area).toBe('LOCATION_AREA_ADDRESS');
        }
        expect(await locations()).toBe(before);
        for (const area of AREAS) {
          expect((await createLocation(tx, h, area)).outcome, area).toBe('DONE');
        }
        expect(await locations()).toBe(before + AREAS.length);
        for (const city of BAD_CITIES) {
          expect((await createLocation(tx, h, 'Barrio Norte', city)).outcome, city).toBe(
            'LOCATION_CITY_INVALID',
          );
        }
        for (const city of CITIES) {
          expect((await createLocation(tx, h, 'Barrio Norte', city)).outcome, city).toBe('DONE');
        }
        expect(await locations()).toBe(before + AREAS.length + CITIES.length);

        await openSwitch(tx, 'p2p_private_hosts_enabled', country);
        await openSwitch(tx, 'insurer_contract_active', country);
        const v = await vehicle(tx, h, cc);
        await confirmVehicle(tx, h, v);
        const id = await listing(tx, h, cc, v);
        // lieu écrit avant le filtre de la commande : la publication le refuse aussi
        await tx.query('SELECT test_fixture.us118_set_area($1, $2)', [
          h.location,
          'Calle 50 N° 12',
        ]);
        expect(await publish(tx, h, id)).toBe('LOCATION_AREA_ADDRESS');
        expect((await row(tx, id))?.status).toBe('DRAFT');
        // ville écrite avant le filtre : refusée à la publication
        await tx.query('SELECT test_fixture.us118_set_area($1, $2)', [h.location, 'Barrio Norte']);
        await tx.query('SELECT test_fixture.us118_set_city($1, $2)', [h.location, 'Tel 6123 4567']);
        expect(await publish(tx, h, id)).toBe('LOCATION_CITY_INVALID');
        expect((await row(tx, id))?.status).toBe('DRAFT');
        // TÉMOIN : zone et ville corrigées
        await tx.query('SELECT test_fixture.us118_set_city($1, $2)', [h.location, 'Ciudad Uno']);
        expect(await publish(tx, h, id)).toBe('LISTED');
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('critère 4 et SM-2 — retrait, remise en ligne, suppression (OQ-BR-29, BR-LIST-09)', () => {
  it.each(byCountry)(
    '%s (%s) : trip à venir ⇒ LISTING_HAS_FUTURE_TRIPS (annonce LISTED) ; témoin trip passé ⇒ UNLISTED, plus publique ; remise en ligne ⇒ LISTED ; suppression d’une annonce retirée avec trip à venir refusée, sans trip permise',
    async (country, currency, cc) => {
      await rolledBack(async (tx) => {
        await countryRules(tx, country, false);
        await openSwitch(tx, 'p2p_private_hosts_enabled', country);
        await openSwitch(tx, 'insurer_contract_active', country);
        const h = await host(tx, country);
        const guest = await person(tx, country);
        const day = 86_400_000;
        const trip = (vehicleId: string, start: number, end: number) =>
          tx.query('SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
            uuid(),
            guest.userId,
            h.org,
            vehicleId,
            country,
            currency,
            cc.timezone,
            new Date(Date.now() + start * day),
            new Date(Date.now() + end * day),
          ]);
        const busyCar = await vehicle(tx, h, cc);
        await confirmVehicle(tx, h, busyCar);
        const busy = await listing(tx, h, cc, busyCar);
        // SM-2 : un brouillon ne se retire pas
        expect(await unlist(tx, h, busy)).toBe('LISTING_TRANSITION_FORBIDDEN');
        expect(await publish(tx, h, busy)).toBe('LISTED');
        await trip(busyCar, 10, 12);
        expect(await unlist(tx, h, busy)).toBe('LISTING_HAS_FUTURE_TRIPS');
        expect((await row(tx, busy))?.status).toBe('LISTED');
        expect(await isPublic(tx, busy)).toBe(true);

        // TÉMOIN : même hôte, autre véhicule dont le seul trip est terminé
        const freeCar = await vehicle(tx, h, cc);
        await confirmVehicle(tx, h, freeCar);
        const free = await listing(tx, h, cc, freeCar);
        expect(await publish(tx, h, free)).toBe('LISTED');
        await trip(freeCar, -5, -3);
        expect(await unlist(tx, h, free)).toBe('DONE');
        expect((await row(tx, free))?.status).toBe('UNLISTED');
        expect(await isPublic(tx, free)).toBe(false);
        expect(await unlist(tx, h, free)).toBe('LISTING_TRANSITION_FORBIDDEN');
        // remise en ligne : mêmes contrôles, publiée de nouveau
        expect(await publish(tx, h, free)).toBe('LISTED');
        expect(await isPublic(tx, free)).toBe(true);
        expect(await unlist(tx, h, free)).toBe('DONE');
        expect((await auditOf(tx, free)).map((l) => l.action_code)).toEqual([
          'LISTING_PUBLISHED',
          'LISTING_UNLISTED',
          'LISTING_PUBLISHED',
          'LISTING_UNLISTED',
        ]);
        // un HOLD à venir (paiement en cours) bloque aussi le retrait (revue sécurité)
        const holdCar = await vehicle(tx, h, cc);
        await confirmVehicle(tx, h, holdCar);
        const held = await listing(tx, h, cc, holdCar);
        expect(await publish(tx, h, held)).toBe('LISTED');
        await tx.query(
          `SELECT test_fixture.occ_insert_raw($1, $2, $3, $4, 'HOLD',
                    pg_catalog.tstzrange($5::timestamptz, $6::timestamptz, '[)'))`,
          [
            uuid(),
            holdCar,
            h.org,
            country,
            new Date(Date.now() + 30 * day),
            new Date(Date.now() + 32 * day),
          ],
        );
        expect(await unlist(tx, h, held)).toBe('LISTING_HAS_FUTURE_TRIPS');
        expect((await row(tx, held))?.status).toBe('LISTED');
        // suppression d'une annonce retirée : refusée si un trip est à venir, permise sinon
        await trip(freeCar, 20, 22);
        expect(await remove(tx, h, free)).toBe('LISTING_HAS_FUTURE_TRIPS');
        expect((await row(tx, free))?.status).toBe('UNLISTED');
        expect(await remove(tx, h, busy)).toBe('LISTING_TRANSITION_FORBIDDEN');
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : suppression d’une annonce retirée sans trip à venir ⇒ DELETED ; IDOR : annonce d’un autre hôte ⇒ LISTING_NOT_FOUND, compte d’un autre ⇒ FORBIDDEN, jeton forgé ⇒ AUTH_REQUIRED',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        await countryRules(tx, country, false);
        await openSwitch(tx, 'p2p_private_hosts_enabled', country);
        await openSwitch(tx, 'insurer_contract_active', country);
        const a = await host(tx, country);
        const b = await host(tx, country);
        const v = await vehicle(tx, a, cc);
        await confirmVehicle(tx, a, v);
        const id = await listing(tx, a, cc, v);
        expect(await publish(tx, a, id)).toBe('LISTED');
        expect(await unlist(tx, b, id)).toBe('LISTING_NOT_FOUND');
        expect(await unlist(tx, { hash: b.hash, org: a.org }, id)).toBe('FORBIDDEN');
        expect(await unlist(tx, { hash: randomBytes(32), org: a.org }, id)).toBe('AUTH_REQUIRED');
        expect((await row(tx, id))?.status).toBe('LISTED');
        expect(await unlist(tx, a, id)).toBe('DONE');
        expect(await remove(tx, b, id)).toBe('LISTING_NOT_FOUND');
        expect(await remove(tx, a, id)).toBe('DONE');
        expect((await row(tx, id))?.status).toBe('DELETED');
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('revue de l’ops seulement si le pays l’exige (listing_manual_review_required)', () => {
  it.each(byCountry)(
    '%s (%s) : pays qui exige la revue ⇒ PENDING_REVIEW et élément LISTING ; approbation sans contrat d’assureur ⇒ INSURER_CONTRACT_INACTIVE, l’annonce reste PENDING_REVIEW (16 HST-016) ; contrat actif ⇒ LISTED, élément clos, journal',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        await countryRules(tx, country, true);
        await openSwitch(tx, 'p2p_private_hosts_enabled', country);
        await openSwitch(tx, 'insurer_contract_active', country);
        const h = await host(tx, country);
        const v = await vehicle(tx, h, cc);
        await confirmVehicle(tx, h, v);
        const id = await listing(tx, h, cc, v);
        expect(await publish(tx, h, id)).toBe('PENDING_REVIEW');
        expect((await row(tx, id))?.status).toBe('PENDING_REVIEW');
        expect(await isPublic(tx, id)).toBe(false);
        const items = await itemsOf(tx, id);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
          queue: 'LISTING',
          subject_type: 'LISTING',
          status: 'OPEN',
        });
        const item = items[0]?.id ?? '';
        const agent = await ops(tx, 'OPS_AGENT', country);
        // élément non pris en charge : refus, rien n'est écrit
        expect((await decide(tx, agent, item, 'APPROVE', null)).outcome).toBe('CASE_REQUIRED');
        expect(await claimItem(tx, agent, item)).toBe('CLAIMED');
        // interrupteur du contrat d'assureur refermé (deux personnes) : approbation refusée
        const actor = async (role: string): Promise<StaffActor> => {
          const sid = await rlsStaff(tx, role, [country]);
          return {
            userId: sid,
            hash: Buffer.from(staffSessionHash(sid) ?? '', 'hex'),
            scope: [country],
          };
        };
        const close = await requestSwitch(
          tx,
          await actor('ADMIN'),
          'insurer_contract_active',
          country,
          false,
        );
        expect(close.outcome).toBe('REQUESTED');
        const approver = await freshSession(tx, await actor('SUPERADMIN'));
        expect((await approveSwitch(tx, approver, close.request_id ?? '')).outcome).toBe('APPLIED');
        expect((await decide(tx, agent, item, 'APPROVE', null)).outcome).toBe(
          'INSURER_CONTRACT_INACTIVE',
        );
        expect((await row(tx, id))?.status).toBe('PENDING_REVIEW');
        expect((await itemsOf(tx, id))[0]?.status).not.toBe('DONE');
        // TÉMOIN : contrat de nouveau actif ⇒ publiée, élément clos APPROVED
        await openSwitch(tx, 'insurer_contract_active', country);
        const ok = await decide(tx, agent, item, 'APPROVE', null);
        expect(ok).toMatchObject({
          outcome: 'DECIDED',
          body: { itemId: item, listingId: id, status: 'LISTED' },
        });
        expect((await row(tx, id))?.status).toBe('LISTED');
        expect(await isPublic(tx, id)).toBe(true);
        expect((await itemsOf(tx, id))[0]).toMatchObject({ status: 'DONE', decision: 'APPROVED' });
        expect((await auditOf(tx, id)).map((l) => [l.action_code, l.actor_role])).toEqual([
          ['LISTING_SUBMITTED', 'P2P_HOST'],
          ['LISTING_PUBLISHED', 'OPS_AGENT'],
          // journal chaîné de la console (codes seulement), écrit en dernier
          ['LISTING_REVIEW_DECIDED', 'OPS_AGENT'],
        ]);
        // décision sur une annonce plus en revue
        expect((await decide(tx, agent, item, 'REJECT', 'PHOTO_QUALITY')).outcome).not.toBe(
          'DECIDED',
        );
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : refus sans motif de la liste ⇒ DECISION_RATIONALE_REQUIRED (annonce en revue) ; refus motivé ⇒ REJECTED, journal avec motif ; correction ⇒ nouvelle soumission en revue ; ops d’un autre pays ⇒ FORBIDDEN',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        await countryRules(tx, country, true);
        await openSwitch(tx, 'p2p_private_hosts_enabled', country);
        await openSwitch(tx, 'insurer_contract_active', country);
        const h = await host(tx, country);
        const v = await vehicle(tx, h, cc);
        await confirmVehicle(tx, h, v);
        const id = await listing(tx, h, cc, v);
        expect(await publish(tx, h, id)).toBe('PENDING_REVIEW');
        const item = (await itemsOf(tx, id))[0]?.id ?? '';
        const other = COUNTRIES.find((x) => x.country !== country)?.country ?? '';
        const foreign = await ops(tx, 'OPS_AGENT', other);
        expect((await decide(tx, foreign, item, 'REJECT', 'PHOTO_QUALITY')).outcome).toBe(
          'FORBIDDEN',
        );
        const agent = await ops(tx, 'OPS_AGENT', country);
        expect(await claimItem(tx, agent, item)).toBe('CLAIMED');
        for (const reason of [null, 'OTHER']) {
          expect((await decide(tx, agent, item, 'REJECT', reason)).outcome, String(reason)).toBe(
            'DECISION_RATIONALE_REQUIRED',
          );
        }
        expect((await row(tx, id))?.status).toBe('PENDING_REVIEW');
        const rejected = await decide(tx, agent, item, 'REJECT', 'ADDRESS_VISIBLE');
        expect(rejected).toMatchObject({ outcome: 'DECIDED', body: { status: 'REJECTED' } });
        expect((await row(tx, id))?.status).toBe('REJECTED');
        expect((await itemsOf(tx, id))[0]).toMatchObject({ status: 'DONE', decision: 'REJECTED' });
        const log = await auditOf(tx, id);
        expect(log.map((l) => l.action_code)).toEqual([
          'LISTING_SUBMITTED',
          'LISTING_REJECTED',
          'LISTING_REVIEW_DECIDED',
        ]);
        expect(log[1]?.payload).toContain('ADDRESS_VISIBLE');
        // SM-2 : REJECTED → correction et nouvelle soumission, de nouveau en revue
        expect(await publish(tx, h, id)).toBe('PENDING_REVIEW');
        expect((await itemsOf(tx, id)).filter((i) => i.status === 'OPEN')).toHaveLength(1);
      });
    },
  );
});

// US-045 : performance de fumée de la publication d'une annonce (catalog_cmd_submit_listing, ADR-119) :
// annonces prêtes d'un même hôte, interrupteurs ouverts dans la transaction ANNULÉE (procédure à deux
// personnes d'US-125) ; chaque publication doit rendre LISTED. Aucune cible dans 17 §6.7 : durée
// consignée sans alerte (révision proposée, N-16). Mesure dans la transaction : sans le COMMIT.
describe('US-045 — fumée de performance : publication d’une annonce', () => {
  it.each(byCountry)(
    '%s (%s) : publications séquentielles, p95 consigné, chaque issue LISTED',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        await countryRules(tx, country, false);
        await openSwitch(tx, 'p2p_private_hosts_enabled', country);
        await openSwitch(tx, 'insurer_contract_active', country);
        const h = await host(tx, country);
        const ready: string[] = [];
        for (let i = 0; i < SMOKE_WARMUP + SMOKE_SAMPLES; i += 1) {
          const v = await vehicle(tx, h, cc);
          ready.push(await listing(tx, h, cc, v));
          await confirmVehicle(tx, h, v);
        }
        const ms: number[] = [];
        for (const [i, id] of ready.entries()) {
          const { value, ms: d } = await timed(() => publish(tx, h, id));
          expect(value).toBe('LISTED');
          if (i >= SMOKE_WARMUP) ms.push(d);
        }
        const record = recordPerf({
          series: 'publication.sequentielle',
          country,
          summary: summarize(ms),
          pgVersion: await benchPgVersion(),
          details: { warmup: SMOKE_WARMUP, form: 'dans une transaction annulée, sans COMMIT' },
        });
        expect(record.n).toBe(SMOKE_SAMPLES);
      });
    },
    180_000,
  );
});
