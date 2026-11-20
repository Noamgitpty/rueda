/**
 * US-709 — imputation d'un chargeback perdu (08 E5, E7 règle 7) rejouée sur l'export des oracles
 * (`docs/specs/tools/check_t49plus.py` : T53, T54, T55 ; `check_verif12_fixes.py` et
 * `check_t66_68.py` : T67 ; `check_legs.py` : TJ14a à TJ14c). Les ENTRÉES viennent des vecteurs de
 * règlement de l'export (T03, T27 : total payé, remboursement, part de l'hôte) et du texte des
 * lignes de 08 (« 45,00 versés », « capture 1 438 050 PYG = 200,00 USD », « perdu de 50,00 USD ») ;
 * les ATTENDUS, des contrôles de l'export, jamais du code testé. USD (2 décimales) et PYG (aucune).
 */
import { describe, expect, it } from 'vitest';
import {
  checksFor,
  legVector,
  loadGoldenVectors,
  settlementVector,
  type GoldenValue,
} from '../../src/golden-vectors/index.ts';
import {
  chargebackImputation,
  isSettlementError,
  lostTripMinor,
  type ChargebackInputs,
} from '../../src/index.ts';

const set = loadGoldenVectors();

/** Attendu d'un contrôle de l'oracle, par vecteur et libellé exact. */
function expected(vectorId: string, label: string): GoldenValue {
  const c = checksFor(set, vectorId).find((x) => x.vectorId === vectorId && x.label === label);
  if (c === undefined) throw new Error(`contrôle absent : ${vectorId} « ${label} »`);
  return c.expected;
}

const settlement = (id: string) => {
  const v = settlementVector(set, id);
  return {
    total: v.trip.totalPaidMinor,
    refund: v.expected.guestRefundMinor,
    host: v.expected.hostFromGuestMinor,
  };
};

const legsOf = (id: string) => {
  const v = legVector(set, id);
  return { ...v.legsMinor };
};

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return isSettlementError(e) ? e.code : 'AUTRE';
  }
  return 'AUCUNE';
};

