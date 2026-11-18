/**
 * US-701 (ADR-169) — minuterie de ré-autorisation de la caution sur le PSP simulé (FAKE seulement,
 * C19), en USD (PA) et en PYG sans décimale (PY). Attendus : 19 US-225 critère 3 (« une
 * ré-autorisation est demandée avant l'échéance et, refusée, le trip est signalé à l'ops sans
 * débit »), 08 BR-PAY-06 (jamais de capture après l'expiration : décision avancée à expiration −
 * `deposit_safety_h`), 08 E4 (clé `{trip}:{segment}:v0-DEPOSIT-{caution}:…:i{n}:a{m}`, même clé au
 * rejeu, condensé SHA-256 au-delà de `IDEMPOTENCY_KEY_MAX_LEN`) et 17 §4.3 (issue inconnue ⇒
 * lecture puis même clé, jamais `REAUTHORIZED` à tort). Valeurs de temps refaites à la main.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createCurrencyRegistry } from '@rueda/money';
import { describe, expect, it } from 'vitest';
import type { OpsAlert } from '../../bus/index.js';
import { CapabilitySet } from '../internal/capabilities.js';
import { DepositRailExecutor } from '../internal/deposit-executor.js';
import type { DepositPaymentProvider } from '../internal/deposit-executor.js';
import { DepositReauthTimer } from '../internal/deposit-timer.js';
import type { DueDepositReauth } from '../internal/deposit-timer.js';
import { PaymentError } from '../internal/errors.js';
import { offSettlementRefundKey, depositOperationKey } from '../internal/idempotency.js';
import type { OperationStatus } from '../internal/port.js';
import type { PaymentProvider } from '../internal/port.js';
import type { DepositRailConfig } from '../internal/pg-deposit-config.js';
import { countryCases } from '../../../../test/support/countries.js';
import { fakeStack } from './fake-stack.js';
import type { FakeStackOptions } from './fake-stack.js';

const CURRENCIES = createCurrencyRegistry(
  (
    JSON.parse(
      readFileSync(new URL('../../cfg/data/currencies.json', import.meta.url), 'utf8'),
    ) as { currencies: { code: string; exponent: number }[] }
  ).currencies,
);
const PARAMS = (
  JSON.parse(readFileSync(new URL('../../cfg/data/params.json', import.meta.url), 'utf8')) as {
    params: { key: string; values: Record<string, unknown> }[];
  }
).params;
const p = (key: string, country: string): unknown =>
  PARAMS.find((x) => x.key === key)?.values[country];

const CASES = countryCases().map((c) => ({
  ...c,
  exponent: CURRENCIES.get(c.currency).exponent,
  deposit: 300n * 10n ** BigInt(CURRENCIES.get(c.currency).exponent),
}));

const H = 3_600_000;
const T = Date.parse('2031-07-10T10:00:00.000Z');
const at = (hours: number, minutes = 0): Date => new Date(T + hours * H + minutes * 60_000);

const IDS = {
  deposit: '0191d1a0-0000-7000-8000-000000000701',
  trip: '0191d1a0-0000-7000-8000-0000000007a1',
  segment: '0191d1a0-0000-7000-8000-0000000007b1',
  tender: '0191d1a0-0000-7000-8000-0000000007c1',
};

function configOf(
  c: (typeof CASES)[number],
  caps: readonly { capability: string; method: string; value: unknown; status: string }[],
): DepositRailConfig {
  return {
    triggerParams: {},
    amounts: undefined,
    railParams: {
      authLeadH: p('auth_lead_h', c.country) as number,
      releaseDelayH: p('release_delay_h', c.country) as number,
      marginH: p('marge_h', c.country) as number,
      safetyH: p('deposit_safety_h', c.country) as number,
      reauthLeadH: p('deposit_reauth_lead_h', c.country) as number,
      providerMaxHoldH: 168,
      chargeCapMinor: 0n,
      fundsHoldingEnabled: false,
    },
    feeNoticeH: null,
    // validité du PSP « à 7 j » de T57 (V = 168 h) : capacité absente de la matrice du FAKE
    capabilities: new CapabilitySet([
      ...caps.map((x) => ({ ...x, status: x.status as 'VALIDATED_SANDBOX' })),
      { capability: 'MAX_HOLD_HOURS', method: '*', value: 168, status: 'VALIDATED_SANDBOX' },
    ]),
  };
}

/** Méthode du port liée à l'adaptateur (champs privés de la classe), autre propriété telle quelle. */
function passThrough(target: PaymentProvider, prop: string | symbol): unknown {
  const v = Reflect.get(target, prop) as unknown;
  return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
}

type Transition = [
  string,
  string,
  number,
  { authExpiryAt: Date; decisionAt: Date; reauthDueAt: Date | null },
];

