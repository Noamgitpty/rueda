/**
 * Travailleur du dossier de preuve (US-308, ADR-184 ; pré-mortem L3-PM-04 : « empreinte calculée par
 * le serveur sur les octets stockés, recalculée à l'export ; tout écart d'empreinte = constat »).
 * Base simulée (réponses des commandes de 0165, prouvées par la preuve L0), stockage FAKE
 * (`InMemoryFileStore`), clé de sujet fixe ; empreintes attendues recalculées ici par
 * `node:crypto`, jamais tirées du code testé.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { InMemoryFileStore } from '@rueda/fake-adapters/files';
import { fileAad, open, seal } from '@rueda/db/audit';
import { describe, expect, it } from 'vitest';
import type { SqlClient, WorkerTransactions } from '../../../bus/index.js';
import { EvidenceBundler } from './bundler.js';
import type { EvidenceContractRenderer } from './bundler.js';
import { auditEvidenceAdapters } from '../../testing/audit-evidence-adapters.js';

const sha = (b: Buffer | string): string =>
  createHash('sha256')
    .update(typeof b === 'string' ? Buffer.from(b, 'utf8') : b)
    .digest('hex');

const DEK = randomBytes(32);
const keys = {
  dekFor: () => Promise.resolve({ status: 'OK' as const, dek: Buffer.from(DEK) }),
};

interface Photo {
  readonly id: string;
  readonly owner: string;
  readonly body: Buffer;
  readonly key: string;
}

interface World {
  readonly bundleId: string;
  readonly requester: string;
  readonly photos: Photo[];
  readonly store: InMemoryFileStore;
  readonly pdf: Buffer;
  messages: string | null;
  manifest: string;
  manifestSha: string;
  readonly completed: unknown[][];
  readonly failed: unknown[][];
}

async function world(): Promise<World> {
  const store = new InMemoryFileStore();
  const photos: Photo[] = [];
  for (let i = 0; i < 2; i++) {
    const p = {
      id: randomUUID(),
      owner: randomUUID(),
      body: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), randomBytes(256)]),
      key: `trips/${randomUUID()}.jpg`,
    };
    const sealed = seal(Buffer.from(DEK), p.body, fileAad(p.id, { type: 'USER', id: p.owner }));
    await store.put('PRIVATE_EVIDENCE', p.key, sealed);
    photos.push(p);
  }
  const bundleId = randomUUID();
  const contractId = randomUUID();
  const pdf = Buffer.from('%PDF-1.7\ncontrat\n', 'latin1');
  const threadId = randomUUID();
  const messages = JSON.stringify({ schema: 'clm.evidence.messages/1', threadId, messages: [] });
  const manifest = JSON.stringify({
    schema: 'clm.evidence/1',
    bundleId,
    sealedAt: '2035-07-01T09:00:00.000Z',
    inspections: [
      {
        kind: 'CHECKIN',
        side: 'GUEST',
        photos: photos.map((p) => ({ fileId: p.id, registryMismatch: false })),
      },
    ],
    files: [
      { path: 'contract/contract-v1.pdf', kind: 'CONTRACT', ref: contractId, sha256: sha(pdf) },
      { path: 'messages/messages.json', kind: 'MESSAGES', ref: threadId, sha256: sha(messages) },
      ...photos.map((p, i) => ({
        path: `photos/CHECKIN/GUEST/0${i + 1}-EXT_0${i + 1}-${p.id}.jpg`,
        kind: 'PHOTO',
        ref: p.id,
        sha256: sha(p.body),
      })),
    ],
  });
  return {
    bundleId,
    requester: randomUUID(),
    photos,
    store,
    pdf,
    messages,
    manifest,
    manifestSha: sha(manifest),
    completed: [],
    failed: [],
  };
}

/** Base simulée : réponses des commandes `core.claim_worker_*` et du registre des fichiers. */
function transactions(w: World, contracts: unknown[]): WorkerTransactions {
  const client: SqlClient = {
    query<R>(text: string, params: readonly unknown[] = []) {
      let rows: unknown[] = [];
      if (text.includes('claim_worker_evidence_due')) rows = [{ bundle_id: w.bundleId }];
      else if (text.includes('claim_worker_evidence_source')) {
        rows = [
          {
            outcome: 'OK',
            manifest: w.manifest,
            manifest_sha256: w.manifestSha,
            requested_by: w.requester,
            contracts,
            messages: w.messages,
          },
        ];
      } else if (text.includes('FROM core.audit_file_asset')) {
        const p = w.photos.find((x) => x.id === params[0]);
        rows =
          p === undefined
            ? []
            : [
                {
                  bucket: 'PRIVATE_EVIDENCE',
                  storage_key: p.key,
                  sha256: createHash('sha256').update(p.body).digest(),
                  enc_subject_type: 'USER',
                  enc_subject_id: p.owner,
                },
              ];
      } else if (text.includes('claim_worker_complete_evidence_bundle')) {
        w.completed.push([...params]);
        rows = [{ r: 'READY' }];
      } else if (text.includes('claim_worker_fail_evidence_bundle')) {
        w.failed.push([...params]);
        rows = [{ r: 'FAILED' }];
      }
      return Promise.resolve({ rows: rows as R[], rowCount: rows.length });
    },
  };
  return {
    run: (name, fn) => {
      expect(name).toBe('evidence_verifier');
      return fn(client);
    },
  };
}

