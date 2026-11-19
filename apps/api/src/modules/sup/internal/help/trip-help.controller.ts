/**
 * Aide d'un trip et demande d'aide (US-310, ADR-182 ; 16 SUP-004 ; tableau des routes et principes
 * dans `help.controller.ts`). Routes de réservation (segment `trips`) : `SessionGuard` puis
 * `TermsGuard` (CGU à jour, US-102), comme toutes les routes d'un trip ; les numéros d'urgence
 * restent servis sans session par `GET /help` (S17). Trip d'une autre personne, inconnu ou
 * identifiant mal formé : même 404 `TRIP_NOT_FOUND`.
 */
import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { CountryConfigService } from '../../../cfg/index.js';
import { TermsGuard } from '../../../ctr/index.js';
import { SessionGuard } from '../../../iam/index.js';
import { guarded, HelpHttpError, helpViewOf, proofOf, UUID } from './help.controller.js';
import type { HttpRequestLike, StatusResponse } from './help.controller.js';
import { HELP_TOPICS } from './help-store.js';
import type { HelpStore, HelpTopic } from './help-store.js';
import { HELP_STORE } from './tokens.js';

@Controller('trips')
export class TripHelpController {
  constructor(
    @Inject(CountryConfigService) private readonly cfg: CountryConfigService,
    @Inject(HELP_STORE) private readonly store: HelpStore,
  ) {}

  /** Aide d'un trip : rôle de la session (voyageur ou hôte) et aide du pays du trip. */
  @Get(':tripId/help')
  @UseGuards(SessionGuard, TermsGuard)
  async tripHelp(@Req() request: HttpRequestLike, @Param('tripId') tripId: string) {
    const proof = proofOf(request);
    if (!UUID.test(tripId)) throw new HelpHttpError('TRIP_NOT_FOUND');
    const id = tripId.toLowerCase();
    const r = await guarded(() => this.store.context(proof, id));
    if (r.outcome === 'AUTH_REQUIRED') throw new HelpHttpError('AUTH_REQUIRED');
    if (r.outcome !== 'DONE') throw new HelpHttpError('TRIP_NOT_FOUND');
    const view = r.country === null ? null : helpViewOf(this.cfg, r.country);
    if (r.role === null || view === null) throw new HelpHttpError('HELP_UNAVAILABLE');
    return { tripId: id, role: r.role, help: view };
  }

  /** Demande d'aide du trip : motif fermé, aucun texte libre (minimisation, ADR-182). */
  @Post(':tripId/help-requests')
  @UseGuards(SessionGuard, TermsGuard)
  async request(
    @Req() request: HttpRequestLike,
    @Param('tripId') tripId: string,
    @Body() raw: unknown,
    @Res({ passthrough: true }) response: StatusResponse,
  ) {
    const proof = proofOf(request);
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new HelpHttpError('REQUEST_INVALID');
    }
    const b = raw as Record<string, unknown>;
    if (Object.keys(b).some((k) => k !== 'requestId' && k !== 'topic')) {
      throw new HelpHttpError('REQUEST_INVALID');
    }
    // identifiant de la demande posé par le client (idempotence du rejeu), obligatoire
    const requestId = b['requestId'];
    const topic = b['topic'];
    if (
      typeof requestId !== 'string' ||
      !UUID.test(requestId) ||
      typeof topic !== 'string' ||
      !(HELP_TOPICS as readonly string[]).includes(topic)
    ) {
      throw new HelpHttpError('REQUEST_INVALID');
    }
    if (!UUID.test(tripId)) throw new HelpHttpError('TRIP_NOT_FOUND');
    const id = tripId.toLowerCase();
    // pays du trip d'abord (la plage est celle de SON pays), puis la commande, qui rejuge tout
    const ctx = await guarded(() => this.store.context(proof, id));
    if (ctx.outcome === 'AUTH_REQUIRED') throw new HelpHttpError('AUTH_REQUIRED');
    if (ctx.outcome !== 'DONE' || ctx.country === null) throw new HelpHttpError('TRIP_NOT_FOUND');
    const entry = this.cfg.config.countries.get(ctx.country);
    if (entry === undefined) throw new HelpHttpError('HELP_UNAVAILABLE');
    const hours = entry.help.supportHours;
    const r = await guarded(() =>
      this.store.open(
        proof,
        requestId.toLowerCase(),
        id,
        topic as HelpTopic,
        hours === null ? null : { from: hours.from, to: hours.to },
      ),
    );
    if (r.outcome === 'AUTH_REQUIRED') throw new HelpHttpError('AUTH_REQUIRED');
    if (r.outcome === 'NOT_FOUND') throw new HelpHttpError('TRIP_NOT_FOUND');
    if (
      (r.outcome !== 'OPENED' && r.outcome !== 'DUPLICATE' && r.outcome !== 'EXISTS') ||
      r.caseId === null ||
      r.offHours === null
    ) {
      throw new HelpHttpError('HELP_UNAVAILABLE');
    }
    response.status(r.outcome === 'OPENED' ? 201 : 200);
    return { caseId: r.caseId, outcome: r.outcome, offHours: r.offHours };
  }
}
