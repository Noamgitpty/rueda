/**
 * Doubles des demandes de réservation de l'hôte (US-223 partie 223c) — TESTS SEULEMENT (contrat
 * HTTP). Les règles (hôte titulaire, heure limite de la base, capture par jambes rattachée à
 * l'autorisation, VOID total, expiration) sont prouvées en base (`l0-us223-request`, migration
 * 0122) ; ces doubles rendent ce qu'on leur impose et retiennent ce que l'API leur transmet.
 */
import { assertMovingLegs, PaymentError } from '../../pay/index.js';
import type {
  CaptureRequest,
  OperationLookup,
  OperationResult,
  ProviderOperation,
} from '../../pay/index.js';
import type { RequestCaptureProvider } from '../internal/checkout/host-requests.service.js';
import type {
  AcceptResult,
  DeclineResult,
  HostRequestRow,
  HostRequestStore,
  RequestRefusal,
} from '../internal/checkout/host-requests-store.js';

export class FakeHostRequestStore implements HostRequestStore {
  /** Comptes titulaires par empreinte de session (hex). */
  accounts = new Map<string, Set<string>>();
  /** Demandes par compte. */
  requests = new Map<string, HostRequestRow[]>();
  /** Réponse de l'acceptation par demande ; par défaut : FORBIDDEN. */
  accepts = new Map<string, AcceptResult>();
  declines = new Map<string, DeclineResult>();
  down = false;
  accepted: { orgId: string; holdId: string }[] = [];
  declined: { orgId: string; holdId: string }[] = [];
  recorded: { holdId: string; operationId: string; providerReference: string }[] = [];
  recordOutcome: 'RECORDED' | RequestRefusal = 'RECORDED';

  #fail(): Promise<never> {
    return Promise.reject(new Error('base indisponible (FAKE)'));
  }

  #owns(proof: Buffer, orgId: string): boolean {
    return this.accounts.get(proof.toString('hex'))?.has(orgId) === true;
  }

  list(proof: Buffer, orgId: string, holdId: string | null) {
    if (this.down) return this.#fail();
    if (!this.#owns(proof, orgId)) return Promise.resolve('FORBIDDEN' as const);
    const rows = this.requests.get(orgId) ?? [];
    return Promise.resolve(holdId === null ? rows : rows.filter((r) => r.holdId === holdId));
  }

  accept(proof: Buffer, orgId: string, holdId: string): Promise<AcceptResult> {
    if (this.down) return this.#fail();
    this.accepted.push({ orgId, holdId });
    if (!this.#owns(proof, orgId)) return Promise.resolve({ kind: 'REFUSED', code: 'FORBIDDEN' });
    return Promise.resolve(this.accepts.get(holdId) ?? { kind: 'REFUSED', code: 'FORBIDDEN' });
  }

  recordCapture(
    proof: Buffer,
    orgId: string,
    holdId: string,
    operationId: string,
    providerReference: string,
  ): Promise<'RECORDED' | RequestRefusal> {
    if (this.down) return this.#fail();
    if (!this.#owns(proof, orgId)) return Promise.resolve('FORBIDDEN');
    this.recorded.push({ holdId, operationId, providerReference });
    return Promise.resolve(this.recordOutcome);
  }

  decline(proof: Buffer, orgId: string, holdId: string): Promise<DeclineResult> {
    if (this.down) return this.#fail();
    this.declined.push({ orgId, holdId });
    if (!this.#owns(proof, orgId)) return Promise.resolve({ kind: 'REFUSED', code: 'FORBIDDEN' });
    return Promise.resolve(this.declines.get(holdId) ?? { kind: 'REFUSED', code: 'FORBIDDEN' });
  }
}

/**
 * Connecteur de capture enregistreur : vérifie la somme des jambes comme tout adaptateur (08 E7
 * règle 1) et retient chaque capture reçue.
 */
export class RecordingCaptures implements RequestCaptureProvider {
  captures: CaptureRequest[] = [];
  lookups: OperationLookup[] = [];
  found: ProviderOperation | null = null;
  failWith: PaymentError | null = null;

  capture(request: CaptureRequest): Promise<OperationResult> {
    this.captures.push(request);
    if (this.failWith !== null) return Promise.reject(this.failWith);
    assertMovingLegs(request.amountMinor, request.legs);
    return Promise.resolve({
      providerReference: `fake-capture-${this.captures.length}`,
      status: 'SUBMITTED',
    });
  }

  getOperation(lookup: OperationLookup): Promise<ProviderOperation | null> {
    this.lookups.push(lookup);
    return Promise.resolve(this.found);
  }
}

export { PaymentError };
