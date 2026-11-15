/**
 * Devis figé et rejeu (US-202 critère 4 ; 16 PRC-025 « rejouable », NFR-17 ; 17 §2.6 `inputs_hash`).
 *
 * Un devis figé conserve ses **entrées** (demande) et l'**instantané des paramètres** du pays, sous
 * forme canonique (`canonicalJson` de `@rueda/money`, clés triées, montants en texte), avec leur
 * empreinte SHA-256, et ses **sorties** (lignes, taxes, total, jambes). Le rejeu recalcule le devis
 * à partir des seules entrées figées — jamais de la configuration du moment : un taux, une
 * tolérance ou un plan de l'hôte modifiés après la réservation ne changent pas un devis figé — et
 * exige des sorties identiques à l'unité mineure, sinon `QUOTE_REPLAY_MISMATCH`.
 */
import { createHash } from 'node:crypto';
import {
  canonicalJson,
  createCurrencyRegistry,
  money,
  parseRatio,
  ratioToString,
  type Currency,
  type Money,
  type Ratio,
  type RateType,
} from '@rueda/money';
import {
  QUOTE_LINE_TYPES,
  computeQuote,
  type Quote,
  type QuoteLineType,
  type QuoteParams,
  type QuoteRequest,
  type QuoteTaxRule,
  type TripFeeTier,
} from './engine.js';
import { QuoteError } from './errors.js';

/** Format de l'enregistrement figé (une évolution de la forme = nouveau format). */
export const FROZEN_QUOTE_FORMAT = 'prc.quote.frozen/1';
/** Préfixe de domaine des empreintes (distinct de celui du règlement). */
export const QUOTE_INPUTS_HASH_PREFIX = 'rueda.quote.inputs/1\n';
export const QUOTE_OUTPUTS_HASH_PREFIX = 'rueda.quote.outputs/1\n';

type Json = string | number | boolean | null | readonly Json[] | { readonly [k: string]: Json };

export interface FrozenQuote {
  readonly format: string;
  readonly engineVersion: string;
  /** Entrées canoniques : `{ request, params }`, montants en unités mineures (texte). */
  readonly inputs: string;
  readonly inputsHash: string;
  /** Sorties canoniques : lignes, groupes, total, jambes. */
  readonly outputs: string;
  readonly outputsHash: string;
  /** Total TTC (texte, unités mineures) et devise, lisibles sans analyser `outputs`. */
  readonly totalMinor: string;
  readonly currency: string;
}

const sha256 = (prefix: string, text: string): string =>
  createHash('sha256')
    .update(prefix + text, 'utf8')
    .digest('hex');

const minor = (m: Money): string => m.amountMinor.toString();
const ratioJson = (r: Ratio | undefined): string | null =>
  r === undefined ? null : ratioToString(r);

function requestJson(r: QuoteRequest): Json {
  const lines: Record<string, Json> = {};
  for (const [type, amount] of Object.entries(r.lines ?? {})) {
    if (amount !== undefined) lines[type] = minor(amount);
  }
  return {
    startAtMs: r.startAtMs,
    endAtMs: r.endAtMs,
    quotedAtMs: r.quotedAtMs,
    rateType: r.rateType,
    dailyRate: minor(r.dailyRate),
    lines,
  };
}

function paramsJson(p: QuoteParams): Json {
  return {
    currency: { code: p.currency.code, exponent: p.currency.exponent },
    graceMinutes: p.graceMinutes,
    maxTripDays: p.maxTripDays,
    tripFeeSchedule: {
      tiers: p.tripFeeSchedule.tiers.map((t) => ({
        maxDays: t.maxDays,
        rate: ratioToString(t.rate),
      })),
      min: minor(p.tripFeeSchedule.min),
    },
    taxRules: p.taxRules.map((t) => ({
      lineType: t.lineType,
      taxable: t.taxable,
      group: t.group,
      rate: t.rate === null ? null : ratioToString(t.rate),
      thirdParty: t.thirdParty,
    })),
    hostSharePct: ratioToString(p.hostSharePct),
    deliverySharePct: ratioToString(p.deliverySharePct),
    extrasSharePct: ratioToString(p.extrasSharePct),
    insurerPremiumShare: ratioJson(p.insurerPremiumShare),
    insurerRoadsideShare: ratioJson(p.insurerRoadsideShare),
  };
}

