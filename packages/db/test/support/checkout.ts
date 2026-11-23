/**
 * Aides des preuves du checkout (US-208 / US-209) : personnes et sessions par les VRAIES commandes,
 * annonce LISTED de la fixture 9998, devis figé par la VRAIE commande de gel, checkout par la
 * VRAIE commande `core.booking_cmd_checkout`. Interrupteurs ouverts par la procédure à deux
 * personnes d'US-125, dans la transaction ANNULÉE de l'appelant.
 *
 * Les vecteurs (attendus de 16 et des oracles, jamais du code testé) sont fournis par le test
 * appelant, seul autorisé à nommer un pays (exemptions de rueda/no-country-constants).
 */
import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { uuid } from './avl.ts';
import type { CountryCase } from './avl.ts';
import { approveSwitch, freshSession, requestSwitch } from './golive.ts';
import type { StaffActor } from './golive.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from './iam.ts';
import { staff as rlsStaff, staffSessionHash } from './rls.ts';
import { signedOpenParams } from '../../src/testing/index.ts';

type Tx = pg.ClientBase;

const SIGNUP_DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
export const DAY_MS = 86_400_000;

export interface CheckoutVector {
  readonly daily: number;
  /** Barème de test du trip fee (`null` : barème du pays). */
  readonly schedule: object | null;
  readonly fee: number;
  readonly taxes: Readonly<Record<string, number>>;
  readonly host: number;
  /** Total avec la protection BASICA (US-226). */
  readonly total: number;
  /** Protection BASICA (US-226) : part de la grille de TEST, ligne et prime due à l'assureur. */
  readonly basicaPrice: string;
  readonly protection: number;
  readonly insurer: number;
}

const sha = (prefix: string, text: string): string =>
  createHash('sha256')
    .update(prefix + text, 'utf8')
    .digest('hex');

export interface QuoteDocs {
  readonly inputs: string;
  readonly inputsHash: string;
  readonly outputs: string;
  readonly outputsHash: string;
}

/** Documents canoniques d'un devis de 3 jours (forme de frozen.ts), sorties tirées des vecteurs. */
export function quoteDocs(
  c: CountryCase,
  v: CheckoutVector,
  groups: ReadonlyMap<string, string>,
  startMs: number,
  quotedAtMs: number,
  /** `false` : devis `prc.quote/2` sans protection (figé, jamais réservé depuis US-226). */
  withProtection = true,
): QuoteDocs {
  const amounts: Record<string, number> = {
    TRIP_PRICE: v.daily * 3,
    TRIP_FEE: v.fee,
    PROTECTION: withProtection ? v.protection : 0,
  };
  const insurer = withProtection ? v.insurer : 0;
  const lines = ['TRIP_PRICE', 'TRIP_FEE', 'PROTECTION']
    .filter((t) => (amounts[t] ?? 0) !== 0)
    .map((t) => ({
      type: t,
      amount: String(amounts[t]),
      taxGroup: groups.get(t) ?? null,
      tax: String(v.taxes[t] ?? 0),
    }));
  const subtotal = Object.values(amounts).reduce((a, x) => a + x, 0);
  const tax = Object.values(v.taxes).reduce((a, x) => a + x, 0);
  const total = subtotal + tax;
  const outputs = JSON.stringify({
    engineVersion: withProtection ? 'prc.quote/3' : 'prc.quote/2',
    currency: c.currency,
    billableDays: 3,
    lines,
    taxGroups: [],
    subtotal: String(subtotal),
    taxTotal: String(tax),
    taxThirdParty: '0',
    total: String(total),
    legs: {
      HOST: String(v.host),
      INSURER: String(insurer),
      TAX_THIRD_PARTY: '0',
      PLATFORM: String(total - v.host - insurer),
    },
    hostSharePct: '3/4',
    ...(withProtection
      ? { protectionLevel: 'BASICA', insurerPremiumShare: '7/10', hostPlan: 'ESTÁNDAR' }
      : {}),
  });
  const inputs = JSON.stringify({
    request: {
      startAtMs: startMs,
      endAtMs: startMs + 3 * DAY_MS,
      quotedAtMs,
      rateType: 'REFUNDABLE',
      dailyRate: String(v.daily),
      lines: {},
      ...(withProtection ? { protectionLevel: 'BASICA', driverAge: null } : {}),
    },
    params: { currency: { code: c.currency } },
  });
  return {
    inputs,
    inputsHash: sha('rueda.quote.inputs/1\n', inputs),
    outputs,
    outputsHash: sha('rueda.quote.outputs/1\n', outputs),
  };
}

export interface Person {
  readonly id: string;
  readonly hash: Buffer;
}

/** Personne inscrite par la vraie commande (compte ACTIVE) et sa session. */
export async function checkoutPerson(
  c: Tx,
  country: string,
  first = 'Ana',
  last = 'Pérez',
): Promise<Person> {
  const id = uuid();
  const r = await c.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, $4, $5, 'es', $6, $7, 86400, NULL,
                                                $8, $9::jsonb, false) AS ok`,
    [
      id,
      `s209-${id}@example.test`,
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
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest', $5, $6) AS expires_at`,
    await signedOpenParams(c, [uuid(), id, t.hash, SESSION_TTL_S]),
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  return { id, hash: t.hash };
}

export interface Driver {
  /** Date de naissance vérifiée ; `null` : inconnue du fournisseur et du compte. */
  readonly birth: string | null;
  readonly licenseExpiry: string;
  /** Pays de délivrance du permis (ISO) ; défaut : le pays du dossier. */
  readonly licenseCountry?: string;
}

