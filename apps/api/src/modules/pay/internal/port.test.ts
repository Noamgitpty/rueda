/**
 * Critère 5 de US-019 : « chaque méthode qui déplace des fonds reçoit un `LegAmounts` » — vérifié
 * au niveau des TYPES (le compilateur refuse une signature sans jambes) et de la liste
 * `MONEY_MOVING_METHODS` (17 §2.8).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { LegAmounts } from './legs.js';
import { MONEY_MOVING_METHODS } from './port.js';
import type { MoneyMovingMethod, PaymentProvider } from './port.js';

type RequestOf<M extends keyof PaymentProvider> = PaymentProvider[M] extends (
  r: infer R,
  ...rest: never[]
) => unknown
  ? R
  : never;

type CarriesLegs = {
  [M in MoneyMovingMethod]: RequestOf<M> extends { readonly legs: LegAmounts } ? true : false;
};

describe('port PaymentProvider : jambes sur toute méthode qui déplace des fonds', () => {
  it('chaque requête des méthodes qui déplacent des fonds exige `legs: LegAmounts`', () => {
    expectTypeOf<CarriesLegs>().toEqualTypeOf<{
      createHostedPayment: true;
      capture: true;
      refund: true;
      reallocate: true;
      rollback: true;
      chargeMIT: true;
    }>();
    // les jambes sont obligatoires (pas optionnelles)
    expectTypeOf<RequestOf<'refund'>['legs']>().toEqualTypeOf<LegAmounts>();
    expectTypeOf<RequestOf<'chargeMIT'>['legs']>().toEqualTypeOf<LegAmounts>();
  });

  it('liste des méthodes (17 §2.8) : capture, remboursement, réaffectation, rollback, débit MIT, paiement hébergé', () => {
    expect([...MONEY_MOVING_METHODS].sort()).toEqual(
      ['capture', 'chargeMIT', 'createHostedPayment', 'reallocate', 'refund', 'rollback'].sort(),
    );
  });

  it('LegAmounts : montants bigint, quatre jambes', () => {
    expectTypeOf<LegAmounts>().toEqualTypeOf<
      Readonly<{ HOST: bigint; INSURER: bigint; TAX_THIRD_PARTY: bigint; PLATFORM: bigint }>
    >();
  });
});
