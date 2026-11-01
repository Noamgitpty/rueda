/**
 * Correspondance code de module → schéma PostgreSQL (17 §2.1 : « schéma PostgreSQL dédié,
 * ex. `booking.*` »). **Donnée** de référence pour les migrations (US-005 et suivantes) ;
 * le test `schemas.test.ts` vérifie que chaque module du graphe en a une.
 *
 * Origine de chaque nom :
 * - `17` : le schéma est écrit tel quel dans le SQL de 17 (preuve citée) ; ne pas le changer
 *   sans ADR et report dans 17 ;
 * - `PROPOSÉ` : 17 ne le nomme pas ; nom choisi par US-001 d'après le préfixe des événements de
 *   17 §4.5 ou le nom du module ; modifiable par US-005 (agent données) sans ADR tant
 *   qu'aucune migration ne l'utilise.
 *
 * Bêta pilote (D1, 17 §10 point 3) : un schéma unique `BETA_SCHEMA` et chaque table préfixée par
 * `<schéma cible>_` (`booking_checkout_hold`, `catalog_listing`, `config_currency`). Le passage au
 * schéma par module est alors un renommage mécanique (`core.booking_trip` → `booking.trip`).
 *
 * Fichier en syntaxe effaçable (chargeable directement par Node 26).
 */
import type { ModuleCode } from '../../apps/api/src/modules/dependency-graph.ts';

export type SchemaOrigin = '17' | 'PROPOSÉ';

export interface ModuleSchema {
  /** Schéma cible du module. */
  readonly schema: string;
  readonly origin: SchemaOrigin;
  /** Preuve dans 17 (origine `17`) ou raison du choix (origine `PROPOSÉ`). */
  readonly evidence: string;
}

export const MODULE_SCHEMAS: Readonly<Record<ModuleCode, ModuleSchema>> = {
  IAM: { schema: 'iam', origin: 'PROPOSÉ', evidence: 'événements iam.* (17 §2.2)' },
  KYC: { schema: 'kyc', origin: 'PROPOSÉ', evidence: 'événements kyc.* (17 §2.2)' },
  CAT: {
    schema: 'catalog',
    origin: '17',
    evidence: 'catalog.vehicle_is_free, catalog.vehicle_org, catalog.listing_public_v (17 §2.3)',
  },
  AVL: {
    schema: 'booking',
    origin: '17',
    evidence:
      'booking.checkout_hold, booking.vehicle_occupancy, booking.trip, booking.payment_disposition (17 §2.1, §2.3, §2.5)',
  },
  PRC: { schema: 'pricing', origin: 'PROPOSÉ', evidence: 'événements pricing.* (17 §2.2)' },
  CTR: { schema: 'contract', origin: 'PROPOSÉ', evidence: 'événements contract.* (17 §2.2)' },
  PAY: {
    schema: 'payment',
    origin: '17',
    evidence: 'payment.payment_operation, payment.payment_operation_link (17 §2.3, §2.5)',
  },
  STL: { schema: 'settlement', origin: 'PROPOSÉ', evidence: 'événements settlement.* (17 §2.2)' },
  PYO: { schema: 'payout', origin: 'PROPOSÉ', evidence: 'événements payout.* (17 §2.2)' },
  TRP: {
    schema: 'trip_ops',
    origin: 'PROPOSÉ',
    evidence: 'pas « trip » : la table trip appartient à AVL (booking.trip) ; nom du module',
  },
  CLM: { schema: 'claim', origin: 'PROPOSÉ', evidence: 'événements claim.* (17 §2.2)' },
  MSG: { schema: 'messaging', origin: 'PROPOSÉ', evidence: 'nom du module (17 §2.2)' },
  NTF: {
    schema: 'notification',
    origin: 'PROPOSÉ',
    evidence: 'événements notification.* (17 §2.2)',
  },
  REV: { schema: 'review', origin: 'PROPOSÉ', evidence: 'événements review.* (17 §2.2)' },
  SUP: { schema: 'support', origin: 'PROPOSÉ', evidence: 'événements support.* (17 §2.2)' },
  FIN: {
    schema: 'finance',
    origin: '17',
    evidence: 'CREATE POLICY … ON finance.commission_statement (17 §2.3)',
  },
  RISK: { schema: 'risk', origin: 'PROPOSÉ', evidence: 'événements risk.* (17 §2.2)' },
  CFG: {
    schema: 'config',
    origin: '17',
    evidence:
      'clé étrangère vers config.currency(code) (17 §3.1.5) ; événement config.param.changed',
  },
  AUD: { schema: 'audit', origin: 'PROPOSÉ', evidence: 'nom du module (17 §2.2)' },
  RPT: { schema: 'reporting', origin: 'PROPOSÉ', evidence: 'nom du module (17 §2.2)' },
  BUS: { schema: 'outbox', origin: 'PROPOSÉ', evidence: 'outbox transactionnelle (17 §4)' },
};

/** Schémas transverses, hors modules, nommés par 17. */
export const SHARED_SCHEMAS = {
  platform: 'fonctions de plateforme : platform.now(), platform.guest_hold_guard() (17 §1.3, §2.3)',
  app: 'contexte de session et aides RLS : app.org_id(), app.has_permission() (17 §2.3)',
} as const;

/** Schéma unique de la Bêta pilote (D1). PROPOSÉ : 17 §10 point 3 ne le nomme pas. */
export const BETA_SCHEMA = 'core';

/** Nom de table en Bêta : `<schéma cible>_<entité de 17>`. */
export function betaTableName(module: ModuleCode, entity: string): string {
  return `${MODULE_SCHEMAS[module].schema}_${entity}`;
}
