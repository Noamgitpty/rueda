/**
 * Aide et urgence (S17, US-310, ADR-182) : lecture défensive des réponses de `GET /help` et de
 * `GET /trips/{id}/help`. Les numéros viennent de la configuration pays de l'API (jamais du code du
 * site) ; un numéro absent reste `null` et l'écran renvoie à l'aide dans l'appli, sans en inventer.
 * Une forme inattendue ⇒ `null` (l'écran le dit, sans numéro deviné). Aucun téléphone d'une partie
 * du trip n'existe dans ces réponses.
 */
import { CATALOGS } from '@rueda/i18n';
import type { CatalogLanguage, MessageKey } from '@rueda/i18n';
import type { ApiResult } from './api-client.ts';

/** Motifs fermés de la demande d'aide (même liste que l'API, ADR-182). */
export const HELP_TOPICS = ['ACCIDENT', 'SAFETY', 'BREAKDOWN', 'HANDOVER', 'OTHER'] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number];

export interface HelpCountry {
  readonly country: string;
  readonly names: Readonly<Record<CatalogLanguage, string>>;
  readonly emergencyNumber: string;
  /** Clé du catalogue du nom de l'autorité de circulation (vérifiée dans le catalogue). */
  readonly authorityKey: MessageKey;
  readonly supportPhone: string | null;
  readonly insurerAssistancePhone: string | null;
  readonly supportHours: { readonly from: string; readonly to: string } | null;
}

export interface TripHelp {
  readonly tripId: string;
  readonly role: 'GUEST' | 'HOST';
  readonly help: HelpCountry;
}

const COUNTRY = /^[A-Z]{2}$/;
const E164 = /^\+[1-9][0-9]{6,14}$/;
const EMERGENCY = /^[0-9]{3,6}$/;
const CLOCK = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const AUTHORITY_KEY = /^common\.help\.authority\.[a-z][a-zA-Z0-9]{0,31}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LANGUAGES = ['es', 'en', 'fr', 'pt'] as const;

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Numéro E.164 ou `null` ; toute autre forme refuse la réponse entière (`undefined`). */
function phone(v: unknown): string | null | undefined {
  if (v === null) return null;
  return typeof v === 'string' && E164.test(v) ? v : undefined;
}

function countryOf(v: unknown): HelpCountry | null {
  const c = obj(v);
  if (c === null) return null;
  const names = obj(c['names']);
  const authority = obj(c['trafficAuthority']);
  const hours = c['supportHours'] === null ? null : obj(c['supportHours']);
  const support = phone(c['supportPhone']);
  const insurer = phone(c['insurerAssistancePhone']);
  const key = authority?.['messageKey'];
  if (
    typeof c['country'] !== 'string' ||
    !COUNTRY.test(c['country']) ||
    names === null ||
    LANGUAGES.some((l) => typeof names[l] !== 'string') ||
    typeof c['emergencyNumber'] !== 'string' ||
    !EMERGENCY.test(c['emergencyNumber']) ||
    typeof key !== 'string' ||
    !AUTHORITY_KEY.test(key) ||
    typeof (CATALOGS.es.messages as Readonly<Record<string, unknown>>)[key] !== 'string' ||
    support === undefined ||
    insurer === undefined ||
    (c['supportHours'] !== null &&
      (hours === null ||
        typeof hours['from'] !== 'string' ||
        typeof hours['to'] !== 'string' ||
        !CLOCK.test(hours['from']) ||
        !CLOCK.test(hours['to'])))
  ) {
    return null;
  }
  return {
    country: c['country'],
    names: names as Record<CatalogLanguage, string>,
    emergencyNumber: c['emergencyNumber'],
    authorityKey: key as MessageKey,
    supportPhone: support,
    insurerAssistancePhone: insurer,
    supportHours:
      hours === null ? null : { from: hours['from'] as string, to: hours['to'] as string },
  };
}

/** Pays de `GET /help` ; `null` si la réponse est absente ou illisible. */
export function helpCountriesOf(reply: ApiResult): HelpCountry[] | null {
  if (reply.status !== 200) return null;
  const j = obj(reply.json);
  if (j === null || !Array.isArray(j['countries'])) return null;
  const out: HelpCountry[] = [];
  for (const c of j['countries'] as unknown[]) {
    const v = countryOf(c);
    if (v === null) return null;
    out.push(v);
  }
  return out;
}

/** Aide d'un trip de `GET /trips/{id}/help` ; `null` si illisible. */
export function tripHelpOf(reply: ApiResult, tripId: string): TripHelp | null {
  if (reply.status !== 200) return null;
  const j = obj(reply.json);
  if (j === null || j['tripId'] !== tripId || (j['role'] !== 'GUEST' && j['role'] !== 'HOST')) {
    return null;
  }
  const help = countryOf(j['help']);
  return help === null ? null : { tripId, role: j['role'], help };
}

/** Issue d'une demande d'aide (`POST /trips/{id}/help-requests`) ; `null` si illisible. */
export function helpRequestOf(
  reply: ApiResult,
): { readonly outcome: 'OPENED' | 'DUPLICATE' | 'EXISTS'; readonly offHours: boolean } | null {
  if (reply.status !== 201 && reply.status !== 200) return null;
  const j = obj(reply.json);
  const outcome = j?.['outcome'];
  if (
    j === null ||
    typeof j['caseId'] !== 'string' ||
    !UUID.test(j['caseId']) ||
    (outcome !== 'OPENED' && outcome !== 'DUPLICATE' && outcome !== 'EXISTS') ||
    typeof j['offHours'] !== 'boolean'
  ) {
    return null;
  }
  return { outcome, offHours: j['offHours'] };
}

/** Lien d'appel d'un numéro (`tel:` E.164 ou numéro d'urgence court). */
export const telHref = (n: string): string => `tel:${n}`;
