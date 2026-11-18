/**
 * US-217 partie 217b — lecture défensive de `GET /trips/{id}/receipt` (vue du voyageur).
 * Attendus : contrat OpenAPI de la route (ADR-161, ADR-167) et 08 T03 (trip fee 18,00, taxe de ligne
 * 1,26, conservé 6,00) ; jamais le code testé.
 */
import { describe, expect, it } from 'vitest';
import { guestReceiptOf, taxPercentOf } from './trip-receipt.ts';

const TRIP = '00000000-0000-4000-8000-0000000217b1';
const booked = {
  tripId: TRIP,
  viewerRole: 'GUEST',
  tripStatus: 'BOOKED',
  currency: 'XTS',
  currencyExponent: 2,
  timezone: 'Etc/UTC',
  receipt: {
    source: 'CAPTURE',
    settlementVersion: null,
    totalPaidMinor: '25666',
    refundMinor: '0',
    tripFee: {
      chargedMinor: '1800',
      taxMinor: '126',
      taxRateBps: 700,
      refundedMinor: '0',
      retainedMinor: '1800',
    },
    fiscalDocument: 'OFF_PLATFORM',
  },
};
const cancelled = {
  ...booked,
  tripStatus: 'CANCELLED_BY_GUEST',
  receipt: {
    ...booked.receipt,
    source: 'SETTLEMENT',
    settlementVersion: 1,
    refundMinor: '18744',
    tripFee: {
      chargedMinor: '1800',
      taxMinor: null,
      taxRateBps: null,
      refundedMinor: '1200',
      retainedMinor: '600',
    },
  },
};
const ok = (json: unknown) => ({ status: 200, json, session: null });

describe('guestReceiptOf', () => {
  it('trip capturé : total, trip fee et sa taxe de ligne, montants en bigint', () => {
    expect(guestReceiptOf(ok(booked))).toEqual({
      tripId: TRIP,
      tripStatus: 'BOOKED',
      currency: 'XTS',
      currencyExponent: 2,
      timezone: 'Etc/UTC',
      source: 'CAPTURE',
      totalPaidMinor: 25666n,
      refundDueMinor: 0n,
      tripFee: {
        chargedMinor: 1800n,
        taxMinor: 126n,
        taxRateBps: 700,
        refundedMinor: 0n,
        retainedMinor: 1800n,
      },
    });
  });

  it('annulé (T03) : remboursement dû, trip fee conservé sans taxe rendue (N-337)', () => {
    const v = guestReceiptOf(ok(cancelled));
    expect(v?.refundDueMinor).toBe(18744n);
    expect(v?.tripFee).toEqual({
      chargedMinor: 1800n,
      taxMinor: null,
      taxRateBps: null,
      refundedMinor: 1200n,
      retainedMinor: 600n,
    });
    expect(
      guestReceiptOf(ok({ ...booked, receipt: { ...booked.receipt, tripFee: null } }))?.tripFee,
    ).toBeNull();
  });

  it('toute autre vue ou forme inattendue ⇒ null (jamais un reçu partiel ou deviné)', () => {
    const r = booked.receipt;
    const fee = r.tripFee;
    for (const bad of [
      { ...booked, viewerRole: 'HOST' },
      { ...booked, tripId: 'x' },
      { ...booked, tripStatus: 'booked' },
      { ...booked, currency: 'xts' },
      { ...booked, currencyExponent: 7 },
      { ...booked, timezone: 'UTC; x' },
      { ...booked, receipt: null },
      { ...booked, receipt: { ...r, fiscalDocument: 'INVOICE' } },
      { ...booked, receipt: { ...r, source: 'QUOTE' } },
      { ...booked, receipt: { ...r, totalPaidMinor: '-1' } },
      { ...booked, receipt: { ...r, refundMinor: '1.5' } },
      { ...booked, receipt: { ...r, hostLegMinor: '1' } },
      { ...booked, receipt: { ...r, tripFee: { ...fee, taxMinor: 126 } } },
      { ...booked, receipt: { ...r, tripFee: { ...fee, taxRateBps: 1.5 } } },
      { ...booked, receipt: { ...r, tripFee: { ...fee, retainedMinor: null } } },
      { ...booked, receipt: { ...r, tripFee: { ...fee, extra: '1' } } },
    ]) {
      expect(guestReceiptOf(ok(bad)), JSON.stringify(bad)).toBeNull();
    }
    expect(guestReceiptOf({ status: 409, json: {}, session: null })).toBeNull();
  });

  it('taux de taxe affiché en pourcentage (affichage seulement)', () => {
    expect(taxPercentOf(700)).toBe(7);
    expect(taxPercentOf(1050)).toBe(10.5);
  });
});
