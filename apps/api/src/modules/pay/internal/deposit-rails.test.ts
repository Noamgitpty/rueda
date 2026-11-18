/**
 * Rails de la caution (US-225 ; 08 BR-PAY-06 « Mécanisme », « Libération à heure fixe » ; E3).
 * Attendus : contrôles de l'oracle `docs/specs/tools/check_t49plus.py` (T57, T58, T59, T69, T70 ;
 * `@rueda/money/golden-vectors`) et, pour le Paraguay, le même calcul de 08 refait à la main sur les
 * montants de test de T73 (1 500 000 PYG) — jamais le code testé. Chaque cas en USD et en PYG.
 */
import { readFileSync } from 'node:fs';
import { allocHost, createCurrencyRegistry, money, ratio } from '@rueda/money';
import { checksFor, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { GoldenValue } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import { CapabilitySet } from './capabilities.js';
import type { CapabilityRecord } from './capabilities.js';
import {
  decideDepositGate,
  depositAuthExpiry,
  depositDecisionAt,
  depositReauthDueAt,
  depositReleaseAt,
  nextDepositStatus,
  planDepositDecision,
  fallbackAfterCaptureFailure,
  selectDepositRail,
} from './deposit-rails.js';
import type { DepositGateInput, DepositRailParams } from './deposit-rails.js';
import type { DepositTriggerParams } from './deposit-triggers.js';
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
 * Cas par pays configuré (CLAUDE.md point 3, lus dans la configuration, jamais en constantes) :
 * les vecteurs T57–T58 de 08 (caution 300,00, carburant 12,00, en unités MAJEURES) rejoués dans la
 * devise du pays ; l'oracle les exporte en centimes (exposant 2) : `scale` les ramène à l'exposant
 * de la devise (USD : identiques ; PYG sans décimale : 300 et 12). Les opérations de BR-PAY-06
 * (minimum, différence, part de 100 %) sont linéaires : l'attendu se met à la même échelle.
 */
const CASES = countryCases().map((c) => {
  const cur = CURRENCIES.get(c.currency);
  const scale = (cents: bigint): bigint => (cents * 10n ** BigInt(cur.exponent)) / 100n;
  return { ...c, cur, scale, deposit: scale(30_000n), fuel: scale(1_200n) };
});

const rec = (capability: string, value: unknown): CapabilityRecord => ({
  capability,
  method: '*',
  value,
  status: 'VALIDATED_SANDBOX',
});

/** PSP « à 7 j » de T57 : pré-autorisation, capture partielle, VOID, MIT ; V = 168 h. */
function caps(options: { without?: string[]; extra?: CapabilityRecord[] } = {}): CapabilitySet {
  const base = [
    rec('SUPPORTS_PREAUTH', true),
    rec('MAX_HOLD_HOURS', 168),
    rec('SUPPORTS_PARTIAL_CAPTURE', true),
    rec('SUPPORTS_VOID', true),
    rec('SUPPORTS_MIT', true),
    rec('SUPPORTS_REFUND', true),
  ].filter((r) => !(options.without ?? []).includes(r.capability));
  return new CapabilitySet([...base, ...(options.extra ?? [])]);
}

/** Paramètres de rail de la graine (params.json) + validité du PSP de test (lot C : par PSP). */
function railParams(country: string, over: Partial<DepositRailParams> = {}): DepositRailParams {
  return {
    authLeadH: p('auth_lead_h', country) as number,
    releaseDelayH: p('release_delay_h', country) as number,
    marginH: p('marge_h', country) as number,
    safetyH: p('deposit_safety_h', country) as number,
    reauthLeadH: p('deposit_reauth_lead_h', country) as number,
    providerMaxHoldH: 168,
    chargeCapMinor: 0n,
    fundsHoldingEnabled: p('funds_holding_enabled', country) as boolean,
    ...over,
  };
}

function triggerParams(country: string): DepositTriggerParams {
  return {
    alwaysRequired: p('deposit_always_required', country) as boolean,
    triggerClasses: p('deposit_trigger_classes', country) as ['LUXE'],
    youngDriverAge: p('deposit_young_driver_age', country) as number,
    youngDriverClasses: p('deposit_young_driver_classes', country) as [],
    onRiskFlag: p('deposit_on_risk_flag', country) as boolean,
    riskControlDeployed: p('risk_control_deployed', country) as boolean,
  };
}

function gate(
  c: (typeof CASES)[number],
  over: {
    valueClass?: 'STANDARD' | 'PREMIUM' | 'LUXE';
    tripMinutes?: number;
    caps?: CapabilitySet;
    rail?: Partial<DepositRailParams>;
    amounts?: DepositGateInput['amounts'];
  } = {},
) {
  return decideDepositGate({
    triggerParams: triggerParams(c.country),
    amounts: 'amounts' in over ? over.amounts : { LUXE: c.deposit },
    railParams: railParams(c.country, over.rail),
    caps: { capabilities: over.caps ?? caps() },
    context: { valueClass: over.valueClass ?? 'LUXE', driverAges: [40], riskFlagged: false },
    // réservé bien avant : auth_at = T − 24 h
    bookedAt: at(-24 * 10),
    scheduledStart: at(0),
    scheduledEnd: at(0, over.tripMinutes ?? 72 * 60),
  });
}

describe.each(CASES)('$country ($currency) — choix du rail au checkout, avant le paiement', (c) => {
  it('T57 : 3 jours chez un PSP à 7 j ⇒ pré-autorisation unique (H_requise = 168 h ≤ V)', () => {
    const t57 = check('T57', /^T57$/) as { single: boolean };
    const g = gate(c);
    expect(g.kind).toBe('REQUIRED');
    if (g.kind !== 'REQUIRED') return;
    expect(g.rail.mechanism === 'PREAUTH_SINGLE').toBe(t57.single);
    expect([g.amountMinor, g.rail.hRequiredHours, g.rail.vHours]).toEqual([c.deposit, 168, 168]);
    expect(g.rail.authAt).toEqual(at(-24));
  });

  it('T59 (critère 1) : 3 j + 25 min, SUPPORTS_REAUTH absente, funds_holding_enabled = false ⇒ DEPOSIT_RAIL_UNAVAILABLE avant le paiement, 3 jours possibles', () => {
    const [single, overMinutes, daysForm, railB] = check('T59', /forme heures/) as [
      boolean,
      bigint,
      boolean,
      boolean,
    ];
    const g = gate(c, { tripMinutes: 72 * 60 + 25 });
    expect(g.kind).toBe('REFUSED');
    if (g.kind !== 'REFUSED') return;
    expect(g.code).toBe('DEPOSIT_RAIL_UNAVAILABLE');
    expect(g.rail?.mechanism === 'PREAUTH_SINGLE').toBe(single);
    expect(BigInt((g.rail?.hRequiredMinutes ?? 0) - 168 * 60)).toBe(overMinutes);
    expect(3 + 4 <= 7).toBe(daysForm); // la forme en jours disait oui : la forme en heures prévaut
    expect(railB).toBe(false); // deposit_charge_cap inconnu ⇒ 0 ⇒ rail (b) interdit
    // durées possibles : 168 − 24 − 72 − 0 = 72 h = 3 jours
    expect(g.maxBookableDays).toBe(3);
  });

  it('T70 (critère 2) : même trip sur un STANDARD ⇒ aucun rail évalué, réservation possible, même sans aucune capacité', () => {
    const [none] = check('T70', /sans caution/) as [boolean];
    const g = gate(c, {
      valueClass: 'STANDARD',
      tripMinutes: 72 * 60 + 25,
      caps: new CapabilitySet([]),
      amounts: undefined,
    });
    expect(g.kind === 'REQUIRED').toBe(none);
    expect(g.kind).toBe('NOT_REQUIRED');
    expect('rail' in g).toBe(false);
  });

  it('critère 3 : SUPPORTS_REAUTH validée ⇒ rail de ré-autorisation, demandée à auth_expiry − 24 h, avant l’échéance', () => {
    const g = gate(c, {
      tripMinutes: 72 * 60 + 25,
      caps: caps({ extra: [rec('SUPPORTS_REAUTH', true)] }),
    });
    expect(g.kind === 'REQUIRED' && g.rail.mechanism).toBe('REAUTH');
    const params = railParams(c.country);
    const expiry = depositAuthExpiry(at(-24), 168, null); // = T + 144 h
    const release = depositReleaseAt(null, at(0, 72 * 60 + 25), params.releaseDelayH ?? -1);
    const due = depositReauthDueAt(expiry, release, params.safetyH ?? -1, params.reauthLeadH ?? -1);
    expect(due).toEqual(at(120));
    expect((due?.getTime() ?? Infinity) < expiry.getTime()).toBe(true);
  });

  it('critère 4 : rail « débit puis remboursement » plafonné, funds_holding_enabled = false ⇒ fermé, refus avant le paiement', () => {
    const closed = gate(c, { tripMinutes: 72 * 60 + 25, rail: { chargeCapMinor: c.deposit } });
    expect(closed.kind === 'REFUSED' && closed.code).toBe('DEPOSIT_RAIL_UNAVAILABLE');
    // plafond inconnu (0) ou inférieur au montant : fermé même interrupteur ouvert
    for (const cap of [0n, c.deposit - 1n]) {
      const g = gate(c, {
        tripMinutes: 72 * 60 + 25,
        rail: { chargeCapMinor: cap, fundsHoldingEnabled: true },
      });
      expect(g.kind === 'REFUSED' && g.code).toBe('DEPOSIT_RAIL_UNAVAILABLE');
    }
    // seulement interrupteur ouvert (décision écrite du fondateur) ET plafond suffisant
    const open = gate(c, {
      tripMinutes: 72 * 60 + 25,
      rail: { chargeCapMinor: c.deposit, fundsHoldingEnabled: true },
    });
    expect(open.kind === 'REQUIRED' && open.rail.mechanism).toBe('CHARGE_THEN_REFUND');
  });

  it('capacité inconnue = « non » : pré-autorisation DOCUMENTED, V absente ou paramètre de durée absent', () => {
    const documented = new CapabilitySet([
      { ...rec('SUPPORTS_PREAUTH', true), status: 'DOCUMENTED' },
      rec('MAX_HOLD_HOURS', 168),
    ]);
    expect(gate(c, { caps: documented }).kind).toBe('REFUSED');
    expect(gate(c, { caps: caps({ without: ['MAX_HOLD_HOURS'] }) }).kind).toBe('REFUSED');
    expect(gate(c, { rail: { providerMaxHoldH: 0 } }).kind).toBe('REFUSED');
    const g = gate(c, { rail: { releaseDelayH: null } });
    expect(g.kind === 'REFUSED' && g.code).toBe('PARAM_MISSING');
  });

  it('T72 c : caution exigée sans deposit_amount ⇒ PARAM_MISSING (jamais une caution de 0)', () => {
    const g = gate(c, { amounts: undefined });
    expect(g.kind === 'REFUSED' && g.code).toBe('PARAM_MISSING');
  });

  it('réservation tardive : auth_at = instant de la réservation (pose immédiate), H_requise recalculée', () => {
    const s = selectDepositRail(
      { amountMinor: c.deposit, bookedAt: at(-2), scheduledStart: at(0), scheduledEnd: at(96) },
      {
        ...railParams(c.country),
        authLeadH: 24,
        releaseDelayH: 72,
        marginH: 0,
        safetyH: 2,
        reauthLeadH: 24,
      },
      { capabilities: caps() },
    );
    // 2 + 96 + 72 = 170 h > 168 h : plus de pré-autorisation unique
    expect([s.authAt, s.hRequiredHours, s.mechanism]).toEqual([at(-2), 170, 'REFUSED']);
  });
});

describe.each(CASES)('$country ($currency) — décision à fin + 70 h, commandes au PSP', (c) => {
  const cur = c.cur;
  const end = at(72);
  const fuel = {
    id: 'fuel',
    amount: money(c.fuel, cur),
    hostShare: ratio(1n, 1n), // carburant : 100 % à l'hôte (BR-PROT-08)
    proven: true,
    notifiedAt: new Date(end.getTime() + H),
    disputed: false,
  };
  const decisionAt = depositDecisionAt(
    depositReleaseAt(null, end, 72),
    depositAuthExpiry(at(-24), 168, null),
    2,
  );

  it('T57 : décision à fin + 70 h ; capture des frais (jambe HOST), VOID du reste, aucune MIT', () => {
    const t57 = check('T57', /^T57$/) as Record<string, bigint>;
    const [, , hostLeg, platformLeg] = check('T69', /caution/) as bigint[];
    expect(BigInt((decisionAt.getTime() - end.getTime()) / H)).toBe(t57['decision_h']);
    const plan = planDepositDecision({
      mechanism: 'PREAUTH_SINGLE',
      amount: money(c.deposit, cur),
      decisionAt,
      feeNoticeH: p('deposit_fee_notice_h', c.country) as number,
      fees: [fuel],
      caps: { capabilities: caps() },
    });
    expect(plan.steps.map((s) => s.op)).toEqual(['CAPTURE', 'VOID']);
    expect([plan.capturedMinor, plan.releasedMinor, plan.mitMinor]).toEqual([
      c.scale(t57['capture'] ?? -1n),
      c.scale(t57['void'] ?? -1n),
      c.scale(t57['mit'] ?? -1n),
    ]);
    const capture = plan.steps[0];
    // T69 : carburant à 100 % pour l'hôte, PLATFORM 0
    expect(capture?.op === 'CAPTURE' && [capture.legs.HOST, capture.legs.PLATFORM]).toEqual([
      c.scale(hostLeg ?? -1n),
      c.scale(platformLeg ?? -1n),
    ]);
    expect(plan.finalStatus).toBe('PARTIALLY_CAPTURED');
  });

  it('T58 (critère 5) : PSP sans capture partielle ⇒ VOID de la caution entière PUIS débit MIT des frais', () => {
    const t58 = check('T58', /^T58$/) as Record<string, bigint>;
    const plan = planDepositDecision({
      mechanism: 'PREAUTH_SINGLE',
      amount: money(c.deposit, cur),
      decisionAt,
      feeNoticeH: 48,
      fees: [fuel],
      caps: { capabilities: caps({ without: ['SUPPORTS_PARTIAL_CAPTURE'] }) },
    });
    expect(plan.steps.map((s) => s.op)).toEqual(['VOID', 'MIT_CHARGE']);
    const expected = [t58['capture'], t58['void'], t58['mit']].map((v) => c.scale(v ?? -1n));
    expect([plan.capturedMinor, plan.releasedMinor, plan.mitMinor]).toEqual(expected);
    expect(plan.finalStatus).toBe('VOIDED');
  });

  it('frais notifié moins de 48 h avant la décision, contesté ou sans preuve ⇒ débit MIT séparé ; la caution est libérée en entier', () => {
    for (const fee of [
      { ...fuel, notifiedAt: new Date(decisionAt.getTime() - 47 * H) },
      { ...fuel, disputed: true },
      { ...fuel, proven: false },
    ]) {
      const plan = planDepositDecision({
        mechanism: 'PREAUTH_SINGLE',
        amount: money(c.deposit, cur),
        decisionAt,
        feeNoticeH: 48,
        fees: [fee],
        caps: { capabilities: caps() },
      });
      expect(plan.steps.map((s) => s.op)).toEqual(['VOID', 'MIT_CHARGE']);
      expect([plan.releasedMinor, plan.mitMinor]).toEqual([c.deposit, c.fuel]);
    }
  });

  it('frais au-delà de la caution : capture plafonnée au montant, le reste par MIT', () => {
    const big = { ...fuel, amount: money(c.deposit + c.fuel, cur) };
    const plan = planDepositDecision({
      mechanism: 'PREAUTH_SINGLE',
      amount: money(c.deposit, cur),
      decisionAt,
      feeNoticeH: 48,
      fees: [big],
      caps: { capabilities: caps() },
    });
    expect(plan.steps.map((s) => s.op)).toEqual(['CAPTURE', 'MIT_CHARGE']);
    expect([plan.capturedMinor, plan.releasedMinor, plan.mitMinor]).toEqual([
      c.deposit,
      0n,
      c.fuel,
    ]);
  });

  it('sans VOID validée : l’autorisation expire seule (aucune capture) ; sans MIT : dette, jamais prise sur la caution', () => {
    const plan = planDepositDecision({
      mechanism: 'PREAUTH_SINGLE',
      amount: money(c.deposit, cur),
      decisionAt,
      feeNoticeH: 48,
      fees: [fuel],
      caps: {
        capabilities: caps({
          without: ['SUPPORTS_PARTIAL_CAPTURE', 'SUPPORTS_VOID', 'SUPPORTS_MIT'],
        }),
      },
    });
    expect(plan.steps.map((s) => s.op)).toEqual(['LET_EXPIRE', 'DEBT']);
    expect(plan.finalStatus).toBe('EXPIRED');
  });

  it('débit puis remboursement : remboursement TOTAL émis à la décision, frais par MIT (aucune retenue sur des fonds détenus)', () => {
    const plan = planDepositDecision({
      mechanism: 'CHARGE_THEN_REFUND',
      amount: money(c.deposit, cur),
      decisionAt,
      feeNoticeH: 48,
      fees: [fuel],
      caps: { capabilities: caps() },
    });
    expect(plan.steps.map((s) => s.op)).toEqual(['REFUND', 'MIT_CHARGE']);
    const refund = plan.steps[0];
    expect(refund?.op === 'REFUND' && refund.amountMinor).toBe(c.deposit);
    expect([plan.finalStatus, plan.mitMinor]).toEqual(['REFUNDED', c.fuel]);
  });
});

describe('machine d’état de deposit_hold.status (16 PAY-011)', () => {
  it('PLANNED → AUTHORIZED → (ré-autorisation refusée : reste AUTHORIZED) → VOIDED ; états finaux sans sortie', () => {
    let s = nextDepositStatus('PLANNED', 'AUTH_FAILED');
    expect(s).toBe('PLANNED');
    s = nextDepositStatus(s, 'AUTHORIZED');
    s = nextDepositStatus(s, 'REAUTH_REFUSED');
    expect(s).toBe('AUTHORIZED');
    s = nextDepositStatus(s, 'VOIDED');
    expect(s).toBe('VOIDED');
    for (const final of ['PARTIALLY_CAPTURED', 'VOIDED', 'REFUNDED', 'EXPIRED'] as const) {
      expect(() => nextDepositStatus(final, 'CAPTURED')).toThrow(/transition/);
    }
    expect(() => nextDepositStatus('PLANNED', 'CAPTURED')).toThrow(/transition/);
  });
});

describe.each(CASES)(
  '$country ($currency) — repli et arrondi des frais scindés (revues de #236)',
  (c) => {
    const decisionAt = new Date(T + 142 * H);
    const fee = (amountMinor: bigint, share: [bigint, bigint]) => ({
      id: 'late',
      amount: money(amountMinor, c.cur),
      hostShare: ratio(share[0], share[1]),
      proven: true,
      notifiedAt: new Date(decisionAt.getTime() - 50 * H),
      disputed: false,
    });

    it('frais scindé au plafond : part HOST arrondie une fois sur la ligne entière (allocHost par ligne, 08 BR-PAY-06)', () => {
      for (const [deposit, amount, share] of [
        [1001n, 1003n, [3n, 4n]],
        [7n, 9n, [1n, 3n]],
        [5n, 6n, [1n, 2n]],
        [c.deposit, c.deposit + 1n, [3n, 4n]],
      ] as const) {
        const f = fee(amount, [share[0], share[1]]);
        const plan = planDepositDecision({
          mechanism: 'PREAUTH_SINGLE',
          amount: money(deposit, c.cur),
          decisionAt,
          feeNoticeH: 48,
          fees: [f],
          caps: { capabilities: caps() },
        });
        const legs = plan.steps.flatMap((x) =>
          x.op === 'CAPTURE' || x.op === 'MIT_CHARGE' ? [x.legs] : [],
        );
        const host = legs.reduce((a, l) => a + l.HOST, 0n);
        const platform = legs.reduce((a, l) => a + l.PLATFORM, 0n);
        expect([host, host + platform]).toEqual([
          allocHost(f.amount, f.hostShare).amountMinor,
          amount,
        ]);
        for (const l of legs) expect(l.HOST >= 0n && l.PLATFORM >= 0n).toBe(true);
      }
    });

    it('repli après refus de capture : VOID de la caution entière, tous les frais par MIT (T58) ; sans capture : rien à replier', () => {
      const f = { ...fee(c.fuel, [1n, 1n]), id: 'fuel' };
      const base = planDepositDecision({
        mechanism: 'PREAUTH_SINGLE',
        amount: money(c.deposit, c.cur),
        decisionAt,
        feeNoticeH: 48,
        fees: [f, { ...f, id: 'late', notifiedAt: decisionAt }],
        caps: { capabilities: caps() },
      });
      expect(base.steps.map((x) => x.op)).toEqual(['CAPTURE', 'VOID', 'MIT_CHARGE']);
      const fb = fallbackAfterCaptureFailure(base, { capabilities: caps() });
      expect(fb?.steps.map((x) => x.op)).toEqual(['VOID', 'MIT_CHARGE']);
      expect([fb?.capturedMinor, fb?.releasedMinor, fb?.mitMinor, fb?.finalStatus]).toEqual([
        0n,
        c.deposit,
        2n * c.fuel,
        'VOIDED',
      ]);
      const noCapture = planDepositDecision({
        mechanism: 'PREAUTH_SINGLE',
        amount: money(c.deposit, c.cur),
        decisionAt,
        feeNoticeH: 48,
        fees: [],
        caps: { capabilities: caps() },
      });
      expect(fallbackAfterCaptureFailure(noCapture, { capabilities: caps() })).toBeNull();
    });
  },
);
