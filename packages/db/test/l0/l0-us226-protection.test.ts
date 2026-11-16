/**
 * Preuves des protections du voyageur et des plans de gains de l'hôte, partie serveur (US-226 partie
 * 226a, migrations 0110 et 0111, ADR-136 ; fixture 9977) sous les rôles de production (assertion
 * L0-05 en tête de chaque connexion : `withRole`), en USD (PA) et en PYG sans décimale (PY).
 * Personnes, sessions et comptes d'hôte par les VRAIES commandes ; devis figés par la VRAIE commande
 * de gel (0110) ; interrupteurs `p2p_private_hosts_enabled` et `insurer_contract_active` ouverts (et
 * refermés) par la procédure à deux personnes d'US-125, dans une transaction ANNULÉE ; grille de
 * protection, parts de l'assureur et plans de TEST posés par la fixture 9977 (entrées des tests).
 *
 * Attendus : jamais le code testé. Ils viennent de 19 US-226, de 16 (PRT-001, PRT-002, PRT-007,
 * PRT-008, PRT-011, PRC-018), de 08 (BR-PRICE-11, BR-PROT-06, E7, TJ01, TJ09a) et des vecteurs
 * des preuves d'US-208 (TA01 en PA, D2 sans ses lignes non taxées en PY) :
 * - PA : TA01 (40,00 × 3 j, ITBMS 7 % sur le loyer seul, barème du trip fee de TEST à 0 %) + la
 *   protection du trip A de 08 (30,00 = 1/4 du prix journalier net × 3 j, BASICA de la grille de
 *   TEST) ; prime due 0,7 × 30,00 = 21,00 (TJ01) ; HOST 90,00 (TJ01, part du loyer) ;
 * - PY : D2 (333 334 × 3 = 1 000 002 ; trip fee du barème du pays 150 000 ; taxe 100 000 + 15 000)
 *   + la protection de D2 (150 000 = roundHalfUp(333 334 × 3/20) × 3 j, BASICA de la grille de
 *   TEST) ; prime due 105 000 (TJ09a) ; HOST 750 001 (TJ09a, part du loyer) ;
 * - TOTAL (13/20 du prix journalier net, 16 PRC-018 : référence 65 %) : PA 26,00 × 3 = 78,00,
 *   prime roundHalfUp(78,00 × 7/10) = 54,60 ; PY roundHalfUp(216 667,1) = 216 667 × 3 = 650 001,
 *   prime roundHalfUp(455 000,7) = 455 001 ;
 * - plan de TEST « PLUS » à 9/10 : PA allocHost(120,00 ; 9/10) = 108,00 ; PY allocHost(1 000 002 ;
 *   9/10) = 900 001,8 → 900 002 (08 BR-PRICE-14 : au plus proche) ;
 * - totaux = Σ lignes + Σ taxes (08 BR-PRICE-13), PLATFORM = complément (08 E7).
 */
import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { approveSwitch, freshSession, requestSwitch } from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import { staff as rlsStaff, staffSessionHash } from '../support/rls.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

const SIGNUP_DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const NOW = '2026-12-01T12:00:00.000Z';
const START = Date.parse('2026-12-10T10:00:00.000Z');
const DAY = 86_400_000;
const ORDER = ['TRIP_PRICE', 'TRIP_FEE', 'PROTECTION'];

interface Level {
  /** Ligne PROTECTION (3 jours) et prime due à l'assureur (7/10, valeur de test de 08 E7). */
  readonly line: number;
  readonly insurer: number;
}

interface Vector {
  readonly daily: number;
  /** Barème de test du trip fee (`null` : barème du pays). */
  readonly schedule: object | null;
  readonly fee: number;
  readonly taxes: Readonly<Record<string, number>>;
  /** Jambe HOST au plan par défaut (ESTÁNDAR 3/4) et au plan de TEST PLUS (9/10). */
  readonly host: number;
  readonly hostPlus: number;
  /** Part BASICA de la grille de TEST (prix journalier net × part, 16 PRC-018). */
  readonly basicaPrice: string;
  readonly basica: Level;
  readonly total: Level;
}

