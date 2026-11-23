/**
 * US-038 — contrat des routes /console (US-012 actions, US-101 cadre des actions et décisions
 * FINANCE à deux personnes, US-034 marque et contenu, US-052 tableau de sécurité, US-109 files de
 * revue, US-114 file d'ajout au catalogue) sur l'application réelle : chaque statut déclaré est exercé, chaque réponse
 * validée contre l'OpenAPI. Les magasins sont des doubles en mémoire à issues réglables (la base
 * juge en production : commandes `core.cfg_brand_*`, `core.sup_*`, `core.risk_staff_abuse_board`,
 * prouvées par test:int) ; les contrôles de l'API (jetons, contraste, polices, Markdown) sont les
 * vrais.
 */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ClaimStoreError,
  EvidenceBundleService,
  EvidenceStoreError,
} from '../../modules/clm/index.js';
import type {
  ClaimResult,
  ClaimStore,
  EvidenceBundleStore,
  IncidentalStaffStore,
} from '../../modules/clm/index.js';
import { AbuseBoardAccessError } from '../../modules/risk/index.js';
import type { BrandStore, StaffVersion } from '../../modules/cfg/index.js';
import type { StaffOptions } from '../../modules/iam/index.js';
import { OpsStoreError } from '../../modules/sup/index.js';
import type {
  EvidenceOptions,
  FinanceApprovalStore,
  ManualActionStore,
  OpsConsoleStore,
  OpsResult,
} from '../../modules/sup/index.js';
import { missingCoverage } from '../openapi-contract.js';
import {
  closeContractApps,
  contract,
  COUNTRIES,
  FIRST_COUNTRY,
  coverageOf,
  ID,
  REASON,
  startContractApp,
  textBody,
} from './support.js';
import type { ContractApp } from './support.js';

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32, 1)]);
const ALT = { es: 'Logotipo', en: 'Logo', fr: 'Logo', pt: 'Logotipo' };
const BODIES = { es: 'Hola', en: 'Hello', fr: 'Bonjour', pt: 'Olá' };
const uniqueViolation = (): Error => Object.assign(new Error('unique'), { sqlstate: '23505' });

/** Magasin de marque en mémoire : versions enregistrées, issues des commandes réglables. */
class TunableBrandStore implements BrandStore {
  readonly versions: StaffVersion[] = [];
  fail: Error | null = null;
  publishOutcome = 'PUBLISHED';
  rollbackOutcome = 'ROLLED_BACK';
  contentOutcome = 'SAVED';

  #guard(): void {
    const f = this.fail;
    if (f !== null) throw f;
  }
  registerAsset(_t: Buffer, i: { assetId: string }) {
    this.#guard();
    return Promise.resolve({
      outcome: 'CREATED',
      assetId: i.assetId,
      storageKey: `brand/${i.assetId}`,
    });
  }
  saveDraft(_t: Buffer, i: Parameters<BrandStore['saveDraft']>[1]) {
    this.#guard();
    const v: StaffVersion = {
      id: i.versionId,
      versionNo: this.versions.length + 1,
      status: 'DRAFT',
      brandName: i.brandName,
      tokens: i.tokens,
      tokensSchemaVersion: i.tokensSchemaVersion,
      logoAssetId: null,
      faviconAssetId: null,
      pwaIconAssetId: null,
      contrastCheck: null,
      copiedFromId: null,
      createdBy: ID,
      createdAt: new Date('2031-07-01T08:00:00.000Z'),
      publishedBy: null,
      publishedAt: null,
      archivedAt: null,
      tokensSha256: createHash('sha256').update(JSON.stringify(i.tokens)).digest('hex'),
    };
    this.versions.push(v);
    return Promise.resolve({ outcome: 'CREATED', versionId: v.id, versionNo: v.versionNo });
  }
  publish(_t: Buffer, _r: string, versionId: string, report: { passed: boolean }) {
    const v = this.versions.find((x) => x.id === versionId);
    const outcome =
      v === undefined
        ? 'NOT_FOUND'
        : !report.passed
          ? 'CONTRAST_INSUFFICIENT'
          : this.publishOutcome;
    return Promise.resolve({ outcome, versionId, versionNo: v?.versionNo ?? null });
  }
  rollback(_t: Buffer, _r: string, newId: string, targetId: string, report: { passed: boolean }) {
    const v = this.versions.find((x) => x.id === targetId);
    const outcome =
      v === undefined
        ? 'NOT_FOUND'
        : !report.passed
          ? 'CONTRAST_INSUFFICIENT'
          : this.rollbackOutcome;
    return Promise.resolve({ outcome, versionId: newId, versionNo: 9, copiedFromId: targetId });
  }
  staffVersions(_t: Buffer, versionId: string | null) {
    return Promise.resolve(
      versionId === null ? [...this.versions] : this.versions.filter((v) => v.id === versionId),
    );
  }
  saveContentDraft() {
    this.#guard();
    return Promise.resolve({ outcome: this.contentOutcome, versionNo: 1 });
  }
  publishContent() {
    return Promise.resolve({ outcome: this.contentOutcome, versionNo: 1 });
  }
  rollbackContent() {
    this.#guard();
    return Promise.resolve({ outcome: this.contentOutcome, versionNo: 2 });
  }
  publishedVersion() {
    return Promise.resolve(null);
  }
  publicAssets() {
    return Promise.resolve([]);
  }
  publishedBlocks() {
    return Promise.resolve([]);
  }
  allPublishedBlocks() {
    return Promise.resolve([
      {
        blockKey: 'home.hero.title',
        locale: 'es' as const,
        countryCode: null,
        versionNo: 2,
        bodyMd: 'Hola',
        assetId: null,
      },
    ]);
  }
  staffReadAccess() {
    this.#guard();
    return Promise.resolve('OK');
  }
}

const AT = '2031-07-01T08:00:00.000Z';

/** Corps rendus par la base pour chaque commande US-109 (formes de 0064). */
const OPS_BODIES: Readonly<Record<string, Record<string, unknown>>> = {
  queues: {
    queues: [{ queue: 'KYC', open: 2, overdue: 1 }],
    items: [
      {
        id: ID,
        queue: 'KYC',
        subjectType: 'USER_ACCOUNT',
        subjectId: ID,
        country: FIRST_COUNTRY,
        status: 'OPEN',
        slaDueAt: '2031-07-01T08:00:00.123456+00:00',
        overdue: true,
        assigned: false,
        assignedToMe: false,
        createdAt: AT,
      },
    ],
  },
  // US-215b : dernière demande d'annulation d'un trip et son règlement (forme de 0128)
  tripCancellation: {
    cancellationId: ID,
    tripId: ID,
    country: FIRST_COUNTRY,
    action: 'CANCEL_TRIP_GUEST',
    requestedReason: 'GUEST_CANCELLED',
    initiator: 'GUEST',
    subReason: null,
    status: 'SETTLED',
    outcomeCode: null,
    costBearer: 'GUEST',
    settlementId: ID,
    requestedAt: '2031-07-01T08:00:00.123456+00:00',
    decidedAt: '2031-07-01T08:00:10.5+00:00',
    tripStatus: 'CANCELLED_BY_GUEST',
    settlement: {
      settlementId: ID,
      currency: 'XTA',
      reason: 'GUEST_CANCELLED',
      totalPaidMinor: '25666',
      guestRefundMinor: '18744',
      hostPenaltyMinor: '0',
      hostCompensationMinor: '0',
      exponent: 2,
      legs: [{ leg: 'HOST', variationMinor: '-8625' }],
      refunds: [{ status: 'PLANNED', amountMinor: '18744' }],
    },
  },
  // US-306 : vue des retards (forme de 0173)
  overdueBoard: {
    countries: [FIRST_COUNTRY],
    readAt: '2031-07-02T10:31:00.000Z',
    truncated: false,
    trips: [
      {
        tripId: ID,
        country: FIRST_COUNTRY,
        status: 'OVERDUE',
        stage: 'T2H',
        scheduledEnd: '2031-07-02T08:00:00.000Z',
        detectedAt: '2031-07-02T08:30:00.000Z',
        lateMinutes: 151,
        nextStep: 'FORMAL_NOTICE',
        nextStepAt: '2031-07-02T14:00:00.000Z',
        paramMissing: false,
        nextTripAtRisk: false,
        escalations: [
          { stage: 'T2H', escalatedAt: '2031-07-02T10:05:00.000Z', documents: ['CONTACT_SCRIPT'] },
        ],
      },
    ],
  },
  // US-224d : remboursements SM-8 d'un trip (forme de 0130, exposant joint par le magasin)
  tripRefunds: {
    tripId: ID,
    country: FIRST_COUNTRY,
    exponent: 2,
    refunds: [
      {
        instanceId: ID,
        status: 'PLANNED',
        currency: 'XTA',
        amountMinor: '18744',
        rail: 'NATIVE_PARTIAL',
        attemptNo: 1,
        settlementVersion: 1,
        requestedLegs: { HOST: '8625', INSURER: '0', TAX_THIRD_PARTY: '0', PLATFORM: '10119' },
        orderLegs: { HOST: '0', INSURER: '0', TAX_THIRD_PARTY: '0', PLATFORM: '18744' },
        orderStatus: 'PENDING',
        blockedReason: 'PLATFORM_BALANCE_UNKNOWN',
        finAlert: 'BLOCKED:PLATFORM_BALANCE_UNKNOWN',
        advance: { status: 'PLANNED', amountMinor: '8625' },
        plannedAt: '2031-07-01T08:00:00.123Z',
        issuedAt: null,
      },
    ],
  },
  // US-209b : dossier d'une réservation signalée (forme de 0119)
  bookingReview: {
    itemId: ID,
    assessmentId: ID,
    holdId: ID,
    guestUserId: ID,
    vehicleId: ID,
    orgId: ID,
    country: FIRST_COUNTRY,
    rulesFired: [
      { code: 'ACCOUNT_UNDER_24H', version: 1, signal: 'ACCOUNT_AGE' },
      { code: 'HIGH_VALUE_CLASS', version: 1, signal: 'PREMIUM' },
    ],
    score: 50,
    flaggedAt: '2031-07-01T08:00:00.123456+00:00',
    holdStatus: 'ACTIVE',
    reviewBeforeCharge: true,
    reviewedAt: null,
    expiresAt: '2031-07-01T10:00:00.123456+00:00',
    startsAt: '2031-07-10T15:00:00+00:00',
    endsAt: '2031-07-13T15:00:00+00:00',
    timezone: 'Etc/GMT+5',
    paymentWindowMinutes: 10,
    itemStatus: 'IN_REVIEW',
    accessId: ID,
    entryDeclaration: {
      residencyStatus: 'TOURIST',
      entryDate: '2031-06-20',
      declaredAt: '2031-06-30T08:00:00.123456+00:00',
    },
  },
  // US-108 : dossier de l'hôte signalé (liste de contrôle fermée, retenue visible du staff)
  hostDossier: {
    orgId: ID,
    country: FIRST_COUNTRY,
    orgStatus: 'PENDING_ACTIVATION',
    verificationId: ID,
    status: 'IN_REVIEW',
    screeningHold: true,
    reasonCode: 'HOST_SANCTIONS_HIT',
    missing: [],
    decidedAt: null,
    decidedBy: null,
    activatedAt: null,
    reviewReasons: ['SCREENING_HOLD'],
    blockers: ['HOST_VERIFICATION_NOT_APPROVED', 'INSURER_CONTRACT_INACTIVE'],
    screening: {
      source: 'OPS_MANUAL',
      screenedAt: '2031-07-01T08:00:00.123456+00:00',
      result: 'POTENTIAL_MATCH',
      reviewerId: ID,
      manualActionId: ID,
    },
    checklist: [
      { item: 'IDENTITY', state: 'OK' },
      { item: 'AGE', state: 'OK' },
      { item: 'RESIDENCE', state: 'OK' },
      { item: 'SANCTIONS', state: 'HELD' },
      { item: 'TAX_PROFILE', state: 'OK' },
      { item: 'HOST_TERMS', state: 'OK' },
      { item: 'PAYOUT_ACCOUNT', state: 'MISSING' },
      { item: 'PSP_CAPABILITIES', state: 'BLOCKED' },
      { item: 'COUNTRY_OPEN', state: 'BLOCKED' },
      { item: 'INSURER_CONTRACT', state: 'BLOCKED' },
    ],
    itemId: ID,
    accessId: ID,
    evidenceFileIds: [ID],
  },
  kycDossier: {
    itemId: ID,
    userId: ID,
    country: FIRST_COUNTRY,
    accessId: ID,
    // US-106 : vérification courante (données minimales, scores C3), sans aucune image
    kycStatus: 'MANUAL_REVIEW',
    verification: {
      id: ID,
      status: 'MANUAL_REVIEW',
      reasonCode: 'PROVIDER_REVIEW',
      attempt: 1,
      country: FIRST_COUNTRY,
      updatedAt: '2031-07-01T08:00:00.123456+00:00',
      consentCurrent: true,
      document: {
        type: 'DRIVER_LICENSE',
        issuingCountry: FIRST_COUNTRY,
        expiresOn: '2032-01-31',
        licenseClass: 'B',
        permanent: true,
        status: 'IN_REVIEW',
      },
      liveness: { result: 'REVIEW', livenessScore: 0.42, faceMatchScore: 0.9, erased: false },
    },
    pseudonymized: false,
    legalFirstName: 'Lucía',
    legalLastName: 'Benítez',
    dateOfBirth: null,
    residenceCountry: null,
  },
  findUser: { userId: ID, country: FIRST_COUNTRY },
  catalogAddition: {
    itemId: ID,
    requestId: ID,
    status: 'OPEN',
    country: FIRST_COUNTRY,
    makeText: 'Chery',
    modelText: 'Tiggo 2',
    year: 2021,
    trimText: null,
    vinMasked: 'LVVDB11B5MD******',
    transmission: 'MANUAL',
    seats: 5,
    fuelType: 'GASOLINE',
    slaDueAt: '2031-07-02T08:00:00.123456+00:00',
    createdAt: AT,
    rejectReason: null,
    resolvedVariantId: null,
    candidates: [
      {
        variantId: ID,
        make: 'Chery',
        model: 'Tiggo 7',
        yearFrom: 2020,
        yearTo: null,
        trim: null,
        transmission: 'CVT',
        fuelType: 'GASOLINE',
        drive: 'FWD',
        seats: 5,
        modelMatch: false,
      },
    ],
  },
  resolveCatalogAddition: { itemId: ID, requestId: ID, status: 'APPROVED', variantId: ID },
  // revue du véhicule et contestations (US-124)
  vehicleEligibility: {
    itemId: ID,
    vehicleId: ID,
    country: FIRST_COUNTRY,
    plate: 'AB123',
    vin: 'LVVDB11B5MD000001',
    holder: { userId: ID, legalFirstName: 'Lucía', legalLastName: 'Benítez' },
    documents: [{ documentId: ID, type: 'TITLE', status: 'SUBMITTED', createdAt: AT }],
  },
  decideVehicleEligibility: {
    itemId: ID,
    vehicleId: ID,
    result: 'PENDING',
    reasons: ['VEHICLE_VIN_MISMATCH'],
  },
  // revue d'une annonce (US-118)
  decideListing: { itemId: ID, listingId: ID, status: 'LISTED' },
  vehicleClaim: { itemId: ID, claimId: ID, plate: 'AB123', status: 'OPEN', createdAt: AT },
  decideVehicleClaim: {
    itemId: ID,
    claimId: ID,
    status: 'UPHELD',
    // rendu par la base avec CLAIM_TARGET_BOOKED seulement
    bookings: [{ kind: 'TRIP', startsAt: AT, endsAt: AT }],
  },
  vehicleFile: {
    fileId: ID,
    storageKey: `vehicle-documents/${ID}/${ID}/${ID}`,
    mime: 'application/pdf',
    bytes: 9,
    subjectUserId: ID,
  },
  profile: {
    accessId: ID,
    country: FIRST_COUNTRY,
    coverage: 'case',
    profile: {
      id: ID,
      email: 'lucia@example.test',
      emailVerified: true,
      phone: null,
      phoneVerified: false,
      legalFirstName: 'Lucía',
      legalLastName: 'Benítez',
      displayName: null,
      preferredLocale: 'es',
      residenceCountry: null,
      status: 'ACTIVE',
      pseudonymized: false,
      createdAt: AT,
    },
    kyc: { status: 'NOT_STARTED' },
    restricted: true,
    restrictions: [
      {
        id: ID,
        kind: 'TS_HOLD',
        active: true,
        reason: REASON,
        createdAt: AT,
        liftedAt: null,
      },
    ],
    notes: [{ id: ID, authorRole: 'SUPPORT_AGENT', body: 'Note', createdAt: AT }],
    hostAccounts: [
      {
        orgId: ID,
        country: FIRST_COUNTRY,
        status: 'ACTIVE',
        displayName: 'Lucía',
        bookable: false,
      },
    ],
    trips: [],
    cases: [
      {
        id: ID,
        category: 'ACCOUNT',
        status: 'OPEN',
        priority: 'NORMAL',
        channel: 'PHONE',
        assignedToMe: true,
        createdAt: AT,
      },
    ],
    queueItems: [{ id: ID, queue: 'KYC', status: 'OPEN', slaDueAt: AT, overdue: false }],
  },
};

