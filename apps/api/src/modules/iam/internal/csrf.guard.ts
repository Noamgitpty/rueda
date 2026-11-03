/**
 * Parade CSRF commune (ADR-052 point 6) : toute écriture (méthode autre que GET, HEAD, OPTIONS)
 * exige `Content-Type: application/json`, sinon 415 `REQUEST_INVALID`. Un formulaire intersite
 * ne peut pas poser cet en-tête sans pré-requête CORS, et aucun CORS n'est ouvert.
 *
 * Appliquée par `SessionGuard` à toutes les écritures gardées, et par `JsonWriteGuard` aux
 * routes /auth non authentifiées (inscription, connexion, déconnexion, vérification).
 */
import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthHttpError } from './errors.js';
import { isJson, isWrite } from './http.js';
import type { HttpRequest } from './http.js';

export function assertJsonWrite(request: HttpRequest): void {
  if (isWrite(request) && !isJson(request)) {
    throw new AuthHttpError('REQUEST_INVALID', undefined, 415);
  }
}

@Injectable()
export class JsonWriteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    assertJsonWrite(context.switchToHttp().getRequest<HttpRequest>());
    return true;
  }
}