describe('08 E5 — reprise après chargeback perdu (T53, T54, T55)', () => {
  const a = settlement('T03');
  const owedA = a.total - a.refund;

  it('T53 : chargeback perdu sur la capture entière après remboursement ⇒ reprise 45,00 (et non 166,85), créance 187,44, perte 24,22 ; jambes TJ14a', () => {
    const r = chargebackImputation({
      lostTripMinor: a.total,
      collectedBeforeMinor: a.total,
      refundCommittedMinor: a.refund,
      owedMinor: owedA,
      hostFromGuestMinor: a.host,
      hostPaidMinor: a.host,
      cancellationEarnings: true,
    });
    const [clawback, , guest, loss] = expected(
      'T53',
      'T53 reprise / ancienne / double remb / perte',
    ) as bigint[];
    expect(r.clawbackMinor).toBe(clawback);
    expect(r.guestReceivableMinor).toBe(guest);
    expect(r.lossExpenseMinor).toBe(loss);
    expect(r.legs).toEqual(legsOf('TJ14a'));
    expect(r.legs.HOST + r.legs.INSURER + r.legs.TAX_THIRD_PARTY + r.legs.PLATFORM).toBe(
      legVector(set, 'TJ14a').totalMinor,
    );
  });

  it('T54 (a) lot non émis ⇒ reprise 0,00 ; (b) lot versé ⇒ reprise 25,50 ; jamais plus que versé', () => {
    const base: ChargebackInputs = {
      lostTripMinor: owedA - 3000n,
      collectedBeforeMinor: owedA,
      refundCommittedMinor: 0n,
      owedMinor: owedA,
      hostFromGuestMinor: a.host,
      hostPaidMinor: 0n,
      cancellationEarnings: true,
    };
    expect(chargebackImputation({ ...base, hostPaidMinor: 0n }).hostPayableBeforeMinor).toBe(
      expected('T54', 'T54 hote payable apres solde'),
    );
    const [reprise, payable] = expected(
      'T54a',
      'T54a reprise (lot non emis) / ancienne formule',
    ) as bigint[];
    const notPaid = chargebackImputation(base);
    expect(notPaid.clawbackMinor).toBe(reprise);
    expect(notPaid.hostPayableAfterMinor).toBe(payable);
    const paid = chargebackImputation({ ...base, hostPaidMinor: a.host });
    expect(paid.clawbackMinor).toBe(expected('T54b', 'T54b reprise (lot verse)'));
    expect(paid.clawbackMinor).toBeLessThanOrEqual(a.host);
  });

  it('T55 (PYG débité en USD) : perdu ramené au ratio de la capture (359 513 PYG), reprise 220 752 PYG au host_ledger PYG, plateforme 138 761 ; aucune écriture en USD', () => {
    const d = settlement('T27');
    const [, lost, owed, clawback, platform] = expected(
      'T55',
      'T55 remb USD / perdu PYG / owed / reprise / plateforme',
    ) as bigint[];
    // 08 T55 : capture 1 438 050 PYG = 200,00 USD ; chargeback perdu de 50,00 USD
    expect(lostTripMinor(5000n, d.total, 20000n)).toBe(lost);
    expect(d.total - d.refund).toBe(owed);
    const r = chargebackImputation({
      lostTripMinor: lost!,
      collectedBeforeMinor: d.total,
      refundCommittedMinor: d.refund,
      owedMinor: d.total - d.refund,
      hostFromGuestMinor: d.host,
      hostPaidMinor: d.host,
      cancellationEarnings: true,
    });
    expect(r.clawbackMinor).toBe(clawback);
    expect(-r.legs.PLATFORM).toBe(platform);
    expect(r.legs.HOST).toBe(-clawback!);
  });
});

describe('08 E7 règle 7 — jambes du chargeback (TJ14b, TJ14c) ; INSURER et TAX_THIRD_PARTY jamais repris', () => {
  it('TJ14b : trip réalisé, rien versé ⇒ aucune reprise, toute la perte à PLATFORM (USD) ; même méthode en PYG (TJ08a)', () => {
    for (const capture of ['TJ01', 'TJ08a']) {
      const total = legVector(set, capture).totalMinor;
      const r = chargebackImputation({
        lostTripMinor: total,
        collectedBeforeMinor: total,
        refundCommittedMinor: 0n,
        owedMinor: total,
        hostFromGuestMinor: legVector(set, capture).legsMinor.HOST,
        hostPaidMinor: legVector(set, capture).legsMinor.HOST,
        cancellationEarnings: false,
      });
      expect(r.clawbackMinor).toBe(0n);
      expect(r.legs).toEqual({ HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: -total });
    }
    expect(legsOf('TJ14b')).toEqual({
      HOST: 0n,
      INSURER: 0n,
      TAX_THIRD_PARTY: 0n,
      PLATFORM: -legVector(set, 'TJ01').totalMinor,
    });
  });

  it('TJ14c (PYG) : reprise 250 000 sur HOST, PLATFORM −1 455 002 ; la taxe pour compte de tiers reste due', () => {
    const v = legVector(set, 'TJ14c');
    const lost = -v.totalMinor;
    const hostPaid = -v.legsMinor.HOST;
    // 08 TJ14c : remboursement 1 283 335 confirmé, 250 000 versés, perdu sur 1 705 002
    const r = chargebackImputation({
      lostTripMinor: lost,
      collectedBeforeMinor: lost,
      refundCommittedMinor: 1_283_335n,
      owedMinor: lost - 1_283_335n,
      hostFromGuestMinor: hostPaid,
      hostPaidMinor: hostPaid,
      cancellationEarnings: true,
    });
    expect(r.legs).toEqual({ ...v.legsMinor });
  });
});

