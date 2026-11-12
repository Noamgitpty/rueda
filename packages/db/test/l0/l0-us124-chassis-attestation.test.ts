/**
 * Preuves du correctif d'US-124 (migration 0083 ; fixtures 9974 et 9982) sous le rôle de
 * production app_api (assertion L0-05 en tête de chaque connexion, withRole), en USD (PA) et en
 * PYG (PY). Chaque test crée ses propres hôtes et véhicules par les VRAIES commandes.
 *
 * Attendus tirés d'ISO 3779 (VIN de 17 caractères, ni I, ni O, ni Q), de 08 BR-LIST-04, de la
 * décision du fondateur DEC-FONDATEUR-22 (« jamais plus lourd que Turo » : un châssis court
 * d'importation japonaise, « modèle-numéro » comme GRJ150-0012345, n'est pas bloqué), d'ADR-113
 * (deux formats, normalisation commune : majuscules, sans espace ni tiret ; refus dédié
 * VEHICLE_VIN_INVALID ; engagements historisés avec la version et le libellé affichés, comme le
 * consentement versionné des CGU d'US-102 / US-126) et du BOARD N-61 (contestation), jamais du
 * code testé.
 *
 * Absence d'effet : chaque refus est comparé à un TÉMOIN qui ne diffère que par la condition
 * éprouvée (même hôte, même véhicule, un seul caractère ou un seul champ de différence).
 */
