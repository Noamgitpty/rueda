/**
 * Type monétaire unique `Money{amountMinor: bigint, currency}` (08 BR-PRICE-14 (1), 17 §1.2, ADR-009).
 *
 * Règles appliquées :
 * - montant entier en unités mineures, `bigint` ; jamais de `number` (un `number` n'entre que par
 *   `moneyFromSafeInteger`, et seulement s'il est un entier sûr) ;
 * - montant signé : une ligne de devis promo est négative (08 BR-PRICE-16, 17 §3.1.5), le net
 *   plateforme d'un règlement peut l'être (17 §3.2) ; un montant d'écriture, lui, est strictement
 *   positif (08 E4) : `requirePositive` le vérifie ;
 * - montant borné à l'intervalle de la colonne PostgreSQL `bigint` (int64) : hors bornes, refus
 *   `MONEY_OUT_OF_RANGE`, jamais de troncature ;
 * - aucune opération entre devises différentes (`MONEY_CURRENCY_MISMATCH`, 16 PRC-021) ; aucune
 *   conversion (08 BR-PRICE-14 (5)).
 */
import { assertCurrency, type Currency } from './currency.ts';
import { MoneyError } from './errors.ts';
import { assertRatio, ratio, type Ratio } from './ratio.ts';
import { floorDiv, roundHalfUp } from './rounding.ts';

declare const moneyBrand: unique symbol;

/** Montant exact. Construit uniquement par les fonctions de ce module. */
export interface Money {
  /** Montant en unités mineures (USD : cents ; PYG : guaraníes). */
  readonly amountMinor: bigint;
  /** Code ISO 4217 de la devise (devise configurée). */
  readonly currency: string;
  readonly [moneyBrand]: true;
}

/** Bornes de la colonne PostgreSQL `bigint` (17 §3.1.5 : `<nom>_minor bigint`). */
export const MIN_AMOUNT_MINOR = -(2n ** 63n);
export const MAX_AMOUNT_MINOR = 2n ** 63n - 1n;

const MONEY_OBJECTS = new WeakSet<object>();

function make(amountMinor: bigint, currency: string): Money {
  if (amountMinor < MIN_AMOUNT_MINOR || amountMinor > MAX_AMOUNT_MINOR) {
    throw new MoneyError(
      'MONEY_OUT_OF_RANGE',
      `montant hors de l'intervalle int64 : ${amountMinor} ${currency}`,
    );
  }
  const value = Object.freeze({ amountMinor, currency }) as Money;
  MONEY_OBJECTS.add(value);
  return value;
}

/** Vrai si `value` est un `Money` construit par ce module. */
export function isMoney(value: unknown): value is Money {
  return typeof value === 'object' && value !== null && MONEY_OBJECTS.has(value);
}

function assertMoney(value: unknown): asserts value is Money {
  if (!isMoney(value)) {
    throw new MoneyError('MONEY_INVALID_AMOUNT', 'Money attendu (construit par @rueda/money)');
  }
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(
      'MONEY_CURRENCY_MISMATCH',
      `devises différentes : ${a.currency} et ${b.currency}`,
    );
  }
}

function assertCurrencyOf(value: Money, currency: Currency): void {
  if (value.currency !== currency.code) {
    throw new MoneyError(
      'MONEY_CURRENCY_MISMATCH',
      `devises différentes : ${value.currency} et ${currency.code}`,
    );
  }
}

// ---------------------------------------------------------------- construction

/** Montant à partir d'un `bigint` d'unités mineures. Un `number` est refusé (`MONEY_INVALID_AMOUNT`). */
export function money(amountMinor: bigint, currency: Currency): Money {
  assertCurrency(currency);
  if (typeof amountMinor !== 'bigint') {
    throw new MoneyError('MONEY_INVALID_AMOUNT', 'montant en unités mineures : bigint attendu');
  }
  return make(amountMinor, currency.code);
}

/**
 * Seul point d'entrée d'un `number` : un entier sûr (`Number.isSafeInteger`) d'unités mineures.
 * Tout autre `number` (décimal, NaN, infini, au-delà de 2^53 − 1) est refusé (`MONEY_INVALID_AMOUNT`).
 */
export function moneyFromSafeInteger(amountMinor: number, currency: Currency): Money {
  assertCurrency(currency);
  if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor)) {
    throw new MoneyError(
      'MONEY_INVALID_AMOUNT',
      `entier sûr attendu en unités mineures : ${String(amountMinor)}`,
    );
  }
  return make(BigInt(amountMinor), currency.code);
}

