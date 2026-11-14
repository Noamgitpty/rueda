/**
 * Preuves des documents et de l'éligibilité du véhicule (US-124, migrations 0077 et 0078 ;
 * fixtures 9982) sous le rôle de production app_api (assertion L0-05 en tête de chaque connexion,
 * withRole), en USD (PA) et en PYG (PY). Chaque test crée ses propres hôtes, véhicules, pièces et
 * membres du staff (élévation TOTP réelle) par les VRAIES commandes.
 *
 * Attendus tirés de 19 US-124 (critères 1 à 4), de 16 HST-019 (« véhicule de 11 ans (seuil de test
 * 10) ⇒ VEHICLE_TOO_OLD » ; VIN qui diffère du titre ⇒ VEHICLE_VIN_MISMATCH ; prenda sans
 * consentement ⇒ VEHICLE_LENDER_CONSENT_REQUIRED ; P2P_HOST lit le résultat et les motifs),
 * HST-039 (vehicle_document : TITLE, OWNER_AUTHORIZATION, PLATE_VIN_PHOTO, INSPECTION,
 * LENDER_CONSENT, COMPULSORY_INSURANCE ; « véhicule sans titre ni autorisation ⇒
 * VEHICLE_DOCUMENT_REQUIRED » ; SOBAT au Panama), de 08 BR-LIST-01 (titre au nom de l'hôte ou
 * autorisation notariée), BR-LIST-02 [NOUS] (≤ 10 ans, < 200 000 km), BR-LIST-03 (titres
 * interdits), de 22 OQ-P2P-02 / OQ-BR-28 (`vehicle_financed_requires_lender_consent` = true,
 * fail-closed) et OQ-CAT-01 (g) (hors catalogue jamais publiable, levé par DEC-FONDATEUR-22 et
 * US-118 : la demande d'ajout ne bloque plus), du pré-mortem L1-PM-11, L1-PM-14
 * (liste de contrôle par pièce, aucune case « tout vérifié »), L1-PM-15 et L1-PM-43, et du BOARD
 * N-37 (jamais le nom légal complet au voyageur) et N-61 (contestation et libération par l'ops),
 * jamais du code testé.
 *
 * Décision du fondateur du 2026-11-12, « jamais plus lourd que Turo » : par défaut AUCUNE pièce
 * n'est exigée (paramètres `elig_doc_*` à false) ; l'hôte déclare (propriétaire ou autorisé ; non
 * gagé ou accord du créancier) et saisit plaque et VIN ; le véhicule devient ELIGIBLE sans revue.
 * Chaque paramètre est éprouvé désactivé (défaut) et activé (pièce exigée, revue de l'ops) ; un
 * test règle lui-même les paramètres qu'il suppose (`docRules`).
 *
 * Absence d'effet : chaque refus est comparé à un TÉMOIN qui ne diffère que par la condition
 * éprouvée (même hôte, même dossier, une pièce ou une valeur de plus) : si la garde disparaissait,
 * le refus deviendrait l'issue du témoin et le test échouerait.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { withRole } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import { elevatedStaff as elevatedRaw, installTestProofKey } from '../support/staff.ts';

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const byCountry = COUNTRIES.map((c) => [c.country, c.currency, c] as const);
const ALL = COUNTRIES.map((c) => c.country);
const otherOf = (country: string): string => ALL.find((x) => x !== country) ?? '';

/**
 * Pièces d'un pays qui les ACTIVE (16 HST-039 : assurance obligatoire SOBAT au Panama seulement) ;
 * par défaut aucune (décision du fondateur du 2026-11-12).
 */
const ENABLED: Readonly<Record<string, readonly string[]>> = {
  PA: ['TITLE', 'PLATE_VIN_PHOTO', 'INSPECTION', 'COMPULSORY_INSURANCE'],
  PY: ['TITLE', 'PLATE_VIN_PHOTO', 'INSPECTION'],
};
/** Paramètre par pays de chaque pièce (0078). */
const DOC_PARAM: Readonly<Record<string, string>> = {
  TITLE: 'elig_doc_title',
  PLATE_VIN_PHOTO: 'elig_doc_plate_vin_photo',
  INSPECTION: 'elig_doc_inspection',
  COMPULSORY_INSURANCE: 'elig_doc_compulsory_insurance',
  OWNER_AUTHORIZATION: 'elig_doc_owner_authorization',
  LENDER_CONSENT: 'elig_doc_lender_consent',
};

/**
 * Pièces exigées par le pays pour la suite du test : `on` à true, toutes les autres à false (une
 * nouvelle version de chaque paramètre, valable à platform.now()). Chaque test qui suppose un état
 * le pose lui-même : aucun ordre entre les tests.
 */
async function docRules(c: pg.ClientBase, country: string, on: readonly string[]): Promise<void> {
  for (const [type, key] of Object.entries(DOC_PARAM)) {
    await c.query('SELECT test_fixture.us124_param_version($1, $2, $3::jsonb)', [
      key,
      country,
      on.includes(type) ? 'true' : 'false',
    ]);
  }
}
/** 08 BR-LIST-02 [NOUS] : ≤ 10 ans ; < 200 000 km. */
const MAX_AGE = 10;
const KM_CEILING = 200_000;
/** Liste de contrôle fermée de l'ops (ADR-107, L1-PM-14). */
const CHECK_KEYS = [
  'TITLE_HOLDER',
  'TITLE_CLEAN',
  'PLATE_MATCH',
  'VIN_MATCH',
  'LIEN',
  'INSPECTION',
  'REGISTRY',
] as const;
const PURPOSE = 'Contrôle du titre et du registre du véhicule';

type Staff = Awaited<ReturnType<typeof elevatedRaw>>;

/** Staff élevé par TOTP (clé de preuve de test installée d'abord, comme l0-us123). */
async function elevatedStaff(c: pg.ClientBase, role: string, scope: readonly string[]) {
  await installTestProofKey(c);
  return elevatedRaw(c, role, scope);
}

interface Host {
  readonly userId: string;
  readonly hash: Buffer;
  readonly org: string;
  readonly location: string;
}

/** Année civile en cours dans le fuseau du pays (oracle indépendant de la base). */
function localYear(c: CountryCase): number {
  return Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: c.timezone, year: 'numeric' }).format(new Date()),
  );
}

/** Date locale du pays décalée de `days` jours (AAAA-MM-JJ). */
function localDate(c: CountryCase, days: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: c.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
}

/** Hôte : personne ACTIVE, session, compte d'hôte, CGU acceptées, lieu de remise. */
async function host(
  client: pg.ClientBase,
  country: string,
  names: readonly [string, string] = ['Ana', 'Pérez'],
  withKey = true,
): Promise<Host> {
  const userId = uuid();
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, $8, $9, 'es', $4, $5, 86400, NULL,
                                                $6, $7::jsonb, false) AS ok`,
    [
      userId,
      `h124-${userId}@example.test`,
      phcArgon2id(),
      uuid(),
      randomBytes(32),
      country,
      DOCS,
      names[0],
      names[1],
    ],
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
  const loc = await client.query<{ location_id: string | null; outcome: string }>(
    `SELECT * FROM core.catalog_cmd_create_location($1, $2, 'HOME', 'Casa', 'Calle 1', 'Ciudad',
                                                    'Zona', NULL, NULL)`,
    [t.hash, org],
  );
  const location = loc.rows[0]?.location_id;
  if (!location) throw new Error(`lieu : ${loc.rows[0]?.outcome}`);
  // clé USER de l'hôte, créée par le coffre de l'application avant le dépôt d'une pièce
  if (withKey) await client.query('SELECT test_fixture.us109_subject_key($1)', [userId]);
  return { userId, hash: t.hash, org, location };
}

const plate = (): string => `D${randomBytes(4).toString('hex').toUpperCase()}`;
const vin = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  return Array.from(randomBytes(17), (b) => alphabet[b % alphabet.length]).join('');
};

interface VehicleSpec {
  readonly year: number;
  readonly plate?: string;
  readonly vin?: string | null;
  readonly offCatalog?: boolean;
}

async function vehicle(
  client: pg.ClientBase,
  h: Host,
  country: string,
  v: VehicleSpec,
): Promise<{ outcome: string; id: string }> {
  const variant = v.offCatalog
    ? null
    : (await client.query<{ v: string }>('SELECT test_fixture.us124_variant($1) AS v', [country]))
        .rows[0]?.v;
  const { rows } = await client.query<{ outcome: string; vehicle_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL,
                                                   'MANUAL', 5::smallint, 'GASOLINE', NULL,
                                                   false, false)`,
    [
      h.hash,
      h.org,
      h.location,
      v.plate ?? plate(),
      v.vin === undefined ? vin() : v.vin,
      variant ?? null,
      v.offCatalog ? 'Chery' : null,
      v.offCatalog ? 'Tiggo 2' : null,
      v.year,
    ],
  );
  return { outcome: rows[0]?.outcome ?? '', id: rows[0]?.vehicle_id ?? '' };
}

