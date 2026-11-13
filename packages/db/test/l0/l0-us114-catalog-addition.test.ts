/**
 * Preuves de la file d'ajout au catalogue véhicules (US-114, migration 0074 ; fixtures 9988) sous
 * le rôle de production app_api (assertion L0-05 en tête de chaque connexion, withRole), en USD
 * (PA) et en PYG (PY). Chaque test crée ses propres hôtes, véhicules, annonces et membres du staff
 * (élévation TOTP réelle) par les VRAIES commandes.
 *
 * Attendus tirés de 19 US-114 (critères), de 16 ADM-036 (« demande → rapprochement ou création →
 * approbation → rattachement du véhicule → notification à l'hôte » ; doublon → MERGED ; refus
 * motivé → « le véhicule reste en brouillon, non publiable » ; CATALOG_REQUEST_DUPLICATE ;
 * `review_queue_item` de type CATALOG_ADDITION ; OPS_AGENT, ADMIN), HST-050 (« véhicule en
 * brouillon et non publiable » ; source et licence obligatoires), de 17 §3.2.3
 * (`catalog_addition_request` : OPEN, APPROVED, MERGED, REJECTED ; « le vehicle en attente reçoit
 * variant_id »), §4.5 (`catalog.addition_request.resolved` : request_id, status,
 * resolved_variant_id ; NTF vers le demandeur), §7.2 (`catalog_addition_sla_business_h` = 24) et
 * de 08 BR-LIST-05 (au moins 6 photos), jamais du code testé.
 *
 * Décision du fondateur DEC-FONDATEUR-22 (US-118, 0084) : un véhicule hors catalogue NE BLOQUE PLUS
 * l'annonce (marque et modèle saisis suffisent, la demande suit son cours) ; la soumission d'une
 * annonce dont la demande est ouverte ou refusée s'arrête donc, comme son témoin rattaché, à
 * l'ouverture du pays (HOST_NOT_ACTIVATED) ; la publication elle-même est prouvée par
 * l0-us118-listing-publication.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { withRole } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import { auditOf, elevatedStaff } from '../support/staff.ts';

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const ALL = COUNTRIES.map((c) => c.country);
const otherOf = (country: string): string => ALL.find((x) => x !== country) ?? '';
const byCountry = COUNTRIES.map((c) => [c.country, c.currency, c] as const);
/** 17 §7.2 : catalog_addition_sla_business_h = 24 (heures ouvrées comptées pleines, ADR-097). */
const SLA_MINUTES = 24 * 60;
/** 08 BR-LIST-05 : au moins 6 photos (`listing_min_photos`). */
const MIN_PHOTOS = 6;
const LICENSE =
  'Saisie de l’hôte vérifiée par l’ops sur le titre du véhicule ; aucune copie d’un tiers';

type Staff = Awaited<ReturnType<typeof elevatedStaff>>;

interface Host {
  readonly userId: string;
  readonly hash: Buffer;
  readonly org: string;
  readonly location: string;
}

interface Result {
  readonly outcome: string;
  readonly body: Record<string, unknown> | null;
}

/** Hôte : personne ACTIVE, session, compte d'hôte, CGU acceptées, lieu de remise. */
async function host(client: pg.ClientBase, country: string, status?: string): Promise<Host> {
  const userId = uuid();
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400, NULL,
                                                $6, $7::jsonb, false) AS ok`,
    [userId, `h114-${userId}@example.test`, phcArgon2id(), uuid(), randomBytes(32), country, DOCS],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await client.query(`SELECT test_fixture.iam_set_account_status($1, 'ACTIVE')`, [userId]);
  const t = newToken();
  const s = await client.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [uuid(), userId, t.hash, SESSION_TTL_S],
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  const acc = await client.query<{ outcome: string; org_id: string | null }>(
    'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
    [t.hash, country, 'INDIVIDUAL'],
  );
  const org = acc.rows[0]?.org_id;
  if (acc.rows[0]?.outcome !== 'DONE' || !org) throw new Error('compte d’hôte refusé');
  if (status !== undefined) {
    await client.query('SELECT test_fixture.us115_set_org_status($1, $2)', [org, status]);
  }
  const terms = await client.query<{ outcome: string }>(
    'SELECT * FROM core.ctr_cmd_accept_host_terms($1, $2, 1, $3)',
    [t.hash, org, 'es'],
  );
  if (terms.rows[0]?.outcome !== 'DONE') throw new Error('CGU de l’hôte refusées');
  const loc = await client.query<{ outcome: string; location_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_location($1, $2, 'HOME', 'Casa', 'Calle 1', 'Ciudad',
                                                    'Zona', NULL, NULL)`,
    [t.hash, org],
  );
  const location = loc.rows[0]?.location_id;
  if (!location) throw new Error(`lieu : ${loc.rows[0]?.outcome}`);
  return { userId, hash: t.hash, org, location };
}

/** Plaque unique de test ; VIN ISO 3779 de test (17 caractères, ni I, O ni Q). */
const plate = (): string => `C${randomBytes(4).toString('hex').toUpperCase()}`;
const vin = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  return Array.from(randomBytes(17), (b) => alphabet[b % alphabet.length]).join('');
};

