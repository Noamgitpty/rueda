/**
 * Caution au checkout (US-701, ADR-169 ; 08 BR-PAY-06 « Moment de l'évaluation », « Fail-closed »,
 * « Montant unique » ; 17 §3.2.7 `deposit_hold` ; 19 US-701 critères 3 et 4 ; suites S-2, S-7, S-8
 * d'US-225).
 *
 * Avant le paiement du hold (`POST /checkout/holds/{id}/payment`), la porte de US-225
 * (`decideDepositGate`) est évaluée avec le contexte lu par la base (pays, devise, classe du
 * véhicule du catalogue, période du devis ENGAGÉ, compte marchand du pays, heure `platform.now()`)
 * et la configuration du pays (`PgDepositRailConfigReader`) :
 * - refus (`PARAM_MISSING`, `DEPOSIT_RAIL_UNAVAILABLE`) ⇒ AUCUNE ligne `deposit_hold` (08 : « un
 *   checkout refusé n'écrit aucune ligne »), le paiement n'est pas démarré ;
 * - sinon la décision est FIGÉE dans `deposit_hold` (mécanisme, déclencheurs [C2], instantané des
 *   paramètres [C2], montant, `H_requise`, `V`, échéancier) par la commande de la base, qui revérifie
 *   ce qu'elle peut (montant = `deposit_amount[pays][classe]`, aucun `NOT_REQUIRED` sur une classe ou
 *   un pays déclencheur, rail « débit puis remboursement » fermé tant que `funds_holding_enabled` =
 *   false) ; une décision déjà figée pour ce hold n'est jamais réécrite.
 *
 * Le voyageur ne reçoit que la **vue** `DepositGuestView` (S-7) : statut, montant, devise, nature
 * (blocage ou débit) et date de libération ; jamais les déclencheurs, l'âge, le signal de risque ni
 * l'instantané des paramètres (08 : « un fraudeur ne doit pas pouvoir sonder le contrôle de
 * risque »).
 *
 * Non lus ici (fail-closed, suite S-10 de la passation) : l'âge des conducteurs approuvés (inconnu
 * ⇒ `AGE` vrai sur une classe de `deposit_young_driver_classes`, vide au PA et au PY) et le signal du
 * contrôle de risque (inconnu ⇒ `RISK` vrai si `risk_control_deployed`, faux au PA et au PY).
 */
import { PaymentError } from './errors.js';
import { completeRailParams, decideDepositGate, planDepositSchedule } from './deposit-rails.js';
import type { DepositGateDecision, DepositMechanism, DepositRail } from './deposit-rails.js';
import { DEPOSIT_VALUE_CLASSES } from './deposit-triggers.js';
import type { DepositTrigger, DepositValueClass } from './deposit-triggers.js';
import type { DepositRailConfig } from './pg-deposit-config.js';

/** Contexte du hold lu par la base (`core.payment_deposit_checkout`), sans donnée [C2]. */
export interface DepositCheckoutContext {
  readonly country: string;
  readonly currency: string;
  /** `value_class` du véhicule (catalogue) ; `null` : inconnue (fail-closed : `CLASS` vrai). */
  readonly valueClass: DepositValueClass | null;
  readonly scheduledStart: Date;
  readonly scheduledEnd: Date;
  /** Fournisseur du compte marchand du pays ; `null` : aucun (capacités inconnues = « non »). */
  readonly provider: string | null;
  /** `platform.now()` : instant de la décision. */
  readonly now: Date;
}

/** Décision déjà figée pour ce hold, telle que le voyageur peut la lire (aucun champ [C2]). */
export interface RecordedDeposit {
  readonly mechanism: Exclude<DepositMechanism, 'REFUSED'>;
  readonly amountMinor: bigint;
  readonly currency: string;
  /** `null` pour `NOT_REQUIRED`. */
  readonly releaseAt: Date | null;
}