interface Declaration {
  readonly holder?: string;
  readonly lien?: boolean;
  readonly km?: number;
  /** « Je suis propriétaire ou autorisé par le propriétaire » (défaut : coché). */
  readonly owner?: boolean;
  /** « Non gagé, ou j'ai l'accord du créancier » (défaut : coché). */
  readonly lienOk?: boolean;
  readonly vin?: string | null;
}

const declare = async (
  c: pg.ClientBase,
  h: Host,
  vehicleId: string,
  d: Declaration = {},
): Promise<string> =>
  (
    await c.query<{ outcome: string }>(
      'SELECT * FROM core.catalog_cmd_declare_vehicle($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        h.hash,
        h.org,
        vehicleId,
        d.holder ?? 'HOST',
        d.lien ?? false,
        d.km ?? 42_000,
        d.owner ?? true,
        d.lienOk ?? true,
        d.vin ?? null,
      ],
    )
  ).rows[0]?.outcome ?? '';

async function addDoc(
  c: pg.ClientBase,
  h: Host,
  vehicleId: string,
  type: string,
  validUntil: string | null = null,
): Promise<{ outcome: string; id: string; key: string | null }> {
  const file = uuid();
  const { rows } = await c.query<{
    outcome: string;
    document_id: string | null;
    storage_key: string | null;
  }>('SELECT * FROM core.catalog_cmd_add_vehicle_document($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
    h.hash,
    h.org,
    vehicleId,
    file,
    type,
    'application/pdf',
    54_321,
    randomBytes(32),
    validUntil,
  ]);
  return { outcome: rows[0]?.outcome ?? '', id: file, key: rows[0]?.storage_key ?? null };
}

async function submitVehicle(
  c: pg.ClientBase,
  h: Host,
  vehicleId: string,
): Promise<{ outcome: string; item: string | null; reasons: string[] }> {
  const { rows } = await c.query<{ outcome: string; item_id: string | null; reasons: string[] }>(
    'SELECT * FROM core.catalog_cmd_submit_vehicle_eligibility($1, $2, $3)',
    [h.hash, h.org, vehicleId],
  );
  return {
    outcome: rows[0]?.outcome ?? '',
    item: rows[0]?.item_id ?? null,
    reasons: rows[0]?.reasons ?? [],
  };
}

/** Véhicule au catalogue (VIN saisi), déclaré, et pourvu des pièces `docs`. */
async function complete(
  c: pg.ClientBase,
  h: Host,
  country: string,
  spec: VehicleSpec,
  d: Declaration = {},
  docs: readonly string[] = [],
): Promise<string> {
  const v = await vehicle(c, h, country, spec);
  if (v.outcome !== 'DONE') throw new Error(`véhicule : ${v.outcome}`);
  expect(await declare(c, h, v.id, d)).toBe('DONE');
  for (const t of docs) {
    const r = await addDoc(c, h, v.id, t);
    if (r.outcome !== 'DONE') throw new Error(`pièce ${t} : ${r.outcome}`);
  }
  return v.id;
}

const vehicleRow = async (c: pg.ClientBase, id: string) =>
  (
    await c.query<{
      eligibility_status: string;
      eligibility_reasons: string[];
      submitted: boolean;
      checked: boolean;
      released: boolean;
      plate: string;
      vin: string | null;
    }>('SELECT * FROM test_fixture.us124_vehicle($1)', [id])
  ).rows[0];
const itemsOf = async (c: pg.ClientBase, subject: string) =>
  (
    await c.query<{
      id: string;
      queue: string;
      subject_type: string;
      status: string;
      decision: string | null;
      country_code: string;
    }>('SELECT * FROM test_fixture.us124_vehicle_items($1)', [subject])
  ).rows;
const checksOf = async (c: pg.ClientBase, id: string) =>
  (
    await c.query<{ kind: string; result: string; reasons: string[]; actor_role: string }>(
      'SELECT * FROM test_fixture.us124_checks($1)',
      [id],
    )
  ).rows;
const docsOf = async (c: pg.ClientBase, id: string) =>
  (
    await c.query<{ id: string; doc_type: string; status: string; reject_reason: string | null }>(
      'SELECT * FROM test_fixture.us124_documents($1)',
      [id],
    )
  ).rows;
const eligibilityOf = async (c: pg.ClientBase, h: Host) =>
  (
    await c.query<{ vehicle_id: string; body: Record<string, unknown> }>(
      'SELECT * FROM core.catalog_host_vehicle_eligibility($1, $2)',
      [h.hash, h.org],
    )
  ).rows;

interface Result {
  readonly outcome: string;
  readonly body: Record<string, unknown> | null;
}
const call = async (c: pg.ClientBase, sql: string, values: unknown[]): Promise<Result> =>
  (await c.query<Result>(sql, values)).rows[0] ?? { outcome: '', body: null };
const claimItem = (c: pg.ClientBase, s: Staff, item: string) =>
  call(c, 'SELECT * FROM core.support_staff_claim_item($1, $2, $3)', [s.hash, uuid(), item]);
const dossier = (c: pg.ClientBase, s: Staff, item: string, req = uuid(), purpose = PURPOSE) =>
  call(c, 'SELECT * FROM core.support_staff_vehicle_eligibility($1, $2, $3, $4)', [
    s.hash,
    req,
    item,
    purpose,
  ]);
const decide = (c: pg.ClientBase, s: Staff, item: string, checklist: unknown, documents: unknown) =>
  call(
    c,
    'SELECT * FROM core.support_staff_decide_vehicle_eligibility($1, $2, $3, $4::jsonb, $5::jsonb)',
    [s.hash, uuid(), item, JSON.stringify(checklist), JSON.stringify(documents)],
  );

const allPass = (over: Partial<Record<(typeof CHECK_KEYS)[number], string>> = {}) =>
  Object.fromEntries(CHECK_KEYS.map((k) => [k, over[k] ?? 'PASS']));

/** Verdict VALID pour chaque pièce soumise (fin de validité dans un an là où elle est exigée). */
async function allValid(c: pg.ClientBase, cc: CountryCase, vehicleId: string) {
  const until = localDate(cc, 365);
  return (await docsOf(c, vehicleId))
    .filter((d) => d.status === 'SUBMITTED')
    .map((d) => ({
      documentId: d.id,
      verdict: 'VALID',
      validUntil: ['INSPECTION', 'COMPULSORY_INSURANCE', 'LENDER_CONSENT'].includes(d.doc_type)
        ? until
        : null,
    }));
}

/** Véhicule complet soumis, élément pris en charge par `ops`. */
async function inReview(
  c: pg.ClientBase,
  cc: CountryCase,
  ops: Staff,
  d: { holder?: string; lien?: boolean } = {},
): Promise<{ h: Host; id: string; item: string }> {
  // pays qui active les pièces (assureur) : la soumission passe par la revue de l'ops
  const docs = [
    ...(ENABLED[cc.country] ?? []),
    ...(d.holder === 'THIRD_PARTY' ? ['OWNER_AUTHORIZATION'] : []),
    ...(d.lien ? ['LENDER_CONSENT'] : []),
  ];
  await docRules(c, cc.country, docs);
  const h = await host(c, cc.country);
  const id = await complete(c, h, cc.country, { year: localYear(cc) - 2 }, d, docs);
  const s = await submitVehicle(c, h, id);
  expect(s.outcome).toBe('DONE');
  const item = s.item ?? '';
  expect((await claimItem(c, ops, item)).outcome).toBe('CLAIMED');
  return { h, id, item };
}

