/**
 * FAKE du port `InsurerClaimsPort` (module CLM ; 16 CLM-001 / CLM-006 « déclaré à l'assureur
 * partenaire selon son contrat » ; US-309, ADR-195). Simule l'assureur partenaire qui reçoit la
 * déclaration d'un dommage couvert et rend une référence OPAQUE de son dossier, sans engagement de
 * prise en charge (OQ-P2P-03). Aucune donnée personnelle n'est envoyée : nature, pays, devise, coût
 * constaté, heure de la déclaration et identifiant de la déclaration (clé d'idempotence).
 *
 * Pilotage par le test : `failNext()` (assureur injoignable une fois) ; une même déclaration
 * renvoyée rend la même référence (idempotence par identifiant).
 */
import { assertFakeAllowed } from '../guard.ts';
import type { EnvironmentVariables } from '../guard.ts';

export interface InsurerClaimRequest {
  /** Identifiant de la déclaration (clé d'idempotence chez l'assureur). */
  readonly declarationId: string;
  /** THEFT : vol présumé d'un trip non rendu (US-318, ADR-198), coût constaté « 0 ». */
  readonly kind: 'DAMAGE' | 'INCIDENT' | 'THEFT';
  readonly country: string;
  readonly currency: string;
  /** Coût de réparation constaté, unités mineures (texte d'un entier). */
  readonly repairCostMinor: string;
  readonly reportedAt: string;
}

export type InsurerClaimResult =
  | { readonly status: 'DECLARED'; readonly providerRef: string }
  | { readonly status: 'UNAVAILABLE' };

export interface FakeInsurerClaimsOptions {
  readonly env?: EnvironmentVariables;
}

export class FakeInsurerClaims {
  readonly #refs = new Map<string, string>();
  #failures = 0;
  /** Requêtes reçues (lecture du test : aucune donnée personnelle n'y figure). */
  readonly received: InsurerClaimRequest[] = [];

  constructor(options: FakeInsurerClaimsOptions = {}) {
    assertFakeAllowed('FakeInsurerClaims', options.env);
  }

  /** La prochaine déclaration échoue (assureur injoignable). */
  failNext(): void {
    this.#failures += 1;
  }

  declare(request: InsurerClaimRequest): Promise<InsurerClaimResult> {
    this.received.push(request);
    if (this.#failures > 0) {
      this.#failures -= 1;
      return Promise.resolve({ status: 'UNAVAILABLE' });
    }
    let ref = this.#refs.get(request.declarationId);
    if (ref === undefined) {
      ref = `fake-insurer:${String(this.#refs.size + 1).padStart(6, '0')}`;
      this.#refs.set(request.declarationId, ref);
    }
    return Promise.resolve({ status: 'DECLARED', providerRef: ref });
  }
}
