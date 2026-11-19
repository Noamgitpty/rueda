/**
 * Preuves du devis figé et des versions de prix du trip (US-202, migration 0100 ; fixtures 9993)
 * sous les rôles de production (assertion L0-05 en tête de chaque connexion, withRole), en USD
 * (PA) et en PYG sans décimale (PY). Personnes, sessions et rattachements par les VRAIES commandes ;
 * l'annonce LISTED vient de la fixture 9993.
 *
 * Attendus : jamais le code testé. Ils viennent des oracles Python (`docs/specs/tools/`,
 * `golden_vectors.json`) et de 08 / 16 :
 * - PA : trip A de 08 sans protection ni assistance (lignes de T01) : taxe par ligne 840 + 126 = 966
 *   (T01), jambe HOST 13 125 (TJ01 : 9 000 + 3 000 + 1 125, sans part de la protection) ;
 * - PY : trip D2 de 08 sans protection (lignes de T40) : 333 334 × 3 = 1 000 002 ; depuis US-704
 *   (migration 0102, moteur prc.quote/2) le trip fee est CALCULÉ par le barème du pays (08
 *   BR-PRICE-06, 15 % sur 3 j : roundHalfUp(150 000,3) = 150 000, le F de J et NP de 08 E7) et non
 *   plus le F 125 500 donné de D2 ; taxe par ligne 100 000 (T40) + 15 000 (taxe de F de J, 08 E7) ;
 *   jambe HOST 787 501 inchangée (TJ09a : allocHost(1 000 002 ; 3/4) = 750 001 + 37 500 : F
 *   n'entre jamais dans HOST) ;
 * - PA : F = 1 800 du trip A est aussi celui du barème du pays (15 % de 12 000) ;
 * - totaux = Σ lignes + Σ taxes (08 BR-PRICE-13), PLATFORM = complément (08 E7) ;
 * - jours facturables TA07 (16 A.8.1, `grace_minutes` = 29) : 3 j 29 min ⇒ 3, 3 j 30 min ⇒ 4 ;
 * - critère 5 (19 US-202) : groupe third_party ⇒ jambe TAX_THIRD_PARTY = taxe du groupe ;
 * - L2-PM-03 : un montant, une taxe, un prix ou des jours modifiés ⇒ QUOTE_MISMATCH, rien d'écrit ;
 * - US-222d (F-L2-ARG-01, migration 0155) : les lignes non taxées de T01 / T40 (Extras, conducteur
 *   additionnel, livraison) n'ont aucune source en base en bêta : portées par la demande, elles sont
 *   refusées au gel (QUOTE_MISMATCH, rien de figé), même cohérentes avec la jambe HOST de TJ01 /
 *   TJ09a ; le devis figé ne porte donc que le prix du trip et le trip fee : jambe HOST = part du
 *   loyer seule (PA : 9 000 = 3/4 × 12 000, TJ01 sans livraison ni Extras ; PY : 750 001 =
 *   allocHost(1 000 002 ; 3/4), TJ09a sans la part de livraison 37 500).
 */
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { translateDbError } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const NOW = '2026-12-01T12:00:00.000Z';
const START = Date.parse('2026-12-10T10:00:00.000Z');
const DAY = 86_400_000;
const MIN = 60_000;

interface Vector {
  readonly daily: number;
  /** Trip fee attendu sur 3 jours (calculé par la base, jamais fourni : US-704). */
  readonly fee: number;
  /** Lignes autres que le prix du trip et le trip fee (unités mineures). */
  readonly lines: Readonly<Record<string, number>>;
  readonly taxes: Readonly<Record<string, number>>;
  /** Jambe HOST avec les lignes de T01 / T40 (TJ01 / TJ09a) : devis refusé depuis US-222d. */
  readonly host: number;
  /** Jambe HOST du devis sans ces lignes (part du loyer seule : TJ01, TJ09a). */
  readonly hostRent: number;
}

