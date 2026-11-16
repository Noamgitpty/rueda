/**
 * Preuves du checkout en une page, partie back-end (US-208, migration 0108, ADR-133 ; fixture 9998)
 * sous les rôles de production (assertion L0-05 en tête de chaque connexion : `withRole`), en USD
 * (PA) et en PYG sans décimale (PY). Personnes et sessions par les VRAIES commandes ; devis figé par
 * la VRAIE commande de gel (0102 remplacée par 0108) ; interrupteurs `p2p_private_hosts_enabled` et
 * `insurer_contract_active` ouverts par la procédure à deux personnes d'US-125, dans une
 * transaction ANNULÉE ; l'annonce LISTED vient de la fixture 9998 (US-202, 9993).
 *
 * Attendus : jamais le code testé. Ils viennent de 19 US-208, de 16 (BKG-001, BKG-002 / BKG-025,
 * BKG-008 / BKG-023, PRC-025) et des oracles (`docs/specs/tools/`, `golden_vectors.json`) :
 * - PA, critère 1 : TA01 (16 A.8.1, configuration « PA1 » : ITBMS 7 % sur le loyer seul, ni trip fee
 *   ni protection ; barème du trip fee de TEST à 0 %) : 40,00 × 3 j = 120,00, taxe 8,40, total
 *   128,40 ; jambe HOST 9 000 (TJ01 : part du loyer 9 000, sans extras ni livraison) ;
 * - PY, critère 4 : trip D2 de 08 (T40) sans ses lignes non taxées : 333 334 × 3 = 1 000 002 ; trip
 *   fee du barème du pays 150 000 (le F de J et NP de 08 E7) ; taxe par ligne 100 000 (T40) +
 *   15 000 (taxe de F de J) ; total 1 265 002 ; jambe HOST 750 001 (TJ09a : allocHost(1 000 002 ;
 *   3/4), sans la part de livraison) ;
 * - durée de validité du devis : 30 min (16 PRC-025, PROPOSÉ ; `quote_validity_minutes`) ;
 * - totaux = Σ lignes + Σ taxes (08 BR-PRICE-13), PLATFORM = complément (08 E7).
 */
import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../src/index.ts';
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
const MIN = 60_000;
/** Durée de validité du devis figé (16 PRC-025, PROPOSÉ 30 min). */
const VALIDITY_MIN = 30;
const KINDS = ['CANCELLATION_POLICY', 'GEO_TERMS', 'TOS_GUEST'];

interface Vector {
  readonly daily: number;
  /** Barème de test du trip fee (`null` : barème du pays). */
  readonly schedule: object | null;
  readonly fee: number;
  readonly taxes: Readonly<Record<string, number>>;
  readonly host: number;
  readonly total: number;
  /** Livraison (ligne non taxée que la base ne rejoue pas) et jambe HOST qui l'inclut. */
  readonly delivery: number;
  readonly hostWithDelivery: number;
}

// Vecteurs (voir l'en-tête) : TA01 en PA, D2 sans lignes non taxées en PY.
const VECTORS: Readonly<Record<string, Vector>> = {
  PA: {
    daily: 4_000,
    schedule: { tiers: [{ maxDays: null, rateBps: 0 }], minMinor: '0' },
    fee: 0,
    taxes: { TRIP_PRICE: 840 },
    host: 9_000,
    total: 12_840,
    // T01 : livraison 40,00, non taxée ; TJ01 : HOST 9 000 + 3 000 (part de la livraison)
    delivery: 4_000,
    hostWithDelivery: 12_000,
  },
  PY: {
    daily: 333_334,
    schedule: null,
    fee: 150_000,
    taxes: { TRIP_PRICE: 100_000, TRIP_FEE: 15_000 },
    host: 750_001,
    total: 1_265_002,
    // T40 : livraison 50 000, non taxée ; TJ09a : HOST 750 001 + 37 500 (part de la livraison)
    delivery: 50_000,
    hostWithDelivery: 787_501,
  },
};
const ORDER = ['TRIP_PRICE', 'TRIP_FEE', 'DELIVERY_FEE'];

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

/**
 * Documents canoniques d'un devis (forme de frozen.ts), sorties tirées des vecteurs ; `delivery` :
 * ligne de livraison du vecteur, que la base ne rejoue pas (N-129).
 */
