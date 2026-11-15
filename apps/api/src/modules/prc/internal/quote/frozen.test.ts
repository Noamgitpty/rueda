/**
 * Devis figé et rejeu (US-202 critère 4 ; 16 PRC-025 critères « rejoué ⇒ identique à l'unité
 * mineure », « plan de l'hôte modifié après la réservation », « T01–T27 depuis le devis figé »).
 * Attendus : vecteurs T de `golden_vectors.json` (oracle `independent_settlement_check.py`).
 */
import { createHash } from 'node:crypto';
import { computeCancellationSettlement, money, ratio } from '@rueda/money';
import { settlementVector, settlementVectors } from '@rueda/money/golden-vectors';
import { settleVector, testParams, toEvent } from '@rueda/money/testing';
import { describe, expect, it } from 'vitest';
import { assembleQuote, computeQuote, quoteSettlementTrip, type QuoteParams } from './engine.js';
import {
  FROZEN_QUOTE_FORMAT,
  QUOTE_INPUTS_HASH_PREFIX,
  QUOTE_OUTPUTS_HASH_PREFIX,
  freezeQuote,
  replayFrozenQuote,
  type FrozenQuote,
} from './frozen.js';
import {
  DAY_MS,
  MINUTE_MS,
  T0_MS,
  caseOfGoldenTrip,
  codeOf,
  golden,
} from '../../../../../test/support/quote.js';

const sha = (prefix: string, text: string) =>
  createHash('sha256')
    .update(prefix + text, 'utf8')
    .digest('hex');

/** Trip A (exposant 2) et D2 (exposant 0) : prix journalier entier, lignes et taux de l'oracle. */
const CASES = [
  ['T01', 4_000n],
  ['T40', 333_334n],
] as const;

function frozenCase(id: string, daily: bigint) {
  const v = settlementVector(golden, id);
  const { params } = caseOfGoldenTrip(v.trip);
  const c = params.currency;
  const t = v.trip.linesMinor;
  const lines = {
    TRIP_FEE: money(t.tripFee, c),
    PROTECTION: money(t.protection, c),
    EXTRAS: money(t.extras, c),
    ENHANCED_ROADSIDE: money(t.enhancedRoadside, c),
    ADDITIONAL_DRIVER_FEE: money(t.additionalDriver, c),
    DELIVERY_FEE: money(t.delivery, c),
  };
  const request = {
    startAtMs: T0_MS,
    endAtMs: T0_MS + v.trip.days * DAY_MS,
    quotedAtMs: T0_MS + v.trip.bookedAtMinutes * MINUTE_MS,
    rateType: v.trip.rate,
    dailyRate: money(daily, c),
    lines,
  };
  return { v, params, request };
}

describe('critère 4 : un devis figé rejoué donne le même total à l’unité mineure', () => {
  it.each(CASES)(
    '%s : figé puis rejoué ⇒ lignes, taxes, total et jambes identiques',
    (id, daily) => {
      const { v, params, request } = frozenCase(id, daily);
      const { quote, frozen } = freezeQuote(request, params);
      expect(quote.total.amountMinor).toBe(v.trip.totalPaidMinor);
      expect(frozen.format).toBe(FROZEN_QUOTE_FORMAT);
      expect(frozen.totalMinor).toBe(v.trip.totalPaidMinor.toString());
      const replayed = replayFrozenQuote(frozen);
      expect(replayed.total.amountMinor).toBe(v.trip.totalPaidMinor);
      expect(replayed.legs).toEqual(quote.legs);
      expect(replayFrozenQuote(frozen).total).toEqual(replayed.total);
      expect(freezeQuote(request, params).frozen).toEqual(frozen); // déterministe
    },
  );

  it.each(CASES)(
    '%s : plan, taux ou tolérance changés après la réservation ⇒ le devis figé ne change pas',
    (id, daily) => {
      const { params, request } = frozenCase(id, daily);
      const { frozen } = freezeQuote(request, params);
      const changed: QuoteParams = {
        ...params,
        hostSharePct: ratio(4n, 5n),
        graceMinutes: 0,
        taxRules: params.taxRules.map((r) => (r.taxable ? { ...r, rate: ratio(1n, 5n) } : r)),
      };
      const now = computeQuote({ ...request, endAtMs: request.endAtMs + 10 * MINUTE_MS }, changed);
      const replayed = replayFrozenQuote(frozen);
      expect(now.total.amountMinor).not.toBe(replayed.total.amountMinor);
      expect(replayed.total.amountMinor.toString()).toBe(frozen.totalMinor);
      expect(replayed.hostSharePct).toEqual(params.hostSharePct);
    },
  );
});

