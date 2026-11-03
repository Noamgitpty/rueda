/**
 * Port `EInvoicingProvider` du module FIN (17 §5 « Facture électronique », « SIFEN », §10 ;
 * FIN-003 ; US-020, ADR-058).
 *
 * Soumission idempotente d'un document fiscal (facture du trip fee) à un PAC (autorisation
 * synchrone) ou à un service de type SIFEN (lot asynchrone : `PENDING` puis `AUTHORIZED` /
 * `REJECTED`, lu par `getStatus`). Le régime vient de l'entité juridique du pays (CFG) ; régime non
 * pris en charge ⇒ `UNSUPPORTED_REGIME` (capacité inconnue = « non »). Montants `bigint` en
 * unités mineures (CLAUDE.md contrainte 4). `TIMEOUT` = issue inconnue : rejouer la même clé.
 *
 * Adaptateurs : FAKE `@rueda/fake-adapters/e-invoicing` ; connecteurs réels au lot C (FIN-020).
 * Émission réelle hors plateforme en bêta (FIN-002 MANUEL).
 */
export type EInvoicingOutcome<T, R extends string> =
  | { readonly status: 'OK'; readonly value: T; readonly replayed: boolean }
  | { readonly status: 'REFUSED'; readonly reason: R | 'IDEMPOTENCY_CONFLICT' | 'UNSUPPORTED' }
  | { readonly status: 'UNAVAILABLE' }
  | { readonly status: 'TIMEOUT' };

export interface FiscalDocumentLine {
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceMinor: bigint;
  readonly taxMinor: bigint;
  readonly totalMinor: bigint;
}

export interface SubmitFiscalDocumentRequest {
  readonly idempotencyKey: string;
  readonly regime: string;
  readonly issuerTaxId: string;
  readonly receiverTaxId: string | null;
  readonly number: string;
  readonly issuedAt: Date;
  readonly currency: string;
  readonly totalMinor: bigint;
  readonly taxMinor: bigint;
  readonly lines: readonly FiscalDocumentLine[];
}

export type FiscalStatus = 'PENDING' | 'AUTHORIZED' | 'REJECTED';

export interface FiscalReceipt {
  readonly providerRef: string;
  readonly status: FiscalStatus;
  readonly authorizationCode: string | null;
  readonly rejectionCode: string | null;
}

export interface EInvoicingProvider {
  readonly supportsRegime: (regime: string) => boolean;
  readonly submit: (
    request: SubmitFiscalDocumentRequest,
  ) => Promise<
    EInvoicingOutcome<
      FiscalReceipt,
      'UNSUPPORTED_REGIME' | 'INVALID_DOCUMENT' | 'DUPLICATE_NUMBER' | 'REJECTED'
    >
  >;
  readonly getStatus: (
    providerRef: string,
  ) => Promise<EInvoicingOutcome<FiscalReceipt, 'UNKNOWN_DOCUMENT'>>;
}
