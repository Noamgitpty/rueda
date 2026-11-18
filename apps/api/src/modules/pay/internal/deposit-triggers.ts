/**
 * Déclencheurs de la caution conditionnelle « comme Turo » (08 BR-PAY-06 « Caution conditionnelle »,
 * « Fail-closed », « Montant unique », « Moment de l'évaluation » ; ADR-108 ; US-225, ADR-164).
 *
 * **Aucune caution par défaut** : un trip n'a de caution que si un déclencheur est vrai. Fonction
 * pure, sans horloge ni base : les paramètres du pays sont lus par `PgDepositRailConfigReader`
 * (17 §7.2 ; graine 0138) et passés ici. Aucune constante de pays.
 *
 * Fail-closed (l'erreur sûre est de PRENDRE une caution, jamais de l'omettre) : un paramètre absent
 * ou illisible (`undefined`), une classe inconnue (`null`), un âge inconnu ou un contrôle de risque
 * déployé mais sans réponse (`riskFlagged = null`) rendent le déclencheur correspondant VRAI.
 * `riskControlDeployed = false` (contrôle non déployé ≠ en panne) : `RISK` n'est pas évalué.
 * Avant le checkout, seuls `COUNTRY` et `CLASS` (connus du véhicule) sont évalués.
 *
 * Le résultat (`triggers`, âge, `riskEvaluated`) est **[C2]** : réservé à SYSTEM et à l'ops
 * (17 §3.2.7 `deposit_hold.triggers`, `params_snapshot`), jamais rendu au voyageur ni à l'hôte.
 */

/** Déclencheurs, liste fermée (17 §3.2.7 `deposit_hold.triggers`), dans l'ordre alphabétique. */
export const DEPOSIT_TRIGGERS = ['AGE', 'CLASS', 'COUNTRY', 'RISK'] as const;
export type DepositTrigger = (typeof DEPOSIT_TRIGGERS)[number];

/** Classes de valeur du catalogue (08 BR-ACC-05 ; ADR-159). */
export const DEPOSIT_VALUE_CLASSES = ['STANDARD', 'PREMIUM', 'LUXE'] as const;
export type DepositValueClass = (typeof DEPOSIT_VALUE_CLASSES)[number];

/** Moment de l'évaluation (08 BR-PAY-06) : fiche, recherche, devis d'un visiteur ; checkout. */
export type DepositStage = 'PRE_CHECKOUT' | 'CHECKOUT';

/**
 * Paramètres de déclencheur d'un pays (17 §7.2). `undefined` : absent ou illisible (fail-closed :
 * le déclencheur correspondant est vrai, sauf `riskControlDeployed`, absent ⇒ contrôle déployé).
 */
export interface DepositTriggerParams {
  /** `deposit_always_required[pays]`. */
  readonly alwaysRequired?: boolean | undefined;
  /** `deposit_trigger_classes[pays]`. */
  readonly triggerClasses?: readonly DepositValueClass[] | undefined;
  /** `deposit_young_driver_age[pays]` (seuil strict). */
  readonly youngDriverAge?: number | undefined;
  /** `deposit_young_driver_classes[pays]` (vide au PA et au PY : DEC-FONDATEUR-21). */
  readonly youngDriverClasses?: readonly DepositValueClass[] | undefined;
  /** `deposit_on_risk_flag[pays]`. */
  readonly onRiskFlag?: boolean | undefined;
  /** `risk_control_deployed[pays]` : `false` ⇒ RISK non évalué. */
  readonly riskControlDeployed?: boolean | undefined;
}

export interface DepositTriggerContext {
  /** `value_class` du véhicule (catalogue, ADR-159) ; `null` : inconnue. */
  readonly valueClass: DepositValueClass | null;
  /**
   * Âges entiers des conducteurs approuvés à la date de réservation (BR-ACC-04), depuis le document
   * vérifié ; `null` (ou un âge `null`, ou une liste vide) : inconnu. Ignoré avant le checkout.
   */
  readonly driverAges?: readonly (number | null)[] | null;
  /** Signal du contrôle de risque ; `null` : panne, délai dépassé ou réponse illisible. */
  readonly riskFlagged?: boolean | null;
}

