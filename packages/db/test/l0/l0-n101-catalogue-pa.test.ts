/**
 * N-101 — catalogue de la douane partagé entre les pays (migrations 0095 et 0096 ; ADR-123,
 * ADR-109 ; fixture 9953) sous le rôle de production app_api (assertion L0-05 en tête de chaque
 * connexion, withRole), en USD (PA) et en PYG (PY) :
 * - partage : aucune variante de la douane ne garde le marché de la source ; dans CHAQUE pays, un
 *   hôte trouve toutes les marques et tous les modèles venus de la douane, au même titre que ceux
 *   d'origine (même requête que `listMakes` / `listModels`) ; lot 2 (0096) : JMC Vigor ;
 * - retour arrière de l'import : la fixture 9953 l'a joué sous migrator (retrait par RETIRED,
 *   DELETE refusé, NOT NULL impossibles à rétablir avec des lignes sans fiche) et l'a annulé ;
 * - parcours de l'hôte jusqu'à l'annonce publique sur une variante SANS FICHE (revue qa US-113
 *   n° 3) : véhicule créé (l'hôte saisit boîte, places, carburant), classe de valeur inconnue ⇒
 *   VEHICLE_NOT_COVERED (une donnée inconnue n'est jamais couverte, US-108, N-83) ; classe connue
 *   et véhicule confirmé ⇒ LISTED, fiche publique lisible (marque et modèle du catalogue, boîte,
 *   places et carburant de l'hôte).
 * Transactions ANNULÉES : les interrupteurs ne s'ouvrent que par la procédure à deux personnes
 * d'US-125, dans la transaction du test, et rien ne survit.
 * Valeurs attendues : le fichier de données `vehicle-catalog-dnit.json` (lu ici sans le code de
 * l'API), 16 HST-016 / HST-019, 19 US-118 et ADR-123, jamais le code testé.
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

interface CustomsModel {
  slug: string;
  name: string;
  existing?: boolean;
  lot?: number;
  variant: { yearFrom: number; yearTo: number | null } | null;
}
interface CustomsDoc {
  sharedFromLot: number;
  makes: Array<{ slug: string; name: string; existing?: boolean; models: CustomsModel[] }>;
}
const CUSTOMS = JSON.parse(
  readFileSync(
    new URL('../../../../apps/api/src/modules/cat/data/vehicle-catalog-dnit.json', import.meta.url),
    'utf8',
  ),
) as CustomsDoc;
const NEW_MAKES = CUSTOMS.makes.filter((m) => m.existing !== true);
const NEW_MODELS = CUSTOMS.makes.flatMap((m) =>
  m.models.filter((o) => o.existing !== true).map((o) => ({ make: m.slug, model: o })),
);
const VARIANTS = CUSTOMS.makes.flatMap((m) => m.models.filter((o) => o.variant !== null));

const byCountry = COUNTRIES.map((c) => [c.country, c.currency, c] as const);
const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
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

// ---- partage (base « production » du banc : migrations de production seules) -------------------
describe('catalogue de la douane partagé (0095, 0096)', () => {
  it('aucune variante de la douane ne garde un marché ; lot 2 chargé (JMC Vigor)', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<{ market: string | null; n: number }>(
          // app_api ne lit pas la provenance (0063) : en base « production », les variantes sans
          // fiche sont exactement celles de la douane (la v1 a toujours la sienne)
          `SELECT market::text AS market, count(*)::int AS n FROM core.catalog_vehicle_variant
            WHERE transmission IS NULL AND fuel_type IS NULL AND drive IS NULL
              AND seats IS NULL AND doors IS NULL AND trim_name IS NULL
            GROUP BY market`,
        );
        expect(rows).toEqual([{ market: null, n: VARIANTS.length }]);
        const vigor = await client.query<{ name: string; year_from: number; year_to: null }>(
          `SELECT o.name, v.year_from, v.year_to
             FROM core.catalog_vehicle_variant v
             JOIN core.catalog_vehicle_model o ON o.id = v.model_id AND o.status = 'ACTIVE'
             JOIN core.catalog_vehicle_make m ON m.id = o.make_id AND m.status = 'ACTIVE'
            WHERE m.slug = 'jmc' AND o.slug = 'vigor' AND v.status = 'ACTIVE'
              AND v.market IS NULL AND v.transmission IS NULL`,
        );
        const expected = CUSTOMS.makes
          .find((m) => m.slug === 'jmc')
          ?.models.find((o) => o.slug === 'vigor');
        expect(expected?.lot).toBe(2);
        expect(CUSTOMS.sharedFromLot).toBeLessThanOrEqual(2);
        expect(vigor.rows).toEqual([
          {
            name: 'Vigor',
            year_from: expected?.variant?.yearFrom,
            year_to: expected?.variant?.yearTo ?? null,
          },
        ]);
      },
      { database: 'production' },
    );
  });

  it.each(byCountry)(
    '%s (%s) : toutes les marques et tous les modèles de la douane proposés à l’hôte, comme ceux d’origine',
    async (country) => {
      await withRole(
        'app_api',
        async (client) => {
          // même filtre que listMakes / listModels (store.ts) : au moins une variante ACTIVE
          // commune ou du pays de l'hôte
          const makes = await client.query<{ slug: string }>(
            `SELECT m.slug FROM core.catalog_vehicle_make m
              WHERE m.status = 'ACTIVE'
                AND EXISTS (SELECT 1 FROM core.catalog_vehicle_model o
                              JOIN core.catalog_vehicle_variant v ON v.model_id = o.id
                             WHERE o.make_id = m.id AND o.status = 'ACTIVE'
                               AND v.status = 'ACTIVE'
                               AND (v.market IS NULL OR v.market::text = $1))`,
            [country],
          );
          const visible = new Set(makes.rows.map((r) => r.slug));
          for (const m of CUSTOMS.makes) expect(visible.has(m.slug), m.slug).toBe(true);
          const models = await client.query<{ key: string }>(
            `SELECT m.slug || '/' || o.slug AS key
               FROM core.catalog_vehicle_model o
               JOIN core.catalog_vehicle_make m ON m.id = o.make_id AND m.status = 'ACTIVE'
              WHERE o.status = 'ACTIVE'
                AND EXISTS (SELECT 1 FROM core.catalog_vehicle_variant v
                             WHERE v.model_id = o.id AND v.status = 'ACTIVE'
                               AND (v.market IS NULL OR v.market::text = $1))`,
            [country],
          );
          const keys = new Set(models.rows.map((r) => r.key));
          const missing = NEW_MODELS.filter((x) => !keys.has(`${x.make}/${x.model.slug}`));
          expect(missing.map((x) => `${x.make}/${x.model.slug}`)).toEqual([]);
          expect(NEW_MAKES.length).toBeGreaterThanOrEqual(50);
          expect(NEW_MODELS.length).toBeGreaterThanOrEqual(600);
        },
        { database: 'production' },
      );
    },
  );

  it('retour arrière de l’import joué et annulé par la fixture 9953 (témoin présent)', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ status: string }>(
        `SELECT status FROM core.catalog_vehicle_make WHERE slug = 'zz-n101-temoin'`,
      );
      expect(rows).toEqual([{ status: 'RETIRED' }]);
      // le retrait simulé a été annulé : l'import reste ACTIVE dans la base du banc
      const retired = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM core.catalog_vehicle_variant v
           JOIN core.catalog_vehicle_model o ON o.id = v.model_id
           JOIN core.catalog_vehicle_make m ON m.id = o.make_id
          WHERE v.transmission IS NULL AND v.trim_name IS NULL AND m.slug NOT LIKE 'zz-%'
            AND v.status <> 'ACTIVE'`,
      );
      expect(retired.rows[0]?.n).toBe(0);
    });
  });
});

// ---- parcours de l'hôte jusqu'à l'annonce publique (base de test), transaction annulée ---------
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
    [userId, `n101-${userId}@example.test`, phcArgon2id(), uuid(), randomBytes(32), country, DOCS],
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

const plate = (): string => `N${randomBytes(4).toString('hex').toUpperCase()}`;
const vin = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  return Array.from(randomBytes(17), (b) => alphabet[b % alphabet.length]).join('');
};
/** Année civile en cours dans le fuseau du pays (oracle indépendant de la base). */
const localYear = (cc: CountryCase): number =>
  Number(new Intl.DateTimeFormat('en-CA', { timeZone: cc.timezone, year: 'numeric' }).format());

