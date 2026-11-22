/**
 * Magasin FAKE des versements lus par le titulaire (US-314) — TESTS SEULEMENT (jamais exporté par
 * `index.ts`, exclu de la compilation de production, C19). Rend, par (empreinte de session, compte
 * d'hôte), la ligne que rendrait `core.payout_host_payouts` (0172) ; toute autre paire ⇒ FORBIDDEN,
 * comme la base. Les règles elles-mêmes sont prouvées sur PostgreSQL (l0-us314-host-payouts).
 */
import { HostPayoutsStoreError } from '../internal/host-payouts.js';
import type { HostPayoutsRow, HostPayoutsStore } from '../internal/host-payouts.js';

export class FakeHostPayoutsStore implements HostPayoutsStore {
  readonly #rows = new Map<string, HostPayoutsRow>();
  /** `true` : la base est indisponible (503). */
  failing = false;
  readonly calls: { proof: string; orgId: string }[] = [];

  /** Ligne rendue pour la session (empreinte hex) et le compte d'hôte. */
  set(proofHex: string, orgId: string, row: HostPayoutsRow): void {
    this.#rows.set(`${proofHex}:${orgId}`, row);
  }

  read(proof: Buffer, orgId: string): Promise<HostPayoutsRow> {
    this.calls.push({ proof: proof.toString('hex'), orgId });
    if (this.failing) return Promise.reject(new HostPayoutsStoreError('FAKE : base indisponible'));
    return Promise.resolve(
      this.#rows.get(`${proof.toString('hex')}:${orgId}`) ?? {
        outcome: 'FORBIDDEN',
        country: null,
        currency: null,
        schedule: null,
        batches: null,
        exponent: null,
      },
    );
  }
}
