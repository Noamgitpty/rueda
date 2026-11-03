/**
 * PSP simulé de place de marché (US-061 ; 17 §2.8 ; 08 E7) : sous-marchands, soldes par trip et par
 * jambe, libération, gel, versement, ajustement, transfert depuis PLATFORM, mode hostile
 * « prorata ». Devise de test ISO 4217 `XTS` (réservée aux tests) : ce paquet ne connaît aucun
 * pays ; les montants par pays (vecteurs TJ) sont rejoués par la suite de contrat de `apps/api`.
 */
import { describe, expect, it } from 'vitest';
import { FakePsp, FakePspError } from '../../src/index.ts';
import type { FakeCapability, FakeLegAmounts, FakePspScenario } from '../../src/index.ts';

const CUR = 'XTS';
const T0 = Date.parse('2031-07-01T08:00:00.000Z');
const legs = (host: bigint, insurer: bigint, tax: bigint, platform: bigint): FakeLegAmounts => ({
  HOST: host,
  INSURER: insurer,
  TAX_THIRD_PARTY: tax,
  PLATFORM: platform,
});
const validated = (capability: string): FakeCapability => ({
  capability,
  method: '*',
  value: true,
  status: 'VALIDATED_SANDBOX',
});
const MARKET = [
  'SUPPORTS_REFUND',
  'SUPPORTS_PARTIAL_REFUND',
  'SUPPORTS_PAYOUT_ADJUSTMENT',
  'SUPPORTS_SUBMERCHANT',
  'SUPPORTS_INDIVIDUAL_SUBMERCHANT',
  'SUPPORTS_B2C_PAYOUT',
  'SUPPORTS_DELAYED_PAYOUT_RELEASE',
  'SUPPORTS_NEGATIVE_BALANCE_RECOVERY',
  'SUPPORTS_PLATFORM_LEG_TRANSFER',
].map(validated);

function setup(scenario?: FakePspScenario, without: readonly string[] = []): FakePsp {
  return new FakePsp({
    secret: 'whsec_test_only',
    clock: () => T0,
    capabilities: MARKET.filter((c) => !without.includes(c.capability)),
    ...(scenario !== undefined ? { scenario } : {}),
    env: { RUEDA_ENV: 'test' },
  });
}

/** Trip payé : 100 = HOST 60, INSURER 10, PLATFORM 30. */
function paidTrip(psp: FakePsp, trip: string): string {
  const order = psp.createOrder({
    merchantReference: `${trip}:CAPTURE:a1`,
    tripReference: trip,
    method: 'CARD',
    amountMinor: 100n,
    currency: CUR,
    legs: legs(60n, 10n, 0n, 30n),
    capture: 'AUTO',
  });
  psp.customerPays(order.reference);
  return order.reference;
}

const kind = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof FakePspError) return error.kind;
    throw error;
  }
  return 'OK';
};

const register = (psp: FakePsp, host = 'org-1') =>
  psp.registerSubmerchant({
    merchantReference: `submerchant:${host}:a1`,
    hostReference: host,
    individual: true,
    country: 'ZZ',
    payoutCurrency: CUR,
  });

