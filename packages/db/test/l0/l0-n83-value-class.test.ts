/**
 * N-83 — classe de valeur attribuée à la publication d'un véhicule non classé (migrations 0131 et
 * 0132 ; ADR-159 ; fixture 9944) sous le rôle de production app_api (assertion L0-05 en tête de
 * chaque connexion, withRole), en USD (PA) et en PYG (PY), transactions ANNULÉES :
 * - variante de la douane sans classe (Geely Coolray) ⇒ classe du défaut du pays
 *   (`vehicle_default_value_class`, lu dans le fichier de paramètres) ⇒ couverte par le contrat ⇒
 *   annonce LISTED, fiche publique lisible (toutes les autres conditions réunies : interrupteurs
 *   ouverts par la procédure à deux personnes d'US-125, dans la transaction du test) ;
 * - marque ou modèle de valeur haute, du catalogue ou saisi hors catalogue ⇒ classe haute, jamais
 *   STANDARD (contrat limité à STANDARD ⇒ VEHICLE_NOT_COVERED : jamais sous-assuré) ;
 * - aucune régression : un véhicule déjà classé garde sa classe ; une variante générale de la
 *   graine v1 suit le défaut ; un véhicule jamais publié reste sans classe au rattachement ;
 * - le défaut est un paramètre du pays (autre valeur ⇒ autre classe) ; contrat fermé ⇒ toujours
 *   INSURER_CONTRACT_INACTIVE (aucun hôte publiable sans contrat) ;
 * - rattachement par l'ops d'un véhicule hors catalogue déjà classé (MERGE, US-114) ⇒ classe
 *   recalculée avec la variante, jamais perdue.
 * Valeurs attendues : 08 BR-ACC-05 (classes et seuils PROPOSÉS), ADR-159 (règles de classement),
 * le fichier `params.json` et le fichier de la douane (lus ici sans le code de l'API), jamais le
 * code testé.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { approveSwitch, freshSession, requestSwitch } from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import { staff as rlsStaff, staffSessionHash } from '../support/rls.ts';
import { elevatedStaff } from '../support/staff.ts';
import { uniquePlate, uniqueVin } from '../support/unique.ts';

type Tx = pg.ClientBase;
type ValueClass = 'STANDARD' | 'PREMIUM' | 'LUXE';

interface ParamDoc {
  params: Array<{ key: string; values: Record<string, unknown> }>;
}
const PARAMS = JSON.parse(
  readFileSync(
    new URL('../../../../apps/api/src/modules/cfg/data/params.json', import.meta.url),
    'utf8',
  ),
) as ParamDoc;
/** Défaut PROPOSÉ du pays (params.json, ADR-159). */
const defaultClass = (country: string): ValueClass => {
  const v = PARAMS.params.find((p) => p.key === 'vehicle_default_value_class')?.values[country];
  if (v !== 'STANDARD' && v !== 'PREMIUM' && v !== 'LUXE') throw new Error(`défaut ${country}`);
  return v;
};

const byCountry = COUNTRIES.map((c) => [c.country, c.currency, c] as const);
const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
/** 08 BR-LIST-05 : au moins 6 photos (`listing_min_photos`, PROPOSÉ). */
const MIN_PHOTOS = 6;
const DOC_PARAMS = [
  'elig_doc_title',
  'elig_doc_plate_vin_photo',
  'elig_doc_inspection',
  'elig_doc_compulsory_insurance',
  'elig_doc_owner_authorization',
  'elig_doc_lender_consent',
] as const;
const ALL_CLASSES: readonly ValueClass[] = ['STANDARD', 'PREMIUM', 'LUXE'];

/**
 * Oracle d'ADR-159 (règles PROPOSÉES, 08 BR-ACC-05 : PREMIUM au-delà de 35 000 $, LUXE au-delà de
 * 70 000 $) : variante du catalogue ⇒ classe et provenance attendues. `existing` : modèle de la
 * graine v1 (variante avec fiche), sinon variante sans fiche de la douane.
 */
