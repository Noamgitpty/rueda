/**
 * Port `PayoutAccountVerifier` du module PYO (US-707, ADR-180 ; 16 PYO-001 ; 08 BR-PAYOUT-01) :
 * vérification du compte de versement par le PSP de place de marché (le compte appartient-il au
 * titulaire déclaré, qui est l'hôte, cédula ou RUC compris ?).
 *
 * Avant le lot C, seul un FAKE existe (`../testing/fake-payout-account-verifier.ts`, jamais en
 * production) ; au lot C, l'adaptateur du PSP réel l'implémente dans le port `PaymentProvider` de
 * PAY (capacité de vérification de compte : inconnue = « non »). Sans prestataire, le compte reste
 * `PENDING` et aucun versement ne part (garde `core.payout_payout_account_hold`).
 *
 * Règles : clé d'idempotence `payout-account:{accountId}` ; le numéro n'est transmis qu'au PSP,
 * jamais journalisé ni renvoyé ; panne, délai ou réponse illisible ⇒ `UNAVAILABLE` (le compte
 * reste en vérification, jamais supposé vérifié).
 */
export const PAYOUT_ACCOUNT_REJECT_REASONS = [
  'HOLDER_MISMATCH',
  'TAX_ID_MISMATCH',
  'ACCOUNT_INVALID',
] as const;
export type PayoutAccountRejectReason = (typeof PAYOUT_ACCOUNT_REJECT_REASONS)[number];

export interface VerifyPayoutAccountRequest {
  readonly idempotencyKey: string;
  /** Référence du compte d'hôte chez Kmino (`org_id`). */
  readonly hostReference: string;
  readonly country: string;
  readonly currency: string;
  readonly kind: 'BANK_ACCOUNT' | 'WALLET';
  readonly institution: string;
  readonly accountNumber: string;
  readonly holderGivenNames: string;
  readonly holderSurnames: string;
  readonly holderTaxIdKind: string;
  readonly holderTaxId: string;
}

export type PayoutAccountVerification =
  | { readonly status: 'VERIFIED'; readonly providerReference: string }
  | { readonly status: 'REJECTED'; readonly reason: PayoutAccountRejectReason }
  | { readonly status: 'UNAVAILABLE' };

export interface PayoutAccountVerifier {
  readonly verify: (request: VerifyPayoutAccountRequest) => Promise<PayoutAccountVerification>;
}
