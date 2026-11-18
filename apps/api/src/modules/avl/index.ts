// Point d'entrée public du module AVL. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, avl.module.ts) est privé (règle rueda/module-boundaries).
export { AvlModule } from './avl.module.js';

// Parties d'une réservation pour les notifications (US-213, ADR-157) : adaptateur du port
// NotificationParties de NTF (même forme, sans dépendance AVL --> NTF), fonction 0133.
export {
  NotificationPartiesError,
  parseBookingParties,
  postgresNotificationParties,
} from './internal/notification-parties.js';
export type { BookingPartyFacts, BookingPartySubject } from './internal/notification-parties.js';

// Oracle de production C12 (US-025, ADR-068) : tâche périodique du travailleur booking_oracle.
export {
  BOOKING_ORACLE_WORKER,
  C12_CHECKS,
  oracleLogLine,
  parseOracleReport,
  PRODUCTION_ORACLE_PERIOD_SECONDS,
  ProductionOracleContractError,
  registerProductionOracle,
  runProductionOracle,
} from './internal/production-oracle.js';
export type { C12Check, ProductionOracleReport } from './internal/production-oracle.js';

// Checkout en une page, partie back-end (US-208, ADR-133) : routes /checkout/… (SessionGuard +
// TermsGuard), devis figé et pose du hold CHECKOUT par les commandes de 0108.
export {
  AvlCheckoutModule,
  postgresCheckoutAdapters,
  UNAVAILABLE_AVL_CHECKOUT,
} from './internal/checkout/avl-checkout.module.js';
export type { AvlCheckoutOptions } from './internal/checkout/avl-checkout.module.js';

// Paiement du hold du checkout (US-223 partie 223b, ADR-142) : routes /checkout/holds/{id}/payment
// (SessionGuard + TermsGuard), T1 / createHostedPayment / T2 et état du paiement (S05, S06).
export { UNAVAILABLE_CHECKOUT_PAYMENTS } from './internal/checkout/avl-checkout.module.js';
export type { AvlCheckoutPaymentOptions } from './internal/checkout/avl-checkout.module.js';
export { PAYMENT_MESSAGES, PaymentHttpError } from './internal/checkout/payment-errors.js';
// remboursements d'un trip lus par sa partie (US-224 partie 224d, ADR-154)
export { TRIP_REFUND_MESSAGES, TripRefundHttpError } from './internal/checkout/trip-refunds.js';
export type { PaymentHttpCode } from './internal/checkout/payment-errors.js';
export {
  CheckoutPaymentService,
  PAYMENT_STATES,
  paymentStateOf,
} from './internal/checkout/payment.service.js';
export type {
  CheckoutPayment,
  CheckoutPaymentStarted,
  HostedPaymentProvider,
  PaymentState,
} from './internal/checkout/payment.service.js';
export {
  PgCheckoutPaymentStore,
  UnavailableCheckoutPaymentStore,
} from './internal/checkout/payment-store.js';
export type {
  CheckoutPaymentRow,
  CheckoutPaymentStore,
} from './internal/checkout/payment-store.js';
export { CHECKOUT_MESSAGES, CheckoutHttpError } from './internal/checkout/errors.js';
export type { CheckoutHttpCode } from './internal/checkout/errors.js';
export {
  CHECKOUT_OUTCOMES,
  PgCheckoutStore,
  UnavailableCheckoutStore,
} from './internal/checkout/store.js';
export type {
  CheckoutHold,
  CheckoutListing,
  CheckoutQuote,
  CheckoutResult,
  CheckoutStore,
} from './internal/checkout/store.js';

// Réservation sur demande, partie serveur (US-223 partie 223c, ADR-146) : routes
// /host/accounts/{orgId}/requests… (SessionGuard + TermsGuard), acceptation (capture par jambes),
// refus (VOID par la boîte d'envoi) et lecture des demandes de l'hôte ; état de la demande lu par
// le voyageur dans le paiement du hold.
export { UNAVAILABLE_HOST_REQUESTS } from './internal/checkout/avl-checkout.module.js';
export type { AvlHostRequestOptions } from './internal/checkout/avl-checkout.module.js';
export {
  HOST_REQUEST_MESSAGES,
  HostRequestHttpError,
} from './internal/checkout/host-request-errors.js';
export type { HostRequestHttpCode } from './internal/checkout/host-request-errors.js';
export { HostRequestService } from './internal/checkout/host-requests.service.js';
export type {
  HostRequestDecision,
  RequestCaptureProvider,
} from './internal/checkout/host-requests.service.js';
export {
  HOST_REQUESTS_LIMIT,
  PgHostRequestStore,
  REQUEST_REFUSALS,
  UnavailableHostRequestStore,
} from './internal/checkout/host-requests-store.js';
export type {
  AcceptResult,
  DeclineResult,
  HostRequestRow,
  HostRequestStore,
  RequestCapture,
  RequestRefusal,
} from './internal/checkout/host-requests-store.js';
export { REQUEST_STATUSES } from './internal/checkout/payment-store.js';
export type { CheckoutRequestRow, RequestStatus } from './internal/checkout/payment-store.js';
// Contrat de location hôte–voyageur par trip (US-211, ADR-143) : travailleur `booking_contract`,
// consommateur de `booking.trip.booked` (faits du devis figé, retenue du moteur de règlement).
export {
  BOOKING_CONTRACT_WORKER,
  ContractGenerationError,
  localMinute,
  registerRentalContracts,
  RentalContractGenerator,
  TRIP_BOOKED_EVENT,
} from './internal/contract/contract-generator.js';
export type {
  ContractGeneratorDeps,
  ContractLogEntry,
  ContractOutcome,
} from './internal/contract/contract-generator.js';