function docs(
  c: CountryCase,
  groups: ReadonlyMap<string, string>,
  opts: { startMs?: number; delivery?: boolean; quotedAtMs?: number } = {},
): Docs {
  const v = VECTORS[c.country]!;
  const startMs = opts.startMs ?? START;
  const extra: Record<string, number> = opts.delivery ? { DELIVERY_FEE: v.delivery } : {};
  const amounts: Record<string, number> = { TRIP_PRICE: v.daily * 3, TRIP_FEE: v.fee, ...extra };
  const lines = ORDER.filter((t) => (amounts[t] ?? 0) !== 0).map((t) => ({
    type: t,
    amount: String(amounts[t]),
    taxGroup: groups.get(t) ?? null,
    tax: String(v.taxes[t] ?? 0),
  }));
  const subtotal = Object.values(amounts).reduce((a, x) => a + x, 0);
  const tax = Object.values(v.taxes).reduce((a, x) => a + x, 0);
  const total = subtotal + tax;
  const host = opts.delivery ? v.hostWithDelivery : v.host;
  const outputs = {
    engineVersion: 'prc.quote/2',
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
      INSURER: '0',
      TAX_THIRD_PARTY: '0',
      PLATFORM: String(total - host),
    },
    hostSharePct: '3/4',
  };
  const inputs = JSON.stringify({
    request: {
      startAtMs: startMs,
      endAtMs: startMs + 3 * DAY,
      quotedAtMs: opts.quotedAtMs ?? Date.parse(NOW),
      rateType: 'REFUNDABLE',
      dailyRate: String(v.daily),
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

interface Person {
  readonly id: string;
  readonly hash: Buffer;
}

async function person(c: Tx, country: string, first = 'Ana', last = 'Pérez'): Promise<Person> {
  const id = uuid();
  const r = await c.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, $4, $5, 'es', $6, $7, 86400, NULL,
                                                $8, $9::jsonb, false) AS ok`,
    [
      id,
      `s208-${id}@example.test`,
      phcArgon2id(),
      first,
      last,
      uuid(),
      randomBytes(32),
      country,
      SIGNUP_DOCS,
    ],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await c.query('SELECT test_fixture.iam_set_account_status($1, $2)', [id, 'ACTIVE']);
  const t = newToken();
  const s = await c.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [uuid(), id, t.hash, SESSION_TTL_S],
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  return { id, hash: t.hash };
}

/** Interrupteur ouvert par la procédure à deux personnes d'US-125, dans la transaction annulée. */
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

async function listing(
  c: Tx,
  cc: CountryCase,
  transmission: 'MANUAL' | 'AUTOMATIC' = 'AUTOMATIC',
  instant = true,
): Promise<string> {
  const { rows } = await c.query<{ listing_id: string }>(
    'SELECT * FROM test_fixture.us208_listed_listing($1, $2, $3, $4)',
    [cc.country, VECTORS[cc.country]!.daily, transmission, instant],
  );
  if (!rows[0]) throw new Error('annonce de fixture');
  return rows[0].listing_id;
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

async function checkoutQuote(c: Tx, hash: Buffer, quoteId: string): Promise<Row[]> {
  return (await c.query<Row>('SELECT * FROM core.booking_checkout_quote($1, $2)', [hash, quoteId]))
    .rows;
}

/** Versions affichées par le checkout (documents du devis), acceptées telles quelles. */
async function shownVersions(
  c: Tx,
  hash: Buffer,
  quoteId: string,
): Promise<{ kind: string; version: number }[]> {
  const r = (await checkoutQuote(c, hash, quoteId))[0];
  const list = (r?.['documents'] ?? []) as { kind: string; version: number }[];
  return list.map((d) => ({ kind: d.kind, version: d.version }));
}

interface Checkout {
  readonly driver?: readonly [string, string];
  readonly manual?: boolean | null;
  readonly documents?: unknown;
}

async function checkout(
  c: Tx,
  hash: Buffer,
  quoteId: string,
  o: Checkout = {},
): Promise<{ outcome: string; hold_id: string | null; expires_at: Date | null }> {
  const documents = o.documents === undefined ? await shownVersions(c, hash, quoteId) : o.documents;
  const [first, last] = o.driver ?? ['Ana', 'Pérez'];
  const { rows } = await c.query<{
    outcome: string;
    hold_id: string | null;
    expires_at: Date | null;
  }>('SELECT * FROM core.booking_cmd_checkout($1, $2, $3, $4, $5, $6::jsonb)', [
    hash,
    quoteId,
    first,
    last,
    o.manual === undefined ? false : o.manual,
    documents === null ? null : JSON.stringify(documents),
  ]);
  return rows[0]!;
}

async function setClock(c: Tx, iso: string): Promise<void> {
  await c.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso]);
}

const at = (minutes: number): string => new Date(Date.parse(NOW) + minutes * MIN).toISOString();

async function consents(c: Tx, userId: string): Promise<Row[]> {
  return (await c.query<Row>('SELECT * FROM test_fixture.us208_consent_rows($1)', [userId])).rows;
}

async function holdsOf(c: Tx, quoteHolder: Person): Promise<number> {
  const { rows } = await c.query<{ n: number }>(
    `SELECT pg_catalog.count(*)::int AS n FROM core.booking_checkout_hold
      WHERE guest_user_id = $1`,
    [quoteHolder.id],
  );
  return rows[0]?.n ?? -1;
}

interface Ctx {
  readonly guest: Person;
  readonly groups: Map<string, string>;
  readonly listingId: string;
}

/** Corps du test dans une transaction annulée, sous app_api (L0-05 par withRole), pays ouvert. */
function scenario(cc: CountryCase) {
  return (
    fn: (tx: Tx, ctx: Ctx) => Promise<void>,
    opts: {
      open?: boolean;
      transmission?: 'MANUAL' | 'AUTOMATIC';
      instant?: boolean;
    } = {},
  ) =>
    withRole('app_api', (client) =>
      withTestTransaction(client, { virtualNow: NOW }, async (tx) => {
        if (opts.open !== false) {
          await openSwitch(tx, 'p2p_private_hosts_enabled', cc.country);
          await openSwitch(tx, 'insurer_contract_active', cc.country);
        }
        const v = VECTORS[cc.country]!;
        if (v.schedule !== null) {
          await tx.query('SELECT test_fixture.us704_set_trip_fee_schedule($1, $2::jsonb)', [
            cc.country,
            JSON.stringify(v.schedule),
          ]);
        }
        const guest = await person(tx, cc.country);
        const listingId = await listing(tx, cc, opts.transmission, opts.instant);
        const groups = await taxGroups(tx, cc);
        await fn(tx, { guest, groups, listingId });
      }),
    );
}

/** Devis figé du voyageur (doit réussir). */
async function frozenQuote(tx: Tx, cc: CountryCase, ctx: Ctx, d?: Docs): Promise<string> {
  const r = await freeze(tx, ctx.guest.hash, ctx.listingId, d ?? docs(cc, ctx.groups));
  if (r.outcome !== 'DONE' || r.quote_id === null) throw new Error(`gel : ${r.outcome}`);
  return r.quote_id;
}

describe.each(COUNTRIES.map((c) => [c.country, c] as const))(
  'US-208 checkout, partie back-end (%s)',
  (_name, cc) => {
    const run = scenario(cc);
    const v = VECTORS[cc.country]!;

    it('critère 1 / 4 : devis figé du checkout ⇒ somme des lignes = total de l’oracle, validité 30 min, documents à accepter ; checkout ⇒ hold ACTIVE rattaché au devis, aucun paiement', async () => {
      await run(async (tx, ctx) => {
        const quoteId = await frozenQuote(tx, cc, ctx);
        const q = (await tx.query<Row>('SELECT * FROM test_fixture.us202_quote_row($1)', [quoteId]))
          .rows[0]!;
        const lines = (
          await tx.query<Row>('SELECT * FROM test_fixture.us202_quote_lines($1)', [quoteId])
        ).rows;
        const sum = lines.reduce(
          (a, l) => a + Number(l['amount_minor']) + Number(l['tax_minor']),
          0,
        );
        expect(sum).toBe(v.total);
        expect(String(q['total_minor'])).toBe(String(v.total));
        expect(String(q['leg_host_minor'])).toBe(String(v.host));
        expect(String(q['leg_platform_minor'])).toBe(String(v.total - v.host));
        expect(new Date(q['expires_at'] as Date).toISOString()).toBe(at(VALIDITY_MIN));

        const shown = (await checkoutQuote(tx, ctx.guest.hash, quoteId))[0]!;
        expect(shown).toMatchObject({
          quote_id: quoteId,
          listing_id: ctx.listingId,
          country_code: cc.country,
          currency: cc.currency,
          billable_days: 3,
          expired: false,
          manual_transmission: false,
          instant_book: true,
        });
        expect(String(shown['total_minor'])).toBe(String(v.total));
        expect(new Date(shown['start_at'] as Date).getTime()).toBe(START);
        expect(new Date(shown['end_at'] as Date).getTime()).toBe(START + 3 * DAY);
        const documents = shown['documents'] as { kind: string; version: number }[];
        expect(documents.map((d) => d.kind).sort()).toEqual(KINDS);
        expect(documents.every((d) => d.version === 1)).toBe(true);

        const r = await checkout(tx, ctx.guest.hash, quoteId);
        expect(r.outcome).toBe('DONE');
        expect(r.hold_id).not.toBeNull();
        const summary = (
          await tx.query<Row>('SELECT * FROM core.booking_checkout_summary($1, $2)', [
            ctx.guest.hash,
            r.hold_id,
          ])
        ).rows[0]!;
        expect(summary).toMatchObject({
          status: 'ACTIVE',
          quote_id: quoteId,
          currency: cc.currency,
        });
        expect(String(summary['total_minor'])).toBe(String(v.total));
        // hold CHECKOUT, échéance = TTL initial (10 min, 08 BR-BOOK-10), aucune opération de paiement
        expect(new Date(r.expires_at as Date).toISOString()).toBe(at(10));
        const ops = await tx.query<{ n: number }>(
          `SELECT pg_catalog.count(*)::int AS n FROM core.payment_payment_operation WHERE hold_id = $1`,
          [r.hold_id],
        );
        expect(ops.rows[0]?.n).toBe(0);
        // le contexte de session posé pour la pose est rendu tel qu'il était
        const guc = await tx.query<{ k: string | null; a: string | null }>(
          `SELECT NULLIF(pg_catalog.current_setting('app.actor_kind', true), '') AS k,
                  NULLIF(pg_catalog.current_setting('app.actor_id', true), '') AS a`,
        );
        expect(guc.rows[0]).toEqual({ k: null, a: null });
      });
    });

    it('critère 1 : devis expiré à 30 min pile ⇒ QUOTE_EXPIRED, rien d’écrit ; à 29 min 59 s ⇒ réservé ; un nouveau devis repart', async () => {
      await run(async (tx, ctx) => {
        const quoteId = await frozenQuote(tx, cc, ctx);
        await setClock(tx, at(VALIDITY_MIN));
        expect((await checkout(tx, ctx.guest.hash, quoteId)).outcome).toBe('QUOTE_EXPIRED');
        expect((await checkoutQuote(tx, ctx.guest.hash, quoteId))[0]?.['expired']).toBe(true);
        expect(await holdsOf(tx, ctx.guest)).toBe(0);
        expect(await consents(tx, ctx.guest.id)).toEqual([]);
        // nouveau devis à l'instant présent : valable
        const again = await frozenQuote(
          tx,
          cc,
          ctx,
          docs(cc, ctx.groups, { quotedAtMs: Date.parse(at(VALIDITY_MIN)) }),
        );
        expect((await checkout(tx, ctx.guest.hash, again)).outcome).toBe('DONE');
      });
      await run(async (tx, ctx) => {
        const quoteId = await frozenQuote(tx, cc, ctx);
        await setClock(tx, new Date(Date.parse(at(VALIDITY_MIN)) - 1000).toISOString());
        expect((await checkout(tx, ctx.guest.hash, quoteId)).outcome).toBe('DONE');
      });
    });

    it('critère 2 : boîte manuelle sans la case ⇒ MANUAL_TRANSMISSION_NOT_CONFIRMED ; cochée ⇒ réservé et confirmation enregistrée', async () => {
      await run(
        async (tx, ctx) => {
          const quoteId = await frozenQuote(tx, cc, ctx);
          expect(
            (await checkoutQuote(tx, ctx.guest.hash, quoteId))[0]?.['manual_transmission'],
          ).toBe(true);
          for (const manual of [false, null]) {
            expect((await checkout(tx, ctx.guest.hash, quoteId, { manual })).outcome).toBe(
              'MANUAL_TRANSMISSION_NOT_CONFIRMED',
            );
          }
          expect(await holdsOf(tx, ctx.guest)).toBe(0);
          const r = await checkout(tx, ctx.guest.hash, quoteId, { manual: true });
          expect(r.outcome).toBe('DONE');
          const rows = (
            await tx.query<Row>('SELECT * FROM test_fixture.us208_checkout_rows($1)', [r.hold_id])
          ).rows;
          expect(rows[0]).toMatchObject({ quote_id: quoteId, manual_confirmed: true });
        },
        { transmission: 'MANUAL' },
      );
      // boîte automatique : la case n'est pas demandée
      await run(async (tx, ctx) => {
        const r = await checkout(tx, ctx.guest.hash, await frozenQuote(tx, cc, ctx));
        expect(r.outcome).toBe('DONE');
        const rows = (
          await tx.query<Row>('SELECT * FROM test_fixture.us208_checkout_rows($1)', [r.hold_id])
        ).rows;
        expect(rows[0]).toMatchObject({ manual_confirmed: false });
      });
    });

    it('critère 2 : nom du conducteur différent du nom légal du compte ⇒ DRIVER_MUST_BE_ACCOUNT_HOLDER ; même nom (casse, espaces) ⇒ réservé', async () => {
      await run(async (tx, ctx) => {
        const quoteId = await frozenQuote(tx, cc, ctx);
        for (const driver of [
          ['Beatriz', 'Pérez'],
          ['Ana', 'Gómez'],
          ['', ''],
          ['Ana', 'x'.repeat(101)],
        ] as const) {
          expect((await checkout(tx, ctx.guest.hash, quoteId, { driver })).outcome).toBe(
            'DRIVER_MUST_BE_ACCOUNT_HOLDER',
          );
        }
        expect(await holdsOf(tx, ctx.guest)).toBe(0);
        const r = await checkout(tx, ctx.guest.hash, quoteId, { driver: ['  ANA ', 'pérez  '] });
        expect(r.outcome).toBe('DONE');
      });
    });

    it('critère 3 : conditions non acceptées ⇒ TERMS_NOT_ACCEPTED, version périmée ⇒ TERMS_VERSION_CHANGED, rien d’écrit ; après réservation, la version exacte de chaque document est retrouvable', async () => {
      await run(async (tx, ctx) => {
        const quoteId = await frozenQuote(tx, cc, ctx);
        const shown = await shownVersions(tx, ctx.guest.hash, quoteId);
        const without = (kind: string) => shown.filter((d) => d.kind !== kind);
        for (const documents of [
          null,
          [],
          without('TOS_GUEST'),
          without('CANCELLATION_POLICY'),
          without('GEO_TERMS'),
          [...without('GEO_TERMS'), { kind: 'TOS_GUEST', version: 1 }],
          [...without('GEO_TERMS'), { kind: 'PRIVACY', version: 1 }],
          shown.map((d) => ({ kind: d.kind, version: String(d.version) })),
          { kind: 'TOS_GUEST', version: 1 },
        ]) {
          expect((await checkout(tx, ctx.guest.hash, quoteId, { documents })).outcome).toBe(
            'TERMS_NOT_ACCEPTED',
          );
        }
        // texte géographique propre au pays publié deux fois : la version 1 affichée est périmée
        await tx.query('SELECT test_fixture.us208_publish_document($1, $2)', [
          'GEO_TERMS',
          cc.country,
        ]);
        const v2 = await tx.query<{ v: number }>(
          'SELECT test_fixture.us208_publish_document($1, $2) AS v',
          ['GEO_TERMS', cc.country],
        );
        expect(v2.rows[0]?.v).toBe(2);
        expect((await checkout(tx, ctx.guest.hash, quoteId, { documents: shown })).outcome).toBe(
          'TERMS_VERSION_CHANGED',
        );
        expect(await holdsOf(tx, ctx.guest)).toBe(0);
        expect(await consents(tx, ctx.guest.id)).toEqual([]);

        const current = await shownVersions(tx, ctx.guest.hash, quoteId);
        expect(current.find((d) => d.kind === 'GEO_TERMS')?.version).toBe(2);
        const r = await checkout(tx, ctx.guest.hash, quoteId, { documents: current });
        expect(r.outcome).toBe('DONE');
        const rows = (
          await tx.query<Row>('SELECT * FROM test_fixture.us208_checkout_rows($1)', [r.hold_id])
        ).rows;
        expect(rows[0]).toMatchObject({
          quote_id: quoteId,
          guest_user_id: ctx.guest.id,
          country_code: cc.country,
        });
        const terms = rows[0]!['terms'] as Row[];
        expect(terms.map((t) => [t['kind'], t['version']])).toEqual([
          ['CANCELLATION_POLICY', 1],
          ['GEO_TERMS', 2],
          ['TOS_GUEST', 1],
        ]);
        for (const t of terms) {
          expect(t).toMatchObject({
            consentKind: t['kind'],
            consentVersion: t['version'],
            consentContext: 'CHECKOUT',
            consentUser: ctx.guest.id,
            sameTemplate: true,
          });
        }
        expect((await consents(tx, ctx.guest.id)).length).toBe(3);
        // le voyageur relit la même chose par le récapitulatif de son hold
        const summary = (
          await tx.query<Row>('SELECT * FROM core.booking_checkout_summary($1, $2)', [
            ctx.guest.hash,
            r.hold_id,
          ])
        ).rows[0]!;
        expect((summary['documents'] as Row[]).map((d) => [d['kind'], d['version']])).toEqual([
          ['CANCELLATION_POLICY', 1],
          ['GEO_TERMS', 2],
          ['TOS_GUEST', 1],
        ]);
      });
    });

    it('N-128 : annonce sur demande (instant_book = false) ⇒ REQUEST_MODE_UNAVAILABLE, jamais un hold INSTANT', async () => {
      await run(
        async (tx, ctx) => {
          const quoteId = await frozenQuote(tx, cc, ctx);
          expect((await checkoutQuote(tx, ctx.guest.hash, quoteId))[0]?.['instant_book']).toBe(
            false,
          );
          expect((await checkout(tx, ctx.guest.hash, quoteId)).outcome).toBe(
            'REQUEST_MODE_UNAVAILABLE',
          );
          expect(await holdsOf(tx, ctx.guest)).toBe(0);
        },
        { instant: false },
      );
    });

    it('N-129 : devis portant une ligne que la base ne rejoue pas (livraison) ⇒ QUOTE_LINE_NOT_SUPPORTED', async () => {
      await run(async (tx, ctx) => {
        const quoteId = await frozenQuote(tx, cc, ctx, docs(cc, ctx.groups, { delivery: true }));
        expect((await checkout(tx, ctx.guest.hash, quoteId)).outcome).toBe(
          'QUOTE_LINE_NOT_SUPPORTED',
        );
        expect(await holdsOf(tx, ctx.guest)).toBe(0);
      });
    });

    it('pays fermé aux hôtes particuliers ou sans contrat d’assureur ⇒ LISTING_UNAVAILABLE', async () => {
      await run(
        async (tx, ctx) => {
          const quoteId = await frozenQuote(tx, cc, ctx);
          expect((await checkout(tx, ctx.guest.hash, quoteId)).outcome).toBe('LISTING_UNAVAILABLE');
          expect(await holdsOf(tx, ctx.guest)).toBe(0);
        },
        { open: false },
      );
    });

    it('IDOR et réemploi : devis d’un autre voyageur ⇒ QUOTE_NOT_FOUND, rien rendu ; devis déjà engagé ⇒ QUOTE_ALREADY_USED ; sans session ⇒ AUTH_REQUIRED', async () => {
      await run(async (tx, ctx) => {
        const quoteId = await frozenQuote(tx, cc, ctx);
        const other = await person(tx, cc.country, 'Luis', 'Díaz');
        expect((await checkout(tx, other.hash, quoteId, { documents: [] })).outcome).toBe(
          'QUOTE_NOT_FOUND',
        );
        expect(await checkoutQuote(tx, other.hash, quoteId)).toEqual([]);
        expect((await checkout(tx, randomBytes(32), quoteId, { documents: [] })).outcome).toBe(
          'AUTH_REQUIRED',
        );
        const r = await checkout(tx, ctx.guest.hash, quoteId);
        expect(r.outcome).toBe('DONE');
        expect(
          (
            await tx.query<Row>('SELECT * FROM core.booking_checkout_summary($1, $2)', [
              other.hash,
              r.hold_id,
            ])
          ).rows,
        ).toEqual([]);
        expect((await checkout(tx, ctx.guest.hash, quoteId)).outcome).toBe('QUOTE_ALREADY_USED');
      });
    });

    it('créneau pris par un autre voyageur ⇒ DATES_UNAVAILABLE (exclusion GiST), ses consentements annulés avec la pose', async () => {
      await run(async (tx, ctx) => {
        const first = await checkout(tx, ctx.guest.hash, await frozenQuote(tx, cc, ctx));
        expect(first.outcome).toBe('DONE');
        const other = await person(tx, cc.country);
        const quoteId = await frozenQuote(tx, cc, { ...ctx, guest: other });
        expect((await checkout(tx, other.hash, quoteId)).outcome).toBe('DATES_UNAVAILABLE');
        expect(await holdsOf(tx, other)).toBe(0);
        expect(await consents(tx, other.id)).toEqual([]);
      });
    });

    it('N-130 : gel au-delà de quote_freezes_per_guest_hour ⇒ QUOTE_RATE_LIMITED ; document de plus de 64 Kio ⇒ QUOTE_MISMATCH ; paramètre absent ⇒ QUOTE_UNAVAILABLE', async () => {
      await run(async (tx, ctx) => {
        await tx.query('SELECT test_fixture.us208_set_param($1, $2, $3::jsonb)', [
          'quote_freezes_per_guest_hour',
          cc.country,
          '1',
        ]);
        await frozenQuote(tx, cc, ctx);
        const second = await freeze(tx, ctx.guest.hash, ctx.listingId, docs(cc, ctx.groups));
        expect(second).toEqual({ outcome: 'QUOTE_RATE_LIMITED', quote_id: null });
        // un autre voyageur n'est pas compté
        const other = await person(tx, cc.country);
        expect((await freeze(tx, other.hash, ctx.listingId, docs(cc, ctx.groups))).outcome).toBe(
          'DONE',
        );
      });
      await run(async (tx, ctx) => {
        const d = docs(cc, ctx.groups);
        const big = d.inputs.replace('"params":{', `"pad":"${'x'.repeat(65_536)}","params":{`);
        const r = await freeze(tx, ctx.guest.hash, ctx.listingId, {
          ...d,
          inputs: big,
          inputsHash: sha('rueda.quote.inputs/1\n', big),
        });
        expect(r.outcome).toBe('QUOTE_MISMATCH');
        for (const key of ['quote_validity_minutes', 'quote_freezes_per_guest_hour']) {
          await tx.query('SELECT test_fixture.us208_close_param($1, $2)', [key, cc.country]);
          expect((await freeze(tx, ctx.guest.hash, ctx.listingId, d)).outcome).toBe(
            'QUOTE_UNAVAILABLE',
          );
          await tx.query('SELECT test_fixture.us208_set_param($1, $2, $3::jsonb)', [
            key,
            cc.country,
            '30',
          ]);
        }
        expect((await freeze(tx, ctx.guest.hash, ctx.listingId, d)).outcome).toBe('DONE');
      });
    });

    it('registres immuables pour tout rôle ; app_api ne lit ni n’écrit les tables du checkout ni les aides d’IAM et de CTR', async () => {
      await run(async (tx, ctx) => {
        const r = await checkout(tx, ctx.guest.hash, await frozenQuote(tx, cc, ctx));
        expect(r.outcome).toBe('DONE');
        for (const kind of ['acceptance', 'terms', 'delete', 'truncate']) {
          const w = await tx.query<{ r: string }>(
            'SELECT test_fixture.us208_try_write($1, $2) AS r',
            [r.hold_id, kind],
          );
          expect(w.rows[0]?.r, kind).toBe('23000:booking_checkout_immutable');
        }
        expect(
          translateDbError({ code: '23000', constraint: 'booking_checkout_immutable' }).code,
        ).toBe('IMMUTABLE_RECORD');
      });
      for (const sql of [
        'SELECT * FROM core.booking_checkout_acceptance',
        'SELECT * FROM core.booking_checkout_terms',
        `INSERT INTO core.booking_checkout_terms (hold_id, doc_kind, template_id, doc_version, locale, consent_id)
         VALUES ($1, 'GEO_TERMS', $1, 1, 'es', $1)`,
        `SELECT core.iam_holder_name_matches($1, 'Ana', 'Pérez')`,
        `SELECT * FROM core.ctr_checkout_terms($1, 'ZZ', NULL)`,
      ]) {
        await withRole('app_api', async (client) => {
          await expect(
            client.query(sql, sql.includes('$1') ? [uuid()] : []),
            sql,
          ).rejects.toMatchObject({ code: '42501' });
        });
      }
    });
  },
);
