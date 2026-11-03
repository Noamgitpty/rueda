/**
 * PSP simulé (US-019) : contrôles, idempotence et mode hostile, chaque cas scriptable par un test
 * (19 US-019, critère 4 ; 17 §6.5 point 5). Devise de test ISO 4217 `XTS` (réservée aux tests) :
 * ce paquet ne connaît aucun pays. Les montants des jambes par pays sont rejoués par les tests de
 * contrat de `apps/api` (vecteurs TJ).
 */
import { describe, expect, it } from 'vitest';
import {
  assertFakeAllowed,
  FakeForbiddenError,
  FakePsp,
  FakePspError,
  verifyFakeSignature,
} from '../../src/index.ts';
import type {
  FakeCapability,
  FakeLegAmounts,
  FakePspScenario,
  FakeWebhookDelivery,
} from '../../src/index.ts';

const CUR = 'XTS';
const SECRET = 'whsec_test_only';
const T0 = Date.parse('2031-07-01T08:00:00.000Z');

const legs = (host: bigint, insurer: bigint, tax: bigint, platform: bigint): FakeLegAmounts => ({
  HOST: host,
  INSURER: insurer,
  TAX_THIRD_PARTY: tax,
  PLATFORM: platform,
});
const LEGS_100 = legs(60n, 10n, 0n, 30n);

const validated = (capability: string, value: boolean | number, method = '*'): FakeCapability => ({
  capability,
  method,
  value,
  status: 'VALIDATED_SANDBOX',
});

const ALL: FakeCapability[] = [
  validated('SUPPORTS_PREAUTH', true),
  validated('SUPPORTS_PARTIAL_CAPTURE', true),
  validated('SUPPORTS_VOID', true),
  validated('SUPPORTS_REFUND', true),
  validated('SUPPORTS_PARTIAL_REFUND', true),
  validated('SUPPORTS_MIT', true),
  validated('SUPPORTS_PAYOUT_ADJUSTMENT', true),
  validated('SUPPORTS_ORDER_CANCEL', true),
  validated('SUPPORTS_REAUTH', true),
  validated('SUPPORTS_LOOKUP_BY_MERCHANT_REF', true),
  validated('SUPPORTS_SINGLE_USE_ORDER', true),
  validated('ROLLBACK_WINDOW_HOURS', 24),
  validated('ORDER_TTL_SECONDS', 300, 'YAPPY'),
];

function setup(options: { scenario?: FakePspScenario; capabilities?: FakeCapability[] } = {}): {
  psp: FakePsp;
  clock: { now: number };
} {
  const clock = { now: T0 };
  const psp = new FakePsp({
    secret: SECRET,
    clock: () => clock.now,
    capabilities: options.capabilities ?? ALL,
    ...(options.scenario !== undefined ? { scenario: options.scenario } : {}),
    env: { RUEDA_ENV: 'test' },
  });
  return { psp, clock };
}

function paidOrder(psp: FakePsp, key = 'hold:h1:CAPTURE:a1', amount = 100n): string {
  const order = psp.createOrder({
    merchantReference: key,
    method: 'CARD',
    amountMinor: amount,
    currency: CUR,
    legs: amount === 100n ? LEGS_100 : legs(amount, 0n, 0n, 0n),
    capture: 'AUTO',
  });
  psp.customerPays(order.reference);
  return order.reference;
}

function expectFakeError(fn: () => unknown, kind: FakePspError['kind']): FakePspError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(FakePspError);
    expect((error as FakePspError).kind).toBe(kind);
    return error as FakePspError;
  }
  throw new Error(`erreur ${kind} attendue`);
}

const bodies = (ds: FakeWebhookDelivery[]): { id: string; type: string; status: string }[] =>
  ds.map((d) => JSON.parse(d.body) as { id: string; type: string; status: string });

describe('garde C19 : aucun FAKE hors développement et test', () => {
  it.each([undefined, 'production', 'preproduction', 'PRODUCTION', ''])(
    'RUEDA_ENV = %s ⇒ refus de construction',
    (value) => {
      const env = value === undefined ? {} : { RUEDA_ENV: value };
      expect(() => assertFakeAllowed('x', env)).toThrow(FakeForbiddenError);
      expect(() => new FakePsp({ secret: SECRET, clock: () => T0, capabilities: [], env })).toThrow(
        FakeForbiddenError,
      );
    },
  );

  it('development et test seulement', () => {
    expect(assertFakeAllowed('x', { RUEDA_ENV: 'development' })).toBe('development');
    expect(assertFakeAllowed('x', { RUEDA_ENV: 'test' })).toBe('test');
  });
});

