/**
 * Déclarations de dommage et décisions motivées dans la console (US-309, ADR-195 ; 16 CLM-001 /
 * CLM-002, CLM-006, ADM-008, LEG-024 ; écran A09 de la console).
 *
 * | Route                                   | Réponse (succès)                      | Refus propres                     |
 * | --------------------------------------- | ------------------------------------- | --------------------------------- |
 * | POST /console/claims                    | 201 déclaration (RECORD_CLAIM) ;      | 422 CLAIM_DEADLINE_PASSED ; 409   |
 * |                                         | 200 rejeu de la même requête          | CLAIM_TRIP_NOT_ELIGIBLE,          |
 * |                                         |                                       | CLAIM_ALREADY_OPEN ; 503          |
 * | GET /console/claims/:claimId            | 200 vue (délai, preuves, plafond,     | 403 FORBIDDEN (déclaration        |
 * |                                         | décision, exécution)                  | inconnue : aucune existence)      |
 * | POST /console/claims/:claimId/decision  | 200 aperçu du gabarit (`preview`) ;   | 422 CLAIM_DECISION_WITHOUT_       |
 * |                                         | 201 décision (ISSUE_DECISION) ; 200   | EVIDENCE, DECISION_RATIONALE_     |
 * |                                         | rejeu                                 | REQUIRED, LEG_SUM_MISMATCH… ;     |
 * |                                         |                                       | 403 DECISION_ADMIN_REQUIRED ; 409 |
 *
 * Toutes : StaffGuard (401 AUTH_REQUIRED, 403 FORBIDDEN / 2FA_REQUIRED), 400 REQUEST_INVALID,
 * 403 STAFF_CASE_REQUIRED et STAFF_SELF_FORBIDDEN. La base juge chaque droit (session élevée,
 * permission dans le pays, dossier de support assigné, séparation des tâches ADR-122), relit les
 * preuves et les plafonds, et journalise chaque déclaration, décision et refus. Les montants sont
 * des textes d'entiers en unités mineures (jamais des nombres JSON) ; aucun hôte, voyageur ni
 * co-hôte n'a de route ici. Sans magasin : 503 CLAIMS_UNAVAILABLE (fail-closed).
 */
import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  CLAIM_KINDS,
  ClaimHttpError,
  ClaimStoreError,
  DECISION_LINE_CATEGORIES,
  DECISION_OUTCOMES,
  DECLARED_BY,
  isClaimCode,
} from '../../clm/index.js';
import type {
  ClaimDeclaredBy,
  ClaimKind,
  ClaimResult,
  ClaimStaff,
  ClaimStore,
  DecisionInput,
  DecisionLine,
  DecisionLineCategory,
  DecisionOutcome,
} from '../../clm/index.js';
import { AuthHttpError, StaffGuard, staffPrincipalOf } from '../../iam/index.js';
import { OpsHttpError } from './ops-errors.js';
import { staffActorOf } from './staff-context.js';
import { CLAIM_STORE } from './tokens.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Texte d'un entier ≥ 0, unités mineures (15 chiffres au plus, comme la base). */
const MINOR = /^(0|[1-9][0-9]{0,14})$/;
const MAX_LINES = 20;

interface Reply {
  status(code: number): Reply;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const textOf = (v: unknown, min: number, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length >= min && t.length <= max ? t : null;
};

const minorOf = (v: unknown): string | null => (typeof v === 'string' && MINOR.test(v) ? v : null);

/** Refus communs : session, TOTP, permission, dossier, séparation des tâches ; codes métier. */
function refusal(r: ClaimResult): never {
  switch (r.outcome) {
    case 'AUTH_REQUIRED':
      throw new AuthHttpError('AUTH_REQUIRED');
    case 'MFA_REQUIRED':
      throw new AuthHttpError('2FA_REQUIRED');
    case 'CASE_REQUIRED':
      throw new OpsHttpError('STAFF_CASE_REQUIRED');
    case 'SELF_FORBIDDEN':
      throw new OpsHttpError('STAFF_SELF_FORBIDDEN');
    case 'REQUEST_INVALID':
      throw new AuthHttpError('REQUEST_INVALID');
    // la porte rend FORBIDDEN pour une déclaration inconnue (aucune existence révélée) ;
    // CLAIM_NOT_FOUND n'arrive que d'une déclaration disparue entre la porte et la décision
    default:
      // code métier de la base (délai, preuves, motif, jambes, plafonds) : message seulement ;
      // l'aperçu du gabarit (`preview`) montre les montants avant l'enregistrement
      if (isClaimCode(r.outcome)) throw new ClaimHttpError(r.outcome);
      throw new AuthHttpError('FORBIDDEN');
  }
}

/** Panne de la base : 503 (22023 : entrée refusée par la base, 400). */
function unavailable(error: unknown): never {
  if (error instanceof ClaimStoreError && error.sqlstate === '22023') {
    throw new AuthHttpError('REQUEST_INVALID');
  }
  if (error instanceof ClaimStoreError) throw new ClaimHttpError('CLAIMS_UNAVAILABLE');
  throw error;
}

function decisionOf(body: Record<string, unknown>): DecisionInput | null {
  const { outcome, covered, lines, guestAgreementFileId } = body;
  const repairCostMinor = minorOf(body['repairCostMinor']);
  const amountMinor = minorOf(body['amountMinor']);
  const hostDeductibleMinor = minorOf(body['hostDeductibleMinor']);
  if (
    typeof outcome !== 'string' ||
    !DECISION_OUTCOMES.includes(outcome as DecisionOutcome) ||
    typeof covered !== 'boolean' ||
    repairCostMinor === null ||
    amountMinor === null ||
    hostDeductibleMinor === null ||
    !Array.isArray(lines) ||
    lines.length > MAX_LINES
  ) {
    return null;
  }
  const parsed: DecisionLine[] = [];
  for (const l of lines) {
    if (!isObject(l) || Object.keys(l).some((k) => k !== 'category' && k !== 'amountMinor')) {
      return null;
    }
    const amount = minorOf(l['amountMinor']);
    const category = l['category'];
    if (
      amount === null ||
      typeof category !== 'string' ||
      !DECISION_LINE_CATEGORIES.includes(category as DecisionLineCategory)
    ) {
      return null;
    }
    parsed.push({ category: category as DecisionLineCategory, amountMinor: amount });
  }
  // faits : la base juge le motif (absent ou trop court ⇒ DECISION_RATIONALE_REQUIRED)
  const facts = body['facts'];
  if (facts !== undefined && (typeof facts !== 'string' || facts.length > 2000)) return null;
  if (
    guestAgreementFileId !== undefined &&
    guestAgreementFileId !== null &&
    (typeof guestAgreementFileId !== 'string' || !UUID.test(guestAgreementFileId))
  ) {
    return null;
  }
  return {
    outcome: outcome as DecisionOutcome,
    covered,
    repairCostMinor,
    amountMinor,
    lines: parsed,
    hostDeductibleMinor,
    ...(typeof facts === 'string' ? { facts } : {}),
    ...(typeof guestAgreementFileId === 'string' ? { guestAgreementFileId } : {}),
  };
}

@Controller('console')
export class ClaimsController {
  constructor(@Inject(CLAIM_STORE) private readonly claims: ClaimStore) {}

