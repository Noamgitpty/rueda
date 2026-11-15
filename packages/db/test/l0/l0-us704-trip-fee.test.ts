/**
 * Preuves du trip fee recalculé par la base dans le devis figé (US-704, migration 0102 ; fixtures
 * 9989 et 9993) sous les rôles de production (assertion L0-05 en tête de chaque connexion,
 * withRole), en USD (PA) et en PYG sans décimale (PY). Personnes et sessions par les VRAIES
 * commandes ; l'annonce LISTED vient de la fixture 9993.
 *
 * Suivi des revues d'US-202 : la commande `core.pricing_cmd_freeze_quote` ne rejouait que
 * TRIP_PRICE et prenait TRIP_FEE tel quel de l'API. Elle le recalcule désormais avec le barème
 * `trip_fee_schedule` du pays EN VIGUEUR en base et refuse tout écart (QUOTE_MISMATCH).
 *
 * Attendus : jamais le code testé. Ils viennent de 08, de 16 et des oracles
 * (`docs/specs/tools/golden_vectors.json`) :
 * - barème du dépôt (08 BR-PRICE-06, recommandation [NOUS] appliquée telle quelle, Q-004) :
 *   15 % (≤ 6 j), 12 % (7–29 j), 8 % (≥ 30 j), minimum 5 USD / 35 000 PYG ;
 * - PA, trip A (3 j, P 120,00) : F 18,00 (19 US-704, TJ01), taxe 8,40 + 1,26 (T01), HOST 90,00
 *   (TJ01 : allocHost(120,00 ; 3/4), jamais le trip fee) ;
 * - PA, minimum : 1 j, P 20,00, 15 % = 3,00 < 5,00 ⇒ F 5,00 (minimum de BR-PRICE-06, comme K2 de
 *   08 E7) ; ITBMS 7 % par ligne : 1,40 + 0,35 (taxe de F de K2) ; HOST 15,00 ;
 * - PA, 7 j : P 280,00 ⇒ F 12 % = 33,60 ; taxe 19,60 + roundHalfUp(2,352) = 2,35 ; HOST 210,00 ;
 * - PY, trip D2 (3 j, P 1 000 002 de T40) : F 15 % = roundHalfUp(150 000,3) = 150 000 (le F de J
 *   et NP de 08 E7), taxe 100 000 (T40) + 15 000 (taxe de F de J) ; HOST 750 001 (TJ09a :
 *   allocHost(1 000 002 ; 3/4)) ;
 * - PY, minimum (16 PRC-012 : « trip PYG de 3 jours dont 15 % donnent moins de 35 000 ⇒
 *   F = 35 000 ») : P 150 000, 15 % = 22 500 ⇒ F 35 000 ; IVA 10 % : 15 000 + 3 500 ;
 *   HOST 112 500 ;
 * - PY, 7 j : P 700 000 ⇒ F 12 % = 84 000 ; IVA 70 000 + 8 400 ; HOST 525 000 ;
 * - totaux = Σ lignes + Σ taxes (08 BR-PRICE-13) ; PLATFORM = complément (08 E7) : F et sa taxe
 *   y vont entièrement (BR-PRICE-06).
 */
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const NOW = '2026-12-01T12:00:00.000Z';
const START = Date.parse('2026-12-10T10:00:00.000Z');
const DAY = 86_400_000;

interface Vector {
  readonly daily: number;
  readonly days: number;
  /** Trip fee attendu (barème du pays). */
  readonly fee: number;
  /** Taxe par ligne attendue : prix du trip, trip fee. */
  readonly taxP: number;
  readonly taxF: number;
  readonly host: number;
}

type Kind = 'ref' | 'min' | 'week';

// Vecteurs (voir l'en-tête).
const VECTORS: Readonly<Record<string, Readonly<Record<Kind, Vector>>>> = {
  PA: {
    ref: { daily: 4_000, days: 3, fee: 1_800, taxP: 840, taxF: 126, host: 9_000 },
    min: { daily: 2_000, days: 1, fee: 500, taxP: 140, taxF: 35, host: 1_500 },
    week: { daily: 4_000, days: 7, fee: 3_360, taxP: 1_960, taxF: 235, host: 21_000 },
  },
  PY: {
    ref: { daily: 333_334, days: 3, fee: 150_000, taxP: 100_000, taxF: 15_000, host: 750_001 },
    min: { daily: 50_000, days: 3, fee: 35_000, taxP: 15_000, taxF: 3_500, host: 112_500 },
    week: { daily: 100_000, days: 7, fee: 84_000, taxP: 70_000, taxF: 8_400, host: 525_000 },
  },
};

