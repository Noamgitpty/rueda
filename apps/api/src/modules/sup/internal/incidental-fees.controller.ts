/**
 * Décision de l'ops sur un frais annexe contesté par le voyageur (US-706, ADR-197 ; 16 CLM-021,
 * ADM-008 ; 19 US-706 « contestation avec preuves ⇒ DISPUTED et décision de l'ops (US-309) »).
 *
 * | Route                                          | Réponse (succès)             | Refus propres              |
 * | ---------------------------------------------- | ---------------------------- | -------------------------- |
 * | GET  /console/incidental-fees/:invoiceId       | 200 vue (montant, jambes,    | 403 FORBIDDEN (frais       |
 * |                                                | pièces, contestation)        | inconnu : aucune existence)|
 * | POST /console/incidental-fees/:invoiceId/      | 201 décision ; 200 rejeu     | 422 DECISION_RATIONALE_…,  |
 * |      decision                                  |                              | FINALITY ; 403 ADMIN ; 409 |
 * | GET  /console/incidental-reviews               | 200 frais « à revoir par     | 403 FORBIDDEN (aucun pays) |
 * |                                                | l'ops » (ADR-197 n° 18)      |                            |
 *
 * | GET  /console/traffic-charges                | 200 refacturations contestées | 403 FORBIDDEN (aucun pays) |
 * |                                                | à décider (US-318 suite)     |                            |
 * | GET  /console/traffic-charges/:chargeId        | 200 vue (montant, jambes,    | 403 FORBIDDEN (inconnue :  |
 * |                                                | référence, contestation)     | aucune existence)          |
 * | POST /console/traffic-charges/:chargeId/       | 201 décision ; 200 rejeu     | 422 DECISION_RATIONALE_…,  |
 * |      decision                                  |                              | FINALITY ; 403 ADMIN ; 409 |
 *
 * Refacturations d'amendes, de péages et de fourrières (US-318 suite, migration 0181, ADR-201) :
 * même mécanique que les frais annexes (même transaction STAFF, mêmes règles et mêmes codes ;
 * `TRAFFIC_NOT_DISPUTED` au lieu d'`INCIDENTAL_NOT_DISPUTED`).
 *
 * Toutes : StaffGuard (401 AUTH_REQUIRED, 403 FORBIDDEN / 2FA_REQUIRED), 400 REQUEST_INVALID, 403
 * STAFF_SELF_FORBIDDEN. La base juge chaque droit (session élevée, `dispute.decide` dans le pays,
 * séparation des tâches ADR-122), le motif (jamais « définitif »), réserve le débit à ADMIN et
 * journalise chaque décision et chaque refus. Aucun montant n'est reçu : celui de la demande de
 * l'hôte, avec ses jambes figées, est débité par Kmino (US-703). Sans magasin : 503.
 */
import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  ClaimHttpError,
  ClaimStoreError,
  INCIDENTAL_DECISION_OUTCOMES,
  isClaimCode,
} from '../../clm/index.js';
import type {
  ClaimResult,
  ClaimStaff,
  IncidentalDecisionOutcome,
  IncidentalStaffStore,
} from '../../clm/index.js';
import { AuthHttpError, StaffGuard, staffPrincipalOf } from '../../iam/index.js';
import { OpsHttpError } from './ops-errors.js';
import { staffActorOf } from './staff-context.js';
import { INCIDENTAL_STAFF_STORE } from './tokens.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEYS: readonly string[] = ['requestId', 'outcome', 'rationale'];

interface Reply {
  status(code: number): Reply;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function refusal(r: ClaimResult): never {
  switch (r.outcome) {
    case 'AUTH_REQUIRED':
      throw new AuthHttpError('AUTH_REQUIRED');
    case 'MFA_REQUIRED':
      throw new AuthHttpError('2FA_REQUIRED');
    case 'SELF_FORBIDDEN':
      throw new OpsHttpError('STAFF_SELF_FORBIDDEN');
    case 'REQUEST_INVALID':
      throw new AuthHttpError('REQUEST_INVALID');
    default:
      // motif, finalité, ADMIN, état : message seulement ; frais inconnu : FORBIDDEN (porte)
      if (isClaimCode(r.outcome)) throw new ClaimHttpError(r.outcome);
      throw new AuthHttpError('FORBIDDEN');
  }
}

/** Corps d'une décision (`{ requestId, outcome, rationale }`) ; toute autre forme : 400. */
function decisionOf(
  id: string,
  body: unknown,
): { requestId: string; outcome: IncidentalDecisionOutcome; rationale: string } {
  if (!UUID.test(id) || !isObject(body)) throw new AuthHttpError('REQUEST_INVALID');
  const { requestId, outcome, rationale } = body;
  if (
    Object.keys(body).some((k) => !KEYS.includes(k)) ||
    typeof requestId !== 'string' ||
    !UUID.test(requestId) ||
    typeof outcome !== 'string' ||
    !INCIDENTAL_DECISION_OUTCOMES.includes(outcome as IncidentalDecisionOutcome) ||
    typeof rationale !== 'string' ||
    rationale.length > 2000
  ) {
    throw new AuthHttpError('REQUEST_INVALID');
  }
  return { requestId, outcome: outcome as IncidentalDecisionOutcome, rationale };
}

function unavailable(error: unknown): never {
  if (error instanceof ClaimStoreError && error.sqlstate === '22023') {
    throw new AuthHttpError('REQUEST_INVALID');
  }
  if (error instanceof ClaimStoreError) throw new ClaimHttpError('CLAIMS_UNAVAILABLE');
  throw error;
}

@Controller('console')
export class IncidentalFeesController {
  constructor(@Inject(INCIDENTAL_STAFF_STORE) private readonly fees: IncidentalStaffStore) {}

