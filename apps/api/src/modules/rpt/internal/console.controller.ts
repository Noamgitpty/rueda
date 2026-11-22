/**
 * Vues de la bêta et rapprochement par jambe assisté pour la console (US-311, ADR-194 ; 17 §2.2
 * RPT « vues de lecture, exports CSV » ; 16 FIN-005 ; 18 §1.1).
 *
 * | Route                                                   | Réponse                                   |
 * | ------------------------------------------------------- | ----------------------------------------- |
 * | GET  /console/beta-views/{view}?country=                | 200 lignes de la vue (aucune donnée       |
 * |                                                         | personnelle) ; view : handovers-today,    |
 * |                                                         | overdue (OPS, ADMIN), exit-kpi (+FINANCE) |
 * | POST /console/reports/exports                           | 200 text/csv : vue, export de la          |
 * |                                                         | plateforme (mois, OPERATIONS ou LEGS) ou  |
 * |                                                         | éléments d'un passage ; motif, BULK_EXPORT|
 * | POST /console/reconciliation/runs                       | 201 passage enregistré (200 au rejeu)     |
 * | GET  /console/reconciliation/runs?country=              | 200 passages et état des mois             |
 * | GET  /console/reconciliation/runs/{runId}               | 200 passage et éléments                   |
 * | POST /console/reconciliation/items/{itemId}/resolution  | 200 élément résolu (une fois)             |
 * | POST /console/reconciliation/runs/{runId}/signature     | 200 passage clôturé (checklist signée)    |
 *
 * StaffGuard (401 AUTH_REQUIRED, 403 FORBIDDEN / 2FA_REQUIRED) ; la base juge la permission
 * (`report.ops_views`, `report.exit_kpi`, `finance.reconciliation`) dans le pays et journalise le
 * refus ; 400 REQUEST_INVALID (entrée), RECON_FORMAT_INVALID / RECON_STATEMENT_MISSING (relevé) ;
 * 409 RECON_* ; 503 REPORT_UNAVAILABLE (base). Aucun montant n'est calculé ici : la base apparie.
 */
import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthHttpError, StaffGuard, staffPrincipalOf } from '../../iam/index.js';
import { CSV_COLUMNS, toCsv } from './csv.js';
import { ReportHttpError } from './errors.js';
import { RECON_CHECKLIST, RECON_KINDS, RECON_RESOLUTIONS, ReportStoreError } from './store.js';
import type { BetaView, ReconKind, ReconResolution, ReportStore } from './store.js';
import { REPORT_STORE } from './tokens.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COUNTRY = /^[A-Z]{2}$/;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
/**
 * Plafond d'un relevé (lignes) : même valeur que la base (0174) et l'OpenAPI (`maxItems`) ; 400
 * lignes LEGS au pire cas tiennent dans la limite de corps propre de la route (128 Kio,
 * route-body-limits.ts). Parité figée par report-limits.test.ts.
 */
export const RECON_MAX_LINES = 400;
/**
 * Seuil d'avertissement (lignes, PROPOSÉ ; constante sans lien avec un pays) : au-delà, la réponse
 * porte `RECON_STATEMENT_NEAR_LIMIT` et le journal un avertissement ; le rapprochement automatisé
 * (US-711) doit être préparé avant que le volume n'atteigne le plafond (runbook).
 */
export const RECON_LINES_WARNING = 300;
const MAX_LINES = RECON_MAX_LINES;
const LOG = new Logger('Reconciliation');
/** Sources d'un export CSV (une route, une ligne au journal d'accès par export). */
const EXPORT_SOURCES = [
  'HANDOVERS_TODAY',
  'OVERDUE',
  'EXIT_KPI',
  'OPERATIONS',
  'LEGS',
  'RUN_ITEMS',
] as const;
type ExportSource = (typeof EXPORT_SOURCES)[number];

const VIEWS: Readonly<Record<string, BetaView>> = {
  'handovers-today': 'HANDOVERS_TODAY',
  overdue: 'OVERDUE',
  'exit-kpi': 'EXIT_KPI',
};

interface Reply {
  setHeader(name: string, value: string): void;
  status(code: number): Reply;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function reasonOf(v: unknown): string {
  if (typeof v !== 'string') throw new AuthHttpError('REQUEST_INVALID');
  const t = v.trim();
  if (t.length < 10 || t.length > 500) throw new AuthHttpError('REQUEST_INVALID');
  return t;
}
function countryOf(v: unknown): string {
  if (typeof v !== 'string' || !COUNTRY.test(v)) throw new AuthHttpError('REQUEST_INVALID');
  return v;
}
function uuidOf(v: unknown): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new AuthHttpError('REQUEST_INVALID');
  return v;
}
function monthOf(v: unknown): string {
  if (typeof v !== 'string' || !MONTH.test(v)) throw new AuthHttpError('REQUEST_INVALID');
  return `${v}-01`;
}
function kindOf(v: unknown): ReconKind {
  if (typeof v !== 'string' || !RECON_KINDS.includes(v as ReconKind)) {
    throw new AuthHttpError('REQUEST_INVALID');
  }
  return v as ReconKind;
}
function viewOf(v: string): BetaView {
  const view = Object.hasOwn(VIEWS, v) ? VIEWS[v] : undefined;
  if (view === undefined) throw new AuthHttpError('REQUEST_INVALID');
  return view;
}

