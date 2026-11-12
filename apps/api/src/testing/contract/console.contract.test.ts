/**
 * US-038 — contrat des routes /console (US-012 actions, US-101 cadre des actions et décisions
 * FINANCE à deux personnes, US-034 marque et contenu, US-052 tableau de sécurité) sur l'application réelle : chaque statut déclaré est exercé, chaque réponse
 * validée contre l'OpenAPI. Les magasins sont des doubles en mémoire à issues réglables (la base
 * juge en production : commandes `core.cfg_brand_*`, `core.sup_*`, `core.risk_staff_abuse_board`,
 * prouvées par test:int) ; les contrôles de l'API (jetons, contraste, polices, Markdown) sont les
 * vrais.
 */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
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
  let action: Awaited<ReturnType<ManualActionStore['record']>>['outcome'] = 'RECORDED';
  let actionDetail: string | null = null;
  let approval: Awaited<ReturnType<FinanceApprovalStore['approve']>> = 'APPROVED';
  let boardRefusal: 'FORBIDDEN' | null = null;
  const ops = new TunableOpsStore();
  let scanVerdict: 'CLEAN' | 'INFECTED' | 'DOWN' = 'CLEAN';
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
  afterAll(closeContractApps);

  async function app(limits?: StaffOptions['limits']): Promise<ContractApp> {
    const ref: { self?: ContractApp } = {};
    const a = await startContractApp({
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
      },
      brand: {
        store: brand,
        files: {
          put: () => Promise.resolve({ status: filesUp ? 'STORED' : 'UNAVAILABLE' }),
          get: () => Promise.resolve({ status: 'NOT_FOUND' }),
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
    expect(missingCoverage(contract, '/console', coverageOf(...apps))).toEqual([]);
  });
});