/** Vecteur « 7 j » sous le barème de test à 10 % sans minimum (voir le test « barème EN VIGUEUR »). */
const NEW_SCHEDULE: Readonly<Record<string, { fee: number; taxF: number }>> = {
  PA: { fee: 2_800, taxF: 196 },
  PY: { fee: 70_000, taxF: 7_000 },
};

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
  /** Trip fee annoncé par l'API (défaut : celui du vecteur) ; 0 ⇒ aucune ligne TRIP_FEE. */
  readonly fee?: number;
  readonly taxF?: number;
  /** Lignes de la demande (défaut : aucune). */
  readonly requestLines?: Readonly<Record<string, number>>;
  readonly engineVersion?: string;
  /** Retouche des sorties avant empreinte. */
  readonly tamper?: (o: Record<string, unknown>) => void;
}

/** Documents canoniques d'un devis prc.quote/2 (forme de frozen.ts) : prix du trip et trip fee. */
function docs(c: CountryCase, v: Vector, groups: ReadonlyMap<string, string>, b: Build = {}): Docs {
  const fee = b.fee ?? v.fee;
  const taxF = fee === 0 ? 0 : (b.taxF ?? v.taxF);
  const price = v.daily * v.days;
  const lines = [
    {
      type: 'TRIP_PRICE',
      amount: String(price),
      taxGroup: groups.get('TRIP_PRICE') ?? null,
      tax: String(v.taxP),
    },
    ...(fee === 0
      ? []
      : [
          {
            type: 'TRIP_FEE',
            amount: String(fee),
            taxGroup: groups.get('TRIP_FEE') ?? null,
            tax: String(taxF),
          },
        ]),
  ];
  const subtotal = price + fee;
  const tax = v.taxP + taxF;
  const total = subtotal + tax;
  const outputs: Record<string, unknown> = {
    engineVersion: b.engineVersion ?? 'prc.quote/2',
    currency: c.currency,
    billableDays: v.days,
    lines,
    taxGroups: [],
    subtotal: String(subtotal),
    taxTotal: String(tax),
    taxThirdParty: '0',
    total: String(total),
    legs: {
      HOST: String(v.host),
      INSURER: '0',
      TAX_THIRD_PARTY: '0',
      PLATFORM: String(total - v.host),
    },
    hostSharePct: '3/4',
  };
  b.tamper?.(outputs);
  const inputs = JSON.stringify({
    request: {
      startAtMs: START,
      endAtMs: START + v.days * DAY,
      quotedAtMs: Date.parse(NOW),
      rateType: 'REFUNDABLE',
      dailyRate: String(v.daily),
      lines: Object.fromEntries(
        Object.entries(b.requestLines ?? {}).map(([k, x]) => [k, String(x)]),
      ),
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

async function person(client: pg.ClientBase, country: string): Promise<Buffer> {
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
  return t.hash;
}

async function listing(client: pg.ClientBase, c: CountryCase, daily: number): Promise<string> {
  const { rows } = await client.query<{ listing_id: string }>(
    'SELECT listing_id FROM test_fixture.us202_listed_listing($1, $2)',
    [c.country, daily],
  );
  if (!rows[0]) throw new Error('annonce de fixture');
  return rows[0].listing_id;
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
  hash: Buffer,
  listingId: string,
  d: Docs,
): Promise<{ outcome: string; quote_id: string | null }> {
  const { rows } = await client.query<{ outcome: string; quote_id: string | null }>(
    'SELECT * FROM core.pricing_cmd_freeze_quote($1, $2, $3, $4, $5, $6)',
    [hash, listingId, d.inputs, d.inputsHash, d.outputs, d.outputsHash],
  );
  return rows[0]!;
}

interface Ctx {
  readonly tx: pg.ClientBase;
  readonly guest: Buffer;
  readonly groups: Map<string, string>;
  /** Annonce LISTED au prix journalier du vecteur. */
  readonly listingOf: (v: Vector) => Promise<string>;
}

function scenario(c: CountryCase) {
  return async (fn: (ctx: Ctx) => Promise<void>) => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, { virtualNow: NOW }, async (tx) => {
        const guest = await person(tx, c.country);
        const groups = await taxGroups(tx, c);
        await fn({ tx, guest, groups, listingOf: (v) => listing(tx, c, v.daily) });
      });
    });
  };
}