/** Refus communs et issues métier ; une issue inconnue est un refus (fail-closed). */
function refusal(outcome: string): never {
  switch (outcome) {
    case 'AUTH_REQUIRED':
      throw new AuthHttpError('AUTH_REQUIRED');
    case 'MFA_REQUIRED':
      throw new AuthHttpError('2FA_REQUIRED');
    case 'CHECKLIST_INCOMPLETE':
      throw new ReportHttpError('RECON_CHECKLIST_INCOMPLETE');
    case 'CLOSED':
    case 'ALREADY_CLOSED':
      throw new ReportHttpError('RECON_RUN_CLOSED');
    case 'ALREADY_RESOLVED':
    case 'MATCHED':
      throw new ReportHttpError('RECON_ITEM_SETTLED');
    default:
      throw new AuthHttpError('FORBIDDEN');
  }
}

/** Base indisponible : 503 ; 22023 (entrée refusée par la base) : 400 de l'opération. */
function failure(error: unknown, invalid: 'REQUEST_INVALID' | 'RECON_FORMAT_INVALID'): never {
  if (error instanceof ReportStoreError) {
    if (error.sqlstate === '22023') {
      if (invalid === 'RECON_FORMAT_INVALID') throw new ReportHttpError('RECON_FORMAT_INVALID');
      throw new AuthHttpError('REQUEST_INVALID');
    }
    throw new ReportHttpError('REPORT_UNAVAILABLE');
  }
  throw error;
}

function csvReply(reply: Reply, name: string, body: string): string {
  reply.setHeader('Content-Type', 'text/csv; charset=utf-8');
  reply.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
  reply.setHeader('Cache-Control', 'no-store');
  return body;
}

const rowsOf = (body: Record<string, unknown> | null, key: string): Record<string, unknown>[] =>
  Array.isArray(body?.[key]) ? (body[key] as Record<string, unknown>[]) : [];

@Controller('console')
export class ReportConsoleController {
  constructor(@Inject(REPORT_STORE) private readonly store: ReportStore) {}