export type DepositCheckoutRead =
  | { readonly kind: 'RECORDED'; readonly deposit: RecordedDeposit }
  | { readonly kind: 'OPEN'; readonly context: DepositCheckoutContext };

/** Ligne écrite par `core.payment_cmd_record_deposit_decision` (montants en unités mineures). */
export interface DepositDecisionRecord {
  readonly mechanism: Exclude<DepositMechanism, 'REFUSED'>;
  /** [C2] */
  readonly triggers: readonly DepositTrigger[];
  /** [C2] : valeurs lues, âge entier du plus jeune conducteur, `risk_evaluated` ; aucune date. */
  readonly paramsSnapshot: Readonly<Record<string, unknown>>;
  readonly amountMinor: bigint;
  readonly provider: string | null;
  readonly hRequiredHours: number | null;
  readonly vHours: number | null;
  readonly authAt: Date | null;
  readonly releaseAt: Date | null;
  readonly decisionAt: Date | null;
  readonly reauthDueAt: Date | null;
}

export type DepositRecordOutcome =
  | 'RECORDED'
  | 'EXISTING'
  | 'AUTH_REQUIRED'
  | 'HOLD_NOT_FOUND'
  | 'HOLD_NOT_PAYABLE'
  | 'QUOTE_UNAVAILABLE';

/** Lecture refusée : session absente, hold d'un autre voyageur, devis engagé indisponible. */
export type DepositReadRefusal = 'AUTH_REQUIRED' | 'HOLD_NOT_FOUND' | 'QUOTE_UNAVAILABLE';

export interface DepositCheckoutStore {
  read(proof: Buffer, holdId: string): Promise<DepositCheckoutRead | DepositReadRefusal>;
  record(
    proof: Buffer,
    holdId: string,
    record: DepositDecisionRecord,
  ): Promise<DepositRecordOutcome>;
}

export interface DepositConfigSource {
  read(country: string, provider: string): Promise<DepositRailConfig>;
}

/**
 * Vue du voyageur (S05) : `NONE` (aucune caution), `REQUIRED` (montant, nature, libération au
 * plus tard) ou `UNAVAILABLE` (réservation refusée avant le paiement ; `maxBookableDays` ≥ 1 :
 * `web.deposit.unavailable`, 0 ou `null` : `web.deposit.unavailableNone`, suite S-8).
 */
export type DepositGuestView =
  | { readonly status: 'NONE' }
  | {
      readonly status: 'REQUIRED';
      readonly amountMinor: bigint;
      readonly currency: string;
      /** `HOLD` : blocage sur la carte (pré-autorisation) ; `CHARGE` : débit puis remboursement. */
      readonly kind: 'HOLD' | 'CHARGE';
      readonly releaseAt: Date;
    }
  | {
      readonly status: 'UNAVAILABLE';
      readonly code: 'PARAM_MISSING' | 'DEPOSIT_RAIL_UNAVAILABLE';
      readonly maxBookableDays: number | null;
    };

const kindOf = (mechanism: DepositRail): 'HOLD' | 'CHARGE' =>
  mechanism === 'CHARGE_THEN_REFUND' ? 'CHARGE' : 'HOLD';

/** Vue d'une décision figée (aucun champ [C2]). */
export function guestViewOfRecorded(d: RecordedDeposit): DepositGuestView {
  if (d.mechanism === 'NOT_REQUIRED') return { status: 'NONE' };
  if (d.releaseAt === null || d.amountMinor <= 0n) {
    throw new PaymentError('INVALID_REQUEST', 'caution figée sans montant ni libération');
  }
  return {
    status: 'REQUIRED',
    amountMinor: d.amountMinor,
    currency: d.currency,
    kind: kindOf(d.mechanism),
    releaseAt: d.releaseAt,
  };
}