/** Véhicule par la vraie commande : hors catalogue (marque et modèle saisis) ou variante. */
async function vehicle(
  client: pg.ClientBase,
  h: Host,
  v: {
    readonly make?: string | undefined;
    readonly model?: string | undefined;
    readonly variantId?: string | undefined;
    readonly year: number;
    readonly vin?: string | undefined;
  },
): Promise<{ outcome: string; id: string | null }> {
  const { rows } = await client.query<{ outcome: string; vehicle_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL,
                                                   'MANUAL', 5::smallint, 'GASOLINE', 42000,
                                                   false, false)`,
    [
      h.hash,
      h.org,
      h.location,
      plate(),
      v.vin ?? null,
      v.variantId ?? null,
      v.variantId === undefined ? (v.make ?? 'Chery') : null,
      v.variantId === undefined ? (v.model ?? 'Tiggo 2') : null,
      v.year,
    ],
  );
  return { outcome: rows[0]?.outcome ?? '', id: rows[0]?.vehicle_id ?? null };
}

/** Annonce DRAFT complète (prix au pas du pays, six photos) du véhicule. */
async function completeListing(
  client: pg.ClientBase,
  h: Host,
  c: CountryCase,
  vehicleId: string,
): Promise<string> {
  const lst = await client.query<{ outcome: string; listing_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_listing($1, $2, $3, $4, 'UNLIMITED', NULL, NULL, NULL)`,
    [h.hash, h.org, vehicleId, 40 * c.priceStepMinor],
  );
  const listing = lst.rows[0]?.listing_id;
  if (!listing) throw new Error(`annonce : ${lst.rows[0]?.outcome}`);
  for (let i = 0; i < MIN_PHOTOS; i += 1) {
    const p = await client.query<{ outcome: string }>(
      'SELECT * FROM core.catalog_cmd_add_listing_photo($1, $2, $3, $4, $5, $6, $7, $8)',
      [h.hash, h.org, listing, uuid(), uuid(), 'image/jpeg', 123_456, randomBytes(32)],
    );
    if (p.rows[0]?.outcome !== 'DONE') throw new Error(`photo : ${p.rows[0]?.outcome}`);
  }
  return listing;
}

const submit = async (c: pg.ClientBase, h: Host, listing: string): Promise<string> =>
  (
    await c.query<{ outcome: string }>(
      'SELECT * FROM core.catalog_cmd_submit_listing($1, $2, $3)',
      [h.hash, h.org, listing],
    )
  ).rows[0]?.outcome ?? '';

const listingRow = async (c: pg.ClientBase, listing: string) =>
  (
    await c.query<{ status: string; submitted_at: Date | null }>(
      'SELECT * FROM test_fixture.us115_listing_row($1)',
      [listing],
    )
  ).rows[0];

interface RequestRow {
  readonly id: string;
  readonly org_id: string;
  readonly country_code: string;
  readonly requested_by: string;
  readonly origin: string;
  readonly make_text: string;
  readonly model_text: string;
  readonly year: number;
  readonly trim_text: string | null;
  readonly vin_masked: string | null;
  readonly status: string;
  readonly resolved_variant_id: string | null;
  readonly reject_reason: string | null;
  readonly reviewed_by: string | null;
  readonly reviewed: boolean;
  readonly review_item_id: string;
  readonly sla_minutes: number;
}

const requestsOf = async (c: pg.ClientBase, vehicleId: string): Promise<RequestRow[]> =>
  (await c.query<RequestRow>('SELECT * FROM test_fixture.us114_requests($1)', [vehicleId])).rows;

const vehicleRow = async (c: pg.ClientBase, vehicleId: string) =>
  (
    await c.query<{
      variant_id: string | null;
      make_text: string | null;
      model_text: string | null;
      value_class: string | null;
    }>('SELECT * FROM test_fixture.us114_vehicle($1)', [vehicleId])
  ).rows[0];

const itemRow = async (c: pg.ClientBase, item: string) =>
  (
    await c.query<{
      queue: string;
      subject_type: string;
      subject_id: string;
      country_code: string;
      status: string;
      decision: string | null;
      assignee_id: string | null;
      sla_minutes: number;
    }>('SELECT * FROM test_fixture.us114_item($1)', [item])
  ).rows[0];

const eventsOf = async (c: pg.ClientBase, request: string) =>
  (
    await c.query<{
      type: string;
      aggregate_type: string;
      country_code: string;
      actor_user_id: string;
      actor_role: string;
      payload: Record<string, unknown>;
    }>('SELECT * FROM test_fixture.us114_events($1)', [request])
  ).rows;

const call = async (c: pg.ClientBase, sql: string, values: unknown[]): Promise<Result> =>
  (await c.query<Result>(sql, values)).rows[0] ?? { outcome: '', body: null };

const claim = (c: pg.ClientBase, s: { hash: Buffer }, item: string) =>
  call(c, 'SELECT * FROM core.support_staff_claim_item($1, $2, $3)', [s.hash, uuid(), item]);
const detail = (c: pg.ClientBase, s: { hash: Buffer }, item: string) =>
  call(c, 'SELECT * FROM core.support_staff_catalog_addition($1, $2, $3)', [s.hash, uuid(), item]);
const resolve = (
  c: pg.ClientBase,
  s: { hash: Buffer },
  item: string,
  decision: string,
  options: {
    variantId?: string | undefined;
    entry?: unknown;
    reason?: string | undefined;
  } = {},
) =>
  call(
    c,
    'SELECT * FROM core.support_staff_resolve_catalog_addition($1, $2, $3, $4, $5, $6::jsonb, $7)',
    [
      s.hash,
      uuid(),
      item,
      decision,
      options.variantId ?? null,
      options.entry === undefined ? null : JSON.stringify(options.entry),
      options.reason ?? null,
    ],
  );
