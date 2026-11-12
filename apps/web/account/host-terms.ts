/**
 * Lecture défensive de `GET /host/accounts/{orgId}/terms` (CGU de l'hôte, US-126), côté SERVEUR du
 * site seulement. Une réponse mal formée est refusée (`null`) : l'écran affiche alors « documents
 * indisponibles », jamais une donnée partielle ni une acceptation présumée.
 */
import { CATALOG_LANGUAGES } from '@rueda/i18n';
import type { ApiResult } from './api-client.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const positive = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export interface HostTermsView {
  /** `true` : la version exigée n'est pas acceptée ; la soumission d'une annonce est refusée. */
  readonly reacceptRequired: boolean;
  readonly timeZone: string;
  readonly title: string;
  readonly version: number;
  /** Langue du texte servi (repli sur l'espagnol, qui fait foi). */
  readonly locale: string;
  readonly draft: boolean;
  readonly validFrom: string;
  readonly acceptedVersion: number | null;
  readonly acceptedAt: string | null;
}

export function hostTermsOf(reply: ApiResult): HostTermsView | null {
  if (reply.status !== 200 || !isObj(reply.json)) return null;
  const j = reply.json;
  const d = j['document'];
  if (
    !isObj(d) ||
    d['kind'] !== 'TOS_HOST' ||
    !positive(d['version']) ||
    typeof d['title'] !== 'string' ||
    typeof d['draft'] !== 'boolean' ||
    typeof d['validFrom'] !== 'string' ||
    !ISO.test(d['validFrom']) ||
    !(CATALOG_LANGUAGES as readonly unknown[]).includes(d['locale']) ||
    typeof j['timeZone'] !== 'string' ||
    j['timeZone'] === '' ||
    typeof j['reacceptRequired'] !== 'boolean' ||
    (j['acceptedVersion'] !== null && !positive(j['acceptedVersion'])) ||
    (j['acceptedAt'] !== null &&
      (typeof j['acceptedAt'] !== 'string' || !ISO.test(j['acceptedAt'])))
  ) {
    return null;
  }
  return {
    reacceptRequired: j['reacceptRequired'],
    timeZone: j['timeZone'],
    title: d['title'],
    version: d['version'],
    locale: d['locale'] as string,
    draft: d['draft'],
    validFrom: d['validFrom'],
    acceptedVersion: (j['acceptedVersion'] as number | null) ?? null,
    acceptedAt: (j['acceptedAt'] as string | null) ?? null,
  };
}
