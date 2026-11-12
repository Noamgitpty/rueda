/**
 * Contrôle bloquant « téléphone vérifié » (US-104, critère 2 ; 16 VER-013 « Given un numéro non
 * vérifié, When le guest paie, Then BKG-012 bloque »). À poser APRÈS `SessionGuard` sur les routes
 * de paiement : `@UseGuards(SessionGuard, PhoneVerifiedGuard)` (US-209, qui construit le
 * paiement). Numéro non vérifié ⇒ 403 `PHONE_NOT_VERIFIED` ; état illisible ⇒ 503
 * `OTP_UNAVAILABLE` (fail-closed : jamais un paiement sur un doute). Exporté par `index.ts`.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthHttpError } from '../errors.js';
import type { HttpRequest } from '../http.js';
import { sessionProofOf } from '../session-proof.js';
import { IAM_PHONE_VERIFICATION } from '../tokens.js';
import type { PhoneVerificationService } from './phone-verification.service.js';

@Injectable()
export class PhoneVerifiedGuard implements CanActivate {
  constructor(@Inject(IAM_PHONE_VERIFICATION) private readonly phone: PhoneVerificationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    if (!(await this.phone.isVerified(sessionProofOf(request)))) {
      throw new AuthHttpError('PHONE_NOT_VERIFIED');
    }
    return true;
  }
}