// Vecteurs : voir l'en-tête.
const VECTORS: Readonly<Record<string, Vector>> = {
  PA: {
    daily: 4_000,
    schedule: { tiers: [{ maxDays: null, rateBps: 0 }], minMinor: '0' },
    fee: 0,
    taxes: { TRIP_PRICE: 840 },
    host: 9_000,
    hostPlus: 10_800,
    basicaPrice: '1/4',
    basica: { line: 3_000, insurer: 2_100 },
    total: { line: 7_800, insurer: 5_460 },
  },
  PY: {
    daily: 333_334,
    schedule: null,
    fee: 150_000,
    taxes: { TRIP_PRICE: 100_000, TRIP_FEE: 15_000 },
    host: 750_001,
    hostPlus: 900_002,
    basicaPrice: '3/20',
    basica: { line: 150_000, insurer: 105_000 },
    total: { line: 650_001, insurer: 455_001 },
  },
};

/** Grille de TEST (16 PRC-018, PRT-002) : BASICA du vecteur, ESTANDAR 2/5, TOTAL 13/20 dès 21 ans. */
function grid(v: Vector, extra: Record<string, object> = {}): object {
  const t = (rank: number, price: string, minDriverAge: number | null) => ({
    rank,
    price,
    minDriverAge,
    dailyFloorMinor: null,
    dailyCeilingMinor: null,
  });
  return {
    BASICA: t(1, v.basicaPrice, null),
    ESTANDAR: t(2, '2/5', null),
    TOTAL: t(3, '13/20', 21),
    ...extra,
  };
}

const SHARES = { BASICA: '7/10', ESTANDAR: '7/10', TOTAL: '7/10' };

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

interface DocOptions {
  /** Niveau demandé (`undefined` : BASICA ; `null` : aucun). */
  readonly level?: string | null;
  readonly age?: number | null;
  /** Montants du niveau (défaut : ceux de BASICA). */
  readonly amounts?: Level;
  readonly host?: number;
  readonly plan?: string;
  readonly version?: 'prc.quote/2' | 'prc.quote/3';
  /** Ligne fournie par l'appelant (refusée : PROTECTION est calculée). */
  readonly providedProtection?: boolean;
  /** Prime déclarée par l'API (défaut : celle du vecteur). */
  readonly insurerOut?: number;
}

/** Documents canoniques d'un devis (forme de frozen.ts), sorties tirées des vecteurs. */
function docs(c: CountryCase, groups: ReadonlyMap<string, string>, o: DocOptions = {}): Docs {
  const v = VECTORS[c.country]!;
  const v3 = (o.version ?? 'prc.quote/3') === 'prc.quote/3';
  const level = o.level === undefined ? 'BASICA' : o.level;
  const lv = o.amounts ?? v.basica;
  const amounts: Record<string, number> = {
    TRIP_PRICE: v.daily * 3,
    TRIP_FEE: v.fee,
    PROTECTION: v3 ? lv.line : 0,
  };
  const lines = ORDER.filter((t) => (amounts[t] ?? 0) !== 0).map((t) => ({
    type: t,
    amount: String(amounts[t]),
    taxGroup: groups.get(t) ?? null,
    tax: String(v.taxes[t] ?? 0),
  }));
  const subtotal = Object.values(amounts).reduce((a, x) => a + x, 0);
  const tax = Object.values(v.taxes).reduce((a, x) => a + x, 0);
  const total = subtotal + tax;
  const host = o.host ?? v.host;
  const insurer = o.insurerOut ?? (v3 ? lv.insurer : 0);
  const outputs: Record<string, unknown> = {
    engineVersion: v3 ? 'prc.quote/3' : 'prc.quote/2',
    currency: c.currency,
    billableDays: 3,
    lines,
    taxGroups: [],
    subtotal: String(subtotal),
    taxTotal: String(tax),
    taxThirdParty: '0',
    total: String(total),
    legs: {
      HOST: String(host),
      INSURER: String(insurer),
      TAX_THIRD_PARTY: '0',
      PLATFORM: String(total - host - insurer),
    },
    hostSharePct: '3/4',
    ...(v3
      ? { protectionLevel: level, insurerPremiumShare: '7/10', hostPlan: o.plan ?? 'ESTÁNDAR' }
      : {}),
  };
  const request: Record<string, unknown> = {
    startAtMs: START,
    endAtMs: START + 3 * DAY,
    quotedAtMs: Date.parse(NOW),
    rateType: 'REFUNDABLE',
    dailyRate: String(v.daily),
    lines: o.providedProtection ? { PROTECTION: String(lv.line) } : {},
    ...(v3 ? { protectionLevel: level, driverAge: o.age ?? null } : {}),
  };
  const inputs = JSON.stringify({ request, params: { currency: { code: c.currency } } });
  const out = JSON.stringify(outputs);
  return {
    inputs,
    inputsHash: sha('rueda.quote.inputs/1\n', inputs),
    outputs: out,
    outputsHash: sha('rueda.quote.outputs/1\n', out),
  };
}

