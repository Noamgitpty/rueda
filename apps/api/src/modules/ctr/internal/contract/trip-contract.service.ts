/**
 * Service du contrat de location d'un trip pour ses parties (US-211 partie 211b, ADR-149 ; 16
 * BKG-018, BKG-019 ; 10b S09, A03, UX-51). Lit une version (port `TripContractStore`), en tire :
 *   - un RÉSUMÉ (faits non nominatifs du document : période, véhicule, prix, protection, caution,
 *     distance, annulation, retard) que l'écran affiche en tête (UX-51) ;
 *   - l'ÉQUIVALENT HTML du PDF : le texte figé, bloc de signature rempli comme le PDF l'imprime,
 *     découpé en partie espagnole (fait foi) et traduction de courtoisie ;
 *   - le PDF lui-même, rendu de nouveau à chaque demande (aucun fichier stocké, ADR-143 n° 5) et
 *     servi seulement si le texte figé redonne l'empreinte enregistrée (sinon rien : fail-closed).
 * La signature passe l'empreinte que l'écran a présentée au voyageur ; la base la compare à celle
 * du document (`CONTRACT_HASH_MISMATCH`, rien n'est écrit). Journaux : issue et code seulement,
 * jamais un nom, une plaque, un montant ni un identifiant.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CountryConfigService } from '../../../cfg/index.js';
import type { ContractLine } from './pdf.js';
import {
  ContractInputError,
  contractFooter,
  contractSha256,
  fillSignatureBlock,
  parseContractBody,
  parseContractDerived,
  parseContractTerms,
  renderContractPdf,
} from './rental-contract.js';
import type { ContractSignatureBlock } from './rental-contract.js';
import { ContractHttpError } from './errors.js';
import type { ContractDocumentRow, TripContractStore } from './trip-contract.store.js';
import { ContractStoreError } from './trip-contract.store.js';
import { CTR_CONTRACT_STORE } from '../tokens.js';

export interface ContractLineView {
  readonly style: ContractLine['s'];
  readonly text: string;
}

/** Partie du texte : espagnol (fait foi) ou traduction de courtoisie. */
export interface ContractPartView {
  readonly lang: string;
  readonly authoritative: boolean;
  readonly lines: readonly ContractLineView[];
}

export interface TripContractView {
  readonly tripId: string;
  readonly viewerRole: 'GUEST' | 'HOST';
  readonly documentId: string;
  readonly version: number;
  readonly latestVersion: number;
  readonly courtesyLocale: string;
  readonly generatedAt: string;
  readonly sha256: string;
  readonly renderer: string;
  readonly draft: boolean;
  readonly summary: Record<string, unknown>;
  /** `null` : partie nominative pseudonymisée (le texte n'est plus servi). */
  readonly parts: readonly ContractPartView[] | null;
  readonly signature: { readonly signedAt: string; readonly sealSha256: string } | null;
  /** Le voyageur peut signer cette version (dernière, non signée) ; la base juge le trip. */
  readonly signable: boolean;
}

export interface ContractPdf {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly sha256: string;
  readonly signed: boolean;
}

export interface SignedView {
  readonly outcome: 'SIGNED' | 'ALREADY_SIGNED';
  readonly signedAt: string;
  readonly sealSha256: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Partie espagnole, puis traduction de courtoisie (à partir de sa note, avant son titre). */
function partsOf(lines: readonly ContractLine[], courtesy: string): ContractPartView[] {
  const view = (l: ContractLine): ContractLineView => ({ style: l.s, text: l.t });
  const second = lines.findIndex((l, i) => i > 0 && l.s === 'title');
  if (second < 1) return [{ lang: 'es', authoritative: true, lines: lines.map(view) }];
  const cut = second - 1;
  return [
    { lang: 'es', authoritative: true, lines: lines.slice(0, cut).map(view) },
    { lang: courtesy, authoritative: false, lines: lines.slice(cut).map(view) },
  ];
}

@Injectable()
export class TripContractService {
  readonly #logger = new Logger('TripContract');

  constructor(
    @Inject(CTR_CONTRACT_STORE) private readonly store: TripContractStore,
    @Inject(CountryConfigService) private readonly countries: CountryConfigService,
  ) {}

