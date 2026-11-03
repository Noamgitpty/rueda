/**
 * Types HTTP minimaux (sous-ensemble d'Express utilisé par IAM) et accès au principal d'une
 * requête. Le principal est rangé dans une `WeakMap` (pas de propriété ajoutée à la requête,
 * donc rien qu'un journal de la requête pourrait sérialiser).
 */
import type { AuthenticatedPrincipal } from './auth.service.js';

export interface HttpRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly ip?: string | undefined;
  readonly body?: unknown;
}

export interface HttpResponse {
  setHeader(name: string, value: string | string[]): unknown;
}

const principals = new WeakMap<object, AuthenticatedPrincipal>();

export function setPrincipal(request: object, principal: AuthenticatedPrincipal): void {
  principals.set(request, principal);
}

/** Principal posé par `SessionGuard` ; `null` si la route n'est pas gardée. */
export function principalOf(request: object): AuthenticatedPrincipal | null {
  return principals.get(request) ?? null;
}

export function headerValue(request: HttpRequest, name: string): string | null {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Les routes d'écriture n'acceptent que du JSON (parade CSRF complémentaire de SameSite=Lax). */
export function isJson(request: HttpRequest): boolean {
  const type = headerValue(request, 'content-type');
  return type !== null && /^application\/json\s*(;|$)/i.test(type);
}
