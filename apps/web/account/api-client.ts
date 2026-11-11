/**
 * Accès du site à l'API des comptes et des consentements (US-102), CÔTÉ SERVEUR seulement (pages et
 * actions serveur Next) : le navigateur ne parle qu'au site (aucune requête vers un autre hôte,
 * formulaires sans JavaScript), le site appelle l'API par son URL interne.
 *
 * - `WEB_API_URL` (http(s), sans identifiants) ; absente ou invalide : `unavailable` (fail-closed :
 *   aucun compte ne peut être créé, l'écran le dit).
 * - Le cookie de session `__Host-session` émis par l'API est reposé tel quel sur le site (mêmes
 *   attributs : `HttpOnly; Secure; SameSite=Lax; Path=/`) puis renvoyé à l'API à chaque appel.
 * - Adresse et navigateur du client : `X-Forwarded-For` reçu par le site et `User-Agent` sont
 *   transmis, pour la limitation de débit de l'API (US-052). La confiance accordée à ces en-têtes
 *   se règle côté API (`RUEDA_API_TRUST_PROXY`, ADR-091 point 6).
 * - Jamais de donnée personnelle dans une URL (corps JSON seulement), jamais de journal.
 */
import { CATALOG_LANGUAGES } from '@rueda/i18n';

export const API_URL_VAR = 'WEB_API_URL';
export const SESSION_COOKIE = '__Host-session';
const TIMEOUT_MS = 5_000;

type Env = Readonly<Record<string, string | undefined>>;

/** URL interne de l'API, ou `undefined` (absente, invalide, avec identifiants). */
export function apiUrl(env: Env = process.env): URL | undefined {
  const raw = env[API_URL_VAR];
  if (raw === undefined || raw === '') return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.username !== '' || url.password !== '') return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export interface ApiReply {
  readonly status: number;
  readonly json: unknown;
  /** Jeton de session posé par l'API (`Set-Cookie: __Host-session=…`), s'il y en a un. */
  readonly session: { readonly token: string; readonly maxAgeS: number } | null;
}

export type ApiResult = ApiReply | { readonly status: 'unavailable' };

export interface ClientContext {
  readonly forwardedFor: string | null;
  readonly userAgent: string | null;
  readonly sessionToken: string | null;
}

/** Jeton de session d'un en-tête `Set-Cookie` de l'API (le seul cookie qu'elle pose). */
export function sessionFromSetCookie(
  values: readonly string[],
): { token: string; maxAgeS: number } | null {
  for (const value of values) {
    const m = /^__Host-session=([A-Za-z0-9_-]{43});/.exec(value);
    if (m === null) continue;
    const age = /;\s*Max-Age=(\d+)/i.exec(value);
    return { token: m[1] as string, maxAgeS: age === null ? 0 : Number(age[1]) };
  }
  return null;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export async function callApi(
  method: 'GET' | 'POST',
  path: string,
  ctx: ClientContext,
  body?: unknown,
  options: { env?: Env; fetcher?: Fetcher } = {},
): Promise<ApiResult> {
  const base = apiUrl(options.env);
  if (base === undefined) return { status: 'unavailable' };
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (ctx.forwardedFor !== null) headers['x-forwarded-for'] = ctx.forwardedFor;
  if (ctx.userAgent !== null) headers['user-agent'] = ctx.userAgent.slice(0, 512);
  if (ctx.sessionToken !== null && /^[A-Za-z0-9_-]{43}$/.test(ctx.sessionToken)) {
    headers['cookie'] = `${SESSION_COOKIE}=${ctx.sessionToken}`;
  }
  try {
    const response = await (options.fetcher ?? fetch)(
      new URL(path.replace(/^\//, ''), base.href.endsWith('/') ? base : `${base.href}/`).href,
      {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text === '' ? null : (JSON.parse(text) as unknown);
    } catch {
      json = null;
    }
    return {
      status: response.status,
      json,
      session: sessionFromSetCookie(response.headers.getSetCookie()),
    };
  } catch {
    return { status: 'unavailable' };
  }
}

/** Code stable d'une réponse `{ code, messageKey }` de l'API, ou `null`. */
export function codeOf(reply: ApiResult): string | null {
  if (reply.status === 'unavailable') return null;
  const code = (reply.json as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : null;
}

export interface LegalDocumentView {
  readonly kind: 'TOS_GUEST' | 'PRIVACY' | 'MARKETING';
  readonly version: number;
  readonly isMajor: boolean;
  readonly locale: string;
  readonly title: string;
  readonly draft: boolean;
}

const KINDS = new Set(['TOS_GUEST', 'PRIVACY', 'MARKETING']);

/** Documents en vigueur d'une réponse `GET /legal/documents` (lecture défensive). */
export function documentsOf(reply: ApiResult): LegalDocumentView[] | null {
  if (reply.status !== 200) return null;
  const list = (reply.json as { documents?: unknown } | null)?.documents;
  if (!Array.isArray(list)) return null;
  const out: LegalDocumentView[] = [];
  for (const d of list as Record<string, unknown>[]) {
    if (
      !KINDS.has(String(d['kind'])) ||
      typeof d['version'] !== 'number' ||
      typeof d['title'] !== 'string' ||
      typeof d['draft'] !== 'boolean' ||
      !(CATALOG_LANGUAGES as readonly unknown[]).includes(d['locale'])
    ) {
      return null;
    }
    out.push({
      kind: d['kind'] as LegalDocumentView['kind'],
      version: d['version'],
      isMajor: d['isMajor'] === true,
      locale: d['locale'] as string,
      title: d['title'],
      draft: d['draft'],
    });
  }
  return out;
}