import { randomBytes, randomInt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { withRole } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const byCountry = COUNTRIES.map((c) => [c.country, c.currency, c] as const);
/** Paramètres des pièces (0078) : tous à false, défaut de DEC-FONDATEUR-22. */
const DOC_PARAMS = [
  'elig_doc_title',
  'elig_doc_plate_vin_photo',
  'elig_doc_inspection',
  'elig_doc_compulsory_insurance',
  'elig_doc_owner_authorization',
  'elig_doc_lender_consent',
] as const;
/** Clés du catalogue des deux engagements (écran /host/vehicles/{id}/documents). */
const OWNER_KEY = 'web.vehicleDocs.declaration.owner';
const LIEN_KEY = 'web.vehicleDocs.declaration.lienOk';

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

/** Hôte : personne ACTIVE, session, compte d'hôte, lieu de remise. */
async function host(client: pg.ClientBase, country: string): Promise<Host> {
  const userId = uuid();
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400,
                                                NULL, $6, $7::jsonb, false) AS ok`,
    [userId, `h124v-${userId}@example.test`, phcArgon2id(), uuid(), randomBytes(32), country, DOCS],
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
  return { userId, hash: t.hash, org, location };
}

const plate = (): string => `V${randomBytes(4).toString('hex').toUpperCase()}`;
/** VIN ISO 3779 de test : 17 caractères tirés de l'alphabet sans I, O ni Q. */
const isoVin = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  return Array.from(randomBytes(17), (b) => alphabet[b % alphabet.length]).join('');
};
/**
 * Numéro de châssis japonais « modèle-numéro de série » (GRJ150-0012345 : code modèle, tiret, sept
 * chiffres) ; série tirée au hasard pour qu'aucun test n'en partage un.
 */
const jpChassis = (): string => `GRJ150-${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
/** Forme normalisée attendue (ADR-113) : majuscules, sans espace ni tiret. */
const normalized = (raw: string): string => raw.toUpperCase().replace(/[ -]/g, '');

async function vehicle(
  client: pg.ClientBase,
  h: Host,
  country: string,
  year: number,
  v: { readonly plate?: string; readonly vin?: string | null } = {},
): Promise<{ outcome: string; id: string }> {
  const variant = (
    await client.query<{ v: string }>('SELECT test_fixture.us124_variant($1) AS v', [country])
  ).rows[0]?.v;
  const { rows } = await client.query<{ outcome: string; vehicle_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, $5, $6, NULL, NULL, $7, NULL,
                                                   'MANUAL', 5::smallint, 'GASOLINE', NULL,
                                                   false, false)`,
    [h.hash, h.org, h.location, v.plate ?? plate(), v.vin ?? null, variant ?? null, year],
  );
  return { outcome: rows[0]?.outcome ?? '', id: rows[0]?.vehicle_id ?? '' };
}

interface Wording {
  readonly locale: string | null;
  readonly version: number | null;
  readonly owner: string | null;
  readonly lienOk: string | null;
}
/** Libellé affiché (donnée de test : la base conserve ce qu'on lui donne, mot pour mot). */
const SHOWN: Wording = {
  locale: 'pt',
  version: 31,
  owner: 'Sou o proprietário do carro ou o proprietário me autoriza a alugá-lo',
  lienOk: 'O carro não está alienado, ou tenho o acordo por escrito do credor',
};

interface Declaration {
  readonly lien?: boolean;
  readonly owner?: boolean;
  readonly lienOk?: boolean;
  readonly vin?: string | null;
  readonly wording?: Wording;
}

/** Commande servie par l'API (13 arguments : libellé affiché compris). */
const declare = async (
  c: pg.ClientBase,
  h: Host,
  vehicleId: string,
  d: Declaration = {},
): Promise<string> => {
  const w = d.wording ?? SHOWN;
  return (
    (
      await c.query<{ outcome: string }>(
        `SELECT * FROM core.catalog_cmd_declare_vehicle($1, $2, $3, 'HOST', $4, 42000, $5, $6, $7,
                                                        $8, $9, $10, $11)`,
        [
          h.hash,
          h.org,
          vehicleId,
          d.lien ?? false,
          d.owner ?? true,
          d.lienOk ?? true,
          d.vin ?? null,
          w.locale,
          w.version,
          w.owner,
          w.lienOk,
        ],
      )
    ).rows[0]?.outcome ?? ''
  );
};

const vinOf = async (c: pg.ClientBase, id: string): Promise<string | null> =>
  (await c.query<{ vin: string | null }>('SELECT vin FROM test_fixture.us124_vehicle($1)', [id]))
    .rows[0]?.vin ?? null;

async function noDocs(c: pg.ClientBase, country: string): Promise<void> {
  for (const key of DOC_PARAMS) {
    await c.query('SELECT test_fixture.us124_param_version($1, $2, $3::jsonb)', [
      key,
      country,
      'false',
    ]);
  }
}

const submit = async (c: pg.ClientBase, h: Host, id: string) =>
  (
    await c.query<{ outcome: string; reasons: string[] }>(
      'SELECT * FROM core.catalog_cmd_submit_vehicle_eligibility($1, $2, $3)',
      [h.hash, h.org, id],
    )
  ).rows[0];

interface Attestation {
  statement: string;
  statement_key: string;
  catalog_version: number | null;
  locale: string | null;
  statement_text: string | null;
  user_id: string;
  country_code: string;
  attested_at: Date;
}
const attestations = async (c: pg.ClientBase, id: string): Promise<Attestation[]> =>
  (await c.query<Attestation>('SELECT * FROM test_fixture.us124_attestations($1)', [id])).rows;

// ---------------------------------------------------------------------------------------------
describe('numéro de châssis : VIN ISO 3779 ou numéro non ISO (ADR-113, DEC-FONDATEUR-22)', () => {
  it.each(byCountry)(
    '%s (%s) : VIN ISO valide accepté (majuscules) ; 17 caractères avec I, O ou Q, trop court ou trop long ⇒ VEHICLE_VIN_INVALID, à la création comme à la déclaration ; témoin d’un seul caractère',
    async (country, _currency, cc: CountryCase) => {
      await withRole('app_api', async (client) => {
        const h = await host(client, country);
        const year = localYear(cc) - 2;
        const good = isoVin();
        const created = await vehicle(client, h, country, year, { vin: good.toLowerCase() });
        expect(created.outcome).toBe('DONE');
        expect(await vinOf(client, created.id)).toBe(good);
        // 17 caractères : lu comme ISO 3779, qui exclut I, O et Q (témoin : même numéro sans eux)
        for (const bad of ['O', 'I', 'Q']) {
          const witness = isoVin();
          const invalid = `${witness.slice(0, 9)}${bad}${witness.slice(10)}`;
          expect((await vehicle(client, h, country, year, { vin: invalid })).outcome).toBe(
            'VEHICLE_VIN_INVALID',
          );
          expect((await vehicle(client, h, country, year, { vin: witness })).outcome).toBe('DONE');
        }
        // longueurs : 4 et 18 caractères refusés, 5 accepté (numéro non ISO le plus court)
        expect((await vehicle(client, h, country, year, { vin: 'AB12' })).outcome).toBe(
          'VEHICLE_VIN_INVALID',
        );
        expect((await vehicle(client, h, country, year, { vin: `${isoVin()}A` })).outcome).toBe(
          'VEHICLE_VIN_INVALID',
        );
        const shortest = randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
        const five = await vehicle(client, h, country, year, { vin: shortest });
        expect(five.outcome).toBe('DONE');
        expect(await vinOf(client, five.id)).toBe(shortest);
        // déclaration d'un véhicule sans numéro : même règle, rien n'est enregistré au refus
        const v = await vehicle(client, h, country, year, { vin: null });
        expect(v.outcome).toBe('DONE');
        const witness = isoVin();
        expect(await declare(client, h, v.id, { vin: `${witness.slice(0, 16)}O` })).toBe(
          'VEHICLE_VIN_INVALID',
        );
        expect(await vinOf(client, v.id)).toBeNull();
        expect(await declare(client, h, v.id, { vin: witness })).toBe('DONE');
        expect(await vinOf(client, v.id)).toBe(witness);
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : châssis japonais court (GRJ150-0012345) accepté à la création et à la déclaration, normalisé sans tiret ; véhicule récent ELIGIBLE sans pièce',
    async (country, _currency, cc: CountryCase) => {
      await withRole('app_api', async (client) => {
        await noDocs(client, country);
        const h = await host(client, country);
        const year = localYear(cc) - 2;
        const raw = jpChassis();
        const created = await vehicle(client, h, country, year, { vin: raw });
        expect(created.outcome).toBe('DONE');
        expect(await vinOf(client, created.id)).toBe(normalized(raw));
        expect(await declare(client, h, created.id)).toBe('DONE');
        expect((await submit(client, h, created.id))?.outcome).toBe('ELIGIBLE');
        // saisi à la déclaration (minuscules, espace au lieu du tiret)
        const later = await vehicle(client, h, country, year, { vin: null });
        expect(later.outcome).toBe('DONE');
        const other = jpChassis().toLowerCase().replace('-', ' ');
        expect(await declare(client, h, later.id, { vin: other })).toBe('DONE');
        expect(await vinOf(client, later.id)).toBe(normalized(other));
        expect((await submit(client, h, later.id))?.outcome).toBe('ELIGIBLE');
        // sans numéro : jamais éligible, quelle que soit l'année (aucune constante 1981)
        const none = await vehicle(client, h, country, year, { vin: null });
        expect(await declare(client, h, none.id)).toBe('DONE');
        expect((await submit(client, h, none.id))?.reasons).toEqual(['VEHICLE_FIELD_REQUIRED']);
        // caractère hors format (point) : refus dédié ; témoin sans le point accepté
        const dotted = jpChassis();
        expect((await vehicle(client, h, country, year, { vin: `${dotted}.` })).outcome).toBe(
          'VEHICLE_VIN_INVALID',
        );
        expect((await vehicle(client, h, country, year, { vin: dotted })).outcome).toBe('DONE');
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : doublon détecté malgré la casse, les espaces ou les tirets, pour un VIN ISO comme pour un châssis court ; la contestation N-61 retrouve le véhicule en cause',
    async (country, _currency, cc: CountryCase) => {
      await withRole('app_api', async (client) => {
        const a = await host(client, country);
        const b = await host(client, country);
        const year = localYear(cc) - 2;
        const chassis = jpChassis();
        const iso = isoVin();
        expect((await vehicle(client, a, country, year, { vin: chassis })).outcome).toBe('DONE');
        expect((await vehicle(client, a, country, year, { vin: iso })).outcome).toBe('DONE');
        const variants = [
          chassis.toLowerCase(),
          chassis.replace('-', ' '),
          chassis.replace('-', ''),
          ` ${chassis.toLowerCase().replace('-', ' - ')} `,
          `${iso.slice(0, 8)} ${iso.slice(8)}`.toLowerCase(),
          `${iso.slice(0, 3)}-${iso.slice(3)}`,
        ];
        for (const dup of variants) {
          expect((await vehicle(client, b, country, year, { vin: dup })).outcome).toBe(
            'VEHICLE_PLATE_DUPLICATE',
          );
        }
        // même règle à la déclaration d'un véhicule sans numéro ; témoin : un autre châssis
        const bv = await vehicle(client, b, country, year, { vin: null });
        expect(await declare(client, b, bv.id, { vin: chassis.toLowerCase() })).toBe(
          'VEHICLE_PLATE_DUPLICATE',
        );
        expect(await vinOf(client, bv.id)).toBeNull();
        // contestation : le châssis saisi autrement désigne le véhicule de A
        const permitted = async (vn: string) =>
          (
            await client.query<{ outcome: string }>(
              'SELECT * FROM core.catalog_vehicle_claim_permitted($1, $2, $3, $4)',
              [b.hash, b.org, plate(), vn],
            )
          ).rows[0]?.outcome;
        expect(await permitted(chassis.toLowerCase().replace('-', ' '))).toBe('OK');
        expect(await permitted(iso.toLowerCase())).toBe('OK');
        expect(await permitted(jpChassis())).toBe('CLAIM_NOT_NEEDED');
        expect(await declare(client, b, bv.id, { vin: jpChassis() })).toBe('DONE');
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('engagements de l’hôte : historique ajout seul, version et libellé affichés (ADR-113)', () => {
  it.each(byCountry)(
    '%s (%s) : chaque déclaration AJOUTE ses engagements (clé, version du catalogue, langue, libellé exact, auteur, pays) ; rien n’est réécrit ; ancienne signature : engagement sans libellé',
    async (country, _currency, cc: CountryCase) => {
      await withRole('app_api', async (client) => {
        const h = await host(client, country);
        const v = await vehicle(client, h, country, localYear(cc) - 2, { vin: isoVin() });
        expect(v.outcome).toBe('DONE');
        // 1. propriétaire + véhicule financé avec accord du créancier, libellé pt v31
        expect(await declare(client, h, v.id, { lien: true })).toBe('DONE');
        // 2. nouveau libellé (es, version 32) ; véhicule plus financé : seul l'engagement de
        //    propriété est pris
        const es: Wording = {
          locale: 'es',
          version: 32,
          owner: 'Soy el propietario del auto o el propietario me autoriza a alquilarlo',
          lienOk: 'El auto no está prendado, o tengo el acuerdo escrito del acreedor',
        };
        expect(await declare(client, h, v.id, { lien: false, wording: es })).toBe('DONE');
        // 3. financé mais accord NON coché : aucun engagement du créancier ajouté
        expect(await declare(client, h, v.id, { lien: true, lienOk: false })).toBe('DONE');
        // 4. ancienne signature (version N de l'API) : engagement historisé, libellé inconnu
        const legacy = await client.query<{ outcome: string }>(
          `SELECT * FROM core.catalog_cmd_declare_vehicle($1, $2, $3, 'HOST', false, 42000, true,
                                                          false, NULL)`,
          [h.hash, h.org, v.id],
        );
        expect(legacy.rows[0]?.outcome).toBe('DONE');
        const rows = await attestations(client, v.id);
        const view = rows.map((r) => [
          r.statement,
          r.statement_key,
          r.catalog_version,
          r.locale,
          r.statement_text,
        ]);
        expect(view).toEqual([
          ['LIEN', LIEN_KEY, 31, 'pt', SHOWN.lienOk],
          ['OWNERSHIP', OWNER_KEY, 31, 'pt', SHOWN.owner],
          ['OWNERSHIP', OWNER_KEY, 32, 'es', es.owner],
          ['OWNERSHIP', OWNER_KEY, 31, 'pt', SHOWN.owner],
          ['OWNERSHIP', OWNER_KEY, null, null, null],
        ]);
        for (const r of rows) {
          expect(r.user_id).toBe(h.userId);
          expect(r.country_code).toBe(country);
        }
        // horodatage de la base, croissant d'une déclaration à l'autre, jamais réécrit
        const times = rows.map((r) => r.attested_at.getTime());
        expect(times[0]).toBe(times[1]);
        expect(times[2]).toBeGreaterThan(times[1] ?? 0);
        expect(times[3]).toBeGreaterThan(times[2] ?? 0);
        expect(times[4]).toBeGreaterThan(times[3] ?? 0);
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : libellé mal formé (langue hors catalogue, version 0, texte vide ou absent) ⇒ VEHICLE_FIELD_REQUIRED, rien n’est écrit ; modification et suppression refusées (23000) ; app_api ne lit pas la table (42501)',
    async (country, _currency, cc: CountryCase) => {
      await withRole('app_api', async (client) => {
        const h = await host(client, country);
        const v = await vehicle(client, h, country, localYear(cc) - 2, { vin: isoVin() });
        const bad: Wording[] = [
          { ...SHOWN, locale: 'de' },
          { ...SHOWN, locale: null },
          { ...SHOWN, version: 0 },
          { ...SHOWN, version: null },
          { ...SHOWN, owner: '   ' },
          { ...SHOWN, lienOk: null },
          { ...SHOWN, owner: 'x'.repeat(501) },
        ];
        for (const wording of bad) {
          expect(await declare(client, h, v.id, { wording })).toBe('VEHICLE_FIELD_REQUIRED');
        }
        expect(await attestations(client, v.id)).toEqual([]);
        // témoin : le libellé bien formé passe (500 caractères admis)
        expect(
          await declare(client, h, v.id, { wording: { ...SHOWN, owner: 'x'.repeat(500) } }),
        ).toBe('DONE');
        expect(await attestations(client, v.id)).toHaveLength(1);
        for (const kind of ['UPDATE', 'DELETE']) {
          const r = await client.query<{ s: string }>(
            'SELECT test_fixture.us124_attestation_tamper($1, $2) AS s',
            [v.id, kind],
          );
          expect(r.rows[0]?.s).toBe('23000');
        }
        expect(await attestations(client, v.id)).toHaveLength(1);
        await expect(
          client.query('SELECT 1 FROM core.catalog_vehicle_attestation LIMIT 1'),
        ).rejects.toMatchObject({ code: '42501' });
        // l'aide interne commune n'est pas exécutable par app_api
        await expect(
          client.query(
            `SELECT * FROM core.catalog_vehicle_declare($1, $2, $3, 'HOST', false, 1, true, false,
                                                        NULL, 'es', 1, 'a', 'b')`,
            [h.hash, h.org, v.id],
          ),
        ).rejects.toMatchObject({ code: '42501' });
      });
    },
  );

  it('socle : RLS ENABLE + FORCE, propriétaire migrator, aucun droit applicatif sur la table', async () => {
    await withRole('app_api', async (client) => {
      const r = await client.query<{ rls: boolean; force: boolean; owner: string }>(
        `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                pg_catalog.pg_get_userbyid(c.relowner) AS owner
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relname = 'catalog_vehicle_attestation'`,
      );
      expect(r.rows).toEqual([{ rls: true, force: true, owner: 'migrator' }]);
      const g = await client.query<{ role: string; any: boolean }>(
        `SELECT r AS role,
                pg_catalog.has_table_privilege(r, 'core.catalog_vehicle_attestation',
                                               'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') AS any
           FROM pg_catalog.unnest(ARRAY['app_api', 'app_worker', 'app_anon']) AS r
          ORDER BY r`,
      );
      expect(g.rows).toEqual([
        { role: 'app_anon', any: false },
        { role: 'app_api', any: false },
        { role: 'app_worker', any: false },
      ]);
    });
  });
});