/** Sorties canoniques d'un devis (ce qui est payé, taxé et réparti). */
export function quoteOutputsJson(q: Quote): Json {
  return {
    engineVersion: q.engineVersion,
    currency: q.currency.code,
    billableDays: q.billableDays,
    lines: q.lines.map((l) => ({
      type: l.type,
      amount: minor(l.amount),
      taxGroup: l.taxGroup,
      tax: minor(l.tax),
    })),
    taxGroups: q.taxGroups.map((g) => ({
      id: g.id,
      rate: ratioToString(g.rate),
      lineTypes: [...g.lineTypes],
      tax: minor(g.tax),
      thirdParty: g.thirdParty,
    })),
    subtotal: minor(q.subtotal),
    taxTotal: minor(q.taxTotal),
    taxThirdParty: minor(q.taxThirdParty),
    total: minor(q.total),
    legs: {
      HOST: minor(q.legs.HOST),
      INSURER: minor(q.legs.INSURER),
      TAX_THIRD_PARTY: minor(q.legs.TAX_THIRD_PARTY),
      PLATFORM: minor(q.legs.PLATFORM),
    },
    hostSharePct: ratioToString(q.hostSharePct),
  };
}

/** Calcule le devis et le fige (entrées, instantané des paramètres, sorties, empreintes). */
export function freezeQuote(
  request: QuoteRequest,
  params: QuoteParams,
): { readonly quote: Quote; readonly frozen: FrozenQuote } {
  const quote = computeQuote(request, params);
  const inputs = canonicalJson({ request: requestJson(request), params: paramsJson(params) });
  const outputs = canonicalJson(quoteOutputsJson(quote));
  return {
    quote,
    frozen: Object.freeze({
      format: FROZEN_QUOTE_FORMAT,
      engineVersion: quote.engineVersion,
      inputs,
      inputsHash: sha256(QUOTE_INPUTS_HASH_PREFIX, inputs),
      outputs,
      outputsHash: sha256(QUOTE_OUTPUTS_HASH_PREFIX, outputs),
      totalMinor: minor(quote.total),
      currency: quote.currency.code,
    }),
  };
}

// ------------------------------------------------------------------ relecture des entrées figées

function mismatch(message: string, cause?: unknown): QuoteError {
  return new QuoteError(
    'QUOTE_REPLAY_MISMATCH',
    message,
    cause === undefined ? undefined : { cause },
  );
}

function obj(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw mismatch(`${path} : objet attendu`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') throw mismatch(`${path} : texte attendu`);
  return value;
}

function int(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw mismatch(`${path} : entier attendu`);
  }
  return value;
}

function amount(value: unknown, path: string, c: Currency): Money {
  const t = text(value, path);
  if (!/^-?(0|[1-9][0-9]*)$/.test(t)) throw mismatch(`${path} : entier en texte attendu`);
  return money(BigInt(t), c);
}

function optionalRatio(value: unknown, path: string): Ratio | undefined {
  return value === null ? undefined : parseRatio(text(value, path));
}

