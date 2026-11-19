/**
 * US-702 (ADR-172) — décision de la caution à l'heure de décision sur le PSP simulé (FAKE seulement,
 * C19), en USD (PA) et en PYG sans décimale (PY). Attendus : 19 US-702 (critère 1 : T58 « VOID
 * 300,00 puis MIT 12,00 » ; critère 2 : sans frais annexes, VOID automatique de la caution entière,
 * journalisé et notifié, jamais suspendu par une réclamation), oracle `check_t49plus.py` (T57, T58 ;
 * `@rueda/money/golden-vectors`) et T73 (montant de test PYG `deposit_amount[PY][LUXE]` 1 500 000),
 * 08 BR-PAY-06 (jamais de capture après l'expiration), 08 E3 repli 4, 08 E4 (clés), 17 §4.3 (issue
 * inconnue ⇒ même clé). Heures refaites à la main ; jamais le code testé.
 */
import { readFileSync } from 'node:fs';
import { createCurrencyRegistry, money, ratio } from '@rueda/money';
import { checksFor, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { GoldenValue } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import type { OpsAlert } from '../../bus/index.js';
import { CapabilitySet } from '../internal/capabilities.js';
import { DepositDecisionTimer, NO_DEPOSIT_FEES } from '../internal/deposit-decision.js';
import type {
  DepositFeeSource,
  DepositOutcome,
  DueDepositDecision,
} from '../internal/deposit-decision.js';
import { DepositRailExecutor } from '../internal/deposit-executor.js';
import { depositOperationKey } from '../internal/idempotency.js';
import type { DepositRailConfig } from '../internal/pg-deposit-config.js';
import { countryCases } from '../../../../test/support/countries.js';
import { fakeStack } from './fake-stack.js';
import type { FakeStackOptions } from './fake-stack.js';

const set = loadGoldenVectors();
const check = (vectorId: string, label: RegExp): GoldenValue => {
  const found = checksFor(set, vectorId).find((c) => label.test(c.label));
  if (found === undefined) throw new Error(`contrôle ${vectorId} ${label} absent`);
  return found.expected;
};
const T57 = check('T57', /^T57$/) as Record<string, bigint>;
const T58 = check('T58', /^T58$/) as Record<string, bigint>;
/** T73 a/b : (déclencheurs a, montant a = LUXE, déclencheurs b, montant b = STANDARD). */
const T73 = check('T73', /^T73 a\/b$/) as unknown[];

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

/**
 * Montant de test de la caution selon l'exposant de la devise du pays : les oracles expriment T57 /
 * T58 en centimes (exposant 2 : 300,00 = 30 000, carburant 12,00 = 1 200) et T73 a sans décimale
 * (exposant 0 : `deposit_amount[PY][LUXE]` = 1 500 000). Les frais de T57 / T58 n'existent qu'en
 * centimes : les cas de frais tournent sur les pays dont la devise a l'exposant du vecteur. Aucun
 * code de pays ni de devise écrit ici.
 */
const DEPOSIT_BY_EXPONENT = new Map<number, bigint>([
  [2, (T57['capture'] ?? 0n) + (T57['void'] ?? 0n)],
  [0, T73[1] as bigint],
]);
const CASES = countryCases().map((c) => {
  const cur = CURRENCIES.get(c.currency);
  const deposit = DEPOSIT_BY_EXPONENT.get(cur.exponent);
  if (deposit === undefined) throw new Error(`devise sans vecteur de caution : ${c.currency}`);
  return { ...c, cur, deposit };
});
const T58_CASES = CASES.filter((c) => c.cur.exponent === 2);

const H = 3_600_000;
/** T57 : fin du trip ; décision à fin + 70 h, expiration renvoyée à fin + 72 h (V = 168 h). */
const END = Date.parse('2031-07-13T10:00:00.000Z');
const at = (hours: number): Date => new Date(END + hours * H);

const IDS = {
  deposit: '0191d1a0-0000-7000-8000-000000000702',
  trip: '0191d1a0-0000-7000-8000-0000000007a2',
  segment: '0191d1a0-0000-7000-8000-0000000007b2',
  tender: '0191d1a0-0000-7000-8000-0000000007c2',
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
    feeNoticeH: p('deposit_fee_notice_h', c.country) as number,
    capabilities: new CapabilitySet(
      caps.map((x) => ({ ...x, status: x.status as 'VALIDATED_SANDBOX' })),
    ),
  };
}

