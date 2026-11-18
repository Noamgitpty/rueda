/**
 * Rails de la caution (08 BR-PAY-06 « Mécanisme », « Libération à heure fixe », « Débit puis
 * remboursement » ; 08 E3 « Capacités d'autorisation » ; 16 fiche PAY-011 / PAY-012 / PAY-036 ;
 * 17 §3.2.7 `deposit_hold`, ADR-016 ; 19 US-225 ; ADR-164).
 *
 * Fonctions pures (aucune horloge : l'instant de décision vient de la base, `platform.now()`) :
 * 1. `decideDepositGate` : au checkout, AVANT le paiement — déclencheurs, montant, puis rail. Aucun
 *    déclencheur ⇒ `NOT_REQUIRED`, aucun rail évalué (T70) ; caution exigée sans montant ⇒
 *    `PARAM_MISSING` (T72 c) ; aucun rail valide ⇒ `DEPOSIT_RAIL_UNAVAILABLE` avec la durée
 *    possible (T59). Jamais de rétention de fonds : rien n'est autorisé ici.
 * 2. `selectDepositRail` : le rail est choisi par **configuration** (`psp_capability`,
 *    `provider_max_hold_h`, `deposit_charge_cap`, `funds_holding_enabled`), jamais par une branche
 *    propre à un PSP ou à un pays. Une capacité inconnue vaut « non ».
 * 3. Échéancier : `auth_at`, `H_requise` (forme en heures, qui prévaut), `auth_expiry`, ré-autorisation
 *    à `auth_expiry − 24 h`, `release_at`, `decision_at = min(release_at, auth_expiry − safety)`.
 * 4. `planDepositDecision` : commandes au PSP de la décision, chacune avec son **montant explicite**
 *    et, pour celles qui déplacent des fonds, ses jambes (`allocHost` par ligne, 08 BR-PAY-06
 *    « Jambes des frais annexes ») : capture partielle puis VOID du reste (T57), VOID total puis
 *    débit MIT (T58), remboursement total puis MIT (rail « débit puis remboursement »).
 * 5. Machine d'état de `deposit_hold.status` (16 PAY-011 « États »).
 */
import { allocHost, isZero, subtract } from '@rueda/money';
import type { Money, Ratio } from '@rueda/money';
import type { CapabilitySet } from './capabilities.js';
import { PaymentError } from './errors.js';
import type { LegAmounts } from './legs.js';
import { depositAmountFor, evaluateDepositTriggers } from './deposit-triggers.js';
import type {
  DepositTriggerContext,
  DepositTriggerDecision,
  DepositTriggerParams,
  DepositValueClass,
} from './deposit-triggers.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MINUTES = 1_440;

/** `deposit_hold.mechanism` (17 §3.2.7) ; `COUNTER_AGENCY` historique, sans objet. */
export const DEPOSIT_MECHANISMS = [
  'NOT_REQUIRED',
  'PREAUTH_SINGLE',
  'REAUTH',
  'CHARGE_THEN_REFUND',
  'REFUSED',
] as const;
export type DepositMechanism = (typeof DEPOSIT_MECHANISMS)[number];

/** Rails qui posent effectivement une caution. */
export type DepositRail = 'PREAUTH_SINGLE' | 'REAUTH' | 'CHARGE_THEN_REFUND';

/** Paramètres de rail d'un pays (17 §7.2) ; `null` : absent ou illisible. */
export interface DepositRailParams {
  /** `auth_lead_h` (24 h) : la caution est posée à `scheduled_start − auth_lead_h`. */
  readonly authLeadH: number | null;
  /** `release_delay_h` (72 h). */
  readonly releaseDelayH: number | null;
  /** `marge_h` (0 h) de `H_requise`. */
  readonly marginH: number | null;
  /** `deposit_safety_h` (2 h, À VALIDER par PSP). */
  readonly safetyH: number | null;
  /** `deposit_reauth_lead_h` (24 h) : ré-autorisation à `auth_expiry − 24 h`. */
  readonly reauthLeadH: number | null;
  /** `provider_max_hold_h[psp][pays][réseau]` ; absent ⇒ 0 (`failMode` ZERO). */
  readonly providerMaxHoldH: number;
  /** `deposit_charge_cap[pays]`, unités mineures ; absent ⇒ 0 : rail (b) interdit. */
  readonly chargeCapMinor: bigint;
  /** Interrupteur `funds_holding_enabled[pays]` (false en production, 17 §0.1). */
  readonly fundsHoldingEnabled: boolean;
}