  #staff(request: object): ClaimStaff {
    const principal = staffPrincipalOf(request);
    if (principal === null) throw new AuthHttpError('AUTH_REQUIRED');
    return staffActorOf(principal);
  }

  async #run(
    staff: ClaimStaff,
    call: (
      tx: Parameters<Parameters<IncidentalStaffStore['transaction']>[1]>[0],
    ) => Promise<ClaimResult>,
  ): Promise<ClaimResult> {
    try {
      // décisions et refus journalisés dans la transaction : toujours validée
      return await this.fees.transaction(staff, async (tx) => ({
        commit: true,
        value: await call(tx),
      }));
    } catch (error) {
      unavailable(error);
    }
  }

  /** Frais dont le débit a été reporté 12 fois : à revoir par l'ops (reprise : suite). */
  @Get('incidental-reviews')
  @UseGuards(StaffGuard)
  async review(@Req() request: object) {
    const staff = this.#staff(request);
    const r = await this.#run(staff, (tx) => this.fees.review(tx, staff, randomUUID()));
    if (r.outcome !== 'OK' || r.body === null) refusal(r);
    return r.body;
  }

  @Get('incidental-fees/:invoiceId')
  @UseGuards(StaffGuard)
  async view(@Req() request: object, @Param('invoiceId') invoiceId: string) {
    const staff = this.#staff(request);
    if (!UUID.test(invoiceId)) throw new AuthHttpError('REQUEST_INVALID');
    const r = await this.#run(staff, (tx) => this.fees.view(tx, staff, randomUUID(), invoiceId));
    if (r.outcome !== 'OK' || r.body === null) refusal(r);
    return { incidental: r.body };
  }

  /** Refacturations contestées à décider (US-318 suite, ADR-201). */
  @Get('traffic-charges')
  @UseGuards(StaffGuard)
  async trafficReview(@Req() request: object) {
    const staff = this.#staff(request);
    const r = await this.#run(staff, (tx) => this.fees.trafficReview(tx, staff, randomUUID()));
    if (r.outcome !== 'OK' || r.body === null) refusal(r);
    return r.body;
  }

  @Get('traffic-charges/:chargeId')
  @UseGuards(StaffGuard)
  async trafficView(@Req() request: object, @Param('chargeId') chargeId: string) {
    const staff = this.#staff(request);
    if (!UUID.test(chargeId)) throw new AuthHttpError('REQUEST_INVALID');
    const r = await this.#run(staff, (tx) =>
      this.fees.trafficView(tx, staff, randomUUID(), chargeId),
    );
    if (r.outcome !== 'OK' || r.body === null) refusal(r);
    return { trafficCharge: r.body };
  }

  @Post('traffic-charges/:chargeId/decision')
  @UseGuards(StaffGuard)
  async trafficDecide(
    @Req() request: object,
    @Param('chargeId') chargeId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: Reply,
  ) {
    const staff = this.#staff(request);
    const d = decisionOf(chargeId, body);
    const r = await this.#run(staff, (tx) =>
      this.fees.trafficDecide(tx, staff, d.requestId, chargeId, d.outcome, d.rationale),
    );
    if (r.outcome !== 'DECIDED' && r.outcome !== 'ALREADY_DECIDED') refusal(r);
    reply.status(r.outcome === 'DECIDED' ? 201 : 200);
    return { trafficCharge: r.body };
  }

  @Post('incidental-fees/:invoiceId/decision')
  @UseGuards(StaffGuard)
  async decide(
    @Req() request: object,
    @Param('invoiceId') invoiceId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: Reply,
  ) {
    const staff = this.#staff(request);
    if (!UUID.test(invoiceId) || !isObject(body)) throw new AuthHttpError('REQUEST_INVALID');
    const { requestId, outcome, rationale } = body;
    if (
      Object.keys(body).some((k) => !KEYS.includes(k)) ||
      typeof requestId !== 'string' ||
      !UUID.test(requestId) ||
      typeof outcome !== 'string' ||
      !INCIDENTAL_DECISION_OUTCOMES.includes(outcome as IncidentalDecisionOutcome) ||
      typeof rationale !== 'string' ||
      rationale.length > 2000
    ) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    const r = await this.#run(staff, (tx) =>
      this.fees.decide(
        tx,
        staff,
        requestId,
        invoiceId,
        outcome as IncidentalDecisionOutcome,
        rationale,
      ),
    );
    if (r.outcome !== 'DECIDED' && r.outcome !== 'ALREADY_DECIDED') refusal(r);
    reply.status(r.outcome === 'DECIDED' ? 201 : 200);
    return { incidental: r.body };
  }
}
