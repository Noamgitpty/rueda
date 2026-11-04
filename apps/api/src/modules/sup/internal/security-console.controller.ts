/**
 * Tableau de sécurité de la console interne (US-052, critère 4 ; 17 §6.6) : abus agrégés par
 * heure (refus de débit, plafond SMS atteint, soupçons et défis anti-robot), pour un pays ou pour
 * les limites globales (`country` absent).
 *
 * | Route                          | Réponse                                                   |
 * | ------------------------------ | --------------------------------------------------------- |
 * | GET /console/security/abuse    | 200 `{ rows }` ; `?country=XX` facultatif, `?hours=1..168` |
 *
 * `StaffGuard` exige une session élevée (TOTP) ; la base relit l'acteur depuis l'empreinte du
 * jeton, vérifie `security.read_abuse` sur le pays (ou sur tous les pays) et journalise les
 * refus : sans permission, 403 FORBIDDEN (US-043, 16 ADM-001), jamais une liste vide trompeuse.
 */
import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { AuthHttpError, StaffGuard, staffPrincipalOf } from '../../iam/index.js';
import { ABUSE_BOARD_STORE, AbuseBoardAccessError } from '../../risk/index.js';
import type { AbuseBoardStore } from '../../risk/index.js';

const COUNTRY = /^[A-Z]{2}$/;

@Controller('console/security')
export class SecurityConsoleController {
  constructor(@Inject(ABUSE_BOARD_STORE) private readonly board: AbuseBoardStore) {}

  @Get('abuse')
  @UseGuards(StaffGuard)
  async abuse(
    @Req() request: object,
    @Query('country') country: unknown,
    @Query('hours') hours: unknown,
  ) {
    const principal = staffPrincipalOf(request);
    if (principal === null) throw new AuthHttpError('AUTH_REQUIRED');
    if (country !== undefined && (typeof country !== 'string' || !COUNTRY.test(country))) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    const h = typeof hours === 'string' && /^\d{1,3}$/.test(hours) ? Number(hours) : 24;
    let rows: Awaited<ReturnType<AbuseBoardStore['read']>>;
    try {
      rows = await this.board.read(
        principal.tokenHash,
        typeof country === 'string' ? country : null,
        Math.min(Math.max(h, 1), 168),
      );
    } catch (error) {
      if (error instanceof AbuseBoardAccessError) {
        throw new AuthHttpError(
          error.outcome === 'MFA_REQUIRED'
            ? '2FA_REQUIRED'
            : error.outcome === 'AUTH_REQUIRED'
              ? 'AUTH_REQUIRED'
              : 'FORBIDDEN',
        );
      }
      throw error;
    }
    return {
      rows: rows.map((r) => ({
        kind: r.kind,
        scope: r.scope,
        country: r.country,
        bucketStart: r.bucketStart.toISOString(),
        occurrences: r.occurrences,
        distinctClients: r.distinctClients,
        signals: r.signals,
        lastAt: r.lastAt.toISOString(),
      })),
    };
  }
}
