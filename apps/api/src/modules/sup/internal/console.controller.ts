/**
 * Actions de console (préfixe `/console`, US-012, US-101 ; 17 §3.2.13, §10 catalogue et NN9 ;
 * 16 ADM-001 ; ADR-092).
 *
 * | Route                                       | Garde      | Réponse                                                    |
 * | ------------------------------------------- | ---------- | ---------------------------------------------------------- |
 * | POST /console/actions                       | StaffGuard | 201 STAFF_ACTION_RECORDED / _DONE / _REQUESTED ; 200 si   |
 * |                                             |            | déjà reçue (même requestId) ; 403 FORBIDDEN (journalisé) ; |
 * |                                             |            | 403 2FA_REQUIRED ; 409 STAFF_ACTION_UNAVAILABLE (commande  |
 * |                                             |            | de domaine pas encore livrée) ; 409 STAFF_ACTION_REFUSED   |
 * |                                             |            | (refus de la commande de domaine, `values.reason`) ; 400   |
 * | GET /console/finance/approvals              | StaffGuard | 200 `{ approvals }` : demandes FINANCE en attente (RLS)    |
 * | POST /console/finance/approvals/:id/approve | StaffGuard | 200 STAFF_ACTION_DONE ; 409 STAFF_SELF_APPROVAL ; 409      |
 * |                                             |            | STAFF_ACTION_REFUSED ; 403 FORBIDDEN / 2FA_REQUIRED        |
 *
 * Corps d'une action : `{ requestId (UUID, idempotence), action, subjectId, reason (10 à 1000),
 * input?, evidence? (UUID des pièces, 20 au plus) }`. `input` n'admet que des chaînes : l'agent ne
 * saisit jamais un montant (la base refuse aussi toute clé non déclarée et toute chaîne numérique).
 * Aucun identifiant d'acteur reçu : l'acteur est celui de la session élevée.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthHttpError, StaffGuard, staffPrincipalOf } from '../../iam/index.js';
import type { ApprovalOutcome, FinanceApprovalStore } from './finance-approval-store.js';
import type { ManualActionResult, ManualActionStore } from './manual-action-store.js';
import { staffActorOf } from './staff-context.js';
import type { StaffActor } from './staff-context.js';
import { FINANCE_APPROVAL_STORE, MANUAL_ACTION_STORE } from './tokens.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACTION = /^[A-Z][A-Z0-9_]{1,63}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const INPUT_KEY = /^[a-z][A-Za-z]{0,31}$/;
const INPUT_MAX_BYTES = 4096;
const INPUT_VALUE_MAX = 200;
const EVIDENCE_MAX = 20;

interface StatusResponse {
  status(code: number): unknown;
}

type SuccessKind = 'RECORDED' | 'DONE' | 'REQUESTED';

export interface ActionResult {
  readonly code: 'STAFF_ACTION_RECORDED' | 'STAFF_ACTION_DONE' | 'STAFF_ACTION_REQUESTED';
  readonly messageKey:
    'common.auth.actionRecorded' | 'common.auth.actionDone' | 'common.auth.actionRequested';
  readonly actionId: string | null;
  /** Demande FINANCE créée (STAFF_ACTION_REQUESTED) : à approuver par une seconde personne. */
  readonly approvalId?: string;
}

const SUCCESS: Readonly<Record<SuccessKind, Pick<ActionResult, 'code' | 'messageKey'>>> = {
  RECORDED: { code: 'STAFF_ACTION_RECORDED', messageKey: 'common.auth.actionRecorded' },
  DONE: { code: 'STAFF_ACTION_DONE', messageKey: 'common.auth.actionDone' },
  REQUESTED: { code: 'STAFF_ACTION_REQUESTED', messageKey: 'common.auth.actionRequested' },
};

const successKind = (value: string | null): SuccessKind =>
  value === 'DONE' || value === 'REQUESTED' ? value : 'RECORDED';

function fields(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new AuthHttpError('REQUEST_INVALID');
  }
  return body as Record<string, unknown>;
}

const length = (text: string): number => [...text.trim()].length;

