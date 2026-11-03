/**
 * Appels de la console vers l'API (US-012), par le mandataire de MÊME ORIGINE `/api/*` du
 * back-office (next.config.ts) : le cookie `__Host-session` reste lié au domaine du back-office
 * (domaine distinct de l'application voyageur, 17 §6.1) et n'est jamais lisible par le script.
 * Écritures en JSON seulement (parade CSRF de l'API). Aucun jeton, code ni secret journalisé.
 */
import { CATALOGS } from '@rueda/i18n';
import type { MessageKey } from '@rueda/i18n';
import type { ConsoleState, JournalEntryView, StaffRoleView } from './view.tsx';

export interface ApiError {
  readonly status: number;
  readonly code: string;
  readonly messageKey: MessageKey;
}

export type ApiResult<T> =
  { readonly ok: true; readonly body: T } | ({ readonly ok: false } & ApiError);

const FALLBACK: MessageKey = 'common.auth.requestInvalid';

/** Clé de message rendue par l'API, si elle existe dans le catalogue ; sinon une clé neutre. */
export function messageKeyOf(value: unknown): MessageKey {
  return typeof value === 'string' && value in CATALOGS.es.messages
    ? (value as MessageKey)
    : FALLBACK;
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function request<T>(
  fetchImpl: Fetch,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const response = await fetchImpl(`/api${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    ...(method === 'POST'
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }
      : {}),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    parsed = null;
  }
  if (response.ok) return { ok: true, body: parsed as T };
  const p = (parsed ?? {}) as { code?: unknown; messageKey?: unknown };
  return {
    ok: false,
    status: response.status,
    code: typeof p.code === 'string' ? p.code : 'UNKNOWN',
    messageKey: messageKeyOf(p.messageKey),
  };
}

export interface MeBody {
  readonly state: string;
  readonly roles: readonly StaffRoleView[];
}

/**
 * Écran à montrer selon l'état d'accès rendu par `GET /staff/me` (US-012 : un compte staff sans
 * TOTP n'a accès à rien ; la console n'apparaît que pour une session élevée).
 */
export function screenFor(
  state: string,
): ConsoleState['kind'] | 'denied:NOT_STAFF' | 'denied:TOTP_NOT_ENROLLED' | 'denied:LOCKED' {
  switch (state) {
    case 'ELEVATED':
      return 'console';
    case 'MFA_REQUIRED':
      return 'totp';
    case 'ENROLLMENT_REQUIRED':
      return 'enroll';
    case 'LOCKED':
      return 'denied:LOCKED';
    case 'NOT_STAFF':
      return 'denied:NOT_STAFF';
    default:
      // TOTP_NOT_ENROLLED et tout état inconnu : refus (fail-closed)
      return 'denied:TOTP_NOT_ENROLLED';
  }
}

export interface AuditBody {
  readonly entries: readonly (JournalEntryView & { readonly at: string })[];
}