describe('contrôle des jambes (08 E7 règle 1 ; 17 §2.8)', () => {
  it('Σ jambes ≠ montant ou jambe négative ⇒ INVALID_LEGS, aucun mouvement', () => {
    const { psp } = setup();
    const ref = paidOrder(psp);
    const before = psp.movements().length;
    expectFakeError(
      () =>
        psp.refund({
          merchantReference: 'r1',
          reference: ref,
          amountMinor: 50n,
          currency: CUR,
          legs: legs(10n, 10n, 0n, 29n),
        }),
      'INVALID_LEGS',
    );
    expectFakeError(
      () =>
        psp.refund({
          merchantReference: 'r2',
          reference: ref,
          amountMinor: 50n,
          currency: CUR,
          legs: legs(60n, -10n, 0n, 0n),
        }),
      'INVALID_LEGS',
    );
    expect(psp.movements()).toHaveLength(before);
  });

  it('réaffectation : Σ = 0 exigée ; capacité SUPPORTS_PAYOUT_ADJUSTMENT', () => {
    const { psp } = setup();
    const ref = paidOrder(psp);
    const tx = psp.reallocate({
      merchantReference: 'm1',
      reference: ref,
      currency: CUR,
      legs: legs(-20n, 0n, 0n, 20n),
    });
    expect(tx.amountMinor).toBe(20n);
    expectFakeError(
      () =>
        psp.reallocate({
          merchantReference: 'm2',
          reference: ref,
          currency: CUR,
          legs: legs(-20n, 0n, 0n, 19n),
        }),
      'INVALID_LEGS',
    );
    const { psp: without } = setup({
      capabilities: ALL.filter((c) => c.capability !== 'SUPPORTS_PAYOUT_ADJUSTMENT'),
    });
    const ref2 = paidOrder(without);
    expectFakeError(
      () =>
        without.reallocate({
          merchantReference: 'm1',
          reference: ref2,
          currency: CUR,
          legs: legs(-20n, 0n, 0n, 20n),
        }),
      'UNSUPPORTED',
    );
  });
});

describe('idempotence chez le PSP', () => {
  it('même clé, même contenu ⇒ même transaction, un seul mouvement', () => {
    const { psp } = setup();
    const ref = paidOrder(psp);
    const req = {
      merchantReference: 'A:1:v1:REFUND:card:i1:a1',
      reference: ref,
      amountMinor: 40n,
      currency: CUR,
      legs: legs(40n, 0n, 0n, 0n),
    };
    const a = psp.refund(req);
    const b = psp.refund(req);
    expect(b.reference).toBe(a.reference);
    expect(psp.movements().filter((m) => m.operation === 'REFUND')).toHaveLength(1);
  });

  it('même clé, montant ou jambes différents ⇒ IDEMPOTENCY_CONFLICT', () => {
    const { psp } = setup();
    const ref = paidOrder(psp);
    const base = { merchantReference: 'k', reference: ref, currency: CUR };
    psp.refund({ ...base, amountMinor: 40n, legs: legs(40n, 0n, 0n, 0n) });
    expectFakeError(
      () => psp.refund({ ...base, amountMinor: 41n, legs: legs(41n, 0n, 0n, 0n) }),
      'IDEMPOTENCY_CONFLICT',
    );
    expectFakeError(
      () => psp.refund({ ...base, amountMinor: 40n, legs: legs(30n, 10n, 0n, 0n) }),
      'IDEMPOTENCY_CONFLICT',
    );
  });

  it('mode hostile « idempotence ignorée » : la même clé débite deux fois', () => {
    const { psp } = setup({ scenario: { ignoreIdempotency: true } });
    const req = {
      merchantReference: 'A:1:v1:MIT_CHARGE:card:i1:a1',
      instrumentToken: 'tok_1',
      reason: 'DELAYED_CHARGES',
      amountMinor: 70n,
      currency: CUR,
      legs: legs(45n, 0n, 0n, 25n),
    };
    psp.chargeMit(req);
    psp.chargeMit(req);
    expect(psp.movements().filter((m) => m.operation === 'MIT_CHARGE')).toHaveLength(2);
  });
});

