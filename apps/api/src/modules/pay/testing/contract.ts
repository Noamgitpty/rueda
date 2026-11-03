/**
 * Suite de contrat du port `PaymentProvider` (17 §12, ADR-038 : la MÊME suite tourne sur le FAKE
 * et, au lot C, sur le connecteur réel en bac à sable — US-601). TESTS SEULEMENT.
 *
 * Le harnais fournit l'adaptateur, la devise et des montants tirés des vecteurs dorés (jamais
 * calculés ici), et les gestes du client sur la page hébergée.
 *
 * `describeMarketplaceContract` (US-061) : sous-marchands, libération, gel, versement, ajustement,
 * transfert depuis PLATFORM, soldes par jambe ; chaque écriture idempotente par sa clé ; débit
 * d'une jambe libérée refusé (TJ18) ; fidélité par jambe (TJ10 : un PSP qui ventile au prorata
 * est détecté et refusé, 08 E7 règle 1).
 */
import { describe, expect, it } from 'vitest';
import { isPaymentError } from '../internal/errors.js';
import type { PaymentErrorCode } from '../internal/errors.js';
import { LEGS } from '../internal/legs.js';
import type { Leg, LegAmounts } from '../internal/legs.js';
import { MONEY_MOVING_METHODS } from '../internal/port.js';
import type { LegBalance, MoneyMovingMethod, PaymentProvider } from '../internal/port.js';

export interface ContractAmounts {
  readonly amountMinor: bigint;
  readonly legs: LegAmounts;
}

export interface ContractWebhook {
  readonly body: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}

export interface ContractHarness {
  readonly provider: PaymentProvider;
  readonly currency: string;
  /** Capture totale (vecteur TJ d'allocation). */
  readonly capture: ContractAmounts;
  /** Remboursement partiel admissible sur cette capture (vecteur TJ). */
  readonly refund: ContractAmounts;
  readonly webhookSecret: Uint8Array;
  customerPays(providerReference: string): Promise<void>;
  /** Appels reçus par le PSP ; `null` si inobservable (connecteur réel). */
  pspCalls(): number | null;
  /** Webhooks émis depuis le dernier appel. */
  webhooks(): Promise<readonly ContractWebhook[]>;
}

async function expectCode(promise: Promise<unknown>, code: PaymentErrorCode): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(isPaymentError(error), String(error)).toBe(true);
    expect((error as { code: string }).code).toBe(code);
    return;
  }
  throw new Error(`erreur ${code} attendue`);
}

/** Déplace une unité d'une jambe non nulle vers une autre (même total, jambes différentes). */
export function shiftOneUnit(legs: LegAmounts): LegAmounts {
  const from = LEGS.find((l) => legs[l] > 0n);
  if (from === undefined) throw new Error('jambes toutes nulles');
  const to: Leg = from === 'PLATFORM' ? 'HOST' : 'PLATFORM';
  return { ...legs, [from]: legs[from] - 1n, [to]: legs[to] + 1n };
}

/** Une unité de moins sur la plus grande jambe (total − 1, jambes toujours ≥ 0). */
export function minusOneUnit(a: ContractAmounts): ContractAmounts {
  const leg = [...LEGS].sort((x, y) => (a.legs[y] > a.legs[x] ? 1 : -1))[0] as Leg;
  return { amountMinor: a.amountMinor - 1n, legs: { ...a.legs, [leg]: a.legs[leg] - 1n } };
}