const renderer = (pdf: Buffer): EvidenceContractRenderer => ({ render: () => pdf });

function contractsOf(w: World): unknown[] {
  const ref = JSON.parse(w.manifest).files[0].ref as string;
  return [
    { version: 1, documentId: ref, renderer: 'ctr.pdf/1', sha256: sha(w.pdf), terms: {}, body: [] },
  ];
}

describe('EvidenceBundler', () => {
  it('chaque fichier relu et recalculé égal au manifeste ⇒ archive (manifeste à l’octet, contrat, photos) chiffrée par la clé du demandeur, déposée en création seule, READY', async () => {
    const w = await world();
    const lines: string[] = [];
    const b = new EvidenceBundler({
      transactions: transactions(w, contractsOf(w)),
      ...auditEvidenceAdapters(w.store, keys),
      renderer: renderer(w.pdf),
      log: (l) => lines.push(l),
    });
    expect(await b.runDue()).toMatchObject({ READY: 1, FAILED: 0 });
    expect(w.failed).toEqual([]);
    const [bundleId, fileId, storageKey, zipSha, bytes] = w.completed[0] as [
      string,
      string,
      string,
      Buffer,
      number,
    ];
    expect(bundleId).toBe(w.bundleId);
    expect(storageKey).toBe(`evidence-bundles/${w.bundleId}/${fileId}.zip`);
    const stored = w.store.raw('PRIVATE_EVIDENCE', storageKey)!;
    const zip = open(Buffer.from(DEK), stored, fileAad(fileId, { type: 'USER', id: w.requester }));
    expect(zip.length).toBe(bytes);
    expect(sha(zip)).toBe(zipSha.toString('hex'));
    // le clair n'est jamais stocké ; l'archive porte le manifeste à l'octet et chaque fichier
    expect(stored.includes(Buffer.from(w.manifest))).toBe(false);
    expect(zip.includes(Buffer.from(w.manifest, 'utf8'))).toBe(true);
    expect(zip.includes(w.pdf)).toBe(true);
    expect(zip.includes(Buffer.from(w.messages!, 'utf8'))).toBe(true);
    for (const p of w.photos) expect(zip.includes(p.body)).toBe(true);
    // journaux : comptes et codes, jamais un identifiant
    for (const l of lines) {
      expect(l.includes(w.bundleId)).toBe(false);
      expect(l.includes(w.requester)).toBe(false);
    }
  });

  it('RT-L3-P04 : un octet changé dans le stockage ⇒ constat INTEGRITY_MISMATCH (photo, ref), rien n’est déposé', async () => {
    const w = await world();
    w.store.corrupt('PRIVATE_EVIDENCE', w.photos[1]!.key, 60);
    const b = new EvidenceBundler({
      transactions: transactions(w, contractsOf(w)),
      ...auditEvidenceAdapters(w.store, keys),
      renderer: renderer(w.pdf),
    });
    expect(await b.generate(w.bundleId)).toBe('FAILED');
    expect(w.completed).toEqual([]);
    const [, code, findings] = w.failed[0] as [string, string, string];
    expect(code).toBe('INTEGRITY_MISMATCH');
    expect(JSON.parse(findings)).toEqual([
      { piece: 'PHOTO', ref: w.photos[1]!.id, reason: 'DECRYPT_FAILED' },
    ]);
  });

  it('objet absent ⇒ OBJECT_MISSING ; contrat rendu différent ⇒ INTEGRITY_MISMATCH (CONTRACT) ; texte du contrat absent ⇒ RENDER_FAILED', async () => {
    const w = await world();
    w.store.lose('PRIVATE_EVIDENCE', w.photos[0]!.key);
    const missing = new EvidenceBundler({
      transactions: transactions(w, contractsOf(w)),
      ...auditEvidenceAdapters(w.store, keys),
      renderer: renderer(w.pdf),
    });
    expect(await missing.generate(w.bundleId)).toBe('FAILED');
    expect(w.failed[0]![1]).toBe('OBJECT_MISSING');

    const v = await world();
    const other = new EvidenceBundler({
      transactions: transactions(v, contractsOf(v)),
      ...auditEvidenceAdapters(v.store, keys),
      renderer: renderer(Buffer.from('%PDF-1.7\nautre\n')),
    });
    expect(await other.generate(v.bundleId)).toBe('FAILED');
    expect(v.failed[0]![1]).toBe('INTEGRITY_MISMATCH');
    expect(JSON.parse(v.failed[0]![2] as string)).toEqual([
      expect.objectContaining({ piece: 'CONTRACT', reason: 'SHA256_MISMATCH' }),
    ]);

    const t = await world();
    t.messages = null;
    const purged = new EvidenceBundler({
      transactions: transactions(t, contractsOf(t)),
      ...auditEvidenceAdapters(t.store, keys),
      renderer: renderer(t.pdf),
    });
    expect(await purged.generate(t.bundleId)).toBe('FAILED');
    expect(JSON.parse(t.failed[0]![2] as string)).toEqual([
      expect.objectContaining({ piece: 'MESSAGES', reason: 'THREAD_UNAVAILABLE' }),
    ]);

    const u = await world();
    const erased = new EvidenceBundler({
      transactions: transactions(u, []),
      ...auditEvidenceAdapters(u.store, keys),
      renderer: renderer(u.pdf),
    });
    expect(await erased.generate(u.bundleId)).toBe('FAILED');
    expect(u.failed[0]![1]).toBe('RENDER_FAILED');
  });

  it('scellé rompu (manifeste ≠ empreinte enregistrée) ⇒ INTEGRITY_MISMATCH (MANIFEST)', async () => {
    const w = await world();
    w.manifestSha = sha('autre');
    const b = new EvidenceBundler({
      transactions: transactions(w, contractsOf(w)),
      ...auditEvidenceAdapters(w.store, keys),
      renderer: renderer(w.pdf),
    });
    expect(await b.generate(w.bundleId)).toBe('FAILED');
    expect(JSON.parse(w.failed[0]![2] as string)).toEqual([
      { piece: 'MANIFEST', ref: w.bundleId, reason: 'SEAL_MISMATCH' },
    ]);
  });

  it('manifeste scellé mais de forme inattendue ⇒ MANIFEST_INVALID (distinct de SEAL_MISMATCH)', async () => {
    const w = await world();
    w.manifest = JSON.stringify({ schema: 'autre/1' });
    w.manifestSha = sha(w.manifest);
    const b = new EvidenceBundler({
      transactions: transactions(w, []),
      ...auditEvidenceAdapters(w.store, keys),
      renderer: renderer(w.pdf),
    });
    expect(await b.generate(w.bundleId)).toBe('FAILED');
    expect(JSON.parse(w.failed[0]![2] as string)).toEqual([
      { piece: 'MANIFEST', ref: w.bundleId, reason: 'MANIFEST_INVALID' },
    ]);
  });

  it('archive au-delà du plafond ⇒ TOO_LARGE ; stockage indisponible ⇒ panne passagère (exception, rien n’est écrit)', async () => {
    const w = await world();
    const small = new EvidenceBundler({
      transactions: transactions(w, contractsOf(w)),
      ...auditEvidenceAdapters(w.store, keys),
      renderer: renderer(w.pdf),
      maxBytes: 100,
    });
    expect(await small.generate(w.bundleId)).toBe('FAILED');
    expect(w.failed[0]![1]).toBe('TOO_LARGE');

    const v = await world();
    v.store.script.script('put', { kind: 'UNAVAILABLE' }, { kind: 'UNAVAILABLE' });
    const down = new EvidenceBundler({
      transactions: transactions(v, contractsOf(v)),
      ...auditEvidenceAdapters(v.store, keys),
      renderer: renderer(v.pdf),
    });
    await expect(down.generate(v.bundleId)).rejects.toThrow(/UNAVAILABLE/);
    expect(v.completed).toEqual([]);
    expect(v.failed).toEqual([]);
    expect(await down.runDue()).toMatchObject({ READY: 0, FAILED: 0 });
  });
});