// Vecteurs (voir l'en-tête) : prix journalier, lignes et taxes de T01 / T40, jambe HOST de TJ01 / TJ09a.
const VECTORS: Readonly<Record<string, Vector>> = {
  PA: {
    daily: 4_000,
    fee: 1_800,
    lines: { EXTRAS: 1_500, ADDITIONAL_DRIVER_FEE: 1_500, DELIVERY_FEE: 4_000 },
    taxes: { TRIP_PRICE: 840, TRIP_FEE: 126 },
    host: 13_125,
    hostRent: 9_000,
  },
  PY: {
    daily: 333_334,
    fee: 150_000,
    lines: { DELIVERY_FEE: 50_000 },
    taxes: { TRIP_PRICE: 100_000, TRIP_FEE: 15_000 },
    host: 787_501,
    hostRent: 750_001,
  },
};
const ORDER = [
  'TRIP_PRICE',
  'PROMO_PLATFORM',
  'PROMO_HOST',
  'TRIP_FEE',
  'PROTECTION',
  'EXTRAS',
  'ENHANCED_ROADSIDE',
  'ADDITIONAL_DRIVER_FEE',
  'YOUNG_DRIVER_FEE',
  'DELIVERY_FEE',
];

const sha = (prefix: string, text: string): string =>
  createHash('sha256')
    .update(prefix + text, 'utf8')
    .digest('hex');

interface Docs {
  inputs: string;
  inputsHash: string;
  outputs: string;
  outputsHash: string;
}

interface Build {
  readonly days?: number;
  readonly endAtMs?: number;
  readonly lines?: Readonly<Record<string, number>>;
  readonly daily?: number;
  readonly thirdParty?: boolean;
  /** Retouche des sorties avant empreinte (montant falsifié). */
  readonly tamper?: (o: Record<string, unknown>) => void;
}

/** Documents canoniques d'un devis (forme de frozen.ts), sorties tirées des vecteurs. */
function docs(c: CountryCase, groups: ReadonlyMap<string, string>, b: Build = {}): Docs {
  const v = VECTORS[c.country]!;
  const days = b.days ?? 3;
  const daily = b.daily ?? v.daily;
  // US-222d : par défaut, aucune ligne de la demande (la route HTTP n'en envoie aucune)
  const extra = b.lines ?? {};
  const host = Object.keys(extra).length === 0 ? v.hostRent : v.host;
  const amounts: Record<string, number> = { ...extra, TRIP_PRICE: v.daily * days, TRIP_FEE: v.fee };
  const lines = ORDER.filter((t) => (amounts[t] ?? 0) !== 0).map((t) => ({
    type: t,
    amount: String(amounts[t]),
    taxGroup: groups.get(t) ?? null,
    tax: String(v.taxes[t] ?? 0),
  }));
  const subtotal = Object.values(amounts).reduce((a, x) => a + x, 0);
  const tax = Object.values(v.taxes).reduce((a, x) => a + x, 0);
  const total = subtotal + tax;
  const third = b.thirdParty ? tax : 0;
  const outputs: Record<string, unknown> = {
    engineVersion: 'prc.quote/2',
    currency: c.currency,
    billableDays: days,
    lines,
    taxGroups: [],
    subtotal: String(subtotal),
    taxTotal: String(tax),
    taxThirdParty: String(third),
    total: String(total),
    legs: {
      HOST: String(host),
      INSURER: '0',
      TAX_THIRD_PARTY: String(third),
      PLATFORM: String(total - host - third),
    },
    hostSharePct: '3/4',
  };
  b.tamper?.(outputs);
  const inputs = JSON.stringify({
    request: {
      startAtMs: START,
      endAtMs: b.endAtMs ?? START + 3 * DAY,
      quotedAtMs: Date.parse(NOW),
      rateType: 'REFUNDABLE',
      dailyRate: String(daily),
      lines: Object.fromEntries(Object.entries(extra).map(([k, x]) => [k, String(x)])),
    },
    params: { currency: { code: c.currency } },
  });
  const out = JSON.stringify(outputs);
  return {
    inputs,
    inputsHash: sha('rueda.quote.inputs/1\n', inputs),
    outputs: out,
    outputsHash: sha('rueda.quote.outputs/1\n', out),
  };
}