describe.each(COUNTRIES.map((c) => [c.country, c] as const))(
  'US-704 trip fee rejoué par la base (%s)',
  (_name, c) => {
    const run = scenario(c);
    const V = VECTORS[c.country]!;

    it.each(['ref', 'min', 'week'] as const)(
      'critère 1 (%s) : la base recalcule F du barème du pays ; ligne TRIP_FEE taxée, F dans PLATFORM',
      async (kind) => {
        await run(async ({ tx, guest, groups, listingOf }) => {
          const v = V[kind];
          const r = await freeze(tx, guest, await listingOf(v), docs(c, v, groups));
          expect(r.outcome).toBe('DONE');
          const q = (await tx.query('SELECT * FROM test_fixture.us202_quote_row($1)', [r.quote_id]))
            .rows[0] as Record<string, unknown>;
          const total = v.daily * v.days + v.fee + v.taxP + v.taxF;
          expect(q['engine_version']).toBe('prc.quote/2');
          expect(q['billable_days']).toBe(v.days);
          expect(String(q['total_minor'])).toBe(String(total));
          expect(String(q['leg_host_minor'])).toBe(String(v.host));
          expect(String(q['leg_insurer_minor'])).toBe('0');
          expect(String(q['leg_tax_third_party_minor'])).toBe('0');
          expect(String(q['leg_platform_minor'])).toBe(String(total - v.host));
          const lines = (
            await tx.query('SELECT * FROM test_fixture.us202_quote_lines($1)', [r.quote_id])
          ).rows as Record<string, unknown>[];
          expect(
            lines.map((x) => [x['line_type'], String(x['amount_minor']), String(x['tax_minor'])]),
          ).toEqual([
            ['TRIP_PRICE', String(v.daily * v.days), String(v.taxP)],
            ['TRIP_FEE', String(v.fee), String(v.taxF)],
          ]);
          expect(lines.every((x) => x['third_party'] === false)).toBe(true);
        });
      },
    );

    it('suivi US-202 : ligne TRIP_FEE altérée ⇒ QUOTE_MISMATCH, rien d’écrit', async () => {
      await run(async ({ tx, guest, groups, listingOf }) => {
        const v = V.ref;
        const id = await listingOf(v);
        const min = V.min;
        const minId = await listingOf(min);
        const cases: [string, Docs][] = [
          ['F + 1', docs(c, v, groups, { fee: v.fee + 1 })],
          ['F − 1', docs(c, v, groups, { fee: v.fee - 1 })],
          ['F absent', docs(c, v, groups, { fee: 0 })],
          ['F fourni dans la demande', docs(c, v, groups, { requestLines: { TRIP_FEE: v.fee } })],
          ['moteur prc.quote/1', docs(c, v, groups, { engineVersion: 'prc.quote/1' })],
          [
            'taxe de F altérée',
            docs(c, v, groups, {
              tamper: (o) => {
                const lines = o['lines'] as Record<string, string>[];
                lines[1]!['tax'] = String(Number(lines[1]!['tax']) + 1);
                o['taxTotal'] = String(Number(o['taxTotal']) + 1);
                o['total'] = String(Number(o['total']) + 1);
                const legs = o['legs'] as Record<string, string>;
                legs['PLATFORM'] = String(Number(legs['PLATFORM']) + 1);
              },
            }),
          ],
          [
            'F déplacé vers HOST',
            docs(c, v, groups, {
              tamper: (o) => {
                const legs = o['legs'] as Record<string, string>;
                legs['HOST'] = String(Number(legs['HOST']) + v.fee);
                legs['PLATFORM'] = String(Number(legs['PLATFORM']) - v.fee);
              },
            }),
          ],
        ];
        for (const [name, d] of cases) {
          expect([name, (await freeze(tx, guest, id, d)).outcome]).toEqual([
            name,
            'QUOTE_MISMATCH',
          ]);
        }
        // minimum ignoré : 15 % de P au lieu du minimum du pays
        const pct = Math.round((min.daily * min.days * 15) / 100);
        expect(pct).toBeLessThan(min.fee);
        expect((await freeze(tx, guest, minId, docs(c, min, groups, { fee: pct }))).outcome).toBe(
          'QUOTE_MISMATCH',
        );
        // tranche ignorée : 15 % sur 7 jours au lieu de 12 %
        const week = V.week;
        const weekId = await listingOf(week);
        expect(
          (
            await freeze(
              tx,
              guest,
              weekId,
              docs(c, week, groups, { fee: (week.daily * week.days * 15) / 100 }),
            )
          ).outcome,
        ).toBe('QUOTE_MISMATCH');
        // le devis exact passe toujours : la base n'a rien écrit pour les refus
        expect((await freeze(tx, guest, id, docs(c, v, groups))).outcome).toBe('DONE');
      });
    });

    it('barème EN VIGUEUR en base : une nouvelle version change F ; l’ancien F est refusé', async () => {
      await run(async ({ tx, guest, groups, listingOf }) => {
        const v = V.week;
        const id = await listingOf(v);
        // barème de test : 10 % sans minimum (une entrée du test, jamais un attendu du code)
        await tx.query('SELECT test_fixture.us704_set_trip_fee_schedule($1, $2::jsonb)', [
          c.country,
          JSON.stringify({ tiers: [{ maxDays: null, rateBps: 1000 }], minMinor: '0' }),
        ]);
        expect((await freeze(tx, guest, id, docs(c, v, groups))).outcome).toBe('QUOTE_MISMATCH');
        // 10 % de P sur 7 j ; taxe de F au taux du pays (PA : ITBMS 7 % de 2 800 = 196 ; PY : IVA
        // 10 % de 70 000 = 7 000), valeurs exactes sans arrondi
        const { fee, taxF } = NEW_SCHEDULE[c.country]!;
        expect(fee * 10).toBe(v.daily * v.days);
        expect((await freeze(tx, guest, id, docs(c, v, groups, { fee, taxF }))).outcome).toBe(
          'DONE',
        );
      });
    });

    it('fail-closed : barème absent ⇒ QUOTE_UNAVAILABLE (jamais un trip fee nul)', async () => {
      await run(async ({ tx, guest, groups, listingOf }) => {
        const v = V.ref;
        const id = await listingOf(v);
        await tx.query('SELECT test_fixture.us704_close_trip_fee_schedule($1)', [c.country]);
        expect((await freeze(tx, guest, id, docs(c, v, groups))).outcome).toBe('QUOTE_UNAVAILABLE');
        expect((await freeze(tx, guest, id, docs(c, v, groups, { fee: 0 }))).outcome).toBe(
          'QUOTE_UNAVAILABLE',
        );
      });
    });

    it.each([
      ['aucune tranche', { tiers: [], minMinor: '0' }],
      ['taux > 100 %', { tiers: [{ maxDays: null, rateBps: 10_001 }], minMinor: '0' }],
      ['durée non couverte', { tiers: [{ maxDays: 2, rateBps: 1500 }], minMinor: '0' }],
      [
        'bornes non croissantes',
        {
          tiers: [
            { maxDays: 6, rateBps: 1500 },
            { maxDays: 6, rateBps: 1200 },
            { maxDays: null, rateBps: 800 },
          ],
          minMinor: '0',
        },
      ],
      [
        'tranche sans borne avant la fin',
        {
          tiers: [
            { maxDays: null, rateBps: 1500 },
            { maxDays: 29, rateBps: 1200 },
          ],
          minMinor: '0',
        },
      ],
      ['minimum négatif', { tiers: [{ maxDays: null, rateBps: 1500 }], minMinor: '-1' }],
      ['minimum absent', { tiers: [{ maxDays: null, rateBps: 1500 }] }],
    ])('fail-closed : barème mal formé (%s) ⇒ QUOTE_UNAVAILABLE', async (_name, value) => {
      await run(async ({ tx, guest, groups, listingOf }) => {
        const v = V.ref;
        const id = await listingOf(v);
        await tx.query('SELECT test_fixture.us704_set_trip_fee_schedule($1, $2::jsonb)', [
          c.country,
          JSON.stringify(value),
        ]);
        expect((await freeze(tx, guest, id, docs(c, v, groups))).outcome).toBe('QUOTE_UNAVAILABLE');
      });
    });
  },
);

describe('US-704 : la fonction du trip fee n’est exécutable par aucun rôle applicatif', () => {
  it.each(['app_api', 'app_worker', 'app_anon'] as const)(
    '%s : EXECUTE refusé (42501)',
    async (role) => {
      await withRole(role, async (client) => {
        await expect(
          client.query("SELECT core.pricing_trip_fee(12000, 3, '{}'::jsonb)"),
        ).rejects.toMatchObject({ code: '42501' });
      });
    },
  );

  it('propriétaire migrator, SECURITY INVOKER ; commande toujours SECURITY DEFINER de cmd_money_owner', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ proname: string; secdef: boolean; owner: string }>(
        `SELECT p.proname, p.prosecdef AS secdef, pg_catalog.pg_get_userbyid(p.proowner) AS owner
           FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'core' AND p.proname IN ('pricing_trip_fee', 'pricing_cmd_freeze_quote')
          ORDER BY 1`,
      );
      expect(rows).toEqual([
        { proname: 'pricing_cmd_freeze_quote', secdef: true, owner: 'cmd_money_owner' },
        { proname: 'pricing_trip_fee', secdef: false, owner: 'migrator' },
      ]);
    });
  });
});
