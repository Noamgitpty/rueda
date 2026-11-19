/**
 * US-701 (ADR-169) — caution figée au checkout, échéancier et vue du voyageur (08 BR-PAY-06
 * « Moment de l'évaluation », « Montant unique », « Libération à heure fixe », « Mécanisme » ;
 * 17 §3.2.7 ; 19 US-701 critères 1, 3 et 4). Attendus : oracle `docs/specs/tools/check_t49plus.py`
 * (T57 : décision à fin + 70 h ; T59 : refus, 3 jours possibles ; T70 : aucune caution ; T72 c :
 * PARAM_MISSING), exportés par `@rueda/money/golden-vectors`, et calcul de 08 refait à la main
 * (heures) ; jamais le code testé. Chaque cas en USD (PA) et en PYG sans décimale (PY), paramètres
 * lus dans la graine (`cfg/data/params.json`).
 */
import { readFileSync } from 'node:fs';
import { createCurrencyRegistry } from '@rueda/money';
import { checksFor, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { GoldenValue } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import { CapabilitySet } from './capabilities.js';
import type { CapabilityRecord } from './capabilities.js';
import {
  DepositCheckoutGate,
  evaluateDepositCheckout,
  guestViewOfRecorded,
} from './deposit-checkout.js';
import type {
  DepositCheckoutContext,
  DepositCheckoutRead,
  DepositCheckoutStore,
  DepositDecisionRecord,
  DepositReadRefusal,
  DepositRecordOutcome,
} from './deposit-checkout.js';
import { depositScheduleAfterReauth } from './deposit-rails.js';
import type { DepositRailConfig } from './pg-deposit-config.js';
import type { DepositValueClass } from './deposit-triggers.js';
import { countryCases } from '../../../../test/support/countries.js';

const set = loadGoldenVectors();
const check = (vectorId: string, label: RegExp): GoldenValue => {
  const found = checksFor(set, vectorId).find((c) => label.test(c.label));
  if (found === undefined) throw new Error(`contrôle ${vectorId} ${label} absent`);
  return found.expected;
};

const read = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../cfg/data/${file}`, import.meta.url), 'utf8'));
const CURRENCIES = createCurrencyRegistry(
  (read('currencies.json') as { currencies: { code: string; exponent: number }[] }).currencies,
);
const PARAMS = (
  read('params.json') as { params: { key: string; values: Record<string, unknown> }[] }
).params;
const p = (key: string, country: string): unknown =>
  PARAMS.find((x) => x.key === key)?.values[country];

const H = 3_600_000;
const T = Date.parse('2031-07-10T10:00:00.000Z');
const at = (hours: number, minutes = 0): Date => new Date(T + hours * H + minutes * 60_000);

/**
 * Montant de test de `deposit_amount[pays][LUXE]` selon l'exposant de la devise du pays (US-702,
 * revues argent et qa d'US-701) : les oracles expriment T57 en centimes (exposant 2 : 300,00 =
 * capture + VOID de T57, 30 000) et T73 a sans décimale (exposant 0 : 1 500 000, `AMT_PY`) ; jamais
 * 300 mis à l'échelle. Aucun code de pays ni de devise écrit ici.
 */
const T57 = check('T57', /^T57$/) as Record<string, bigint>;
const T73 = check('T73', /^T73 a\/b$/) as unknown[];
const DEPOSIT_BY_EXPONENT = new Map<number, bigint>([
  [2, (T57['capture'] ?? 0n) + (T57['void'] ?? 0n)],
  [0, T73[1] as bigint],
]);
const CASES = countryCases().map((c) => {
  const deposit = DEPOSIT_BY_EXPONENT.get(CURRENCIES.get(c.currency).exponent);
  if (deposit === undefined) throw new Error(`devise sans vecteur de caution : ${c.currency}`);
  return { ...c, deposit };
});

const rec = (capability: string, value: unknown): CapabilityRecord => ({
  capability,
  method: '*',
  value,
  status: 'VALIDATED_SANDBOX',
});

/** PSP « à 7 j » de T57 (V = 168 h) ; `extra` : capacités ajoutées (ré-autorisation). */
function config(
  c: (typeof CASES)[number],
  over: { amounts?: DepositRailConfig['amounts']; extra?: CapabilityRecord[] } = {},
): DepositRailConfig {
  return {
    triggerParams: {
      alwaysRequired: p('deposit_always_required', c.country) as boolean,
      triggerClasses: p('deposit_trigger_classes', c.country) as DepositValueClass[],
      youngDriverAge: p('deposit_young_driver_age', c.country) as number,
      youngDriverClasses: p('deposit_young_driver_classes', c.country) as DepositValueClass[],
      onRiskFlag: p('deposit_on_risk_flag', c.country) as boolean,
      riskControlDeployed: p('risk_control_deployed', c.country) as boolean,
    },
    amounts: 'amounts' in over ? over.amounts : { LUXE: c.deposit },
    railParams: {
      authLeadH: p('auth_lead_h', c.country) as number,
      releaseDelayH: p('release_delay_h', c.country) as number,
      marginH: p('marge_h', c.country) as number,
      safetyH: p('deposit_safety_h', c.country) as number,
      reauthLeadH: p('deposit_reauth_lead_h', c.country) as number,
      providerMaxHoldH: 168,
      chargeCapMinor: 0n,
      fundsHoldingEnabled: p('funds_holding_enabled', c.country) as boolean,
    },
    feeNoticeH: p('deposit_fee_notice_h', c.country) as number,
    capabilities: new CapabilitySet([
      rec('SUPPORTS_PREAUTH', true),
      rec('MAX_HOLD_HOURS', 168),
      rec('SUPPORTS_PARTIAL_CAPTURE', true),
      rec('SUPPORTS_VOID', true),
      rec('SUPPORTS_MIT', true),
      ...(over.extra ?? []),
    ]),
  };
}

function ctx(
  c: (typeof CASES)[number],
  over: { valueClass?: DepositValueClass | null; tripMinutes?: number } = {},
): DepositCheckoutContext {
  return {
    country: c.country,
    currency: c.currency,
    valueClass: over.valueClass === undefined ? 'LUXE' : over.valueClass,
    // réservé bien avant : auth_at = début − 24 h (T57)
    now: at(-24 * 10),
    scheduledStart: at(0),
    scheduledEnd: at(0, over.tripMinutes ?? 72 * 60),
    provider: 'FAKE',
  };
}

describe.each(CASES)('$country ($currency) — décision figée au checkout', (c) => {
  it('critère 1 (T57) : 3 jours chez un PSP à 7 j ⇒ pré-autorisation unique à auth_at = début − 24 h ; libération à fin + 72 h ; décision à fin + 70 h', () => {
    const t57 = check('T57', /^T57$/) as { single: boolean };
    const r = evaluateDepositCheckout(ctx(c), config(c));
    expect(t57.single).toBe(true);
    // 08 : H_requise = 24 + 72 + 72 = 168 h ≤ V = 168 h ; décision = min(fin + 72 h ; fin + 72 h − 2 h)
    expect(r.record).toMatchObject({
      mechanism: 'PREAUTH_SINGLE',
      triggers: ['CLASS'],
      amountMinor: c.deposit,
      hRequiredHours: 168,
      vHours: 168,
      authAt: at(-24),
      releaseAt: at(72 + 72),
      decisionAt: at(72 + 70),
      reauthDueAt: null,
    });
    expect(r.view).toEqual({
      status: 'REQUIRED',
      amountMinor: c.deposit,
      currency: c.currency,
      kind: 'HOLD',
      releaseAt: at(72 + 72),
    });
  });

  it('critère 3 (T59) : 3 j + 25 min, SUPPORTS_REAUTH non validée ⇒ refus SANS ligne, 3 jours possibles', () => {
    const [single] = check('T59', /forme heures/) as [boolean];
    const r = evaluateDepositCheckout(ctx(c, { tripMinutes: 72 * 60 + 25 }), config(c));
    expect(single).toBe(false);
    expect(r.record).toBeNull();
    // V − avance − libération = 168 − 24 − 72 = 72 h ⇒ 3 jours entiers
    expect(r.view).toEqual({
      status: 'UNAVAILABLE',
      code: 'DEPOSIT_RAIL_UNAVAILABLE',
      maxBookableDays: 3,
    });
  });

  it('critère 3 (T59, rail a) : SUPPORTS_REAUTH validée ⇒ REAUTH ; ré-autorisation à (auth_at + V) − 24 h ; décision planifiée à la libération', () => {
    const r = evaluateDepositCheckout(
      ctx(c, { tripMinutes: 72 * 60 + 25 }),
      config(c, { extra: [rec('SUPPORTS_REAUTH', true)] }),
    );
    // auth_at = −24 h ; expiration prévue = +144 h ; ré-autorisation à +120 h
    expect(r.record).toMatchObject({
      mechanism: 'REAUTH',
      authAt: at(-24),
      releaseAt: at(72 + 72, 25),
      decisionAt: at(72 + 72, 25),
      reauthDueAt: at(120),
    });
  });

  it('T70 : véhicule STANDARD ⇒ NOT_REQUIRED figé (montant 0, aucun déclencheur, aucune échéance), vue « aucune caution »', () => {
    const [none] = check('T70', /sans caution/) as [boolean];
    expect(none).toBe(false);
    const r = evaluateDepositCheckout(
      ctx(c, { valueClass: 'STANDARD', tripMinutes: 72 * 60 + 25 }),
      config(c),
    );
    expect(r.record).toMatchObject({
      mechanism: 'NOT_REQUIRED',
      triggers: [],
      amountMinor: 0n,
      hRequiredHours: null,
      authAt: null,
      releaseAt: null,
      decisionAt: null,
      reauthDueAt: null,
    });
    expect(r.view).toEqual({ status: 'NONE' });
  });

  it('T72 c : caution exigée sans deposit_amount (LUXE À DÉCIDER) ⇒ PARAM_MISSING, aucune ligne, aucun jour', () => {
    expect(check('T72', /a\/b\/c\/d/)).toEqual(expect.arrayContaining(['PARAM_MISSING']));
    const r = evaluateDepositCheckout(ctx(c), config(c, { amounts: undefined }));
    expect(r.record).toBeNull();
    expect(r.view).toEqual({ status: 'UNAVAILABLE', code: 'PARAM_MISSING', maxBookableDays: null });
  });

  it('classe inconnue (fail-closed) ⇒ CLASS vrai, jamais NOT_REQUIRED', () => {
    const r = evaluateDepositCheckout(ctx(c, { valueClass: null }), config(c));
    expect(r.record).toBeNull();
    expect(r.decision.triggers.triggers).toContain('CLASS');
  });

  it('[C2] : params_snapshot sans date ni donnée personnelle ; la vue du voyageur ne porte que statut, montant, devise, nature, libération', () => {
    const r = evaluateDepositCheckout(ctx(c), config(c));
    const snapshot = JSON.stringify(r.record?.paramsSnapshot);
    expect(snapshot).not.toMatch(/birth|naissance|\d{4}-\d{2}-\d{2}/);
    expect(Object.keys(r.record?.paramsSnapshot ?? {}).sort()).toEqual([
      'params',
      'provider',
      'riskEvaluated',
      'valueClass',
      'version',
      'youngestDriverAge',
    ]);
    expect(Object.keys(r.view).sort()).toEqual([
      'amountMinor',
      'currency',
      'kind',
      'releaseAt',
      'status',
    ]);
  });
});

describe.each(CASES)('$country ($currency) — échéances après une ré-autorisation', (c) => {
  const params = {
    safetyH: p('deposit_safety_h', c.country) as number,
    reauthLeadH: p('deposit_reauth_lead_h', c.country) as number,
  };
  const current = { authExpiryAt: at(144), releaseAt: at(144, 25) };

  it('acceptée à +120 h ⇒ expiration +288 h, aucune autre ré-autorisation, décision à la libération', () => {
    expect(depositScheduleAfterReauth('REAUTHORIZED', current, at(120), 168, params)).toEqual({
      authExpiryAt: at(288),
      decisionAt: at(144, 25),
      reauthDueAt: null,
    });
  });

  it('refusée ⇒ expiration inchangée, décision AVANT elle (expiration − 2 h), plus de minuterie', () => {
    expect(depositScheduleAfterReauth('REAUTH_REFUSED', current, at(120), 168, params)).toEqual({
      authExpiryAt: at(144),
      decisionAt: at(142),
      reauthDueAt: null,
    });
  });
});

/** Magasin en mémoire : une décision par hold, comme la base (contrainte d'unicité). */
class MemoryStore implements DepositCheckoutStore {
  recorded: DepositDecisionRecord | null = null;
  writes = 0;
  constructor(
    private readonly context: DepositCheckoutContext | DepositReadRefusal,
    private readonly outcome: DepositRecordOutcome = 'RECORDED',
  ) {}
  read(): Promise<DepositCheckoutRead | DepositReadRefusal> {
    if (typeof this.context === 'string') return Promise.resolve(this.context);
    if (this.recorded !== null) {
      return Promise.resolve({
        kind: 'RECORDED',
        deposit: {
          mechanism: this.recorded.mechanism,
          amountMinor: this.recorded.amountMinor,
          currency: this.context.currency,
          releaseAt: this.recorded.releaseAt,
        },
      });
    }
    return Promise.resolve({ kind: 'OPEN', context: this.context });
  }
  record(_p: Buffer, _h: string, r: DepositDecisionRecord): Promise<DepositRecordOutcome> {
    this.writes++;
    if (this.outcome === 'RECORDED') this.recorded = r;
    return Promise.resolve(this.outcome);
  }
}

describe.each(CASES)('$country ($currency) — porte du checkout', (c) => {
  const proof = Buffer.from('jeton');
  const gateOf = (store: MemoryStore, cfg = config(c)) =>
    new DepositCheckoutGate(store, { read: () => Promise.resolve(cfg) });

  it('lecture de S05 : évaluée SANS écriture ; décision figée ensuite relue telle quelle', async () => {
    const store = new MemoryStore(ctx(c));
    const g = gateOf(store);
    expect(await g.view(proof, 'h', true)).toMatchObject({ status: 'REQUIRED' });
    expect(await g.view(proof, 'h', false)).toBeNull();
    expect(store.writes).toBe(0);
    expect(await g.enforce(proof, 'h')).toMatchObject({ kind: 'ACCEPTED' });
    expect(store.writes).toBe(1);
    // seconde tentative de paiement : la décision figée fait foi, rien n'est réécrit
    expect(await g.enforce(proof, 'h')).toMatchObject({ kind: 'ACCEPTED' });
    expect(store.writes).toBe(1);
    expect(await g.view(proof, 'h', false)).toEqual({
      status: 'REQUIRED',
      amountMinor: c.deposit,
      currency: c.currency,
      kind: 'HOLD',
      releaseAt: at(72 + 72),
    });
  });

  it('refus (T59) ⇒ REFUSED et AUCUNE écriture', async () => {
    const store = new MemoryStore(ctx(c, { tripMinutes: 72 * 60 + 25 }));
    expect(await gateOf(store).enforce(proof, 'h')).toEqual({
      kind: 'REFUSED',
      view: { status: 'UNAVAILABLE', code: 'DEPOSIT_RAIL_UNAVAILABLE', maxBookableDays: 3 },
    });
    expect(store.writes).toBe(0);
  });

  it('refus de la base (hold devenu terminal, devis indisponible, session) ⇒ rendu tel quel', async () => {
    expect(await gateOf(new MemoryStore(ctx(c), 'HOLD_NOT_PAYABLE')).enforce(proof, 'h')).toEqual({
      kind: 'HOLD_NOT_PAYABLE',
    });
    expect(await gateOf(new MemoryStore('QUOTE_UNAVAILABLE')).enforce(proof, 'h')).toEqual({
      kind: 'QUOTE_UNAVAILABLE',
    });
    expect(await gateOf(new MemoryStore('QUOTE_UNAVAILABLE')).view(proof, 'h', true)).toBeNull();
    expect(await gateOf(new MemoryStore('AUTH_REQUIRED')).view(proof, 'h', true)).toBe(
      'AUTH_REQUIRED',
    );
  });

  it('vue d’une décision figée : NOT_REQUIRED ⇒ NONE ; débit puis remboursement ⇒ CHARGE', () => {
    expect(
      guestViewOfRecorded({
        mechanism: 'NOT_REQUIRED',
        amountMinor: 0n,
        currency: c.currency,
        releaseAt: null,
      }),
    ).toEqual({ status: 'NONE' });
    expect(
      guestViewOfRecorded({
        mechanism: 'CHARGE_THEN_REFUND',
        amountMinor: c.deposit,
        currency: c.currency,
        releaseAt: at(144),
      }),
    ).toMatchObject({ status: 'REQUIRED', kind: 'CHARGE' });
  });
});