const CATALOG_CASES: ReadonlyArray<{
  make: string;
  model: string;
  specs: boolean;
  expected: ValueClass;
  source: 'MAKE_RULE' | 'MODEL_RULE';
  rule: [string, string | null];
}> = [
  {
    make: 'porsche',
    model: 'cayenne',
    specs: false,
    expected: 'LUXE',
    source: 'MAKE_RULE',
    rule: ['porsche', null],
  },
  {
    make: 'land-rover',
    model: 'discovery',
    specs: false,
    expected: 'PREMIUM',
    source: 'MAKE_RULE',
    rule: ['land-rover', null],
  },
  {
    make: 'land-rover',
    model: 'range-rover-sport',
    specs: false,
    expected: 'LUXE',
    source: 'MODEL_RULE',
    rule: ['land-rover', 'range-rover'],
  },
  {
    make: 'lexus',
    model: 'nx',
    specs: false,
    expected: 'PREMIUM',
    source: 'MAKE_RULE',
    rule: ['lexus', null],
  },
  {
    make: 'mercedes-benz',
    model: 'glc',
    specs: false,
    expected: 'PREMIUM',
    source: 'MAKE_RULE',
    rule: ['mercedes-benz', null],
  },
  {
    make: 'mercedes-benz',
    model: 'clase-g',
    specs: false,
    expected: 'LUXE',
    source: 'MODEL_RULE',
    rule: ['mercedes-benz', 'clase-g'],
  },
  {
    make: 'toyota',
    model: 'land-cruiser',
    specs: false,
    expected: 'LUXE',
    source: 'MODEL_RULE',
    rule: ['toyota', 'land-cruiser'],
  },
  // la règle la plus précise l'emporte : « land-cruiser-prado » (PREMIUM) sur « land-cruiser »
  {
    make: 'toyota',
    model: 'land-cruiser-prado',
    specs: true,
    expected: 'PREMIUM',
    source: 'MODEL_RULE',
    rule: ['toyota', 'land-cruiser-prado'],
  },
];

/** Saisie hors catalogue (« Autre ») : marque et modèle libres ⇒ classe attendue (ADR-159). */
const OFF_CATALOG_CASES: ReadonlyArray<{
  make: string;
  model: string;
  expected: ValueClass | 'DEFAULT';
  source: 'MAKE_RULE' | 'MODEL_RULE' | 'COUNTRY_DEFAULT';
}> = [
  { make: 'Porsche', model: 'Cayenne S', expected: 'LUXE', source: 'MAKE_RULE' },
  { make: 'Mercedes Benz', model: 'Clase G 500', expected: 'LUXE', source: 'MODEL_RULE' },
  { make: 'Mercedes', model: 'C 200', expected: 'PREMIUM', source: 'MAKE_RULE' },
  { make: 'Range Rover', model: 'Velar', expected: 'LUXE', source: 'MAKE_RULE' },
  { make: 'Marca Inventada', model: 'Modelo Uno', expected: 'DEFAULT', source: 'COUNTRY_DEFAULT' },
];

// ---- aides : hôte, véhicule, annonce, publication ----------------------------------------------
interface Host {
  readonly userId: string;
  readonly hash: Buffer;
  readonly org: string;
  readonly location: string;
}

