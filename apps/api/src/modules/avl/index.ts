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