// ---------------------------------------------------------------------------------------------
describe('socle (0077) : RLS, droits, propriétaires', () => {
  it('pièces, contrôles, contestations : RLS ENABLE + FORCE, propriétaire migrator, politiques des seuls propriétaires NOLOGIN, aucun droit applicatif', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<{
          t: string;
          rls: boolean;
          force: boolean;
          owner: string;
          policies: string[];
          grants: number;
        }>(
          `SELECT c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                  pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                  ARRAY(SELECT p.polname || ':' || pg_catalog.array_to_string(ARRAY(
                                 SELECT pg_catalog.pg_get_userbyid(r) FROM pg_catalog.unnest(p.polroles) AS r
                                  ORDER BY 1), ',')
                          FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid ORDER BY 1) AS policies,
                  (SELECT count(*)::int FROM pg_catalog.aclexplode(c.relacl) x
                    WHERE x.grantee = 0
                       OR pg_catalog.pg_get_userbyid(x.grantee) IN ('app_api', 'app_worker', 'app_anon')) AS grants
             FROM pg_catalog.pg_class c
            WHERE c.oid IN ('core.catalog_vehicle_document'::regclass,
                            'core.catalog_vehicle_eligibility_check'::regclass,
                            'core.catalog_vehicle_claim'::regclass)
            ORDER BY 1`,
        );
        expect(rows).toHaveLength(3);
        for (const r of rows) {
          expect(r, r.t).toMatchObject({
            rls: true,
            force: true,
            owner: 'migrator',
            policies: ['catalog_cmd_all:catalog_cmd_owner', 'migrator_all:migrator'],
            grants: 0,
          });
        }
      },
      { database: 'production' },
    );
  });

  it('app_api ne lit ni n’écrit les tables (42501) et n’exécute ni les fonctions de domaine ni les aides ; app_worker et app_anon n’exécutent aucune commande', async () => {
    await withRole('app_api', async (client) => {
      for (const sql of [
        'SELECT id FROM core.catalog_vehicle_document LIMIT 1',
        'SELECT id FROM core.catalog_vehicle_eligibility_check LIMIT 1',
        'SELECT plate FROM core.catalog_vehicle_claim LIMIT 1',
        `SELECT core.catalog_vehicle_dossier(gen_random_uuid(), 'PA')`,
        `SELECT * FROM core.catalog_vehicle_file('VEHICLE', gen_random_uuid(), 'PA', gen_random_uuid())`,
        `SELECT * FROM core.catalog_vehicle_decide(gen_random_uuid(), 'PA', gen_random_uuid(), 'ADMIN', '{}', '[]', NULL)`,
        `SELECT core.catalog_vehicle_claim_dossier(gen_random_uuid(), 'PA')`,
        `SELECT * FROM core.catalog_vehicle_claim_decide(gen_random_uuid(), 'PA', gen_random_uuid(), 'ADMIN', 'UPHOLD', NULL, NULL, NULL)`,
        'SELECT core.catalog_vehicle_publishable(gen_random_uuid())',
        'SELECT core.catalog_vehicle_blockers(gen_random_uuid(), true)',
        'SELECT core.iam_host_public_first_name(gen_random_uuid())',
        `SELECT * FROM core.support_staff_vehicle_item(gen_random_uuid(), gen_random_uuid(), 'VEHICLE', 'X', NULL)`,
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
        const calls: [string, unknown[]][] = [
          [
            'SELECT * FROM core.catalog_cmd_submit_vehicle_eligibility($1, $2, $2)',
            [Buffer.alloc(32), uuid()],
          ],
          [
            'SELECT * FROM core.catalog_host_vehicle_eligibility($1, $2)',
            [Buffer.alloc(32), uuid()],
          ],
          [
            'SELECT * FROM core.support_staff_vehicle_eligibility($1, $2, $2, NULL)',
            [Buffer.alloc(32), uuid()],
          ],
          ['SELECT * FROM core.catalog_public_host_name($1)', [uuid()]],
        ];
        for (const [sql, values] of calls) {
          await client.query('BEGIN');
          try {
            await expect(client.query(sql, values), `${role} ${sql}`).rejects.toMatchObject({
              code: '42501',
            });
          } finally {
            await client.query('ROLLBACK');
          }
        }
      });
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('pièces : fichier privé C2 chiffré par la clé de l’hôte, jamais servi à l’hôte (L1-PM-15)', () => {
  it.each(byCountry)(
    '%s (%s) : la pièce est un fichier DOCUMENTS, C2, clé USER de l’hôte, HOST_UPLOAD ; la lecture de l’hôte ne rend ni la clé de stockage ni la plaque ni le VIN ; sans clé de l’hôte, rien n’est écrit',
    async (country) => {
      await withRole('app_api', async (client) => {
        const h = await host(client, country);
        const v = await vehicle(client, h, country, { year: 2022 });
        expect(v.outcome).toBe('DONE');
        const d = await addDoc(client, h, v.id, 'TITLE');
        expect(d.outcome).toBe('DONE');
        const f = (
          await client.query<Record<string, unknown>>('SELECT * FROM test_fixture.us124_file($1)', [
            d.id,
          ])
        ).rows[0];
        expect(f).toMatchObject({
          bucket: 'DOCUMENTS',
          classification: 'C2',
          source: 'HOST_UPLOAD',
          retention_class: 'VEHICLE_DOCUMENT',
          enc_subject_type: 'USER',
          enc_subject_id: h.userId,
          uploader_user_id: h.userId,
          mime: 'application/pdf',
        });
        // rejeu du même fichier : rien n'est réécrit
        const replay = await client.query<{ outcome: string }>(
          'SELECT * FROM core.catalog_cmd_add_vehicle_document($1, $2, $3, $4, $5, $6, $7, $8, NULL)',
          [h.hash, h.org, v.id, d.id, 'TITLE', 'application/pdf', 54_321, randomBytes(32)],
        );
        expect(replay.rows[0]?.outcome).toBe('DUPLICATE');
        expect(await docsOf(client, v.id)).toHaveLength(1);
        // une nouvelle pièce du même type remplace la précédente
        expect((await addDoc(client, h, v.id, 'TITLE')).outcome).toBe('DONE');
        expect((await docsOf(client, v.id)).map((x) => x.status)).toEqual([
          'SUPERSEDED',
          'SUBMITTED',
        ]);
        const row = await vehicleRow(client, v.id);
        const mine = JSON.stringify(await eligibilityOf(client, h));
        expect(mine).not.toContain(String(f?.['storage_key']));
        expect(mine).not.toContain('storageKey');
        expect(mine).not.toContain(row?.plate ?? '¤');
        expect(mine).not.toContain(row?.vin ?? '¤');

        // sans clé USER de l'hôte (coffre indisponible) : la pièce est refusée, rien n'est écrit
        const k = await host(client, country, ['Ana', 'Pérez'], false);
        const kv = await vehicle(client, k, country, { year: 2022 });
        await expect(
          client.query(
            'SELECT * FROM core.catalog_cmd_add_vehicle_document($1, $2, $3, $4, $5, $6, $7, $8, NULL)',
            [k.hash, k.org, kv.id, uuid(), 'TITLE', 'application/pdf', 10, randomBytes(32)],
          ),
        ).rejects.toMatchObject({ code: '23503' });
        expect(await docsOf(client, kv.id)).toEqual([]);
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('critère 1 — titre : l’hôte déclare être propriétaire ou autorisé (défaut, comme Turo) ; autorisation notariée seulement si le pays l’exige', () => {
  it.each(byCountry)(
    '%s (%s) : défaut — sans l’engagement « propriétaire ou autorisé » ⇒ VEHICLE_TITLE_MISMATCH, refus journalisé, aucun élément de file ; témoin engagement coché (titre d’un tiers) ⇒ ELIGIBLE sans pièce ni revue, publiable',
    async (country) => {
      await withRole('app_api', async (client) => {
        await docRules(client, country, []);
        const h = await host(client, country);
        const id = await complete(
          client,
          h,
          country,
          { year: 2022 },
          { holder: 'THIRD_PARTY', owner: false },
        );
        const r = await submitVehicle(client, h, id);
        expect(r).toEqual({
          outcome: 'VEHICLE_TITLE_MISMATCH',
          item: null,
          reasons: ['VEHICLE_TITLE_MISMATCH'],
        });
        expect(await itemsOf(client, id)).toEqual([]);
        expect(await checksOf(client, id)).toEqual([
          expect.objectContaining({
            kind: 'AUTO_SUBMISSION',
            result: 'REFUSED',
            reasons: ['VEHICLE_TITLE_MISMATCH'],
            actor_role: 'P2P_HOST',
          }),
        ]);
        const mine = (await eligibilityOf(client, h)).find((x) => x.vehicle_id === id)?.body;
        expect(mine).toMatchObject({
          reasons: ['VEHICLE_TITLE_MISMATCH'],
          requiredDocuments: [],
          ownershipAttested: false,
          publishable: false,
        });

        // TÉMOIN : engagement coché ⇒ ELIGIBLE tout de suite, sans pièce ni élément de file
        expect(await declare(client, h, id, { holder: 'THIRD_PARTY' })).toBe('DONE');
        expect(await submitVehicle(client, h, id)).toEqual({
          outcome: 'ELIGIBLE',
          item: null,
          reasons: [],
        });
        expect(await itemsOf(client, id)).toEqual([]);
        expect(await docsOf(client, id)).toEqual([]);
        expect(await vehicleRow(client, id)).toMatchObject({ eligibility_status: 'ELIGIBLE' });
        expect(
          (await eligibilityOf(client, h)).find((x) => x.vehicle_id === id)?.body,
        ).toMatchObject({ ownershipAttested: true, publishable: true, underReview: false });
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : elig_doc_owner_authorization activé — titre d’un tiers, engagement coché, sans autorisation notariée ⇒ VEHICLE_TITLE_MISMATCH ; pièce déposée ⇒ revue de l’ops (élément LISTING) ; titre à son nom : non exigée',
    async (country) => {
      await withRole('app_api', async (client) => {
        await docRules(client, country, ['OWNER_AUTHORIZATION']);
        const h = await host(client, country);
        const id = await complete(client, h, country, { year: 2022 }, { holder: 'THIRD_PARTY' });
        expect((await submitVehicle(client, h, id)).reasons).toEqual(['VEHICLE_TITLE_MISMATCH']);
        expect(
          (await eligibilityOf(client, h)).find((x) => x.vehicle_id === id)?.body,
        ).toMatchObject({ requiredDocuments: ['OWNER_AUTHORIZATION'] });
        expect((await addDoc(client, h, id, 'OWNER_AUTHORIZATION')).outcome).toBe('DONE');
        const ok = await submitVehicle(client, h, id);
        expect(ok.outcome).toBe('DONE');
        expect(await itemsOf(client, id)).toEqual([
          expect.objectContaining({
            id: ok.item,
            queue: 'LISTING',
            subject_type: 'VEHICLE',
            status: 'OPEN',
            country_code: country,
          }),
        ]);
        // pendant la revue, rien ne change (pièce, déclaration)
        expect((await addDoc(client, h, id, 'TITLE')).outcome).toBe('VEHICLE_UNDER_REVIEW');
        expect(await declare(client, h, id)).toBe('VEHICLE_UNDER_REVIEW');
        // titre à son nom : la même règle n'exige rien
        const own = await complete(client, h, country, { year: 2022 });
        expect((await submitVehicle(client, h, own)).outcome).toBe('ELIGIBLE');
        await docRules(client, country, []);
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : chaque pièce du pays (titre, plaque et VIN, inspection, assurance obligatoire) — désactivée : ELIGIBLE sans elle ; activée : VEHICLE_DOCUMENT_REQUIRED, puis revue de l’ops une fois déposée',
    async (country) => {
      await withRole('app_api', async (client) => {
        const h = await host(client, country);
        for (const type of ['TITLE', 'PLATE_VIN_PHOTO', 'INSPECTION', 'COMPULSORY_INSURANCE']) {
          await docRules(client, country, []);
          const off = await complete(client, h, country, { year: 2022 });
          expect((await submitVehicle(client, h, off)).outcome, `${type} désactivée`).toBe(
            'ELIGIBLE',
          );
          await docRules(client, country, [type]);
          const on = await complete(client, h, country, { year: 2022 });
          expect((await submitVehicle(client, h, on)).reasons, `${type} activée`).toEqual([
            'VEHICLE_DOCUMENT_REQUIRED',
          ]);
          expect(
            (await eligibilityOf(client, h)).find((x) => x.vehicle_id === on)?.body,
          ).toMatchObject({ requiredDocuments: [type] });
          expect((await addDoc(client, h, on, type, '2099-12-31')).outcome).toBe('DONE');
          const queued = await submitVehicle(client, h, on);
          expect(queued.outcome, `${type} déposée`).toBe('DONE');
          expect(queued.item).not.toBeNull();
        }
        await docRules(client, country, []);
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : VIN — véhicule de 1981 ou après sans VIN ⇒ VEHICLE_FIELD_REQUIRED ; VIN saisi à la déclaration ⇒ ELIGIBLE ; VIN d’un autre véhicule ⇒ VEHICLE_PLATE_DUPLICATE ; VIN enregistré : jamais remplacé ici',
    async (country) => {
      await withRole('app_api', async (client) => {
        await docRules(client, country, []);
        const h = await host(client, country);
        const v = await vehicle(client, h, country, { year: 2022, vin: null });
        expect(await declare(client, h, v.id)).toBe('DONE');
        expect((await submitVehicle(client, h, v.id)).reasons).toEqual(['VEHICLE_FIELD_REQUIRED']);
        const taken = vin();
        const other = await vehicle(client, h, country, { year: 2022, vin: taken });
        expect(other.outcome).toBe('DONE');
        expect(await declare(client, h, v.id, { vin: taken })).toBe('VEHICLE_PLATE_DUPLICATE');
        const mine = vin();
        expect(await declare(client, h, v.id, { vin: mine.toLowerCase() })).toBe('DONE');
        expect((await vehicleRow(client, v.id))?.vin).toBe(mine);
        expect(await declare(client, h, v.id, { vin: vin() })).toBe('VEHICLE_FIELD_REQUIRED');
        expect((await submitVehicle(client, h, v.id)).outcome).toBe('ELIGIBLE');
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('critère 2 — plaque ou VIN discordants avec le titre : le véhicule reste PENDING, motif journalisé', () => {
  it.each(byCountry)(
    '%s (%s) : l’ops lit le dossier (journalisé), coche PLATE_MATCH puis VIN_MATCH en échec ⇒ PENDING avec VEHICLE_PLATE_MISMATCH / VEHICLE_VIN_MISMATCH ; témoin tout PASS ⇒ ELIGIBLE et publiable',
    async (country, _currency, cc: CountryCase) => {
      await withRole('app_api', async (client) => {
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        for (const [key, reason] of [
          ['PLATE_MATCH', 'VEHICLE_PLATE_MISMATCH'],
          ['VIN_MATCH', 'VEHICLE_VIN_MISMATCH'],
        ] as const) {
          const { h, id, item } = await inReview(client, cc, ops);
          const row = await vehicleRow(client, id);
          const req = uuid();
          const d = await dossier(client, ops, item, req);
          expect(d.outcome).toBe('GRANTED');
          // l'ops voit la plaque, le VIN et le titulaire pour les rapprocher du titre
          expect(d.body).toMatchObject({
            vehicleId: id,
            plate: row?.plate,
            vin: row?.vin,
            holder: { userId: h.userId, legalFirstName: 'Ana', legalLastName: 'Pérez' },
          });
          const log = await client.query('SELECT * FROM test_fixture.us109_access_log($1)', [req]);
          expect(log.rows).toEqual([
            expect.objectContaining({
              actor_user_id: ops.userId,
              subject_type: 'VEHICLE',
              subject_id: id,
              access_kind: 'READ_C2_SUPPORT',
              case_ref: `item:${item}`,
              purpose: PURPOSE,
            }),
          ]);
          const r = await decide(
            client,
            ops,
            item,
            allPass({ [key]: 'FAIL' }),
            await allValid(client, cc, id),
          );
          expect(r).toEqual({
            outcome: 'DECIDED',
            body: expect.objectContaining({ result: 'PENDING', reasons: [reason] }),
          });
          expect(await vehicleRow(client, id)).toMatchObject({
            eligibility_status: 'PENDING',
            eligibility_reasons: [reason],
          });
          const last = (await checksOf(client, id)).at(-1);
          expect(last).toMatchObject({
            kind: 'OPS_REVIEW',
            result: 'PENDING',
            reasons: [reason],
            actor_role: 'OPS_AGENT',
          });
          expect(await itemsOf(client, id)).toEqual([
            expect.objectContaining({ status: 'DONE', decision: 'PENDING' }),
          ]);
          // journal : codes seulement, jamais la plaque ni le VIN
          const audit = (
            await client.query<{ action_code: string; payload: string }>(
              'SELECT * FROM test_fixture.us124_audit($1)',
              [id],
            )
          ).rows;
          expect(audit.map((a) => a.action_code)).toContain('VEHICLE_ELIGIBILITY_DECIDED');
          for (const a of audit) {
            expect(a.payload).not.toContain(row?.plate ?? '¤');
            expect(a.payload).not.toContain(row?.vin ?? '¤');
          }
          const mine = (await eligibilityOf(client, h)).find((x) => x.vehicle_id === id)?.body;
          expect(mine).toMatchObject({
            eligibilityStatus: 'PENDING',
            reasons: [reason],
            underReview: false,
            publishable: false,
          });
        }

        // TÉMOIN : tout PASS ⇒ ELIGIBLE, publiable
        const { h, id, item } = await inReview(client, cc, ops);
        const ok = await decide(client, ops, item, allPass(), await allValid(client, cc, id));
        expect(ok.body).toMatchObject({ result: 'ELIGIBLE', reasons: [] });
        const mine = (await eligibilityOf(client, h)).find((x) => x.vehicle_id === id)?.body;
        expect(mine).toMatchObject({ eligibilityStatus: 'ELIGIBLE', publishable: true });
        // une déclaration modifiée remet le véhicule en PENDING (revue à refaire)
        expect(await declare(client, h, id, { km: 50_000 })).toBe('DONE');
        expect(await vehicleRow(client, id)).toMatchObject({ eligibility_status: 'PENDING' });
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : liste de contrôle fermée (L1-PM-14) : clé manquante, case « tout vérifié », pièce sans verdict, inspection sans fin de validité, date impossible ⇒ CHECKLIST_INVALID, rien n’est écrit ; titre interdit ⇒ INELIGIBLE ; inspection expirée ⇒ VEHICLE_DOCUMENT_EXPIRED',
    async (country, _currency, cc: CountryCase) => {
      await withRole('app_api', async (client) => {
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const { id, item } = await inReview(client, cc, ops);
        const docs = await allValid(client, cc, id);
        const missing = Object.fromEntries(
          CHECK_KEYS.filter((k) => k !== 'REGISTRY').map((k) => [k, 'PASS']),
        );
        const inspectionId = (await docsOf(client, id)).find(
          (x) => x.doc_type === 'INSPECTION',
        )?.id;
        const inspection = docs.find((x) => x.documentId === inspectionId);
        for (const [checklist, documents] of [
          [missing, docs],
          [{ ...allPass(), ALL_VERIFIED: 'PASS' }, docs],
          [allPass({ PLATE_MATCH: 'OK' }), docs],
          [allPass(), docs.slice(1)],
          [allPass(), docs.map((x) => (x === inspection ? { ...x, validUntil: null } : x))],
          [allPass(), docs.map((x) => (x === inspection ? { ...x, validUntil: '2030-02-30' } : x))],
          [allPass(), [...docs, docs[0]]],
        ] as const) {
          expect((await decide(client, ops, item, checklist, documents)).outcome).toBe(
            'CHECKLIST_INVALID',
          );
        }
        expect(await vehicleRow(client, id)).toMatchObject({
          eligibility_status: 'PENDING',
          checked: false,
        });
        expect((await docsOf(client, id)).every((x) => x.status === 'SUBMITTED')).toBe(true);
        expect(['OPEN', 'IN_REVIEW']).toContain((await itemsOf(client, id))[0]?.status);

        // inspection échue hier ⇒ PENDING, VEHICLE_DOCUMENT_EXPIRED (règle stricte)
        const expired = docs.map((x) =>
          x === inspection ? { ...x, validUntil: localDate(cc, -1) } : x,
        );
        const r = await decide(client, ops, item, allPass(), expired);
        expect(r.body).toMatchObject({ result: 'PENDING', reasons: ['VEHICLE_DOCUMENT_EXPIRED'] });

        // titre interdit (BR-LIST-03) ⇒ INELIGIBLE, définitif pour l'hôte
        const second = await inReview(client, cc, ops);
        const bad = await decide(
          client,
          ops,
          second.item,
          allPass({ TITLE_CLEAN: 'FAIL' }),
          await allValid(client, cc, second.id),
        );
        expect(bad.body).toMatchObject({
          result: 'INELIGIBLE',
          reasons: ['VEHICLE_TITLE_FORBIDDEN'],
        });
        expect((await addDoc(client, second.h, second.id, 'TITLE')).outcome).toBe(
          'VEHICLE_INELIGIBLE',
        );
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('critère 3 — véhicule financé : accord du créancier déclaré (défaut, comme Turo) ; document du créancier seulement si le pays l’exige', () => {
  it.each(byCountry)(
    '%s (%s) : défaut — prenda déclarée sans l’engagement « accord du créancier » ⇒ VEHICLE_LENDER_CONSENT_REQUIRED, non publiable ; engagement coché ⇒ ELIGIBLE sans pièce ; vehicle_financed_requires_lender_consent à false ⇒ ELIGIBLE sans engagement',
    async (country) => {
      await withRole('app_api', async (client) => {
        await docRules(client, country, []);
        const h = await host(client, country);
        const id = await complete(
          client,
          h,
          country,
          { year: 2022 },
          { lien: true, lienOk: false },
        );
        expect(await submitVehicle(client, h, id)).toEqual({
          outcome: 'VEHICLE_LENDER_CONSENT_REQUIRED',
          reasons: ['VEHICLE_LENDER_CONSENT_REQUIRED'],
          item: null,
        });
        expect(
          (await eligibilityOf(client, h)).find((x) => x.vehicle_id === id)?.body,
        ).toMatchObject({ publishable: false, lienAttested: false, requiredDocuments: [] });
        // TÉMOIN du paramètre (transaction annulée) : false ⇒ aucun accord demandé
        await client.query('BEGIN');
        try {
          await client.query('SELECT test_fixture.us124_param_version($1, $2, $3::jsonb)', [
            'vehicle_financed_requires_lender_consent',
            country,
            'false',
          ]);
          expect((await submitVehicle(client, h, id)).outcome).toBe('ELIGIBLE');
        } finally {
          await client.query('ROLLBACK');
        }
        // TÉMOIN de l'engagement : coché ⇒ ELIGIBLE, aucune pièce
        expect(await declare(client, h, id, { lien: true })).toBe('DONE');
        expect((await submitVehicle(client, h, id)).outcome).toBe('ELIGIBLE');
        expect(await docsOf(client, id)).toEqual([]);
        expect(
          (await eligibilityOf(client, h)).find((x) => x.vehicle_id === id)?.body,
        ).toMatchObject({ publishable: true, lienAttested: true });
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : elig_doc_lender_consent activé — engagement coché sans document ⇒ VEHICLE_LENDER_CONSENT_REQUIRED ; document refusé par l’ops ⇒ PENDING, non publiable ; témoin document valide ⇒ ELIGIBLE et publiable',
    async (country, _currency, cc: CountryCase) => {
      await withRole('app_api', async (client) => {
        await docRules(client, country, ['LENDER_CONSENT']);
        const h = await host(client, country);
        const id = await complete(client, h, country, { year: 2022 }, { lien: true });
        expect((await submitVehicle(client, h, id)).reasons).toEqual([
          'VEHICLE_LENDER_CONSENT_REQUIRED',
        ]);
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        expect((await addDoc(client, h, id, 'LENDER_CONSENT', '2099-12-31')).outcome).toBe('DONE');
        const s = await submitVehicle(client, h, id);
        expect(s.outcome).toBe('DONE');
        expect((await claimItem(client, ops, s.item ?? '')).outcome).toBe('CLAIMED');
        const docs = await allValid(client, cc, id);
        const consent = (await docsOf(client, id)).find((x) => x.doc_type === 'LENDER_CONSENT');
        const verdicts = docs.map((d) =>
          d.documentId === consent?.id
            ? { documentId: d.documentId, verdict: 'REJECTED', reason: 'ILLEGIBLE' }
            : d,
        );
        const r = await decide(client, ops, s.item ?? '', allPass(), verdicts);
        expect(r.body).toMatchObject({ result: 'PENDING' });
        expect((r.body?.['reasons'] as string[]).sort()).toEqual(
          ['VEHICLE_DOCUMENT_REJECTED', 'VEHICLE_LENDER_CONSENT_REQUIRED'].sort(),
        );
        expect(
          (await eligibilityOf(client, h)).find((x) => x.vehicle_id === id)?.body,
        ).toMatchObject({
          publishable: false,
          requiredDocuments: expect.arrayContaining(['LENDER_CONSENT']),
        });
        // TÉMOIN : document valide ⇒ ELIGIBLE et publiable
        const w = await inReview(client, cc, ops, { lien: true });
        const ok = await decide(client, ops, w.item, allPass(), await allValid(client, cc, w.id));
        expect(ok.body).toMatchObject({ result: 'ELIGIBLE' });
        expect(
          (await eligibilityOf(client, w.h)).find((x) => x.vehicle_id === w.id)?.body,
        ).toMatchObject({ publishable: true });
        await docRules(client, country, []);
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('critère 4 — au-delà de l’âge maximal du pays : refus ; hors catalogue admis (US-118)', () => {
  it.each(byCountry)(
    '%s (%s) : véhicule hors catalogue ⇒ ELIGIBLE depuis US-118 (DEC-FONDATEUR-22 : marque et modèle saisis suffisent) ; 11 ans au seuil 10 ⇒ VEHICLE_TOO_OLD (témoin 10 ans : ELIGIBLE) ; compteur au plafond ⇒ VEHICLE_MILEAGE_TOO_HIGH (témoin un km de moins : ELIGIBLE)',
    async (country, _currency, cc: CountryCase) => {
      await withRole('app_api', async (client) => {
        await docRules(client, country, []);
        const h = await host(client, country);
        // US-118 (0084, DEC-FONDATEUR-22) : la demande d'ajout au catalogue ne bloque plus
        const off = await complete(client, h, country, { year: 2022, offCatalog: true });
        expect(await submitVehicle(client, h, off)).toMatchObject({
          outcome: 'ELIGIBLE',
          reasons: [],
        });

        const year = localYear(cc);
        const old = await complete(client, h, country, { year: year - (MAX_AGE + 1) });
        expect(await submitVehicle(client, h, old)).toMatchObject({
          outcome: 'VEHICLE_TOO_OLD',
          reasons: ['VEHICLE_TOO_OLD'],
          item: null,
        });
        const edge = await complete(client, h, country, { year: year - MAX_AGE });
        expect((await submitVehicle(client, h, edge)).outcome).toBe('ELIGIBLE');

        const km = await complete(client, h, country, { year: 2022 }, { km: KM_CEILING });
        expect((await submitVehicle(client, h, km)).reasons).toEqual(['VEHICLE_MILEAGE_TOO_HIGH']);
        expect(await declare(client, h, km, { km: KM_CEILING - 1 })).toBe('DONE');
        expect((await submitVehicle(client, h, km)).outcome).toBe('ELIGIBLE');

        // seuil d'âge inutilisable (0) ⇒ PARAM_MISSING, jamais soumis (fail-closed)
        const fresh = await complete(client, h, country, { year: 2023 });
        await client.query('BEGIN');
        try {
          await client.query('SELECT test_fixture.us124_param_version($1, $2, $3::jsonb)', [
            'elig_age_years_ceiling',
            country,
            '0',
          ]);
          expect((await submitVehicle(client, h, fresh)).outcome).toBe('PARAM_MISSING');
        } finally {
          await client.query('ROLLBACK');
        }
        expect((await submitVehicle(client, h, fresh)).outcome).toBe('ELIGIBLE');
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('L1-PM-11 — l’hôte B n’agit jamais sur le véhicule de l’hôte A', () => {
  it.each(byCountry)(
    '%s (%s) : déclaration, pièce, soumission et lecture par B sur le véhicule ou le compte de A ⇒ VEHICLE_NOT_FOUND, FORBIDDEN ou rien ; même réponse qu’un véhicule inconnu',
    async (country) => {
      await withRole('app_api', async (client) => {
        const a = await host(client, country);
        const b = await host(client, country);
        const id = await complete(client, a, country, { year: 2022 });
        for (const target of [id, uuid()]) {
          expect(await declare(client, b, target)).toBe('VEHICLE_NOT_FOUND');
          expect((await addDoc(client, b, target, 'TITLE')).outcome).toBe('VEHICLE_NOT_FOUND');
          expect((await submitVehicle(client, b, target)).outcome).toBe('VEHICLE_NOT_FOUND');
        }
        // compte de A demandé avec la session de B : FORBIDDEN, aucune ligne
        const forged = { ...b, org: a.org };
        expect(await declare(client, forged, id)).toBe('FORBIDDEN');
        expect(await eligibilityOf(client, forged)).toEqual([]);
        expect(await docsOf(client, id)).toEqual([]);
        // un hôte de l'autre pays : rien non plus
        const o = await host(client, otherOf(country));
        expect(await declare(client, { ...o, org: a.org }, id)).toBe('FORBIDDEN');
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : console — OPS d’un autre pays ⇒ FORBIDDEN ; OPS du pays sans prise en charge ⇒ CASE_REQUIRED ; motif absent ⇒ PURPOSE_REQUIRED sans journal ; pièce d’un autre véhicule ⇒ FILE_NOT_FOUND ; pièce couverte ⇒ clé de stockage et journal',
    async (country, _currency, cc: CountryCase) => {
      await withRole('app_api', async (client) => {
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const foreign = await elevatedStaff(client, 'OPS_AGENT', [otherOf(country)]);
        const colleague = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const { h, id, item } = await inReview(client, cc, ops);
        expect((await dossier(client, foreign, item)).outcome).toBe('FORBIDDEN');
        expect((await dossier(client, colleague, item)).outcome).toBe('CASE_REQUIRED');
        const req = uuid();
        expect((await dossier(client, ops, item, req, 'court')).outcome).toBe('PURPOSE_REQUIRED');
        expect(
          (await client.query('SELECT * FROM test_fixture.us109_access_log($1)', [req])).rows,
        ).toEqual([]);

        const other = await inReview(client, cc, ops);
        const foreignDoc = (await docsOf(client, other.id))[0]?.id;
        const own = (await docsOf(client, id))[0]?.id;
        const file = (fileId: string | undefined, r = uuid()) =>
          call(client, 'SELECT * FROM core.support_staff_vehicle_file($1, $2, $3, $4, $5, $6)', [
            ops.hash,
            r,
            item,
            'VEHICLE',
            fileId,
            PURPOSE,
          ]);
        expect((await file(foreignDoc)).outcome).toBe('FILE_NOT_FOUND');
        const r2 = uuid();
        const got = await file(own, r2);
        const f = (
          await client.query<{ storage_key: string }>('SELECT * FROM test_fixture.us124_file($1)', [
            own,
          ])
        ).rows[0];
        expect(got).toEqual({
          outcome: 'GRANTED',
          body: {
            fileId: own,
            storageKey: f?.storage_key,
            mime: 'application/pdf',
            bytes: 54_321,
            subjectUserId: h.userId,
          },
        });
        expect(
          (await client.query('SELECT * FROM test_fixture.us109_access_log($1)', [r2])).rows,
        ).toEqual([
          expect.objectContaining({
            subject_type: 'VEHICLE',
            subject_id: id,
            field_or_file: `file:${own}`,
            access_kind: 'READ_C2_SUPPORT',
          }),
        ]);
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
/** Liste de contrôle fermée de la confirmation (ADR-107) : tout PASS par défaut. */
const claimChecks = (over: Record<string, string> = {}) => ({
  CLAIMANT_TITLE: 'PASS',
  CLAIMANT_IDENTITY: 'PASS',
  PLATE_MATCH: 'PASS',
  VIN_MATCH: 'NOT_APPLICABLE',
  ...over,
});
const NOTE = 'Titre du demandeur vérifié contre le registre public';

const decideClaimOf =
  (c: pg.ClientBase, item: string) =>
  (
    s: Staff,
    decision: string,
    reason: string | null,
    checklist: unknown = null,
    note: string | null = null,
  ) =>
    call(
      c,
      'SELECT * FROM core.support_staff_decide_vehicle_claim($1, $2, $3, $4, $5, $6::jsonb, $7)',
      [
        s.hash,
        uuid(),
        item,
        decision,
        reason,
        checklist === null ? null : JSON.stringify(checklist),
        note,
      ],
    );
const readClaim = (c: pg.ClientBase, s: Staff, item: string) =>
  call(c, 'SELECT * FROM core.support_staff_vehicle_claim($1, $2, $3, $4)', [
    s.hash,
    uuid(),
    item,
    PURPOSE,
  ]);

/** Contestation ouverte par `b` contre la plaque `p` ; rend l'élément de file. */
async function openClaim(c: pg.ClientBase, b: Host, p: string, vinOf: string | null = null) {
  const r = await c.query<{ outcome: string; claim_id: string }>(
    'SELECT * FROM core.catalog_cmd_open_vehicle_claim($1, $2, $3, $4, $5, $6, $7, $8)',
    [b.hash, b.org, p, vinOf, uuid(), 'application/pdf', 4096, randomBytes(32)],
  );
  if (r.rows[0]?.outcome !== 'DONE') throw new Error(`contestation : ${r.rows[0]?.outcome}`);
  const claim = r.rows[0].claim_id;
  const [item] = await itemsOf(c, claim);
  return { claim, item: item?.id ?? '' };
}

describe('N-61 — plaque ou VIN pris par un autre hôte : contestation, libération par un ADMIN', () => {
  it.each(byCountry)(
    '%s (%s) : B reçoit VEHICLE_PLATE_DUPLICATE, conteste avec son titre ; l’OPS lit, ne peut confirmer (ADMIN_REQUIRED) ; l’ADMIN confirme ⇒ le véhicule de A est libéré (INELIGIBLE, annonce REMOVED_BY_PLATFORM) et B enregistre la plaque',
    async (country, _currency, cc: CountryCase) => {
      await withRole('app_api', async (client) => {
        const a = await host(client, country);
        const b = await host(client, country, ['Luis', 'Gómez']);
        const p = plate();
        const v = vin();
        const av = await vehicle(client, a, country, { year: 2022, plate: p, vin: v });
        expect(av.outcome).toBe('DONE');
        const lst = await client.query<{ listing_id: string }>(
          `SELECT * FROM core.catalog_cmd_create_listing($1, $2, $3, $4, 'UNLIMITED', NULL, NULL, NULL)`,
          [a.hash, a.org, av.id, 40 * cc.priceStepMinor],
        );
        const listing = lst.rows[0]?.listing_id ?? '';
        await client.query(`SELECT test_fixture.us115_set_listing_status($1, 'LISTED')`, [listing]);
        expect((await vehicle(client, b, country, { year: 2022, plate: p })).outcome).toBe(
          'VEHICLE_PLATE_DUPLICATE',
        );
        const permitted = (bb: Host, pl: string, vn: string | null) =>
          client
            .query<{ outcome: string }>(
              'SELECT * FROM core.catalog_vehicle_claim_permitted($1, $2, $3, $4)',
              [bb.hash, bb.org, pl, vn],
            )
            .then((r) => r.rows[0]?.outcome);
        expect(await permitted(b, plate(), null)).toBe('CLAIM_NOT_NEEDED');
        expect(await permitted(a, p, null)).toBe('CLAIM_NOT_NEEDED');
        expect(await permitted(b, p.toLowerCase(), null)).toBe('OK');
        const open = (bb: Host, pl: string) =>
          client
            .query<{ outcome: string; claim_id: string | null }>(
              'SELECT * FROM core.catalog_cmd_open_vehicle_claim($1, $2, $3, NULL, $4, $5, $6, $7)',
              [bb.hash, bb.org, pl, uuid(), 'image/jpeg', 2048, randomBytes(32)],
            )
            .then((r) => r.rows[0]);
        const c1 = await open(b, p);
        expect(c1?.outcome).toBe('DONE');
        expect((await open(b, p))?.outcome).toBe('CLAIM_DUPLICATE');
        const claim = c1?.claim_id ?? '';
        const [item] = await itemsOf(client, claim);
        expect(item).toMatchObject({
          queue: 'LISTING',
          subject_type: 'VEHICLE_CLAIM',
          status: 'OPEN',
        });
        // rien n'est révélé à B du compte en cause
        const mine = await client.query('SELECT * FROM core.catalog_host_vehicle_claims($1, $2)', [
          b.hash,
          b.org,
        ]);
        expect(mine.rows).toEqual([
          expect.objectContaining({ claim_id: claim, plate: p, status: 'OPEN' }),
        ]);
        expect(JSON.stringify(mine.rows)).not.toContain(av.id);
        expect(JSON.stringify(mine.rows)).not.toContain(a.org);

        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const admin = await elevatedStaff(client, 'ADMIN', [country]);
        expect((await claimItem(client, ops, item?.id ?? '')).outcome).toBe('CLAIMED');
        const read = await call(
          client,
          'SELECT * FROM core.support_staff_vehicle_claim($1, $2, $3, $4)',
          [ops.hash, uuid(), item?.id, PURPOSE],
        );
        expect(read.outcome).toBe('GRANTED');
        expect(read.body).toMatchObject({
          plate: p,
          claimant: { userId: b.userId, legalFirstName: 'Luis', legalLastName: 'Gómez' },
          targetHolder: { userId: a.userId, legalFirstName: 'Ana' },
          target: { vehicleId: av.id, plate: p, vin: v },
        });
        const decideClaim = decideClaimOf(client, item?.id ?? '');
        const checks = claimChecks({ VIN_MATCH: 'PASS' });
        expect((await decideClaim(ops, 'UPHOLD', null, checks, NOTE)).outcome).toBe(
          'ADMIN_REQUIRED',
        );
        // l'ADMIN n'a pas lu le dossier lui-même (seul l'ops l'a lu) : refus
        expect((await decideClaim(admin, 'UPHOLD', null, checks, NOTE)).outcome).toBe(
          'CLAIM_DOSSIER_NOT_READ',
        );
        expect((await readClaim(client, admin, item?.id ?? '')).outcome).toBe('GRANTED');
        expect((await decideClaim(admin, 'UPHOLD', null, checks, null)).outcome).toBe(
          'CLAIM_NOTE_REQUIRED',
        );
        expect(
          (await decideClaim(admin, 'UPHOLD', 'INSUFFICIENT_PROOF', checks, NOTE)).outcome,
        ).toBe('CLAIM_REASON_INVALID');
        // liste fermée : clé manquante, valeur hors liste, case en échec
        for (const [list, outcome] of [
          [{ CLAIMANT_TITLE: 'PASS' }, 'CLAIM_CHECKLIST_INVALID'],
          [{ ...checks, VIN_MATCH: 'MAYBE' }, 'CLAIM_CHECKLIST_INVALID'],
          [{ ...checks, ALL_VERIFIED: 'PASS' }, 'CLAIM_CHECKLIST_INVALID'],
          [{ ...checks, PLATE_MATCH: 'FAIL' }, 'CLAIM_CHECKLIST_FAILED'],
        ] as const) {
          expect((await decideClaim(admin, 'UPHOLD', null, list, NOTE)).outcome).toBe(outcome);
        }
        expect(await vehicleRow(client, av.id)).toMatchObject({ released: false });
        const ok = await decideClaim(admin, 'UPHOLD', null, checks, NOTE);
        expect(ok).toEqual({
          outcome: 'DECIDED',
          body: { itemId: item?.id, claimId: claim, status: 'UPHELD' },
        });
        // l'hôte lésé est notifié (événement de l'outbox, sans donnée du demandeur)
        const events = await client.query('SELECT * FROM test_fixture.us114_events($1)', [av.id]);
        expect(events.rows).toEqual([
          expect.objectContaining({
            type: 'catalog.vehicle.released',
            aggregate_type: 'catalog_vehicle',
            country_code: country,
            actor_user_id: admin.userId,
            actor_role: 'ADMIN',
            payload: expect.objectContaining({
              vehicle_id: av.id,
              org_id: a.org,
              host_user_id: a.userId,
              claim_id: claim,
            }),
          }),
        ]);
        expect(JSON.stringify(events.rows)).not.toContain(b.userId);
        expect(await vehicleRow(client, av.id)).toMatchObject({
          released: true,
          eligibility_status: 'INELIGIBLE',
          eligibility_reasons: ['VEHICLE_RELEASED'],
        });
        const st = await client.query<{ status: string }>(
          'SELECT * FROM test_fixture.us115_listing_row($1)',
          [listing],
        );
        expect(st.rows[0]?.status).toBe('REMOVED_BY_PLATFORM');
        // la plaque et le VIN redeviennent disponibles : B enregistre son véhicule
        expect((await vehicle(client, b, country, { year: 2022, plate: p, vin: v })).outcome).toBe(
          'DONE',
        );
        // A ne peut plus rien soumettre sur le véhicule libéré
        expect(await declare(client, a, av.id)).toBe('VEHICLE_RELEASED');
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : DISMISS motivé ⇒ contestation DISMISSED, le véhicule de A est intact, la plaque reste prise',
    async (country) => {
      await withRole('app_api', async (client) => {
        const a = await host(client, country);
        const b = await host(client, country);
        const p = plate();
        const av = await vehicle(client, a, country, { year: 2022, plate: p });
        const c1 = await client.query<{ outcome: string; claim_id: string }>(
          'SELECT * FROM core.catalog_cmd_open_vehicle_claim($1, $2, $3, NULL, $4, $5, $6, $7)',
          [b.hash, b.org, p, uuid(), 'application/pdf', 4096, randomBytes(32)],
        );
        const claim = c1.rows[0]?.claim_id ?? '';
        const [item] = await itemsOf(client, claim);
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        expect((await claimItem(client, ops, item?.id ?? '')).outcome).toBe('CLAIMED');
        const decideClaim = (reason: string | null) =>
          decideClaimOf(client, item?.id ?? '')(ops, 'DISMISS', reason);
        expect((await decideClaim(null)).outcome).toBe('CLAIM_REASON_INVALID');
        expect((await decideClaim('INSUFFICIENT_PROOF')).outcome).toBe('DECIDED');
        const claims = await client.query('SELECT * FROM test_fixture.us124_claims($1)', [b.org]);
        expect(claims.rows[0]).toMatchObject({
          status: 'DISMISSED',
          dismiss_reason: 'INSUFFICIENT_PROOF',
        });
        expect(await vehicleRow(client, av.id)).toMatchObject({ released: false });
        expect((await vehicle(client, b, country, { year: 2022, plate: p })).outcome).toBe(
          'VEHICLE_PLATE_DUPLICATE',
        );
      });
    },
  );
});

describe('N-61 — garde-fous de la libération (revue sécurité US-124, constats 1, 2 et 4)', () => {
  it.each(byCountry)(
    '%s (%s) : trip à venir sur le véhicule en cause ⇒ CLAIM_TARGET_BOOKED avec la liste (aucune libération) ; témoin trip passé : libéré ; second demandeur sur le véhicule déjà libéré ⇒ CLAIM_TARGET_RELEASED (jamais UPHELD sans effet) ; recours de l’hôte lésé jugé par un autre ADMIN (SAME_ADMIN_FORBIDDEN)',
    async (country, currency, cc: CountryCase) => {
      await withRole('app_api', async (client) => {
        const a = await host(client, country);
        const b = await host(client, country);
        const d = await host(client, country);
        const p = plate();
        const av = await vehicle(client, a, country, { year: 2022, plate: p });
        const guest = await host(client, country);
        const day = 86_400_000;
        const trip = (start: number, end: number) =>
          client.query('SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
            uuid(),
            guest.userId,
            a.org,
            av.id,
            country,
            currency,
            cc.timezone,
            new Date(Date.now() + start * day),
            new Date(Date.now() + end * day),
          ]);
        await trip(10, 12);
        const admin = await elevatedStaff(client, 'ADMIN', [country]);
        const first = await openClaim(client, b, p);

        const upholdFirst = decideClaimOf(client, first.item);
        const dossier = await readClaim(client, admin, first.item);
        expect(dossier.body).toMatchObject({
          bookings: [expect.objectContaining({ kind: 'TRIP' })],
        });
        const booked = await upholdFirst(admin, 'UPHOLD', null, claimChecks(), NOTE);
        expect(booked.outcome).toBe('CLAIM_TARGET_BOOKED');
        expect(booked.body).toMatchObject({
          bookings: [expect.objectContaining({ kind: 'TRIP' })],
        });
        expect(await vehicleRow(client, av.id)).toMatchObject({ released: false });
        expect(
          (await client.query('SELECT * FROM test_fixture.us114_events($1)', [av.id])).rows,
        ).toEqual([]);

        // TÉMOIN : le même véhicule sans réservation à venir (autre véhicule, trip déjà fini)
        const q = plate();
        const free = await vehicle(client, a, country, { year: 2022, plate: q });
        await client.query(
          'SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          [
            uuid(),
            guest.userId,
            a.org,
            free.id,
            country,
            currency,
            cc.timezone,
            new Date(Date.now() - 5 * day),
            new Date(Date.now() - 3 * day),
          ],
        );
        const c1 = await openClaim(client, b, q);
        const c2 = await openClaim(client, d, q);
        expect((await readClaim(client, admin, c1.item)).outcome).toBe('GRANTED');
        expect(
          (await decideClaimOf(client, c1.item)(admin, 'UPHOLD', null, claimChecks(), NOTE))
            .outcome,
        ).toBe('DECIDED');
        expect(await vehicleRow(client, free.id)).toMatchObject({ released: true });
        // second demandeur : le véhicule en cause est déjà libéré ⇒ refus explicite, reste OPEN
        const other = await elevatedStaff(client, 'ADMIN', [country]);
        expect((await readClaim(client, other, c2.item)).outcome).toBe('GRANTED');
        expect(
          (await decideClaimOf(client, c2.item)(other, 'UPHOLD', null, claimChecks(), NOTE))
            .outcome,
        ).toBe('CLAIM_TARGET_RELEASED');
        expect(
          (await client.query('SELECT * FROM test_fixture.us124_claims($1)', [d.org])).rows,
        ).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'OPEN' })]));

        // recours : B enregistre la plaque ; A la conteste à son tour ; l'ADMIN qui a libéré ne
        // peut pas confirmer, un autre ADMIN le peut
        const bv = await vehicle(client, b, country, { year: 2022, plate: q });
        expect(bv.outcome).toBe('DONE');
        const back = await openClaim(client, a, q);
        expect((await readClaim(client, admin, back.item)).outcome).toBe('GRANTED');
        expect(
          (await decideClaimOf(client, back.item)(admin, 'UPHOLD', null, claimChecks(), NOTE))
            .outcome,
        ).toBe('SAME_ADMIN_FORBIDDEN');
        expect((await readClaim(client, other, back.item)).outcome).toBe('GRANTED');
        expect(
          (await decideClaimOf(client, back.item)(other, 'UPHOLD', null, claimChecks(), NOTE))
            .outcome,
        ).toBe('DECIDED');
        expect(await vehicleRow(client, bv.id)).toMatchObject({ released: true });
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('N-37 — nom affiché au voyageur : premier mot du prénom légal, jamais le nom légal complet', () => {
  it.each(byCountry)(
    '%s (%s) : annonce LISTED d’« Ana María Pérez Gómez » (compte ACTIVE) ⇒ « Ana » ; annonce non publiée ⇒ aucune ligne ; compte non ACTIVE ⇒ aucun nom ; la fiche publique ne porte ni plaque ni VIN',
    async (country, _currency, cc: CountryCase) => {
      await withRole('app_api', async (client) => {
        const h = await host(client, country, ['Ana María', 'Pérez Gómez']);
        const v = await vehicle(client, h, country, { year: 2022 });
        const lst = await client.query<{ listing_id: string }>(
          `SELECT * FROM core.catalog_cmd_create_listing($1, $2, $3, $4, 'UNLIMITED', NULL, NULL, NULL)`,
          [h.hash, h.org, v.id, 40 * cc.priceStepMinor],
        );
        const listing = lst.rows[0]?.listing_id ?? '';
        const name = () =>
          client
            .query<{ host_first_name: string | null }>(
              'SELECT * FROM core.catalog_public_host_name($1)',
              [listing],
            )
            .then((r) => r.rows);
        expect(await name()).toEqual([]);
        await client.query(`SELECT test_fixture.us115_set_listing_status($1, 'LISTED')`, [listing]);
        expect(await name()).toEqual([{ host_first_name: null }]);
        await client.query(`SELECT test_fixture.us115_set_org_status($1, 'ACTIVE')`, [h.org]);
        expect(await name()).toEqual([{ host_first_name: 'Ana' }]);
        const pub = await client.query('SELECT * FROM core.catalog_public_listing($1)', [listing]);
        const row = await vehicleRow(client, v.id);
        const text = JSON.stringify([pub.rows, await name()]);
        for (const secret of ['María', 'Pérez', 'Gómez', row?.plate, row?.vin]) {
          expect(text).not.toContain(secret ?? '¤');
        }
      });
    },
  );
});
