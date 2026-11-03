/**
 * Garde des routes de la console interne (US-012), exportée par `index.ts` pour tout module
 * (SUP, AUD…). Une route gardée exige une session ÉLEVÉE par TOTP d'un membre du staff dont le
 * compte et au moins un rôle sont en cours :
 * - pas de session : 401 AUTH_REQUIRED ;
 * - pas de rôle interne : 403 FORBIDDEN ;
 * - pas de TOTP, enrôlement à finir, facteur verrouillé ou session non élevée : 403 2FA_REQUIRED
 *   (critère 2 d'US-012 ; le refus est journalisé par la base).
 * Comme `SessionGuard` : écriture => JSON exigé (CSRF), réponse jamais mise en cache. Débit limité
 * par IP (429 RATE_LIMITED, StaffAuthService.throttle). Le contrôle de
 * permission et de portée pays est fait par chaque commande, en base.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { readSessionToken } from '../cookies.js';
import { assertJsonWrite } from '../csrf.guard.js';
import type { HttpRequest, HttpResponse } from '../http.js';
import { StaffAuthService } from './staff.service.js';
import type { StaffPrincipal } from './staff.service.js';

const principals = new WeakMap<object, StaffPrincipal>();

/** Principal posé par `StaffGuard` ; `null` si la route n'est pas gardée. */
export function staffPrincipalOf(request: object): StaffPrincipal | null {
  return principals.get(request) ?? null;
}

@Injectable()
export class StaffGuard implements CanActivate {
  constructor(@Inject(StaffAuthService) private readonly staff: StaffAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    assertJsonWrite(request);
    http.getResponse<HttpResponse>().setHeader('Cache-Control', 'no-store');
    this.staff.throttle(request.ip ?? null); // 429 par IP avant tout appel à la base
    const principal = await this.staff.principal(readSessionToken(request.headers['cookie']));
    principals.set(request, principal);
    return true;
  }
}