  #hash(request: object): Buffer {
    const principal = staffPrincipalOf(request);
    if (principal === null) throw new AuthHttpError('AUTH_REQUIRED');
    return principal.tokenHash;
  }

  @Get('beta-views/:view')
  @UseGuards(StaffGuard)
  async view(
    @Req() request: object,
    @Param('view') slug: string,
    @Query('country') country: unknown,
  ) {
    const hash = this.#hash(request);
    const view = viewOf(slug);
    const cc = countryOf(country);
    let r;
    try {
      r = await this.store.betaView(hash, randomUUID(), view, cc, null);
    } catch (error) {
      failure(error, 'REQUEST_INVALID');
    }
    if (r.outcome !== 'OK') refusal(r.outcome);
    return { view, country: cc, at: r.body?.['at'] ?? null, rows: rowsOf(r.body, 'rows') };
  }

  @Post('reports/exports')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  async export(
    @Req() request: object,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: Reply,
  ) {
    const hash = this.#hash(request);
    if (!isObject(body)) throw new AuthHttpError('REQUEST_INVALID');
    const source = body['source'];
    if (typeof source !== 'string' || !EXPORT_SOURCES.includes(source as ExportSource)) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    const reason = reasonOf(body['reason']);
    const requestId = randomUUID();
    let r;
    let name: string;
    try {
      if (source === 'RUN_ITEMS') {
        const runId = uuidOf(body['runId']);
        r = await this.store.run(hash, requestId, runId, reason);
        name = `reconciliation-${runId}`;
      } else if (source === 'OPERATIONS' || source === 'LEGS') {
        const cc = countryOf(body['country']);
        const month = monthOf(body['month']);
        r = await this.store.platformExport(hash, requestId, cc, month, source, reason);
        name = `platform-${source.toLowerCase()}-${cc}-${month.slice(0, 7)}`;
      } else {
        const cc = countryOf(body['country']);
        r = await this.store.betaView(hash, requestId, source as BetaView, cc, reason);
        name = `${source.toLowerCase().replaceAll('_', '-')}-${cc}`;
      }
    } catch (error) {
      failure(error, 'REQUEST_INVALID');
    }
    if (r.outcome !== 'OK') refusal(r.outcome);
    const rows = rowsOf(r.body, source === 'RUN_ITEMS' ? 'items' : 'rows');
    return csvReply(reply, name, toCsv(CSV_COLUMNS[source as ExportSource], rows));
  }

  @Post('reconciliation/runs')
  @UseGuards(StaffGuard)
  async record(
    @Req() request: object,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: Reply,
  ) {
    const hash = this.#hash(request);
    if (!isObject(body)) throw new AuthHttpError('REQUEST_INVALID');
    const requestId = uuidOf(body['requestId']);
    const cc = countryOf(body['country']);
    const month = monthOf(body['month']);
    const kind = kindOf(body['kind']);
    const reason = reasonOf(body['reason']);
    const lines = body['lines'];
    if (!Array.isArray(lines) || lines.length > MAX_LINES) {
      throw new ReportHttpError('RECON_FORMAT_INVALID');
    }
    if (lines.length === 0) throw new ReportHttpError('RECON_STATEMENT_MISSING');
    let r;
    try {
      r = await this.store.record(hash, requestId, cc, month, kind, lines, reason);
    } catch (error) {
      failure(error, 'RECON_FORMAT_INVALID');
    }
    if (r.outcome !== 'RECORDED' && r.outcome !== 'ALREADY_RECORDED') refusal(r.outcome);
    reply.status(r.outcome === 'RECORDED' ? 201 : 200);
    if (lines.length > RECON_LINES_WARNING) {
      // aucune donnée personnelle : pays, nature, mois et nombre de lignes
      LOG.warn(
        `relevé ${kind} ${cc} ${month.slice(0, 7)} : ${lines.length} lignes (avertissement au-delà de ${RECON_LINES_WARNING}, plafond ${RECON_MAX_LINES})`,
      );
      return {
        runId: r.runId,
        warnings: [
          {
            code: 'RECON_STATEMENT_NEAR_LIMIT',
            messageKey: 'common.reconciliation.statementNearLimit',
            values: { lines: lines.length, max: RECON_MAX_LINES },
          },
        ],
      };
    }
    return { runId: r.runId };
  }

  @Get('reconciliation/runs')
  @UseGuards(StaffGuard)
  async runs(@Req() request: object, @Query('country') country: unknown) {
    const hash = this.#hash(request);
    const cc = countryOf(country);
    let r;
    try {
      r = await this.store.runs(hash, cc);
    } catch (error) {
      failure(error, 'REQUEST_INVALID');
    }
    if (r.outcome !== 'OK' || r.body === null) refusal(r.outcome);
    return r.body;
  }

  @Get('reconciliation/runs/:runId')
  @UseGuards(StaffGuard)
  async run(@Req() request: object, @Param('runId') runId: string) {
    const hash = this.#hash(request);
    const id = uuidOf(runId);
    let r;
    try {
      r = await this.store.run(hash, randomUUID(), id, null);
    } catch (error) {
      failure(error, 'REQUEST_INVALID');
    }
    if (r.outcome !== 'OK' || r.body === null) refusal(r.outcome);
    return r.body;
  }

  @Post('reconciliation/items/:itemId/resolution')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  async resolve(@Req() request: object, @Param('itemId') itemId: string, @Body() body: unknown) {
    const hash = this.#hash(request);
    const id = uuidOf(itemId);
    if (!isObject(body)) throw new AuthHttpError('REQUEST_INVALID');
    const requestId = uuidOf(body['requestId']);
    const resolution = body['resolution'];
    if (
      typeof resolution !== 'string' ||
      !RECON_RESOLUTIONS.includes(resolution as ReconResolution)
    ) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    const note = reasonOf(body['note']);
    let r;
    try {
      r = await this.store.resolve(hash, requestId, id, resolution as ReconResolution, note);
    } catch (error) {
      failure(error, 'REQUEST_INVALID');
    }
    if (r.outcome !== 'RESOLVED') refusal(r.outcome);
    return { itemId: id, resolution };
  }

  @Post('reconciliation/runs/:runId/signature')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  async sign(@Req() request: object, @Param('runId') runId: string, @Body() body: unknown) {
    const hash = this.#hash(request);
    const id = uuidOf(runId);
    if (!isObject(body)) throw new AuthHttpError('REQUEST_INVALID');
    const requestId = uuidOf(body['requestId']);
    const raw = body['checklist'];
    if (!isObject(raw)) throw new AuthHttpError('REQUEST_INVALID');
    const checklist: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!(RECON_CHECKLIST as readonly string[]).includes(key) || typeof value !== 'boolean') {
        throw new AuthHttpError('REQUEST_INVALID');
      }
      checklist[key] = value;
    }
    let r;
    try {
      r = await this.store.sign(hash, requestId, id, checklist);
    } catch (error) {
      failure(error, 'REQUEST_INVALID');
    }
    if (r.outcome !== 'CLOSED') refusal(r.outcome);
    return { runId: id, status: 'CLOSED', unexplainedAtClose: r.unexplained };
  }
}