/** Capacités et réseau du moyen de la caution (carte). */
export interface DepositRailCapabilities {
  readonly capabilities: CapabilitySet;
  /** Réseau de la carte enregistrée si connu, sinon `*`. */
  readonly network?: string;
}

const CARD = 'CARD';

const isHours = (h: number | null): h is number => h !== null && Number.isSafeInteger(h) && h >= 0;

/**
 * Validité `V` (heures) d'une pré-autorisation de caution : `SUPPORTS_PREAUTH` validée, puis le
 * plus petit de `MAX_HOLD_HOURS` (capacité) et `provider_max_hold_h` (paramètre) — même grandeur
 * (17 §2.8), chacune inconnue ⇒ 0 : fail-closed, aucune pré-autorisation sans les deux.
 */
export function depositHoldValidityHours(
  params: Pick<DepositRailParams, 'providerMaxHoldH'>,
  caps: DepositRailCapabilities,
): number {
  const network = caps.network ?? '*';
  if (!caps.capabilities.bool('SUPPORTS_PREAUTH', CARD, network)) return 0;
  const cap = caps.capabilities.int('MAX_HOLD_HOURS', CARD, network);
  const param = isHours(params.providerMaxHoldH) ? params.providerMaxHoldH : 0;
  return Math.min(cap, param);
}

/** `auth_at` : `scheduled_start − auth_lead_h`, jamais avant l'instant de la réservation. */
export function depositAuthAt(bookedAt: Date, scheduledStart: Date, authLeadH: number): Date {
  const planned = scheduledStart.getTime() - authLeadH * HOUR_MS;
  return new Date(Math.max(bookedAt.getTime(), planned));
}

/**
 * `H_requise` en MINUTES, arrondie au-dessus (fail-closed) : `(start − auth_at) + (end − start) +
 * release_delay + marge` (08 BR-PAY-06 ; la forme en heures prévaut sur la forme en jours, T59).
 */
export function requiredHoldMinutes(
  authAt: Date,
  scheduledStart: Date,
  scheduledEnd: Date,
  releaseDelayH: number,
  marginH: number,
): number {
  const lead = scheduledStart.getTime() - authAt.getTime();
  const trip = scheduledEnd.getTime() - scheduledStart.getTime();
  const ms = lead + trip + (releaseDelayH + marginH) * HOUR_MS;
  return Math.ceil(ms / MINUTE_MS);
}

export interface DepositRailSelection {
  readonly mechanism: DepositRail | 'REFUSED';
  /** `deposit_hold.h_required_hours` (arrondi au-dessus). */
  readonly hRequiredHours: number;
  readonly hRequiredMinutes: number;
  /** `deposit_hold.v_hours_snapshot`. */
  readonly vHours: number;
  readonly authAt: Date;
  /**
   * Durée de trip la plus longue couverte par une pré-autorisation unique pour ce départ
   * (minutes, ≥ 0) : « durées possibles » du message `DEPOSIT_RAIL_UNAVAILABLE`.
   */
  readonly maxSingleTripMinutes: number;
}

export interface DepositRailRequest {
  readonly amountMinor: bigint;
  /** Instant de la décision (horloge de la base). */
  readonly bookedAt: Date;
  readonly scheduledStart: Date;
  readonly scheduledEnd: Date;
}

type CompleteRailParams = DepositRailParams & {
  readonly authLeadH: number;
  readonly releaseDelayH: number;
  readonly marginH: number;
  readonly safetyH: number;
  readonly reauthLeadH: number;
};