/** Clés de paramètres figées dans `params_snapshot` (valeurs lues, jamais une donnée personnelle). */
function snapshotOf(
  config: DepositRailConfig,
  ctx: DepositCheckoutContext,
  decision: DepositGateDecision,
): Readonly<Record<string, unknown>> {
  const t = config.triggerParams;
  const r = config.railParams;
  const amount =
    config.amounts === undefined || ctx.valueClass === null
      ? null
      : (config.amounts[ctx.valueClass] ?? null);
  return {
    version: 1,
    valueClass: ctx.valueClass,
    youngestDriverAge: decision.triggers.youngestDriverAge,
    riskEvaluated: decision.triggers.riskEvaluated,
    provider: ctx.provider,
    params: {
      deposit_always_required: t.alwaysRequired ?? null,
      deposit_trigger_classes: t.triggerClasses ?? null,
      deposit_young_driver_age: t.youngDriverAge ?? null,
      deposit_young_driver_classes: t.youngDriverClasses ?? null,
      deposit_on_risk_flag: t.onRiskFlag ?? null,
      risk_control_deployed: t.riskControlDeployed ?? null,
      deposit_amount: amount === null ? null : amount.toString(),
      auth_lead_h: r.authLeadH,
      release_delay_h: r.releaseDelayH,
      marge_h: r.marginH,
      deposit_safety_h: r.safetyH,
      deposit_reauth_lead_h: r.reauthLeadH,
      provider_max_hold_h: r.providerMaxHoldH,
      deposit_charge_cap: r.chargeCapMinor.toString(),
      funds_holding_enabled: r.fundsHoldingEnabled,
    },
  };
}

/** Évaluation pure : décision de la porte, ligne à figer (si acceptée) et vue du voyageur. */
export function evaluateDepositCheckout(
  ctx: DepositCheckoutContext,
  config: DepositRailConfig,
): {
  readonly decision: DepositGateDecision;
  readonly record: DepositDecisionRecord | null;
  readonly view: DepositGuestView;
} {
  const decision = decideDepositGate({
    triggerParams: config.triggerParams,
    amounts: config.amounts,
    railParams: config.railParams,
    caps: { capabilities: config.capabilities },
    // âge et signal de risque non lus ici : inconnus (fail-closed de evaluateDepositTriggers)
    context: { valueClass: ctx.valueClass, driverAges: null, riskFlagged: null },
    bookedAt: ctx.now,
    scheduledStart: ctx.scheduledStart,
    scheduledEnd: ctx.scheduledEnd,
  });
  const paramsSnapshot = snapshotOf(config, ctx, decision);
  if (decision.kind === 'REFUSED') {
    return {
      decision,
      record: null,
      view: {
        status: 'UNAVAILABLE',
        code: decision.code,
        maxBookableDays: decision.maxBookableDays,
      },
    };
  }
  if (decision.kind === 'NOT_REQUIRED') {
    return {
      decision,
      record: {
        mechanism: 'NOT_REQUIRED',
        triggers: [],
        paramsSnapshot,
        amountMinor: 0n,
        provider: ctx.provider,
        hRequiredHours: null,
        vHours: null,
        authAt: null,
        releaseAt: null,
        decisionAt: null,
        reauthDueAt: null,
      },
      view: { status: 'NONE' },
    };
  }
  const params = completeRailParams(config.railParams);
  // decideDepositGate rend PARAM_MISSING avant d'arriver ici si un paramètre manque
  if (params === null) throw new PaymentError('INVALID_REQUEST', 'paramètres de rail incomplets');
  const schedule = planDepositSchedule(decision.rail, params, ctx.scheduledEnd);
  return {
    decision,
    record: {
      mechanism: decision.rail.mechanism,
      triggers: decision.triggers.triggers,
      paramsSnapshot,
      amountMinor: decision.amountMinor,
      provider: ctx.provider,
      hRequiredHours: decision.rail.hRequiredHours,
      vHours: decision.rail.vHours,
      authAt: schedule.authAt,
      releaseAt: schedule.releaseAt,
      decisionAt: schedule.decisionAt,
      reauthDueAt: schedule.reauthDueAt,
    },
    view: {
      status: 'REQUIRED',
      amountMinor: decision.amountMinor,
      currency: ctx.currency,
      kind: kindOf(decision.rail.mechanism),
      releaseAt: schedule.releaseAt,
    },
  };
}