async function person(
  client: pg.ClientBase,
  country: string,
): Promise<{ id: string; hash: Buffer }> {
  const id = uuid();
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400, NULL,
                                                $6, $7::jsonb, false) AS ok`,
    [id, `guest-${id}@example.test`, phcArgon2id(), uuid(), randomBytes(32), country, DOCS],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await client.query('SELECT test_fixture.iam_set_account_status($1, $2)', [id, 'ACTIVE']);
  const t = newToken();
  const s = await client.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [uuid(), id, t.hash, SESSION_TTL_S],
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  return { id, hash: t.hash };
}

interface Listing {
  readonly listing_id: string;
  readonly vehicle_id: string;
  readonly org_id: string;
}

async function listing(client: pg.ClientBase, c: CountryCase, daily?: number): Promise<Listing> {
  const { rows } = await client.query<Listing>(
    'SELECT * FROM test_fixture.us202_listed_listing($1, $2)',
    [c.country, daily ?? VECTORS[c.country]!.daily],
  );
  if (!rows[0]) throw new Error('annonce de fixture');
  return rows[0];
}

/** Groupe fiscal de chaque type de ligne taxable, en vigueur (lecture app_api de 0008). */
async function taxGroups(client: pg.ClientBase, c: CountryCase): Promise<Map<string, string>> {
  const { rows } = await client.query<{ line_type: string; rate_group: string | null }>(
    `SELECT DISTINCT ON (line_type) line_type, rate_group FROM core.pricing_tax_line_config
      WHERE country_code = $1 ORDER BY line_type, version DESC`,
    [c.country],
  );
  return new Map(
    rows.filter((r) => r.rate_group !== null).map((r) => [r.line_type, r.rate_group!]),
  );
}

async function freeze(
  client: pg.ClientBase,
  hash: Buffer | null,
  listingId: string,
  d: Docs,
): Promise<{ outcome: string; quote_id: string | null }> {
  const { rows } = await client.query<{ outcome: string; quote_id: string | null }>(
    'SELECT * FROM core.pricing_cmd_freeze_quote($1, $2, $3, $4, $5, $6)',
    [hash ?? randomBytes(32), listingId, d.inputs, d.inputsHash, d.outputs, d.outputsHash],
  );
  return rows[0]!;
}

function scenario(c: CountryCase) {
  return async (
    fn: (
      tx: pg.ClientBase,
      ctx: { guest: { id: string; hash: Buffer }; l: Listing; groups: Map<string, string> },
    ) => Promise<void>,
  ) => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, { virtualNow: NOW }, async (tx) => {
        const guest = await person(tx, c.country);
        const l = await listing(tx, c);
        const groups = await taxGroups(tx, c);
        await fn(tx, { guest, l, groups });
      });
    });
  };
}

describe.each(COUNTRIES.map((c) => [c.country, c] as const))(
  'US-202 devis figé (%s)',
  (_name, c) => {
    const run = scenario(c);

    it('critères 1 et 2 : la base rejoue le devis (taxe par ligne, total, jambes) et le fige', async () => {
      await run(async (tx, { guest, l, groups }) => {
        const r = await freeze(tx, guest.hash, l.listing_id, docs(c, groups));
        expect(r.outcome).toBe('DONE');
        const v = VECTORS[c.country]!;
        const tax = Object.values(v.taxes).reduce((a, x) => a + x, 0);
        const subtotal = v.daily * 3 + v.fee;
        const q = (await tx.query('SELECT * FROM test_fixture.us202_quote_row($1)', [r.quote_id]))
          .rows[0] as Record<string, unknown>;
        expect(q['status']).toBe('FROZEN');
        expect(q['guest_user_id']).toBe(guest.id);
        expect(q['currency']).toBe(c.currency);
        expect(q['billable_days']).toBe(3);
        expect(String(q['tax_total_minor'])).toBe(String(tax));
        expect(String(q['total_minor'])).toBe(String(subtotal + tax));
        expect(String(q['leg_host_minor'])).toBe(String(v.hostRent));
        expect(String(q['leg_insurer_minor'])).toBe('0');
        expect(String(q['leg_tax_third_party_minor'])).toBe('0');
        expect(String(q['leg_platform_minor'])).toBe(String(subtotal + tax - v.hostRent));
        const lines = (
          await tx.query('SELECT * FROM test_fixture.us202_quote_lines($1)', [r.quote_id])
        ).rows as Record<string, unknown>[];
        expect(lines.map((x) => [x['line_type'], String(x['tax_minor'])])).toEqual(
          ORDER.filter((t) => t === 'TRIP_PRICE' || t === 'TRIP_FEE').map((t) => [
            t,
            String(v.taxes[t] ?? 0),
          ]),
        );
        expect(lines.every((x) => x['third_party'] === false)).toBe(true);
      });
    });

    it('US-222d (F-L2-ARG-01) : lignes sans source en base portées par la demande (Extras, conducteur additionnel, livraison de T01 / T40) ⇒ QUOTE_MISMATCH, rien de figé ; sans elles ⇒ figé', async () => {
      await run(async (tx, { guest, l, groups }) => {
        const v = VECTORS[c.country]!;
        // documents cohérents (sorties de TJ01 / TJ09a avec ces lignes, figés avant US-222d) :
        // seule la source en base manque
        const all = await freeze(tx, guest.hash, l.listing_id, docs(c, groups, { lines: v.lines }));
        expect(all).toEqual({ outcome: 'QUOTE_MISMATCH', quote_id: null });
        for (const line of Object.keys(v.lines)) {
          const one = docs(c, groups, { lines: { [line]: v.lines[line]! } });
          expect(await freeze(tx, guest.hash, l.listing_id, one), line).toEqual({
            outcome: 'QUOTE_MISMATCH',
            quote_id: null,
          });
        }
        // le devis sans ces lignes est figé (chemin de la route HTTP)
        expect((await freeze(tx, guest.hash, l.listing_id, docs(c, groups))).outcome).toBe('DONE');
      });
    });

    it('L2-PM-03 : total, taxe, jambe, prix journalier ou prix du trip falsifiés ⇒ QUOTE_MISMATCH', async () => {
      await run(async (tx, { guest, l, groups }) => {
        const cases: Docs[] = [
          docs(c, groups, { tamper: (o) => (o['total'] = String(Number(o['total']) - 1)) }),
          docs(c, groups, {
            tamper: (o) => {
              const legs = o['legs'] as Record<string, string>;
              legs['HOST'] = String(Number(legs['HOST']) + 1);
              legs['PLATFORM'] = String(Number(legs['PLATFORM']) - 1);
            },
          }),
          docs(c, groups, {
            tamper: (o) => {
              // taxe sur la base agrégée au lieu de chaque ligne : une unité de plus
              const lines = o['lines'] as Record<string, string>[];
              lines[0]!['tax'] = String(Number(lines[0]!['tax']) + 1);
              o['taxTotal'] = String(Number(o['taxTotal']) + 1);
              o['total'] = String(Number(o['total']) + 1);
              const legs = o['legs'] as Record<string, string>;
              legs['PLATFORM'] = String(Number(legs['PLATFORM']) + 1);
            },
          }),
          docs(c, groups, { daily: VECTORS[c.country]!.daily - 1 }),
          docs(c, groups, { lines: { ...VECTORS[c.country]!.lines, TRIP_PRICE: 1 } }),
        ];
        for (const d of cases) {
          expect((await freeze(tx, guest.hash, l.listing_id, d)).outcome).toBe('QUOTE_MISMATCH');
        }
        const good = docs(c, groups);
        expect(
          (await freeze(tx, guest.hash, l.listing_id, { ...good, outputsHash: '0'.repeat(64) }))
            .outcome,
        ).toBe('QUOTE_MISMATCH');
        expect(
          (await freeze(tx, guest.hash, l.listing_id, { ...good, inputs: good.inputs + ' ' }))
            .outcome,
        ).toBe('QUOTE_MISMATCH');
      });
    });

    it('critère 3 (TA07) : 3 j 29 min ⇒ 3 jours ; 3 j 30 min annoncés à 3 jours ⇒ QUOTE_MISMATCH', async () => {
      await run(async (tx, { guest, l, groups }) => {
        const ok = docs(c, groups, { endAtMs: START + 3 * DAY + 29 * MIN });
        expect((await freeze(tx, guest.hash, l.listing_id, ok)).outcome).toBe('DONE');
        const late = docs(c, groups, { endAtMs: START + 3 * DAY + 30 * MIN });
        expect((await freeze(tx, guest.hash, l.listing_id, late)).outcome).toBe('QUOTE_MISMATCH');
      });
    });

    it('fail-closed : durée > max_trip_days, protection sans part d’assureur ⇒ QUOTE_UNAVAILABLE', async () => {
      await run(async (tx, { guest, l, groups }) => {
        const long = docs(c, groups, { endAtMs: START + 31 * DAY, days: 31 });
        expect((await freeze(tx, guest.hash, l.listing_id, long)).outcome).toBe(
          'QUOTE_UNAVAILABLE',
        );
        const prot = docs(c, groups, {
          lines: { ...VECTORS[c.country]!.lines, PROTECTION: 3 * VECTORS[c.country]!.daily },
        });
        expect((await freeze(tx, guest.hash, l.listing_id, prot)).outcome).toBe(
          'QUOTE_UNAVAILABLE',
        );
      });
    });

    it('session absente ⇒ AUTH_REQUIRED ; annonce non publiée ⇒ LISTING_NOT_FOUND', async () => {
      await run(async (tx, { guest, l, groups }) => {
        expect((await freeze(tx, null, l.listing_id, docs(c, groups))).outcome).toBe(
          'AUTH_REQUIRED',
        );
        await tx.query('SELECT test_fixture.us115_set_listing_status($1, $2)', [
          l.listing_id,
          'UNLISTED',
        ]);
        expect((await freeze(tx, guest.hash, l.listing_id, docs(c, groups))).outcome).toBe(
          'LISTING_NOT_FOUND',
        );
      });
    });

    it('critère 5 : groupe third_party ⇒ jambe TAX_THIRD_PARTY = taxe du groupe ; par défaut 0', async () => {
      await run(async (tx, { guest, l, groups }) => {
        await tx.query('SELECT test_fixture.us202_third_party_taxes($1)', [c.country]);
        expect((await freeze(tx, guest.hash, l.listing_id, docs(c, groups))).outcome).toBe(
          'QUOTE_MISMATCH',
        );
        const r = await freeze(tx, guest.hash, l.listing_id, docs(c, groups, { thirdParty: true }));
        expect(r.outcome).toBe('DONE');
        const tax = Object.values(VECTORS[c.country]!.taxes).reduce((a, x) => a + x, 0);
        const q = (await tx.query('SELECT * FROM test_fixture.us202_quote_row($1)', [r.quote_id]))
          .rows[0] as Record<string, unknown>;
        expect(String(q['leg_tax_third_party_minor'])).toBe(String(tax));
        expect(String(q['leg_host_minor'])).toBe(String(VECTORS[c.country]!.hostRent));
      });
    });

    it('versions de prix du trip : v1, puis v2 et devis précédent SUPERSEDED ; IDOR et réemploi refusés', async () => {
      await run(async (tx, { guest, l, groups }) => {
        const tripId = uuid();
        await tx.query('SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
          tripId,
          guest.id,
          l.org_id,
          l.vehicle_id,
          c.country,
          c.currency,
          c.timezone,
          new Date(START).toISOString(),
          new Date(START + 3 * DAY).toISOString(),
        ]);
        const a = await freeze(tx, guest.hash, l.listing_id, docs(c, groups));
        const b = await freeze(tx, guest.hash, l.listing_id, docs(c, groups));
        const version = async (hash: Buffer, trip: string, quote: string | null) =>
          (
            await tx.query<{ outcome: string; version: number | null }>(
              'SELECT * FROM core.pricing_cmd_version_trip_price($1, $2, $3)',
              [hash, trip, quote],
            )
          ).rows[0]!;
        expect(await version(guest.hash, tripId, a.quote_id)).toEqual({
          outcome: 'DONE',
          version: 1,
        });
        expect((await version(guest.hash, tripId, a.quote_id)).outcome).toBe('QUOTE_MISMATCH');
        expect(await version(guest.hash, tripId, b.quote_id)).toEqual({
          outcome: 'DONE',
          version: 2,
        });
        const qa = (await tx.query('SELECT * FROM test_fixture.us202_quote_row($1)', [a.quote_id]))
          .rows[0] as Record<string, unknown>;
        expect(qa['status']).toBe('SUPERSEDED');
        expect(qa['superseded_at']).not.toBeNull();

        const other = await person(tx, c.country);
        const c3 = await freeze(tx, other.hash, l.listing_id, docs(c, groups));
        expect((await version(other.hash, tripId, c3.quote_id)).outcome).toBe('TRIP_NOT_FOUND');
        const d = await freeze(tx, guest.hash, l.listing_id, docs(c, groups));
        expect((await version(guest.hash, tripId, c3.quote_id)).outcome).toBe('QUOTE_NOT_FOUND');
        expect((await version(guest.hash, uuid(), d.quote_id)).outcome).toBe('TRIP_NOT_FOUND');
      });
    });

    it('registres immuables : montant, ligne, suppression, TRUNCATE ⇒ IMMUTABLE_RECORD (migrator compris)', async () => {
      await run(async (tx, { guest, l, groups }) => {
        const r = await freeze(tx, guest.hash, l.listing_id, docs(c, groups));
        for (const kind of ['amount', 'line', 'delete', 'truncate']) {
          await tx.query('SAVEPOINT w');
          const { rows } = await tx.query<{ r: string }>(
            'SELECT test_fixture.us202_try_write($1, $2) AS r',
            [r.quote_id, kind],
          );
          await tx.query('RELEASE SAVEPOINT w');
          expect(rows[0]?.r).toBe('23000:pricing_record_immutable');
        }
        const e = { code: '23000', constraint: 'pricing_record_immutable' };
        expect(translateDbError(e)?.code).toBe('IMMUTABLE_RECORD');
      });
    });
  },
);

describe('US-202 : aucun droit direct des rôles applicatifs (écriture par commandes seulement)', () => {
  it.each(['app_api', 'app_worker', 'app_anon'] as const)(
    '%s : lecture et écriture des trois tables refusées (42501) ; commandes réservées à app_api',
    async (role) => {
      await withRole(role, async (client) => {
        for (const sql of [
          'SELECT 1 FROM core.pricing_quote LIMIT 1',
          'SELECT 1 FROM core.pricing_quote_line LIMIT 1',
          'SELECT 1 FROM core.pricing_trip_price_version LIMIT 1',
          `INSERT INTO core.pricing_trip_price_version (trip_id, version, quote_id)
           VALUES (gen_random_uuid(), 1, gen_random_uuid())`,
        ]) {
          await expect(client.query(sql)).rejects.toMatchObject({ code: '42501' });
        }
        if (role !== 'app_api') {
          await expect(
            client.query(
              "SELECT * FROM core.pricing_cmd_freeze_quote('\\x00'::bytea, gen_random_uuid(), '', '', '', '')",
            ),
          ).rejects.toMatchObject({ code: '42501' });
        }
      });
    },
  );

  it('RLS ENABLE + FORCE, propriétaire migrator, commandes SECURITY DEFINER de cmd_money_owner', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{
        relname: string;
        rls: boolean;
        force: boolean;
        owner: string;
      }>(
        `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                pg_catalog.pg_get_userbyid(c.relowner) AS owner
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relname LIKE 'pricing\\_%' AND c.relkind = 'r'
          ORDER BY 1`,
      );
      expect(rows.filter((r) => r.relname !== 'pricing_tax_line_config')).toEqual(
        ['pricing_quote', 'pricing_quote_line', 'pricing_trip_price_version'].map((relname) => ({
          relname,
          rls: true,
          force: true,
          owner: 'migrator',
        })),
      );
      const fns = await client.query<{ proname: string; secdef: boolean; owner: string }>(
        `SELECT p.proname, p.prosecdef AS secdef, pg_catalog.pg_get_userbyid(p.proowner) AS owner
           FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'core' AND p.proname LIKE 'pricing\\_cmd\\_%' ORDER BY 1`,
      );
      expect(fns.rows).toEqual([
        { proname: 'pricing_cmd_freeze_quote', secdef: true, owner: 'cmd_money_owner' },
        { proname: 'pricing_cmd_version_trip_price', secdef: true, owner: 'cmd_money_owner' },
      ]);
    });
  });
});
