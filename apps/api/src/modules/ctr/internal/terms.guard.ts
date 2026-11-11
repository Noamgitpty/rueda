/**
 * Garde Nest « CGU à jour » (US-102 ; 16 ACC-001 : « Given une version majeure des CGU publiée,
 * When le guest se reconnecte, Then TERMS_REACCEPT_REQUIRED avant toute réservation »).
 *
 * À poser APRÈS `SessionGuard` sur toute route qui réserve (holds, paiement : US-2xx) :
 * `@UseGuards(SessionGuard, TermsGuard)`. Exporté par `index.ts` ; `CtrLegalModule` est global.
 * Fail-closed : session invalide ⇒ 401 ; état illisible (erreur de la base) ⇒ 500, jamais un
 * passage ; une version majeure non acceptée ⇒ 409 `TERMS_REACCEPT_REQUIRED`.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { sessionProofOf } from '../../iam/index.js';
import { LegalHttpError } from './errors.js';
import { LegalService } from './legal.service.js';

@Injectable()
export class TermsGuard implements CanActivate {
  constructor(@Inject(LegalService) private readonly legal: LegalService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Readonly<Record<string, string | string[] | undefined>> }>();
    const overview = await this.legal.overview(sessionProofOf(request));
    if (overview.code !== 'TERMS_CURRENT') throw new LegalHttpError('TERMS_REACCEPT_REQUIRED');
    return true;
  }
}