describe('08 E5 — chargeback perdu pendant un remboursement bloqué (T67)', () => {
  const a = settlement('T03');
  const owedA = a.total - a.refund;

  it('T67 (a) perte totale : C = 187,44 annulé, créance du voyageur 0,00, reprise 0,00, part hôte 45,00 jamais versée annulée, perte nette 24,22', () => {
    const r = chargebackImputation({
      lostTripMinor: a.total,
      collectedBeforeMinor: a.total,
      refundCommittedMinor: a.refund,
      blockedRefundsMinor: a.refund,
      owedMinor: owedA,
      hostFromGuestMinor: a.host,
      hostPaidMinor: 0n,
      cancellationEarnings: true,
    });
    expect(r.cancelledBlockedRefundsMinor).toBe(expected('T67a', 'T67a C'));
    expect(r.guestReceivableMinor).toBe(expected('T67a', 'T67a creance guest'));
    expect(r.clawbackMinor).toBe(expected('T67a', 'T67a reprise'));
    expect(r.hostUnpaidCancelledMinor).toBe(expected('T67a', 'T67a part hote annulee'));
    expect(r.lossExpenseMinor).toBe(expected('T67a', 'T67a perte nette'));
    expect(r.retainedBeforeMinor).toBe(
      expected('T67a', 'T67a retainedCollected avant [écrit dans 08]'),
    );
  });

  it('T67 (b) perte partielle de 100,00 : C = 100,00, lost_retained 0, perte 0, hôte 45,00 toujours payable', () => {
    const r = chargebackImputation({
      lostTripMinor: 10000n,
      collectedBeforeMinor: a.total,
      refundCommittedMinor: a.refund,
      blockedRefundsMinor: a.refund,
      owedMinor: owedA,
      hostFromGuestMinor: a.host,
      hostPaidMinor: 0n,
      cancellationEarnings: true,
    });
    expect(r.cancelledBlockedRefundsMinor).toBe(expected('T67b', 'T67b C'));
    expect([r.lostRetainedMinor, r.guestReceivableMinor, r.lossExpenseMinor]).toEqual(
      expected('T67b', 'T67b lost_retained / double / perte'),
    );
    expect(r.hostPayableAfterMinor).toBe(expected('T67b', 'T67b hote payable'));
  });
});

describe('entrées refusées (fail-closed)', () => {
  const ok: ChargebackInputs = {
    lostTripMinor: 100n,
    collectedBeforeMinor: 100n,
    refundCommittedMinor: 0n,
    owedMinor: 100n,
    hostFromGuestMinor: 50n,
    hostPaidMinor: 0n,
    cancellationEarnings: true,
  };

  it('montant négatif ou nul, perdu au-delà de l’encaissé, bloqué au-delà de l’engagé, versé au-delà du payable ⇒ SETTLEMENT_INPUT_INVALID', () => {
    expect(code(() => chargebackImputation(ok))).toBe('AUCUNE');
    expect(code(() => chargebackImputation({ ...ok, lostTripMinor: 0n }))).toBe(
      'SETTLEMENT_INPUT_INVALID',
    );
    expect(code(() => chargebackImputation({ ...ok, lostTripMinor: 101n }))).toBe(
      'SETTLEMENT_INPUT_INVALID',
    );
    expect(code(() => chargebackImputation({ ...ok, hostPaidMinor: -1n }))).toBe(
      'SETTLEMENT_INPUT_INVALID',
    );
    expect(code(() => chargebackImputation({ ...ok, blockedRefundsMinor: 1n }))).toBe(
      'SETTLEMENT_INPUT_INVALID',
    );
    expect(code(() => chargebackImputation({ ...ok, hostPaidMinor: 120n }))).toBe(
      'SETTLEMENT_INPUT_INVALID',
    );
    expect(code(() => lostTripMinor(1n, 1n, 0n))).toBe('SETTLEMENT_INPUT_INVALID');
  });
});
