/**
 * Plans de gains de l'hôte (US-226 partie 226b, ADR-137 ; 16 PRT-007 / PRT-008 / HST-048 ; 08
 * BR-PROT-06) côté SERVEUR du site : lecture défensive de `GET /host/accounts/{orgId}/earnings-plans`
 * (ADR-136) et nom lisible d'un plan. Toute réponse mal formée est refusée (`null`) : l'écran
 * affiche son état d'erreur, jamais un plan deviné. Le plan `PRO` n'est jamais proposé (sans objet
 * depuis le pivot P2P), même si une réponse le portait. Aucune constante de pays.
 */
import type { MessageKey, Translator } from '@rueda/i18n';
import type { ApiResult } from './api-client.ts';

/** Code de plan de `host_share_pct` (forme seulement ; accents permis, comme l'API). */
const PLAN_CODE = /^[A-Z][A-Z0-9_ÁÉÍÓÚÑ]{0,31}$/u;
/** Part de l'hôte « n/d » (`host_share_pct`), fraction de ]0 ; 1]. */
const SHARE = /^([1-9][0-9]{0,5})\/([1-9][0-9]{0,5})$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Plan des flottes, sans objet (16 PRT-007) : jamais affiché ni proposé. */
export const RETIRED_PLAN = 'PRO';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface OfferedPlanView {
  readonly planCode: string;
  /** Part de l'hôte en pourcentage (affichage seulement, jamais un calcul d'argent). */
  readonly sharePercent: number;
}

export interface VehiclePlanView {
  readonly vehicleId: string;
  /** Plan en vigueur (choisi, sinon plan par défaut du pays) ; `null` : aucun plan connu. */
  readonly planCode: string | null;
  readonly chosen: boolean;
  readonly chosenAt: string | null;
}

export interface EarningsPlansView {
  readonly defaultPlan: string | null;
  readonly offered: readonly OfferedPlanView[];
  readonly vehicles: readonly VehiclePlanView[];
}

/**
 * Part « n/d » en pourcentage, à un dixième près au plus (3/4 ⇒ 75 ; 17/20 ⇒ 85) ; `null` si la
 * fraction est illisible, hors de ]0 ; 1] ou n'a pas de pourcentage exact au dixième.
 */
export function sharePercentOf(share: unknown): number | null {
  if (typeof share !== 'string') return null;
  const m = SHARE.exec(share);
  if (m === null) return null;
  const n = Number(m[1]);
  const d = Number(m[2]);
  if (n > d) return null;
  // pourcentage × 10 entier : exact au dixième, sinon refusé (jamais un arrondi caché)
  if ((n * 1000) % d !== 0) return null;
  return (n * 1000) / d / 10;
}

const planOf = (v: unknown): string | null =>
  typeof v === 'string' && PLAN_CODE.test(v) && v !== RETIRED_PLAN ? v : null;

/** `{ plans: … }` de l'API ; `null` si illisible. */
export function earningsPlansOf(reply: ApiResult): EarningsPlansView | null {
  if (reply.status !== 200 || !isObj(reply.json) || !isObj(reply.json['plans'])) return null;
  const p = reply.json['plans'];
  const defaultPlan = p['defaultPlan'] === null ? null : planOf(p['defaultPlan']);
  if (p['defaultPlan'] !== null && defaultPlan === null) return null;
  if (!Array.isArray(p['offered']) || !Array.isArray(p['vehicles'])) return null;
  const offered: OfferedPlanView[] = [];
  for (const o of p['offered'] as unknown[]) {
    if (!isObj(o) || typeof o['planCode'] !== 'string') return null;
    // PRO jamais proposé (même si l'API le rendait) ; tout autre code mal formé : refus
    if (o['planCode'] === RETIRED_PLAN) continue;
    const planCode = planOf(o['planCode']);
    const sharePercent = sharePercentOf(o['hostShare']);
    if (planCode === null || sharePercent === null) return null;
    if (offered.some((x) => x.planCode === planCode)) return null;
    offered.push({ planCode, sharePercent });
  }
  const vehicles: VehiclePlanView[] = [];
  for (const v of p['vehicles'] as unknown[]) {
    if (!isObj(v) || typeof v['vehicleId'] !== 'string' || !UUID.test(v['vehicleId'])) return null;
    const planCode = v['planCode'] === null ? null : planOf(v['planCode']);
    if (v['planCode'] !== null && planCode === null) return null;
    if (typeof v['chosen'] !== 'boolean') return null;
    const at = v['chosenAt'];
    if (at !== null && (typeof at !== 'string' || !INSTANT.test(at))) return null;
    vehicles.push({
      vehicleId: v['vehicleId'],
      planCode,
      chosen: v['chosen'] === true,
      chosenAt: at === null ? null : (at as string),
    });
  }
  return { defaultPlan, offered, vehicles };
}

/** Clé du nom d'un plan connu ; un plan d'un autre pays est nommé par sa part. */
const PLAN_NAMES: Readonly<Record<string, MessageKey>> = {
  ESTÁNDAR: 'web.a11.plan.name.ESTANDAR',
};

/** Pourcentage affiché avec les séparateurs de la langue (75 ; 87,5). */
export function percentLabel(i18n: Translator, percent: number): string {
  return i18n.number(percent, { fractionDigits: Number.isInteger(percent) ? 0 : 1 });
}

/** Nom lisible d'un plan (jamais son code brut). */
export function planName(i18n: Translator, plan: OfferedPlanView): string {
  const key = PLAN_NAMES[plan.planCode];
  return key === undefined
    ? i18n.t('web.a11.plan.name.other', { share: percentLabel(i18n, plan.sharePercent) })
    : i18n.t(key);
}

/** « Estándar · recibes el 75 % del precio » ; `null` si le plan n'est pas (ou plus) vendu. */
export function planSummary(
  i18n: Translator,
  plans: EarningsPlansView,
  planCode: string | null,
): string | null {
  const plan = plans.offered.find((o) => o.planCode === planCode);
  if (plan === undefined) return null;
  return i18n.t('web.a11.plan.option', {
    plan: planName(i18n, plan),
    share: percentLabel(i18n, plan.sharePercent),
  });
}
