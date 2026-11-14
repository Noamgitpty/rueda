/**
 * US-045 — résilience du dépôt des pièces du véhicule et des contestations
 * (`VehicleDocumentsService.addDocument` / `openClaim`) face à l'antivirus `FAKE` HOSTILE : le
 * vrai `FakeUploadScanner` et le vrai `InMemoryFileStore` de `@rueda/fake-adapters/files` (et non
 * l'antivirus fait main du test de contrat).
 *
 * Ce qui est prouvé (17 §5 « Antivirus et contrôle des téléversements » : quarantaine avant usage ;
 * ADR-032 et 17 §6.5 point 5 : FAKE hostile ; ADR-107 / service : « rien n'est déposé tant qu'un
 * pas n'est pas franchi », seul `CLEAN` du type réel libère, panne ou délai ⇒ 503 ;
 * DEC-FONDATEUR-20 ; US-045) :
 * - panne (`UNAVAILABLE`) ou délai dépassé (`TIMEOUT_BEFORE`, `TIMEOUT_AFTER`) de l'analyse ⇒
 *   `VEHICLE_DOCUMENT_UNAVAILABLE` ; verdict `INFECTED` (`REFUSE` scripté, ou marqueur
 *   `FAKE-MALWARE-SIGNATURE`) ⇒ `VEHICLE_DOCUMENT_INVALID` ;
 * - dans tous ces cas, la pièce n'est ni chiffrée, ni déposée, ni enregistrée ;
 * - le même envoi (même `requestId`) rejoué après la reprise de l'antivirus est déposé exactement
 *   une fois, chiffré (le clair n'est pas dans le stockage) ;
 * - antivirus lent (`DELAY`, horloge virtuelle), réponse en double (`DUPLICATE`), panne prolongée
 *   (`setDefault`) : jamais plus d'un dépôt.
 *
 * Données fictives ; aucune donnée propre à un pays (la pièce ne dépend pas du pays au niveau du
 * service). Aucune attente réelle.
 */
import { describe, expect, it } from 'vitest';
import { FakeUploadScanner, InMemoryFileStore } from '@rueda/fake-adapters/files';
import { FakeHostListingStore } from '../../testing/fake-host-listing-store.js';
import { FakeVehicleDocumentStore } from '../../testing/fake-vehicle-document-store.js';
import type { DocumentFileStore, DocumentPipeline, DocumentVault } from './ports.js';
import { VehicleDocumentsService } from './vehicle-documents.service.js';

const env = { RUEDA_ENV: 'test' };
const proof = Buffer.alloc(32, 9);
const ORG = 'org-a';
const VEHICLE = 'veh-a';
const USER = 'user-a';
const MARKER = 'FAKE-MALWARE-SIGNATURE';
const PDF = Buffer.from('%PDF-1.7\n% titre fictif de test\n', 'latin1');
const INFECTED_PDF = Buffer.from(`%PDF-1.7\n% ${MARKER}\n`, 'latin1');

function world() {
  const docs = new FakeVehicleDocumentStore();
  const accounts = new FakeHostListingStore();
  const scanner = new FakeUploadScanner({ env });
  const memory = new InMemoryFileStore({ env });
  const trace = { sealed: 0 };
  // coffre de test : « chiffrement » réversible, compté (le dépôt ne doit jamais l'atteindre
  // avant un verdict sain)
  const vault: DocumentVault = {
    prepare: () => Promise.resolve('READY'),
    seal: (_tx, _user, _file, body) => {
      trace.sealed += 1;
      return Promise.resolve({ status: 'SEALED', body: Buffer.from(body).reverse() });
    },
    open: (_user, _file, body) =>
      Promise.resolve({ status: 'OPENED', body: Buffer.from(body).reverse() }),
  };
  // le vrai stockage FAKE (création seule), vu sous la forme du port des pièces
  const files: DocumentFileStore = {
    put: (bucket, key, body) => memory.put(bucket, key, body),
    get: async (bucket, key) => {
      const r = await memory.get(bucket, key);
      return r.status === 'NOT_FOUND' ? { status: 'MISSING' } : r;
    },
  };
  const pipeline: DocumentPipeline = { scanner, vault, files };
  const svc = new VehicleDocumentsService(docs, accounts, pipeline);
  const key = (requestId: string) => `vehicle-documents/${ORG}/${VEHICLE}/${requestId}`;
  const nothingStored = (requestId: string) => {
    expect(docs.deposited).toEqual([]);
    expect(trace.sealed).toBe(0);
    expect(memory.raw('DOCUMENTS', key(requestId))).toBeUndefined();
  };
  const exactlyOne = (requestId: string, content: Buffer) => {
    expect(docs.deposited.map((d) => d.key)).toEqual([key(requestId)]);
    expect(trace.sealed).toBe(1);
    const stored = memory.raw('DOCUMENTS', key(requestId));
    expect(stored).toBeDefined();
    // chiffré : le clair n'est pas dans le stockage, et il se relit à l'identique
    expect(stored?.equals(content)).toBe(false);
    expect(
      Buffer.from(stored ?? Buffer.alloc(0))
        .reverse()
        .equals(content),
    ).toBe(true);
  };
  const upload = (requestId: string, content: Buffer) =>
    svc.addDocument(proof, USER, ORG, VEHICLE, {
      requestId,
      type: 'TITLE',
      validUntil: '2030-01-31',
      dataBase64: content.toString('base64'),
    });
  return { docs, scanner, memory, trace, svc, key, nothingStored, exactlyOne, upload };
}

let seq = 0;
const newRequestId = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
};