/** Paramètres de durée tous présents (`failMode` BLOCK) ; sinon `null` ⇒ `PARAM_MISSING`. */
export function completeRailParams(p: DepositRailParams): CompleteRailParams | null {
  return isHours(p.authLeadH) &&
    isHours(p.releaseDelayH) &&
    isHours(p.marginH) &&
    isHours(p.safetyH) &&
    isHours(p.reauthLeadH)
    ? (p as CompleteRailParams)
    : null;
}

/**
 * Choix du rail, dans l'ordre de 08 BR-PAY-06 « Mécanisme » : pré-autorisation unique si
 * `H_requise ≤ V` ; sinon (a) ré-autorisation si `SUPPORTS_REAUTH` est validée ; sinon (b) débit
 * puis remboursement si `funds_holding_enabled[pays]`, `deposit_charge_cap[pays]` ≥ montant et
 * remboursement validé ; sinon refus (`DEPOSIT_RAIL_UNAVAILABLE`). L'ancien rail du comptoir est
 * supprimé (pivot P2P).
 */
export function selectDepositRail(
  request: DepositRailRequest,
  params: CompleteRailParams,
  caps: DepositRailCapabilities,
): DepositRailSelection {
  if (request.scheduledEnd.getTime() <= request.scheduledStart.getTime()) {
    throw new PaymentError('INVALID_REQUEST', 'caution : fin du trip avant son début');
  }
  if (request.amountMinor <= 0n) {
    throw new PaymentError('INVALID_REQUEST', 'caution : montant strictement positif attendu');
  }
  const network = caps.network ?? '*';
  const has = (name: 'SUPPORTS_REAUTH' | 'SUPPORTS_REFUND'): boolean =>
    caps.capabilities.bool(name, CARD, network);
  const vHours = depositHoldValidityHours(params, caps);
  const authAt = depositAuthAt(request.bookedAt, request.scheduledStart, params.authLeadH);
  const hRequiredMinutes = requiredHoldMinutes(
    authAt,
    request.scheduledStart,
    request.scheduledEnd,
    params.releaseDelayH,
    params.marginH,
  );
  const leadMinutes = Math.ceil((request.scheduledStart.getTime() - authAt.getTime()) / MINUTE_MS);
  const maxSingleTripMinutes = Math.max(
    0,
    vHours * 60 - leadMinutes - (params.releaseDelayH + params.marginH) * 60,
  );
  const base = {
    hRequiredHours: Math.ceil(hRequiredMinutes / 60),
    hRequiredMinutes,
    vHours,
    authAt,
    maxSingleTripMinutes,
  };
  if (vHours > 0 && hRequiredMinutes <= vHours * 60) {
    return { ...base, mechanism: 'PREAUTH_SINGLE' };
  }
  // (a) ré-autorisation : une autorisation valide plus longtemps que l'avance de ré-autorisation
  if (vHours > params.reauthLeadH && has('SUPPORTS_REAUTH')) {
    return { ...base, mechanism: 'REAUTH' };
  }
  // (b) débit puis remboursement : fonds du voyageur détenus jusqu'à la restitution ⇒ fermé tant
  // que funds_holding_enabled[pays] = false (17 §0.1) ; plafond inconnu ⇒ 0 ⇒ fermé
  if (
    params.fundsHoldingEnabled &&
    params.chargeCapMinor > 0n &&
    request.amountMinor <= params.chargeCapMinor &&
    has('SUPPORTS_REFUND')
  ) {
    return { ...base, mechanism: 'CHARGE_THEN_REFUND' };
  }
  return { ...base, mechanism: 'REFUSED' };
}

// --- porte du checkout ---------------------------------------------------------------------------

export interface DepositGateInput {
  readonly triggerParams: DepositTriggerParams;
  /** `deposit_amount[pays]` par classe (unités mineures) ; `undefined` : absent. */
  readonly amounts: Readonly<Partial<Record<DepositValueClass, bigint>>> | undefined;
  readonly railParams: DepositRailParams;
  readonly caps: DepositRailCapabilities;
  readonly context: DepositTriggerContext;
  readonly bookedAt: Date;
  readonly scheduledStart: Date;
  readonly scheduledEnd: Date;
}

