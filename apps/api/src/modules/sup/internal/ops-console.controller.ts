/**
 * Files de revue, fiche 360°, notes internes, dossiers de support et pièces du staff (préfixe
 * `/console`, US-109 ; 16 ADM-005, ADM-029, ADM-032 ; 17 §2.3 ; écran O01 de 10b ; ADR-097).
 *
 * | Route                                   | Réponse (succès)                 | Refus propres                    |
 * | --------------------------------------- | -------------------------------- | -------------------------------- |
 * | GET /console/queues?queue=&limit=       | 200 résumé et éléments, retard   | —                                |
 * |                                         | signalé par la base              |                                  |
 * | POST /console/queues/items/:id/claim    | 200 élément pris                 | 409 STAFF_ITEM_TAKEN             |
 * | POST /console/queues/items/:id/kyc      | 200 dossier KYC (journalisé)     | 403 STAFF_CASE_REQUIRED          |
 * | POST /console/users/search              | 200 identifiant (journalisé)     | 404 STAFF_USER_NOT_FOUND         |
 * | POST /console/users/:id/profile         | 200 fiche 360° (journalisée)     | 403 STAFF_CASE_REQUIRED          |
 * | POST /console/users/:id/notes           | 201 note ; 200 rejeu             | 403 STAFF_CASE_REQUIRED          |
 * | POST /console/cases                     | 201 dossier ; 200 rejeu          | —                                |
 * | POST /console/cases/:id/status          | 200 état changé                  | 403 STAFF_CASE_REQUIRED          |
 * | POST /console/evidence                  | 201 pièce ; 200 rejeu            | 422 EVIDENCE_REJECTED, 503       |
 * | POST /console/queues/items/:id/         | 200 demande d'ajout et variantes | 409 CATALOG_REQUEST_CLOSED       |
 * |      catalog-addition (US-114)          | candidates                       |                                  |
 * | POST /console/queues/items/:id/         | 200 décision (MERGE, APPROVE,    | 409 CATALOG_REQUEST_CLOSED,      |
 * |      catalog-addition/resolve (US-114)  | REJECT), élément clos            | CATALOG_VARIANT_EXISTS ; 422     |
 * | POST /console/queues/items/:id/vehicle  | 200 dossier du véhicule          | 409 VEHICLE_REVIEW_CLOSED        |
 * |      (US-124)                           | (journalisé)                     |                                  |
 * | POST /console/queues/items/:id/vehicle/ | 200 résultat calculé (ELIGIBLE,  | 409 ; 422                        |
 * |      decide (US-124)                    | PENDING, INELIGIBLE)             | VEHICLE_CHECKLIST_INVALID        |
 * | POST /console/queues/items/:id/         | 200 contestation (journalisée)   | 409 VEHICLE_CLAIM_CLOSED         |
 * |      vehicle-claim (US-124, N-61)       |                                  |                                  |
 * | POST /console/queues/items/:id/         | 200 UPHELD / DISMISSED           | 403 STAFF_ADMIN_REQUIRED ; 409 ; |
 * |      vehicle-claim/decide               |                                  | 422                              |
 * | POST /console/queues/items/:id/files/   | 200 pièce (base64, journalisée)  | 404 VEHICLE_FILE_NOT_FOUND ; 503 |
 * |      :fileId (US-124)                   |                                  |                                  |
 *
 * Toutes : StaffGuard (401 AUTH_REQUIRED, 403 FORBIDDEN / 2FA_REQUIRED), 400 REQUEST_INVALID. La
 * base juge chaque droit (permission EN COURS dans le pays du sujet, couverture) et journalise
 * chaque refus et chaque lecture de données personnelles AVANT de la rendre. Les lectures qui
 * rendent une donnée personnelle sont des POST : un motif (`purpose`) est exigé et journalisé.
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
import { EvidenceError, EvidenceService } from './evidence.js';
import type {
  CatalogDecision,
  CatalogRejectReason,
  CatalogResolution,
  CaseCategory,
  CaseChannel,
  CasePriority,
  CaseStatus,
  OpsConsoleStore,
  OpsResult,
  VehicleClaimDecision,
} from './ops-console-store.js';
import { OpsStoreError } from './ops-console-store.js';
import { OpsHttpError } from './ops-errors.js';
import { staffActorOf } from './staff-context.js';
import type { StaffActor } from './staff-context.js';
import type { VehicleFilesOptions } from './sup-console.module.js';
import { EVIDENCE_SERVICE, OPS_CONSOLE_STORE, VEHICLE_FILES } from './tokens.js';

/** Liste de contrôle fermée de la revue du véhicule (0077, L1-PM-14) ; valeurs jugées par la base. */
const CHECK_KEYS = new Set([
  'TITLE_HOLDER',
  'TITLE_CLEAN',
  'PLATE_MATCH',
  'VIN_MATCH',
  'LIEN',
  'INSPECTION',
  'REGISTRY',
]);
const CLAIM_DECISIONS: readonly VehicleClaimDecision[] = ['UPHOLD', 'DISMISS'];
const CLAIM_REASONS = ['INSUFFICIENT_PROOF', 'CLAIMANT_NOT_OWNER'] as const;
const FILE_SUBJECTS = ['VEHICLE', 'VEHICLE_CLAIM'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const QUEUE =
  /^(KYC|LISTING|HOST_VERIFICATION|RISK_BOOKING|OVERDUE|GRAY_MARKET|CATALOG_ADDITION|LEG_RECONCILIATION)$/;
const CATEGORIES: readonly CaseCategory[] = [
  'TRIP',
  'PAYMENT',
  'ACCOUNT',
  'LISTING',
  'CLAIM',
  'SAFETY',
  'OTHER',
];
const PRIORITIES: readonly CasePriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const CHANNELS: readonly CaseChannel[] = ['WHATSAPP', 'EMAIL', 'PHONE', 'IN_APP'];
const STATUSES: readonly CaseStatus[] = ['PENDING', 'RESOLVED', 'CLOSED'];
const DECISIONS: readonly CatalogDecision[] = ['MERGE', 'APPROVE', 'REJECT'];
const REJECT_REASONS: readonly CatalogRejectReason[] = [
  'INSUFFICIENT_DETAILS',
  'UNKNOWN_MODEL',
  'NOT_ELIGIBLE',
];
/** Clés de la saisie d'APPROVE (0074) ; valeurs jugées par la base. */
const ENTRY_KEYS = new Set([
  'makeName',
  'modelName',
  'bodyType',
  'yearFrom',
  'yearTo',
  'trimName',
  'transmission',
  'fuelType',
  'drive',
  'seats',
  'doors',
  'valueClass',
  'licenseNote',
]);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** Horodatage rendu par la base (jsonb) : normalisé en ISO 8601 UTC (`toISOString`). */
const DB_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/;

interface StatusResponse {
  status(code: number): unknown;
}

function fields(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new AuthHttpError('REQUEST_INVALID');
  }
  return body as Record<string, unknown>;
}