/** Carburant de T57 / T58 : 12,00 à 100 % pour l'hôte, prouvé, notifié à fin + 1 h, non contesté. */
const fuelSource =
  (c: (typeof CASES)[number], token: string | null): DepositFeeSource =>
  () =>
    Promise.resolve({
      fees: [
        {
          id: 'fuel',
          amount: money(T58['mit'] ?? 0n, c.cur),
          hostShare: ratio(1n, 1n),
          proven: true,
          notifiedAt: at(1),
          disputed: false,
        },
      ],
      instrumentToken: token,
    });

/** Sans capture partielle pour la carte (moyen de la caution) : le cas de T58. */
const NO_PARTIAL_CAPTURE = [
  { capability: 'SUPPORTS_PARTIAL_CAPTURE', method: '*', value: true, status: 'VALIDATED_SANDBOX' },
  {
    capability: 'SUPPORTS_PARTIAL_CAPTURE',
    method: 'CARD',
    value: false,
    status: 'VALIDATED_SANDBOX',
  },
] as const;

async function setup(
  c: (typeof CASES)[number],
  options: FakeStackOptions & {
    fees?: DepositFeeSource;
    applied?: 'APPLIED' | 'STALE';
    noConnector?: boolean;
  } = {},
) {
  const stack = fakeStack(options);
  // pose de la caution (lot C : à `auth_at`) : pré-autorisation MANUAL acceptée par le voyageur
  const order = await new DepositRailExecutor(stack.provider).place(
    {
      depositId: IDS.deposit,
      tripReference: IDS.trip,
      tripId: IDS.trip,
      segmentId: IDS.segment,
      tenderId: IDS.tender,
      currency: c.cur,
    },
    {
      mechanism: 'PREAUTH_SINGLE',
      amountMinor: c.deposit,
      fundsHoldingEnabled: false,
      attemptNo: 1,
    },
  );
  stack.psp.customerPays(order.providerReference);
  const decided: [string, number, DepositOutcome][] = [];
  const alerts: OpsAlert[] = [];
  const timer = new DepositDecisionTimer({
    config: () => Promise.resolve(configOf(c, stack.capabilities)),
    decide: (id, seq, outcome) => {
      decided.push([id, seq, outcome]);
      return Promise.resolve(options.applied ?? 'APPLIED');
    },
    fees: options.fees ?? NO_DEPOSIT_FEES,
    alerts: {
      send: (a) => {
        alerts.push(a);
        return Promise.resolve();
      },
    },
    connectors: {
      get: (name) => (options.noConnector || name !== 'FAKE' ? undefined : stack.provider),
    },
  });
  const due = (over: Partial<DueDepositDecision> = {}): DueDepositDecision => ({
    depositId: IDS.deposit,
    tripId: IDS.trip,
    segmentId: IDS.segment,
    tenderId: IDS.tender,
    country: c.country,
    currency: c.currency,
    currencyExponent: c.cur.exponent,
    provider: 'FAKE',
    providerReference: order.providerReference,
    mechanism: 'PREAUTH_SINGLE',
    amountMinor: c.deposit,
    decisionAt: at(70),
    authExpiryAt: at(72),
    reauthSeq: 0,
    now: at(70),
    ...over,
  });
  return { stack, timer, decided, alerts, due };
}

const voidKey = (n: number) =>
  depositOperationKey({
    tripId: IDS.trip,
    segmentId: IDS.segment,
    depositId: IDS.deposit,
    operationType: 'DEPOSIT_VOID',
    tenderId: IDS.tender,
    instanceSeq: n,
    attemptNo: 1,
  });