export interface DepositTriggerDecision {
  readonly required: boolean;
  /** Déclencheurs vrais, triés ; vide ⇔ aucune caution. [C2] */
  readonly triggers: readonly DepositTrigger[];
  /** Âge entier du plus jeune conducteur approuvé (`params_snapshot`) ; `null` : inconnu ou non lu. */
  readonly youngestDriverAge: number | null;
  /** `params_snapshot.risk_evaluated` : faux avant le checkout ou si le contrôle n'est pas déployé. */
  readonly riskEvaluated: boolean;
}

const isAge = (a: unknown): a is number => Number.isSafeInteger(a) && (a as number) >= 0;

/** Plus jeune âge connu ; `null` si la liste est absente, vide ou contient un âge inconnu. */
function youngestOf(ages: readonly (number | null)[] | null | undefined): number | null {
  if (ages === null || ages === undefined || ages.length === 0) return null;
  let youngest: number | null = null;
  for (const a of ages) {
    if (!isAge(a)) return null;
    youngest = youngest === null ? a : Math.min(youngest, a);
  }
  return youngest;
}

/** Classe dans une liste de paramètre ; liste absente ou classe inconnue ⇒ vrai (fail-closed). */
const inClasses = (
  list: readonly DepositValueClass[] | undefined,
  cls: DepositValueClass | null,
): boolean => list === undefined || cls === null || list.includes(cls);

/**
 * Déclencheurs vrais au moment `stage` (08 BR-PAY-06 ; vecteurs T69–T73, T70 c ; oracle
 * `docs/specs/tools/check_t49plus.py`, fonction `deposit_required`).
 */
export function evaluateDepositTriggers(
  params: DepositTriggerParams,
  context: DepositTriggerContext,
  stage: DepositStage,
): DepositTriggerDecision {
  const triggers = new Set<DepositTrigger>();
  if (params.alwaysRequired !== false) triggers.add('COUNTRY');
  if (inClasses(params.triggerClasses, context.valueClass)) triggers.add('CLASS');
  if (stage === 'PRE_CHECKOUT') {
    // AGE et RISK ne sont jamais évalués avant le checkout : leur inconnu n'est pas un « vrai »
    return done(triggers, null, false);
  }
  const youngest = youngestOf(context.driverAges);
  const age = params.youngDriverAge;
  if (
    inClasses(params.youngDriverClasses, context.valueClass) &&
    (!isAge(age) || youngest === null || youngest < age)
  ) {
    triggers.add('AGE');
  }
  const riskEvaluated = params.riskControlDeployed !== false;
  if (riskEvaluated) {
    const flagged = context.riskFlagged;
    // paramètre absent ⇒ vrai quel que soit le signal (T72 a) ; signal inconnu ⇒ vrai (T72 b)
    const signal = flagged === null || flagged === undefined || flagged;
    if (params.onRiskFlag === undefined || (params.onRiskFlag && signal)) triggers.add('RISK');
  }
  return done(triggers, youngest, riskEvaluated);
}

function done(
  triggers: ReadonlySet<DepositTrigger>,
  youngestDriverAge: number | null,
  riskEvaluated: boolean,
): DepositTriggerDecision {
  const sorted = DEPOSIT_TRIGGERS.filter((t) => triggers.has(t));
  return { required: sorted.length > 0, triggers: sorted, youngestDriverAge, riskEvaluated };
}

/**
 * Montant unique de la caution (08 BR-PAY-06 « Montant unique », T73) : `deposit_amount[pays][classe]`,
 * jamais cumulé, jamais inventé ni ramené à 0. Absent, nul, illisible ou classe inconnue ⇒
 * `null` : l'appelant refuse la réservation AVANT le paiement (`PARAM_MISSING`, T72 c).
 */
export function depositAmountFor(
  amounts: Readonly<Partial<Record<DepositValueClass, bigint>>> | undefined,
  valueClass: DepositValueClass | null,
): bigint | null {
  if (amounts === undefined || valueClass === null) return null;
  const amount = amounts[valueClass];
  return typeof amount === 'bigint' && amount > 0n ? amount : null;
}