describe('PSP simulé de place de marché (US-061)', () => {
  it('sous-marchand : KYC scriptable, idempotent par sa clé, capacité individuelle exigée', () => {
    const psp = setup();
    const sm = register(psp);
    expect(sm).toMatchObject({ reference: 'fk_sm_000001', status: 'ACTIVE' });
    expect(register(psp).reference).toBe(sm.reference);
    expect(psp.calls('REGISTER_SUBMERCHANT')).toBe(2);
    expect(psp.getSubmerchant('inconnu')).toBeNull();
    expect(register(setup({ submerchantKyc: 'PENDING' })).status).toBe('PENDING');
    expect(kind(() => register(setup(undefined, ['SUPPORTS_INDIVIDUAL_SUBMERCHANT'])))).toBe(
      'UNSUPPORTED',
    );
  });

  it('soldes par jambe : encaissé, remboursé, libéré ; débit d’une jambe libérée ⇒ LEG_RELEASED, gelée ⇒ LEG_HELD', () => {
    const psp = setup();
    const sm = register(psp);
    const ref = paidTrip(psp, 'trip-1');
    paidTrip(psp, 'trip-2');
    psp.releaseLeg({
      merchantReference: 'release:trip-1:1:HOST:i1',
      tripReference: 'trip-1',
      leg: 'HOST',
      amountMinor: 60n,
      currency: CUR,
      beneficiaryReference: sm.reference,
    });
    const refund = (key: string, l: FakeLegAmounts, amount: bigint) => () =>
      psp.refund({
        merchantReference: key,
        reference: ref,
        amountMinor: amount,
        currency: CUR,
        legs: l,
      });
    expect(kind(refund('r1', legs(10n, 0n, 0n, 0n), 10n))).toBe('LEG_RELEASED');
    // la variation portée sur PLATFORM (avance de Kmino) puise dans le solde PLATFORM du compte
    expect(kind(refund('r2', legs(0n, 0n, 0n, 50n), 50n))).toBe('OK');
    const trip1 = psp.listLegBalances({ tripReference: 'trip-1' });
    expect(trip1.find((b) => b.leg === 'HOST')).toMatchObject({
      releasedMinor: 60n,
      refundedMinor: 0n,
    });
    expect(trip1.find((b) => b.leg === 'PLATFORM')?.refundedMinor).toBe(50n);
    psp.holdLeg({
      merchantReference: 'hold:trip-1:INSURER',
      tripReference: 'trip-1',
      leg: 'INSURER',
    });
    expect(kind(refund('r3', legs(0n, 5n, 0n, 0n), 5n))).toBe('LEG_HELD');
    expect(psp.movements().filter((m) => m.operation === 'REFUND')).toHaveLength(1);
  });

  it('versement et reprise : au-delà du libéré ⇒ INSUFFICIENT_FUNDS ; ajustement au-delà du solde seulement avec SUPPORTS_NEGATIVE_BALANCE_RECOVERY', () => {
    for (const recovery of [true, false]) {
      const psp = setup(undefined, recovery ? [] : ['SUPPORTS_NEGATIVE_BALANCE_RECOVERY']);
      const sm = register(psp);
      paidTrip(psp, 'trip-1');
      psp.releaseLeg({
        merchantReference: 'release:trip-1:1:HOST:i1',
        tripReference: 'trip-1',
        leg: 'HOST',
        amountMinor: 60n,
        currency: CUR,
        beneficiaryReference: sm.reference,
      });
      const pay = (key: string, amount: bigint) => () =>
        psp.payout({
          merchantReference: key,
          submerchantReference: sm.reference,
          amountMinor: amount,
          currency: CUR,
        });
      expect(kind(pay('pb1', 61n))).toBe('INSUFFICIENT_FUNDS');
      expect(kind(pay('pb2', 60n))).toBe('OK');
      const adjust = () =>
        psp.adjustPayout({
          merchantReference: 'adjust:hle-1',
          submerchantReference: sm.reference,
          amountMinor: 20n,
          currency: CUR,
          reason: 'HOST_PENALTY',
        });
      expect(kind(adjust)).toBe(recovery ? 'OK' : 'UNSUPPORTED');
      expect(psp.submerchant(sm.reference)?.adjustedMinor).toBe(recovery ? 20n : 0n);
    }
  });

  it('transfert depuis PLATFORM : Σ = 0, PLATFORM seule débitée ; idempotent ; capacité absente ⇒ UNSUPPORTED', () => {
    const psp = setup();
    paidTrip(psp, 'trip-1');
    const transfer = (key: string, l: FakeLegAmounts) => () =>
      psp.transferFromPlatform({
        merchantReference: key,
        tripReference: 'trip-1',
        currency: CUR,
        legs: l,
        reason: 'RELEASED_LEG_ADVANCE',
      });
    expect(kind(transfer('t1', legs(5n, 0n, 0n, -4n)))).toBe('INVALID_LEGS');
    expect(kind(transfer('t2', legs(-5n, 0n, 0n, 5n)))).toBe('INVALID_LEGS');
    expect(kind(transfer('t3', legs(5n, 0n, 0n, -5n)))).toBe('OK');
    expect(kind(transfer('t3', legs(5n, 0n, 0n, -5n)))).toBe('OK');
    const b = psp.listLegBalances({ tripReference: 'trip-1' });
    expect(b.find((x) => x.leg === 'HOST')?.reallocatedInMinor).toBe(5n);
    expect(b.find((x) => x.leg === 'PLATFORM')?.reallocatedOutMinor).toBe(5n);
    const closed = setup(undefined, ['SUPPORTS_PLATFORM_LEG_TRANSFER']);
    paidTrip(closed, 'trip-1');
    expect(
      kind(() =>
        closed.transferFromPlatform({
          merchantReference: 't1',
          tripReference: 'trip-1',
          currency: CUR,
          legs: legs(5n, 0n, 0n, -5n),
          reason: 'RELEASED_LEG_ADVANCE',
        }),
      ),
    ).toBe('UNSUPPORTED');
  });

  it('mode hostile « prorata » : le remboursement est ventilé au prorata des jambes encaissées, pas aux montants reçus', () => {
    const psp = setup({ prorata: true });
    const ref = paidTrip(psp, 'trip-1');
    const tx = psp.refund({
      merchantReference: 'r1',
      reference: ref,
      amountMinor: 50n,
      currency: CUR,
      legs: legs(50n, 0n, 0n, 0n),
    });
    // 60 × 50 / 100 = 30 ; 10 × 50 / 100 = 5 ; PLATFORM en complément
    expect(tx.legs).toEqual(legs(30n, 5n, 0n, 15n));
  });
});