const length = (text: string): number => [...text.trim()].length;

function uuidOf(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new AuthHttpError('REQUEST_INVALID');
  return value;
}

function textOf(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string' || length(value) < min || length(value) > max) {
    throw new AuthHttpError('REQUEST_INVALID');
  }
  return value.trim();
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new AuthHttpError('REQUEST_INVALID');
  }
  return value as T;
}

function actorOf(request: object): StaffActor {
  const principal = staffPrincipalOf(request);
  if (principal === null) throw new AuthHttpError('AUTH_REQUIRED');
  return staffActorOf(principal);
}

/** Champs d'horodatage rendus par la base (noms de 0064, 0076) ; aucun texte libre n'en fait partie. */
const DATE_FIELD = /^(createdAt|slaDueAt|liftedAt|scheduledStart|scheduledEnd|updatedAt)$/;

/** Décision de la file d'ajout (US-114) : la forme est jugée ici, les valeurs par la base. */
function resolutionOf(b: Record<string, unknown>): CatalogResolution {
  const decision = oneOf(b['decision'], DECISIONS);
  if (decision === 'MERGE') {
    return { decision, variantId: uuidOf(b['variantId']), entry: null, rejectReason: null };
  }
  if (decision === 'REJECT') {
    return {
      decision,
      variantId: null,
      entry: null,
      rejectReason: oneOf(b['rejectReason'], REJECT_REASONS),
    };
  }
  const entry = b['entry'];
  if (
    entry === null ||
    typeof entry !== 'object' ||
    Array.isArray(entry) ||
    Object.keys(entry).some((k) => !ENTRY_KEYS.has(k))
  ) {
    throw new AuthHttpError('REQUEST_INVALID');
  }
  return { decision, variantId: null, entry: entry as Record<string, unknown>, rejectReason: null };
}

