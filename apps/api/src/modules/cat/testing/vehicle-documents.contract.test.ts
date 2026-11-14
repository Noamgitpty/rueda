/**
 * US-124 — tests de contrat des routes des pièces et de l'éligibilité du véhicule
 * (`/host/accounts/{orgId}/vehicle-eligibility`, `…/vehicles/{vehicleId}/declaration|documents|
 * eligibility`, `…/vehicle-claims`), sur l'application RÉELLE (ApiModule, harnais d'US-043) et les
 * FAKE des magasins : chaque réponse est confrontée à `apps/api/openapi/openapi.json`.
 * Attendus : 19 US-124 (motif « titre », pièces, prenda, hors catalogue), 16 HST-019 / HST-039
 * (codes), L1-PM-41 à L1-PM-43 (type réel, antivirus fail-closed, dépôt seulement après
 * l'analyse), 17 §2.3 point 5 (IDOR : 404), BOARD N-61 (contestation). Les règles elles-mêmes sont
 * prouvées sur PostgreSQL (packages/db/test/l0/l0-us124-vehicle-documents.test.ts). Données
 * fictives.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  closeContractApps,
  contract,
  coverageOf,
  FIRST_COUNTRY,
  startContractApp,
  textBody,
} from '../../../testing/contract/support.js';
import type { ContractApp } from '../../../testing/contract/support.js';
import { missingCoverage } from '../../../testing/openapi-contract.js';
import { UNAVAILABLE_DOCUMENTS } from '../internal/vehicle-documents/ports.js';
import type { DocumentPipeline } from '../internal/vehicle-documents/ports.js';
import { FakeHostListingStore } from './fake-host-listing-store.js';
import { FakeVehicleDocumentStore } from './fake-vehicle-document-store.js';

const PDF = Buffer.from('%PDF-1.7\n% pièce fictive de test\n', 'latin1');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 'utf8');

interface Trace {
  scans: number;
  sealed: number;
}

/** Antivirus, coffre et stockage de test : sain sauf la chaîne « EICAR » ; panne réglable. */
interface Down {
  scan: boolean;
  store: boolean;
  /** Verdict imposé à l'antivirus (défaut : CLEAN, ou INFECTED si « EICAR »). */
  verdict?: string;
  /** Type détecté imposé (défaut : le type déclaré, lu par le serveur sur les octets). */
  detected?: string | null;
}

function pipeline(trace: Trace, down: Down): DocumentPipeline {
  return {
    scanner: {
      scan: ({ declaredMime, body }) => {
        trace.scans += 1;
        if (down.scan) return Promise.resolve({ status: 'UNAVAILABLE' as const });
        const infected = body.includes(Buffer.from('EICAR'));
        return Promise.resolve({
          status: 'SCANNED' as const,
          report: {
            verdict: down.verdict ?? (infected ? 'INFECTED' : 'CLEAN'),
            detectedMime: down.detected === undefined ? declaredMime : down.detected,
            threat: infected ? 'Test' : null,
          },
        });
      },
    },
    vault: {
      prepare: () => Promise.resolve('READY' as const),
      seal: (_tx, _u, _f, body) => {
        trace.sealed += 1;
        return Promise.resolve({ status: 'SEALED' as const, body: Buffer.from(body).reverse() });
      },
      open: (_u, _f, body) =>
        Promise.resolve({ status: 'OPENED' as const, body: Buffer.from(body).reverse() }),
    },
    files: {
      put: () =>
        Promise.resolve(
          down.store ? { status: 'UNAVAILABLE' as const } : { status: 'STORED' as const },
        ),
      get: () => Promise.resolve({ status: 'MISSING' as const }),
    },
  };
}

interface World {
  readonly app: ContractApp;
  readonly docs: FakeVehicleDocumentStore;
  readonly trace: Trace;
  readonly down: Down;
  readonly orgA: string;
  readonly orgB: string;
  readonly a: Record<string, string>;
}

const apps: ContractApp[] = [];

