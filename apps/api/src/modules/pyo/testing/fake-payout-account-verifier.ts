/**
 * FAKE du PSP qui vérifie le compte de versement (port `PayoutAccountVerifier`, US-707) — TESTS
 * SEULEMENT. Issue scriptée par compte (numéro) : par défaut VERIFIED ; `reject(numéro, motif)`
 * simule un titulaire ou une pièce refusés par la banque ; `available = false` simule une panne.
 * Idempotent par clé : un rejeu rend la même issue. Les requêtes reçues sont gardées pour que le
 * test vérifie la clé et les champs transmis (jamais journalisées).
 */
import type {
  PayoutAccountRejectReason,
  PayoutAccountVerification,
  PayoutAccountVerifier,
  VerifyPayoutAccountRequest,
} from '../internal/payout-account-verifier.port.js';

export class FakePayoutAccountVerifier implements PayoutAccountVerifier {
  available = true;
  readonly requests: VerifyPayoutAccountRequest[] = [];
  readonly #rejected = new Map<string, PayoutAccountRejectReason>();
  readonly #byKey = new Map<string, PayoutAccountVerification>();
  #seq = 0;

  reject(accountNumber: string, reason: PayoutAccountRejectReason): void {
    this.#rejected.set(accountNumber, reason);
  }

  verify = (request: VerifyPayoutAccountRequest): Promise<PayoutAccountVerification> => {
    this.requests.push(request);
    if (!this.available) return Promise.resolve({ status: 'UNAVAILABLE' });
    const known = this.#byKey.get(request.idempotencyKey);
    if (known !== undefined) return Promise.resolve(known);
    const reason = this.#rejected.get(request.accountNumber);
    this.#seq += 1;
    const out: PayoutAccountVerification =
      reason === undefined
        ? { status: 'VERIFIED', providerReference: `fk_pa_${String(this.#seq).padStart(6, '0')}` }
        : { status: 'REJECTED', reason };
    this.#byKey.set(request.idempotencyKey, out);
    return Promise.resolve(out);
  };
}