function requestFor(
  method: MoneyMovingMethod,
  h: ContractHarness,
  legs: LegAmounts,
  amountMinor: bigint,
): Promise<unknown> {
  const p = h.provider;
  const base = { idempotencyKey: `contract:${method}:a1`, currency: h.currency };
  switch (method) {
    case 'createHostedPayment':
      return p.createHostedPayment({ ...base, amountMinor, legs, method: 'CARD', capture: 'AUTO' });
    case 'capture':
      return p.capture({ ...base, amountMinor, legs, providerReference: 'ref' });
    case 'refund':
      return p.refund({ ...base, amountMinor, legs, providerReference: 'ref' });
    case 'rollback':
      return p.rollback({ ...base, amountMinor, legs, providerReference: 'ref' });
    case 'chargeMIT':
      return p.chargeMIT({
        ...base,
        amountMinor,
        legs,
        reason: 'DELAYED_CHARGES',
        instrumentToken: 'tok_contract',
      });
    case 'reallocate':
      return p.reallocate({ ...base, legs, providerReference: 'ref' });
    case 'transferFromPlatform':
      return p.transferFromPlatform({
        ...base,
        legs,
        tripReference: 'trip-contract',
        reason: 'RELEASED_LEG_ADVANCE',
      });
  }
}

export function describePaymentProviderContract(name: string, make: () => ContractHarness): void {
  describe(`contrat PaymentProvider — ${name}`, () => {
    it.each([...MONEY_MOVING_METHODS])(
      '%s : Σ jambes ≠ montant ⇒ LEG_SUM_MISMATCH ; jambe négative ⇒ LEG_AMOUNT_NEGATIVE ; sans appel au PSP',
      async (method) => {
        const h = make();
        const before = h.pspCalls();
        const { amountMinor, legs } = h.capture;
        if (method === 'reallocate') {
          // réaffectation : Σ = 0 exigée (08 E7 règle 3)
          await expectCode(
            requestFor(
              method,
              h,
              { ...legs, HOST: -1n, PLATFORM: 2n, INSURER: 0n, TAX_THIRD_PARTY: 0n },
              0n,
            ),
            'LEG_SUM_MISMATCH',
          );
        } else if (method === 'transferFromPlatform') {
          // transfert depuis PLATFORM (17 §2.9) : Σ = 0, PLATFORM seule débitée
          await expectCode(
            requestFor(
              method,
              h,
              { HOST: 2n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: -1n },
              0n,
            ),
            'LEG_SUM_MISMATCH',
          );
          await expectCode(
            requestFor(
              method,
              h,
              { HOST: -1n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 1n },
              0n,
            ),
            'LEG_AMOUNT_NEGATIVE',
          );
        } else {
          await expectCode(
            requestFor(method, h, { ...legs, PLATFORM: legs.PLATFORM + 1n }, amountMinor),
            'LEG_SUM_MISMATCH',
          );
          await expectCode(
            requestFor(
              method,
              h,
              { ...legs, HOST: -1n, PLATFORM: legs.PLATFORM + legs.HOST + 1n },
              amountMinor,
            ),
            'LEG_AMOUNT_NEGATIVE',
          );
        }
        expect(h.pspCalls()).toBe(before);
      },
    );

    it('paiement hébergé puis remboursement partiel ; état faisant foi par getOperation, jambes comprises', async () => {
      const h = make();
      const order = await h.provider.createHostedPayment({
        idempotencyKey: 'contract:hold:AUTO:a1',
        currency: h.currency,
        method: 'CARD',
        capture: 'AUTO',
        ...h.capture,
      });
      expect(order.redirectUrl).toMatch(/^https:\/\//);
      await h.customerPays(order.providerReference);
      const read = await h.provider.getOperation({ providerReference: order.providerReference });
      expect(read).toMatchObject({
        status: 'SUCCEEDED',
        amountMinor: h.capture.amountMinor,
        currency: h.currency,
      });
      if (read?.legs !== null && read?.legs !== undefined)
        expect(read.legs).toEqual(h.capture.legs);
      const refund = await h.provider.refund({
        idempotencyKey: 'contract:refund:i1:a1',
        currency: h.currency,
        providerReference: order.providerReference,
        ...h.refund,
      });
      expect(refund.status).toBe('SUCCEEDED');
    });

    it('rejeu de la même clé : même opération ; même clé et montant ou jambes différents ⇒ IDEMPOTENCY_CONFLICT', async () => {
      const h = make();
      const order = await h.provider.createHostedPayment({
        idempotencyKey: 'contract:hold:AUTO:a1',
        currency: h.currency,
        method: 'CARD',
        capture: 'AUTO',
        ...h.capture,
      });
      await h.customerPays(order.providerReference);
      const req = {
        idempotencyKey: 'contract:refund:i1:a1',
        currency: h.currency,
        providerReference: order.providerReference,
      };
      const first = await h.provider.refund({ ...req, ...h.refund });
      const replay = await h.provider.refund({ ...req, ...h.refund });
      expect(replay.providerReference).toBe(first.providerReference);
      await expectCode(
        h.provider.refund({ ...req, ...minusOneUnit(h.refund) }),
        'IDEMPOTENCY_CONFLICT',
      );
      await expectCode(
        h.provider.refund({
          ...req,
          amountMinor: h.refund.amountMinor,
          legs: shiftOneUnit(h.refund.legs),
        }),
        'IDEMPOTENCY_CONFLICT',
      );
    });

    it('webhook : signature valide ⇒ événement normalisé ; corps altéré ou mauvais secret ⇒ invalide', async () => {
      const h = make();
      const order = await h.provider.createHostedPayment({
        idempotencyKey: 'contract:hold:AUTO:a1',
        currency: h.currency,
        method: 'CARD',
        capture: 'AUTO',
        ...h.capture,
      });
      await h.customerPays(order.providerReference);
      const hooks = await h.webhooks();
      expect(hooks.length).toBeGreaterThan(0);
      for (const hook of hooks) {
        const ok = h.provider.verifyAndParseWebhook(hook.body, hook.headers, h.webhookSecret);
        expect(ok.signatureValid).toBe(true);
        expect(ok.events.map((e) => e.providerReference)).toEqual([order.providerReference]);
        const tampered = new Uint8Array([...hook.body, 0x20]);
        expect(
          h.provider.verifyAndParseWebhook(tampered, hook.headers, h.webhookSecret).signatureValid,
        ).toBe(false);
        expect(
          h.provider.verifyAndParseWebhook(
            hook.body,
            hook.headers,
            new TextEncoder().encode('autre'),
          ).signatureValid,
        ).toBe(false);
      }
    });
  });
}

// --- place de marché (US-061 ; 17 §2.8 ; 08 E7) ------------------------------------------------

export interface MarketplaceHarness {
  readonly provider: PaymentProvider;
  readonly currency: string;
  /** Pays du compte marchand (configuration pays, jamais une constante du code). */
  readonly country: string;
  /** Capture totale d'un trip (TJ01 / TJ08a). */
  readonly capture: ContractAmounts;
  /** Débit théorique d'une jambe HOST déjà versée (TJ18a / TJ18c, variation négative). */
  readonly releasedTheory: ContractAmounts;
  /** Même ordre, variation portée sur PLATFORM avant l'appel (TJ18b / TJ18d). */
  readonly releasedExecuted: ContractAmounts;
  /** Capture et remboursement explicites relus jambe par jambe (TJ10a / TJ10b, TJ01 / TJ02b). */
  readonly fidelity: { readonly capture: ContractAmounts; readonly refund: ContractAmounts };
  customerPays(providerReference: string): Promise<void>;
  /** KYC du sous-marchand accordé par le PSP (bac à sable : geste de l'équipe). */
  approveKyc(submerchantReference: string): Promise<void>;
}

export interface LegDiscrepancy {
  /** Source de la relecture : opération (`getOperation`) ou solde du trip (`listLegBalances`). */
  readonly source: 'OPERATION' | 'BALANCE';
  readonly leg: Leg;
  readonly expectedMinor: bigint;
  readonly actualMinor: bigint;
}

/** Paiement hébergé capturé d'un trip, payé par le client ; rend la référence PSP. */
async function paidTrip(
  h: MarketplaceHarness,
  tripReference: string,
  amounts: ContractAmounts = h.capture,
): Promise<string> {
  const order = await h.provider.createHostedPayment({
    idempotencyKey: `${tripReference}:CAPTURE:a1`,
    tripReference,
    currency: h.currency,
    method: 'CARD',
    capture: 'AUTO',
    ...amounts,
  });
  await h.customerPays(order.providerReference);
  return order.providerReference;
}

const balanceOf = (rows: readonly LegBalance[], leg: Leg): LegBalance | undefined =>
  rows.find((r) => r.leg === leg);

/**
 * Fidélité par jambe (08 E7 règle 1, `SUPPORTS_PER_LEG_AMOUNTS`) : capture puis remboursement aux
 * jambes explicites, puis relecture chez le PSP (opération et soldes du trip). Rend les écarts ;
 * vide ⇒ le PSP exécute les montants reçus. Jambes illisibles ⇒ erreur : la capacité ne peut pas
 * être validée (fail-closed). Exporté pour prouver qu'un PSP au prorata est DÉTECTÉ (TJ10c).
 */
export async function perLegDiscrepancies(
  h: MarketplaceHarness,
  tripReference: string,
): Promise<LegDiscrepancy[]> {
  const parent = await paidTrip(h, tripReference, h.fidelity.capture);
  const refund = await h.provider.refund({
    idempotencyKey: `${tripReference}:REFUND:i1:a1`,
    currency: h.currency,
    providerReference: parent,
    ...h.fidelity.refund,
  });
  const out: LegDiscrepancy[] = [];
  const read = await h.provider.getOperation({ providerReference: refund.providerReference });
  const balances = await h.provider.listLegBalances({ tripReference });
  if ((read?.legs ?? null) === null && balances.length === 0) {
    throw new Error('jambes illisibles chez le PSP : SUPPORTS_PER_LEG_AMOUNTS non vérifiable');
  }
  for (const leg of LEGS) {
    const expected = h.fidelity.refund.legs[leg];
    const fromOperation = read?.legs?.[leg];
    if (fromOperation !== undefined && fromOperation !== expected) {
      out.push({ source: 'OPERATION', leg, expectedMinor: expected, actualMinor: fromOperation });
    }
    const fromBalance = balanceOf(balances, leg)?.refundedMinor;
    if (balances.length > 0 && fromBalance !== expected) {
      out.push({ source: 'BALANCE', leg, expectedMinor: expected, actualMinor: fromBalance ?? 0n });
    }
  }
  return out;
}

export function describeMarketplaceContract(name: string, make: () => MarketplaceHarness): void {
  describe(`contrat de place de marché — ${name}`, () => {
    /** Hôte sous-marchand actif (KYC accordé). */
    async function activeHost(h: MarketplaceHarness, host: string): Promise<string> {
      const sm = await h.provider.registerSubmerchant({
        idempotencyKey: `submerchant:${host}:a1`,
        hostReference: host,
        individual: true,
        country: h.country,
        payoutCurrency: h.currency,
      });
      if (sm.status !== 'ACTIVE') await h.approveKyc(sm.submerchantReference);
      const read = await h.provider.getSubmerchant(sm.submerchantReference);
      expect(read).toEqual({ submerchantReference: sm.submerchantReference, status: 'ACTIVE' });
      return sm.submerchantReference;
    }

    it('règle 1 (TJ10) : le PSP exécute à l’unité près les montants par jambe reçus, jamais un prorata', async () => {
      expect(await perLegDiscrepancies(make(), 'trip-fidelity')).toEqual([]);
    });

    it('jambe HOST libérée : débit théorique (TJ18a / c) ⇒ LEG_ALREADY_RELEASED sans mouvement ; variation portée sur PLATFORM (TJ18b / d) ⇒ acceptée', async () => {
      const h = make();
      const sm = await activeHost(h, 'host-a');
      const tripA = await paidTrip(h, 'trip-a');
      await paidTrip(h, 'trip-b'); // le solde PLATFORM du compte finance l'avance de Kmino
      const released = await h.provider.releaseLeg({
        idempotencyKey: 'release:trip-a:1:HOST:i1',
        tripReference: 'trip-a',
        leg: 'HOST',
        amountMinor: h.capture.legs.HOST,
        currency: h.currency,
        beneficiaryReference: sm,
      });
      expect(released.status).toBe('SUCCEEDED');
      const before = await h.provider.listLegBalances({ tripReference: 'trip-a' });
      expect(balanceOf(before, 'HOST')?.releasedMinor).toBe(h.capture.legs.HOST);
      await expectCode(
        h.provider.refund({
          idempotencyKey: 'trip-a:v2:REFUND:card:i1:a1',
          currency: h.currency,
          providerReference: tripA,
          ...h.releasedTheory,
        }),
        'LEG_ALREADY_RELEASED',
      );
      // réaffectation dont la source est la jambe libérée : même refus (08 E7 règle 3)
      const moved = h.releasedTheory.legs.HOST;
      await expectCode(
        h.provider.reallocate({
          idempotencyKey: 'trip-a:v2:LEG_REALLOCATION:card:i1:a1',
          currency: h.currency,
          providerReference: tripA,
          legs: { HOST: -moved, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: moved },
        }),
        'LEG_ALREADY_RELEASED',
      );
      expect(await h.provider.listLegBalances({ tripReference: 'trip-a' })).toEqual(before);
      const executed = await h.provider.refund({
        idempotencyKey: 'trip-a:v2:REFUND:card:i1:a2',
        currency: h.currency,
        providerReference: tripA,
        ...h.releasedExecuted,
      });
      expect(executed.status).toBe('SUCCEEDED');
      const after = await h.provider.listLegBalances({ tripReference: 'trip-a' });
      for (const leg of LEGS) {
        expect(balanceOf(after, leg)?.refundedMinor, leg).toBe(h.releasedExecuted.legs[leg]);
      }
    });

    it('registerSubmerchant, releaseLeg, holdLeg, payout, adjustPayout, transferFromPlatform, listLegBalances : idempotents par leur clé ; même clé, contenu différent ⇒ IDEMPOTENCY_CONFLICT', async () => {
      const h = make();
      const sm = await activeHost(h, 'host-b');
      const again = await h.provider.registerSubmerchant({
        idempotencyKey: 'submerchant:host-b:a1',
        hostReference: 'host-b',
        individual: true,
        country: h.country,
        payoutCurrency: h.currency,
      });
      expect(again.submerchantReference).toBe(sm);
      await expectCode(
        h.provider.registerSubmerchant({
          idempotencyKey: 'submerchant:host-b:a1',
          hostReference: 'host-c',
          individual: true,
          country: h.country,
          payoutCurrency: h.currency,
        }),
        'IDEMPOTENCY_CONFLICT',
      );
      await paidTrip(h, 'trip-c');
      await paidTrip(h, 'trip-d');
      const release = {
        idempotencyKey: 'release:trip-c:1:HOST:i1',
        tripReference: 'trip-c',
        leg: 'HOST' as const,
        amountMinor: h.capture.legs.HOST,
        currency: h.currency,
        beneficiaryReference: sm,
      };
      const r1 = await h.provider.releaseLeg(release);
      expect((await h.provider.releaseLeg(release)).providerReference).toBe(r1.providerReference);
      await expectCode(
        h.provider.releaseLeg({ ...release, amountMinor: release.amountMinor - 1n }),
        'IDEMPOTENCY_CONFLICT',
      );
      const balances = await h.provider.listLegBalances({ tripReference: 'trip-c' });
      expect(balanceOf(balances, 'HOST')?.releasedMinor).toBe(h.capture.legs.HOST);
      expect(await h.provider.listLegBalances({ tripReference: 'trip-c' })).toEqual(balances);

      const hold = {
        idempotencyKey: 'hold:trip-d:1:INSURER',
        tripReference: 'trip-d',
        leg: 'INSURER' as const,
      };
      const h1 = await h.provider.holdLeg(hold);
      expect((await h.provider.holdLeg(hold)).providerReference).toBe(h1.providerReference);
      await expectCode(h.provider.holdLeg({ ...hold, leg: 'PLATFORM' }), 'IDEMPOTENCY_CONFLICT');
      expect(
        balanceOf(await h.provider.listLegBalances({ tripReference: 'trip-d' }), 'INSURER')?.held,
      ).toBe(true);

      const payout = {
        idempotencyKey: 'payout_batch:pb1:r1',
        submerchantReference: sm,
        amountMinor: h.capture.legs.HOST,
        currency: h.currency,
      };
      const p1 = await h.provider.payout(payout);
      expect((await h.provider.payout(payout)).providerReference).toBe(p1.providerReference);
      await expectCode(
        h.provider.payout({ ...payout, amountMinor: payout.amountMinor - 1n }),
        'IDEMPOTENCY_CONFLICT',
      );
      // tout le libéré est versé : un second lot est refusé
      await expectCode(
        h.provider.payout({ ...payout, idempotencyKey: 'payout_batch:pb2:r1' }),
        'INSUFFICIENT_FUNDS',
      );

      // créance de la règle 3 bis (TJ18b : montant avancé par Kmino) reprise sur les versements
      // futurs (SUPPORTS_NEGATIVE_BALANCE_RECOVERY, solde versé déjà nul)
      const adjust = {
        idempotencyKey: 'adjust:hle-1',
        submerchantReference: sm,
        amountMinor: h.releasedTheory.legs.HOST,
        currency: h.currency,
        reason: 'RELEASED_LEG_RECOVERY' as const,
      };
      const a1 = await h.provider.adjustPayout(adjust);
      expect((await h.provider.adjustPayout(adjust)).providerReference).toBe(a1.providerReference);
      await expectCode(
        h.provider.adjustPayout({ ...adjust, reason: 'HOST_PENALTY' }),
        'IDEMPOTENCY_CONFLICT',
      );

      // transfert depuis PLATFORM : seulement si la capacité est validée (défaut false, 17 §2.8)
      const transfer = {
        idempotencyKey: 'ptransfer:adv-1',
        tripReference: 'trip-d',
        currency: h.currency,
        legs: {
          HOST: h.releasedTheory.legs.HOST,
          INSURER: 0n,
          TAX_THIRD_PARTY: 0n,
          PLATFORM: -h.releasedTheory.legs.HOST,
        },
        reason: 'RELEASED_LEG_ADVANCE' as const,
      };
      if (h.provider.capabilities().has('SUPPORTS_PLATFORM_LEG_TRANSFER')) {
        const t1 = await h.provider.transferFromPlatform(transfer);
        expect((await h.provider.transferFromPlatform(transfer)).providerReference).toBe(
          t1.providerReference,
        );
        await expectCode(
          h.provider.transferFromPlatform({ ...transfer, reason: 'HOST_COMPENSATION' }),
          'IDEMPOTENCY_CONFLICT',
        );
        const d = await h.provider.listLegBalances({ tripReference: 'trip-d' });
        expect(balanceOf(d, 'HOST')?.reallocatedInMinor).toBe(h.releasedTheory.legs.HOST);
        expect(balanceOf(d, 'PLATFORM')?.reallocatedOutMinor).toBe(h.releasedTheory.legs.HOST);
      } else {
        await expectCode(h.provider.transferFromPlatform(transfer), 'UNSUPPORTED_CAPABILITY');
      }
    });

    it('sous-marchand inconnu ⇒ null ; libération vers un sous-marchand inactif ou au-delà du solde ⇒ refus', async () => {
      const h = make();
      expect(await h.provider.getSubmerchant('sm-inconnu')).toBeNull();
      const sm = await activeHost(h, 'host-e');
      await paidTrip(h, 'trip-e');
      await expectCode(
        h.provider.releaseLeg({
          idempotencyKey: 'release:trip-e:1:HOST:i1',
          tripReference: 'trip-e',
          leg: 'HOST',
          amountMinor: h.capture.legs.HOST + 1n,
          currency: h.currency,
          beneficiaryReference: sm,
        }),
        'INVALID_REQUEST',
      );
    });
  });
}