  #staff(request: object): ClaimStaff {
    const principal = staffPrincipalOf(request);
    if (principal === null) throw new AuthHttpError('AUTH_REQUIRED');
    return staffActorOf(principal);
  }

  async #run(
    staff: ClaimStaff,
    call: (tx: Parameters<Parameters<ClaimStore['transaction']>[1]>[0]) => Promise<ClaimResult>,
  ): Promise<ClaimResult> {
    try {
      // les refus et les décisions sont journalisés dans la transaction : toujours validée
      return await this.claims.transaction(staff, async (tx) => ({
        commit: true,
        value: await call(tx),
      }));
    } catch (error) {
      unavailable(error);
    }
  }

  @Post('claims')
  @UseGuards(StaffGuard)
  async record(
    @Req() request: object,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: Reply,
  ) {
    const staff = this.#staff(request);
    if (!isObject(body)) throw new AuthHttpError('REQUEST_INVALID');
    const { requestId, tripId, caseId, declaredBy, kind } = body;
    const description = textOf(body['description'], 10, 1000);
    if (
      typeof requestId !== 'string' ||
      !UUID.test(requestId) ||
      typeof tripId !== 'string' ||
      !UUID.test(tripId) ||
      typeof caseId !== 'string' ||
      !UUID.test(caseId) ||
      typeof declaredBy !== 'string' ||
      !DECLARED_BY.includes(declaredBy as ClaimDeclaredBy) ||
      typeof kind !== 'string' ||
      !CLAIM_KINDS.includes(kind as ClaimKind) ||
      description === null
    ) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    const r = await this.#run(staff, (tx) =>
      this.claims.record(tx, staff, {
        requestId,
        tripId,
        caseId,
        declaredBy: declaredBy as ClaimDeclaredBy,
        kind: kind as ClaimKind,
        description,
      }),
    );
    if (r.outcome !== 'RECORDED' && r.outcome !== 'ALREADY_RECORDED') refusal(r);
    reply.status(r.outcome === 'RECORDED' ? 201 : 200);
    return { claim: r.body };
  }

  @Get('claims/:claimId')
  @UseGuards(StaffGuard)
  async view(@Req() request: object, @Param('claimId') claimId: string) {
    const staff = this.#staff(request);
    if (!UUID.test(claimId)) throw new AuthHttpError('REQUEST_INVALID');
    const r = await this.#run(staff, (tx) => this.claims.view(tx, staff, randomUUID(), claimId));
    if (r.outcome !== 'OK' || r.body === null) refusal(r);
    return { claim: r.body };
  }

  @Post('claims/:claimId/decision')
  @UseGuards(StaffGuard)
  async decide(
    @Req() request: object,
    @Param('claimId') claimId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: Reply,
  ) {
    const staff = this.#staff(request);
    if (!UUID.test(claimId) || !isObject(body)) throw new AuthHttpError('REQUEST_INVALID');
    const { requestId, preview } = body;
    const input = decisionOf(body);
    if (
      typeof requestId !== 'string' ||
      !UUID.test(requestId) ||
      (preview !== undefined && typeof preview !== 'boolean') ||
      input === null
    ) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    const r = await this.#run(staff, (tx) =>
      this.claims.decide(tx, staff, requestId, claimId, input, preview === true),
    );
    if (r.outcome === 'PREVIEW') {
      reply.status(200);
      return { preview: r.body };
    }
    if (r.outcome !== 'DECIDED' && r.outcome !== 'ALREADY_DECIDED') refusal(r);
    reply.status(r.outcome === 'DECIDED' ? 201 : 200);
    return { claim: r.body };
  }
}