/**
 * Décision du checkout, avant tout paiement. `triggers` et l'âge restent [C2] (ops seulement) ;
 * le voyageur ne reçoit que `amountMinor` ou le refus et sa durée possible.
 */
export type DepositGateDecision =
  | { readonly kind: 'NOT_REQUIRED'; readonly triggers: DepositTriggerDecision }
  | {
      readonly kind: 'REQUIRED';
      readonly triggers: DepositTriggerDecision;
      readonly amountMinor: bigint;
      readonly rail: DepositRailSelection & { readonly mechanism: DepositRail };
    }
  | {
      readonly kind: 'REFUSED';
      readonly code: 'PARAM_MISSING' | 'DEPOSIT_RAIL_UNAVAILABLE';
      readonly triggers: DepositTriggerDecision;
      /** Jours entiers réservables avec une pré-autorisation unique (`web.deposit.unavailable`). */
      readonly maxBookableDays: number | null;
      readonly rail: DepositRailSelection | null;
    };

export function decideDepositGate(input: DepositGateInput): DepositGateDecision {
  const triggers = evaluateDepositTriggers(input.triggerParams, input.context, 'CHECKOUT');
  // sans déclencheur : aucun rail évalué, aucune H_requise, jamais DEPOSIT_RAIL_UNAVAILABLE (T70)
  if (!triggers.required) return { kind: 'NOT_REQUIRED', triggers };
  const amountMinor = depositAmountFor(input.amounts, input.context.valueClass);
  const params = completeRailParams(input.railParams);
  if (amountMinor === null || params === null) {
    return { kind: 'REFUSED', code: 'PARAM_MISSING', triggers, maxBookableDays: null, rail: null };
  }
  const rail = selectDepositRail(
    {
      amountMinor,
      bookedAt: input.bookedAt,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
    },
    params,
    input.caps,
  );
  if (rail.mechanism === 'REFUSED') {
    return {
      kind: 'REFUSED',
      code: 'DEPOSIT_RAIL_UNAVAILABLE',
      triggers,
      maxBookableDays: Math.floor(rail.maxSingleTripMinutes / DAY_MINUTES),
      rail,
    };
  }
  return { kind: 'REQUIRED', triggers, amountMinor, rail: { ...rail, mechanism: rail.mechanism } };
}

// --- échéancier ----------------------------------------------------------------------------------

/**
 * `auth_expiry` : l'expiration RENVOYÉE par le PSP si elle existe, sinon `auth_at_réel + V`
 * (08 BR-PAY-06, VERIF_12-F7). `auth_at_réel` = heure d'acceptation de l'autorisation.
 */
export function depositAuthExpiry(
  authorizedAt: Date,
  vHours: number,
  returnedExpiry: Date | null,
): Date {
  const computed = new Date(authorizedAt.getTime() + vHours * HOUR_MS);
  if (returnedExpiry === null) return computed;
  // jamais au-delà de la validité contractuelle connue (lecture prudente)
  return new Date(Math.min(returnedExpiry.getTime(), computed.getTime()));
}

/** `release_at = (checkout_at ?? scheduled_end) + release_delay_h`. */
export function depositReleaseAt(
  checkoutAt: Date | null,
  scheduledEnd: Date,
  releaseDelayH: number,
): Date {
  return new Date((checkoutAt ?? scheduledEnd).getTime() + releaseDelayH * HOUR_MS);
}

/** `deposit_decision_at = min(release_at, auth_expiry − deposit_safety_h)` ; jamais après l'expiration. */
export function depositDecisionAt(releaseAt: Date, authExpiry: Date, safetyH: number): Date {
  return new Date(Math.min(releaseAt.getTime(), authExpiry.getTime() - safetyH * HOUR_MS));
}

/**
 * Ré-autorisation (rail a) planifiée à `auth_expiry − deposit_reauth_lead_h`, seulement si
 * l'autorisation en cours ne tient pas jusqu'à `release_at` (marge `deposit_safety_h` comprise) ;
 * `null` sinon. Après une ré-autorisation acceptée, l'appelant recalcule avec la nouvelle expiration.
 */