function setup(
  c: (typeof CASES)[number],
  options: FakeStackOptions & {
    wrap?: (p: PaymentProvider) => PaymentProvider;
    applied?: 'APPLIED' | 'STALE';
    noConnector?: boolean;
  } = {},
) {
  const stack = fakeStack(options);
  const keys: string[] = [];
  const base: PaymentProvider = options.wrap ? options.wrap(stack.provider) : stack.provider;
  const provider = new Proxy(base, {
    get(target, prop) {
      if (prop === 'reauthorize') {
        return (r: { idempotencyKey: string; providerReference: string }) => {
          keys.push(r.idempotencyKey);
          return target.reauthorize(r);
        };
      }
      return passThrough(target, prop);
    },
  });
  const transitions: Transition[] = [];
  const alerts: OpsAlert[] = [];
  const timer = new DepositReauthTimer({
    config: () => Promise.resolve(configOf(c, stack.capabilities)),
    transition: (id, event, seq, schedule) => {
      transitions.push([id, event, seq, schedule]);
      return Promise.resolve(options.applied ?? 'APPLIED');
    },
    alerts: {
      send: (a) => {
        alerts.push(a);
        return Promise.resolve();
      },
    },
    connectors: { get: (name) => (options.noConnector || name !== 'FAKE' ? undefined : provider) },
  });
  return { stack, timer, keys, transitions, alerts };
}

/** Autorisation de la caution posée sur le FAKE (rail a) : rend sa référence. */
async function authorize(c: (typeof CASES)[number], s: ReturnType<typeof setup>): Promise<string> {
  const executor = new DepositRailExecutor(s.stack.provider);
  const order = await executor.place(
    {
      depositId: IDS.deposit,
      tripReference: IDS.trip,
      tripId: IDS.trip,
      segmentId: IDS.segment,
      tenderId: IDS.tender,
      currency: CURRENCIES.get(c.currency),
    },
    { mechanism: 'REAUTH', amountMinor: c.deposit, fundsHoldingEnabled: false, attemptNo: 1 },
  );
  s.stack.psp.customerPays(order.providerReference);
  return order.providerReference;
}

/** T59 en rail (a) : autorisée à −24 h (expiration +144 h), libération à +144 h 25. */
const due = (c: (typeof CASES)[number], reference: string, seq = 0): DueDepositReauth => ({
  depositId: IDS.deposit,
  tripId: IDS.trip,
  segmentId: IDS.segment,
  tenderId: IDS.tender,
  country: c.country,
  currency: c.currency,
  currencyExponent: c.exponent,
  provider: 'FAKE',
  providerReference: reference,
  authExpiryAt: at(144),
  releaseAt: at(144, 25),
  reauthSeq: seq,
  now: at(120),
});

/** Clé de 08 E4 attendue, recomposée ici (forme du texte de 08), puis condensée (64 caractères). */
const expectedKey = (seq: number): string => {
  const plain = `${IDS.trip}:${IDS.segment}:v0-DEPOSIT-${IDS.deposit}:DEPOSIT_REAUTH:${IDS.tender}:i${seq}:a1`;
  return createHash('sha256').update(plain, 'utf8').digest('hex');
};

const pendingPort =
  (status: OperationStatus | 'THROW') =>
  (p: PaymentProvider): PaymentProvider =>
    new Proxy(p, {
      get(target, prop) {
        if (prop === 'reauthorize') {
          return (r: { providerReference: string }) =>
            status === 'THROW'
              ? Promise.reject(new PaymentError('UNKNOWN_OUTCOME', 'délai dépassé'))
              : Promise.resolve({ providerReference: r.providerReference, status });
        }
        return passThrough(target, prop);
      },
    });

