/**
 * Import de la douane au catalogue des véhicules (suite d'US-113, migration 0079 ; ADR-109,
 * ADR-094 ; 17 §3.2.3, ADR-034) sous les rôles de production (assertion L0-05 en tête par
 * withRole) :
 * - schéma : source `DNIT_ADUANAS_PY` admise sur les trois tables ; fiche technique facultative pour
 *   cette seule source (contraintes `*_specs_complete`) ; preuves sous migrator : fixture 9981
 *   (lignes sans fiche d'une autre source, sans licence, sans source ou de source inconnue refusées ;
 *   toute ligne de la douane non vérifiée, avec référence et note de licence) ;
 * - graine (base « production » du banc) : nombre de marques, modèles et variantes chargés, aucun
 *   doublon de marque ni de modèle après normalisation, modèles de la liste de test du rapport
 *   présents et choisissables, variantes sans fiche communes à tous les pays depuis 0095 (N-101,
 *   ADR-123 ; lot 2 : 0096), lues par app_api ;
 * - parcours de l'hôte : un véhicule se crée sur une variante sans fiche dans CHAQUE pays (l'hôte
 *   saisit lui-même boîte, places et carburant) ; hors des années : CATALOG_VARIANT_NOT_FOUND.
 *   Parcours jusqu'à l'annonce publique : l0-n101-catalogue-pa.test.ts.
 * Valeurs attendues : le fichier de données `vehicle-catalog-dnit.json` (lu ici sans le code de
 * l'API), le rapport d'import du 2026-11-12 et 17 §3.2.3, jamais le code testé.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withRole } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import type pg from 'pg';

interface CustomsModel {
  slug: string;
  name: string;
  existing?: boolean;
  variant: { yearFrom: number; yearTo: number | null } | null;
}
interface CustomsDoc {
  market: string;
  makes: Array<{ slug: string; name: string; existing?: boolean; models: CustomsModel[] }>;
}
const CUSTOMS = JSON.parse(
  readFileSync(
    new URL('../../../../apps/api/src/modules/cat/data/vehicle-catalog-dnit.json', import.meta.url),
    'utf8',
  ),
) as CustomsDoc;
const NEW_MAKES = CUSTOMS.makes.filter((m) => m.existing !== true);
const NEW_MODELS = CUSTOMS.makes.flatMap((m) => m.models.filter((o) => o.existing !== true));
const VARIANTS = CUSTOMS.makes.flatMap((m) =>
  m.models.filter((o) => o.variant !== null).map((o) => ({ make: m.slug, model: o })),
);

/** Clé de doublon : sans accents, sans casse, sans ponctuation (ADR-109). */
const dupKey = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/** Liste de test de SRC_VEHICLE_DATA §1, reprise par le rapport (16 sur 16 trouvés). */
const TEST_LIST: ReadonlyArray<readonly [string, string]> = [
  ['toyota', 'Hilux'],
  ['chevrolet', 'S10'],
  ['nissan', 'Frontier'],
  ['toyota', 'Fortuner'],
  ['toyota', 'Rush'],
  ['mitsubishi', 'L200'],
  ['suzuki', 'Swift'],
  ['suzuki', 'Vitara'],
  ['suzuki', 'Grand Vitara'],
  ['toyota', 'Yaris'],
  ['toyota', 'Yaris Cross'],
  ['kia', 'Picanto'],
  ['fiat', 'Strada'],
  ['chevrolet', 'Onix'],
  ['hyundai', 'Creta'],
  ['nissan', 'Kicks'],
  ['hyundai', 'Accent'],
];

const TABLES = [
  'catalog_vehicle_make',
  'catalog_vehicle_model',
  'catalog_vehicle_variant',
] as const;