/** Configuration d'un pays sans compte marchand : aucune capacité (toute pose de caution refusée). */
const NO_PROVIDER = '';

export type DepositEnforcement =
  | { readonly kind: 'ACCEPTED'; readonly view: DepositGuestView }
  | {
      readonly kind: 'REFUSED';
      readonly view: DepositGuestView & { readonly status: 'UNAVAILABLE' };
    }
  | {
      readonly kind: 'AUTH_REQUIRED' | 'HOLD_NOT_FOUND' | 'HOLD_NOT_PAYABLE' | 'QUOTE_UNAVAILABLE';
    };

/** Porte de la caution du checkout (lecture pour S05, application avant le paiement). */
export class DepositCheckoutGate {
  constructor(
    private readonly store: DepositCheckoutStore,
    private readonly config: DepositConfigSource,
  ) {}

  /**
   * Vue pour S05 / S06 : la décision figée si elle existe ; sinon, si `evaluate`, la décision que
   * prendrait la porte maintenant (aucune écriture) ; sinon `null`.
   */
  async view(
    proof: Buffer,
    holdId: string,
    evaluate: boolean,
  ): Promise<DepositGuestView | null | 'AUTH_REQUIRED' | 'HOLD_NOT_FOUND'> {
    const read = await this.store.read(proof, holdId);
    if (read === 'AUTH_REQUIRED' || read === 'HOLD_NOT_FOUND') return read;
    if (read === 'QUOTE_UNAVAILABLE') return null;
    if (read.kind === 'RECORDED') return guestViewOfRecorded(read.deposit);
    if (!evaluate) return null;
    return (await this.#evaluate(read.context)).view;
  }

  /** Avant le paiement : refus sans écriture, ou décision figée (jamais réécrite). */
  async enforce(proof: Buffer, holdId: string): Promise<DepositEnforcement> {
    const read = await this.store.read(proof, holdId);
    if (typeof read === 'string') return { kind: read };
    if (read.kind === 'RECORDED') {
      return { kind: 'ACCEPTED', view: guestViewOfRecorded(read.deposit) };
    }
    const evaluated = await this.#evaluate(read.context);
    if (evaluated.record === null || evaluated.view.status === 'UNAVAILABLE') {
      if (evaluated.view.status !== 'UNAVAILABLE') {
        throw new PaymentError('INVALID_REQUEST', 'caution : décision sans ligne');
      }
      return { kind: 'REFUSED', view: evaluated.view };
    }
    const outcome = await this.store.record(proof, holdId, evaluated.record);
    switch (outcome) {
      case 'RECORDED':
        return { kind: 'ACCEPTED', view: evaluated.view };
      case 'EXISTING': {
        // décision figée entre-temps (autre onglet) : elle fait foi
        const again = await this.store.read(proof, holdId);
        if (typeof again === 'string') return { kind: again };
        if (again.kind !== 'RECORDED') {
          throw new PaymentError(
            'INVALID_REQUEST',
            'caution : décision introuvable après écriture',
          );
        }
        return { kind: 'ACCEPTED', view: guestViewOfRecorded(again.deposit) };
      }
      default:
        return { kind: outcome };
    }
  }

  async #evaluate(ctx: DepositCheckoutContext) {
    const config = await this.config.read(ctx.country, ctx.provider ?? NO_PROVIDER);
    return evaluateDepositCheckout(ctx, config);
  }
}

/** Classe du catalogue lue en base ; tout autre texte ⇒ `null` (inconnue, fail-closed). */
export function valueClassOf(v: unknown): DepositValueClass | null {
  return (DEPOSIT_VALUE_CLASSES as readonly unknown[]).includes(v)
    ? (v as DepositValueClass)
    : null;
}