describe.each(T58_CASES)('US-702 — T57 / T58 à fin + 70 h ($country, $currency)', (c) => {
  it('critère 1 (T58) : PSP sans capture partielle ⇒ VOID de la caution entière PUIS débit MIT du carburant (jambe HOST), VOIDED reporté', async () => {
    const s = await setup(c, {
      override: [...NO_PARTIAL_CAPTURE],
      fees: fuelSource(c, 'tok_card'),
    });
    expect(await s.timer.process(s.due())).toBe('VOIDED');
    expect(s.stack.psp.calls('VOID')).toBe(1);
    expect(s.stack.psp.calls('CAPTURE')).toBe(0);
    expect(s.stack.psp.movements().map((m) => [m.operation, m.amountMinor, m.legs?.HOST])).toEqual([
      ['MIT_CHARGE', T58['mit'], T58['mit']],
    ]);
    expect(s.decided).toEqual([
      [
        IDS.deposit,
        0,
        { status: 'VOIDED', capturedMinor: T58['capture'], releasedMinor: T58['void'] },
      ],
    ]);
    expect(s.alerts).toEqual([]);
  });

  it('T57 : capture partielle validée ⇒ capture 12,00 (jambe HOST) puis VOID 288,00, PARTIALLY_CAPTURED reporté', async () => {
    const s = await setup(c, { fees: fuelSource(c, 'tok_card') });
    expect(await s.timer.process(s.due())).toBe('PARTIALLY_CAPTURED');
    expect(s.stack.psp.movements().map((m) => [m.operation, m.amountMinor, m.legs?.HOST])).toEqual([
      ['CAPTURE', T57['capture'], T57['capture']],
    ]);
    expect(s.stack.psp.calls('VOID')).toBe(1);
    expect(s.decided[0]?.[2]).toEqual({
      status: 'PARTIALLY_CAPTURED',
      capturedMinor: T57['capture'],
      releasedMinor: T57['void'],
    });
  });

  it('sans carte enregistrée (aucun consentement MIT) : la caution est libérée quand même, frais en dette, alerte DEPOSIT_FEES_UNCOLLECTED', async () => {
    const s = await setup(c, { override: [...NO_PARTIAL_CAPTURE], fees: fuelSource(c, null) });
    expect(await s.timer.process(s.due())).toBe('VOIDED');
    expect(s.stack.psp.calls('MIT_CHARGE')).toBe(0);
    expect(s.decided[0]?.[2]).toEqual({
      status: 'VOIDED',
      capturedMinor: 0n,
      releasedMinor: c.deposit,
    });
    expect(s.alerts.map((a) => [a.code, a.severity])).toEqual([['DEPOSIT_FEES_UNCOLLECTED', 'P2']]);
  });
});