export function depositReauthDueAt(
  authExpiry: Date,
  releaseAt: Date,
  safetyH: number,
  reauthLeadH: number,
): Date | null {
  if (releaseAt.getTime() <= authExpiry.getTime() - safetyH * HOUR_MS) return null;
  return new Date(authExpiry.getTime() - reauthLeadH * HOUR_MS);
}

// --- décision : commandes au PSP ------------------------------------------------------------------

/** Frais annexe de la liste fermée acceptée au checkout (08 BR-PAY-06 « Finalité »). */
export interface DepositIncidentalFee {
  readonly id: string;
  readonly amount: Money;
  /** Part de l'hôte de la ligne (BR-PROT-08 : 100 % carburant, péages, nettoyage ; plan sinon). */
  readonly hostShare: Ratio;
  /** Preuve photo ou relevé horodaté (CLM-034). */
  readonly proven: boolean;
  /** Notifié au voyageur à cet instant. */
  readonly notifiedAt: Date;
  readonly disputed: boolean;
}

export interface DepositDecisionInput {
  readonly mechanism: DepositRail;
  readonly amount: Money;
  readonly decisionAt: Date;
  /** `deposit_fee_notice_h` (48 h, BR-REIMB-03). */
  readonly feeNoticeH: number;
  readonly fees: readonly DepositIncidentalFee[];
  readonly caps: DepositRailCapabilities;
}

/** Une part d'un frais : capturée sur la caution ou débitée par MIT. */
export interface DepositFeePart {
  readonly feeId: string;
  readonly amount: Money;
  readonly legs: LegAmounts;
}

export type DepositStep =
  | {
      readonly op: 'CAPTURE';
      readonly amountMinor: bigint;
      readonly legs: LegAmounts;
      readonly parts: readonly DepositFeePart[];
    }
  | { readonly op: 'VOID'; readonly releasedMinor: bigint }
  /** Aucune annulation possible (`SUPPORTS_VOID` inconnue) : l'autorisation expire seule. */
  | { readonly op: 'LET_EXPIRE'; readonly releasedMinor: bigint }
  | { readonly op: 'REFUND'; readonly amountMinor: bigint; readonly legs: LegAmounts }
  | {
      readonly op: 'MIT_CHARGE';
      readonly reason: 'DELAYED_CHARGES';
      readonly amountMinor: bigint;
      readonly legs: LegAmounts;
      readonly parts: readonly DepositFeePart[];
    }
  /** MIT non validée : les frais deviennent une dette (BR-PAY-10), jamais pris sur la caution. */
  | {
      readonly op: 'DEBT';
      readonly amountMinor: bigint;
      readonly parts: readonly DepositFeePart[];
    };

export interface DepositDecisionPlan {
  readonly steps: readonly DepositStep[];
  /** Statut final de `deposit_hold`. */
  readonly finalStatus: DepositHoldStatus;
  readonly capturedMinor: bigint;
  readonly releasedMinor: bigint;
  readonly mitMinor: bigint;
}

const ZERO_LEGS: LegAmounts = { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n };

const addLegs = (a: LegAmounts, b: LegAmounts): LegAmounts => ({
  HOST: a.HOST + b.HOST,
  INSURER: a.INSURER + b.INSURER,
  TAX_THIRD_PARTY: a.TAX_THIRD_PARTY + b.TAX_THIRD_PARTY,
  PLATFORM: a.PLATFORM + b.PLATFORM,
});

/** Jambes d'une part de frais : `allocHost` par ligne, la plateforme prend le complément (E7). */
function feeLegs(amount: Money, hostShare: Ratio): LegAmounts {
  const host = allocHost(amount, hostShare);
  return { ...ZERO_LEGS, HOST: host.amountMinor, PLATFORM: subtract(amount, host).amountMinor };
}

const part = (fee: DepositIncidentalFee, amount: Money): DepositFeePart => ({
  feeId: fee.id,
  amount,
  legs: feeLegs(amount, fee.hostShare),
});

const sumParts = (parts: readonly DepositFeePart[]): { amountMinor: bigint; legs: LegAmounts } =>
  parts.reduce(
    (acc, p) => ({
      amountMinor: acc.amountMinor + p.amount.amountMinor,
      legs: addLegs(acc.legs, p.legs),
    }),
    { amountMinor: 0n, legs: ZERO_LEGS },
  );