const MINOR_TEXT = /^(?:0|-?[1-9][0-9]*)$/;

/**
 * Lit un montant en unités mineures depuis une chaîne d'entier : forme du pilote PostgreSQL pour
 * `bigint` et de l'API (17 §1.2 : `"25666"`). Chemin pilote → chaîne → `bigint`, sans `number`.
 */
export function parseMinor(text: string, currency: Currency): Money {
  assertCurrency(currency);
  if (typeof text !== 'string' || !MINOR_TEXT.test(text)) {
    throw new MoneyError('MONEY_INVALID_AMOUNT', `entier attendu : ${String(text)}`);
  }
  return make(BigInt(text), currency.code);
}

const MAJOR_TEXT = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

/**
 * Lit un montant en unités majeures (`"45.01"` USD, `"1000002"` PYG), avec l'exposant configuré.
 * Refuse (`MONEY_INVALID_AMOUNT`) plus de décimales que l'exposant : jamais d'arrondi implicite.
 * Le point est le seul séparateur décimal ; le formatage localisé relève de l'affichage (I18N-004).
 */
export function parseMajor(text: string, currency: Currency): Money {
  assertCurrency(currency);
  const match = typeof text === 'string' ? MAJOR_TEXT.exec(text) : null;
  if (match === null) {
    throw new MoneyError('MONEY_INVALID_AMOUNT', `montant illisible : ${String(text)}`);
  }
  const [, sign, integer, digits = ''] = match as unknown as [string, string, string, string?];
  if (digits.length > currency.exponent) {
    throw new MoneyError(
      'MONEY_INVALID_AMOUNT',
      `${currency.code} admet ${currency.exponent} décimale(s) : ${text}`,
    );
  }
  const fraction = digits.padEnd(currency.exponent, '0');
  return make(BigInt(sign + integer + fraction), currency.code);
}

/** Zéro dans la devise. */
export function zero(currency: Currency): Money {
  assertCurrency(currency);
  return make(0n, currency.code);
}

// ---------------------------------------------------------------- sérialisation

/** Chaîne d'entier en unités mineures (API, 17 §1.2 : `"25666"`). */
export function toMinorString(value: Money): string {
  assertMoney(value);
  return value.amountMinor.toString();
}

/** Chaîne en unités majeures, point décimal, sans séparateur de milliers (`"256.66"`, `"1438052"`). */
export function toMajorString(value: Money, currency: Currency): string {
  assertMoney(value);
  assertCurrency(currency);
  assertCurrencyOf(value, currency);
  const negative = value.amountMinor < 0n;
  const digits = (negative ? -value.amountMinor : value.amountMinor)
    .toString()
    .padStart(currency.exponent + 1, '0');
  const cut = digits.length - currency.exponent;
  const text = currency.exponent === 0 ? digits : `${digits.slice(0, cut)}.${digits.slice(cut)}`;
  return negative ? `-${text}` : text;
}

/** Forme JSON sans perte (aucun `number`) : `{ amountMinor: "25666", currency: "USD" }`. */
export function moneyToJSON(value: Money): { amountMinor: string; currency: string } {
  assertMoney(value);
  return { amountMinor: value.amountMinor.toString(), currency: value.currency };
}

// ---------------------------------------------------------------- arithmétique exacte

export function add(a: Money, b: Money): Money {
  assertMoney(a);
  assertMoney(b);
  assertSameCurrency(a, b);
  return make(a.amountMinor + b.amountMinor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertMoney(a);
  assertMoney(b);
  assertSameCurrency(a, b);
  return make(a.amountMinor - b.amountMinor, a.currency);
}

export function negate(a: Money): Money {
  assertMoney(a);
  return make(-a.amountMinor, a.currency);
}

/** Somme exacte ; la devise est exigée pour qu'une liste vide ait une devise. */
export function sum(currency: Currency, values: readonly Money[]): Money {
  assertCurrency(currency);
  let total = 0n;
  for (const value of values) {
    assertMoney(value);
    assertCurrencyOf(value, currency);
    total += value.amountMinor;
  }
  return make(total, currency.code);
}

/** Produit par un entier exact (par ex. un forfait journalier × nombre de jours). */
export function multiplyByInteger(a: Money, factor: bigint): Money {
  assertMoney(a);
  if (typeof factor !== 'bigint') {
    throw new MoneyError('MONEY_INVALID_AMOUNT', 'facteur entier : bigint attendu');
  }
  return make(a.amountMinor * factor, a.currency);
}

// ---------------------------------------------------------------- comparaisons

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertMoney(a);
  assertMoney(b);
  assertSameCurrency(a, b);
  return a.amountMinor < b.amountMinor ? -1 : a.amountMinor > b.amountMinor ? 1 : 0;
}

