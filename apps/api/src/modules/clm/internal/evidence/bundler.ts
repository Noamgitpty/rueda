/**
 * Travailleur du dossier de preuve (US-308, migration 0165, ADR-184 ; 16 CLM-034 « génération
 * asynchrone » ; pré-mortem L3-PM-04 « empreinte calculée par le serveur sur les octets stockés,
 * recalculée à l'export ; tout écart d'empreinte = constat »).
 *
 * Nom de travailleur `evidence_verifier` (le seul qui lit les clés de sujet et le registre des
 * fichiers, 0021 / 0057). Un dossier par transaction :
 *   1. `core.claim_worker_evidence_source` : dossier REQUESTED verrouillé (SKIP LOCKED), texte exact
 *      du manifeste scellé, demandeur, texte figé des versions du contrat ;
 *   2. scellé contrôlé (SHA-256 du texte = `manifest_sha256`) ;
 *   3. chaque fichier du manifeste : photo relue, déchiffrée, empreinte recalculée
 *      (`readFileAsset`) et comparée au manifeste ; contrat rendu de nouveau par le port
 *      `EvidenceContractRenderer` (PDF déterministe de CTR) et comparé à l'empreinte enregistrée ;
 *   4. au moindre écart, objet absent, clé détruite ou rendu impossible : constat
 *      (`core.claim_worker_fail_evidence_bundle`, codes et identifiants seulement) ;
 *   5. sinon archive ZIP (manifeste à l'octet, puis les fichiers), chiffrée par la clé USER du
 *      demandeur, déposée en CRÉATION SEULE, puis `core.claim_worker_complete_evidence_bundle`.
 * Une panne passagère (stockage, base) annule la transaction : le dossier reste REQUESTED et sera
 * repris. Journaux : comptes et codes, jamais un identifiant, un nom ni un contenu (17 §6.3).
 */
import { randomUUID } from 'node:crypto';
import type { SqlClient, WorkerTransactions } from '../../../bus/index.js';
import { ManifestError, parseManifest, sha256Hex } from './manifest.js';
import type { EvidenceManifest } from './manifest.js';
import { buildZip } from './zip.js';
import type { ZipEntry } from './zip.js';

export const EVIDENCE_WORKER = 'evidence_verifier';

/** Plafond de l'archive en bêta (PROPOSÉ) : 40 photos de 500 ko et les contrats tiennent large. */
export const EVIDENCE_ZIP_MAX_BYTES = 64 * 1024 * 1024;

/** Version figée du contrat, telle que la base la rend au travailleur. */
export interface EvidenceContractSource {
  readonly version: number;
  readonly documentId: string;
  readonly renderer: string;
  /** SHA-256 enregistré du PDF présenté au voyageur (hexadécimal). */
  readonly sha256: string;
  readonly terms: unknown;
  readonly body: unknown;
}

/** Rendu du PDF du contrat (CTR) à l'identique ; lève si le texte figé est illisible. */
export interface EvidenceContractRenderer {
  render(source: EvidenceContractSource): Uint8Array;
}

/**
 * Lecture vérifiée d'un fichier de preuve (forme de `readFileAsset` de `@rueda/db/audit` : relecture,
 * déchiffrement par la clé du sujet, empreinte recalculée égale à `file_asset.sha256`). Une panne
 * passagère (stockage, KMS) LÈVE : pas un verdict sur la preuve.
 */
export type EvidenceFileRead =
  | { readonly status: 'MATCH'; readonly content: Buffer }
  | { readonly status: 'MISMATCH' }
  | { readonly status: 'UNKNOWN_FILE' }
  | {
      readonly status: 'UNREADABLE';
      readonly reason: 'DECRYPT_FAILED' | 'KEY_DESTROYED' | 'KEY_WITHHELD' | 'OBJECT_MISSING';
    };

export interface EvidenceFileReader {
  read(tx: SqlClient, fileId: string): Promise<EvidenceFileRead>;
}

