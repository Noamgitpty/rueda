// Point d'entrée public du module AVL. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, avl.module.ts) est privé (règle rueda/module-boundaries).
export { AvlModule } from './avl.module.js';

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