  async #document(
    proof: Buffer | null,
    tripId: string,
    version: number | null,
  ): Promise<ContractDocumentRow> {
    if (proof === null) throw new ContractHttpError('AUTH_REQUIRED');
    // identifiant mal formé ⇒ même 404 qu'un trip inconnu ou d'une autre personne (aucun oracle)
    if (!UUID.test(tripId)) throw new ContractHttpError('CONTRACT_NOT_FOUND');
    let read;
    try {
      read = await this.store.read(proof, tripId, version);
    } catch (error) {
      throw this.#unavailable('read', error);
    }
    if (read.outcome !== 'OK') {
      throw new ContractHttpError(
        read.outcome === 'NOT_GENERATED' ? 'CONTRACT_NOT_GENERATED' : 'CONTRACT_NOT_FOUND',
      );
    }
    return read.document;
  }

  #unavailable(operation: string, error: unknown): ContractHttpError {
    const sqlstate = error instanceof ContractStoreError ? (error.sqlstate ?? null) : null;
    this.#logger.error(
      JSON.stringify({ event: 'trip.contract', operation, outcome: 'UNAVAILABLE', sqlstate }),
    );
    return new ContractHttpError('CONTRACT_UNAVAILABLE');
  }

  #block(d: ContractDocumentRow): ContractSignatureBlock | undefined {
    return d.signature === null
      ? undefined
      : {
          signatureId: d.signature.signatureId,
          signedAt: d.signature.signedAt,
          documentSha256: d.sha256,
          sealSha256: d.signature.sealSha256,
        };
  }

  async view(proof: Buffer | null, tripId: string, version: number | null) {
    const d = await this.#document(proof, tripId, version);
    let terms;
    let derived;
    let body: ContractLine[] | null;
    try {
      terms = parseContractTerms(d.terms);
      derived = parseContractDerived(d.derived);
      body = d.body === null ? null : parseContractBody(d.body);
    } catch (error) {
      throw this.#unreadable('view', error);
    }
    const exponent = this.countries.config.currencies.find(
      (c) => c.code === terms.currency,
    )?.exponent;
    if (exponent === undefined) throw this.#unreadable('view', new Error('devise inconnue'));
    const c = derived.cancellation;
    const view: TripContractView = {
      tripId,
      viewerRole: d.viewerRole,
      documentId: d.documentId,
      version: d.version,
      latestVersion: d.latestVersion,
      courtesyLocale: d.locale,
      generatedAt: d.generatedAt.toISOString(),
      sha256: d.sha256,
      renderer: d.renderer,
      draft: d.draft,
      summary: {
        tripRef: terms.tripRef,
        country: terms.country,
        currency: terms.currency,
        currencyExponent: exponent,
        // fuseau du pays du trip : l'heure de la signature s'affiche à l'heure locale du contrat
        timezone: terms.timezone,
        startLocal: terms.startLocal,
        endLocal: terms.endLocal,
        vehicle: terms.vehicle,
        hostCapacity: terms.hostCapacity,
        priceTotalMinor: terms.priceTotalMinor,
        protection: {
          level: terms.protection.level,
          deductibleMinor: terms.protection.deductibleMinor,
          insurer: terms.protection.insurer,
        },
        depositMinor: terms.depositMinor,
        mileage: terms.mileage,
        lateGraceMinutes: terms.lateGraceMinutes,
        cancellation:
          c === null
            ? null
            : {
                freeUntilLocal: c.freeUntilLocal,
                penaltyDays: c.penaltyDays,
                retainedMinor: c.retainedMinor,
              },
      },
      parts: body === null ? null : partsOf(fillSignatureBlock(body, this.#block(d)), d.locale),
      signature:
        d.signature === null
          ? null
          : { signedAt: d.signature.signedAt.toISOString(), sealSha256: d.signature.sealSha256 },
      signable: d.viewerRole === 'GUEST' && d.version === d.latestVersion && d.signature === null,
    };
    return view;
  }

  #unreadable(operation: string, error: unknown): ContractHttpError {
    const reason = error instanceof ContractInputError ? 'SHAPE' : 'OTHER';
    this.#logger.error(
      JSON.stringify({ event: 'trip.contract', operation, outcome: 'UNREADABLE', reason }),
    );
    return new ContractHttpError('CONTRACT_UNAVAILABLE');
  }

  /**
   * PDF de la version : le contrat signé (bloc de signature rempli) s'il l'est, sinon le contrat à
   * signer. Le texte rendu sans signature doit redonner l'empreinte enregistrée, sinon rien n'est
   * servi (journal `INTEGRITY`, 503).
   */
  async pdf(proof: Buffer | null, tripId: string, version: number | null): Promise<ContractPdf> {
    const d = await this.#document(proof, tripId, version);
    if (d.body === null) throw new ContractHttpError('CONTRACT_TEXT_ERASED');
    let body: ContractLine[];
    let tripRef: string;
    try {
      body = parseContractBody(d.body);
      tripRef = parseContractTerms(d.terms).tripRef;
    } catch (error) {
      throw this.#unreadable('pdf', error);
    }
    const footer = contractFooter(tripRef, d.version);
    let unsigned: Uint8Array;
    try {
      unsigned = renderContractPdf(body, footer, d.renderer);
    } catch (error) {
      throw this.#unreadable('pdf', error);
    }
    if (contractSha256(unsigned) !== d.sha256) {
      this.#logger.error(
        JSON.stringify({ event: 'trip.contract', operation: 'pdf', outcome: 'INTEGRITY' }),
      );
      throw new ContractHttpError('CONTRACT_UNAVAILABLE');
    }
    const block = this.#block(d);
    const bytes =
      block === undefined ? unsigned : renderContractPdf(body, footer, d.renderer, block);
    const safeRef = tripRef.replace(/[^A-Za-z0-9-]/g, '');
    return {
      bytes,
      fileName: `contract-${safeRef}-v${d.version}${block === undefined ? '' : '-signed'}.pdf`,
      sha256: contractSha256(bytes),
      signed: block !== undefined,
    };
  }

  /** Signature du voyageur de la session (case cochée et empreinte présentée par l'écran). */
  async sign(proof: Buffer | null, tripId: string, body: unknown): Promise<SignedView> {
    if (proof === null) throw new ContractHttpError('AUTH_REQUIRED');
    if (!UUID.test(tripId)) throw new ContractHttpError('CONTRACT_NOT_FOUND');
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new ContractHttpError('REQUEST_INVALID');
    }
    const b = body as Record<string, unknown>;
    const keys = Object.keys(b).sort();
    if (
      keys.length !== 3 ||
      keys[0] !== 'accepted' ||
      keys[1] !== 'documentId' ||
      keys[2] !== 'sha256' ||
      b['accepted'] !== true ||
      typeof b['documentId'] !== 'string' ||
      !UUID.test(b['documentId']) ||
      typeof b['sha256'] !== 'string' ||
      !HEX64.test(b['sha256'])
    ) {
      throw new ContractHttpError('REQUEST_INVALID');
    }
    let r;
    try {
      r = await this.store.sign(proof, tripId, b['documentId'], Buffer.from(b['sha256'], 'hex'));
    } catch (error) {
      throw this.#unavailable('sign', error);
    }
    switch (r.outcome) {
      case 'SIGNED':
      case 'ALREADY_SIGNED':
        this.#logger.log(JSON.stringify({ event: 'trip.contract', outcome: r.outcome }));
        return {
          outcome: r.outcome,
          signedAt: r.signedAt.toISOString(),
          sealSha256: r.sealSha256,
        };
      case 'NOT_FOUND':
        throw new ContractHttpError('CONTRACT_NOT_FOUND');
      case 'CONTRACT_SUPERSEDED':
        throw new ContractHttpError('CONTRACT_SUPERSEDED');
      case 'NOT_SIGNABLE':
        throw new ContractHttpError('CONTRACT_NOT_SIGNABLE');
      case 'CONTRACT_HASH_MISMATCH':
        throw new ContractHttpError('CONTRACT_HASH_MISMATCH');
      case 'REQUEST_INVALID':
        throw new ContractHttpError('REQUEST_INVALID');
    }
  }
}