/** Variante sans fiche de la douane d'un modèle (identifiant lu en base, années du fichier). */
async function customsVariant(c: Tx, make: string, model: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `SELECT v.id FROM core.catalog_vehicle_variant v
       JOIN core.catalog_vehicle_model o ON o.id = v.model_id
       JOIN core.catalog_vehicle_make m ON m.id = o.make_id
      WHERE m.slug = $1 AND o.slug = $2 AND v.transmission IS NULL AND v.trim_name IS NULL
        AND v.status = 'ACTIVE'`,
    [make, model],
  );
  if (rows.length !== 1 || !rows[0]) throw new Error(`variante de la douane ${make} ${model}`);
  return rows[0].id;
}

async function createVehicle(c: Tx, h: Host, variant: string, year: number) {
  const { rows } = await c.query<{ outcome: string; vehicle_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, $5, $6, NULL, NULL, $7, NULL,
                                                   'MANUAL', 5::smallint, 'GASOLINE', NULL,
                                                   false, false)`,
    [h.hash, h.org, h.location, plate(), vin(), variant, year],
  );
  return { outcome: rows[0]?.outcome ?? '', id: rows[0]?.vehicle_id ?? null };
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

/** Pièces non exigées, pas de revue du pays, contrat d'assureur en vigueur (US-108). */
async function countryRules(c: Tx, country: string): Promise<void> {
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
  await c.query('SELECT test_fixture.us108_insurer_contract($1, $2, $3)', [
    country,
    50,
    ['STANDARD', 'PREMIUM', 'LUXE'],
  ]);
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

describe('parcours de l’hôte jusqu’à l’annonce publique sur une variante sans fiche (N-101)', () => {
  it.each(byCountry)(
    '%s (%s) : Geely Coolray de la douane ⇒ véhicule créé ; classe de valeur inconnue ⇒ VEHICLE_NOT_COVERED ; classe connue, véhicule confirmé ⇒ LISTED, fiche publique ; JMC Vigor (lot 2) ⇒ véhicule créé',
    async (country, _currency, cc) => {
      await rolledBack(async (tx) => {
        await countryRules(tx, country);
        await openSwitch(tx, 'p2p_private_hosts_enabled', country);
        await openSwitch(tx, 'insurer_contract_active', country);
        const h = await host(tx, country);
        const year = localYear(cc) - 2;
        const coolray = CUSTOMS.makes
          .find((m) => m.slug === 'geely')
          ?.models.find((o) => o.slug === 'coolray');
        if (!coolray?.variant) throw new Error('Geely Coolray absent des données');
        expect(coolray.variant.yearFrom).toBeLessThanOrEqual(year);
        expect(coolray.variant.yearTo).toBeNull();
        const v = await createVehicle(tx, h, await customsVariant(tx, 'geely', 'coolray'), year);
        expect(v.outcome).toBe('DONE');
        if (!v.id) throw new Error('véhicule absent');
        const id = await listing(tx, h, cc, v.id);
        // la douane ne donne aucune classe de valeur : jamais couvert, l'annonce reste DRAFT
        expect(await publish(tx, h, id)).toBe('VEHICLE_NOT_COVERED');
        expect(
          (await tx.query('SELECT * FROM core.catalog_public_listing($1)', [id])).rows,
        ).toEqual([]);
        // TÉMOIN : classe de valeur connue (ce que l'ops ou l'assureur fixera, N-83)
        await tx.query('SELECT test_fixture.us108_set_value_class($1, $2)', [v.id, 'STANDARD']);
        expect(await publish(tx, h, id)).toBe('VEHICLE_ELIGIBILITY_REQUIRED');
        await confirmVehicle(tx, h, v.id);
        expect(await publish(tx, h, id)).toBe('LISTED');
        const pub = await tx.query<{
          make_name: string;
          model_name: string;
          year: number;
          transmission: string;
          seats: number;
          fuel_type: string;
          country_code: string;
        }>(
          `SELECT make_name, model_name, year, transmission, seats, fuel_type, country_code
             FROM core.catalog_public_listing($1)`,
          [id],
        );
        expect(pub.rows).toEqual([
          {
            make_name: 'Geely',
            model_name: 'Coolray',
            year,
            transmission: 'MANUAL',
            seats: 5,
            fuel_type: 'GASOLINE',
            country_code: country,
          },
        ]);
        // lot 2 (0096) : JMC Vigor, variante commune
        const vigor = await createVehicle(tx, h, await customsVariant(tx, 'jmc', 'vigor'), year);
        expect(vigor.outcome).toBe('DONE');
      });
    },
  );
});