/** Chiffrement de l'archive par la clé USER du demandeur (enveloppe liée au fichier). */
export interface EvidenceArchiveSealer {
  seal(
    tx: SqlClient,
    requesterId: string,
    fileId: string,
    body: Buffer,
  ): Promise<
    | { readonly status: 'SEALED'; readonly body: Buffer }
    | { readonly status: 'KEY_UNAVAILABLE'; readonly reason: string }
  >;
}

/** Dépôt de l'archive en création seule (port `FileStore` d'AUD). */
export interface EvidenceArchiveStore {
  put(
    bucket: 'PRIVATE_EVIDENCE',
    key: string,
    body: Buffer,
  ): Promise<{ readonly status: 'STORED' | 'CONFLICT' | 'UNAVAILABLE' | 'TIMEOUT' }>;
}

/** Panne passagère : la transaction est annulée, le dossier reste dû. */
export class EvidenceTransientError extends Error {
  override readonly name = 'EvidenceTransientError';
}

export interface EvidenceBundlerOptions {
  readonly transactions: WorkerTransactions;
  readonly reader: EvidenceFileReader;
  readonly sealer: EvidenceArchiveSealer;
  readonly files: EvidenceArchiveStore;
  readonly renderer: EvidenceContractRenderer;
  readonly maxBytes?: number;
  /** Journal (une ligne JSON : comptes et codes) ; absent : rien n'est écrit. */
  readonly log?: (line: string) => void;
}

export type EvidenceGeneration = 'READY' | 'FAILED' | 'LOCKED' | 'NOT_DUE';

type FailureCode =
  'INTEGRITY_MISMATCH' | 'OBJECT_MISSING' | 'KEY_UNAVAILABLE' | 'RENDER_FAILED' | 'TOO_LARGE';

interface Finding {
  readonly piece: string;
  readonly ref: string;
  readonly reason: string;
}

/** Code du dossier : l'écart d'empreinte l'emporte, puis l'objet absent, la clé, le rendu. */
const ORDER: readonly FailureCode[] = [
  'INTEGRITY_MISMATCH',
  'OBJECT_MISSING',
  'KEY_UNAVAILABLE',
  'RENDER_FAILED',
  'TOO_LARGE',
];

const SOURCE_SQL = `SELECT outcome, manifest, manifest_sha256, requested_by::text AS requested_by, contracts,
       messages
  FROM core.claim_worker_evidence_source($1::uuid)`;
const DUE_SQL = 'SELECT bundle_id::text AS bundle_id FROM core.claim_worker_evidence_due($1)';
const COMPLETE_SQL =
  'SELECT core.claim_worker_complete_evidence_bundle($1::uuid, $2::uuid, $3, $4, $5::bigint) AS r';
const FAIL_SQL = 'SELECT core.claim_worker_fail_evidence_bundle($1::uuid, $2, $3::jsonb) AS r';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function contractsOf(raw: unknown): Map<string, EvidenceContractSource> {
  const out = new Map<string, EvidenceContractSource>();
  if (!Array.isArray(raw)) return out;
  for (const c of raw) {
    if (!isObject(c)) continue;
    const { version, documentId, renderer, sha256 } = c;
    if (
      typeof version === 'number' &&
      typeof documentId === 'string' &&
      typeof renderer === 'string' &&
      typeof sha256 === 'string'
    ) {
      out.set(documentId, {
        version,
        documentId,
        renderer,
        sha256,
        terms: c['terms'],
        body: c['body'],
      });
    }
  }
  return out;
}

export class EvidenceBundler {
  readonly #o: EvidenceBundlerOptions;

  constructor(options: EvidenceBundlerOptions) {
    this.#o = options;
  }

