/**
 * Avertissements réglementaires versionnés d'un pays (US-125 critère 4 ; 16 LEG-021), lus à
 * `GET /regulatory-notices?country=XX&audience=HOST|GUEST`. La liste par pays vient de la
 * configuration pays de l'API (aucun pays dans le code du site) ; le texte vient du catalogue
 * `@rueda/i18n` dans la langue de la vue (es, en, fr, pt). Lecture défensive : une réponse
 * illisible ou une clé absente du catalogue est ignorée (jamais une clé brute à l'écran).
 */
import { CATALOGS } from '@rueda/i18n';
import type { ApiResult } from './api-client.ts';

export type NoticeAudience = 'HOST' | 'GUEST';

export interface RegulatoryNoticeView {
  readonly id: string;
  readonly version: number;
  /** Préfixe de la clé du catalogue : `<prefix>.title` et `<prefix>.body`. */
  readonly messageKey: string;
}

const KEY = /^common\.regulatory\.[a-z][a-zA-Z0-9]*\.v[1-9][0-9]*\.(host|guest)$/;
const ID = /^[a-z][a-zA-Z0-9]{0,47}$/;

/** Le catalogue de référence (es fait foi, les quatre langues sont à parité) a ce texte. */
function known(prefix: string): boolean {
  const messages = CATALOGS.es.messages as Readonly<Record<string, unknown>>;
  return (
    typeof messages[`${prefix}.title`] === 'string' &&
    typeof messages[`${prefix}.body`] === 'string'
  );
}

/** Avertissements d'une réponse de l'API ; `[]` si la réponse est absente ou illisible. */
export function regulatoryNoticesOf(
  reply: ApiResult,
  country: string,
  audience: NoticeAudience,
): RegulatoryNoticeView[] {
  if (reply.status !== 200 || typeof reply.json !== 'object' || reply.json === null) return [];
  const j = reply.json as Record<string, unknown>;
  if (j['country'] !== country || j['audience'] !== audience || !Array.isArray(j['notices'])) {
    return [];
  }
  const out: RegulatoryNoticeView[] = [];
  const suffix = audience === 'HOST' ? '.host' : '.guest';
  for (const n of j['notices'] as unknown[]) {
    if (typeof n !== 'object' || n === null) continue;
    const r = n as Record<string, unknown>;
    const { id, version, messageKey } = r;
    if (
      typeof id !== 'string' ||
      !ID.test(id) ||
      typeof version !== 'number' ||
      !Number.isSafeInteger(version) ||
      version < 1 ||
      typeof messageKey !== 'string' ||
      !KEY.test(messageKey) ||
      messageKey !== `common.regulatory.${id}.v${version}${suffix}` ||
      !known(messageKey)
    ) {
      continue;
    }
    out.push({ id, version, messageKey });
  }
  return out;
}

/** L'API des avertissements n'a pas répondu (injoignable ou erreur) : l'écran le dit. */
export function regulatoryNoticesUnavailable(reply: ApiResult): boolean {
  return reply.status !== 200;
}

/** Chemin de la lecture des avertissements d'un pays pour un public. */
export function regulatoryNoticesPath(country: string, audience: NoticeAudience): string {
  return `/regulatory-notices?country=${encodeURIComponent(country)}&audience=${audience}`;
}