describe('réponses hostiles scriptées', () => {
  it('délai dépassé APRÈS succès : TIMEOUT, mouvement fait, état lisible par la clé', () => {
    const { psp } = setup({
      scenario: { responses: { REFUND: [{ kind: 'TIMEOUT_AFTER_SUCCESS' }] } },
    });
    const ref = paidOrder(psp);
    const req = {
      merchantReference: 'A:1:v1:REFUND:card:i1:a1',
      reference: ref,
      amountMinor: 40n,
      currency: CUR,
      legs: legs(40n, 0n, 0n, 0n),
    };
    expectFakeError(() => psp.refund(req), 'TIMEOUT');
    expect(psp.lookup({ merchantReference: req.merchantReference })?.status).toBe('SUCCEEDED');
    // rejeu de la même clé : même résultat, aucun second mouvement
    expect(psp.refund(req).status).toBe('SUCCEEDED');
    expect(psp.movements().filter((m) => m.operation === 'REFUND')).toHaveLength(1);
  });

  it('délai dépassé AVANT traitement, panne : rien n’est fait', () => {
    const { psp } = setup({
      scenario: {
        responses: { MIT_CHARGE: [{ kind: 'TIMEOUT_BEFORE' }, { kind: 'UNAVAILABLE' }] },
      },
    });
    const req = {
      merchantReference: 'k',
      instrumentToken: 'tok',
      reason: 'NO_SHOW',
      amountMinor: 10n,
      currency: CUR,
      legs: legs(0n, 0n, 0n, 10n),
    };
    expectFakeError(() => psp.chargeMit(req), 'TIMEOUT');
    expectFakeError(() => psp.chargeMit(req), 'UNAVAILABLE');
    expect(psp.lookup({ merchantReference: 'k' })).toBeNull();
    expect(psp.chargeMit(req).status).toBe('SUCCEEDED');
    expect(psp.movements()).toHaveLength(1);
  });

  it('réponse illisible après succès : UNREADABLE', () => {
    const { psp } = setup({
      scenario: { responses: { CREATE_ORDER: [{ kind: 'UNREADABLE_AFTER_SUCCESS' }] } },
    });
    expectFakeError(
      () =>
        psp.createOrder({
          merchantReference: 'hold:h:AUTH:a1',
          method: 'CARD',
          amountMinor: 100n,
          currency: CUR,
          legs: LEGS_100,
          capture: 'MANUAL',
        }),
      'UNREADABLE',
    );
    expect(psp.lookup({ merchantReference: 'hold:h:AUTH:a1' })?.status).toBe('CREATED');
  });

  it('refus reçu, puis « ne pas réessayer » ; la même clé rend le même refus', () => {
    const { psp } = setup({
      scenario: {
        responses: {
          // une réponse par appel, rejeu compris : refus, rejeu (même refus rendu), refus définitif
          MIT_CHARGE: [
            { kind: 'DECLINE', code: 'insufficient_funds' },
            { kind: 'OK' },
            { kind: 'DECLINE', code: 'stolen_card', doNotRetry: true },
          ],
        },
      },
    });
    const req = (key: string) => ({
      merchantReference: key,
      instrumentToken: 'tok',
      reason: 'DELAYED_CHARGES',
      amountMinor: 10n,
      currency: CUR,
      legs: legs(0n, 0n, 0n, 10n),
    });
    const first = expectFakeError(() => psp.chargeMit(req('a1')), 'DECLINED');
    expect(first).toMatchObject({ declineCode: 'insufficient_funds', doNotRetry: false });
    expect(expectFakeError(() => psp.chargeMit(req('a1')), 'DECLINED').declineCode).toBe(
      'insufficient_funds',
    );
    expect(expectFakeError(() => psp.chargeMit(req('a2')), 'DECLINED').doNotRetry).toBe(true);
    expect(psp.movements()).toHaveLength(0);
  });

  it('cancelOrder : « déjà annulé » et « déjà payé » scriptés ou réels', () => {
    const { psp } = setup({
      scenario: {
        responses: { CANCEL_ORDER: [{ kind: 'ALREADY_CANCELLED' }, { kind: 'ALREADY_PAID' }] },
      },
    });
    const order = psp.createOrder({
      merchantReference: 'hold:h:CAPTURE:a1',
      method: 'CARD',
      amountMinor: 100n,
      currency: CUR,
      legs: LEGS_100,
      capture: 'AUTO',
    });
    expectFakeError(
      () => psp.cancelOrder({ merchantReference: 'c1', reference: order.reference }),
      'ALREADY_CANCELLED',
    );
    expectFakeError(
      () => psp.cancelOrder({ merchantReference: 'c2', reference: order.reference }),
      'ALREADY_PAID',
    );
    psp.customerPays(order.reference);
    expectFakeError(
      () => psp.cancelOrder({ merchantReference: 'c3', reference: order.reference }),
      'ALREADY_PAID',
    );
  });
});