describe.each(CASES)('$country ($currency) — minuterie de ré-autorisation', (c) => {
  it('acceptée ⇒ REAUTHORIZED : nouvelle expiration (+120 h + 168 h), décision à la libération, aucune alerte ; clé 08 E4 de rang 1', async () => {
    const s = setup(c);
    const ref = await authorize(c, s);
    expect(await s.timer.process(due(c, ref))).toBe('REAUTHORIZED');
    expect(s.transitions).toEqual([
      [
        IDS.deposit,
        'REAUTHORIZED',
        0,
        { authExpiryAt: at(288), decisionAt: at(144, 25), reauthDueAt: null },
      ],
    ]);
    expect(s.alerts).toEqual([]);
    expect(s.keys).toEqual([expectedKey(1)]);
  });

  it('refusée ⇒ REAUTH_REFUSED : décision avancée à expiration − 2 h, plus de minuterie, alerte ops DEPOSIT_REAUTH_FAILED, AUCUN débit', async () => {
    const s = setup(c, {
      scenario: { responses: { REAUTHORIZE: [{ kind: 'DECLINE', code: 'do_not_honor' }] } },
    });
    const ref = await authorize(c, s);
    expect(await s.timer.process(due(c, ref))).toBe('REFUSED');
    expect(s.transitions).toEqual([
      [
        IDS.deposit,
        'REAUTH_REFUSED',
        0,
        { authExpiryAt: at(144), decisionAt: at(142), reauthDueAt: null },
      ],
    ]);
    expect(s.alerts).toEqual([
      {
        code: 'DEPOSIT_REAUTH_FAILED',
        severity: 'P1',
        counts: { deposits: 1 },
        labels: { country: c.country, provider: 'FAKE' },
      },
    ]);
    expect(s.stack.psp.calls('MIT_CHARGE')).toBe(0);
    expect(s.stack.psp.movements()).toEqual([]);
  });

  for (const status of ['PENDING', 'SUBMITTED', 'UNKNOWN', 'THROW'] as const) {
    it(`issue ${status === 'THROW' ? 'inconnue (UNKNOWN_OUTCOME)' : status} ⇒ PENDING : aucun changement d'état, aucune alerte, jamais REAUTHORIZED`, async () => {
      const s = setup(c, { wrap: pendingPort(status) });
      const ref = await authorize(c, s);
      expect(await s.timer.process(due(c, ref))).toBe('PENDING');
      expect(await s.timer.process(due(c, ref))).toBe('PENDING');
      expect(s.transitions).toEqual([]);
      expect(s.alerts).toEqual([]);
      // le rejeu garde la MÊME clé (rang inchangé, 17 §4.3)
      expect(s.keys).toEqual([expectedKey(1), expectedKey(1)]);
    });
  }

  it('deuxième ré-autorisation (reauth_seq = 1) ⇒ clé de rang 2, distincte de la première', async () => {
    const s = setup(c);
    const ref = await authorize(c, s);
    expect(await s.timer.process(due(c, ref, 1))).toBe('REAUTHORIZED');
    expect(s.keys).toEqual([expectedKey(2)]);
  });

  it('aucun connecteur (production avant le lot C) ⇒ NO_CONNECTOR, aucun appel ; transition périmée ⇒ STALE sans alerte', async () => {
    const none = setup(c, { noConnector: true });
    const ref = await authorize(c, none);
    expect(await none.timer.process(due(c, ref))).toBe('NO_CONNECTOR');
    expect(none.stack.psp.calls('REAUTHORIZE')).toBe(0);
    const stale = setup(c, {
      applied: 'STALE',
      scenario: { responses: { REAUTHORIZE: [{ kind: 'DECLINE', code: 'do_not_honor' }] } },
    });
    const ref2 = await authorize(c, stale);
    expect(await stale.timer.process(due(c, ref2))).toBe('STALE');
    expect(stale.alerts).toEqual([]);
  });

  it('SUPPORTS_REAUTH non validée ⇒ refus sans appel au PSP, même signal ops', async () => {
    const s = setup(c, { without: ['SUPPORTS_REAUTH'] });
    const ref = await authorize(c, s);
    expect(await s.timer.process(due(c, ref))).toBe('REFUSED');
    expect(s.stack.psp.calls('REAUTHORIZE')).toBe(0);
    expect(s.alerts.map((a) => a.code)).toEqual(['DEPOSIT_REAUTH_FAILED']);
  });
});

describe('clés d’idempotence de la caution (08 E4, suite S-6)', () => {
  const parts = {
    tripId: 'trp_8f3a',
    segmentId: '1',
    depositId: 'dep_01',
    tenderId: 'tnd_card_01',
    instanceSeq: 1,
    attemptNo: 1,
  };

  it('variante hors règlement : `{trip}:{segment}:v0-DEPOSIT-{caution}:{opération}:{moyen}:i{n}:a{m}`', () => {
    expect(depositOperationKey({ ...parts, operationType: 'DEPOSIT_CAPTURE' })).toBe(
      'trp_8f3a:1:v0-DEPOSIT-dep_01:DEPOSIT_CAPTURE:tnd_card_01:i1:a1',
    );
    expect(depositOperationKey({ ...parts, operationType: 'DEPOSIT_VOID', instanceSeq: 2 })).toBe(
      'trp_8f3a:1:v0-DEPOSIT-dep_01:DEPOSIT_VOID:tnd_card_01:i2:a1',
    );
  });

  it('remboursement de la caution débitée = clé `offSettlementRefundKey` d’origine DEPOSIT (une seule forme)', () => {
    expect(depositOperationKey({ ...parts, operationType: 'REFUND' })).toBe(
      offSettlementRefundKey({ ...parts, originType: 'DEPOSIT', originId: parts.depositId }),
    );
  });

  it('jamais en collision avec une version de règlement (`v1`, `v2`…) ; opération inconnue refusée', () => {
    expect(depositOperationKey({ ...parts, operationType: 'MIT_CHARGE' })).toMatch(/:v0-DEPOSIT-/);
    expect(() =>
      depositOperationKey({ ...parts, operationType: 'AUTH' as 'DEPOSIT_AUTH' }),
    ).toThrow();
  });
});

// type utilisé par le port de test (garde de compilation)
export type _Port = DepositPaymentProvider;