/** Frais capturable sur la caution : prouvé, non contesté, notifié ≥ `feeNoticeH` avant la décision. */
export function isCapturableOnDeposit(
  fee: DepositIncidentalFee,
  decisionAt: Date,
  feeNoticeH: number,
): boolean {
  return (
    fee.proven &&
    !fee.disputed &&
    fee.notifiedAt.getTime() + feeNoticeH * HOUR_MS <= decisionAt.getTime()
  );
}

/**
 * Commandes de la décision de caution (08 BR-PAY-06 « Libération à heure fixe » ; E3 replis 1, 2
 * et 4 ; T57, T58). Une Claim, une Invoice ou des frais d'assistance ne la suspendent jamais (ils
 * ne sont pas des entrées). Les frais capturables sont pris dans l'ordre reçu, plafonnés au montant
 * de la caution ; le dépassement et les autres frais passent par MIT `DELAYED_CHARGES` séparée.
 */
export function planDepositDecision(input: DepositDecisionInput): DepositDecisionPlan {
  const { amount, caps } = input;
  if (!Number.isSafeInteger(input.feeNoticeH) || input.feeNoticeH < 0) {
    throw new PaymentError('INVALID_REQUEST', 'caution : délai de notification invalide');
  }
  const currency = amount.currency;
  for (const fee of input.fees) {
    if (fee.amount.currency !== currency || fee.amount.amountMinor <= 0n) {
      throw new PaymentError('INVALID_REQUEST', `frais ${fee.id} : montant ou devise invalides`);
    }
  }
  const network = caps.network ?? '*';
  const has = (name: 'SUPPORTS_PARTIAL_CAPTURE' | 'SUPPORTS_VOID' | 'SUPPORTS_MIT'): boolean =>
    caps.capabilities.bool(name, CARD, network);

  // répartition : capturable sur la caution (dans la limite du montant) / débit séparé
  let room: Money = amount;
  const onDeposit: DepositFeePart[] = [];
  const separate: DepositFeePart[] = [];
  for (const fee of input.fees) {
    if (!isCapturableOnDeposit(fee, input.decisionAt, input.feeNoticeH) || isZero(room)) {
      separate.push(part(fee, fee.amount));
      continue;
    }
    const taken = fee.amount.amountMinor <= room.amountMinor ? fee.amount : room;
    onDeposit.push(part(fee, taken));
    room = subtract(room, taken);
    const rest = subtract(fee.amount, taken);
    if (!isZero(rest)) separate.push(part(fee, rest));
  }

  const steps: DepositStep[] = [];
  let captured = 0n;
  let released = 0n;
  let finalStatus: DepositHoldStatus;
  const mitParts: DepositFeePart[] = [];

  if (input.mechanism === 'CHARGE_THEN_REFUND') {
    // remboursement total émis à la décision, frais en MIT (08 BR-PAY-06 « Débit puis
    // remboursement », branche sans retenue) : aucune retenue sur des fonds détenus
    steps.push({ op: 'REFUND', amountMinor: amount.amountMinor, legs: chargeLegs(amount) });
    mitParts.push(...onDeposit, ...separate);
    finalStatus = 'REFUNDED';
  } else {
    const x = sumParts(onDeposit);
    const full = x.amountMinor === amount.amountMinor;
    if (x.amountMinor > 0n && (full || has('SUPPORTS_PARTIAL_CAPTURE'))) {
      // repli 1 : capture partielle (ou totale) des seuls frais dus, puis VOID du reste
      steps.push({ op: 'CAPTURE', amountMinor: x.amountMinor, legs: x.legs, parts: onDeposit });
      captured = x.amountMinor;
      mitParts.push(...separate);
      finalStatus = 'PARTIALLY_CAPTURED';
    } else {
      // repli 2 (T58) : aucun frais capturé sur la caution ; tout passe par MIT séparée
      mitParts.push(...onDeposit, ...separate);
      finalStatus = 'VOIDED';
    }
    const rest = amount.amountMinor - captured;
    if (rest > 0n) {
      if (has('SUPPORTS_VOID')) {
        steps.push({ op: 'VOID', releasedMinor: rest });
      } else {
        // repli 4 : annulation impossible ⇒ l'autorisation expire seule (message au voyageur)
        steps.push({ op: 'LET_EXPIRE', releasedMinor: rest });
        if (captured === 0n) finalStatus = 'EXPIRED';
      }
      released = rest;
    }
  }

  const mit = sumParts(mitParts);
  if (mit.amountMinor > 0n) {
    steps.push(
      has('SUPPORTS_MIT')
        ? {
            op: 'MIT_CHARGE',
            reason: 'DELAYED_CHARGES',
            amountMinor: mit.amountMinor,
            legs: mit.legs,
            parts: mitParts,
          }
        : { op: 'DEBT', amountMinor: mit.amountMinor, parts: mitParts },
    );
  }
  if (input.mechanism === 'CHARGE_THEN_REFUND') released = amount.amountMinor;
  return {
    steps,
    finalStatus,
    capturedMinor: captured,
    releasedMinor: released,
    mitMinor: mit.amountMinor,
  };
}