const reRequest = (c: pg.ClientBase, h: Host, vehicleId: string, make: string, model: string) =>
  c
    .query<{ outcome: string; request_id: string | null }>(
      'SELECT * FROM core.catalog_cmd_request_addition($1, $2, $3, $4, $5, NULL)',
      [h.hash, h.org, vehicleId, make, model],
    )
    .then((r) => r.rows[0] ?? { outcome: '', request_id: null });

/** Saisie d'une variante nouvelle (17 §3.2.3, énumérations de 0063) couvrant l'année du véhicule. */
const entryFor = (model: string, yearFrom: number) => ({
  makeName: 'Chery',
  modelName: model,
  bodyType: 'SUV',
  yearFrom,
  yearTo: null,
  trimName: null,
  transmission: 'MT',
  fuelType: 'GASOLINE',
  drive: 'FWD',
  seats: 5,
  doors: 5,
  licenseNote: LICENSE,
});

/** Variante ACTIVE de la graine, commune aux pays, dont la marque et le modèle sont donnés. */
async function seedVariant(
  client: pg.ClientBase,
  make: string,
  model: string,
): Promise<{ id: string; year: number }> {
  const { rows } = await client.query<{ id: string; year_from: number }>(
    `SELECT v.id, v.year_from
       FROM core.catalog_vehicle_variant v
       JOIN core.catalog_vehicle_model o ON o.id = v.model_id AND o.status = 'ACTIVE'
       JOIN core.catalog_vehicle_make m ON m.id = o.make_id AND m.status = 'ACTIVE'
      WHERE v.status = 'ACTIVE' AND v.market IS NULL AND m.slug = $1 AND o.slug = $2
      ORDER BY v.year_from, v.id LIMIT 1`,
    [make, model],
  );
  if (!rows[0]) throw new Error(`graine : ${make} ${model} absent`);
  return { id: rows[0].id, year: rows[0].year_from };
}

/** Véhicule hors catalogue et son élément de file, pris en charge par `ops`. */
async function pending(
  client: pg.ClientBase,
  country: string,
  ops: Staff | null,
  v: { make?: string | undefined; model?: string | undefined; year?: number | undefined } = {},
): Promise<{ h: Host; vehicle: string; request: RequestRow; item: string }> {
  const h = await host(client, country);
  const veh = await vehicle(client, h, { make: v.make, model: v.model, year: v.year ?? 2021 });
  if (veh.outcome !== 'DONE' || !veh.id) throw new Error(`véhicule : ${veh.outcome}`);
  const [request] = await requestsOf(client, veh.id);
  if (!request) throw new Error('aucune demande d’ajout');
  if (ops !== null) {
    const r = await claim(client, ops, request.review_item_id);
    if (r.outcome !== 'CLAIMED') throw new Error(`prise en charge : ${r.outcome}`);
  }
  return { h, vehicle: veh.id, request, item: request.review_item_id };
}