describe.each(CASES)('US-702 — libération automatique ($country, $currency)', (c) => {
  it('critère 2 : aucun frais annexe (source de production) ⇒ VOID automatique de la caution entière, clé 08 E4, aucune capture ni MIT, VOIDED reporté', async () => {
    const s = await setup(c);
    expect(await s.timer.process(s.due())).toBe('VOIDED');
    expect(s.stack.psp.calls('VOID')).toBe(1);
    expect(s.stack.psp.calls('CAPTURE')).toBe(0);
    expect(s.stack.psp.calls('MIT_CHARGE')).toBe(0);
    expect(s.stack.psp.movements()).toEqual([]);
    expect(s.decided).toEqual([
      [IDS.deposit, 0, { status: 'VOIDED', capturedMinor: 0n, releasedMinor: c.deposit }],
    ]);
    expect(voidKey(1)).toBe(
      `${IDS.trip}:${IDS.segment}:v0-DEPOSIT-${IDS.deposit}:DEPOSIT_VOID:${IDS.tender}:i1:a1`,
    );
  });

  it('autorisation expirée à la lecture ⇒ EXPIRED sans aucun appel au PSP (jamais de capture après auth_expiry)', async () => {
    const s = await setup(c);
    expect(await s.timer.process(s.due({ now: at(72) }))).toBe('EXPIRED');
    expect(s.stack.psp.calls('VOID')).toBe(0);
    expect(s.stack.psp.calls('CAPTURE')).toBe(0);
    expect(s.decided[0]?.[2]).toEqual({
      status: 'EXPIRED',
      capturedMinor: 0n,
      releasedMinor: c.deposit,
    });
  });

  it('17 §4.3 : VOID d’issue inconnue ⇒ rien n’est écrit ; au passage suivant la MÊME clé aboutit sans second appel effectif', async () => {
    const s = await setup(c, {
      scenario: { responses: { VOID: [{ kind: 'TIMEOUT_AFTER_SUCCESS' }] } },
    });
    expect(await s.timer.process(s.due())).toBe('PENDING');
    expect(s.decided).toEqual([]);
    expect(await s.timer.process(s.due())).toBe('VOIDED');
    expect(s.decided).toHaveLength(1);
    expect(s.stack.psp.movements()).toEqual([]);
  });

  it('08 E3 repli 4 : VOID refusé ⇒ autorisation laissée expirer (EXPIRED reporté), alerte DEPOSIT_DECISION_FAILED (P1)', async () => {
    const s = await setup(c, {
      scenario: { responses: { VOID: [{ kind: 'DECLINE', code: 'void_refused' }] } },
    });
    expect(await s.timer.process(s.due())).toBe('EXPIRED');
    expect(s.decided[0]?.[2]).toEqual({
      status: 'EXPIRED',
      capturedMinor: 0n,
      releasedMinor: c.deposit,
    });
    expect(s.alerts.map((a) => [a.code, a.severity, a.labels])).toEqual([
      ['DEPOSIT_DECISION_FAILED', 'P1', { country: c.country, provider: 'FAKE' }],
    ]);
  });

  it('US-702b : PSP injoignable au VOID (la requête ne l’a pas atteint) ⇒ jamais EXPIRED, rien d’écrit, nouvel essai ; DEPOSIT_DECISION_FAILED une fois par caution et par cause, puis VOIDED', async () => {
    const down = { kind: 'UNAVAILABLE' } as const;
    const s = await setup(c, { scenario: { responses: { VOID: [down, down, down, down] } } });
    // trois passages de la tâche (une minute chacun) : une seule alerte
    for (let i = 0; i < 3; i += 1) expect(await s.timer.process(s.due())).toBe('FAILED');
    expect(s.decided).toEqual([]);
    expect(s.alerts.map((a) => [a.code, a.severity, a.labels])).toEqual([
      ['DEPOSIT_DECISION_FAILED', 'P1', { country: c.country, provider: 'FAKE' }],
    ]);
    // une autre caution en échec pour la même cause : sa propre alerte
    const other = '0190f5a2-7c3e-7d4b-8a1f-00000000d0d0';
    expect(await s.timer.process(s.due({ depositId: other }))).toBe('FAILED');
    expect(s.alerts).toHaveLength(2);
    // le PSP revient : VOID aboutit (même clé), VOIDED reporté, aucune alerte de plus
    expect(await s.timer.process(s.due())).toBe('VOIDED');
    expect(s.decided.map(([id, , o]) => [id, o.status])).toEqual([[IDS.deposit, 'VOIDED']]);
    expect(s.alerts).toHaveLength(2);
  });

  it('aucun connecteur (production avant le lot C) ⇒ rien n’est envoyé ni écrit ; décision concurrente ⇒ STALE sans alerte', async () => {
    const none = await setup(c, { noConnector: true });
    expect(await none.timer.process(none.due())).toBe('NO_CONNECTOR');
    expect(none.stack.psp.calls('VOID')).toBe(0);
    expect(none.decided).toEqual([]);
    const stale = await setup(c, { applied: 'STALE' });
    expect(await stale.timer.process(stale.due())).toBe('STALE');
    expect(stale.alerts).toEqual([]);
  });
});