/**
 * Jambes de l'ordre qui pose la caution (autorisation ou débit) : la caution n'est pas une jambe
 * (08 BR-PAY-06) ; l'ordre est porté en entier sur `PLATFORM`, le compte marchand de Kmino, et
 * chaque capture de frais porte ensuite ses propres jambes.
 */
export function chargeLegs(amount: Money): LegAmounts {
  return { ...ZERO_LEGS, PLATFORM: amount.amountMinor };
}

// --- machine d'état de deposit_hold.status ---------------------------------------------------------

export const DEPOSIT_HOLD_STATUSES = [
  'PLANNED',
  'AUTHORIZED',
  'PARTIALLY_CAPTURED',
  'VOIDED',
  'REFUNDED',
  'EXPIRED',
] as const;
export type DepositHoldStatus = (typeof DEPOSIT_HOLD_STATUSES)[number];

export const DEPOSIT_EVENTS = [
  'AUTHORIZED',
  'AUTH_FAILED',
  'REAUTHORIZED',
  'REAUTH_REFUSED',
  'CAPTURED',
  'VOIDED',
  'REFUNDED',
  'EXPIRED',
] as const;
export type DepositEvent = (typeof DEPOSIT_EVENTS)[number];

/**
 * Transitions (16 PAY-011 « États ») : `PLANNED → AUTHORIZED → PARTIALLY_CAPTURED / VOIDED /
 * REFUNDED / EXPIRED`. Une ré-autorisation (acceptée ou refusée) laisse `AUTHORIZED` : un refus est
 * signalé à l'ops, sans débit. Un refus d'autorisation laisse `PLANNED` (EC-27). Les états finaux
 * n'ont aucune sortie. `NOT_REQUIRED` n'a ni statut actif ni minuterie (17 §3.2.7).
 */
const TRANSITIONS: Readonly<
  Record<DepositHoldStatus, Partial<Record<DepositEvent, DepositHoldStatus>>>
> = {
  PLANNED: { AUTHORIZED: 'AUTHORIZED', AUTH_FAILED: 'PLANNED' },
  AUTHORIZED: {
    REAUTHORIZED: 'AUTHORIZED',
    REAUTH_REFUSED: 'AUTHORIZED',
    CAPTURED: 'PARTIALLY_CAPTURED',
    VOIDED: 'VOIDED',
    REFUNDED: 'REFUNDED',
    EXPIRED: 'EXPIRED',
  },
  PARTIALLY_CAPTURED: {},
  VOIDED: {},
  REFUNDED: {},
  EXPIRED: {},
};

export function nextDepositStatus(
  status: DepositHoldStatus,
  event: DepositEvent,
): DepositHoldStatus {
  const next = TRANSITIONS[status][event];
  if (next === undefined) {
    throw new PaymentError('INVALID_REQUEST', `caution : transition ${status} → ${event} refusée`);
  }
  return next;
}