  /** Dossiers REQUESTED, chacun dans sa propre transaction ; rend les comptes par issue. */
  async runDue(limit = 5): Promise<Readonly<Record<EvidenceGeneration, number>>> {
    const ids = await this.#o.transactions.run(EVIDENCE_WORKER, async (tx) => {
      const { rows } = await tx.query<{ bundle_id: string }>(DUE_SQL, [limit]);
      return rows.map((r) => r.bundle_id);
    });
    const counts: Record<EvidenceGeneration, number> = {
      READY: 0,
      FAILED: 0,
      LOCKED: 0,
      NOT_DUE: 0,
    };
    for (const id of ids) {
      try {
        counts[await this.generate(id)] += 1;
      } catch {
        // panne passagère : transaction annulée, dossier repris au prochain passage
      }
    }
    this.#log({ outcome: 'RUN', ...counts, deferred: ids.length - sum(counts) });
    return counts;
  }

  /** Génère un dossier (une transaction). Panne passagère : exception, rien n'est écrit. */
  async generate(bundleId: string): Promise<EvidenceGeneration> {
    return this.#o.transactions.run(EVIDENCE_WORKER, (tx) => this.#generate(tx, bundleId));
  }

  async #generate(tx: SqlClient, bundleId: string): Promise<EvidenceGeneration> {
    const { rows } = await tx.query<{
      outcome: string;
      manifest: string | null;
      manifest_sha256: string | null;
      requested_by: string | null;
      contracts: unknown;
      messages: string | null;
    }>(SOURCE_SQL, [bundleId]);
    const src = rows[0];
    if (src?.outcome === 'LOCKED') return 'LOCKED';
    if (src?.outcome !== 'OK' || src.manifest === null || src.manifest_sha256 === null) {
      return 'NOT_DUE';
    }
    if (src.requested_by === null) return this.#fail(tx, bundleId, 'KEY_UNAVAILABLE', []);
    let manifest: EvidenceManifest;
    try {
      manifest = parseManifest(src.manifest, src.manifest_sha256);
    } catch (error) {
      if (!(error instanceof ManifestError)) throw error;
      return this.#fail(tx, bundleId, 'INTEGRITY_MISMATCH', [
        { piece: 'MANIFEST', ref: bundleId, reason: 'SEAL_MISMATCH' },
      ]);
    }
    if (manifest.bundleId !== bundleId) {
      return this.#fail(tx, bundleId, 'INTEGRITY_MISMATCH', [
        { piece: 'MANIFEST', ref: bundleId, reason: 'SEAL_MISMATCH' },
      ]);
    }
    const contracts = contractsOf(src.contracts);
    const findings: { code: FailureCode; finding: Finding }[] = [];
    for (const fileId of manifest.registryMismatch) {
      findings.push({
        code: 'INTEGRITY_MISMATCH',
        finding: { piece: 'PHOTO', ref: fileId, reason: 'REGISTRY_MISMATCH' },
      });
    }
    const entries: ZipEntry[] = [
      { path: 'manifest.json', data: Buffer.from(src.manifest, 'utf8') },
    ];
    let total = entries[0]!.data.length;
    const max = this.#o.maxBytes ?? EVIDENCE_ZIP_MAX_BYTES;
    for (const file of manifest.files) {
      const got = await this.#read(tx, file.kind, file.ref, contracts, src.messages);
      if ('code' in got) {
        findings.push({
          code: got.code,
          finding: { piece: file.kind, ref: file.ref, reason: got.reason },
        });
        continue;
      }
      if (sha256Hex(got.data) !== file.sha256) {
        findings.push({
          code: 'INTEGRITY_MISMATCH',
          finding: { piece: file.kind, ref: file.ref, reason: 'SHA256_MISMATCH' },
        });
        continue;
      }
      total += got.data.length;
      if (total > max) {
        return this.#fail(tx, bundleId, 'TOO_LARGE', [
          { piece: 'ARCHIVE', ref: bundleId, reason: 'TOO_LARGE' },
        ]);
      }
      entries.push({ path: file.path, data: got.data });
    }
    if (findings.length > 0) {
      const code = ORDER.find((c) => findings.some((f) => f.code === c)) ?? 'INTEGRITY_MISMATCH';
      return this.#fail(
        tx,
        bundleId,
        code,
        findings.map((f) => f.finding),
      );
    }
    const zip = buildZip(entries, manifest.sealedAt);
    const fileId = randomUUID();
    const storageKey = `evidence-bundles/${bundleId}/${fileId}.zip`;
    const closed = await this.#o.sealer.seal(tx, src.requested_by, fileId, zip);
    if (closed.status !== 'SEALED') {
      return this.#fail(tx, bundleId, 'KEY_UNAVAILABLE', [
        { piece: 'ARCHIVE', ref: bundleId, reason: closed.reason },
      ]);
    }
    const sealed = closed.body;
    const put = await this.#o.files.put('PRIVATE_EVIDENCE', storageKey, sealed);
    if (put.status !== 'STORED') {
      // panne ou issue inconnue : transaction annulée, nouvelle clé au prochain passage
      throw new EvidenceTransientError(
        `stockage indisponible (${put.status}) : archive non déposée`,
      );
    }
    const done = await tx.query<{ r: string }>(COMPLETE_SQL, [
      bundleId,
      fileId,
      storageKey,
      Buffer.from(sha256Hex(zip), 'hex'),
      zip.length,
    ]);
    const outcome = done.rows[0]?.r === 'READY' ? 'READY' : 'NOT_DUE';
    this.#log({ outcome, files: entries.length - 1 });
    return outcome;
  }

  async #read(
    tx: SqlClient,
    kind: 'PHOTO' | 'CONTRACT' | 'MESSAGES',
    ref: string,
    contracts: ReadonlyMap<string, EvidenceContractSource>,
    messages: string | null,
  ): Promise<{ readonly data: Buffer } | { readonly code: FailureCode; readonly reason: string }> {
    if (kind === 'MESSAGES') {
      // document du fil relu par la base (texte reçu et texte masqué) ; disparu (purge) : constat
      return messages === null
        ? { code: 'OBJECT_MISSING', reason: 'THREAD_UNAVAILABLE' }
        : { data: Buffer.from(messages, 'utf8') };
    }
    if (kind === 'CONTRACT') {
      const c = contracts.get(ref);
      if (c === undefined) return { code: 'RENDER_FAILED', reason: 'TEXT_UNAVAILABLE' };
      try {
        return { data: Buffer.from(this.#o.renderer.render(c)) };
      } catch {
        return { code: 'RENDER_FAILED', reason: 'RENDER_FAILED' };
      }
    }
    const read = await this.#o.reader.read(tx, ref);
    switch (read.status) {
      case 'MATCH':
        return { data: read.content };
      case 'MISMATCH':
        return { code: 'INTEGRITY_MISMATCH', reason: 'SHA256_MISMATCH' };
      case 'UNKNOWN_FILE':
        return { code: 'OBJECT_MISSING', reason: 'UNKNOWN_FILE' };
      case 'UNREADABLE':
        return read.reason === 'OBJECT_MISSING'
          ? { code: 'OBJECT_MISSING', reason: 'OBJECT_MISSING' }
          : read.reason === 'DECRYPT_FAILED'
            ? { code: 'INTEGRITY_MISMATCH', reason: 'DECRYPT_FAILED' }
            : { code: 'KEY_UNAVAILABLE', reason: read.reason };
    }
  }

  async #fail(
    tx: SqlClient,
    bundleId: string,
    code: FailureCode,
    findings: readonly Finding[],
  ): Promise<EvidenceGeneration> {
    const list =
      findings.length > 0
        ? findings.slice(0, 200)
        : [{ piece: 'ARCHIVE', ref: bundleId, reason: code }];
    const { rows } = await tx.query<{ r: string }>(FAIL_SQL, [
      bundleId,
      code,
      JSON.stringify(list),
    ]);
    const outcome = rows[0]?.r === 'FAILED' ? 'FAILED' : 'NOT_DUE';
    this.#log({ outcome, code, findings: list.length });
    return outcome;
  }

  #log(fields: Record<string, unknown>): void {
    this.#o.log?.(
      JSON.stringify({
        level: 'info',
        worker: EVIDENCE_WORKER,
        event: 'evidence.bundle',
        ...fields,
      }),
    );
  }
}

function sum(c: Readonly<Record<EvidenceGeneration, number>>): number {
  return c.READY + c.FAILED + c.LOCKED + c.NOT_DUE;
}