export function equals(a: Money, b: Money): boolean {
  return compare(a, b) === 0;
}

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b;
}

export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b;
}

export function isZero(a: Money): boolean {
  assertMoney(a);
  return a.amountMinor === 0n;
}

export function isNegative(a: Money): boolean {
  assertMoney(a);
  return a.amountMinor < 0n;
}

export function isPositive(a: Money): boolean {
  assertMoney(a);
  return a.amountMinor > 0n;
}

/**
 * Montant d'écriture : strictement positif (08 E4 « tout montant d'écriture est strictement
 * positif » ; 17 §3.1.5 `CHECK (amount_minor > 0)`). Sinon `MONEY_NOT_POSITIVE`.
 */
export function requirePositive(a: Money): Money {
  assertMoney(a);
  if (a.amountMinor <= 0n) {
    throw new MoneyError('MONEY_NOT_POSITIVE', `montant d'écriture non positif : ${a.amountMinor}`);
  }
  return a;
}

// ---------------------------------------------------------------- fractions et arrondis

/** Fraction exacte `part / whole` de deux montants de même devise (`RATIO_INVALID` si `whole` = 0). */
export function ratioOf(part: Money, whole: Money): Ratio {
  assertMoney(part);
  assertMoney(whole);
  assertSameCurrency(part, whole);
  return ratio(part.amountMinor, whole.amountMinor);
}

/**
 * `roundHalfUp(m × r)` : montant d'une ligne obtenu par une fraction (retenue `P × j / days`,
 * taxe d'une ligne `ligne × taux`, commission, prorata). Un seul arrondi, à la fin.
 */
export function multiplyRoundHalfUp(a: Money, r: Ratio): Money {
  assertMoney(a);
  assertRatio(r);
  return make(roundHalfUp(ratio(a.amountMinor * r.num, r.den)), a.currency);
}

/**
 * Taxe d'un groupe : **par ligne puis somme** (08 BR-PRICE-12, BR-PRICE-14 (2) ; vecteur T43) :
 * `Σ roundHalfUp(ligne × taux)`, jamais `roundHalfUp(taux × Σ lignes)`. Une ligne négative (promo)
 * porte une taxe négative arrondie de la même façon.
 */
export function taxByLine(currency: Currency, lines: readonly Money[], rate: Ratio): Money {
  assertCurrency(currency);
  assertRatio(rate);
  return sum(
    currency,
    lines.map((line) => {
      assertMoney(line);
      assertCurrencyOf(line, currency);
      return multiplyRoundHalfUp(line, rate);
    }),
  );
}

function assertShare(share: Ratio): void {
  assertRatio(share);
  if (share.num < 0n || share.num > share.den) {
    throw new MoneyError('SHARE_OUT_OF_RANGE', `part hors de [0 ; 1] : ${share.num}/${share.den}`);
  }
}

/**
 * Part hôte d'un partage hôte / plateforme (08 BR-PRICE-14 (3), pseudo-code BR-CXL ; T40) :
 *
 *   x = m × pct ; résultat = floor(x) si frac(x) ≤ 1/2, sinon ceil(x)
 *
 * Arrondi au plus proche ; égalité exacte (demi-unité) → floor, le résidu va à la plateforme.
 * Ce n'est pas un « plus grand reste ». La formule est appliquée telle quelle, quel que soit le
 * signe de `m` (frac(x) = x − floor(x) ∈ [0 ; 1[). `pct` hors de [0 ; 1] : `SHARE_OUT_OF_RANGE`.
 */
export function allocHost(m: Money, pct: Ratio): Money {
  assertMoney(m);
  assertShare(pct);
  const product = m.amountMinor * pct.num;
  const floor = floorDiv(product, pct.den);
  const remainder = product - floor * pct.den; // frac(x) = remainder / den, 0 ≤ remainder < den
  return make(2n * remainder <= pct.den ? floor : floor + 1n, m.currency);
}

/** Partage complet : part hôte par `allocHost`, la plateforme prend le complément (somme = total). */
export function splitHostPlatform(m: Money, pct: Ratio): { host: Money; platform: Money } {
  const host = allocHost(m, pct);
  return { host, platform: subtract(m, host) };
}