describe('devis figé altéré ⇒ QUOTE_REPLAY_MISMATCH', () => {
  const { params, request } = frozenCase('T01', 4_000n);
  const { frozen } = freezeQuote(request, params);

  const reHashed = (patch: Partial<FrozenQuote>): FrozenQuote => {
    const next = { ...frozen, ...patch };
    return {
      ...next,
      inputsHash: sha(QUOTE_INPUTS_HASH_PREFIX, next.inputs),
      outputsHash: sha(QUOTE_OUTPUTS_HASH_PREFIX, next.outputs),
    };
  };

  it('empreinte des entrées ou des sorties qui ne correspond plus', () => {
    expect(codeOf(() => replayFrozenQuote({ ...frozen, inputsHash: '0'.repeat(64) }))).toBe(
      'QUOTE_REPLAY_MISMATCH',
    );
    expect(codeOf(() => replayFrozenQuote({ ...frozen, outputsHash: '0'.repeat(64) }))).toBe(
      'QUOTE_REPLAY_MISMATCH',
    );
  });

  it('taux des entrées changé (empreinte recalculée) : sorties figées différentes', () => {
    const inputs = frozen.inputs.replaceAll('"7/100"', '"8/100"');
    expect(inputs).not.toBe(frozen.inputs);
    expect(codeOf(() => replayFrozenQuote(reHashed({ inputs })))).toBe('QUOTE_REPLAY_MISMATCH');
    const oneRule = frozen.inputs.replace('"7/100"', '"8/100"'); // groupe devenu incohérent
    expect(codeOf(() => replayFrozenQuote(reHashed({ inputs: oneRule })))).toBe(
      'QUOTE_REPLAY_MISMATCH',
    );
  });

  it('total des sorties changé (empreinte recalculée) : recalcul différent', () => {
    const outputs = frozen.outputs.replace(`"total":"${frozen.totalMinor}"`, '"total":"12000"');
    expect(outputs).not.toBe(frozen.outputs);
    expect(codeOf(() => replayFrozenQuote(reHashed({ outputs })))).toBe('QUOTE_REPLAY_MISMATCH');
    expect(codeOf(() => replayFrozenQuote({ ...frozen, totalMinor: '1' }))).toBe(
      'QUOTE_REPLAY_MISMATCH',
    );
  });

  it('format inconnu, entrées illisibles', () => {
    expect(codeOf(() => replayFrozenQuote({ ...frozen, format: 'autre/9' }))).toBe(
      'QUOTE_REPLAY_MISMATCH',
    );
    expect(codeOf(() => replayFrozenQuote(reHashed({ inputs: '{' })))).toBe(
      'QUOTE_REPLAY_MISMATCH',
    );
  });
});

describe('règlement d’annulation calculé depuis le devis (T01–T27, oracle)', () => {
  // Vecteurs T01–T27 que le moteur bêta de règlement rejoue (les autres motifs : US-518).
  const vectors = settlementVectors(golden, { normativeOnly: true }).filter((v) => {
    const n = Number(v.id.slice(1));
    if (!/^T\d+$/.test(v.id) || n < 1 || n > 27) return false;
    try {
      settleVector(v);
      return true;
    } catch {
      return false;
    }
  });

  it('les deux devises sont couvertes', () => {
    expect(new Set(vectors.map((v) => v.currency)).size).toBe(2);
  });

  it.each(vectors.map((v) => [v.id, v.currency, v] as const))(
    '%s (%s) : remboursement, taxe remboursée, gains de l’hôte et net plateforme de l’oracle',
    (_id, _c, v) => {
      const { period, params } = caseOfGoldenTrip(v.trip);
      const trip = quoteSettlementTrip(assembleQuote(period, params));
      const s = computeCancellationSettlement(trip, toEvent(v.event), testParams(trip.currency));
      expect(s.guestRefund.amountMinor).toBe(v.expected.guestRefundMinor);
      expect(s.taxRefund.amountMinor).toBe(v.expected.taxRefundedMinor);
      expect(s.hostEarnings.amountMinor).toBe(v.expected.hostEarningsMinor);
      expect(s.platformNet.amountMinor).toBe(v.expected.platformNetMinor);
    },
  );
});