describe('capacités simulées : inconnue ou non validée = non (17 §2.8)', () => {
  it('capture partielle sans SUPPORTS_PARTIAL_CAPTURE validée ⇒ UNSUPPORTED ; DOCUMENTED ne suffit pas', () => {
    const caps = ALL.map((c) =>
      c.capability === 'SUPPORTS_PARTIAL_CAPTURE' ? { ...c, status: 'DOCUMENTED' as const } : c,
    );
    const { psp } = setup({ capabilities: caps });
    const order = psp.createOrder({
      merchantReference: 'hold:h:AUTH:a1',
      method: 'CARD',
      amountMinor: 100n,
      currency: CUR,
      legs: LEGS_100,
      capture: 'MANUAL',
    });
    psp.customerPays(order.reference);
    expectFakeError(
      () =>
        psp.capture({
          merchantReference: 'cap',
          reference: order.reference,
          amountMinor: 40n,
          currency: CUR,
          legs: legs(40n, 0n, 0n, 0n),
        }),
      'UNSUPPORTED',
    );
    // capture totale : permise
    expect(
      psp.capture({
        merchantReference: 'cap2',
        reference: order.reference,
        amountMinor: 100n,
        currency: CUR,
        legs: LEGS_100,
      }).status,
    ).toBe('SUCCEEDED');
  });

  it('recherche par clé du marchand sans capacité ⇒ UNSUPPORTED ; par référence du PSP : permise', () => {
    const { psp } = setup({
      capabilities: ALL.filter((c) => c.capability !== 'SUPPORTS_LOOKUP_BY_MERCHANT_REF'),
    });
    const ref = paidOrder(psp);
    expectFakeError(() => psp.lookup({ merchantReference: 'hold:h1:CAPTURE:a1' }), 'UNSUPPORTED');
    expect(psp.lookup({ reference: ref })?.status).toBe('SUCCEEDED');
  });

  it('rollback sans ROLLBACK_WINDOW_HOURS connue ⇒ rail interdit', () => {
    const { psp } = setup({
      capabilities: ALL.filter((c) => c.capability !== 'ROLLBACK_WINDOW_HOURS'),
    });
    const ref = paidOrder(psp);
    expectFakeError(
      () =>
        psp.rollback({
          merchantReference: 'rb',
          reference: ref,
          amountMinor: 100n,
          currency: CUR,
          legs: LEGS_100,
        }),
      'UNSUPPORTED',
    );
  });
});

describe('ordres à durée de vie (Yappy, ORDER_TTL_SECONDS = 300)', () => {
  const yappy = (psp: FakePsp) =>
    psp.createOrder({
      merchantReference: 'hold:h:CAPTURE:a1',
      method: 'YAPPY',
      amountMinor: 100n,
      currency: CUR,
      legs: LEGS_100,
      capture: 'AUTO',
    });

  it('payé à 299 s : accepté', () => {
    const { psp, clock } = setup();
    const order = yappy(psp);
    expect(order.expiresAtMs).toBe(T0 + 300_000);
    clock.now = T0 + 299_000;
    expect(psp.customerPays(order.reference).status).toBe('SUCCEEDED');
  });

  it('à 300 s : expiré, paiement refusé, webhook order.expired', () => {
    const { psp, clock } = setup();
    const order = yappy(psp);
    psp.deliverWebhooks();
    clock.now = T0 + 300_000;
    psp.tick();
    expectFakeError(() => psp.customerPays(order.reference), 'ORDER_EXPIRED');
    expect(bodies(psp.deliverWebhooks()).map((b) => [b.type, b.status])).toEqual([
      ['order.expired', 'FAILED'],
    ]);
  });
});