/** Dossier d'identité approuvé (fixture 9967, forme écrite par la décision du fournisseur). */
export async function approveDriver(c: Tx, p: Person, country: string, d: Driver): Promise<void> {
  await c.query('SELECT test_fixture.us209_driver($1, $2, $3::date, $4::date, $5)', [
    p.id,
    country,
    d.birth,
    d.licenseExpiry,
    d.licenseCountry ?? country,
  ]);
}

/** Interrupteur ouvert par la procédure à deux personnes d'US-125, dans la transaction annulée. */
export async function openSwitch(
  c: Tx,
  key: 'p2p_private_hosts_enabled' | 'insurer_contract_active',
  country: string,
): Promise<void> {
  await setSwitch(c, key, country, true);
}

/** Interrupteur posé par la procédure à deux personnes d'US-125, dans la transaction annulée. */
export async function setSwitch(
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

/** Annonce LISTED immédiate (fixture 9998) ; rend l'annonce et le véhicule. */
export async function listedListing(
  c: Tx,
  cc: CountryCase,
  dailyPriceMinor: number,
  transmission: 'MANUAL' | 'AUTOMATIC' = 'AUTOMATIC',
): Promise<{ listingId: string; vehicleId: string }> {
  const { rows } = await c.query<{ listing_id: string; vehicle_id: string }>(
    'SELECT * FROM test_fixture.us208_listed_listing($1, $2, $3, $4)',
    [cc.country, dailyPriceMinor, transmission, true],
  );
  if (!rows[0]) throw new Error('annonce de fixture');
  return { listingId: rows[0].listing_id, vehicleId: rows[0].vehicle_id };
}

/** Groupe fiscal de chaque type de ligne taxable, en vigueur (lecture app_api de 0008). */
export async function taxGroups(c: Tx, cc: CountryCase): Promise<Map<string, string>> {
  const { rows } = await c.query<{ line_type: string; rate_group: string | null }>(
    `SELECT DISTINCT ON (line_type) line_type, rate_group FROM core.pricing_tax_line_config
      WHERE country_code = $1 ORDER BY line_type, version DESC`,
    [cc.country],
  );
  return new Map(
    rows.filter((r) => r.rate_group !== null).map((r) => [r.line_type, r.rate_group!]),
  );
}

/** Devis figé par la vraie commande (doit réussir). */
export async function frozenQuote(
  c: Tx,
  p: Person,
  listingId: string,
  d: QuoteDocs,
): Promise<string> {
  const { rows } = await c.query<{ outcome: string; quote_id: string | null }>(
    'SELECT * FROM core.pricing_cmd_freeze_quote($1, $2, $3, $4, $5, $6)',
    [p.hash, listingId, d.inputs, d.inputsHash, d.outputs, d.outputsHash],
  );
  const r = rows[0];
  if (r?.outcome !== 'DONE' || !r.quote_id) throw new Error(`gel : ${r?.outcome}`);
  return r.quote_id;
}

export interface CheckoutOutcome {
  readonly outcome: string;
  readonly hold_id: string | null;
  readonly expires_at: Date | null;
}

/** Checkout du devis : conducteur titulaire, versions affichées acceptées telles quelles. */
export async function checkoutQuote(
  c: Tx,
  p: Person,
  quoteId: string,
  driver: readonly [string, string] = ['Ana', 'Pérez'],
): Promise<CheckoutOutcome> {
  const shown = await c.query<{ documents: { kind: string; version: number }[] | null }>(
    'SELECT documents FROM core.booking_checkout_quote($1, $2)',
    [p.hash, quoteId],
  );
  const documents = (shown.rows[0]?.documents ?? []).map((d) => ({
    kind: d.kind,
    version: d.version,
  }));
  const { rows } = await c.query<CheckoutOutcome>(
    'SELECT * FROM core.booking_cmd_checkout($1, $2, $3, $4, $5, $6::jsonb)',
    [p.hash, quoteId, driver[0], driver[1], false, JSON.stringify(documents)],
  );
  return rows[0]!;
}

/** Grille de protection et parts de l'assureur de TEST (fixture 9977, US-226), dans la transaction. */
export async function protectionParams(c: Tx, country: string, v: CheckoutVector): Promise<void> {
  const level = (rank: number, price: string, minDriverAge: number | null) => ({
    rank,
    price,
    minDriverAge,
    dailyFloorMinor: null,
    dailyCeilingMinor: null,
  });
  await c.query('SELECT test_fixture.us226_set_param($1, $2, $3::jsonb)', [
    'protection_grid',
    country,
    JSON.stringify({
      BASICA: level(1, v.basicaPrice, null),
      ESTANDAR: level(2, '2/5', null),
      TOTAL: level(3, '13/20', 21),
    }),
  ]);
  await c.query('SELECT test_fixture.us226_set_param($1, $2, $3::jsonb)', [
    'insurer_premium_share',
    country,
    JSON.stringify({ BASICA: '7/10', ESTANDAR: '7/10', TOTAL: '7/10' }),
  ]);
}

export async function setClock(c: Tx, iso: string): Promise<void> {
  await c.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso]);
}

/** Erreur d'une instruction, sans abandonner la transaction (point de sauvegarde). */
export async function failure(
  c: Tx,
  text: string,
  values: readonly unknown[],
): Promise<{ code: string | undefined; constraint: string | undefined } | null> {
  await c.query('SAVEPOINT us_check');
  try {
    await c.query(text, values as unknown[]);
    await c.query('RELEASE SAVEPOINT us_check');
    return null;
  } catch (error) {
    await c.query('ROLLBACK TO SAVEPOINT us_check');
    const e = error as { code?: string; constraint?: string };
    return { code: e.code, constraint: e.constraint };
  }
}