/** Magasin US-109 en mémoire : issue réglable par méthode, ou échec 22023. */
class TunableOpsStore implements OpsConsoleStore {
  readonly outcome: Record<string, string> = {};
  invalid = false;

  #r(method: string, fallback: string): Promise<OpsResult> {
    if (this.invalid) {
      return Promise.reject(new OpsStoreError('22023'));
    }
    const outcome = this.outcome[method] ?? fallback;
    return Promise.resolve({ outcome, body: OPS_BODIES[method] ?? {} });
  }
  queues() {
    return this.#r('queues', 'OK');
  }
  claim() {
    return this.#r('claim', 'CLAIMED');
  }
  kycDossier() {
    return this.#r('kycDossier', 'GRANTED');
  }
  hostDossier() {
    return this.#r('hostDossier', 'GRANTED');
  }
  bookingReview() {
    return this.#r('bookingReview', 'GRANTED');
  }
  tripCancellation() {
    return this.#r('tripCancellation', 'OK');
  }
  tripRefunds() {
    return this.#r('tripRefunds', 'OK');
  }
  overdueBoard() {
    return this.#r('overdueBoard', 'OK');
  }
  findUser() {
    return this.#r('findUser', 'FOUND');
  }
  profile() {
    return this.#r('profile', 'GRANTED');
  }
  addNote() {
    return this.#r('addNote', 'ADDED');
  }
  openCase() {
    return this.#r('openCase', 'OPENED');
  }
  setCaseStatus() {
    return this.#r('setCaseStatus', 'UPDATED');
  }
  evidencePermitted() {
    return this.#r('evidencePermitted', 'PERMITTED');
  }
  catalogAddition() {
    return this.#r('catalogAddition', 'GRANTED');
  }
  resolveCatalogAddition() {
    return this.#r('resolveCatalogAddition', 'RESOLVED');
  }
  vehicleEligibility() {
    return this.#r('vehicleEligibility', 'GRANTED');
  }
  decideVehicleEligibility() {
    return this.#r('decideVehicleEligibility', 'DECIDED');
  }
  decideListing() {
    return this.#r('decideListing', 'DECIDED');
  }
  vehicleClaim() {
    return this.#r('vehicleClaim', 'GRANTED');
  }
  decideVehicleClaim() {
    return this.#r('decideVehicleClaim', 'DECIDED');
  }
  vehicleFile() {
    return this.#r('vehicleFile', 'GRANTED');
  }
  recordEvidence(_tx: unknown, _actor: unknown, input: { requestId: string }) {
    const outcome = this.outcome['recordEvidence'] ?? 'RECORDED';
    return Promise.resolve({
      outcome,
      body: { fileId: input.requestId, storageKey: `staff-evidence/${input.requestId}` },
    });
  }
}

/** Accès staff : voyageur sans rôle, staff sans TOTP, staff élevé (comme le harnais). */
function staffStore(app: () => ContractApp | undefined): StaffOptions['store'] {
  const never = () => Promise.reject(new Error('non prévu'));
  return {
    begin: (hash: Buffer) => {
      const a = app();
      const hex = hash.toString('hex');
      const outcome =
        a === undefined
          ? 'AUTH_REQUIRED'
          : hex === a.hash('staff')
            ? 'ELEVATED'
            : hex === a.hash('staff_sans_mfa')
              ? 'TOTP_NOT_ENROLLED'
              : hex === a.hash('voyageur')
                ? 'NOT_STAFF'
                : 'AUTH_REQUIRED';
      return Promise.resolve({
        outcome,
        userId: outcome === 'AUTH_REQUIRED' ? null : ID,
        factorId: null,
        roles: [{ role: 'ADMIN', countries: [...COUNTRIES] }],
      });
    },
    enrollReveal: never,
    elevate: never,
    mfaAttempt: never,
    suspend: never,
    resetTotp: never,
    auditRead: never,
  };
}