function readInputs(inputs: string): { request: QuoteRequest; params: QuoteParams } {
  let raw: unknown;
  try {
    raw = JSON.parse(inputs);
  } catch (cause) {
    throw mismatch('entrées figées illisibles', cause);
  }
  const root = obj(raw, 'inputs');
  const p = obj(root['params'], 'params');
  const cur = obj(p['currency'], 'params.currency');
  const currency = createCurrencyRegistry([
    {
      code: text(cur['code'], 'currency.code'),
      exponent: int(cur['exponent'], 'currency.exponent'),
    },
  ]).get(text(cur['code'], 'currency.code'));
  const rules = p['taxRules'];
  if (!Array.isArray(rules)) throw mismatch('params.taxRules : liste attendue');
  const taxRules: QuoteTaxRule[] = rules.map((r: unknown, i) => {
    const o = obj(r, `taxRules[${i}]`);
    const rate = o['rate'] === null ? null : parseRatio(text(o['rate'], `taxRules[${i}].rate`));
    const group = o['group'] === null ? null : text(o['group'], `taxRules[${i}].group`);
    return {
      lineType: text(o['lineType'], `taxRules[${i}].lineType`) as QuoteLineType,
      taxable: o['taxable'] === true,
      group,
      rate,
      thirdParty: o['thirdParty'] === true,
    };
  });
  const fee = obj(p['tripFeeSchedule'], 'params.tripFeeSchedule');
  const feeTiers = fee['tiers'];
  if (!Array.isArray(feeTiers)) throw mismatch('tripFeeSchedule.tiers : liste attendue');
  const tiers: TripFeeTier[] = feeTiers.map((t: unknown, i) => {
    const o = obj(t, `tripFeeSchedule.tiers[${i}]`);
    return {
      maxDays: o['maxDays'] === null ? null : int(o['maxDays'], `tripFeeSchedule.tiers[${i}].maxDays`),
      rate: parseRatio(text(o['rate'], `tripFeeSchedule.tiers[${i}].rate`)),
    };
  });
  const premium = optionalRatio(p['insurerPremiumShare'], 'insurerPremiumShare');
  const roadside = optionalRatio(p['insurerRoadsideShare'], 'insurerRoadsideShare');
  const params: QuoteParams = {
    currency,
    graceMinutes: int(p['graceMinutes'], 'graceMinutes'),
    maxTripDays: int(p['maxTripDays'], 'maxTripDays'),
    tripFeeSchedule: { tiers, min: amount(fee['min'], 'tripFeeSchedule.min', currency) },
    taxRules,
    hostSharePct: parseRatio(text(p['hostSharePct'], 'hostSharePct')),
    deliverySharePct: parseRatio(text(p['deliverySharePct'], 'deliverySharePct')),
    extrasSharePct: parseRatio(text(p['extrasSharePct'], 'extrasSharePct')),
    ...(premium === undefined ? {} : { insurerPremiumShare: premium }),
    ...(roadside === undefined ? {} : { insurerRoadsideShare: roadside }),
  };

  const r = obj(root['request'], 'request');
  const rawLines = obj(r['lines'], 'request.lines');
  const lines: Partial<Record<QuoteLineType, Money>> = {};
  for (const [type, value] of Object.entries(rawLines)) {
    if (!QUOTE_LINE_TYPES.includes(type as QuoteLineType)) throw mismatch(`ligne inconnue ${type}`);
    lines[type as QuoteLineType] = amount(value, `request.lines.${type}`, currency);
  }
  const request: QuoteRequest = {
    startAtMs: int(r['startAtMs'], 'startAtMs'),
    endAtMs: int(r['endAtMs'], 'endAtMs'),
    quotedAtMs: int(r['quotedAtMs'], 'quotedAtMs'),
    rateType: text(r['rateType'], 'rateType') as RateType,
    dailyRate: amount(r['dailyRate'], 'dailyRate', currency),
    lines,
  };
  return { request, params };
}

/**
 * Rejoue un devis figé à partir de ses seules entrées et exige des sorties identiques à l'unité
 * mineure (16 PRC-025). Empreinte altérée, format ou version inconnus, sorties différentes ⇒
 * `QUOTE_REPLAY_MISMATCH`. Renvoie le devis recalculé.
 */
export function replayFrozenQuote(frozen: FrozenQuote): Quote {
  if (frozen.format !== FROZEN_QUOTE_FORMAT) throw mismatch(`format inconnu « ${frozen.format} »`);
  if (sha256(QUOTE_INPUTS_HASH_PREFIX, frozen.inputs) !== frozen.inputsHash) {
    throw mismatch('empreinte des entrées différente');
  }
  if (sha256(QUOTE_OUTPUTS_HASH_PREFIX, frozen.outputs) !== frozen.outputsHash) {
    throw mismatch('empreinte des sorties différente');
  }
  let parsed: { request: QuoteRequest; params: QuoteParams };
  try {
    parsed = readInputs(frozen.inputs);
  } catch (cause) {
    if (cause instanceof QuoteError) throw cause;
    throw mismatch('entrées figées invalides', cause);
  }
  let quote: Quote;
  try {
    quote = computeQuote(parsed.request, parsed.params);
  } catch (cause) {
    // un devis figé qui ne se recalcule plus est un échec du rejeu, quelle qu'en soit la cause
    throw mismatch('recalcul impossible depuis les entrées figées', cause);
  }
  if (quote.engineVersion !== frozen.engineVersion) {
    throw mismatch(`moteur ${quote.engineVersion} ≠ moteur figé ${frozen.engineVersion}`);
  }
  if (canonicalJson(quoteOutputsJson(quote)) !== frozen.outputs) {
    throw mismatch('sorties recalculées différentes des sorties figées');
  }
  if (minor(quote.total) !== frozen.totalMinor || quote.currency.code !== frozen.currency) {
    throw mismatch('total ou devise différents');
  }
  return quote;
}
