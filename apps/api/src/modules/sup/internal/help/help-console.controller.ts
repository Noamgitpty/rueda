/**
 * Demandes d'aide vivantes et mesure M6 pour la console (US-310, ADR-182 ; 16 SUP-004 « délai de
 * première réponse calculé (M6) » ; 16 §M6 « mesuré, cible fixée après 4 semaines »).
 *
 * | Route                                     | Réponse                                             |
 * | ----------------------------------------- | --------------------------------------------------- |
 * | GET /console/help-requests?country=&limit= | 200 demandes vivantes (aucune donnée personnelle), |
 * |                                           | M6 des 28 derniers jours par pays permis            |
 *
 * StaffGuard (401 AUTH_REQUIRED, 403 FORBIDDEN / 2FA_REQUIRED), 400 REQUEST_INVALID. La base juge la
 * permission `support.case_write` par pays et journalise le refus. La prise d'une demande et sa
 * première réponse passent par `POST /console/cases/{id}/status` (garde ADR-122 inchangée).
 */
import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { AuthHttpError, StaffGuard, staffPrincipalOf } from '../../../iam/index.js';
import { isoDates } from '../ops-console.controller.js';
import { staffActorOf } from '../staff-context.js';
import { HelpStoreError } from './help-store.js';
import type { HelpStore } from './help-store.js';
import { HELP_STORE } from './tokens.js';

const COUNTRY = /^[A-Z]{2}$/;

@Controller('console')
export class HelpConsoleController {
  constructor(@Inject(HELP_STORE) private readonly store: HelpStore) {}

  @Get('help-requests')
  @UseGuards(StaffGuard)
  async helpRequests(
    @Req() request: object,
    @Query('country') country: unknown,
    @Query('limit') limit: unknown,
  ) {
    const principal = staffPrincipalOf(request);
    if (principal === null) throw new AuthHttpError('AUTH_REQUIRED');
    if (country !== undefined && (typeof country !== 'string' || !COUNTRY.test(country))) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    if (limit !== undefined && (typeof limit !== 'string' || !/^\d{1,3}$/.test(limit))) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    const n = limit === undefined ? 50 : Math.min(Math.max(Number(limit), 1), 200);
    let r;
    try {
      r = await this.store.staffRequests(staffActorOf(principal), country ?? null, n);
    } catch (error) {
      if (error instanceof HelpStoreError && error.sqlstate === '22023') {
        throw new AuthHttpError('REQUEST_INVALID');
      }
      throw error;
    }
    if (r.outcome === 'AUTH_REQUIRED') throw new AuthHttpError('AUTH_REQUIRED');
    if (r.outcome === 'MFA_REQUIRED') throw new AuthHttpError('2FA_REQUIRED');
    if (r.outcome !== 'OK' || r.body === null) throw new AuthHttpError('FORBIDDEN');
    const body = isoDates(r.body) as Record<string, unknown>;
    return {
      items: Array.isArray(body['items']) ? body['items'] : [],
      m6: Array.isArray(body['m6']) ? body['m6'] : [],
      windowDays: typeof body['windowDays'] === 'number' ? body['windowDays'] : 28,
    };
  }
}