interface Person {
  readonly id: string;
  readonly hash: Buffer;
}

async function session(c: Tx, userId: string): Promise<Buffer> {
  const t = newToken();
  const s = await c.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [uuid(), userId, t.hash, SESSION_TTL_S],
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  return t.hash;
}

async function person(c: Tx, country: string): Promise<Person> {
  const id = uuid();
  const r = await c.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400,
                                                NULL, $6, $7::jsonb, false) AS ok`,
    [id, `s226-${id}@example.test`, phcArgon2id(), uuid(), randomBytes(32), country, SIGNUP_DOCS],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await c.query('SELECT test_fixture.iam_set_account_status($1, $2)', [id, 'ACTIVE']);
  return { id, hash: await session(c, id) };
}

/** Interrupteur posé par la procédure à deux personnes d'US-125, dans la transaction annulée. */
async function setSwitch(
  c: Tx,
  key: 'p2p_private_hosts_enabled' | 'insurer_contract_active',
  country: string,
  value: boolean,
): Promise<void> {
  const actor = async (role: string): Promise<StaffActor> => {
    const id = await rlsStaff(c, role, [country]);
    return { userId: id, hash: Buffer.from(staffSessionHash(id) ?? '', 'hex'), scope: [country] };
  };
  const requester = await actor('ADMIN');
  const approver = await freshSession(c, await actor('SUPERADMIN'));
  const r = await requestSwitch(c, requester, key, country, value);
  if (r.outcome !== 'REQUESTED' || r.request_id === null) throw new Error(`demande : ${r.outcome}`);
  const a = await approveSwitch(c, approver, r.request_id);
  if (a.outcome !== 'APPLIED') throw new Error(`approbation : ${a.outcome}`);
}

/** Avance l'horloge virtuelle de la transaction (une valeur de paramètre par instant). */
async function later(c: Tx, minutes: number): Promise<void> {
  const at = new Date(Date.parse(NOW) + minutes * 60_000).toISOString();
  await c.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [at]);
}

async function setParam(c: Tx, key: string, country: string, value: unknown): Promise<void> {
  await c.query('SELECT test_fixture.us226_set_param($1, $2, $3::jsonb)', [
    key,
    country,
    JSON.stringify(value),
  ]);
}

/** Groupe fiscal de chaque type de ligne taxable, en vigueur (lecture app_api de 0008). */
async function taxGroups(c: Tx, cc: CountryCase): Promise<Map<string, string>> {
  const { rows } = await c.query<{ line_type: string; rate_group: string | null }>(
    `SELECT DISTINCT ON (line_type) line_type, rate_group FROM core.pricing_tax_line_config
      WHERE country_code = $1 ORDER BY line_type, version DESC`,
    [cc.country],
  );
  return new Map(
    rows.filter((r) => r.rate_group !== null).map((r) => [r.line_type, r.rate_group!]),
  );
}

async function freeze(
  c: Tx,
  hash: Buffer,
  listingId: string,
  d: Docs,
): Promise<{ outcome: string; quote_id: string | null }> {
  const { rows } = await c.query<{ outcome: string; quote_id: string | null }>(
    'SELECT * FROM core.pricing_cmd_freeze_quote($1, $2, $3, $4, $5, $6)',
    [hash, listingId, d.inputs, d.inputsHash, d.outputs, d.outputsHash],
  );
  return rows[0]!;
}

async function quoteRow(c: Tx, quoteId: string): Promise<Row> {
  return (await c.query<Row>('SELECT * FROM test_fixture.us202_quote_row($1)', [quoteId])).rows[0]!;
}

async function checkout(c: Tx, hash: Buffer, quoteId: string): Promise<string> {
  const shown = (
    await c.query<Row>('SELECT * FROM core.booking_checkout_quote($1, $2)', [hash, quoteId])
  ).rows[0];
  const documents = ((shown?.['documents'] ?? []) as { kind: string; version: number }[]).map(
    (d) => ({ kind: d.kind, version: d.version }),
  );
  const { rows } = await c.query<{ outcome: string }>(
    'SELECT * FROM core.booking_cmd_checkout($1, $2, $3, $4, $5, $6::jsonb)',
    [hash, quoteId, 'Ana', 'Pérez', false, JSON.stringify(documents)],
  );
  return rows[0]!.outcome;
}

interface Ctx {
  readonly guest: Person;
  readonly groups: Map<string, string>;
  readonly listingId: string;
  readonly vehicleId: string;
}

/** Corps du test dans une transaction annulée, sous app_api (L0-05 par withRole). */
function scenario(cc: CountryCase) {
  return (fn: (tx: Tx, ctx: Ctx) => Promise<void>, opts: { insurer?: boolean } = {}) =>
    withRole('app_api', (client) =>
      withTestTransaction(client, { virtualNow: NOW }, async (tx) => {
        await setSwitch(tx, 'p2p_private_hosts_enabled', cc.country, true);
        if (opts.insurer !== false)
          await setSwitch(tx, 'insurer_contract_active', cc.country, true);
        const v = VECTORS[cc.country]!;
        if (v.schedule !== null) {
          await tx.query('SELECT test_fixture.us704_set_trip_fee_schedule($1, $2::jsonb)', [
            cc.country,
            JSON.stringify(v.schedule),
          ]);
        }
        await setParam(tx, 'protection_grid', cc.country, grid(v));
        await setParam(tx, 'insurer_premium_share', cc.country, SHARES);
        const guest = await person(tx, cc.country);
        const { rows } = await tx.query<{ listing_id: string; vehicle_id: string }>(
          'SELECT * FROM test_fixture.us208_listed_listing($1, $2, $3, $4)',
          [cc.country, v.daily, 'AUTOMATIC', true],
        );
        const groups = await taxGroups(tx, cc);
        await fn(tx, {
          guest,
          groups,
          listingId: rows[0]!.listing_id,
          vehicleId: rows[0]!.vehicle_id,
        });
      }),
    );
}

async function frozen(tx: Tx, cc: CountryCase, ctx: Ctx, o: DocOptions = {}): Promise<string> {
  const r = await freeze(tx, ctx.guest.hash, ctx.listingId, docs(cc, ctx.groups, o));
  if (r.outcome !== 'DONE' || r.quote_id === null) throw new Error(`gel : ${r.outcome}`);
  return r.quote_id;
}

describe.each(COUNTRIES.map((c) => [c.country, c] as const))(
  'US-226 protections et plans de gains, partie serveur (%s)',
  (_name, cc) => {
    const run = scenario(cc);
    const v = VECTORS[cc.country]!;
    const totalOf = (lv: Level): number =>
      v.daily * 3 + v.fee + lv.line + Object.values(v.taxes).reduce((a, x) => a + x, 0);

    it('critère 4 : ligne PROTECTION rejouée par la base et prime de l’assureur ⇒ jambe INSURER (TJ01 / TJ09a), HOST au plan par défaut, PLATFORM = complément ; devis figé au niveau BASICA', async () => {
      await run(async (tx, ctx) => {
        const quoteId = await frozen(tx, cc, ctx);
        const q = await quoteRow(tx, quoteId);
        const lines = (
          await tx.query<Row>('SELECT * FROM test_fixture.us202_quote_lines($1)', [quoteId])
        ).rows;
        const protection = lines.find((l) => l['line_type'] === 'PROTECTION');
        expect(String(protection?.['amount_minor'])).toBe(String(v.basica.line));
        expect(String(protection?.['tax_minor'])).toBe('0');
        const total = totalOf(v.basica);
        expect(String(q['total_minor'])).toBe(String(total));
        expect(String(q['leg_insurer_minor'])).toBe(String(v.basica.insurer));
        expect(String(q['leg_host_minor'])).toBe(String(v.host));
        expect(String(q['leg_platform_minor'])).toBe(String(total - v.host - v.basica.insurer));
        expect(q).toMatchObject({
          engine_version: 'prc.quote/3',
          protection_level: 'BASICA',
          host_plan_code: 'ESTÁNDAR',
          driver_age: null,
        });
      });
    });

    it('critère 4 : prime déclarée par l’API différente de celle rejouée, ou ligne PROTECTION fournie par l’appelant ⇒ QUOTE_MISMATCH, rien d’écrit', async () => {
      await run(async (tx, ctx) => {
        for (const o of [
          { insurerOut: v.basica.insurer - 1 },
          { insurerOut: 0 },
          { providedProtection: true },
        ] as DocOptions[]) {
          const r = await freeze(tx, ctx.guest.hash, ctx.listingId, docs(cc, ctx.groups, o));
          expect(r, JSON.stringify(o)).toEqual({ outcome: 'QUOTE_MISMATCH', quote_id: null });
        }
      });
    });

    it('critère 1 : voyageur de 20 ans ⇒ TOTAL refusé (PROTECTION_LEVEL_NOT_ELIGIBLE), comme sans âge ; à 21 ans ⇒ accepté ; BASICA sans âge ⇒ accepté', async () => {
      await run(async (tx, ctx) => {
        for (const age of [20, null]) {
          const r = await freeze(
            tx,
            ctx.guest.hash,
            ctx.listingId,
            docs(cc, ctx.groups, { level: 'TOTAL', age, amounts: v.total }),
          );
          expect(r, String(age)).toEqual({
            outcome: 'PROTECTION_LEVEL_NOT_ELIGIBLE',
            quote_id: null,
          });
        }
        const total = await frozen(tx, cc, ctx, { level: 'TOTAL', age: 21, amounts: v.total });
        expect(await quoteRow(tx, total)).toMatchObject({
          protection_level: 'TOTAL',
          driver_age: 21,
        });
        expect(String((await quoteRow(tx, total))['leg_insurer_minor'])).toBe(
          String(v.total.insurer),
        );
        const basica = await frozen(tx, cc, ctx, { age: 20 });
        expect(await quoteRow(tx, basica)).toMatchObject({
          protection_level: 'BASICA',
          driver_age: 20,
        });
      });
    });

    it('critère 1 : aucune option « sans protection » (niveau absent, vide, inconnu) ; niveau sous le minimum du pays refusé ; minimum absent ⇒ niveau de plus petit rang (BASICA)', async () => {
      await run(async (tx, ctx) => {
        for (const level of [null, '']) {
          const r = await freeze(
            tx,
            ctx.guest.hash,
            ctx.listingId,
            docs(cc, ctx.groups, { level }),
          );
          expect(r.outcome, String(level)).toBe('PROTECTION_LEVEL_REQUIRED');
        }
        for (const level of ['NONE', 'basica', 'PRO']) {
          const r = await freeze(
            tx,
            ctx.guest.hash,
            ctx.listingId,
            docs(cc, ctx.groups, { level }),
          );
          expect(r.outcome, level).toBe('PROTECTION_LEVEL_NOT_ELIGIBLE');
        }
        // niveau de rang inférieur au minimum du pays (BASICA) : jamais vendu (16 PRT-011)
        const shifted = {
          INFERIOR: {
            rank: 1,
            price: '1/10',
            minDriverAge: null,
            dailyFloorMinor: null,
            dailyCeilingMinor: null,
          },
          BASICA: {
            rank: 2,
            price: v.basicaPrice,
            minDriverAge: null,
            dailyFloorMinor: null,
            dailyCeilingMinor: null,
          },
        };
        await later(tx, 1); // une valeur de paramètre par instant (unicité de valid_from)
        await setParam(tx, 'protection_grid', cc.country, shifted);
        await setParam(tx, 'insurer_premium_share', cc.country, { ...SHARES, INFERIOR: '7/10' });
        const low = await freeze(
          tx,
          ctx.guest.hash,
          ctx.listingId,
          docs(cc, ctx.groups, { level: 'INFERIOR' }),
        );
        expect(low.outcome).toBe('PROTECTION_LEVEL_NOT_ELIGIBLE');
        // guest_protection_min_level absent : le plus petit rang (INFERIOR) devient le minimum ;
        // avec la grille du vecteur, c'est BASICA (16 PRT-011)
        await later(tx, 2);
        await setParam(tx, 'protection_grid', cc.country, grid(v));
        await tx.query('SELECT test_fixture.us226_close_param($1, $2)', [
          'guest_protection_min_level',
          cc.country,
        ]);
        await frozen(tx, cc, ctx);
      });
    });

    it('critère 2 : véhicule sans plan choisi ⇒ ESTÁNDAR (3/4) figé dans le devis ; critère 3 : changement de plan ⇒ le devis déjà figé et son hold gardent l’ancien plan, le nouveau devis prend le nouveau', async () => {
      await run(async (tx, ctx) => {
        await setParam(tx, 'host_share_pct', cc.country, { ESTÁNDAR: '3/4', PLUS: '9/10' });
        const before = await frozen(tx, cc, ctx);
        expect(await quoteRow(tx, before)).toMatchObject({ host_plan_code: 'ESTÁNDAR' });
        expect(String((await quoteRow(tx, before))['leg_host_minor'])).toBe(String(v.host));

        await tx.query('SELECT test_fixture.us226_set_vehicle_plan($1, $2)', [
          ctx.vehicleId,
          'PLUS',
        ]);
        // le devis de l'ancien plan, rejoué avec le nouveau : refusé (part de l'hôte rejouée)
        const stale = await freeze(tx, ctx.guest.hash, ctx.listingId, docs(cc, ctx.groups));
        expect(stale.outcome).toBe('QUOTE_MISMATCH');
        const after = await frozen(tx, cc, ctx, { plan: 'PLUS', host: v.hostPlus });
        const a = await quoteRow(tx, after);
        expect(a).toMatchObject({ host_plan_code: 'PLUS' });
        expect(String(a['leg_host_minor'])).toBe(String(v.hostPlus));

        // le devis figé avant le changement garde sa part, et le hold posé avec lui aussi
        const b = await quoteRow(tx, before);
        expect(b).toMatchObject({ host_plan_code: 'ESTÁNDAR' });
        expect(String(b['leg_host_minor'])).toBe(String(v.host));
        expect(await checkout(tx, ctx.guest.hash, before)).toBe('DONE');
        expect((await quoteRow(tx, before))['host_plan_code']).toBe('ESTÁNDAR');
      });
    });

    it('critère 5 : insurer_contract_active = false ⇒ INSURER_CONTRACT_INACTIVE au gel ; contrat refermé après le gel ⇒ INSURER_CONTRACT_INACTIVE au checkout, aucun hold ; lecture du devis ⇒ interrupteur rendu', async () => {
      await run(
        async (tx, ctx) => {
          const r = await freeze(tx, ctx.guest.hash, ctx.listingId, docs(cc, ctx.groups));
          expect(r).toEqual({ outcome: 'INSURER_CONTRACT_INACTIVE', quote_id: null });
          await setSwitch(tx, 'insurer_contract_active', cc.country, true);
          const quoteId = await frozen(tx, cc, ctx);
          const open = (
            await tx.query<Row>('SELECT * FROM core.booking_checkout_protection($1, $2)', [
              ctx.guest.hash,
              quoteId,
            ])
          ).rows[0]!;
          expect(open).toMatchObject({
            quote_id: quoteId,
            protection_level: 'BASICA',
            driver_age: null,
            insurer_contract_active: true,
          });
          await later(tx, 1); // une version de l'interrupteur par instant (unicité de valid_from)
          await setSwitch(tx, 'insurer_contract_active', cc.country, false);
          expect(await checkout(tx, ctx.guest.hash, quoteId)).toBe('INSURER_CONTRACT_INACTIVE');
          const holds = await tx.query<{ n: number }>(
            `SELECT pg_catalog.count(*)::int AS n FROM core.booking_checkout_hold
              WHERE guest_user_id = $1`,
            [ctx.guest.id],
          );
          expect(holds.rows[0]?.n).toBe(0);
          const closed = (
            await tx.query<Row>('SELECT * FROM core.booking_checkout_protection($1, $2)', [
              ctx.guest.hash,
              quoteId,
            ])
          ).rows[0]!;
          expect(closed['insurer_contract_active']).toBe(false);
          // devis d'un autre voyageur : aucune ligne (même réponse qu'un devis inconnu)
          const other = await person(tx, cc.country);
          const none = await tx.query('SELECT * FROM core.booking_checkout_protection($1, $2)', [
            other.hash,
            quoteId,
          ]);
          expect(none.rows).toEqual([]);
        },
        { insurer: false },
      );
    });

    it('PRT-011 : devis prc.quote/2 (sans protection) toujours figé tel quel mais jamais réservé ⇒ PROTECTION_LEVEL_REQUIRED au checkout', async () => {
      await run(async (tx, ctx) => {
        const quoteId = await frozen(tx, cc, ctx, { version: 'prc.quote/2' });
        expect(await quoteRow(tx, quoteId)).toMatchObject({
          engine_version: 'prc.quote/2',
          protection_level: null,
          host_plan_code: null,
        });
        expect(await checkout(tx, ctx.guest.hash, quoteId)).toBe('PROTECTION_LEVEL_REQUIRED');
      });
    });

    it('critère 1 : devis BASICA ⇒ checkout DONE (hold posé avec sa protection)', async () => {
      await run(async (tx, ctx) => {
        const quoteId = await frozen(tx, cc, ctx);
        expect(await checkout(tx, ctx.guest.hash, quoteId)).toBe('DONE');
      });
    });

    it('PRT-008 : commande de l’hôte titulaire ⇒ version suivante, même plan sans nouvelle version, PRO et plan inconnu refusés ; autre hôte ⇒ FORBIDDEN ; lecture des plans sans PRO', async () => {
      await withRole('app_api', (client) =>
        withTestTransaction(client, { virtualNow: NOW }, async (tx) => {
          await setParam(tx, 'host_share_pct', cc.country, {
            ESTÁNDAR: '3/4',
            PLUS: '9/10',
            PRO: '17/20',
          });
          const h = await person(tx, cc.country);
          const acc = await tx.query<{ outcome: string; org_id: string | null }>(
            'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
            [h.hash, cc.country, 'INDIVIDUAL'],
          );
          const org = acc.rows[0]?.org_id;
          if (acc.rows[0]?.outcome !== 'DONE' || !org) throw new Error('compte d’hôte refusé');
          const loc = await tx.query<{ location_id: string | null }>(
            'SELECT * FROM core.catalog_cmd_create_location($1, $2, $3, $4, $5, $6, $7, $8, $9)',
            [h.hash, org, 'HOME', 'Casa', 'Calle 1', 'Ciudad', null, null, null],
          );
          const veh = await tx.query<{ vehicle_id: string | null }>(
            `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, NULL, NULL, 'Marca',
                                                           'Modelo', 2021, NULL, 'AUTOMATIC',
                                                           5::smallint, 'GASOLINE', 42000, false,
                                                           false)`,
            [
              h.hash,
              org,
              loc.rows[0]?.location_id,
              `C${randomBytes(4).toString('hex').toUpperCase()}`,
            ],
          );
          const vehicle = veh.rows[0]?.vehicle_id;
          if (!vehicle) throw new Error('véhicule refusé');
          const set = async (who: Buffer, orgId: string, plan: string | null) =>
            (
              await tx.query<{ outcome: string; plan_code: string | null }>(
                'SELECT * FROM core.catalog_cmd_set_earnings_plan($1, $2, $3, $4)',
                [who, orgId, vehicle, plan],
              )
            ).rows[0]!;
          const plans = async () =>
            (
              await tx.query<Row>('SELECT * FROM core.catalog_host_earnings_plans($1, $2)', [
                h.hash,
                org,
              ])
            ).rows;

          // aucun choix : plan par défaut du pays, non choisi ; plans vendus sans PRO
          const initial = await plans();
          expect(initial).toHaveLength(1);
          expect(initial[0]).toMatchObject({
            vehicle_id: vehicle,
            plan_code: 'ESTÁNDAR',
            chosen: false,
            chosen_at: null,
            default_plan: 'ESTÁNDAR',
          });
          // PRO (flottes, sans objet depuis le pivot P2P) n'est jamais proposé, même configuré
          expect(initial[0]?.['offered']).toEqual({ ESTÁNDAR: '3/4', PLUS: '9/10' });

          expect(await set(h.hash, org, 'PLUS')).toEqual({ outcome: 'DONE', plan_code: 'PLUS' });
          expect(await set(h.hash, org, 'PLUS')).toEqual({ outcome: 'DONE', plan_code: 'PLUS' });
          for (const plan of ['PRO', 'INCONNU', null]) {
            expect((await set(h.hash, org, plan)).outcome, String(plan)).toBe(
              'EARNINGS_PLAN_NOT_AVAILABLE',
            );
          }
          expect(await set(h.hash, org, 'ESTÁNDAR')).toEqual({
            outcome: 'DONE',
            plan_code: 'ESTÁNDAR',
          });
          const rows = (
            await tx.query<Row>('SELECT * FROM test_fixture.us226_plan_rows($1)', [vehicle])
          ).rows;
          expect(rows.map((r) => [r['version'], r['plan_code']])).toEqual([
            [1, 'PLUS'],
            [2, 'ESTÁNDAR'],
          ]);
          expect(rows.every((r) => r['chosen_by'] === h.id && r['org_id'] === org)).toBe(true);
          expect((await plans())[0]).toMatchObject({ plan_code: 'ESTÁNDAR', chosen: true });

          // autre personne : compte d'hôte qui n'est pas le sien ⇒ FORBIDDEN, rien d'écrit
          const other = await person(tx, cc.country);
          expect((await set(other.hash, org, 'PLUS')).outcome).toBe('FORBIDDEN');
          expect(
            (
              await tx.query('SELECT * FROM core.catalog_host_earnings_plans($1, $2)', [
                other.hash,
                org,
              ])
            ).rows,
          ).toEqual([]);
          expect(
            (await tx.query<Row>('SELECT * FROM test_fixture.us226_plan_rows($1)', [vehicle])).rows,
          ).toHaveLength(2);
        }),
      );
    });

    it('registre des plans immuable pour tout rôle ; app_api ne lit ni n’écrit la table', async () => {
      await run(async (tx, ctx) => {
        await tx.query('SELECT test_fixture.us226_set_vehicle_plan($1, $2)', [
          ctx.vehicleId,
          'ESTÁNDAR',
        ]);
        for (const kind of ['update', 'delete', 'truncate']) {
          const r = await tx.query<{ r: string }>(
            'SELECT test_fixture.us226_try_write($1, $2) AS r',
            [ctx.vehicleId, kind],
          );
          expect(r.rows[0]?.r, kind).toBe('23000:catalog_earnings_plan_immutable');
        }
        for (const sql of [
          'SELECT * FROM core.catalog_vehicle_earnings_plan',
          `INSERT INTO core.catalog_vehicle_earnings_plan (vehicle_id, version, org_id, country_code,
                                                           plan_code, chosen_by)
           VALUES ('${ctx.vehicleId}', 9, '${ctx.vehicleId}', '${cc.country}', 'PLUS', '${ctx.guest.id}')`,
        ]) {
          await tx.query('SAVEPOINT s');
          await expect(tx.query(sql)).rejects.toMatchObject({ code: '42501' });
          await tx.query('ROLLBACK TO SAVEPOINT s');
        }
      });
    });
  },
);