/**
 * Horodatages de la base convertis en ISO 8601 UTC, récursivement, dans les SEULS champs de date :
 * le texte d'une note, d'un motif ou d'un nom n'est jamais réécrit (revue de code US-109).
 */
export function isoDates(value: unknown, key: string | null = null): unknown {
  if (typeof value === 'string') {
    return key !== null && DATE_FIELD.test(key) && DB_TIMESTAMP.test(value)
      ? new Date(value).toISOString()
      : value;
  }
  if (Array.isArray(value)) return value.map((v) => isoDates(v, key));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, isoDates(v, k)]));
  }
  return value;
}

/** Refus d'accès communs rendus par la base (fail-closed : issue inconnue ⇒ FORBIDDEN). */
function refusalOf(outcome: string): never {
  if (outcome === 'AUTH_REQUIRED') throw new AuthHttpError('AUTH_REQUIRED');
  if (outcome === 'MFA_REQUIRED') throw new AuthHttpError('2FA_REQUIRED');
  if (outcome === 'CASE_REQUIRED') throw new OpsHttpError('STAFF_CASE_REQUIRED');
  throw new AuthHttpError('FORBIDDEN');
}

/** Appel du magasin : 22023 (donnée refusée par la commande) ⇒ 400 ; issue attendue ou refus. */
async function run(
  call: () => Promise<OpsResult>,
  expected: readonly string[],
): Promise<{ outcome: string; body: Record<string, unknown> }> {
  let r: OpsResult;
  try {
    r = await call();
  } catch (error) {
    if (error instanceof OpsStoreError && error.sqlstate === '22023') {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    throw error;
  }
  if (!expected.includes(r.outcome)) refusalOf(r.outcome);
  return { outcome: r.outcome, body: (isoDates(r.body ?? {}) as Record<string, unknown>) ?? {} };
}

@Controller('console')
export class OpsConsoleController {
  constructor(
    @Inject(OPS_CONSOLE_STORE) private readonly store: OpsConsoleStore,
    @Inject(EVIDENCE_SERVICE) private readonly evidence: EvidenceService,
    @Inject(VEHICLE_FILES) private readonly vehicleFiles: VehicleFilesOptions,
  ) {}

  @Get('queues')
  @UseGuards(StaffGuard)
  async queues(
    @Req() request: object,
    @Query('queue') queue: unknown,
    @Query('limit') limit: unknown,
  ) {
    const actor = actorOf(request);
    if (queue !== undefined && (typeof queue !== 'string' || !QUEUE.test(queue))) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    const n = typeof limit === 'string' && /^\d{1,3}$/.test(limit) ? Number(limit) : 50;
    const { body } = await run(
      () => this.store.queues(actor, queue ?? null, Math.min(Math.max(n, 1), 200)),
      ['OK'],
    );
    return { queues: body['queues'] ?? [], items: body['items'] ?? [] };
  }

  @Post('queues/items/:id/claim')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  async claim(@Req() request: object, @Param('id') id: string, @Body() raw: unknown) {
    const actor = actorOf(request);
    const itemId = uuidOf(id);
    const requestId = uuidOf(fields(raw)['requestId']);
    const r = await run(() => this.store.claim(actor, requestId, itemId), ['CLAIMED', 'TAKEN']);
    if (r.outcome === 'TAKEN') throw new OpsHttpError('STAFF_ITEM_TAKEN');
    return { itemId };
  }

  @Post('queues/items/:id/kyc')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  async kyc(@Req() request: object, @Param('id') id: string, @Body() raw: unknown) {
    const actor = actorOf(request);
    const itemId = uuidOf(id);
    const b = fields(raw);
    const requestId = uuidOf(b['requestId']);
    const purpose = textOf(b['purpose'], 10, 500);
    const { body } = await run(
      () => this.store.kycDossier(actor, requestId, itemId, purpose),
      ['GRANTED'],
    );
    return body;
  }

  @Post('queues/items/:id/catalog-addition')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  async catalogAddition(@Req() request: object, @Param('id') id: string, @Body() raw: unknown) {
    const actor = actorOf(request);
    const itemId = uuidOf(id);
    const requestId = uuidOf(fields(raw)['requestId']);
    const r = await run(
      () => this.store.catalogAddition(actor, requestId, itemId),
      ['GRANTED', 'NOT_OPEN'],
    );
    if (r.outcome === 'NOT_OPEN') throw new OpsHttpError('CATALOG_REQUEST_CLOSED');
    return r.body;
  }

  @Post('queues/items/:id/catalog-addition/resolve')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  async resolveCatalogAddition(
    @Req() request: object,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    const actor = actorOf(request);
    const itemId = uuidOf(id);
    const b = fields(raw);
    const requestId = uuidOf(b['requestId']);
    const resolution = resolutionOf(b);
    const r = await run(
      () => this.store.resolveCatalogAddition(actor, requestId, itemId, resolution),
      [
        'RESOLVED',
        'NOT_OPEN',
        'CATALOG_VARIANT_EXISTS',
        'CATALOG_VARIANT_NOT_FOUND',
        'CATALOG_ENTRY_INVALID',
      ],
    );
    if (r.outcome === 'NOT_OPEN') throw new OpsHttpError('CATALOG_REQUEST_CLOSED');
    if (r.outcome !== 'RESOLVED') {
      throw new OpsHttpError(
        r.outcome as
          'CATALOG_VARIANT_EXISTS' | 'CATALOG_VARIANT_NOT_FOUND' | 'CATALOG_ENTRY_INVALID',
      );
    }
    return {
      itemId,
      requestId: r.body['requestId'],
      status: r.body['status'],
      variantId: r.body['variantId'] ?? null,
    };
  }

  /** Dossier d'un véhicule en revue (US-124) : plaque, VIN, pièces, titulaire ; journalisé. */
  @Post('queues/items/:id/vehicle')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  async vehicle(@Req() request: object, @Param('id') id: string, @Body() raw: unknown) {
    const actor = actorOf(request);
    const itemId = uuidOf(id);
    const b = fields(raw);
    const requestId = uuidOf(b['requestId']);
    const purpose = textOf(b['purpose'], 10, 500);
    const r = await run(
      () => this.store.vehicleEligibility(actor, requestId, itemId, purpose),
      ['GRANTED', 'NOT_UNDER_REVIEW'],
    );
    if (r.outcome === 'NOT_UNDER_REVIEW') throw new OpsHttpError('VEHICLE_REVIEW_CLOSED');
    return r.body;
  }

  /**
   * Décision sur un véhicule (US-124) : liste de contrôle FERMÉE (chaque point PASS ou FAIL) et un
   * verdict par pièce soumise ; le résultat est calculé par la base, jamais choisi ici.
   */
  @Post('queues/items/:id/vehicle/decide')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  async decideVehicle(@Req() request: object, @Param('id') id: string, @Body() raw: unknown) {
    const actor = actorOf(request);
    const itemId = uuidOf(id);
    const b = fields(raw);
    const requestId = uuidOf(b['requestId']);
    const checklist = b['checklist'];
    const documents = b['documents'];
    if (
      checklist === null ||
      typeof checklist !== 'object' ||
      Array.isArray(checklist) ||
      Object.keys(checklist).some((k) => !CHECK_KEYS.has(k)) ||
      !Array.isArray(documents) ||
      documents.length > 20
    ) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    const r = await run(
      () =>
        this.store.decideVehicleEligibility(
          actor,
          requestId,
          itemId,
          checklist as Record<string, unknown>,
          documents as unknown[],
        ),
      ['DECIDED', 'NOT_UNDER_REVIEW', 'CHECKLIST_INVALID'],
    );
    if (r.outcome === 'NOT_UNDER_REVIEW') throw new OpsHttpError('VEHICLE_REVIEW_CLOSED');
    if (r.outcome === 'CHECKLIST_INVALID') throw new OpsHttpError('VEHICLE_CHECKLIST_INVALID');
    return r.body;
  }

  /** Dossier d'une contestation de plaque ou de VIN (BOARD N-61) ; journalisé. */
  @Post('queues/items/:id/vehicle-claim')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  async vehicleClaim(@Req() request: object, @Param('id') id: string, @Body() raw: unknown) {
    const actor = actorOf(request);
    const itemId = uuidOf(id);
    const b = fields(raw);
    const requestId = uuidOf(b['requestId']);
    const purpose = textOf(b['purpose'], 10, 500);
    const r = await run(
      () => this.store.vehicleClaim(actor, requestId, itemId, purpose),
      ['GRANTED', 'NOT_OPEN'],
    );
    if (r.outcome === 'NOT_OPEN') throw new OpsHttpError('VEHICLE_CLAIM_CLOSED');
    return r.body;
  }

  /** Décision sur une contestation : UPHOLD (ADMIN seul, libère le véhicule) ou DISMISS motivé. */
  @Post('queues/items/:id/vehicle-claim/decide')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  async decideVehicleClaim(@Req() request: object, @Param('id') id: string, @Body() raw: unknown) {
    const actor = actorOf(request);
    const itemId = uuidOf(id);
    const b = fields(raw);
    const requestId = uuidOf(b['requestId']);
    const decision = oneOf(b['decision'], CLAIM_DECISIONS);
    const reason =
      b['reason'] === undefined || b['reason'] === null ? null : oneOf(b['reason'], CLAIM_REASONS);
    const r = await run(
      () => this.store.decideVehicleClaim(actor, requestId, itemId, decision, reason),
      ['DECIDED', 'NOT_OPEN', 'CLAIM_REASON_INVALID', 'ADMIN_REQUIRED'],
    );
    if (r.outcome === 'NOT_OPEN') throw new OpsHttpError('VEHICLE_CLAIM_CLOSED');
    if (r.outcome === 'CLAIM_REASON_INVALID')
      throw new OpsHttpError('VEHICLE_CLAIM_REASON_INVALID');
    if (r.outcome === 'ADMIN_REQUIRED') throw new OpsHttpError('STAFF_ADMIN_REQUIRED');
    return r.body;
  }

  /**
   * Pièce couverte par l'élément (US-124) : droit et journal par la base AVANT toute lecture, puis
   * objet lu au seau privé DOCUMENTS et déchiffré par le coffre ; rendue en base64 (jamais une URL,
   * jamais servie sur l'origine de l'application). Production : stockage et coffre indisponibles,
   * donc 503 (fail-closed).
   */
  @Post('queues/items/:id/files/:fileId')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  async vehicleFile(
    @Req() request: object,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Body() raw: unknown,
  ) {
    const actor = actorOf(request);
    const itemId = uuidOf(id);
    const file = uuidOf(fileId);
    const b = fields(raw);
    const requestId = uuidOf(b['requestId']);
    const purpose = textOf(b['purpose'], 10, 500);
    const subject = oneOf(b['subject'], FILE_SUBJECTS);
    const r = await run(
      () => this.store.vehicleFile(actor, requestId, itemId, subject, file, purpose),
      ['GRANTED', 'FILE_NOT_FOUND'],
    );
    if (r.outcome === 'FILE_NOT_FOUND') throw new OpsHttpError('VEHICLE_FILE_NOT_FOUND');
    const key = r.body['storageKey'];
    const owner = r.body['subjectUserId'];
    const mime = r.body['mime'];
    if (typeof key !== 'string' || typeof owner !== 'string' || typeof mime !== 'string') {
      throw new OpsHttpError('VEHICLE_FILE_UNAVAILABLE');
    }
    const got = await this.vehicleFiles.files.get('DOCUMENTS', key);
    if (got.status !== 'FOUND') throw new OpsHttpError('VEHICLE_FILE_UNAVAILABLE');
    const opened = await this.vehicleFiles.vault.open(owner, file, got.body);
    if (opened.status !== 'OPENED') throw new OpsHttpError('VEHICLE_FILE_UNAVAILABLE');
    return {
      fileId: file,
      mime,
      bytes: opened.body.length,
      dataBase64: opened.body.toString('base64'),
    };
  }

  @Post('users/search')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  async search(@Req() request: object, @Body() raw: unknown) {
    const actor = actorOf(request);
    const b = fields(raw);
    const requestId = uuidOf(b['requestId']);
    const email = textOf(b['email'], 3, 254);
    const purpose = textOf(b['purpose'], 10, 500);
    const r = await run(
      () => this.store.findUser(actor, requestId, email, purpose),
      ['FOUND', 'NOT_FOUND'],
    );
    if (r.outcome === 'NOT_FOUND') throw new OpsHttpError('STAFF_USER_NOT_FOUND');
    return { userId: r.body['userId'], country: r.body['country'] };
  }

  @Post('users/:id/profile')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  async profile(@Req() request: object, @Param('id') id: string, @Body() raw: unknown) {
    const actor = actorOf(request);
    const userId = uuidOf(id);
    const b = fields(raw);
    const requestId = uuidOf(b['requestId']);
    const purpose = textOf(b['purpose'], 10, 500);
    const { body } = await run(
      () => this.store.profile(actor, requestId, userId, purpose),
      ['GRANTED'],
    );
    return body;
  }

  @Post('users/:id/notes')
  @UseGuards(StaffGuard)
  async note(
    @Req() request: object,
    @Param('id') id: string,
    @Body() raw: unknown,
    @Res({ passthrough: true }) response: StatusResponse,
  ) {
    const actor = actorOf(request);
    const userId = uuidOf(id);
    const b = fields(raw);
    const requestId = uuidOf(b['requestId']);
    const text = textOf(b['body'], 1, 2000);
    const r = await run(
      () => this.store.addNote(actor, requestId, userId, text),
      ['ADDED', 'DUPLICATE'],
    );
    response.status(r.outcome === 'DUPLICATE' ? 200 : 201);
    return { noteId: requestId };
  }

  @Post('cases')
  @UseGuards(StaffGuard)
  async openCase(
    @Req() request: object,
    @Body() raw: unknown,
    @Res({ passthrough: true }) response: StatusResponse,
  ) {
    const actor = actorOf(request);
    const b = fields(raw);
    const requestId = uuidOf(b['requestId']);
    const requester = uuidOf(b['requesterUserId']);
    const category = oneOf(b['category'], CATEGORIES);
    const priority = oneOf(b['priority'] ?? 'NORMAL', PRIORITIES);
    const channel = oneOf(b['channel'], CHANNELS);
    const r = await run(
      () => this.store.openCase(actor, requestId, requester, category, priority, channel),
      ['OPENED', 'DUPLICATE'],
    );
    response.status(r.outcome === 'DUPLICATE' ? 200 : 201);
    return { caseId: requestId };
  }

  @Post('cases/:id/status')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  async caseStatus(@Req() request: object, @Param('id') id: string, @Body() raw: unknown) {
    const actor = actorOf(request);
    const caseId = uuidOf(id);
    const b = fields(raw);
    const requestId = uuidOf(b['requestId']);
    const status = oneOf(b['status'], STATUSES);
    await run(() => this.store.setCaseStatus(actor, requestId, caseId, status), ['UPDATED']);
    return { caseId, status };
  }

  @Post('evidence')
  @UseGuards(StaffGuard)
  async upload(
    @Req() request: object,
    @Body() raw: unknown,
    @Res({ passthrough: true }) response: StatusResponse,
  ) {
    const actor = actorOf(request);
    const b = fields(raw);
    const requestId = uuidOf(b['requestId']);
    const subjectUserId = uuidOf(b['subjectUserId']);
    const mime = b['mime'];
    const content = b['contentBase64'];
    if (typeof mime !== 'string' || mime.length > 100 || typeof content !== 'string') {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    if (content.length === 0 || content.length % 4 !== 0 || !BASE64.test(content)) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    try {
      const receipt = await this.evidence.upload(actor, {
        requestId,
        subjectUserId,
        declaredMime: mime,
        content: Buffer.from(content, 'base64'),
      });
      response.status(receipt.duplicate ? 200 : 201);
      return { fileId: receipt.fileId, sha256: receipt.sha256 };
    } catch (error) {
      if (error instanceof EvidenceError) {
        if (error.kind === 'REJECTED') {
          throw new OpsHttpError('EVIDENCE_REJECTED', { reason: error.reason });
        }
        if (error.kind === 'UNAVAILABLE') throw new OpsHttpError('EVIDENCE_UNAVAILABLE');
        return refusalOf(error.reason);
      }
      if (error instanceof OpsStoreError && error.sqlstate === '22023') {
        throw new AuthHttpError('REQUEST_INVALID');
      }
      throw error;
    }
  }
}