describe('antivirus hostile : pièce du véhicule fail-closed, puis un seul dépôt à la reprise (US-045)', () => {
  it.each([
    { kind: 'UNAVAILABLE' },
    { kind: 'TIMEOUT_BEFORE' },
    { kind: 'TIMEOUT_AFTER' },
  ] as const)(
    'analyse non aboutie ($kind) : VEHICLE_DOCUMENT_UNAVAILABLE, rien de chiffré ni déposé ; même requestId après reprise ⇒ un dépôt',
    async (step) => {
      const w = world();
      const requestId = newRequestId();
      w.scanner.script.script('scan', step);
      await expect(w.upload(requestId, PDF)).rejects.toMatchObject({
        code: 'VEHICLE_DOCUMENT_UNAVAILABLE',
      });
      w.nothingStored(requestId);
      const r = await w.upload(requestId, PDF);
      expect(r).toEqual({ code: 'VEHICLE_DOCUMENT_ADDED', documentId: requestId });
      w.exactlyOne(requestId, PDF);
      expect(w.scanner.script.calls('scan')).toBe(2);
    },
  );

  it('verdict INFECTED scripté (REFUSE) : VEHICLE_DOCUMENT_INVALID, rien de chiffré ni déposé ; reprise ⇒ un dépôt', async () => {
    const w = world();
    const requestId = newRequestId();
    w.scanner.script.script('scan', { kind: 'REFUSE', reason: 'Fake.Test.Signature' });
    await expect(w.upload(requestId, PDF)).rejects.toMatchObject({
      code: 'VEHICLE_DOCUMENT_INVALID',
    });
    w.nothingStored(requestId);
    await w.upload(requestId, PDF);
    w.exactlyOne(requestId, PDF);
  });

  it('marqueur FAKE-MALWARE-SIGNATURE : refusé à chaque rejeu, jamais déposé ; une pièce saine passe ensuite une fois', async () => {
    const w = world();
    const infected = newRequestId();
    for (let i = 0; i < 3; i += 1) {
      await expect(w.upload(infected, INFECTED_PDF)).rejects.toMatchObject({
        code: 'VEHICLE_DOCUMENT_INVALID',
      });
    }
    w.nothingStored(infected);
    const clean = newRequestId();
    await w.upload(clean, PDF);
    w.exactlyOne(clean, PDF);
  });

  it('panne prolongée (setDefault UNAVAILABLE) : quinze rejeux refusés, rien de déposé ; reprise ⇒ un dépôt', async () => {
    const w = world();
    const requestId = newRequestId();
    w.scanner.script.setDefault('scan', { kind: 'UNAVAILABLE' });
    for (let i = 0; i < 15; i += 1) {
      await expect(w.upload(requestId, PDF)).rejects.toMatchObject({
        code: 'VEHICLE_DOCUMENT_UNAVAILABLE',
      });
    }
    w.nothingStored(requestId);
    expect(w.scanner.script.calls('scan')).toBe(15);
    w.scanner.script.setDefault('scan', { kind: 'OK' });
    await w.upload(requestId, PDF);
    w.exactlyOne(requestId, PDF);
  });

  it('antivirus lent (DELAY, horloge virtuelle) : pièce saine déposée une fois ; pièce infectée toujours refusée', async () => {
    const w = world();
    const before = w.scanner.clock.nowMs();
    w.scanner.script.script('scan', { kind: 'DELAY', ms: 60_000 }, { kind: 'DELAY', ms: 60_000 });
    const infected = newRequestId();
    await expect(w.upload(infected, INFECTED_PDF)).rejects.toMatchObject({
      code: 'VEHICLE_DOCUMENT_INVALID',
    });
    w.nothingStored(infected);
    const requestId = newRequestId();
    await w.upload(requestId, PDF);
    expect(w.scanner.clock.nowMs() - before).toBe(120_000);
    w.exactlyOne(requestId, PDF);
  });

  it('réponse en double de l’antivirus (DUPLICATE) : un seul dépôt', async () => {
    const w = world();
    const requestId = newRequestId();
    w.scanner.script.script('scan', { kind: 'DUPLICATE' });
    await w.upload(requestId, PDF);
    w.exactlyOne(requestId, PDF);
  });
});

describe('antivirus hostile : contestation (« ce véhicule est à moi ») fail-closed (US-045)', () => {
  it('panne puis INFECTED puis reprise : refusée deux fois sans rien déposer, puis une seule contestation', async () => {
    const w = world();
    const requestId = newRequestId();
    const claimKey = `vehicle-documents/${ORG}/${requestId}/${requestId}`;
    const claim = (content: Buffer) =>
      w.svc.openClaim(proof, USER, ORG, {
        requestId,
        plate: 'AB 123',
        dataBase64: content.toString('base64'),
      });
    w.scanner.script.script(
      'scan',
      { kind: 'UNAVAILABLE' },
      { kind: 'REFUSE', reason: 'Fake.Test.Signature' },
    );
    await expect(claim(PDF)).rejects.toMatchObject({ code: 'VEHICLE_DOCUMENT_UNAVAILABLE' });
    await expect(claim(PDF)).rejects.toMatchObject({ code: 'VEHICLE_DOCUMENT_INVALID' });
    expect(w.docs.deposited).toEqual([]);
    expect(w.trace.sealed).toBe(0);
    expect(w.memory.raw('DOCUMENTS', claimKey)).toBeUndefined();
    expect(await claim(PDF)).toEqual({ code: 'VEHICLE_CLAIM_OPENED', claimId: requestId });
    expect(w.docs.deposited.map((d) => [d.key, d.type])).toEqual([[claimKey, 'CLAIM']]);
    expect(w.trace.sealed).toBe(1);
  });
});
