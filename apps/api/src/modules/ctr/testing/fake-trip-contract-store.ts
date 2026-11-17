/**
 * FAKE du magasin du contrat de location d'un trip (US-211 partie 211b) — TESTS SEULEMENT (exclu
 * de la compilation de production). Règles reprises d'ADR-143 (n° 7 et 9) et de 16 BKG-019, jamais
 * du code de production : lecture par le voyageur du trip ou le titulaire de son compte d'hôte,
 * toute autre personne ⇒ NOT_FOUND ; signature du voyageur seul, dernière version seulement,
 * trip BOOKED / CHECKIN_OPEN / START_WINDOW_EXPIRED, empreinte présentée = empreinte du document
 * (sinon rien n'est écrit), rejeu ⇒ la signature d'origine. Les vraies règles sont prouvées sur
 * PostgreSQL (`packages/db/test/l0/l0-us211-rental-contract.test.ts`).
 */
import { createHash, randomUUID } from 'node:crypto';
import type {
  ContractReadResult,
  ContractSignOutcome,
  TripContractStore,
} from '../internal/contract/trip-contract.store.js';
import { ContractStoreError } from '../internal/contract/trip-contract.store.js';

export interface FakeContractVersion {
  readonly terms: unknown;
  readonly derived: unknown;
  readonly body: unknown;
  readonly sha256: string;
  readonly renderer: string;
  readonly locale: string;
  readonly draft: boolean;
}

interface Doc extends FakeContractVersion {
  readonly id: string;
  readonly version: number;
  readonly generatedAt: Date;
  signature: { signatureId: string; signedAt: Date; sealSha256: string } | null;
}

interface Trip {
  readonly guest: string;
  readonly host: string;
  status: string;
  readonly docs: Doc[];
}

const hex = (b: Buffer): string => b.toString('hex');

export class FakeTripContractStore implements TripContractStore {
  readonly #trips = new Map<string, Trip>();
  /** Base indisponible : toute opération échoue (SQLSTATE fictif). */
  failing = false;
  /** Nombre de signatures écrites (preuve « rien n'est écrit »). */
  writes = 0;
  /** Identifiant de la dernière signature écrite (imprimé dans le PDF signé, non servi en JSON). */
  lastSignatureId: string | null = null;
  #clock = Date.parse('2034-03-02T12:00:00.000Z');

  addTrip(tripId: string, guestProof: string, hostProof: string, status = 'BOOKED'): void {
    this.#trips.set(tripId, { guest: guestProof, host: hostProof, status, docs: [] });
  }

  setStatus(tripId: string, status: string): void {
    const t = this.#trips.get(tripId);
    if (t !== undefined) t.status = status;
  }

  addVersion(tripId: string, v: FakeContractVersion): string {
    const t = this.#trips.get(tripId);
    if (t === undefined) throw new Error('trip inconnu du FAKE');
    const id = randomUUID();
    t.docs.push({
      ...v,
      id,
      version: t.docs.length + 1,
      generatedAt: new Date(this.#clock),
      signature: null,
    });
    return id;
  }

  /** Partie nominative pseudonymisée : le texte n'est plus rendu. */
  erase(tripId: string): void {
    const t = this.#trips.get(tripId);
    if (t === undefined) return;
    t.docs.forEach((d, i) => {
      t.docs[i] = { ...d, body: null };
    });
  }

  read(proof: Buffer, tripId: string, version: number | null): Promise<ContractReadResult> {
    if (this.failing) return Promise.reject(new ContractStoreError('lecture', '08006'));
    const t = this.#trips.get(tripId);
    const role =
      t === undefined
        ? null
        : hex(proof) === t.guest
          ? 'GUEST'
          : hex(proof) === t.host
            ? 'HOST'
            : null;
    if (t === undefined || role === null) return Promise.resolve({ outcome: 'NOT_FOUND' });
    const latest = t.docs.length;
    if (latest === 0) return Promise.resolve({ outcome: 'NOT_GENERATED' });
    if (version !== null && (version < 1 || version > latest)) {
      return Promise.resolve({ outcome: 'NOT_FOUND' });
    }
    const d = t.docs[(version ?? latest) - 1] as Doc;
    return Promise.resolve({
      outcome: 'OK',
      document: {
        viewerRole: role,
        documentId: d.id,
        version: d.version,
        latestVersion: latest,
        locale: d.locale,
        generatedAt: d.generatedAt,
        sha256: d.sha256,
        renderer: d.renderer,
        terms: d.terms,
        derived: d.derived,
        body: d.body,
        draft: d.draft,
        signature: d.signature,
      },
    });
  }

  sign(
    proof: Buffer,
    tripId: string,
    documentId: string,
    sha256: Buffer,
  ): Promise<ContractSignOutcome> {
    if (this.failing) return Promise.reject(new ContractStoreError('signature', '08006'));
    if (sha256.length !== 32) return Promise.resolve({ outcome: 'REQUEST_INVALID' });
    const t = this.#trips.get(tripId);
    if (t === undefined || hex(proof) !== t.guest) return Promise.resolve({ outcome: 'NOT_FOUND' });
    const d = t.docs.find((x) => x.id === documentId);
    if (d === undefined) return Promise.resolve({ outcome: 'NOT_FOUND' });
    if (d.signature !== null) return Promise.resolve({ outcome: 'ALREADY_SIGNED', ...d.signature });
    if (d.version !== t.docs.length) return Promise.resolve({ outcome: 'CONTRACT_SUPERSEDED' });
    if (!['BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED'].includes(t.status)) {
      return Promise.resolve({ outcome: 'NOT_SIGNABLE' });
    }
    if (hex(sha256) !== d.sha256) return Promise.resolve({ outcome: 'CONTRACT_HASH_MISMATCH' });
    const signatureId = randomUUID();
    const signedAt = new Date((this.#clock += 1000));
    const seal = createHash('sha256')
      .update(['ctr.seal/1', d.sha256, signatureId, 'GUEST', signedAt.toISOString()].join('|'))
      .digest('hex');
    d.signature = { signatureId, signedAt, sealSha256: seal };
    this.writes += 1;
    this.lastSignatureId = signatureId;
    return Promise.resolve({ outcome: 'SIGNED', ...d.signature });
  }
}