describe('schéma (0079)', () => {
  it('source DNIT_ADUANAS_PY admise par le CHECK des trois tables, sans autre valeur nouvelle', async () => {
    await withRole('app_api', async (client) => {
      for (const t of TABLES) {
        const { rows } = await client.query<{ def: string }>(
          `SELECT pg_catalog.pg_get_constraintdef(oid) AS def FROM pg_catalog.pg_constraint
            WHERE conrelid = ('core.' || $1)::regclass AND conname = $1 || '_source_check'`,
          [t],
        );
        const def = rows[0]?.def ?? '';
        for (const s of [
          'WIKIDATA',
          'NHTSA_VPIC',
          'OPS_CURATED',
          'HOST_REQUEST',
          'DNIT_ADUANAS_PY',
        ])
          expect(def, `${t} ${s}`).toContain(`'${s}'::text`);
        expect(def.match(/'[A-Z_]+'::text/g)?.length, t).toBe(5);
      }
    });
  });

  it('fiche facultative pour la seule source sans fiche (*_specs_complete), NOT NULL ailleurs', async () => {
    await withRole('app_api', async (client) => {
      const nullable = await client.query<{ rel: string; att: string; notnull: boolean }>(
        `SELECT c.relname AS rel, a.attname AS att, a.attnotnull AS notnull
           FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
          WHERE c.oid IN ('core.catalog_vehicle_model'::regclass, 'core.catalog_vehicle_variant'::regclass)
            AND a.attname IN ('body_type', 'seats_default', 'doors_default', 'transmission',
                              'fuel_type', 'drive', 'seats', 'doors', 'source', 'license_note')
          ORDER BY 1, 2`,
      );
      for (const r of nullable.rows) {
        expect(r.notnull, `${r.rel}.${r.att}`).toBe(['source', 'license_note'].includes(r.att));
      }
      const checks = await client.query<{ conname: string; def: string }>(
        `SELECT conname, pg_catalog.pg_get_constraintdef(oid) AS def FROM pg_catalog.pg_constraint
          WHERE conname IN ('catalog_vehicle_model_specs_complete',
                            'catalog_vehicle_variant_specs_complete')
          ORDER BY conname`,
      );
      expect(checks.rows.map((r) => r.conname)).toEqual([
        'catalog_vehicle_model_specs_complete',
        'catalog_vehicle_variant_specs_complete',
      ]);
      for (const r of checks.rows) expect(r.def, r.conname).toContain("'DNIT_ADUANAS_PY'");
    });
  });

  it('la preuve 9981 a joué (témoin RETIRED) ; aucune ligne refusée chargée', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ slug: string; status: string }>(
        `SELECT slug, status FROM core.catalog_vehicle_make WHERE slug LIKE 'zz-douane-%' ORDER BY slug`,
      );
      expect(rows).toEqual([
        { slug: 'zz-douane-rejet', status: 'RETIRED' },
        { slug: 'zz-douane-temoin', status: 'ACTIVE' },
      ]);
      const refused = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM core.catalog_vehicle_model
          WHERE slug IN ('zz-ops-sans-fiche', 'zz-hote-complet', 'zz-douane-sans-licence',
                         'zz-douane-sans-source', 'zz-source-inconnue', 'zz-douane-carrosserie')`,
      );
      expect(refused.rows[0]?.n).toBe(0);
    });
  });
});

describe('graine de la douane (base « production » du banc)', () => {
  it('lignes chargées : marques et modèles nouveaux ACTIVE, sans fiche, lus par app_api', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const makes = await client.query<{ slug: string; status: string }>(
          `SELECT slug, status FROM core.catalog_vehicle_make WHERE slug = ANY($1::text[])`,
          [NEW_MAKES.map((m) => m.slug)],
        );
        expect(makes.rows.length).toBe(NEW_MAKES.length);
        expect(makes.rows.every((r) => r.status === 'ACTIVE')).toBe(true);
        // modèles sans fiche = modèles nouveaux de la douane (la v1 a toujours la sienne)
        const models = await client.query<{ n: number; active: number }>(
          `SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'ACTIVE')::int AS active
             FROM core.catalog_vehicle_model
            WHERE body_type IS NULL AND seats_default IS NULL AND doors_default IS NULL`,
        );
        expect(models.rows[0]).toEqual({ n: NEW_MODELS.length, active: NEW_MODELS.length });
        const variants = await client.query<{ market: string | null; n: number }>(
          `SELECT market::text AS market, count(*)::int AS n FROM core.catalog_vehicle_variant
            WHERE transmission IS NULL AND fuel_type IS NULL AND drive IS NULL
              AND seats IS NULL AND doors IS NULL AND trim_name IS NULL AND status = 'ACTIVE'
            GROUP BY market`,
        );
        // communes à tous les pays depuis 0095 (N-101) ; aucune ne garde le marché de la source
        expect(variants.rows).toEqual([{ market: null, n: VARIANTS.length }]);
        // au moins 600 modèles et 50 marques nouveaux (rapport : 758 modèles d'au moins 30 unités)
        expect(NEW_MODELS.length).toBeGreaterThanOrEqual(600);
        expect(NEW_MAKES.length).toBeGreaterThanOrEqual(50);
      },
      { database: 'production' },
    );
  });

  it('aucun doublon de marque ni de modèle après normalisation (casse, accents, ponctuation)', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const makes = await client.query<{ id: string; name: string; aliases: string[] }>(
          'SELECT id, name, aliases FROM core.catalog_vehicle_make',
        );
        const makeKeys = makes.rows.map((r) => dupKey(r.name));
        expect(new Set(makeKeys).size).toBe(makeKeys.length);
        const models = await client.query<{ make_id: string; name: string }>(
          'SELECT make_id, name FROM core.catalog_vehicle_model',
        );
        const keys = models.rows.map((r) => `${r.make_id}|${dupKey(r.name)}`);
        const dups = keys.filter((k, i) => keys.indexOf(k) !== i);
        expect(dups).toEqual([]);
        // une seule variante sans fiche par modèle
        const perModel = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM (
             SELECT model_id FROM core.catalog_vehicle_variant
              WHERE transmission IS NULL GROUP BY model_id HAVING count(*) > 1) AS d`,
        );
        expect(perModel.rows[0]?.n).toBe(0);
      },
      { database: 'production' },
    );
  });

  it.each(COUNTRIES)(
    'liste de test du rapport : chaque modèle est choisissable en $country ($currency) ; aucune variante de la douane n’est réservée à un pays (0095)',
    async ({ country }) => {
      await withRole(
        'app_api',
        async (client) => {
          for (const [make, model] of TEST_LIST) {
            const { rows } = await client.query<{ n: number }>(
              `SELECT count(*)::int AS n
                 FROM core.catalog_vehicle_variant v
                 JOIN core.catalog_vehicle_model o ON o.id = v.model_id AND o.status = 'ACTIVE'
                 JOIN core.catalog_vehicle_make m ON m.id = o.make_id AND m.status = 'ACTIVE'
                WHERE m.slug = $1 AND o.name = $2 AND v.status = 'ACTIVE'
                  AND (v.market IS NULL OR v.market::text = $3)`,
              [make, model, country],
            );
            expect(rows[0]?.n, `${make} ${model}`).toBeGreaterThan(0);
          }
          const own = await client.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM core.catalog_vehicle_variant
              WHERE status = 'ACTIVE' AND market::text = $1`,
            [country],
          );
          expect(own.rows[0]?.n).toBe(0);
        },
        { database: 'production' },
      );
    },
  );

  it('années indicatives : bornes des données ; Hilux de la v1 complété avant ses variantes', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const premio = CUSTOMS.makes
          .find((m) => m.slug === 'toyota')
          ?.models.find((o) => o.slug === 'premio');
        const hilux = CUSTOMS.makes
          .find((m) => m.slug === 'toyota')
          ?.models.find((o) => o.slug === 'hilux');
        if (!premio?.variant || !hilux?.variant)
          throw new Error('Premio ou Hilux absent des données');
        const { rows } = await client.query<{
          slug: string;
          year_from: number;
          year_to: number | null;
        }>(
          `SELECT o.slug, v.year_from, v.year_to
             FROM core.catalog_vehicle_variant v
             JOIN core.catalog_vehicle_model o ON o.id = v.model_id
             JOIN core.catalog_vehicle_make m ON m.id = o.make_id
            WHERE m.slug = 'toyota' AND o.slug IN ('premio', 'hilux') AND v.transmission IS NULL
            ORDER BY o.slug`,
        );
        expect(rows).toEqual([
          { slug: 'hilux', year_from: hilux.variant.yearFrom, year_to: hilux.variant.yearTo },
          { slug: 'premio', year_from: premio.variant.yearFrom, year_to: premio.variant.yearTo },
        ]);
        const v1 = await client.query<{ first: number }>(
          `SELECT min(v.year_from)::int AS first FROM core.catalog_vehicle_variant v
             JOIN core.catalog_vehicle_model o ON o.id = v.model_id
             JOIN core.catalog_vehicle_make m ON m.id = o.make_id
            WHERE m.slug = 'toyota' AND o.slug = 'hilux' AND v.transmission IS NOT NULL`,
        );
        expect(hilux.variant.yearTo ?? Infinity).toBeLessThan(v1.rows[0]?.first ?? 0);
      },
      { database: 'production' },
    );
  });
});

// ---- parcours de l'hôte (base de test : fixtures d'IAM), transaction annulée ----------------------
const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';

async function hostOf(
  client: pg.ClientBase,
  country: string,
): Promise<{ hash: Buffer; org: string; location: string }> {
  const userId = uuid();
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400, NULL,
                                                $6, $7::jsonb, false) AS ok`,
    [userId, `host-${userId}@example.test`, phcArgon2id(), uuid(), randomBytes(32), country, DOCS],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await client.query('SELECT test_fixture.iam_set_account_status($1, $2)', [userId, 'ACTIVE']);
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
  const loc = await client.query<{ outcome: string; location_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_location($1, $2, 'HOME', 'Casa', 'Calle 1', 'Ciudad',
                                                    'Zona', 8.9837, -79.5198)`,
    [t.hash, org],
  );
  const location = loc.rows[0]?.location_id;
  if (!location) throw new Error(`lieu refusé : ${loc.rows[0]?.outcome ?? ''}`);
  return { hash: t.hash, org, location };
}

async function createVehicle(
  client: pg.ClientBase,
  h: { hash: Buffer; org: string; location: string },
  variantId: string,
  year: number,
): Promise<string> {
  const { rows } = await client.query<{ outcome: string }>(
    `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, NULL, $5, NULL, NULL, $6, NULL,
                                                   'MANUAL', 5::smallint, 'DIESEL', 120000,
                                                   false, false)`,
    [
      h.hash,
      h.org,
      h.location,
      `D${randomBytes(4).toString('hex').toUpperCase()}`,
      variantId,
      year,
    ],
  );
  return rows[0]?.outcome ?? '';
}

describe('parcours de l’hôte : une variante sans fiche est choisissable (ADR-109, ADR-123)', () => {
  it.each(COUNTRIES)(
    '$country ($currency) : variante de la douane (commune depuis 0095) ⇒ DONE ; variante sans fiche commune (9981) ⇒ DONE',
    async ({ country }) => {
      await withRole('app_api', async (client) => {
        await client.query('BEGIN');
        try {
          const h = await hostOf(client, country);
          const premio = await client.query<{ id: string; year_from: number }>(
            `SELECT v.id, v.year_from FROM core.catalog_vehicle_variant v
               JOIN core.catalog_vehicle_model o ON o.id = v.model_id
               JOIN core.catalog_vehicle_make m ON m.id = o.make_id
              WHERE m.slug = 'toyota' AND o.slug = 'premio' AND v.transmission IS NULL`,
          );
          const p = premio.rows[0];
          if (!p) throw new Error('variante Premio de la douane absente');
          expect(await createVehicle(client, h, p.id, p.year_from)).toBe('DONE');
          expect(await createVehicle(client, h, '11300000-0000-4000-8000-000000000d42', 2010)).toBe(
            'DONE',
          );
          // hors des années indicatives de la variante : refus (l'hôte passe par la file d'ajout)
          expect(await createVehicle(client, h, '11300000-0000-4000-8000-000000000d42', 2016)).toBe(
            'CATALOG_VARIANT_NOT_FOUND',
          );
        } finally {
          await client.query('ROLLBACK');
        }
      });
    },
  );
});
