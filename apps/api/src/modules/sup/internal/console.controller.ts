/**
 * Actions de console motivées (préfixe `/console`, US-012 ; 17 §3.2.13, §10 catalogue ; 16 ADM-001).
 *
 * | Route                 | Garde      | Réponse                                                         |
 * | --------------------- | ---------- | --------------------------------------------------------------- |
 * | POST /console/actions | StaffGuard | 201 STAFF_ACTION_RECORDED ; 200 si déjà reçue (même requestId) ; |
 * |                       |            | 403 FORBIDDEN (journalisé) ; 403 2FA_REQUIRED ;                  |
 * |                       |            | 409 STAFF_ACTION_UNAVAILABLE (commande de domaine pas encore là) |
 *
 * Corps : `{ requestId (UUID, idempotence), action, subjectId, reason (10 à 1000), input? }`.
 * Aucun identifiant d'acteur reçu : l'acteur est celui de la session élevée.
 */
import { Body, Controller, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthHttpError, StaffGuard, staffPrincipalOf } from '../../iam/index.js';
import type { ManualActionStore } from './manual-action-store.js';
import { MANUAL_ACTION_STORE } from './tokens.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACTION = /^[A-Z][A-Z0-9_]{1,63}$/;
const INPUT_MAX_BYTES = 4096;

interface StatusResponse {
  status(code: number): unknown;
}

export interface ActionResult {
  readonly code: 'STAFF_ACTION_RECORDED';
  readonly messageKey: 'common.auth.actionRecorded';
  readonly actionId: string | null;
}

function fields(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new AuthHttpError('REQUEST_INVALID');
  }
  return body as Record<string, unknown>;
}

const length = (text: string): number => [...text.trim()].length;

@Controller('console')
export class ConsoleController {
  constructor(@Inject(MANUAL_ACTION_STORE) private readonly store: ManualActionStore) {}

  @Post('actions')
  @UseGuards(StaffGuard)
  async act(
    @Req() request: object,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: StatusResponse,
  ): Promise<ActionResult> {
    const principal = staffPrincipalOf(request);
    if (principal === null) throw new AuthHttpError('AUTH_REQUIRED');
    const b = fields(body);
    const { requestId, action, subjectId, reason } = b;
    const input = b['input'] ?? null;
    if (
      typeof requestId !== 'string' ||
      !UUID.test(requestId) ||
      typeof action !== 'string' ||
      !ACTION.test(action) ||
      typeof subjectId !== 'string' ||
      !UUID.test(subjectId) ||
      typeof reason !== 'string' ||
      length(reason) < 10 ||
      length(reason) > 1000 ||
      (input !== null &&
        (typeof input !== 'object' ||
          Array.isArray(input) ||
          Buffer.byteLength(JSON.stringify(input), 'utf8') > INPUT_MAX_BYTES))
    ) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    let r: Awaited<ReturnType<ManualActionStore['record']>>;
    try {
      r = await this.store.record(principal.tokenHash, {
        requestId,
        actionCode: action,
        subjectId,
        reason: reason.trim(),
        input: input as Record<string, unknown> | null,
      });
    } catch (error) {
      // action hors catalogue ou données refusées par la base : 22023
      if ((error as { sqlstate?: string }).sqlstate === '22023') {
        throw new AuthHttpError('REQUEST_INVALID');
      }
      throw error;
    }
    switch (r.outcome) {
      case 'RECORDED':
      case 'DUPLICATE':
        response.status(r.outcome === 'RECORDED' ? 201 : 200);
        return {
          code: 'STAFF_ACTION_RECORDED',
          messageKey: 'common.auth.actionRecorded',
          actionId: r.actionId,
        };
      case 'UNAVAILABLE':
        throw new AuthHttpError('STAFF_ACTION_UNAVAILABLE');
      case 'MFA_REQUIRED':
        throw new AuthHttpError('2FA_REQUIRED');
      case 'AUTH_REQUIRED':
        throw new AuthHttpError('AUTH_REQUIRED');
      default:
        throw new AuthHttpError('FORBIDDEN');
    }
  }
}