describe('liens réutilisables', () => {
  it('sans SUPPORTS_SINGLE_USE_ORDER : le lien est payé deux fois (deux encaissements)', () => {
    const { psp } = setup({
      capabilities: ALL.filter((c) => c.capability !== 'SUPPORTS_SINGLE_USE_ORDER'),
    });
    const ref = paidOrder(psp);
    psp.customerPays(ref);
    expect(psp.movements().map((m) => m.amountMinor)).toEqual([100n, 100n]);
  });

  it('usage unique validé : second paiement refusé', () => {
    const { psp } = setup();
    const ref = paidOrder(psp);
    expectFakeError(() => psp.customerPays(ref), 'ALREADY_PAID');
    expect(psp.movements()).toHaveLength(1);
  });
});

describe('webhooks signés : doublons, désordre, retards, pertes, rejeu', () => {
  it('signature HMAC du corps et de l’horodatage ; corps altéré ou mauvais secret ⇒ invalide', () => {
    const { psp } = setup();
    paidOrder(psp);
    const [created] = psp.deliverWebhooks();
    expect(created).toBeDefined();
    const d = created as FakeWebhookDelivery;
    const raw = new TextEncoder().encode(d.body);
    const ok = verifyFakeSignature(SECRET, d.headers['fake-signature'], raw);
    expect(ok).toEqual({ valid: true, timestampS: Math.floor(T0 / 1000) });
    expect(verifyFakeSignature('autre', d.headers['fake-signature'], raw).valid).toBe(false);
    expect(
      verifyFakeSignature(
        SECRET,
        d.headers['fake-signature'],
        new TextEncoder().encode(`${d.body} `),
      ).valid,
    ).toBe(false);
    expect(verifyFakeSignature(SECRET, undefined, raw).valid).toBe(false);
    expect(verifyFakeSignature(SECRET, 't=1,v1=zz', raw).valid).toBe(false);
  });

  it('doublons et ordre inversé (SUCCEEDED avant CREATED)', () => {
    const { psp } = setup({ scenario: { webhooks: { duplicate: true, reverse: true } } });
    paidOrder(psp);
    expect(bodies(psp.deliverWebhooks()).map((b) => b.type)).toEqual([
      'payment.captured',
      'order.created',
      'payment.captured',
      'order.created',
    ]);
  });

  it('retard : rien avant le délai, tout après', () => {
    const { psp, clock } = setup({ scenario: { webhooks: { delayMs: 60_000 } } });
    paidOrder(psp);
    expect(psp.deliverWebhooks()).toEqual([]);
    clock.now = T0 + 60_000;
    expect(psp.deliverWebhooks()).toHaveLength(2);
    expect(psp.pendingWebhookCount()).toBe(0);
  });

  it('IPN perdus pour un moyen (Yappy) ; rejeu d’un événement ancien', () => {
    const { psp, clock } = setup({ scenario: { webhooks: { loseMethods: ['YAPPY'] } } });
    const order = psp.createOrder({
      merchantReference: 'hold:h:CAPTURE:a1',
      method: 'YAPPY',
      amountMinor: 100n,
      currency: CUR,
      legs: LEGS_100,
      capture: 'AUTO',
    });
    psp.customerPays(order.reference);
    expect(psp.deliverWebhooks()).toEqual([]);
    // l'événement existe chez le PSP : rejouable plus tard, signé à l'heure courante
    clock.now = T0 + 3_600_000;
    const replayed = psp.replayWebhook('fk_evt_000002');
    expect(JSON.parse(replayed.body)).toMatchObject({
      type: 'payment.captured',
      status: 'SUCCEEDED',
    });
    expect(
      verifyFakeSignature(
        SECRET,
        replayed.headers['fake-signature'],
        new TextEncoder().encode(replayed.body),
      ).timestampS,
    ).toBe(Math.floor((T0 + 3_600_000) / 1000));
  });

  it('identifiants déterministes : deux exécutions identiques, mêmes références', () => {
    const run = () => {
      const { psp } = setup();
      paidOrder(psp);
      return psp.deliverWebhooks().map((d) => d.body);
    };
    expect(run()).toEqual(run());
  });
});