async function host(c: Tx, country: string): Promise<Host> {
  const userId = uuid();
  const r = await c.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400, NULL,
                                                $6, $7::jsonb, false) AS ok`,
    [userId, `n83-${userId}@example.test`, phcArgon2id(), uuid(), randomBytes(32), country, DOCS],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await c.query(`SELECT test_fixture.iam_set_account_status($1, 'ACTIVE')`, [userId]);
  const t = newToken();
  const s = await c.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [uuid(), userId, t.hash, SESSION_TTL_S],
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  const acc = await c.query<{ outcome: string; org_id: string | null }>(
    'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
    [t.hash, country, 'INDIVIDUAL'],
  );
  const org = acc.rows[0]?.org_id;
  if (acc.rows[0]?.outcome !== 'DONE' || !org) throw new Error('compte d’hôte refusé');
  const terms = await c.query<{ outcome: string }>(
    'SELECT * FROM core.ctr_cmd_accept_host_terms($1, $2, 1, $3)',
    [t.hash, org, 'es'],
  );
  if (terms.rows[0]?.outcome !== 'DONE') throw new Error('CGU de l’hôte refusées');
  await c.query('SELECT test_fixture.us115_set_org_status($1, $2)', [org, 'ACTIVE']);
  const loc = await c.query<{ outcome: string; location_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_location($1, $2, 'HOME', 'Casa', 'Calle Ficticia 123',
                                                    'Ciudad Uno', 'Barrio Norte', NULL, NULL)`,
    [t.hash, org],
  );
  const location = loc.rows[0]?.location_id;
  if (loc.rows[0]?.outcome !== 'DONE' || !location) throw new Error('lieu refusé');
  return { userId, hash: t.hash, org, location };
}

/** Année civile en cours dans le fuseau du pays (oracle indépendant de la base). */
const localYear = (cc: CountryCase): number =>
  Number(new Intl.DateTimeFormat('en-CA', { timeZone: cc.timezone, year: 'numeric' }).format());

/** Variante ACTIVE d'un modèle (avec ou sans fiche) et une année qu'elle couvre. */
async function variantOf(
  c: Tx,
  cc: CountryCase,
  make: string,
  model: string,
  specs: boolean,
): Promise<{ id: string; year: number }> {
  const { rows } = await c.query<{ id: string; year_from: number; year_to: number | null }>(
    `SELECT v.id, v.year_from, v.year_to FROM core.catalog_vehicle_variant v
       JOIN core.catalog_vehicle_model o ON o.id = v.model_id AND o.status = 'ACTIVE'
       JOIN core.catalog_vehicle_make m ON m.id = o.make_id AND m.status = 'ACTIVE'
      WHERE m.slug = $1 AND o.slug = $2 AND v.status = 'ACTIVE' AND v.market IS NULL
        AND (v.transmission IS NOT NULL) = $3
      ORDER BY v.year_to DESC NULLS FIRST, v.year_from DESC, v.id LIMIT 1`,
    [make, model, specs],
  );
  const v = rows[0];
  if (!v) throw new Error(`variante ${make} ${model}`);
  const recent = localYear(cc) - 2;
  const year = Math.max(v.year_from, Math.min(recent, v.year_to ?? recent));
  return { id: v.id, year };
}

