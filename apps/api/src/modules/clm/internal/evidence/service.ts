/**
 * Service du dossier de preuve côté console (US-308, ADR-184 ; 16 CLM-034, bêta SIMPLIFIÉ :
 * « généré à la demande par l'ops » ; pré-mortem L3-PM-47).
 *
 *   - `request` : la base juge la session élevée, `evidence.export` et le dossier de support, scelle
 *     le manifeste et journalise ; dans la MÊME transaction, la clé USER du demandeur est préparée
 *     (elle chiffrera l'archive) : sans coffre, rien n'est demandé (503, fail-closed) ;
 *   - `status` : état pour le demandeur (EXPIRED calculé par la base) ;
 *   - `download` : la base juge et journalise l'ouverture, puis l'archive est lue, déchiffrée par la
 *     clé du demandeur et son SHA-256 recalculé : servie SEULEMENT si elle égale l'empreinte
 *     enregistrée ; sinon la transaction (journal compris) est annulée et rien n'est servi
 *     (`EVIDENCE_EXPORT_FAILED`).
 * Journaux : issue et code seulement, jamais un identifiant, un motif, un nom ni un contenu.
 */
import { createHash } from 'node:crypto';
import type { EvidenceExportFiles, EvidenceExportVault } from './ports.js';
import type {
  EvidenceBundleStore,
  EvidenceOpenOutcome,
  EvidenceRequestInput,
  EvidenceRequestOutcome,
  EvidenceStaff,
  EvidenceStatusOutcome,
} from './store.js';

export interface EvidenceArchive {
  readonly bytes: Buffer;
  readonly fileName: string;
  readonly sha256: string;
  readonly manifestSha256: string;
}

export type EvidenceDownloadOutcome =
  | { readonly outcome: 'OK'; readonly archive: EvidenceArchive }
  | {
      readonly outcome: Exclude<EvidenceOpenOutcome['outcome'], 'OK'> | 'INTEGRITY' | 'UNAVAILABLE';
    };

export interface EvidenceBundleServiceOptions {
  readonly store: EvidenceBundleStore;
  readonly vault: EvidenceExportVault;
  readonly files: EvidenceExportFiles;
  readonly log?: (line: string) => void;
}

export class EvidenceUnavailableError extends Error {
  override readonly name = 'EvidenceUnavailableError';
}

export class EvidenceBundleService {
  readonly #o: EvidenceBundleServiceOptions;

  constructor(options: EvidenceBundleServiceOptions) {
    this.#o = options;
  }

  async request(
    staff: EvidenceStaff,
    input: EvidenceRequestInput,
  ): Promise<EvidenceRequestOutcome> {
    return this.#o.store.transaction(staff, async (tx) => {
      const r = await this.#o.store.request(tx, staff, input);
      if (r.outcome !== 'REQUESTED') {
        // refus (journalisé par la base) ou rejeu : rien d'autre à écrire, le journal est validé
        this.#log('request', r.outcome);
        return { commit: true, value: r };
      }
      if ((await this.#o.vault.prepare(tx, staff.userId)) !== 'READY') {
        this.#log('request', 'UNAVAILABLE');
        throw new EvidenceUnavailableError('coffre indisponible : rien n’est demandé');
      }
      this.#log('request', r.outcome);
      return { commit: true, value: r };
    });
  }

  async status(
    staff: EvidenceStaff,
    requestId: string,
    bundleId: string,
  ): Promise<EvidenceStatusOutcome> {
    return this.#o.store.transaction(staff, async (tx) => ({
      commit: true,
      value: await this.#o.store.status(tx, staff, requestId, bundleId),
    }));
  }

  async download(
    staff: EvidenceStaff,
    requestId: string,
    bundleId: string,
    reason: string,
  ): Promise<EvidenceDownloadOutcome> {
    return this.#o.store.transaction<EvidenceDownloadOutcome>(staff, async (tx) => {
      const opened = await this.#o.store.open(tx, staff, requestId, bundleId, reason);
      if (opened.outcome !== 'OK') {
        this.#log('download', opened.outcome);
        // refus journalisés par la base : validés ; NOT_READY / FAILED : rien n'est écrit
        return { commit: true, value: { outcome: opened.outcome } };
      }
      const got = await this.#o.files.get('PRIVATE_EVIDENCE', opened.storageKey);
      if (got.status !== 'FOUND') {
        this.#log('download', got.status === 'NOT_FOUND' ? 'INTEGRITY' : 'UNAVAILABLE');
        // l'ouverture n'a pas eu lieu : son journal est annulé avec la transaction
        return {
          commit: false,
          value: { outcome: got.status === 'NOT_FOUND' ? 'INTEGRITY' : 'UNAVAILABLE' },
        };
      }
      const plain = await this.#o.vault.open(tx, staff.userId, opened.fileId, got.body);
      if (plain.status !== 'OPENED') {
        const outcome = plain.status === 'REJECTED' ? 'INTEGRITY' : 'UNAVAILABLE';
        this.#log('download', outcome);
        return { commit: false, value: { outcome } };
      }
      const sha256 = createHash('sha256').update(plain.body).digest('hex');
      if (sha256 !== opened.sha256 || plain.body.length !== opened.bytes) {
        this.#log('download', 'INTEGRITY');
        return { commit: false, value: { outcome: 'INTEGRITY' } };
      }
      this.#log('download', 'OK');
      return {
        commit: true,
        value: {
          outcome: 'OK',
          archive: {
            bytes: plain.body,
            fileName: `evidence-${opened.tripId}-${bundleId}.zip`,
            sha256,
            manifestSha256: opened.manifestSha256,
          },
        },
      };
    });
  }

  #log(operation: string, outcome: string): void {
    this.#o.log?.(JSON.stringify({ event: 'evidence.bundle', operation, outcome }));
  }
}