async function world(open = true): Promise<World> {
  const store = new FakeHostListingStore();
  const docs = new FakeVehicleDocumentStore();
  const trace: Trace = { scans: 0, sealed: 0 };
  const down: Down = { scan: false, store: false };
  const app = await startContractApp({
    cat: {
      store,
      documents: docs,
      documentFiles: open ? pipeline(trace, down) : UNAVAILABLE_DOCUMENTS,
    },
  });
  apps.push(app);
  const orgA = randomUUID();
  const orgB = randomUUID();
  store.addHost(Buffer.from(app.hash('voyageur'), 'hex'), {
    orgId: orgA,
    country: FIRST_COUNTRY,
    currency: 'XXX',
    status: 'ONBOARDING',
  });
  store.addHost(Buffer.from(app.hash('staff_sans_mfa'), 'hex'), {
    orgId: orgB,
    country: FIRST_COUNTRY,
    currency: 'XXX',
    status: 'ONBOARDING',
  });
  return { app, docs, trace, down, orgA, orgB, a: app.cookie('voyageur') };
}

const upload = (content: Buffer, type = 'TITLE') => ({
  requestId: randomUUID(),
  type,
  validUntil: '2030-01-31',
  dataBase64: content.toString('base64'),
});

describe('contrat HTTP — pièces et éligibilité du véhicule (US-124)', () => {
  afterAll(closeContractApps);

  it('lecture de l’éligibilité : 200 (statut, motifs, pièces sans clé ni plaque), 401, 404 (compte d’un autre), 503', async () => {
    const w = await world();
    const vehicleId = randomUUID();
    w.docs.vehicles = [
      {
        vehicleId,
        eligibilityStatus: 'PENDING',
        titleHolder: 'THIRD_PARTY',
        lienDeclared: true,
        odometerKm: 42_000,
        ownershipAttested: true,
        lienAttested: false,
        hasVin: true,
        reasons: ['VEHICLE_TITLE_MISMATCH'],
        released: false,
        publishable: false,
        underReview: false,
        submittedAt: null,
        checkedAt: null,
        requiredDocuments: ['TITLE', 'PLATE_VIN_PHOTO', 'INSPECTION', 'OWNER_AUTHORIZATION'],
        documents: [
          {
            documentId: randomUUID(),
            type: 'TITLE',
            status: 'SUBMITTED',
            validUntil: null,
            rejectReason: null,
            mime: 'application/pdf',
            bytes: 1234,
            createdAt: '2031-07-01T08:00:00.000Z',
          },
        ],
      },
    ];
    const path = `/host/accounts/${w.orgA}/vehicle-eligibility`;
    const r = await w.app.api.request('GET', path, { headers: w.a });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      vehicles: [{ vehicleId, reasons: ['VEHICLE_TITLE_MISMATCH'] }],
      documentUploads: { open: true },
    });
    expect(r.text).not.toContain('storageKey');
    expect((await w.app.api.request('GET', path)).status).toBe(401);
    for (const org of [w.orgB, randomUUID(), 'pas-un-uuid']) {
      const other = await w.app.api.request('GET', `/host/accounts/${org}/vehicle-eligibility`, {
        headers: w.a,
      });
      expect(other.json).toMatchObject({ code: 'HOST_ACCOUNT_NOT_FOUND' });
    }
    w.docs.failing = true;
    expect((await w.app.api.request('GET', path, { headers: w.a })).status).toBe(503);
  });

  it('déclarations : 200, 400 (champ lié), 401, 403, 404, 409, 415, 422 (numéro de châssis), 503', async () => {
    const w = await world();
    const path = `/host/accounts/${w.orgA}/vehicles/${randomUUID()}/declaration`;
    const body = {
      titleHolder: 'THIRD_PARTY',
      lienDeclared: true,
      odometerKm: 42_000,
      ownershipAttested: true,
      lienAttested: true,
      vin: '1hgcm82633a004352',
    };
    const send = (b: unknown, headers = w.a) =>
      w.app.api.request('PUT', path, { headers, body: b });
    expect((await send(body)).json).toMatchObject({ code: 'VEHICLE_DECLARATION_SAVED' });
    // les engagements et le VIN arrivent au magasin (horodatés par la base)
    expect(w.docs.declared.at(-1)).toEqual({
      titleHolder: 'THIRD_PARTY',
      lienDeclared: true,
      odometerKm: 42_000,
      ownershipAttested: true,
      lienAttested: true,
      vin: '1hgcm82633a004352',
      // langue de l'écran absente : es, qui fait foi (libellé historisé, ADR-113)
      locale: 'es',
    });
    // langue de l'écran : celle du catalogue (pt-BR ⇒ pt) ; hors catalogue ⇒ 400
    expect((await send({ ...body, locale: 'pt-BR' })).json).toMatchObject({
      code: 'VEHICLE_DECLARATION_SAVED',
    });
    expect(w.docs.declared.at(-1)).toMatchObject({ locale: 'pt' });
    expect((await send({ ...body, locale: 'de' })).json).toMatchObject({
      code: 'REQUEST_INVALID',
      fields: [{ field: 'locale', reason: 'INVALID' }],
    });
    // châssis court d'une importation japonaise : transmis tel quel, la base juge (ADR-113)
    expect((await send({ ...body, vin: 'GRJ150-0012345' })).status).toBe(200);
    expect(w.docs.declared.at(-1)).toMatchObject({ vin: 'GRJ150-0012345' });
    expect((await send({ ...body, titleHolder: 'OWNER' })).json).toMatchObject({
      code: 'REQUEST_INVALID',
      fields: [{ field: 'titleHolder', reason: 'INVALID' }],
    });
    expect((await send(body, {})).status).toBe(401);
    for (const [outcome, status] of [
      ['HOST_ACCOUNT_SUSPENDED', 403],
      ['VEHICLE_NOT_FOUND', 404],
      ['VEHICLE_UNDER_REVIEW', 409],
      ['VEHICLE_VIN_INVALID', 422],
      ['VEHICLE_FIELD_REQUIRED', 422],
    ] as const) {
      w.docs.outcome['declare'] = outcome;
      const r = await send(body);
      expect(r.status, outcome).toBe(status);
      expect(r.json).toMatchObject({ code: outcome });
    }
    expect((await w.app.api.request('PUT', path, textBody(w.a))).status).toBe(415);
    w.docs.failing = true;
    expect((await send(body)).status).toBe(503);
  });

  it('pièce : 201 après l’antivirus ; type réel hors liste (SVG) ou infectée ⇒ 422 sans dépôt ; droit jugé AVANT l’analyse (403, 404, 409 : aucune analyse) ; 400, 401, 415 ; antivirus ou stockage en panne ⇒ 503', async () => {
    const w = await world();
    const vehicleId = randomUUID();
    const path = `/host/accounts/${w.orgA}/vehicles/${vehicleId}/documents`;
    const send = (b: unknown, headers = w.a) =>
      w.app.api.request('POST', path, { headers, body: b });
    const ok = await send(upload(PDF));
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ code: 'VEHICLE_DOCUMENT_ADDED' });
    expect(w.docs.deposited).toEqual([
      expect.objectContaining({
        type: 'TITLE',
        file: expect.objectContaining({ mime: 'application/pdf', bytes: PDF.length }),
      }),
    ]);
    for (const content of [SVG, Buffer.concat([PDF, Buffer.from('EICAR')])]) {
      const r = await send(upload(content));
      expect(r.status).toBe(422);
      expect(r.json).toMatchObject({ code: 'VEHICLE_DOCUMENT_INVALID' });
    }
    expect(w.docs.deposited).toHaveLength(1);
    const scans = w.trace.scans;
    for (const [outcome, status] of [
      ['HOST_ACCOUNT_SUSPENDED', 403],
      ['VEHICLE_NOT_FOUND', 404],
      ['VEHICLE_UNDER_REVIEW', 409],
    ] as const) {
      w.docs.outcome['documentPermitted'] = outcome;
      expect((await send(upload(PDF))).status, outcome).toBe(status);
    }
    expect(w.trace.scans).toBe(scans);
    delete w.docs.outcome['documentPermitted'];
    expect((await send({ ...upload(PDF), type: 'SELFIE' })).json).toMatchObject({
      code: 'REQUEST_INVALID',
      fields: [{ field: 'type', reason: 'INVALID' }],
    });
    expect((await send({ ...upload(PDF), validUntil: '2030-02-30' })).status).toBe(400);
    expect((await send(upload(PDF), {})).status).toBe(401);
    expect((await w.app.api.request('POST', path, textBody(w.a))).status).toBe(415);
    w.down.scan = true;
    expect((await send(upload(PDF))).json).toMatchObject({ code: 'VEHICLE_DOCUMENT_UNAVAILABLE' });
    w.down.scan = false;
    w.down.store = true;
    expect((await send(upload(PDF))).status).toBe(503);
    expect(w.docs.deposited).toHaveLength(1);
    // production : antivirus, coffre et stockage indisponibles ⇒ 503, dépôt annoncé fermé
    const prod = await world(false);
    const closed = await prod.app.api.request(
      'POST',
      `/host/accounts/${prod.orgA}/vehicles/${vehicleId}/documents`,
      { headers: prod.a, body: upload(PDF) },
    );
    expect(closed.status).toBe(503);
    expect(prod.docs.deposited).toEqual([]);
    const state = await prod.app.api.request(
      'GET',
      `/host/accounts/${prod.orgA}/vehicle-eligibility`,
      { headers: prod.a },
    );
    expect(state.json).toMatchObject({ documentUploads: { open: false } });
  });

  it('antivirus : seul CLEAN du type réel libère ; type détecté différent du type lu, ou tout autre verdict (INFECTED, MIME_MISMATCH, UNSUPPORTED_TYPE, ENCRYPTED, inconnu) ⇒ 422, rien n’est scellé ni déposé (L1-PM-41, L1-PM-43)', async () => {
    const w = await world();
    const path = `/host/accounts/${w.orgA}/vehicles/${randomUUID()}/documents`;
    const send = () => w.app.api.request('POST', path, { headers: w.a, body: upload(PDF) });
    for (const detected of ['image/png', 'text/html', null]) {
      w.down.detected = detected;
      const r = await send();
      expect(r.status, String(detected)).toBe(422);
      expect(r.json).toMatchObject({ code: 'VEHICLE_DOCUMENT_INVALID' });
    }
    delete w.down.detected;
    for (const verdict of ['INFECTED', 'MIME_MISMATCH', 'UNSUPPORTED_TYPE', 'ENCRYPTED', 'X']) {
      w.down.verdict = verdict;
      const r = await send();
      expect(r.status, verdict).toBe(422);
      expect(r.json).toMatchObject({ code: 'VEHICLE_DOCUMENT_INVALID' });
    }
    expect(w.trace.sealed).toBe(0);
    expect(w.docs.deposited).toEqual([]);
    // TÉMOIN : CLEAN du type lu ⇒ déposé
    delete w.down.verdict;
    expect((await send()).status).toBe(201);
    expect(w.trace.sealed).toBe(1);
    expect(w.docs.deposited).toHaveLength(1);
  });

  it('soumission : 200 ; 422 avec tous les motifs (« titre ») ; 409 hors catalogue ; 401, 403, 404, 415, 503', async () => {
    const w = await world();
    const path = `/host/accounts/${w.orgA}/vehicles/${randomUUID()}/eligibility`;
    const send = (headers = w.a) => w.app.api.request('POST', path, { headers, body: {} });
    expect((await send()).json).toMatchObject({ code: 'VEHICLE_ELIGIBILITY_SUBMITTED' });
    // aucune pièce exigée par le pays (défaut) : validé tout de suite, sans élément de file
    w.docs.outcome['submit'] = 'ELIGIBLE';
    expect((await send()).json).toEqual({
      code: 'VEHICLE_ELIGIBILITY_CONFIRMED',
      messageKey: 'common.vehicleDocs.confirmed',
      itemId: null,
    });
    delete w.docs.outcome['submit'];
    w.docs.outcome['submit'] = 'VEHICLE_TITLE_MISMATCH';
    w.docs.reasons.push('VEHICLE_TITLE_MISMATCH', 'VEHICLE_LENDER_CONSENT_REQUIRED');
    const refused = await send();
    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({
      code: 'VEHICLE_TITLE_MISMATCH',
      messageKey: 'common.vehicleDocs.titleMismatch',
      reasons: ['VEHICLE_TITLE_MISMATCH', 'VEHICLE_LENDER_CONSENT_REQUIRED'],
    });
    w.docs.reasons.length = 0;
    for (const [outcome, status] of [
      ['CATALOG_ADDITION_PENDING', 409],
      ['VEHICLE_TOO_OLD', 422],
      ['HOST_ACCOUNT_SUSPENDED', 403],
      ['VEHICLE_NOT_FOUND', 404],
    ] as const) {
      w.docs.outcome['submit'] = outcome;
      const r = await send();
      expect(r.status, outcome).toBe(status);
      expect(r.json).toMatchObject({ code: outcome, reasons: [outcome] });
    }
    expect((await send({})).status).toBe(401);
    expect((await w.app.api.request('POST', path, textBody(w.a))).status).toBe(415);
    w.docs.failing = true;
    expect((await send()).status).toBe(503);
  });

  it('contestation (N-61) : 201 ; 409 inutile ou en double ; 422 fichier refusé ; 400, 401, 403, 404, 415, 503 ; lecture 200, 401, 404, 503', async () => {
    const w = await world();
    const path = `/host/accounts/${w.orgA}/vehicle-claims`;
    const body = () => ({
      requestId: randomUUID(),
      plate: 'ab-123',
      dataBase64: PDF.toString('base64'),
    });
    const send = (b: unknown, headers = w.a) =>
      w.app.api.request('POST', path, { headers, body: b });
    expect((await send(body())).status).toBe(201);
    expect(w.docs.deposited.map((d) => d.type)).toEqual(['CLAIM']);
    for (const [outcome, status] of [
      ['CLAIM_NOT_NEEDED', 409],
      ['CLAIM_DUPLICATE', 409],
      ['CLAIM_LIMIT_REACHED', 409],
      ['HOST_ACCOUNT_SUSPENDED', 403],
      ['FORBIDDEN', 404],
      ['VEHICLE_FIELD_REQUIRED', 422],
    ] as const) {
      w.docs.outcome['claimPermitted'] = outcome;
      expect((await send(body())).status, outcome).toBe(status);
    }
    delete w.docs.outcome['claimPermitted'];
    expect((await send({ ...body(), dataBase64: SVG.toString('base64') })).json).toMatchObject({
      code: 'VEHICLE_DOCUMENT_INVALID',
    });
    expect((await send({ ...body(), plate: 'AB/123' })).status).toBe(400);
    expect((await send(body(), {})).status).toBe(401);
    expect((await w.app.api.request('POST', path, textBody(w.a))).status).toBe(415);
    w.down.store = true;
    expect((await send(body())).status).toBe(503);
    w.down.store = false;

    w.docs.claimsList = [
      {
        claimId: randomUUID(),
        plate: 'AB123',
        status: 'OPEN',
        dismissReason: null,
        createdAt: '2031-07-01T08:00:00.000Z',
        decidedAt: null,
      },
    ];
    const list = await w.app.api.request('GET', path, { headers: w.a });
    expect(list.status).toBe(200);
    expect(list.json).toMatchObject({ claims: [{ plate: 'AB123', status: 'OPEN' }] });
    expect((await w.app.api.request('GET', path)).status).toBe(401);
    expect(
      (await w.app.api.request('GET', `/host/accounts/${w.orgB}/vehicle-claims`, { headers: w.a }))
        .status,
    ).toBe(404);
    w.docs.failing = true;
    expect((await w.app.api.request('GET', path, { headers: w.a })).status).toBe(503);
    expect((await send(body())).status).toBe(503);
  });

  it('couverture : chaque statut déclaré pour les routes des pièces et de l’éligibilité est exercé', () => {
    const covered = coverageOf(...apps);
    expect(
      missingCoverage(contract, '/host/accounts/{orgId}', covered).filter(
        (d) =>
          d.includes(' /host/accounts/{orgId}/vehicle-') ||
          / \/host\/accounts\/\{orgId\}\/vehicles\/\{vehicleId\}\/(declaration|documents|eligibility) /.test(
            d,
          ),
      ),
    ).toEqual([]);
  });
});