async function createVehicle(
  c: Tx,
  h: Host,
  v: { variant: string | null; make?: string; model?: string; year: number },
): Promise<string> {
  const { rows } = await c.query<{ outcome: string; vehicle_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL,
                                                   'MANUAL', 5::smallint, 'GASOLINE', NULL,
                                                   false, false)`,
    [
      h.hash,
      h.org,
      h.location,
      await uniquePlate(c, 'N'),
      await uniqueVin(c),
      v.variant,
      v.make ?? null,
      v.model ?? null,
      v.year,
    ],
  );
  const id = rows[0]?.vehicle_id;
  if (rows[0]?.outcome !== 'DONE' || !id) throw new Error(`véhicule : ${rows[0]?.outcome}`);
  return id;
}

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

const publish = async (c: Tx, h: Host, id: string): Promise<string> =>
  (
    await c.query<{ outcome: string }>(
      'SELECT * FROM core.catalog_cmd_submit_listing($1, $2, $3)',
      [h.hash, h.org, id],
    )
  ).rows[0]?.outcome ?? '';

interface ClassRow {
  value_class: string | null;
  value_class_source: string | null;
  rule_make: string | null;
  rule_model: string | null;
}
const classOf = async (c: Tx, vehicleId: string): Promise<ClassRow | undefined> =>
  (await c.query<ClassRow>('SELECT * FROM test_fixture.n83_vehicle_class($1)', [vehicleId]))
    .rows[0];

/** Pièces non exigées, pas de revue du pays, contrat d'assureur en vigueur des classes dites. */
async function countryRules(
  c: Tx,
  country: string,
  classes: readonly ValueClass[] = ALL_CLASSES,
): Promise<void> {
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
    'false',
  ]);
  await c.query('SELECT test_fixture.us108_insurer_contract($1, $2, $3)', [country, 50, classes]);
}

/** Interrupteur ouvert par la procédure à deux personnes d'US-125, transaction annulée. */
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

const rolledBack = (body: (tx: Tx) => Promise<void>) =>
  withRole('app_api', (client) => withTestTransaction(client, {}, body));

// ---- preuves -----------------------------------------------------------------------------------
describe('N-83 : variante de la douane sans classe ⇒ classe du pays ⇒ annonce publiable', () => {
  it.each(byCountry)(
    '%s (%s) : Geely Coolray de la douane ⇒ défaut du pays (COUNTRY_DEFAULT) à la publication ⇒ couverte ⇒ LISTED, fiche publique',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        await countryRules(tx, country);
        await openSwitch(tx, 'p2p_private_hosts_enabled', country);
        await openSwitch(tx, 'insurer_contract_active', country);
        const h = await host(tx, country);
        const v = await variantOf(tx, cc, 'geely', 'coolray', false);
        const vehicle = await createVehicle(tx, h, { variant: v.id, year: v.year });
        // avant la publication : aucune classe (la douane n'en donne pas)
        expect(await classOf(tx, vehicle)).toEqual({
          value_class: null,
          value_class_source: null,
          rule_make: null,
          rule_model: null,
        });
        const id = await listing(tx, h, cc, vehicle);
        // classe attribuée à la publication ; la couverture passe, le contrôle suivant parle
        expect(await publish(tx, h, id)).toBe('VEHICLE_ELIGIBILITY_REQUIRED');
        expect(await classOf(tx, vehicle)).toEqual({
          value_class: defaultClass(country),
          value_class_source: 'COUNTRY_DEFAULT',
          rule_make: null,
          rule_model: null,
        });
        await confirmVehicle(tx, h, vehicle);
        expect(await publish(tx, h, id)).toBe('LISTED');
        const pub = await tx.query<{ make_name: string; model_name: string; country_code: string }>(
          'SELECT make_name, model_name, country_code FROM core.catalog_public_listing($1)',
          [id],
        );
        expect(pub.rows).toEqual([
          { make_name: 'Geely', model_name: 'Coolray', country_code: country },
        ]);
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : contrat d’assureur fermé (interrupteur à false) ⇒ classe attribuée mais INSURER_CONTRACT_INACTIVE, l’annonce reste DRAFT',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        await countryRules(tx, country);
        await openSwitch(tx, 'p2p_private_hosts_enabled', country);
        const h = await host(tx, country);
        const v = await variantOf(tx, cc, 'geely', 'coolray', false);
        const vehicle = await createVehicle(tx, h, { variant: v.id, year: v.year });
        await confirmVehicle(tx, h, vehicle);
        const id = await listing(tx, h, cc, vehicle);
        expect(await publish(tx, h, id)).toBe('INSURER_CONTRACT_INACTIVE');
        expect((await classOf(tx, vehicle))?.value_class).toBe(defaultClass(country));
        const st = await tx.query<{ status: string }>(
          'SELECT status FROM test_fixture.us118_listing($1)',
          [id],
        );
        expect(st.rows[0]?.status).toBe('DRAFT');
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : défaut du pays paramétré (autre valeur ⇒ autre classe), jamais une constante',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        const other: ValueClass = defaultClass(country) === 'PREMIUM' ? 'STANDARD' : 'PREMIUM';
        await tx.query('SELECT test_fixture.n83_default_class($1, $2::jsonb)', [
          country,
          JSON.stringify(other),
        ]);
        const h = await host(tx, country);
        const v = await variantOf(tx, cc, 'geely', 'coolray', false);
        const vehicle = await createVehicle(tx, h, { variant: v.id, year: v.year });
        await publish(tx, h, await listing(tx, h, cc, vehicle));
        expect(await classOf(tx, vehicle)).toMatchObject({
          value_class: other,
          value_class_source: 'COUNTRY_DEFAULT',
        });
      });
    },
  );
});

describe('N-83 : marque ou modèle de valeur haute ⇒ classe haute, jamais STANDARD', () => {
  it.each(byCountry)(
    '%s (%s) : variantes du catalogue (douane et graine v1) ⇒ classe des règles d’ADR-159',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        const h = await host(tx, country);
        for (const k of CATALOG_CASES) {
          const v = await variantOf(tx, cc, k.make, k.model, k.specs);
          const vehicle = await createVehicle(tx, h, { variant: v.id, year: v.year });
          await publish(tx, h, await listing(tx, h, cc, vehicle));
          expect(await classOf(tx, vehicle), `${k.make} ${k.model}`).toEqual({
            value_class: k.expected,
            value_class_source: k.source,
            rule_make: k.rule[0],
            rule_model: k.rule[1],
          });
        }
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : véhicules hors catalogue (marque et modèle saisis) ⇒ règle de marque ou de modèle, sinon défaut du pays',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        const h = await host(tx, country);
        for (const k of OFF_CATALOG_CASES) {
          const vehicle = await createVehicle(tx, h, {
            variant: null,
            make: k.make,
            model: k.model,
            year: localYear(cc) - 2,
          });
          await publish(tx, h, await listing(tx, h, cc, vehicle));
          expect(await classOf(tx, vehicle), `${k.make} ${k.model}`).toMatchObject({
            value_class: k.expected === 'DEFAULT' ? defaultClass(country) : k.expected,
            value_class_source: k.source,
          });
        }
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : Porsche de la douane, contrat limité à STANDARD ⇒ LUXE, VEHICLE_NOT_COVERED (jamais sous-assurée) ; contrat de toutes les classes ⇒ LISTED',
    async (country, _currency, cc) => {
      // contrat de la seule classe STANDARD, puis (autre transaction) de toutes les classes
      for (const [classes, outcome] of [
        [['STANDARD'], 'VEHICLE_NOT_COVERED'],
        [ALL_CLASSES, 'LISTED'],
      ] as const) {
        await rolledBack(async (tx) => {
          await countryRules(tx, country, classes);
          await openSwitch(tx, 'p2p_private_hosts_enabled', country);
          await openSwitch(tx, 'insurer_contract_active', country);
          const h = await host(tx, country);
          const v = await variantOf(tx, cc, 'porsche', 'cayenne', false);
          const vehicle = await createVehicle(tx, h, { variant: v.id, year: v.year });
          await confirmVehicle(tx, h, vehicle);
          const id = await listing(tx, h, cc, vehicle);
          expect(await publish(tx, h, id)).toBe(outcome);
          expect((await classOf(tx, vehicle))?.value_class).toBe('LUXE');
        });
      }
    },
  );
});

describe('N-83 : aucune régression', () => {
  it.each(byCountry)(
    '%s (%s) : véhicule déjà classé ⇒ classe gardée, jamais recalculée ; variante générale de la graine v1 (Hilux) ⇒ défaut du pays',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        const h = await host(tx, country);
        const g = await variantOf(tx, cc, 'geely', 'coolray', false);
        const classed = await createVehicle(tx, h, { variant: g.id, year: g.year });
        await tx.query('SELECT test_fixture.us108_set_value_class($1, $2)', [classed, 'LUXE']);
        await publish(tx, h, await listing(tx, h, cc, classed));
        expect(await classOf(tx, classed)).toEqual({
          value_class: 'LUXE',
          value_class_source: null,
          rule_make: null,
          rule_model: null,
        });
        const p = await variantOf(tx, cc, 'porsche', 'cayenne', false);
        const porsche = await createVehicle(tx, h, { variant: p.id, year: p.year });
        await tx.query('SELECT test_fixture.us108_set_value_class($1, $2)', [porsche, 'PREMIUM']);
        await publish(tx, h, await listing(tx, h, cc, porsche));
        expect((await classOf(tx, porsche))?.value_class).toBe('PREMIUM');
        const x = await variantOf(tx, cc, 'toyota', 'hilux', true);
        const hilux = await createVehicle(tx, h, { variant: x.id, year: x.year });
        await publish(tx, h, await listing(tx, h, cc, hilux));
        expect(await classOf(tx, hilux)).toEqual({
          value_class: defaultClass(country),
          value_class_source: 'COUNTRY_DEFAULT',
          rule_make: null,
          rule_model: null,
        });
      });
    },
  );
});

describe('N-83 : rattachement par l’ops d’un véhicule hors catalogue (MERGE, US-114)', () => {
  const requestItem = async (c: Tx, vehicleId: string): Promise<string> => {
    const { rows } = await c.query<{ review_item_id: string }>(
      'SELECT review_item_id FROM test_fixture.us114_requests($1)',
      [vehicleId],
    );
    if (!rows[0]) throw new Error('aucune demande d’ajout');
    return rows[0].review_item_id;
  };
  const merge = async (
    c: Tx,
    ops: { hash: Buffer },
    item: string,
    variant: string,
  ): Promise<string> => {
    const claim = await c.query<{ outcome: string }>(
      'SELECT * FROM core.support_staff_claim_item($1, $2, $3)',
      [ops.hash, uuid(), item],
    );
    expect(claim.rows[0]?.outcome).toBe('CLAIMED');
    const r = await c.query<{ outcome: string }>(
      'SELECT * FROM core.support_staff_resolve_catalog_addition($1, $2, $3, $4, $5, NULL, NULL)',
      [ops.hash, uuid(), item, 'MERGE', variant],
    );
    return r.rows[0]?.outcome ?? '';
  };

  it.each(byCountry)(
    '%s (%s) : classé à la publication (défaut du pays) puis rattaché à une Porsche de la douane ⇒ LUXE (règle de marque) ; jamais publié ⇒ reste sans classe',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        const ops = await elevatedStaff(tx, 'OPS_AGENT', [country]);
        const h = await host(tx, country);
        const p = await variantOf(tx, cc, 'porsche', 'cayenne', false);
        const published = await createVehicle(tx, h, {
          variant: null,
          make: 'Marca Inventada',
          model: 'Modelo Dos',
          year: p.year,
        });
        await publish(tx, h, await listing(tx, h, cc, published));
        expect(await classOf(tx, published)).toMatchObject({
          value_class: defaultClass(country),
          value_class_source: 'COUNTRY_DEFAULT',
        });
        expect(await merge(tx, ops, await requestItem(tx, published), p.id)).toBe('RESOLVED');
        expect(await classOf(tx, published)).toEqual({
          value_class: 'LUXE',
          value_class_source: 'MAKE_RULE',
          rule_make: 'porsche',
          rule_model: null,
        });
        // jamais publié : le rattachement ne change rien à la règle d'US-114 (classe de la variante)
        const draft = await createVehicle(tx, h, {
          variant: null,
          make: 'Marca Inventada',
          model: 'Modelo Tres',
          year: p.year,
        });
        expect(await merge(tx, ops, await requestItem(tx, draft), p.id)).toBe('RESOLVED');
        expect(await classOf(tx, draft)).toEqual({
          value_class: null,
          value_class_source: null,
          rule_make: null,
          rule_model: null,
        });
      });
    },
  );
});
