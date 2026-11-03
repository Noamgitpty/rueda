/**
 * FAKE du port `EInvoicingProvider` (module FIN ; 17 §5 « Facture électronique », §10 ; FIN-003 ;
 * US-020). Simule un PAC (autorisation **synchrone**) et un service de type SIFEN (lot
 * **asynchrone** : `PENDING`, puis autorisation ou rejet au traitement). Les régimes et leur mode
 * sont une **donnée** fournie à la construction ; régime non configuré ⇒ `UNSUPPORTED_REGIME`.
 *
 * Contrôles du FAKE (ceux qu'un vrai service fait aussi, en plus simple) : montants `bigint` en
 * unités mineures, ≥ 0, Σ lignes = total et Σ taxes = taxe ⇒ sinon `INVALID_DOCUMENT` ; un numéro
 * déjà autorisé pour le même émetteur et le même régime, sous une autre clé ⇒ `DUPLICATE_NUMBER`.
 * Le code d'autorisation est dérivé de l'empreinte du document : déterministe.
 *
 * Cas difficiles : scénario `submit` / `status` (panne, délai, issue inconnue, refus, doublon) et
 * scénario `process` appliqué à chaque document asynchrone (`REFUSE` ⇒ `REJECTED` avec le motif ;
 * `UNAVAILABLE` ⇒ reste `PENDING` jusqu'au traitement suivant).
 */
import { assertFakeAllowed } from '../guard.ts';
import type { EnvironmentVariables } from '../guard.ts';
import type { FakeClock } from '../core/clock.ts';
import type { Outcome } from '../core/outcome.ts';
import { FakeRuntime, fingerprint, Sequence } from '../core/runtime.ts';

export interface FiscalDocumentLine {
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceMinor: bigint;
  readonly taxMinor: bigint;
  readonly totalMinor: bigint;
}

export interface SubmitFiscalDocumentRequest {
  readonly idempotencyKey: string;
  /** Régime de facturation tiré de la configuration (entité juridique du pays). */
  readonly regime: string;
  readonly issuerTaxId: string;
  readonly receiverTaxId: string | null;
  readonly number: string;
  readonly issuedAt: Date;
  /** Devise ISO 4217 tirée de la configuration pays. */
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

export type EInvoicingRefusal =
  'UNSUPPORTED_REGIME' | 'INVALID_DOCUMENT' | 'DUPLICATE_NUMBER' | 'REJECTED' | 'UNKNOWN_DOCUMENT';

export interface FakeRegime {
  readonly regime: string;
  readonly mode: 'SYNC' | 'ASYNC';
}

export interface FakeEInvoicingProviderOptions {
  readonly clock: FakeClock;
  readonly regimes: readonly FakeRegime[];
  readonly env?: EnvironmentVariables;
}

type EInvoicingOp = 'submit' | 'status' | 'process';

interface Stored {
  receipt: FiscalReceipt;
  readonly regime: string;
  readonly print: string;
  /** Nombre de transmissions au service fiscal (2 en cas de doublon). */
  transmissions: number;
}

export class FakeEInvoicingProvider {
  readonly runtime: FakeRuntime<EInvoicingOp, EInvoicingRefusal>;
  readonly #regimes: ReadonlyMap<string, FakeRegime>;
  readonly #documents = new Map<string, Stored>();
  readonly #numbers = new Map<string, string>();
  readonly #refs = new Sequence('fk_fdoc');

  constructor(options: FakeEInvoicingProviderOptions) {
    assertFakeAllowed('FakeEInvoicingProvider', options.env);
    this.#regimes = new Map(options.regimes.map((r) => [r.regime, r]));
    this.runtime = new FakeRuntime(options.clock);
  }

  supportsRegime(regime: string): boolean {
    return this.#regimes.has(regime);
  }

  async submit(
    request: SubmitFiscalDocumentRequest,
  ): Promise<
    Outcome<
      FiscalReceipt,
      'UNSUPPORTED_REGIME' | 'INVALID_DOCUMENT' | 'DUPLICATE_NUMBER' | 'REJECTED'
    >
  > {
    return this.runtime.execute(
      'submit',
      { idempotencyKey: request.idempotencyKey, content: request },
      (times) => {
        const regime = this.#regimes.get(request.regime);
        if (regime === undefined) return { ok: false, reason: 'UNSUPPORTED_REGIME' as const };
        if (!isConsistent(request)) return { ok: false, reason: 'INVALID_DOCUMENT' as const };
        const numberKey = `${request.regime}\u0000${request.issuerTaxId}\u0000${request.number}`;
        if (this.#numbers.has(numberKey)) return { ok: false, reason: 'DUPLICATE_NUMBER' as const };
        const providerRef = this.#refs.next();
        const print = fingerprint({ ...request, idempotencyKey: undefined });
        const receipt: FiscalReceipt =
          regime.mode === 'SYNC'
            ? {
                providerRef,
                status: 'AUTHORIZED',
                authorizationCode: code(print),
                rejectionCode: null,
              }
            : { providerRef, status: 'PENDING', authorizationCode: null, rejectionCode: null };
        this.#numbers.set(numberKey, providerRef);
        this.#documents.set(providerRef, {
          receipt,
          regime: request.regime,
          print,
          transmissions: times,
        });
        return { ok: true, value: receipt };
      },
    );
  }

  async getStatus(providerRef: string): Promise<Outcome<FiscalReceipt, 'UNKNOWN_DOCUMENT'>> {
    return this.runtime.execute('status', { content: providerRef }, () => {
      const stored = this.#documents.get(providerRef);
      return stored === undefined
        ? { ok: false, reason: 'UNKNOWN_DOCUMENT' as const }
        : { ok: true, value: stored.receipt };
    });
  }

  // --- Pilotage par le test -------------------------------------------------------------------

  /** Traite le lot asynchrone : chaque document `PENDING` suit le scénario `process`. */
  process(): FiscalReceipt[] {
    const changed: FiscalReceipt[] = [];
    for (const stored of this.#documents.values()) {
      if (stored.receipt.status !== 'PENDING') continue;
      const step = this.runtime.script.next('process');
      if (step.kind === 'UNAVAILABLE' || step.kind === 'TIMEOUT_BEFORE') continue;
      stored.receipt =
        step.kind === 'REFUSE'
          ? { ...stored.receipt, status: 'REJECTED', rejectionCode: step.reason }
          : { ...stored.receipt, status: 'AUTHORIZED', authorizationCode: code(stored.print) };
      changed.push(stored.receipt);
    }
    return changed;
  }

  /** Transmissions au service fiscal pour un document (2 = doublon côté fournisseur). */
  transmissions(providerRef: string): number {
    return this.#documents.get(providerRef)?.transmissions ?? 0;
  }
}

function isConsistent(r: SubmitFiscalDocumentRequest): boolean {
  if (r.lines.length === 0 || r.totalMinor < 0n || r.taxMinor < 0n) return false;
  let total = 0n;
  let tax = 0n;
  for (const line of r.lines) {
    if (line.totalMinor < 0n || line.taxMinor < 0n || line.unitPriceMinor < 0n) return false;
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) return false;
    total += line.totalMinor;
    tax += line.taxMinor;
  }
  return total === r.totalMinor && tax === r.taxMinor;
}

const code = (print: string): string => `FAKE-${print.slice(0, 40).toUpperCase()}`;