// ---------------------------------------------------------------------------------------------
describe('socle (0074) : RLS, droits, propriétaires', () => {
  it('catalog_addition_request : RLS ENABLE + FORCE, propriétaire migrator, politiques des seuls propriétaires NOLOGIN, aucun droit applicatif', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<{
          rls: boolean;
          force: boolean;
          owner: string;
          policies: string[];
          grants: number;
        }>(
          `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                  pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                  ARRAY(SELECT p.polname || ':' || pg_catalog.array_to_string(ARRAY(
                                 SELECT pg_catalog.pg_get_userbyid(r) FROM pg_catalog.unnest(p.polroles) AS r
                                  ORDER BY 1), ',')
                          FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid ORDER BY 1) AS policies,
                  (SELECT count(*)::int FROM pg_catalog.aclexplode(c.relacl) x
                    WHERE x.grantee = 0
                       OR pg_catalog.pg_get_userbyid(x.grantee) IN ('app_api', 'app_worker', 'app_anon')) AS grants
             FROM pg_catalog.pg_class c
            WHERE c.oid = 'core.catalog_addition_request'::regclass`,
        );
        expect(rows[0]).toEqual({
          rls: true,
          force: true,
          owner: 'migrator',
          policies: ['catalog_cmd_all:catalog_cmd_owner', 'migrator_all:migrator'],
          grants: 0,
        });
      },
      { database: 'production' },
    );
  });

  it('app_api ne lit ni n’écrit la table (42501) et n’exécute ni les fonctions de domaine ni les aides ; app_worker et app_anon n’exécutent aucune commande', async () => {
    await withRole('app_api', async (client) => {
      for (const sql of [
        'SELECT id FROM core.catalog_addition_request LIMIT 1',
        `INSERT INTO core.catalog_addition_request (id) VALUES (gen_random_uuid())`,
        `SELECT core.catalog_addition_detail(gen_random_uuid(), 'PA')`,
        `SELECT * FROM core.catalog_resolve_addition(gen_random_uuid(), 'PA', gen_random_uuid(), 'ADMIN', 'REJECT', NULL, NULL, 'UNKNOWN_MODEL', NULL)`,
        `SELECT core.catalog_addition_open(gen_random_uuid(), 'PA', gen_random_uuid(), gen_random_uuid(), 'a', 'b', 2020, NULL, NULL)`,
        `SELECT core.catalog_slug('Chery')`,
        `SELECT * FROM core.support_staff_catalog_item(gen_random_uuid(), gen_random_uuid(), 'X', NULL)`,
      ]) {
        await client.query('BEGIN');
        try {
          await expect(client.query(sql), sql).rejects.toMatchObject({ code: '42501' });
        } finally {
          await client.query('ROLLBACK');
        }
      }
    });
    for (const role of ['app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        for (const sql of [
          'SELECT * FROM core.catalog_cmd_request_addition($1, $2, $2, $3, $3, NULL)',
          'SELECT * FROM core.support_staff_catalog_addition($1, $2, $2)',
        ]) {
          await client.query('BEGIN');
          try {
            await expect(
              client.query(
                sql,
                sql.includes('request_addition')
                  ? [Buffer.alloc(32), uuid(), 'Chery']
                  : [Buffer.alloc(32), uuid()],
              ),
              `${role} ${sql}`,
            ).rejects.toMatchObject({ code: '42501' });
          } finally {
            await client.query('ROLLBACK');
          }
        }
      });
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('critère 1 — véhicule absent du catalogue : demande d’ajout, aucune annonce publiée', () => {
  it.each(byCountry)(
    '%s (%s) : « Chery Tiggo 2 » saisi par l’hôte ⇒ demande OPEN et élément CATALOG_ADDITION (24 h) ; la demande ne bloque plus l’annonce (US-118, DEC-FONDATEUR-22 : arrêt à l’ouverture du pays comme le témoin rattaché)',
    async (country, _currency, c: CountryCase) => {
      await withRole('app_api', async (client) => {
        // compte ACTIVE : seule l'ouverture du pays (false) arrête le témoin
        const h = await host(client, country, 'ACTIVE');
        const v = vin();
        const veh = await vehicle(client, h, {
          make: 'Chery',
          model: 'Tiggo 2',
          year: 2021,
          vin: v,
        });
        expect(veh.outcome).toBe('DONE');
        const id = veh.id ?? '';
        expect(await vehicleRow(client, id)).toMatchObject({
          variant_id: null,
          make_text: 'Chery',
          model_text: 'Tiggo 2',
        });
        const requests = await requestsOf(client, id);
        expect(requests).toHaveLength(1);
        const r = requests[0] as RequestRow;
        expect(r).toMatchObject({
          org_id: h.org,
          country_code: country,
          requested_by: h.userId,
          origin: 'WIZARD_OTHER',
          make_text: 'Chery',
          model_text: 'Tiggo 2',
          year: 2021,
          status: 'OPEN',
          resolved_variant_id: null,
          reviewed_by: null,
          reviewed: false,
          // constructeur, modèle, année et usine ; numéro de série caché (ADR-104)
          vin_masked: `${v.slice(0, 11)}******`,
        });
        expect(r.sla_minutes).toBe(SLA_MINUTES);
        expect(await itemRow(client, r.review_item_id)).toMatchObject({
          queue: 'CATALOG_ADDITION',
          subject_type: 'CATALOG_ADDITION_REQUEST',
          subject_id: r.id,
          country_code: country,
          status: 'OPEN',
          decision: null,
          sla_minutes: SLA_MINUTES,
        });
        // l'hôte relit sa demande (aucun VIN, aucun auteur de décision)
        const mine = await client.query<Record<string, unknown>>(
          'SELECT * FROM core.catalog_host_addition_requests($1, $2)',
          [h.hash, h.org],
        );
        expect(mine.rows).toHaveLength(1);
        expect(mine.rows[0]).toMatchObject({ request_id: r.id, vehicle_id: id, status: 'OPEN' });
        expect(JSON.stringify(mine.rows[0])).not.toContain(v.slice(0, 11));

        // US-118 (DEC-FONDATEUR-22) : la demande ne bloque plus l'annonce ; la soumission franchit
        // l'étape du catalogue et s'arrête à l'ouverture du pays (false : 16 HST-005), DRAFT
        const listing = await completeListing(client, h, c, id);
        expect(await submit(client, h, listing)).toBe('HOST_NOT_ACTIVATED');
        expect(await listingRow(client, listing)).toMatchObject({
          status: 'DRAFT',
          submitted_at: null,
        });

        // TÉMOIN : même hôte, véhicule rattaché au catalogue ⇒ aucune demande, la soumission
        // franchit l'étape du catalogue (arrêt à l'ouverture du pays, false : 16 HST-005)
        const seed = await seedVariant(client, 'toyota', 'hilux');
        const linked = await vehicle(client, h, { variantId: seed.id, year: seed.year });
        expect(linked.outcome).toBe('DONE');
        expect(await requestsOf(client, linked.id ?? '')).toEqual([]);
        const witness = await completeListing(client, h, c, linked.id ?? '');
        expect(await submit(client, h, witness)).toBe('HOST_NOT_ACTIVATED');
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : un véhicule hors catalogue d’un compte ONBOARDING ouvre aussi sa demande ; un hôte d’un autre compte ne la voit pas',
    async (country) => {
      await withRole('app_api', async (client) => {
        const a = await host(client, country);
        const b = await host(client, country);
        const veh = await vehicle(client, a, { make: 'Chery', model: 'Arrizo 5', year: 2020 });
        expect(veh.outcome).toBe('DONE');
        expect(await requestsOf(client, veh.id ?? '')).toHaveLength(1);
        // compte d'un autre : 0 ligne (même réponse qu'un compte vide)
        for (const [hash, org] of [
          [b.hash, a.org],
          [b.hash, b.org],
        ] as const) {
          const rows = await client.query(
            'SELECT * FROM core.catalog_host_addition_requests($1, $2)',
            [hash, org],
          );
          expect(rows.rows).toEqual([]);
        }
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('critère 2 — demande approuvée : le véhicule reçoit sa variante, l’hôte est notifié', () => {
  it.each(byCountry)(
    '%s (%s) : OPS du pays prend l’élément, lit la demande, APPROVE ⇒ variante HOST_REQUEST du pays rattachée, demande APPROVED, élément DONE, événement catalog.addition_request.resolved vers l’hôte, décision journalisée ; la soumission franchit l’étape du catalogue',
    async (country, _currency, c: CountryCase) => {
      await withRole('app_api', async (client) => {
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const p = await pending(client, country, null, { model: 'Tiggo 2', year: 2021 });
        // avant la prise en charge : la permission est détenue, l'élément n'est pas couvert
        expect((await detail(client, ops, p.item)).outcome).toBe('CASE_REQUIRED');
        expect((await claim(client, ops, p.item)).outcome).toBe('CLAIMED');
        const d = await detail(client, ops, p.item);
        expect(d.outcome).toBe('GRANTED');
        expect(d.body).toMatchObject({
          itemId: p.item,
          requestId: p.request.id,
          status: 'OPEN',
          country,
          makeText: 'Chery',
          modelText: 'Tiggo 2',
          year: 2021,
          transmission: 'MANUAL',
          seats: 5,
          fuelType: 'GASOLINE',
        });
        // candidates : variantes de la marque reconnue seulement (aucune autre marque)
        const candidates = (d.body?.['candidates'] ?? []) as Array<Record<string, unknown>>;
        for (const k of candidates) expect(k['make']).toBe('Chery');

        const listing = await completeListing(client, p.h, c, p.vehicle);
        // US-118 : la demande ouverte ne bloque plus (arrêt à l'ouverture du pays)
        expect(await submit(client, p.h, listing)).toBe('HOST_NOT_ACTIVATED');

        const r = await resolve(client, ops, p.item, 'APPROVE', {
          entry: entryFor('Tiggo 2', 2017),
        });
        expect(r.outcome).toBe('RESOLVED');
        expect(r.body).toMatchObject({
          itemId: p.item,
          requestId: p.request.id,
          status: 'APPROVED',
        });
        const variant = String(r.body?.['variantId']);
        expect(await vehicleRow(client, p.vehicle)).toMatchObject({
          variant_id: variant,
          make_text: null,
          model_text: null,
        });
        expect((await requestsOf(client, p.vehicle))[0]).toMatchObject({
          status: 'APPROVED',
          resolved_variant_id: variant,
          reviewed_by: ops.userId,
          reviewed: true,
          reject_reason: null,
          // la demande garde la saisie de l'hôte
          make_text: 'Chery',
          model_text: 'Tiggo 2',
        });
        expect(await itemRow(client, p.item)).toMatchObject({
          status: 'DONE',
          decision: 'APPROVED',
        });
        // catalogue : marque de la graine reprise, modèle et variante ajoutés (source, licence)
        const row = (await client.query('SELECT * FROM test_fixture.us114_variant($1)', [variant]))
          .rows[0];
        expect(row).toMatchObject({
          make_slug: 'chery',
          make_source: 'OPS_CURATED',
          model_slug: 'tiggo-2',
          model_source: 'HOST_REQUEST',
          year_from: 2017,
          year_to: null,
          transmission: 'MT',
          fuel_type: 'GASOLINE',
          drive: 'FWD',
          seats: 5,
          market: country,
          status: 'ACTIVE',
          source: 'HOST_REQUEST',
          license_note: LICENSE,
          verified_by: ops.userId,
          verified: true,
        });
        // notification : un événement vers l'hôte demandeur (17 §4.5, NTF)
        const events = await eventsOf(client, p.request.id);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          type: 'catalog.addition_request.resolved',
          aggregate_type: 'catalog_addition_request',
          country_code: country,
          actor_user_id: ops.userId,
          actor_role: 'OPS_AGENT',
          payload: {
            request_id: p.request.id,
            status: 'APPROVED',
            resolved_variant_id: variant,
            vehicle_id: p.vehicle,
            org_id: p.h.org,
            host_user_id: p.h.userId,
            reject_reason: null,
          },
        });
        const audit = (await auditOf(client, ops.userId)).at(-1);
        expect(audit).toMatchObject({
          action_code: 'CATALOG_ADDITION_RESOLVED',
          subject_type: 'CATALOG_ADDITION_REQUEST',
          subject_id: p.request.id,
        });
        expect(audit?.after).toMatchObject({ country, status: 'APPROVED', variantId: variant });
        // le véhicule est publiable : la soumission franchit l'étape du catalogue
        expect(await submit(client, p.h, listing)).toBe('HOST_NOT_ACTIVATED');
        // élément clos : invisible au verrou de la console (politique de mise à jour d'US-109 :
        // éléments OPEN ou IN_REVIEW), même réponse qu'un élément inconnu ; rien ne change
        expect(
          (await resolve(client, ops, p.item, 'REJECT', { reason: 'UNKNOWN_MODEL' })).outcome,
        ).toBe('FORBIDDEN');
        expect((await requestsOf(client, p.vehicle))[0]?.status).toBe('APPROVED');
        expect(await eventsOf(client, p.request.id)).toHaveLength(1);
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : doublon d’une variante existante ⇒ MERGE (variante de la graine de l’année) ; variante d’un autre marché ou d’une autre année ⇒ CATALOG_VARIANT_NOT_FOUND, rien n’est écrit',
    async (country) => {
      await withRole('app_api', async (client) => {
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const seed = await seedVariant(client, 'toyota', 'hilux');
        const p = await pending(client, country, ops, {
          make: 'toyota',
          model: 'HILUX',
          year: seed.year,
        });
        // la variante de la graine est proposée, modèle reconnu
        const d = await detail(client, ops, p.item);
        const candidates = (d.body?.['candidates'] ?? []) as Array<Record<string, unknown>>;
        expect(candidates.find((k) => k['variantId'] === seed.id)).toMatchObject({
          modelMatch: true,
        });
        // autre marché (variante propre à l'autre pays) : refus, la demande reste OPEN
        const other = await client.query<{ variant_id: string }>(
          'SELECT * FROM test_fixture.us115_market_variant($1)',
          [otherOf(country)],
        );
        expect(
          (await resolve(client, ops, p.item, 'MERGE', { variantId: other.rows[0]?.variant_id }))
            .outcome,
        ).toBe('CATALOG_VARIANT_NOT_FOUND');
        expect((await resolve(client, ops, p.item, 'MERGE', { variantId: uuid() })).outcome).toBe(
          'CATALOG_VARIANT_NOT_FOUND',
        );
        expect((await requestsOf(client, p.vehicle))[0]?.status).toBe('OPEN');
        expect(await eventsOf(client, p.request.id)).toEqual([]);
        // rapprochement
        const r = await resolve(client, ops, p.item, 'MERGE', { variantId: seed.id });
        expect(r.body).toMatchObject({ status: 'MERGED', variantId: seed.id });
        expect((await vehicleRow(client, p.vehicle))?.variant_id).toBe(seed.id);
        expect((await requestsOf(client, p.vehicle))[0]).toMatchObject({
          status: 'MERGED',
          resolved_variant_id: seed.id,
        });
        expect(await itemRow(client, p.item)).toMatchObject({ status: 'DONE', decision: 'MERGED' });
        expect((await eventsOf(client, p.request.id))[0]?.payload).toMatchObject({
          status: 'MERGED',
          resolved_variant_id: seed.id,
          host_user_id: p.h.userId,
        });
        // une année hors de la variante : refus
        const q = await pending(client, country, ops, {
          make: 'toyota',
          model: 'Hilux',
          year: seed.year - 1,
        });
        expect((await resolve(client, ops, q.item, 'MERGE', { variantId: seed.id })).outcome).toBe(
          'CATALOG_VARIANT_NOT_FOUND',
        );
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : APPROVE d’une variante déjà au catalogue (du pays ou commune) ⇒ CATALOG_VARIANT_EXISTS ; saisie invalide (clé inconnue, licence courte, année du véhicule hors des années) ⇒ CATALOG_ENTRY_INVALID ; rien n’est écrit',
    async (country) => {
      await withRole('app_api', async (client) => {
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const model = `Modelo ${randomBytes(3).toString('hex')}`;
        const first = await pending(client, country, ops, { model, year: 2022 });
        expect(
          (await resolve(client, ops, first.item, 'APPROVE', { entry: entryFor(model, 2020) }))
            .outcome,
        ).toBe('RESOLVED');
        const second = await pending(client, country, ops, { model, year: 2022 });
        expect(
          (await resolve(client, ops, second.item, 'APPROVE', { entry: entryFor(model, 2020) }))
            .outcome,
        ).toBe('CATALOG_VARIANT_EXISTS');
        for (const entry of [
          { ...entryFor(model, 2019), extra: 'x' },
          { ...entryFor(model, 2019), licenseNote: 'court' },
          entryFor(model, 2023), // le véhicule est de 2022
          { ...entryFor(model, 2019), bodyType: 'TRACTOR' },
          { ...entryFor(model, 2019), seats: '5' },
        ]) {
          expect(
            (await resolve(client, ops, second.item, 'APPROVE', { entry })).outcome,
            JSON.stringify(entry),
          ).toBe('CATALOG_ENTRY_INVALID');
        }
        // variante COMMUNE de la graine (market nul) de même clé : à rapprocher, jamais doublée
        const { rows: seedRows } = await client.query<{
          id: string;
          make: string;
          model: string;
          year_from: number;
          trim_name: string | null;
          transmission: string;
          fuel_type: string;
          drive: string;
        }>(
          `SELECT v.id, m.name AS make, o.name AS model, v.year_from, v.trim_name, v.transmission,
                  v.fuel_type, v.drive
             FROM core.catalog_vehicle_variant v
             JOIN core.catalog_vehicle_model o ON o.id = v.model_id AND o.status = 'ACTIVE'
             JOIN core.catalog_vehicle_make m ON m.id = o.make_id AND m.status = 'ACTIVE'
            WHERE v.status = 'ACTIVE' AND v.market IS NULL AND m.slug = 'toyota' AND o.slug = 'hilux'
            ORDER BY v.year_from, v.id LIMIT 1`,
        );
        const sv = seedRows[0];
        if (!sv) throw new Error('graine : Toyota Hilux absent');
        const third = await pending(client, country, ops, {
          make: sv.make,
          model: sv.model,
          year: sv.year_from,
        });
        expect(
          (
            await resolve(client, ops, third.item, 'APPROVE', {
              entry: {
                ...entryFor(sv.model, sv.year_from),
                makeName: sv.make,
                bodyType: 'PICKUP',
                trimName: sv.trim_name,
                transmission: sv.transmission,
                fuelType: sv.fuel_type,
                drive: sv.drive,
              },
            })
          ).outcome,
        ).toBe('CATALOG_VARIANT_EXISTS');
        expect((await requestsOf(client, third.vehicle))[0]?.status).toBe('OPEN');
        expect((await requestsOf(client, second.vehicle))[0]?.status).toBe('OPEN');
        expect((await vehicleRow(client, second.vehicle))?.variant_id).toBeNull();
        expect(await eventsOf(client, second.request.id)).toEqual([]);
        expect((await itemRow(client, second.item))?.status).toBe('IN_REVIEW');
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('refus motivé : sans effet sur l’annonce (US-118) ; nouvelle demande de l’hôte', () => {
  it.each(byCountry)(
    '%s (%s) : REJECT (UNKNOWN_MODEL) ⇒ demande REJECTED, véhicule sans variante, annonce non bloquée (US-118), hôte notifié ; l’hôte corrige et redemande ⇒ nouvelle demande OPEN ; seconde demande ⇒ CATALOG_REQUEST_DUPLICATE',
    async (country, _currency, c: CountryCase) => {
      await withRole('app_api', async (client) => {
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const p = await pending(client, country, ops, { model: 'Tigo dos' });
        // motif hors liste : refus
        expect((await resolve(client, ops, p.item, 'REJECT', { reason: 'BECAUSE' })).outcome).toBe(
          'CATALOG_ENTRY_INVALID',
        );
        // une demande OPEN existe : nouvelle demande refusée (16 ADM-036)
        expect((await reRequest(client, p.h, p.vehicle, 'Chery', 'Tiggo 2')).outcome).toBe(
          'CATALOG_REQUEST_DUPLICATE',
        );
        const r = await resolve(client, ops, p.item, 'REJECT', { reason: 'UNKNOWN_MODEL' });
        expect(r.body).toMatchObject({ status: 'REJECTED', variantId: null });
        expect((await requestsOf(client, p.vehicle))[0]).toMatchObject({
          status: 'REJECTED',
          reject_reason: 'UNKNOWN_MODEL',
          resolved_variant_id: null,
          reviewed_by: ops.userId,
        });
        expect(await itemRow(client, p.item)).toMatchObject({
          status: 'DONE',
          decision: 'REJECTED',
        });
        expect((await vehicleRow(client, p.vehicle))?.variant_id).toBeNull();
        expect((await eventsOf(client, p.request.id))[0]?.payload).toMatchObject({
          status: 'REJECTED',
          resolved_variant_id: null,
          reject_reason: 'UNKNOWN_MODEL',
          host_user_id: p.h.userId,
        });
        // refus de la demande : il ne bloque pas l'annonce non plus (US-118), arrêt à l'ouverture
        // du pays ; l'annonce reste DRAFT
        const listing = await completeListing(client, p.h, c, p.vehicle);
        expect(await submit(client, p.h, listing)).toBe('HOST_NOT_ACTIVATED');
        expect((await listingRow(client, listing))?.status).toBe('DRAFT');

        // nouvelle demande, marque et modèle corrigés
        const again = await reRequest(client, p.h, p.vehicle, 'Chery', 'Tiggo 2');
        expect(again.outcome).toBe('DONE');
        const all = await requestsOf(client, p.vehicle);
        expect(all.map((x) => x.status)).toEqual(['REJECTED', 'OPEN']);
        expect(all[1]).toMatchObject({
          id: again.request_id,
          make_text: 'Chery',
          model_text: 'Tiggo 2',
        });
        expect(all[1]?.sla_minutes).toBe(SLA_MINUTES);
        expect(await vehicleRow(client, p.vehicle)).toMatchObject({
          variant_id: null,
          make_text: 'Chery',
          model_text: 'Tiggo 2',
        });
        expect((await itemRow(client, all[1]?.review_item_id ?? ''))?.status).toBe('OPEN');
        expect((await reRequest(client, p.h, p.vehicle, 'Chery', 'Tiggo 2')).outcome).toBe(
          'CATALOG_REQUEST_DUPLICATE',
        );
        // de nouveau en attente : toujours sans effet sur l'annonce (US-118)
        expect(await submit(client, p.h, listing)).toBe('HOST_NOT_ACTIVATED');
        // l'hôte relit la DERNIÈRE demande du véhicule
        const mine = await client.query<{ request_id: string; status: string }>(
          'SELECT * FROM core.catalog_host_addition_requests($1, $2)',
          [p.h.hash, p.h.org],
        );
        expect(mine.rows).toEqual([
          expect.objectContaining({ request_id: again.request_id, status: 'OPEN' }),
        ]);
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : refus NOT_ELIGIBLE ⇒ plus de nouvelle demande (CATALOG_REQUEST_NOT_ALLOWED) ; trois refus ⇒ plus de nouvelle demande ; rien n’est mis en file',
    async (country) => {
      await withRole('app_api', async (client) => {
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        // véhicule non admis : aucune nouvelle demande
        const p = await pending(client, country, ops);
        expect(
          (await resolve(client, ops, p.item, 'REJECT', { reason: 'NOT_ELIGIBLE' })).outcome,
        ).toBe('RESOLVED');
        expect((await reRequest(client, p.h, p.vehicle, 'Chery', 'Tiggo 2')).outcome).toBe(
          'CATALOG_REQUEST_NOT_ALLOWED',
        );
        expect((await requestsOf(client, p.vehicle)).map((x) => x.status)).toEqual(['REJECTED']);
        // témoin : un refus d'un autre motif laisse redemander, jusqu'au troisième refus
        const q = await pending(client, country, ops);
        let item = q.item;
        for (let round = 1; round <= 3; round += 1) {
          expect(
            (await resolve(client, ops, item, 'REJECT', { reason: 'INSUFFICIENT_DETAILS' }))
              .outcome,
          ).toBe('RESOLVED');
          const again = await reRequest(client, q.h, q.vehicle, 'Chery', `Tiggo ${round}`);
          if (round < 3) {
            expect(again.outcome, `refus ${round}`).toBe('DONE');
            const last = (await requestsOf(client, q.vehicle)).at(-1);
            item = last?.review_item_id ?? '';
            expect((await claim(client, ops, item)).outcome).toBe('CLAIMED');
          } else {
            expect(again.outcome, 'troisième refus').toBe('CATALOG_REQUEST_NOT_ALLOWED');
          }
        }
        expect((await requestsOf(client, q.vehicle)).map((x) => x.status)).toEqual([
          'REJECTED',
          'REJECTED',
          'REJECTED',
        ]);
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : nouvelle demande d’un véhicule rattaché ⇒ CATALOG_ALREADY_LINKED ; véhicule d’un autre hôte ⇒ VEHICLE_NOT_FOUND (son compte) ou FORBIDDEN (compte d’un autre) ; saisie vide ⇒ VEHICLE_FIELD_REQUIRED',
    async (country) => {
      await withRole('app_api', async (client) => {
        const a = await host(client, country);
        const b = await host(client, country);
        const seed = await seedVariant(client, 'toyota', 'hilux');
        const linked = await vehicle(client, a, { variantId: seed.id, year: seed.year });
        expect((await reRequest(client, a, linked.id ?? '', 'Toyota', 'Hilux')).outcome).toBe(
          'CATALOG_ALREADY_LINKED',
        );
        const free = await vehicle(client, a, { year: 2021 });
        expect((await reRequest(client, b, free.id ?? '', 'Chery', 'Tiggo 2')).outcome).toBe(
          'VEHICLE_NOT_FOUND',
        );
        expect(
          (await reRequest(client, { ...b, org: a.org }, free.id ?? '', 'Chery', 'Tiggo 2'))
            .outcome,
        ).toBe('FORBIDDEN');
        expect((await reRequest(client, a, free.id ?? '', '  ', 'Tiggo 2')).outcome).toBe(
          'VEHICLE_FIELD_REQUIRED',
        );
        expect((await requestsOf(client, free.id ?? '')).map((x) => x.status)).toEqual(['OPEN']);
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('console : permission de la file, pays, prise en charge, TOTP (refus journalisés)', () => {
  it.each(byCountry)(
    '%s (%s) : OPS de l’autre pays et FINANCE du pays ⇒ FORBIDDEN (prise, lecture, décision) ; autre OPS du pays, élément pris par un autre ⇒ CASE_REQUIRED ; ADMIN du pays ⇒ décide ; session non élevée ⇒ MFA_REQUIRED ; jeton inconnu ⇒ AUTH_REQUIRED',
    async (country) => {
      await withRole('app_api', async (client) => {
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const opsOther = await elevatedStaff(client, 'OPS_AGENT', [otherOf(country)]);
        const finance = await elevatedStaff(client, 'FINANCE', [country]);
        const colleague = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const admin = await elevatedStaff(client, 'ADMIN', [country]);
        const p = await pending(client, country, ops);
        for (const s of [opsOther, finance]) {
          expect((await claim(client, s, p.item)).outcome).toBe('FORBIDDEN');
          expect((await detail(client, s, p.item)).outcome).toBe('FORBIDDEN');
          expect(
            (await resolve(client, s, p.item, 'REJECT', { reason: 'UNKNOWN_MODEL' })).outcome,
          ).toBe('FORBIDDEN');
          expect((await auditOf(client, s.userId)).at(-1)?.action_code).toBe('STAFF_FORBIDDEN');
        }
        expect((await detail(client, colleague, p.item)).outcome).toBe('CASE_REQUIRED');
        expect(
          (await resolve(client, colleague, p.item, 'REJECT', { reason: 'UNKNOWN_MODEL' })).outcome,
        ).toBe('CASE_REQUIRED');
        expect((await auditOf(client, colleague.userId)).at(-1)?.action_code).toBe(
          'STAFF_FORBIDDEN',
        );
        // l'hôte lui-même (session non élevée) et un jeton inconnu
        expect((await detail(client, p.h, p.item)).outcome).toBe('MFA_REQUIRED');
        expect(
          (
            await resolve(client, { hash: randomBytes(32) }, p.item, 'REJECT', {
              reason: 'UNKNOWN_MODEL',
            })
          ).outcome,
        ).toBe('AUTH_REQUIRED');
        // aucun refus n'a rien écrit
        expect((await requestsOf(client, p.vehicle))[0]?.status).toBe('OPEN');
        expect(await eventsOf(client, p.request.id)).toEqual([]);
        // ADMIN du pays : tout élément de sa portée
        const r = await resolve(client, admin, p.item, 'REJECT', {
          reason: 'INSUFFICIENT_DETAILS',
        });
        expect(r.outcome).toBe('RESOLVED');
        expect((await eventsOf(client, p.request.id))[0]).toMatchObject({ actor_role: 'ADMIN' });
      });
    },
  );

  it('décision invalide ⇒ 22023, rien n’est écrit', async () => {
    await withRole('app_api', async (client) => {
      const country = ALL[0] ?? '';
      const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
      const p = await pending(client, country, ops);
      await expect(resolve(client, ops, p.item, 'DELETE')).rejects.toMatchObject({ code: '22023' });
      expect((await requestsOf(client, p.vehicle))[0]?.status).toBe('OPEN');
    });
  });
});