describe('contrat HTTP — /console', () => {
  const apps: ContractApp[] = [];
  const brand = new TunableBrandStore();
  let filesUp = true;
  let brandScan: 'CLEAN' | 'INFECTED' | 'DOWN' = 'CLEAN';
  let action: Awaited<ReturnType<ManualActionStore['record']>>['outcome'] = 'RECORDED';
  let actionDetail: string | null = null;
  let approval: Awaited<ReturnType<FinanceApprovalStore['approve']>> = 'APPROVED';
  let boardRefusal: 'FORBIDDEN' | null = null;
  const ops = new TunableOpsStore();
  let scanVerdict: 'CLEAN' | 'INFECTED' | 'DOWN' = 'CLEAN';
  let vehicleFilesUp = true;
  const evidence: EvidenceOptions = {
    pool: {
      query: () => Promise.resolve({ rows: [] }),
      connect: () =>
        Promise.resolve({ query: () => Promise.resolve({ rows: [] }), release: () => undefined }),
    } as unknown as EvidenceOptions['pool'],
    scanner: {
      scan: () =>
        Promise.resolve(
          scanVerdict === 'DOWN'
            ? { status: 'UNAVAILABLE' as const }
            : {
                status: 'SCANNED' as const,
                report: { verdict: scanVerdict, detectedMime: 'image/png', threat: null },
              },
        ),
    },
    vault: {
      prepare: () => Promise.resolve('READY' as const),
      seal: (_tx, _user, _file, body) => Promise.resolve({ status: 'SEALED' as const, body }),
    },
    files: { put: () => Promise.resolve({ status: 'STORED' as const }) },
  };
  // Dossier de preuve (US-308) : vrai service de CLM, magasin, coffre et stockage en mémoire
  const ZIP = Buffer.from('PK\u0003\u0004 archive de test', 'latin1');
  const ZIP_SHA = createHash('sha256').update(ZIP).digest('hex');
  const MANIFEST_SHA = 'a'.repeat(64);
  const evidenceState: {
    down: boolean;
    vault: 'READY' | 'UNAVAILABLE';
    request: string;
    status: string;
    open: string;
    sha: string;
  } = { down: false, vault: 'READY', request: 'REQUESTED', status: 'OK', open: 'OK', sha: ZIP_SHA };
  const evidenceStore: EvidenceBundleStore = {
    transaction: async (_staff, fn) => {
      if (evidenceState.down) throw new EvidenceStoreError('08006');
      const tx = { query: () => Promise.resolve({ rows: [] }) };
      return (await fn(tx)).value;
    },
    request: () =>
      Promise.resolve(
        evidenceState.request === 'REQUESTED' || evidenceState.request === 'ALREADY_REQUESTED'
          ? {
              outcome: evidenceState.request,
              bundleId: ID,
              status: 'REQUESTED',
              manifestSha256: MANIFEST_SHA,
            }
          : ({ outcome: evidenceState.request } as never),
      ),
    status: () =>
      Promise.resolve(
        evidenceState.status === 'OK'
          ? {
              outcome: 'OK' as const,
              body: {
                bundleId: ID,
                tripId: ID,
                country: FIRST_COUNTRY,
                purpose: 'INSURER',
                status: 'READY',
                manifestSha256: MANIFEST_SHA,
                requestedAt: '2031-07-01T08:00:00.000Z',
                generatedAt: '2031-07-01T08:05:00.000Z',
                expiresAt: '2031-07-08T08:05:00.000Z',
                exportSha256: ZIP_SHA,
                exportBytes: ZIP.length,
                failureCode: null,
                findings: null,
                absent: [{ piece: 'CONSTANCIA', reason: 'RENDERED_ON_DEMAND' }],
                fileCount: 27,
              },
            }
          : ({ outcome: evidenceState.status } as never),
      ),
    open: () =>
      Promise.resolve(
        evidenceState.open === 'OK'
          ? {
              outcome: 'OK' as const,
              fileId: ID,
              storageKey: `evidence-bundles/${ID}/${ID}.zip`,
              sha256: evidenceState.sha,
              bytes: ZIP.length,
              manifestSha256: MANIFEST_SHA,
              tripId: ID,
            }
          : ({ outcome: evidenceState.open } as never),
      ),
  };
  const evidenceService = new EvidenceBundleService({
    store: evidenceStore,
    vault: {
      prepare: () => Promise.resolve(evidenceState.vault),
      open: (_tx, _u, _f, body) => Promise.resolve({ status: 'OPENED' as const, body }),
    },
    files: { get: () => Promise.resolve({ status: 'FOUND' as const, body: ZIP }) },
  });
  // Déclarations et décisions (US-309) : magasin piloté par le test (issue de la base par porte)
  const CLAIM_VIEW = {
    claimId: ID,
    tripId: ID,
    caseId: ID,
    country: FIRST_COUNTRY,
    currency: 'XTA',
    exponent: 2,
    declaredBy: 'HOST',
    kind: 'DAMAGE',
    description: 'Rayure constatée au retour',
    status: 'REPORTED',
    reportedAt: '2031-07-02T10:00:00.000Z',
    tripEndAt: '2031-07-01T10:00:00.000Z',
    deadlineAt: '2031-07-02T10:00:00.000Z',
    evidence: { checkinPhotos: true, checkoutPhotos: true },
    guestCapMinor: '50000',
    decision: null,
  };
  const CLAIM_PREVIEW = {
    claimId: ID,
    tripId: ID,
    currency: 'XTA',
    exponent: 2,
    outcome: 'GUEST_LIABLE',
    covered: true,
    repairCostMinor: '120000',
    amountMinor: '45350',
    legs: { HOST: '40000', INSURER: '0', TAX_THIRD_PARTY: '350', PLATFORM: '5000' },
    lines: [
      { category: 'REPAIR', leg: 'HOST', amountMinor: '40000' },
      { category: 'PROCESSING_FEE', leg: 'PLATFORM', amountMinor: '5000' },
      { category: 'PROCESSING_FEE_TAX', leg: 'TAX_THIRD_PARTY', amountMinor: '350' },
    ],
    excluded: [
      {
        category: 'RECOVERY_PARKING',
        amountMinor: '1500',
        code: 'NOT_RECHARGEABLE',
        rule: 'BR-TT-05',
      },
    ],
    hostDeductibleMinor: '25000',
    guestCapMinor: '50000',
    alreadyChargedMinor: '0',
    evidence: { checkinPhotos: true, checkoutPhotos: true, guestAgreement: false },
    adminRequired: true,
  };
  const claimState = { down: false, record: 'RECORDED', view: 'OK', decide: 'DECIDED' };
  const claimResult = (outcome: string, body: Record<string, unknown> | null): ClaimResult => ({
    outcome,
    id: ID,
    body,
  });
  const claimStore: ClaimStore = {
    transaction: async (_staff, fn) => {
      if (claimState.down) throw new ClaimStoreError('08006');
      const tx = { query: () => Promise.resolve({ rows: [] }) };
      return (await fn(tx)).value;
    },
    record: () => Promise.resolve(claimResult(claimState.record, CLAIM_VIEW)),
    view: () => Promise.resolve(claimResult(claimState.view, CLAIM_VIEW)),
    decide: (_tx, _staff, _request, _claim, _input, preview) =>
      Promise.resolve(
        preview && claimState.decide === 'DECIDED'
          ? claimResult('PREVIEW', CLAIM_PREVIEW)
          : claimResult(claimState.decide, CLAIM_VIEW),
      ),
  };
  // US-706 : frais annexe contesté vu et décidé par l'ops (double du magasin)
  const INCIDENTAL_VIEW = {
    id: ID,
    tripId: ID,
    country: 'XA',
    currency: 'XTA',
    exponent: 2,
    feeType: 'CLEANING',
    amountMinor: '4500',
    legs: { HOST: '4500', INSURER: '0', TAX_THIRD_PARTY: '0', PLATFORM: '0' },
    status: 'DISPUTED',
    description: 'Sièges arrière couverts de sable au retour',
    evidence: [{ kind: 'CHECKOUT', slotCode: 'INT_01', takenBy: 'HOST' }],
    disputeEvidence: [{ kind: 'CHECKOUT', slotCode: 'INT_02', takenBy: 'GUEST' }],
    notifiedAt: '2097-03-10T10:00:00.000Z',
    responseDueAt: '2097-03-13T10:00:00.000Z',
    disputedAt: '2097-03-13T09:58:00.000Z',
    disputeReason: 'Le véhicule a été rendu propre, voir ma photo.',
    decidedRole: null,
    decisionRationale: null,
    chargeBasis: null,
    executionCode: null,
    deferCount: 0,
    reviewRequiredAt: null,
  };
  const incidentalState = {
    down: false,
    view: 'OK',
    decide: 'DECIDED',
    review: 'OK',
    trafficView: 'OK',
    trafficDecide: 'DECIDED',
    trafficReview: 'OK',
  };
  // refacturation contestée (US-318 suite, 0181) : forme de core.claim_traffic_staff_view
  const TRAFFIC_VIEW = {
    id: ID,
    tripId: ID,
    country: 'XA',
    currency: 'XTA',
    exponent: 2,
    kind: 'FINE',
    reference: 'PV 2097-0042',
    occurredAt: '2097-03-08T10:00:00.000Z',
    amountMinor: '1230',
    adminFeeMinor: '62',
    totalMinor: '1292',
    capMinor: '100000',
    legs: { HOST: '1230', INSURER: '0', TAX_THIRD_PARTY: '0', PLATFORM: '62' },
    evidenceFileId: ID,
    declaredAt: '2097-03-10T11:00:00.000Z',
    responseDueAt: '2097-03-12T11:00:00.000Z',
    status: 'DISPUTED',
    executionStatus: 'PENDING',
    acceptedAt: null,
    disputedAt: '2097-03-11T09:00:00.000Z',
    disputeReason: 'Je ne conduisais pas sur cette route ce jour-là.',
    disputeEvidence: [],
    decision: null,
    chargeBasis: null,
    decidable: true,
  };
  const TRAFFIC_REVIEW = {
    countries: ['XA'],
    truncated: false,
    charges: [
      {
        id: ID,
        tripId: ID,
        country: 'XA',
        currency: 'XTA',
        kind: 'FINE',
        totalMinor: '1292',
        disputedAt: '2097-03-11T09:00:00.000Z',
      },
    ],
  };
  const INCIDENTAL_REVIEW = {
    countries: ['XA'],
    truncated: false,
    invoices: [
      {
        id: ID,
        tripId: ID,
        country: 'XA',
        currency: 'XTA',
        feeType: 'CLEANING',
        amountMinor: '4500',
        status: 'AWAITING_GUEST',
        executionCode: 'EXECUTION_FAILED',
        deferCount: 12,
        reviewRequiredAt: '2097-03-13T10:00:00.000Z',
      },
    ],
  };
  const incidentalStore: IncidentalStaffStore = {
    transaction: async (_staff, fn) => {
      if (incidentalState.down) throw new ClaimStoreError('08006');
      const tx = { query: () => Promise.resolve({ rows: [] }) };
      return (await fn(tx)).value;
    },
    view: () => Promise.resolve(claimResult(incidentalState.view, INCIDENTAL_VIEW)),
    decide: () => Promise.resolve(claimResult(incidentalState.decide, INCIDENTAL_VIEW)),
    review: () => Promise.resolve(claimResult(incidentalState.review, INCIDENTAL_REVIEW)),
    trafficView: () => Promise.resolve(claimResult(incidentalState.trafficView, TRAFFIC_VIEW)),
    trafficDecide: () => Promise.resolve(claimResult(incidentalState.trafficDecide, TRAFFIC_VIEW)),
    trafficReview: () =>
      Promise.resolve(claimResult(incidentalState.trafficReview, TRAFFIC_REVIEW)),
  };
  afterAll(closeContractApps);

  async function app(limits?: StaffOptions['limits']): Promise<ContractApp> {
    const ref: { self?: ContractApp } = {};
    const a = await startContractApp({
      evidence: { service: evidenceService },
      claims: { store: claimStore, incidental: incidentalStore },
      staff: { store: staffStore(() => ref.self), ...(limits !== undefined ? { limits } : {}) },
      sup: {
        store: {
          record: (_actor, input) =>
            Promise.resolve({
              outcome: action,
              actionId: input.requestId,
              domainRef: action === 'REQUESTED' || action === 'REFUSED' ? randomUUID() : null,
              detail: actionDetail,
            }),
        },
        finance: {
          pending: () =>
            Promise.resolve([
              {
                id: ID,
                action: 'ISSUE_BORDEREAU',
                subjectId: ID,
                country: FIRST_COUNTRY,
                reason: REASON,
                requestedAt: new Date('2031-07-01T08:00:00.000Z'),
              },
            ]),
          approve: () => Promise.resolve(approval),
        },
        ops,
        evidence,
        vehicleFiles: {
          files: {
            put: () => Promise.resolve({ status: 'STORED' as const }),
            get: () =>
              Promise.resolve(
                vehicleFilesUp
                  ? { status: 'FOUND' as const, body: Buffer.from('%PDF-1.7\n', 'latin1') }
                  : { status: 'UNAVAILABLE' as const },
              ),
          },
          vault: {
            prepare: () => Promise.resolve('READY' as const),
            seal: (_tx, _u, _f, body) => Promise.resolve({ status: 'SEALED' as const, body }),
            open: (_u, _f, body) => Promise.resolve({ status: 'OPENED' as const, body }),
          },
        },
      },
      brand: {
        store: brand,
        files: {
          put: () => Promise.resolve({ status: filesUp ? 'STORED' : 'UNAVAILABLE' }),
          get: () => Promise.resolve({ status: 'NOT_FOUND' }),
        },
        // US-120 : antivirus des actifs (double du port ; verdict piloté par le test)
        scanner: {
          scan: ({ declaredMime }: { declaredMime: string }) =>
            Promise.resolve(
              brandScan === 'DOWN'
                ? { status: 'UNAVAILABLE' as const }
                : {
                    status: 'SCANNED' as const,
                    report: { verdict: brandScan, detectedMime: declaredMime },
                  },
            ),
        },
      },
      risk: {
        board: {
          read: () =>
            boardRefusal === null
              ? Promise.resolve([
                  {
                    kind: 'RATE_LIMITED',
                    scope: 'api_ip',
                    country: FIRST_COUNTRY,
                    bucketStart: new Date('2031-07-01T08:00:00.000Z'),
                    occurrences: 3,
                    distinctClients: 2,
                    signals: ['NO_BROWSER_HEADERS'],
                    lastAt: new Date('2031-07-01T08:30:00.000Z'),
                  },
                ])
              : Promise.reject(new AbuseBoardAccessError(boardRefusal)),
        },
      },
    });
    ref.self = a;
    apps.push(a);
    return a;
  }

  /** 401 sans session, 403 sans rôle interne, 415 sans JSON (écritures). */
  async function refusals(a: ContractApp, method: 'GET' | 'POST', path: string): Promise<void> {
    expect((await a.api.request(method, path, { body: {} })).status, path).toBe(401);
    expect(
      (await a.api.request(method, path, { headers: a.cookie('voyageur'), body: {} })).json,
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(
      (await a.api.request(method, path, { headers: a.cookie('staff_sans_mfa'), body: {} })).json,
    ).toMatchObject({ code: '2FA_REQUIRED' });
    if (method === 'POST') {
      expect((await a.api.request(method, path, textBody(a.cookie('staff')))).status).toBe(415);
    }
  }

  it('POST /console/actions : 201, 200 (rejeu), 400, 401, 403, 409, 415', async () => {
    const a = await app();
    const headers = a.cookie('staff');
    const body = { requestId: randomUUID(), action: 'TRIP_NOTE', subjectId: ID, reason: REASON };
    expect((await a.api.request('POST', '/console/actions', { headers, body })).status).toBe(201);
    action = 'DUPLICATE';
    expect((await a.api.request('POST', '/console/actions', { headers, body })).status).toBe(200);
    action = 'UNAVAILABLE';
    expect((await a.api.request('POST', '/console/actions', { headers, body })).status).toBe(409);
    // US-101 : commande de domaine appliquée, demande FINANCE, refus du domaine
    for (const [outcome, status, code] of [
      ['DONE', 201, 'STAFF_ACTION_DONE'],
      ['REQUESTED', 201, 'STAFF_ACTION_REQUESTED'],
      ['REFUSED', 409, 'STAFF_ACTION_REFUSED'],
    ] as const) {
      action = outcome;
      actionDetail = outcome === 'REFUSED' ? 'ALREADY_PENDING' : null;
      const r = await a.api.request('POST', '/console/actions', {
        headers,
        body: { ...body, requestId: randomUUID(), evidence: [randomUUID()] },
      });
      expect(r.status, outcome).toBe(status);
      expect(r.json, outcome).toMatchObject({ code });
    }
    actionDetail = null;
    action = 'RECORDED';
    expect(
      (
        await a.api.request('POST', '/console/actions', {
          headers,
          body: { ...body, input: { amountMinor: 2500 } },
        })
      ).status,
    ).toBe(400);
    expect(
      (await a.api.request('POST', '/console/actions', { headers, body: { ...body, reason: 'x' } }))
        .status,
    ).toBe(400);
    await refusals(a, 'POST', '/console/actions');
  });

  it('demandes FINANCE : liste (200, 401, 403) ; approbation 200, 400, 401, 403, 409, 415', async () => {
    const a = await app();
    const headers = a.cookie('staff');
    const list = await a.api.request('GET', '/console/finance/approvals?limit=10', { headers });
    expect(list.status).toBe(200);
    expect(list.json).toMatchObject({ approvals: [{ id: ID, action: 'ISSUE_BORDEREAU' }] });
    await refusals(a, 'GET', '/console/finance/approvals');
    const path = `/console/finance/approvals/${ID}/approve`;
    for (const [outcome, status, code] of [
      ['APPROVED', 200, 'STAFF_ACTION_DONE'],
      ['SELF_APPROVAL', 409, 'STAFF_SELF_APPROVAL'],
      ['NOT_PENDING', 409, 'STAFF_ACTION_REFUSED'],
      ['FORBIDDEN', 403, 'FORBIDDEN'],
      // US-224b (N-119) : demandeur ou approbateur concerné par l'avance
      ['SELF_FORBIDDEN', 403, 'STAFF_SELF_FORBIDDEN'],
    ] as const) {
      approval = outcome;
      const r = await a.api.request('POST', path, { headers, body: {} });
      expect(r.status, outcome).toBe(status);
      expect(r.json, outcome).toMatchObject({ code });
    }
    approval = 'APPROVED';
    expect(
      (await a.api.request('POST', '/console/finance/approvals/x/approve', { headers, body: {} }))
        .status,
    ).toBe(400);
    await refusals(a, 'POST', path);
  });

  it('marque : actifs, brouillons, versions, publication, retour arrière', async () => {
    const a = await app();
    const headers = a.cookie('staff');
    const post = (path: string, body: unknown) => a.api.request('POST', path, { headers, body });

    // actifs : 201, 400, 409, 422, 503
    const asset = {
      requestId: randomUUID(),
      kind: 'LOGO',
      contentBase64: PNG.toString('base64'),
      alt: ALT,
      licenseNote: 'œuvre originale',
    };
    expect((await post('/console/brand/assets', asset)).status).toBe(201);
    expect((await post('/console/brand/assets', { ...asset, requestId: 'x' })).status).toBe(400);
    expect(
      (await post('/console/brand/assets', { ...asset, contentBase64: 'aGVsbG8=' })).json,
    ).toMatchObject({ code: 'BRAND_ASSET_INVALID' });
    filesUp = false;
    expect((await post('/console/brand/assets', asset)).status).toBe(503);
    filesUp = true;
    // US-120 : antivirus en panne => 503 ; fichier infecté => 422 (DEC-FONDATEUR-20)
    brandScan = 'DOWN';
    expect((await post('/console/brand/assets', asset)).json).toMatchObject({
      code: 'BRAND_ASSET_UNAVAILABLE',
      details: { reason: 'SCAN' },
    });
    brandScan = 'INFECTED';
    expect((await post('/console/brand/assets', asset)).json).toMatchObject({
      code: 'BRAND_ASSET_INVALID',
      details: { reason: 'SCAN' },
    });
    brandScan = 'CLEAN';
    brand.fail = uniqueViolation();
    expect((await post('/console/brand/assets', asset)).status).toBe(409);

    // brouillons : 201, 400, 409, 422
    expect(
      (
        await post('/console/brand/drafts', {
          requestId: randomUUID(),
          brandName: 'K',
          fromPalette: 'lienzo-tinta',
        })
      ).status,
    ).toBe(409);
    brand.fail = null;
    const tinta = await post('/console/brand/drafts', {
      requestId: randomUUID(),
      brandName: 'Kmino',
      fromPalette: 'lienzo-tinta',
    });
    expect(tinta.status).toBe(201);
    const azur = await post('/console/brand/drafts', {
      requestId: randomUUID(),
      brandName: 'Kmino',
      fromPalette: 'lienzo-azur',
    });
    expect((await post('/console/brand/drafts', { requestId: 'x', brandName: 'K' })).status).toBe(
      400,
    );
    expect(
      (
        await post('/console/brand/drafts', {
          requestId: randomUUID(),
          brandName: 'K',
          fromPalette: 'nope',
        })
      ).json,
    ).toMatchObject({ code: 'BRAND_TOKENS_INVALID' });
    const tintaId = (tinta.json as { versionId: string }).versionId;
    const azurId = (azur.json as { versionId: string }).versionId;

    // lectures : 200, 400, 404
    expect(
      (await a.api.request('GET', '/console/brand/versions?limit=5', { headers })).status,
    ).toBe(200);
    expect(
      (await a.api.request('GET', `/console/brand/versions/${tintaId}`, { headers })).status,
    ).toBe(200);
    expect(
      (await a.api.request('GET', '/console/brand/versions/pas-un-uuid', { headers })).status,
    ).toBe(400);
    expect((await a.api.request('GET', `/console/brand/versions/${ID}`, { headers })).status).toBe(
      404,
    );

    // publication : 200, 400, 404, 409, 422
    const publish = (id: string, requestId: string = randomUUID()) =>
      post(`/console/brand/versions/${id}/publish`, { requestId });
    expect((await publish(tintaId)).status).toBe(200);
    expect((await publish(tintaId, 'x')).status).toBe(400);
    expect((await publish(ID)).status).toBe(404);
    expect((await publish(azurId)).json).toMatchObject({ code: 'BRAND_CONTRAST_INSUFFICIENT' });
    brand.publishOutcome = 'NOT_DRAFT';
    expect((await publish(tintaId)).status).toBe(409);
    brand.publishOutcome = 'PUBLISHED';

    // retour arrière : 201, 400, 404, 409, 422
    const rollback = (targetVersionId: string, requestId: string = randomUUID()) =>
      post('/console/brand/rollback', { requestId, targetVersionId });
    expect((await rollback(tintaId)).status).toBe(201);
    expect((await rollback(tintaId, 'x')).status).toBe(400);
    expect((await rollback(ID)).status).toBe(404);
    expect((await rollback(azurId)).status).toBe(422);
    brand.rollbackOutcome = 'NOT_ARCHIVED';
    expect((await rollback(tintaId)).status).toBe(409);
    brand.rollbackOutcome = 'ROLLED_BACK';

    for (const path of [
      '/console/brand/assets',
      '/console/brand/drafts',
      `/console/brand/versions/${tintaId}/publish`,
      '/console/brand/rollback',
    ]) {
      await refusals(a, 'POST', path);
    }
    await refusals(a, 'GET', '/console/brand/versions');
    await refusals(a, 'GET', '/console/content/gaps');
    await refusals(a, 'GET', `/console/brand/versions/${tintaId}`);
  });

  it('contenu : brouillon, publication, retour arrière', async () => {
    const a = await app();
    const headers = a.cookie('staff');
    const post = (path: string, body: Record<string, unknown>) =>
      a.api.request('POST', path, { headers, body: { requestId: randomUUID(), ...body } });
    const key = 'home.hero.title';

    brand.contentOutcome = 'SAVED';
    expect((await post('/console/content/drafts', { key, bodies: BODIES })).status).toBe(201);
    expect(
      (await post('/console/content/drafts', { key, bodies: BODIES, requestId: 'x' })).status,
    ).toBe(400);
    expect(
      (await post('/console/content/drafts', { key, bodies: { es: 'Hola' } })).json,
    ).toMatchObject({ code: 'CONTENT_BLOCK_REQUIRED_MISSING' });
    // US-121 : clé hors du registre, texte juridique (refus de la base relayé), corps hors règles
    expect(
      (await post('/console/content/drafts', { key: 'home.nope.title', bodies: BODIES })).json,
    ).toMatchObject({ code: 'CONTENT_KEY_NOT_EDITABLE' });
    brand.contentOutcome = 'KEY_FORBIDDEN';
    expect(
      (await post('/console/content/drafts', { key: 'page.cgu.body', bodies: BODIES })).json,
    ).toMatchObject({ code: 'CONTENT_KEY_FORBIDDEN' });
    brand.contentOutcome = 'SAVED';
    expect(
      (
        await post('/console/content/drafts', {
          key,
          bodies: { ...BODIES, es: 'Hola\nmundo' },
        })
      ).json,
    ).toMatchObject({ code: 'CONTENT_MARKDOWN_FORBIDDEN' });
    const gaps = await a.api.request('GET', '/console/content/gaps', { headers });
    expect(gaps.status).toBe(200);
    expect(gaps.json).toEqual({
      gaps: [
        {
          key: 'home.hero.title',
          country: null,
          versionNo: 2,
          editable: true,
          missing: ['en', 'fr', 'pt'],
          invalid: [],
        },
      ],
    });
    brand.fail = uniqueViolation();
    expect((await post('/console/content/drafts', { key, bodies: BODIES })).status).toBe(409);
    expect((await post('/console/content/rollback', { key })).status).toBe(409);
    brand.fail = null;

    brand.contentOutcome = 'PUBLISHED';
    expect((await post('/console/content/publish', { key, versionNo: 1 })).status).toBe(200);
    expect((await post('/console/content/publish', { key, versionNo: 0 })).status).toBe(400);
    expect(
      (await post('/console/content/publish', { key: 'legal.terms', versionNo: 1 })).json,
    ).toMatchObject({ code: 'CONTENT_KEY_FORBIDDEN' });
    brand.contentOutcome = 'NOT_DRAFT';
    expect((await post('/console/content/publish', { key, versionNo: 1 })).status).toBe(409);
    brand.contentOutcome = 'NOT_FOUND';
    expect((await post('/console/content/publish', { key, versionNo: 1 })).status).toBe(404);
    expect((await post('/console/content/rollback', { key })).status).toBe(404);

    brand.contentOutcome = 'ROLLED_BACK';
    expect((await post('/console/content/rollback', { key, targetVersionNo: 1 })).status).toBe(201);
    expect((await post('/console/content/rollback', { key, targetVersionNo: 0 })).status).toBe(400);
    expect((await post('/console/content/rollback', { key: 'legal.terms' })).status).toBe(422);

    for (const path of [
      '/console/content/drafts',
      '/console/content/publish',
      '/console/content/rollback',
    ]) {
      await refusals(a, 'POST', path);
    }
  });

  it('GET /console/security/abuse : 200, 400, 401, 403 (refus de la base)', async () => {
    const a = await app();
    const headers = a.cookie('staff');
    const r = await a.api.request(
      'GET',
      `/console/security/abuse?country=${FIRST_COUNTRY}&hours=48`,
      { headers },
    );
    expect(r.status).toBe(200);
    expect(
      (await a.api.request('GET', '/console/security/abuse?country=x1', { headers })).status,
    ).toBe(400);
    boardRefusal = 'FORBIDDEN';
    expect((await a.api.request('GET', '/console/security/abuse', { headers })).status).toBe(403);
    boardRefusal = null;
    await refusals(a, 'GET', '/console/security/abuse');
  });

  it('dossier de preuve (US-308) : demande 201, 200, 400, 403, 503 ; état 200, 400, 403, 404, 503 ; archive 200, 400, 403, 404, 409, 410, 503', async () => {
    const a = await app();
    const headers = a.cookie('staff');
    const create = '/console/evidence-bundles';
    const body = {
      requestId: randomUUID(),
      tripId: ID,
      caseId: ID,
      purpose: 'INSURER',
      reason: REASON,
    };
    const created = await a.api.request('POST', create, { headers, body });
    expect(created.status).toBe(201);
    expect(created.json).toEqual({
      bundleId: ID,
      status: 'REQUESTED',
      manifestSha256: MANIFEST_SHA,
    });
    evidenceState.request = 'ALREADY_REQUESTED';
    expect((await a.api.request('POST', create, { headers, body })).status).toBe(200);
    for (const bad of [
      { ...body, purpose: 'OTHER' },
      { ...body, reason: 'court' },
      { ...body, caseId: 'x' },
    ]) {
      expect((await a.api.request('POST', create, { headers, body: bad })).status).toBe(400);
    }
    expect(
      (await a.api.request('POST', create, { headers, body: { ...body, tripId: 'x' } })).status,
    ).toBe(400);
    for (const [outcome, code] of [
      ['FORBIDDEN', 'FORBIDDEN'],
      ['CASE_REQUIRED', 'STAFF_CASE_REQUIRED'],
      ['SELF_FORBIDDEN', 'STAFF_SELF_FORBIDDEN'],
    ] as const) {
      evidenceState.request = outcome;
      const r = await a.api.request('POST', create, { headers, body });
      expect(r.status).toBe(403);
      expect(r.json).toMatchObject({ code });
    }
    evidenceState.request = 'REQUESTED';
    evidenceState.vault = 'UNAVAILABLE';
    expect((await a.api.request('POST', create, { headers, body })).json).toMatchObject({
      code: 'EVIDENCE_EXPORT_UNAVAILABLE',
    });
    evidenceState.vault = 'READY';
    await refusals(a, 'POST', create);

    const read = `/console/evidence-bundles/${ID}`;
    const st = await a.api.request('GET', read, { headers });
    expect(st.status).toBe(200);
    expect(st.json).toMatchObject({ status: 'READY', fileCount: 27 });
    expect((await a.api.request('GET', '/console/evidence-bundles/x', { headers })).status).toBe(
      400,
    );
    evidenceState.status = 'FORBIDDEN';
    expect((await a.api.request('GET', read, { headers })).status).toBe(403);
    evidenceState.status = 'NOT_FOUND';
    expect((await a.api.request('GET', read, { headers })).json).toMatchObject({
      code: 'EVIDENCE_BUNDLE_NOT_FOUND',
    });
    evidenceState.status = 'OK';
    evidenceState.down = true;
    expect((await a.api.request('GET', read, { headers })).status).toBe(503);
    evidenceState.down = false;
    await refusals(a, 'GET', read);

    const download = `/console/evidence-bundles/${ID}/download`;
    const zip = await a.api.request('POST', download, { headers, body: { reason: REASON } });
    expect(zip.status).toBe(200);
    expect(zip.headers.get('content-type')).toMatch(/^application\/zip/);
    expect(zip.headers.get('x-evidence-sha256')).toBe(ZIP_SHA);
    expect(Buffer.from(zip.text, 'utf8').equals(ZIP)).toBe(true);
    expect(
      (await a.api.request('POST', download, { headers, body: { reason: 'court' } })).status,
    ).toBe(400);
    for (const [outcome, status, code] of [
      ['NOT_READY', 409, 'EVIDENCE_EXPORT_NOT_READY'],
      ['FAILED', 409, 'EVIDENCE_EXPORT_FAILED'],
      ['EXPIRED', 410, 'EVIDENCE_EXPORT_EXPIRED'],
      ['FORBIDDEN', 403, 'FORBIDDEN'],
      ['CASE_REQUIRED', 403, 'STAFF_CASE_REQUIRED'],
      ['NOT_FOUND', 404, 'EVIDENCE_BUNDLE_NOT_FOUND'],
    ] as const) {
      evidenceState.open = outcome;
      const r = await a.api.request('POST', download, { headers, body: { reason: REASON } });
      expect(r.status, outcome).toBe(status);
      expect(r.json).toMatchObject({ code });
    }
    evidenceState.open = 'OK';
    // archive dont l'empreinte ne correspond plus : rien n'est servi
    evidenceState.sha = 'b'.repeat(64);
    expect(
      (await a.api.request('POST', download, { headers, body: { reason: REASON } })).json,
    ).toMatchObject({ code: 'EVIDENCE_EXPORT_FAILED' });
    evidenceState.sha = ZIP_SHA;
    evidenceState.down = true;
    expect(
      (await a.api.request('POST', download, { headers, body: { reason: REASON } })).status,
    ).toBe(503);
    evidenceState.down = false;
    await refusals(a, 'POST', download);
  });

  it('déclarations et décisions (US-309) : déclaration 201, 200, 400, 403, 409, 422, 503 ; vue 200, 400, 403, 503 ; décision 200 (aperçu, rejeu), 201, 400, 403, 404, 409, 422, 503', async () => {
    const a = await app();
    const headers = a.cookie('staff');
    const create = '/console/claims';
    const body = {
      requestId: randomUUID(),
      tripId: ID,
      caseId: ID,
      declaredBy: 'HOST',
      kind: 'DAMAGE',
      description: 'Rayure constatée au retour',
    };
    const created = await a.api.request('POST', create, { headers, body });
    expect(created.status).toBe(201);
    expect(created.json).toEqual({ claim: CLAIM_VIEW });
    claimState.record = 'ALREADY_RECORDED';
    expect((await a.api.request('POST', create, { headers, body })).status).toBe(200);
    for (const bad of [
      { ...body, declaredBy: 'COHOST' },
      { ...body, kind: 'THEFT' },
      { ...body, description: 'court' },
      { ...body, caseId: 'x' },
    ]) {
      expect((await a.api.request('POST', create, { headers, body: bad })).status).toBe(400);
    }
    for (const [outcome, status, code] of [
      ['FORBIDDEN', 403, 'FORBIDDEN'],
      ['CASE_REQUIRED', 403, 'STAFF_CASE_REQUIRED'],
      ['SELF_FORBIDDEN', 403, 'STAFF_SELF_FORBIDDEN'],
      ['CLAIM_TRIP_NOT_ELIGIBLE', 409, 'CLAIM_TRIP_NOT_ELIGIBLE'],
      ['CLAIM_ALREADY_OPEN', 409, 'CLAIM_ALREADY_OPEN'],
      ['CLAIM_DEADLINE_PASSED', 422, 'CLAIM_DEADLINE_PASSED'],
      ['CLAIM_WINDOW_UNKNOWN', 503, 'CLAIM_WINDOW_UNKNOWN'],
    ] as const) {
      claimState.record = outcome;
      const r = await a.api.request('POST', create, { headers, body });
      expect(r.status, outcome).toBe(status);
      expect(r.json).toMatchObject({ code });
    }
    claimState.record = 'RECORDED';
    claimState.down = true;
    expect((await a.api.request('POST', create, { headers, body })).json).toMatchObject({
      code: 'CLAIMS_UNAVAILABLE',
    });
    claimState.down = false;
    await refusals(a, 'POST', create);

    const read = `/console/claims/${ID}`;
    expect((await a.api.request('GET', read, { headers })).json).toEqual({ claim: CLAIM_VIEW });
    expect((await a.api.request('GET', '/console/claims/x', { headers })).status).toBe(400);
    claimState.view = 'FORBIDDEN';
    expect((await a.api.request('GET', read, { headers })).status).toBe(403);
    claimState.view = 'OK';
    claimState.down = true;
    expect((await a.api.request('GET', read, { headers })).status).toBe(503);
    claimState.down = false;
    await refusals(a, 'GET', read);

    const decide = `/console/claims/${ID}/decision`;
    const decision = {
      requestId: randomUUID(),
      outcome: 'GUEST_LIABLE',
      covered: true,
      repairCostMinor: '120000',
      amountMinor: '45350',
      lines: [
        { category: 'REPAIR', amountMinor: '40000' },
        { category: 'PROCESSING_FEE', amountMinor: '5000' },
        { category: 'PROCESSING_FEE_TAX', amountMinor: '350' },
        { category: 'RECOVERY_PARKING', amountMinor: '1500' },
      ],
      hostDeductibleMinor: '25000',
      facts: 'Photos de départ sans dommage, rayure au retour, devis joint.',
    };
    const preview = await a.api.request('POST', decide, {
      headers,
      body: { ...decision, preview: true },
    });
    expect(preview.status).toBe(200);
    expect(preview.json).toEqual({ preview: CLAIM_PREVIEW });
    expect((await a.api.request('POST', decide, { headers, body: decision })).status).toBe(201);
    claimState.decide = 'ALREADY_DECIDED';
    expect((await a.api.request('POST', decide, { headers, body: decision })).status).toBe(200);
    for (const bad of [
      { ...decision, amountMinor: 45350 },
      { ...decision, amountMinor: '-1' },
      { ...decision, outcome: 'FINAL' },
      { ...decision, lines: [{ category: 'FUEL', amountMinor: '1' }] },
      { ...decision, guestAgreementFileId: 'x' },
      { ...decision, preview: 'yes' },
    ]) {
      expect((await a.api.request('POST', decide, { headers, body: bad })).status).toBe(400);
    }
    for (const [outcome, status, code] of [
      ['FORBIDDEN', 403, 'FORBIDDEN'],
      ['CASE_REQUIRED', 403, 'STAFF_CASE_REQUIRED'],
      ['SELF_FORBIDDEN', 403, 'STAFF_SELF_FORBIDDEN'],
      ['DECISION_ADMIN_REQUIRED', 403, 'DECISION_ADMIN_REQUIRED'],
      ['CLAIM_NOT_FOUND', 404, 'CLAIM_NOT_FOUND'],
      ['CLAIM_ALREADY_DECIDED', 409, 'CLAIM_ALREADY_DECIDED'],
      ['CLAIM_DECISION_WITHOUT_EVIDENCE', 422, 'CLAIM_DECISION_WITHOUT_EVIDENCE'],
      ['DECISION_RATIONALE_REQUIRED', 422, 'DECISION_RATIONALE_REQUIRED'],
      ['DECISION_FINALITY_FORBIDDEN', 422, 'DECISION_FINALITY_FORBIDDEN'],
      ['LEG_SUM_MISMATCH', 422, 'LEG_SUM_MISMATCH'],
      ['DECISION_OUTCOME_MISMATCH', 422, 'DECISION_OUTCOME_MISMATCH'],
      ['CLAIM_CAP_UNKNOWN', 422, 'CLAIM_CAP_UNKNOWN'],
      ['DAMAGE_ABOVE_ACCEPTED_AMOUNT', 422, 'DAMAGE_ABOVE_ACCEPTED_AMOUNT'],
      ['DAMAGE_ABOVE_REPAIR_COST', 422, 'DAMAGE_ABOVE_REPAIR_COST'],
      ['AGREEMENT_FILE_INVALID', 422, 'AGREEMENT_FILE_INVALID'],
    ] as const) {
      claimState.decide = outcome;
      const r = await a.api.request('POST', decide, { headers, body: decision });
      expect(r.status, outcome).toBe(status);
      expect(r.json).toMatchObject({ code });
    }
    claimState.decide = 'DECIDED';
    claimState.down = true;
    expect((await a.api.request('POST', decide, { headers, body: decision })).status).toBe(503);
    claimState.down = false;
    await refusals(a, 'POST', decide);
  });

  it('frais annexes contestés (US-706) : vue 200, 400, 403, 503 ; décision 201, 200 (rejeu), 400, 403, 409, 422, 503', async () => {
    const a = await app();
    const headers = a.cookie('staff');
    const read = `/console/incidental-fees/${ID}`;
    expect((await a.api.request('GET', read, { headers })).json).toEqual({
      incidental: INCIDENTAL_VIEW,
    });
    expect((await a.api.request('GET', '/console/incidental-fees/x', { headers })).status).toBe(
      400,
    );
    for (const [outcome, code] of [
      ['FORBIDDEN', 'FORBIDDEN'],
      ['SELF_FORBIDDEN', 'STAFF_SELF_FORBIDDEN'],
    ] as const) {
      incidentalState.view = outcome;
      const r = await a.api.request('GET', read, { headers });
      expect(r.status, outcome).toBe(403);
      expect(r.json).toMatchObject({ code });
    }
    incidentalState.view = 'OK';
    incidentalState.down = true;
    expect((await a.api.request('GET', read, { headers })).json).toMatchObject({
      code: 'CLAIMS_UNAVAILABLE',
    });
    incidentalState.down = false;
    await refusals(a, 'GET', read);

    const decide = `/console/incidental-fees/${ID}/decision`;
    const decision = {
      requestId: randomUUID(),
      outcome: 'CHARGE',
      rationale: 'Photos de retour de l’hôte : sable visible sur la banquette.',
    };
    expect((await a.api.request('POST', decide, { headers, body: decision })).status).toBe(201);
    incidentalState.decide = 'ALREADY_DECIDED';
    expect((await a.api.request('POST', decide, { headers, body: decision })).status).toBe(200);
    for (const bad of [
      { ...decision, outcome: 'FINAL' },
      { ...decision, requestId: 'x' },
      { ...decision, amountMinor: '4500' },
      { requestId: decision.requestId, outcome: 'REJECT' },
    ]) {
      expect((await a.api.request('POST', decide, { headers, body: bad })).status).toBe(400);
    }
    for (const [outcome, status, code] of [
      ['FORBIDDEN', 403, 'FORBIDDEN'],
      ['SELF_FORBIDDEN', 403, 'STAFF_SELF_FORBIDDEN'],
      ['DECISION_ADMIN_REQUIRED', 403, 'DECISION_ADMIN_REQUIRED'],
      ['INCIDENTAL_NOT_DISPUTED', 409, 'INCIDENTAL_NOT_DISPUTED'],
      ['DECISION_RATIONALE_REQUIRED', 422, 'DECISION_RATIONALE_REQUIRED'],
      ['DECISION_FINALITY_FORBIDDEN', 422, 'DECISION_FINALITY_FORBIDDEN'],
    ] as const) {
      incidentalState.decide = outcome;
      const r = await a.api.request('POST', decide, { headers, body: decision });
      expect(r.status, outcome).toBe(status);
      expect(r.json).toMatchObject({ code });
    }
    incidentalState.decide = 'DECIDED';
    incidentalState.down = true;
    expect((await a.api.request('POST', decide, { headers, body: decision })).status).toBe(503);
    incidentalState.down = false;
    await refusals(a, 'POST', decide);

    // frais « à revoir par l'ops » (ADR-197 n° 18) : 200, 403, 503
    const reviews = '/console/incidental-reviews';
    expect((await a.api.request('GET', reviews, { headers })).json).toEqual(INCIDENTAL_REVIEW);
    incidentalState.review = 'FORBIDDEN';
    expect((await a.api.request('GET', reviews, { headers })).status).toBe(403);
    incidentalState.review = 'OK';
    incidentalState.down = true;
    expect((await a.api.request('GET', reviews, { headers })).status).toBe(503);
    incidentalState.down = false;
    await refusals(a, 'GET', reviews);
  });

  it('refacturations contestées (US-318 suite) : liste 200, 403, 503 ; vue 200, 400, 403, 503 ; décision 201, 200 (rejeu), 400, 403, 409, 422, 503', async () => {
    const a = await app();
    const headers = a.cookie('staff');
    const list = '/console/traffic-charges';
    expect((await a.api.request('GET', list, { headers })).json).toEqual(TRAFFIC_REVIEW);
    incidentalState.trafficReview = 'FORBIDDEN';
    expect((await a.api.request('GET', list, { headers })).status).toBe(403);
    incidentalState.trafficReview = 'OK';
    incidentalState.down = true;
    expect((await a.api.request('GET', list, { headers })).status).toBe(503);
    incidentalState.down = false;
    await refusals(a, 'GET', list);

    const read = `/console/traffic-charges/${ID}`;
    expect((await a.api.request('GET', read, { headers })).json).toEqual({
      trafficCharge: TRAFFIC_VIEW,
    });
    expect((await a.api.request('GET', '/console/traffic-charges/x', { headers })).status).toBe(
      400,
    );
    for (const [outcome, code] of [
      ['FORBIDDEN', 'FORBIDDEN'],
      ['SELF_FORBIDDEN', 'STAFF_SELF_FORBIDDEN'],
    ] as const) {
      incidentalState.trafficView = outcome;
      const r = await a.api.request('GET', read, { headers });
      expect(r.status, outcome).toBe(403);
      expect(r.json).toMatchObject({ code });
    }
    incidentalState.trafficView = 'OK';
    incidentalState.down = true;
    expect((await a.api.request('GET', read, { headers })).json).toMatchObject({
      code: 'CLAIMS_UNAVAILABLE',
    });
    incidentalState.down = false;
    await refusals(a, 'GET', read);

    const decide = `/console/traffic-charges/${ID}/decision`;
    const decision = {
      requestId: randomUUID(),
      outcome: 'REJECT',
      rationale: 'Avis officiel illisible : la plaque ne correspond pas au véhicule.',
    };
    expect((await a.api.request('POST', decide, { headers, body: decision })).status).toBe(201);
    incidentalState.trafficDecide = 'ALREADY_DECIDED';
    expect((await a.api.request('POST', decide, { headers, body: decision })).status).toBe(200);
    for (const bad of [
      { ...decision, outcome: 'FINAL' },
      { ...decision, requestId: 'x' },
      { ...decision, amountMinor: '1230' },
      { requestId: decision.requestId, outcome: 'REJECT' },
    ]) {
      expect((await a.api.request('POST', decide, { headers, body: bad })).status).toBe(400);
    }
    for (const [outcome, status, code] of [
      ['FORBIDDEN', 403, 'FORBIDDEN'],
      ['SELF_FORBIDDEN', 403, 'STAFF_SELF_FORBIDDEN'],
      ['DECISION_ADMIN_REQUIRED', 403, 'DECISION_ADMIN_REQUIRED'],
      ['TRAFFIC_NOT_DISPUTED', 409, 'TRAFFIC_NOT_DISPUTED'],
      ['DECISION_RATIONALE_REQUIRED', 422, 'DECISION_RATIONALE_REQUIRED'],
      ['DECISION_FINALITY_FORBIDDEN', 422, 'DECISION_FINALITY_FORBIDDEN'],
    ] as const) {
      incidentalState.trafficDecide = outcome;
      const r = await a.api.request('POST', decide, { headers, body: decision });
      expect(r.status, outcome).toBe(status);
      expect(r.json).toMatchObject({ code });
    }
    incidentalState.trafficDecide = 'DECIDED';
    incidentalState.down = true;
    expect((await a.api.request('POST', decide, { headers, body: decision })).status).toBe(503);
    incidentalState.down = false;
    await refusals(a, 'POST', decide);
  });

  it('files de revue, fiche 360°, notes, dossiers, pièces (US-109) : chaque statut déclaré', async () => {
    const a = await app();
    const headers = a.cookie('staff');
    const post = (path: string, body: unknown) => a.api.request('POST', path, { headers, body });
    const purpose = 'Instruction du dossier assigné';

    // files : 200 (dates normalisées), 400, 401, 403
    const q = await a.api.request('GET', '/console/queues?queue=KYC&limit=10', { headers });
    expect(q.status).toBe(200);
    expect(q.json).toMatchObject({
      items: [{ overdue: true, slaDueAt: '2031-07-01T08:00:00.123Z' }],
    });
    expect((await a.api.request('GET', '/console/queues?queue=X', { headers })).status).toBe(400);
    ops.outcome['queues'] = 'FORBIDDEN';
    expect((await a.api.request('GET', '/console/queues', { headers })).status).toBe(403);
    delete ops.outcome['queues'];
    await refusals(a, 'GET', '/console/queues');

    // prise en charge : 200, 400, 403, 409
    const claim = `/console/queues/items/${ID}/claim`;
    expect((await post(claim, { requestId: randomUUID() })).json).toEqual({ itemId: ID });
    expect((await post(claim, { requestId: 'x' })).status).toBe(400);
    ops.outcome['claim'] = 'TAKEN';
    expect((await post(claim, { requestId: randomUUID() })).json).toMatchObject({
      code: 'STAFF_ITEM_TAKEN',
    });
    ops.outcome['claim'] = 'FORBIDDEN';
    expect((await post(claim, { requestId: randomUUID() })).status).toBe(403);
    await refusals(a, 'POST', claim);

    // dossier KYC : 200, 400, 403 (dont STAFF_CASE_REQUIRED)
    const kyc = `/console/queues/items/${ID}/kyc`;
    const dossier = await post(kyc, { requestId: randomUUID(), purpose });
    expect(dossier.status).toBe(200);
    expect(dossier.json).toMatchObject({
      kycStatus: 'MANUAL_REVIEW',
      verification: { updatedAt: '2031-07-01T08:00:00.123Z', liveness: { erased: false } },
    });
    expect((await post(kyc, { requestId: randomUUID(), purpose: 'court' })).status).toBe(400);
    ops.outcome['kycDossier'] = 'CASE_REQUIRED';
    expect((await post(kyc, { requestId: randomUUID(), purpose })).json).toMatchObject({
      code: 'STAFF_CASE_REQUIRED',
    });
    await refusals(a, 'POST', kyc);

    // dossier de l'hôte (US-108) : 200, 400, 403 (dont STAFF_CASE_REQUIRED)
    const host = `/console/queues/items/${ID}/host-verification`;
    const hostRead = await post(host, { requestId: randomUUID(), purpose });
    expect(hostRead.status).toBe(200);
    expect(hostRead.json).toMatchObject({
      screeningHold: true,
      screening: { screenedAt: '2031-07-01T08:00:00.123Z', source: 'OPS_MANUAL' },
      checklist: expect.arrayContaining([{ item: 'SANCTIONS', state: 'HELD' }]),
    });
    expect((await post(host, { requestId: randomUUID(), purpose: 'court' })).status).toBe(400);
    ops.outcome['hostDossier'] = 'CASE_REQUIRED';
    expect((await post(host, { requestId: randomUUID(), purpose })).json).toMatchObject({
      code: 'STAFF_CASE_REQUIRED',
    });
    delete ops.outcome['hostDossier'];
    await refusals(a, 'POST', host);

    // réservation signalée (US-209b) : 200 (instants en ISO, date d'entrée inchangée), 400, 403
    // (dont STAFF_CASE_REQUIRED, STAFF_SELF_FORBIDDEN), 409 BOOKING_REVIEW_NOT_BOOKING
    const booking = `/console/queues/items/${ID}/risk-review`;
    const bookingRead = await post(booking, { requestId: randomUUID(), purpose });
    expect(bookingRead.status).toBe(200);
    expect(bookingRead.json).toMatchObject({
      score: 50,
      holdStatus: 'ACTIVE',
      expiresAt: '2031-07-01T10:00:00.123Z',
      startsAt: '2031-07-10T15:00:00.000Z',
      entryDeclaration: { entryDate: '2031-06-20', declaredAt: '2031-06-30T08:00:00.123Z' },
    });
    expect((await post(booking, { requestId: randomUUID(), purpose: 'court' })).status).toBe(400);
    for (const [outcome, code] of [
      ['CASE_REQUIRED', 'STAFF_CASE_REQUIRED'],
      ['SELF_FORBIDDEN', 'STAFF_SELF_FORBIDDEN'],
      ['NOT_A_BOOKING', 'BOOKING_REVIEW_NOT_BOOKING'],
    ] as const) {
      ops.outcome['bookingReview'] = outcome;
      expect((await post(booking, { requestId: randomUUID(), purpose })).json).toMatchObject({
        code,
      });
    }
    delete ops.outcome['bookingReview'];
    await refusals(a, 'POST', booking);

    // état d'une demande d'annulation (US-215b) : 200 (instants en ISO, montants en texte), aucune
    // demande (null), 400, 403 (dont STAFF_SELF_FORBIDDEN)
    const cxl = `/console/cancellations/${ID}`;
    const cxlRead = await a.api.request('GET', cxl, { headers: a.cookie('staff') });
    expect(cxlRead.status).toBe(200);
    expect(cxlRead.json).toMatchObject({
      cancellation: {
        status: 'SETTLED',
        requestedAt: '2031-07-01T08:00:00.123Z',
        decidedAt: '2031-07-01T08:00:10.500Z',
        settlement: { guestRefundMinor: '18744', legs: [{ leg: 'HOST', variationMinor: '-8625' }] },
      },
    });
    ops.outcome['tripCancellation'] = 'NONE';
    expect((await a.api.request('GET', cxl, { headers: a.cookie('staff') })).json).toEqual({
      cancellation: null,
    });
    expect(
      (await a.api.request('GET', '/console/cancellations/x', { headers: a.cookie('staff') }))
        .status,
    ).toBe(400);
    ops.outcome['tripCancellation'] = 'SELF_FORBIDDEN';
    expect((await a.api.request('GET', cxl, { headers: a.cookie('staff') })).json).toMatchObject({
      code: 'STAFF_SELF_FORBIDDEN',
    });
    ops.outcome['tripCancellation'] = 'FORBIDDEN';
    expect((await a.api.request('GET', cxl, { headers: a.cookie('staff') })).status).toBe(403);
    delete ops.outcome['tripCancellation'];
    await refusals(a, 'GET', cxl);

    // remboursements d'un trip (US-224d) : 200 (montants en texte, motif de blocage, alerte FIN),
    // 400, 403 (dont STAFF_SELF_FORBIDDEN)
    const rfd = `/console/refunds/${ID}`;
    const rfdRead = await a.api.request('GET', rfd, { headers: a.cookie('staff') });
    expect(rfdRead.status).toBe(200);
    expect(rfdRead.json).toEqual(OPS_BODIES['tripRefunds']);
    expect(
      (await a.api.request('GET', '/console/refunds/x', { headers: a.cookie('staff') })).status,
    ).toBe(400);
    ops.outcome['tripRefunds'] = 'SELF_FORBIDDEN';
    expect((await a.api.request('GET', rfd, { headers: a.cookie('staff') })).json).toMatchObject({
      code: 'STAFF_SELF_FORBIDDEN',
    });
    ops.outcome['tripRefunds'] = 'FORBIDDEN';
    expect((await a.api.request('GET', rfd, { headers: a.cookie('staff') })).status).toBe(403);
    delete ops.outcome['tripRefunds'];
    await refusals(a, 'GET', rfd);

    // vue des retards (US-306) : 200 (étape, prochaine étape, escalades), 403 sans le droit
    const overdue = await a.api.request('GET', '/console/overdue', { headers: a.cookie('staff') });
    expect(overdue.status).toBe(200);
    expect(overdue.json).toEqual(OPS_BODIES['overdueBoard']);
    ops.outcome['overdueBoard'] = 'FORBIDDEN';
    expect(
      (await a.api.request('GET', '/console/overdue', { headers: a.cookie('staff') })).json,
    ).toMatchObject({ code: 'FORBIDDEN' });
    delete ops.outcome['overdueBoard'];
    await refusals(a, 'GET', '/console/overdue');

    // file d'ajout au catalogue (US-114) : lecture 200, 400, 403, 409 ; décision 200, 400, 403,
    // 409, 422
    const addition = `/console/queues/items/${ID}/catalog-addition`;
    const read = await post(addition, { requestId: randomUUID() });
    expect(read.status).toBe(200);
    expect(read.json).toMatchObject({
      makeText: 'Chery',
      slaDueAt: '2031-07-02T08:00:00.123Z',
      candidates: [{ model: 'Tiggo 7' }],
    });
    expect((await post(addition, { requestId: 'x' })).status).toBe(400);
    ops.outcome['catalogAddition'] = 'NOT_OPEN';
    expect((await post(addition, { requestId: randomUUID() })).json).toMatchObject({
      code: 'CATALOG_REQUEST_CLOSED',
    });
    ops.outcome['catalogAddition'] = 'CASE_REQUIRED';
    expect((await post(addition, { requestId: randomUUID() })).json).toMatchObject({
      code: 'STAFF_CASE_REQUIRED',
    });
    delete ops.outcome['catalogAddition'];
    await refusals(a, 'POST', addition);
    const resolve = `${addition}/resolve`;
    const entry = {
      makeName: 'Chery',
      modelName: 'Tiggo 2',
      bodyType: 'SUV',
      yearFrom: 2017,
      transmission: 'MT',
      fuelType: 'GASOLINE',
      drive: 'FWD',
      seats: 5,
      doors: 5,
      licenseNote: 'Saisie de l’hôte vérifiée par l’ops',
    };
    const approved = await post(resolve, { requestId: randomUUID(), decision: 'APPROVE', entry });
    expect(approved.status).toBe(200);
    expect(approved.json).toEqual({ itemId: ID, requestId: ID, status: 'APPROVED', variantId: ID });
    for (const body of [
      { requestId: randomUUID(), decision: 'DELETE' },
      { requestId: randomUUID(), decision: 'MERGE' },
      { requestId: randomUUID(), decision: 'MERGE', variantId: 'x' },
      { requestId: randomUUID(), decision: 'REJECT', rejectReason: 'BECAUSE' },
      { requestId: randomUUID(), decision: 'APPROVE', entry: [] },
      { requestId: randomUUID(), decision: 'APPROVE', entry: { ...entry, price: 1 } },
    ]) {
      expect((await post(resolve, body)).status, JSON.stringify(body)).toBe(400);
    }
    const reject = { requestId: randomUUID(), decision: 'REJECT', rejectReason: 'UNKNOWN_MODEL' };
    for (const [outcome, status, code] of [
      ['NOT_OPEN', 409, 'CATALOG_REQUEST_CLOSED'],
      ['CATALOG_VARIANT_EXISTS', 409, 'CATALOG_VARIANT_EXISTS'],
      ['CATALOG_VARIANT_NOT_FOUND', 422, 'CATALOG_VARIANT_NOT_FOUND'],
      ['CATALOG_ENTRY_INVALID', 422, 'CATALOG_ENTRY_INVALID'],
      ['CASE_REQUIRED', 403, 'STAFF_CASE_REQUIRED'],
      // séparation des tâches (US-122, ADR-122) : la demande concerne l'agent
      ['SELF_FORBIDDEN', 403, 'STAFF_SELF_FORBIDDEN'],
      ['FORBIDDEN', 403, 'FORBIDDEN'],
    ] as const) {
      ops.outcome['resolveCatalogAddition'] = outcome;
      const r = await post(resolve, reject);
      expect(r.status, outcome).toBe(status);
      expect(r.json).toMatchObject({ code });
    }
    delete ops.outcome['resolveCatalogAddition'];
    const merged = await post(resolve, {
      requestId: randomUUID(),
      decision: 'MERGE',
      variantId: ID,
    });
    expect(merged.status).toBe(200);
    await refusals(a, 'POST', resolve);

    // revue du véhicule (US-124) : dossier 200, 400, 403, 409 ; décision 200, 400, 403, 409, 422
    const vehicle = `/console/queues/items/${ID}/vehicle`;
    const vehicleDossier = await post(vehicle, { requestId: randomUUID(), purpose });
    expect(vehicleDossier.json).toMatchObject({
      plate: 'AB123',
      holder: { legalLastName: 'Benítez' },
    });
    expect((await post(vehicle, { requestId: randomUUID(), purpose: 'court' })).status).toBe(400);
    for (const [outcome, status, code] of [
      ['NOT_UNDER_REVIEW', 409, 'VEHICLE_REVIEW_CLOSED'],
      ['CASE_REQUIRED', 403, 'STAFF_CASE_REQUIRED'],
      ['SELF_FORBIDDEN', 403, 'STAFF_SELF_FORBIDDEN'],
    ] as const) {
      ops.outcome['vehicleEligibility'] = outcome;
      const r = await post(vehicle, { requestId: randomUUID(), purpose });
      expect(r.status, outcome).toBe(status);
      expect(r.json).toMatchObject({ code });
    }
    delete ops.outcome['vehicleEligibility'];
    await refusals(a, 'POST', vehicle);
    const decide = `${vehicle}/decide`;
    const checklist = {
      TITLE_HOLDER: 'PASS',
      TITLE_CLEAN: 'PASS',
      PLATE_MATCH: 'PASS',
      VIN_MATCH: 'FAIL',
      LIEN: 'PASS',
      INSPECTION: 'PASS',
      REGISTRY: 'NOT_CONSULTABLE',
    };
    const verdicts = [{ documentId: ID, verdict: 'VALID', validUntil: null }];
    const decided = await post(decide, { requestId: randomUUID(), checklist, documents: verdicts });
    expect(decided.json).toMatchObject({ result: 'PENDING', reasons: ['VEHICLE_VIN_MISMATCH'] });
    for (const body of [
      { requestId: randomUUID(), checklist: { ...checklist, ALL_VERIFIED: 'PASS' }, documents: [] },
      { requestId: randomUUID(), checklist: [], documents: [] },
      { requestId: randomUUID(), checklist, documents: {} },
    ]) {
      expect((await post(decide, body)).status, JSON.stringify(body)).toBe(400);
    }
    for (const [outcome, status, code] of [
      ['NOT_UNDER_REVIEW', 409, 'VEHICLE_REVIEW_CLOSED'],
      ['CHECKLIST_INVALID', 422, 'VEHICLE_CHECKLIST_INVALID'],
      ['FORBIDDEN', 403, 'FORBIDDEN'],
    ] as const) {
      ops.outcome['decideVehicleEligibility'] = outcome;
      const r = await post(decide, { requestId: randomUUID(), checklist, documents: verdicts });
      expect(r.status, outcome).toBe(status);
      expect(r.json).toMatchObject({ code });
    }
    delete ops.outcome['decideVehicleEligibility'];
    await refusals(a, 'POST', decide);

    // revue d'une annonce (US-118, revue exigée par le pays) : 200, 400, 403, 409, 422
    const listingDecide = `/console/queues/items/${ID}/listing/decide`;
    const approve = { requestId: randomUUID(), decision: 'APPROVE' };
    expect((await post(listingDecide, approve)).json).toEqual({
      itemId: ID,
      listingId: ID,
      status: 'LISTED',
    });
    for (const body of [
      { requestId: randomUUID(), decision: 'PUBLISH' },
      { requestId: randomUUID(), decision: 'REJECT', reason: 'OTHER' },
      { requestId: 'x', decision: 'APPROVE' },
    ]) {
      expect((await post(listingDecide, body)).status, JSON.stringify(body)).toBe(400);
    }
    for (const [outcome, status, code] of [
      ['NOT_UNDER_REVIEW', 409, 'LISTING_REVIEW_CLOSED'],
      ['DECISION_RATIONALE_REQUIRED', 422, 'DECISION_RATIONALE_REQUIRED'],
      ['INSURER_CONTRACT_INACTIVE', 422, 'INSURER_CONTRACT_INACTIVE'],
      ['FORBIDDEN', 403, 'FORBIDDEN'],
    ] as const) {
      ops.outcome['decideListing'] = outcome;
      const r = await post(listingDecide, {
        requestId: randomUUID(),
        decision: 'REJECT',
        reason: 'PHOTO_QUALITY',
      });
      expect(r.status, outcome).toBe(status);
      expect(r.json).toMatchObject({ code });
    }
    ops.outcome['decideListing'] = 'HOST_NOT_ACTIVATED';
    const blocked = await post(listingDecide, approve);
    expect(blocked.status).toBe(409);
    expect(blocked.json).toEqual({
      code: 'LISTING_NOT_PUBLISHABLE',
      messageKey: 'common.listingReview.notPublishable',
      values: { reason: 'HOST_NOT_ACTIVATED' },
    });
    delete ops.outcome['decideListing'];
    await refusals(a, 'POST', listingDecide);

    // contestation (BOARD N-61) : lecture 200, 400, 403, 409 ; décision 200, 400, 403 (dont
    // STAFF_ADMIN_REQUIRED), 409, 422
    const claimPath = `/console/queues/items/${ID}/vehicle-claim`;
    expect((await post(claimPath, { requestId: randomUUID(), purpose })).status).toBe(200);
    expect((await post(claimPath, { requestId: 'x', purpose })).status).toBe(400);
    ops.outcome['vehicleClaim'] = 'NOT_OPEN';
    expect((await post(claimPath, { requestId: randomUUID(), purpose })).json).toMatchObject({
      code: 'VEHICLE_CLAIM_CLOSED',
    });
    ops.outcome['vehicleClaim'] = 'FORBIDDEN';
    expect((await post(claimPath, { requestId: randomUUID(), purpose })).status).toBe(403);
    delete ops.outcome['vehicleClaim'];
    await refusals(a, 'POST', claimPath);
    const claimDecide = `${claimPath}/decide`;
    const claimChecklist = {
      CLAIMANT_TITLE: 'PASS',
      CLAIMANT_IDENTITY: 'PASS',
      PLATE_MATCH: 'PASS',
      VIN_MATCH: 'NOT_APPLICABLE',
    };
    const uphold = {
      requestId: randomUUID(),
      decision: 'UPHOLD',
      checklist: claimChecklist,
      note: 'Titre vérifié contre le registre',
    };
    expect((await post(claimDecide, uphold)).json).toMatchObject({ status: 'UPHELD' });
    for (const body of [
      { ...uphold, checklist: { ...claimChecklist, ALL_VERIFIED: 'PASS' } },
      { ...uphold, checklist: [] },
      { ...uphold, note: 'x'.repeat(501) },
    ]) {
      expect((await post(claimDecide, body)).status, JSON.stringify(body)).toBe(400);
    }
    ops.outcome['decideVehicleClaim'] = 'CLAIM_TARGET_BOOKED';
    const booked = await post(claimDecide, uphold);
    expect(booked.status).toBe(409);
    expect(booked.json).toMatchObject({
      code: 'VEHICLE_CLAIM_TARGET_BOOKED',
      values: { count: 1 },
      bookings: [{ kind: 'TRIP', startsAt: '2031-07-01T08:00:00.000Z' }],
    });
    expect((await post(claimDecide, { requestId: randomUUID(), decision: 'KEEP' })).status).toBe(
      400,
    );
    for (const [outcome, status, code] of [
      ['ADMIN_REQUIRED', 403, 'STAFF_ADMIN_REQUIRED'],
      ['NOT_OPEN', 409, 'VEHICLE_CLAIM_CLOSED'],
      ['CLAIM_REASON_INVALID', 422, 'VEHICLE_CLAIM_REASON_INVALID'],
      ['CLAIM_DOSSIER_NOT_READ', 409, 'VEHICLE_CLAIM_DOSSIER_NOT_READ'],
      ['CLAIM_NOTE_REQUIRED', 422, 'VEHICLE_CLAIM_NOTE_REQUIRED'],
      ['CLAIM_CHECKLIST_INVALID', 422, 'VEHICLE_CHECKLIST_INVALID'],
      ['CLAIM_CHECKLIST_FAILED', 422, 'VEHICLE_CLAIM_CHECKLIST_FAILED'],
      ['CLAIM_TARGET_RELEASED', 409, 'VEHICLE_CLAIM_TARGET_RELEASED'],
      ['SAME_ADMIN_FORBIDDEN', 403, 'STAFF_SAME_ADMIN_FORBIDDEN'],
    ] as const) {
      ops.outcome['decideVehicleClaim'] = outcome;
      const r = await post(claimDecide, {
        requestId: randomUUID(),
        decision: 'DISMISS',
        reason: 'INSUFFICIENT_PROOF',
      });
      expect(r.status, outcome).toBe(status);
      expect(r.json).toMatchObject({ code });
    }
    delete ops.outcome['decideVehicleClaim'];
    await refusals(a, 'POST', claimDecide);

    // pièce (US-124) : 200 (base64), 400, 403, 404, 503 (stockage ou coffre indisponibles)
    const filePath = `/console/queues/items/${ID}/files/${ID}`;
    const fileBody = () => ({ requestId: randomUUID(), purpose, subject: 'VEHICLE' });
    const file = await post(filePath, fileBody());
    expect(file.json).toEqual({
      fileId: ID,
      mime: 'application/pdf',
      bytes: 9,
      dataBase64: Buffer.from('%PDF-1.7\n', 'latin1').toString('base64'),
    });
    expect((await post(filePath, { ...fileBody(), subject: 'USER' })).status).toBe(400);
    ops.outcome['vehicleFile'] = 'FILE_NOT_FOUND';
    expect((await post(filePath, fileBody())).json).toMatchObject({
      code: 'VEHICLE_FILE_NOT_FOUND',
    });
    ops.outcome['vehicleFile'] = 'CASE_REQUIRED';
    expect((await post(filePath, fileBody())).status).toBe(403);
    delete ops.outcome['vehicleFile'];
    vehicleFilesUp = false;
    expect((await post(filePath, fileBody())).json).toMatchObject({
      code: 'VEHICLE_FILE_UNAVAILABLE',
    });
    vehicleFilesUp = true;
    await refusals(a, 'POST', filePath);

    // recherche : 200, 400, 403, 404 ; donnée refusée par la base (22023) : 400
    const search = { requestId: randomUUID(), email: 'lucia@example.test', purpose };
    expect((await post('/console/users/search', search)).json).toEqual({
      userId: ID,
      country: FIRST_COUNTRY,
    });
    ops.outcome['findUser'] = 'NOT_FOUND';
    expect((await post('/console/users/search', search)).status).toBe(404);
    ops.outcome['findUser'] = 'FORBIDDEN';
    expect((await post('/console/users/search', search)).status).toBe(403);
    ops.invalid = true;
    expect((await post('/console/users/search', search)).status).toBe(400);
    ops.invalid = false;
    await refusals(a, 'POST', '/console/users/search');

    // fiche 360° : 200, 400, 403
    const profile = `/console/users/${ID}/profile`;
    const p = await post(profile, { requestId: randomUUID(), purpose });
    expect(p.status).toBe(200);
    expect(p.json).toMatchObject({ restricted: true, hostAccounts: [{ bookable: false }] });
    expect(
      (await post(`/console/users/x/profile`, { requestId: randomUUID(), purpose })).status,
    ).toBe(400);
    ops.outcome['profile'] = 'CASE_REQUIRED';
    expect((await post(profile, { requestId: randomUUID(), purpose })).status).toBe(403);
    await refusals(a, 'POST', profile);

    // notes : 201, 200 (rejeu), 400, 403
    const notes = `/console/users/${ID}/notes`;
    expect((await post(notes, { requestId: randomUUID(), body: 'Appel reçu' })).status).toBe(201);
    ops.outcome['addNote'] = 'DUPLICATE';
    expect((await post(notes, { requestId: randomUUID(), body: 'Appel reçu' })).status).toBe(200);
    expect((await post(notes, { requestId: randomUUID(), body: '' })).status).toBe(400);
    ops.outcome['addNote'] = 'CASE_REQUIRED';
    expect((await post(notes, { requestId: randomUUID(), body: 'Appel reçu' })).status).toBe(403);
    await refusals(a, 'POST', notes);

    // dossiers : 201, 200, 400, 403 ; état : 200, 400, 403
    const caseBody = {
      requestId: randomUUID(),
      requesterUserId: ID,
      category: 'ACCOUNT',
      channel: 'PHONE',
    };
    expect((await post('/console/cases', caseBody)).status).toBe(201);
    ops.outcome['openCase'] = 'DUPLICATE';
    expect((await post('/console/cases', caseBody)).status).toBe(200);
    expect((await post('/console/cases', { ...caseBody, category: 'BREAK_GLASS' })).status).toBe(
      400,
    );
    ops.outcome['openCase'] = 'FORBIDDEN';
    expect((await post('/console/cases', caseBody)).status).toBe(403);
    await refusals(a, 'POST', '/console/cases');
    const status = `/console/cases/${ID}/status`;
    expect((await post(status, { requestId: randomUUID(), status: 'RESOLVED' })).json).toEqual({
      caseId: ID,
      status: 'RESOLVED',
    });
    expect((await post(status, { requestId: randomUUID(), status: 'OPEN' })).status).toBe(400);
    ops.outcome['setCaseStatus'] = 'CASE_REQUIRED';
    expect((await post(status, { requestId: randomUUID(), status: 'CLOSED' })).status).toBe(403);
    await refusals(a, 'POST', status);

    // US-215c (ADR-156, N-116) : personne ou dossier qui concerne l'agent ⇒ 403 STAFF_SELF_FORBIDDEN
    for (const [store, path, body] of [
      ['profile', profile, { requestId: randomUUID(), purpose }],
      ['addNote', notes, { requestId: randomUUID(), body: 'Appel reçu' }],
      ['openCase', '/console/cases', { ...caseBody, requestId: randomUUID() }],
      ['setCaseStatus', status, { requestId: randomUUID(), status: 'CLOSED' }],
    ] as const) {
      ops.outcome[store] = 'SELF_FORBIDDEN';
      const r = await post(path, body);
      expect(r.status, store).toBe(403);
      expect(r.json, store).toMatchObject({ code: 'STAFF_SELF_FORBIDDEN' });
    }

    // pièces : 201, 200, 400, 403, 422 (taille, type réel, antivirus), 503 (antivirus en panne)
    const upload = (over: Record<string, unknown> = {}) =>
      post('/console/evidence', {
        requestId: randomUUID(),
        subjectUserId: ID,
        mime: 'image/png',
        contentBase64: PNG.toString('base64'),
        ...over,
      });
    const ok = await upload();
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ sha256: createHash('sha256').update(PNG).digest('hex') });
    ops.outcome['recordEvidence'] = 'DUPLICATE';
    expect((await upload()).status).toBe(200);
    delete ops.outcome['recordEvidence'];
    expect((await upload({ contentBase64: '***' })).status).toBe(400);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
    expect((await upload({ contentBase64: svg.toString('base64') })).json).toMatchObject({
      code: 'EVIDENCE_REJECTED',
      values: { reason: 'TYPE' },
    });
    expect((await upload({ mime: 'application/pdf' })).json).toMatchObject({
      values: { reason: 'TYPE' },
    });
    scanVerdict = 'INFECTED';
    expect((await upload()).json).toMatchObject({ values: { reason: 'SCAN' } });
    scanVerdict = 'DOWN';
    expect((await upload()).status).toBe(503);
    scanVerdict = 'CLEAN';
    ops.outcome['evidencePermitted'] = 'FORBIDDEN';
    expect((await upload()).status).toBe(403);
    delete ops.outcome['evidencePermitted'];
    await refusals(a, 'POST', '/console/evidence');
  });

  it('429 : limite de débit de la console par IP sur chaque route /console', async () => {
    const a = await app({
      requestsPerIp: 0,
      requestWindowMs: 60_000,
      mfaPerIp: 1_000,
      mfaPerAccount: 1_000,
      mfaWindowMs: 60_000,
    });
    const headers = a.cookie('staff');
    for (const op of contract.operations().filter((o) => o.includes(' /console/'))) {
      const [method, template] = op.split(' ') as ['GET' | 'POST', string];
      const path = template.replace(/\{[^}]+\}/g, ID);
      expect((await a.api.request(method, path, { headers, body: {} })).status, op).toBe(429);
    }
  });

  it('couverture : chaque statut déclaré pour /console est exercé', () => {
    expect(
      missingCoverage(contract, '/console', coverageOf(...apps)).filter(
        // demandes d'aide (US-310) : leur suite (sup/testing/help.contract) ; vues de la bêta,
        // exports et rapprochement (US-311) : leur suite (rpt/testing/report.contract) ; le 429
        // est exercé ici
        (d) =>
          !(
            d.includes(' /console/help-requests ') ||
            d.includes(' /console/beta-views/') ||
            d.includes(' /console/reports/') ||
            d.includes(' /console/reconciliation/')
          ) || d.endsWith(' 429'),
      ),
    ).toEqual([]);
  });
});