/** `input` : objet de chaînes courtes à clés camelCase ; jamais un nombre (aucun montant saisi). */
function inputOf(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new AuthHttpError('REQUEST_INVALID');
  const entries = Object.entries(value as Record<string, unknown>);
  if (
    entries.length > 8 ||
    Buffer.byteLength(JSON.stringify(value), 'utf8') > INPUT_MAX_BYTES ||
    entries.some(
      ([k, v]) =>
        !INPUT_KEY.test(k) || typeof v !== 'string' || v.length === 0 || v.length > INPUT_VALUE_MAX,
    )
  ) {
    throw new AuthHttpError('REQUEST_INVALID');
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function evidenceOf(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    value.length > EVIDENCE_MAX ||
    value.some((v) => typeof v !== 'string' || !UUID.test(v)) ||
    new Set(value).size !== value.length
  ) {
    throw new AuthHttpError('REQUEST_INVALID');
  }
  return value as string[];
}

function actorOf(request: object): StaffActor {
  const principal = staffPrincipalOf(request);
  if (principal === null) throw new AuthHttpError('AUTH_REQUIRED');
  return staffActorOf(principal);
}

/** Refus d'accès rendus par la base : 2FA_REQUIRED, AUTH_REQUIRED ou FORBIDDEN (fail-closed). */
function refusalOf(outcome: string): never {
  if (outcome === 'MFA_REQUIRED') throw new AuthHttpError('2FA_REQUIRED');
  if (outcome === 'AUTH_REQUIRED') throw new AuthHttpError('AUTH_REQUIRED');
  throw new AuthHttpError('FORBIDDEN');
}

@Controller('console')
export class ConsoleController {
  constructor(
    @Inject(MANUAL_ACTION_STORE) private readonly store: ManualActionStore,
    @Inject(FINANCE_APPROVAL_STORE) private readonly finance: FinanceApprovalStore,
  ) {}

  @Post('actions')
  @UseGuards(StaffGuard)
  async act(
    @Req() request: object,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: StatusResponse,
  ): Promise<ActionResult> {
    const actor = actorOf(request);
    const b = fields(body);
    const { requestId, action, subjectId, reason } = b;
    if (
      typeof requestId !== 'string' ||
      !UUID.test(requestId) ||
      typeof action !== 'string' ||
      !ACTION.test(action) ||
      typeof subjectId !== 'string' ||
      !UUID.test(subjectId) ||
      typeof reason !== 'string' ||
      length(reason) < 10 ||
      length(reason) > 1000
    ) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    const input = inputOf(b['input']);
    const evidence = evidenceOf(b['evidence']);
    let r: ManualActionResult;
    try {
      r = await this.store.record(actor, {
        requestId,
        actionCode: action,
        subjectId,
        reason: reason.trim(),
        input,
        evidence,
      });
    } catch (error) {
      // action hors catalogue, donnée refusée (clé non déclarée, montant), pièce absente : 22023
      if ((error as { sqlstate?: string }).sqlstate === '22023') {
        throw new AuthHttpError('REQUEST_INVALID');
      }
      throw error;
    }
    switch (r.outcome) {
      case 'RECORDED':
      case 'DONE':
      case 'REQUESTED':
      case 'DUPLICATE': {
        const kind = successKind(r.outcome === 'DUPLICATE' ? r.detail : r.outcome);
        response.status(r.outcome === 'DUPLICATE' ? 200 : 201);
        return {
          ...SUCCESS[kind],
          actionId: r.actionId,
          ...(kind === 'REQUESTED' && r.domainRef !== null ? { approvalId: r.domainRef } : {}),
        };
      }
      case 'UNAVAILABLE':
        throw new AuthHttpError('STAFF_ACTION_UNAVAILABLE');
      case 'REFUSED':
        throw new AuthHttpError('STAFF_ACTION_REFUSED', {
          reason: r.detail !== null && CODE.test(r.detail) ? r.detail : 'REFUSED',
        });
      default:
        return refusalOf(r.outcome);
    }
  }

  @Get('finance/approvals')
  @UseGuards(StaffGuard)
  async approvals(@Req() request: object, @Query('limit') limit: unknown) {
    const actor = actorOf(request);
    const n = typeof limit === 'string' && /^\d{1,3}$/.test(limit) ? Number(limit) : 50;
    const rows = await this.finance.pending(actor, Math.min(Math.max(n, 1), 200));
    return {
      approvals: rows.map((r) => ({
        id: r.id,
        action: r.action,
        subjectId: r.subjectId,
        country: r.country,
        reason: r.reason,
        requestedAt: r.requestedAt.toISOString(),
      })),
    };
  }

  @Post('finance/approvals/:id/approve')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  async approve(@Req() request: object, @Param('id') id: string) {
    const actor = actorOf(request);
    if (typeof id !== 'string' || !UUID.test(id)) throw new AuthHttpError('REQUEST_INVALID');
    const outcome: ApprovalOutcome = await this.finance.approve(actor, id);
    switch (outcome) {
      case 'APPROVED':
        return { code: 'STAFF_ACTION_DONE', messageKey: 'common.auth.actionDone', approvalId: id };
      case 'SELF_APPROVAL':
        throw new AuthHttpError('STAFF_SELF_APPROVAL');
      case 'NOT_PENDING':
      case 'SUBJECT_CHANGED':
        throw new AuthHttpError('STAFF_ACTION_REFUSED', { reason: outcome });
      default:
        return refusalOf(outcome);
    }
  }
}
