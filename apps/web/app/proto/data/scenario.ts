/**
 * Données fictives du prototype (`scenario.json`), typées. Devises, exposants, fuseaux, autorités
 * et lieux sont des **données** (ADR-024) : aucun pays, aucune devise ni aucun fuseau n'est écrit
 * dans le code. Le prototype ne calcule aucun montant : tout est déjà en unités mineures.
 */
import type { CatalogLanguage, MinorUnitAmount } from '@rueda/i18n';
import type { CarKind } from '@rueda/ui';
import raw from './scenario.json' with { type: 'json' };

export type Tone = 1 | 2 | 3 | 4;
export type TitleForm = 'masc' | 'fem' | 'neutral';
export type PlanId = 'BASICA' | 'ESTANDAR' | 'TOTAL';

export interface ProtoCar {
  readonly id: string;
  readonly title: string;
  readonly host: {
    readonly name: string;
    readonly tone: Tone;
    readonly titleForm: TitleForm;
    readonly memberSince: number;
    readonly responseRate: number;
    readonly responseHours: number;
  };
  readonly rating?: number;
  readonly trips: number;
  readonly place: string;
  readonly distanceKm: number;
  readonly perDayMinor: string;
  readonly totalMinor: string;
  readonly carTone: Tone;
  readonly kind: CarKind;
  readonly manual: boolean;
}

export interface ProtoPlan {
  readonly id: PlanId;
  readonly priceMinor: string;
  readonly deductibleMinor: string;
  readonly taxMinor: string;
  readonly totalMinor: string;
}

export type InstantName =
  | 'start'
  | 'end'
  | 'freeCancelUntil'
  | 'checkinOpens'
  | 'holdUntil'
  | 'releaseBy'
  | 'refundIssuedOn'
  | 'requestUntil'
  | 'licenseLimit'
  | 'unavailable'
  | 'suggested'
  | 'pastStart'
  | 'pastEnd'
  // Espace hôte (seconde demande de fusion de US-033)
  | 'reqStart'
  | 'reqEnd'
  | 'past1Start'
  | 'past1End'
  | 'payoutSent'
  | 'past2Start'
  | 'past2End'
  | 'payoutOn'
  | 'holdStart'
  | 'holdEnd'
  | 'claimFiled'
  | 'evidenceUntil'
  | 'claimUntil'
  | 'reviewUntil'
  | 'noShowAt'
  | 'monthRef'
  | 'hostSince'
  | 'hoursFrom'
  | 'hoursTo';

export type HostTripStatus = 'upcoming' | 'request' | 'sent' | 'scheduled' | 'onHold';

/**
 * Trip vu par l'hôte : lignes payées par le voyageur et **jambes** du règlement (HOST, INSURER,
 * TAX_THIRD_PARTY, PLATFORM), toutes recalculées par l'oracle de 08 (`prix_oracle.py`). La part
 * de l'hôte est celle de son plan, figée à la réservation (`hostSharePctFrozen`).
 */
export interface HostTrip {
  readonly id: string;
  readonly guest: string;
  readonly guestTone: Tone;
  readonly days: number;
  readonly start: InstantName;
  readonly end: InstantName;
  readonly status: HostTripStatus;
  readonly payout?: InstantName;
  readonly rentMinor: string;
  readonly tripFeeMinor: string;
  readonly protectionMinor: string;
  readonly taxMinor: string;
  readonly totalMinor: string;
  readonly hostMinor: string;
  readonly insurerMinor: string;
  readonly taxThirdMinor: string;
  readonly platformMinor: string;
}

/**
 * Interrupteurs de mise en service du pays (17 v6) et capacité PSP de versement : **données**,
 * `false` / `unknown` comme en production. Un hôte n'est activable que si tout est ouvert.
 */
export interface HostGates {
  readonly p2pPrivateHostsEnabled: boolean;
  readonly insurerContractActive: boolean;
  readonly fundsHoldingEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly pspPayoutCapability: 'yes' | 'no' | 'unknown';
}

export interface HostSpace {
  readonly carId: string;
  readonly planId: 'ESTANDAR';
  /** Part de l'hôte du plan, en pourcentage (BR-PROT-06 [NOUS] : 75). */
  readonly sharePct: number;
  readonly otherCar: { readonly title: string; readonly kind: CarKind; readonly tone: Tone };
  readonly gates: HostGates;
  /** Estimateur A01 : gains de l'hôte pour 1 à 30 jours par mois (oracle, `allocHost`). */
  readonly estimateMinor: readonly string[];
  readonly monthEarningsMinor: string;
  readonly cancelPenaltyMinor: string;
  readonly damageQuoteMinor: string;
  readonly damageCode: string;
  readonly calendar: {
    readonly month: string;
    readonly booked: readonly number[];
    readonly requested: readonly number[];
    readonly blocked: readonly number[];
    readonly noticeHours: number;
    readonly bufferHours: number;
    readonly minDays: number;
    readonly maxDays: number;
  };
  readonly trips: readonly HostTrip[];
  /** Profil public (A13) : textes écrits par l'hôte, un par langue (« une vue = une langue »). */
  readonly profile: {
    readonly city: string;
    readonly languages: readonly string[];
    readonly bio: Readonly<Record<CatalogLanguage, string>>;
    readonly promise: Readonly<Record<CatalogLanguage, string>>;
    readonly review: {
      readonly author: string;
      readonly text: Readonly<Record<CatalogLanguage, string>>;
      readonly stars: number;
    };
    readonly rulesVersion: number;
  };
  readonly return: {
    readonly odometerKm: number;
    readonly fuelOut: FuelLevel;
    readonly fuelIn: FuelLevel;
  };
  /** Console ops (O01) : taille de chaque file et délai cible de traitement. */
  readonly ops: {
    readonly queues: Readonly<Record<OpsQueue, number>>;
    readonly slaHours: number;
  };
}

export type FuelLevel = 'full' | 'threeQuarters' | 'half' | 'quarter';
export const OPS_QUEUES = ['kycGuest', 'kycHost', 'listing', 'flagged', 'claims', 'late'] as const;
export type OpsQueue = (typeof OPS_QUEUES)[number];

export interface ProtoMarket {
  readonly id: string;
  readonly defaultForLocales: readonly string[];
  readonly countryName: Readonly<Record<CatalogLanguage, string>>;
  readonly city: string;
  readonly currency: string;
  readonly exponent: number;
  readonly timeZone: string;
  readonly insurerName: string;
  readonly pspName: string;
  readonly kycProvider: string;
  readonly dialCode: string;
  readonly phoneMasked: string;
  readonly guestName: string;
  readonly taxLabel: Readonly<Record<CatalogLanguage, string>>;
  readonly trafficAuthority: string;
  readonly phones: {
    readonly support: string;
    readonly roadside: string;
    readonly emergency: string;
    readonly traffic: string;
  };
  readonly places: readonly string[];
  readonly notServedCity: string;
  readonly searchSummary: { readonly place: string; readonly dates: string };
  readonly days: number;
  readonly instants: Readonly<Record<InstantName, string>>;
  readonly featured: {
    readonly carId: string;
    readonly meetArea: string;
    readonly meetAddress: string;
    readonly photosTotal: number;
    readonly seats: number;
    readonly kmPerDay: number;
    readonly requestHours: number;
    readonly reviewHours: number;
    readonly kycReviewHours: number;
    readonly depositMaxDays: number;
    readonly bookingCode: string;
    readonly errorCode: string;
    readonly depositMinor: string;
    readonly fees: {
      readonly smokingMinor: string;
      readonly petsMinor: string;
      readonly fuelMinor: string;
    };
    readonly lines: { readonly rentMinor: string; readonly tripFeeMinor: string };
    readonly plans: readonly ProtoPlan[];
    /** Même voyage après un changement de prix (état « prix modifié »), lignes de l'oracle. */
    readonly changed: {
      readonly rentMinor: string;
      readonly tripFeeMinor: string;
      readonly protectionMinor: string;
      readonly taxMinor: string;
      readonly totalMinor: string;
    };
    readonly refundMinor: string;
  };
  readonly cars: readonly ProtoCar[];
  readonly pastTrip: { readonly carId: string; readonly code: string };
  readonly host: HostSpace;
}

export const MARKETS: readonly ProtoMarket[] = (raw as unknown as { markets: ProtoMarket[] })
  .markets;

/** Marché demandé, sinon celui de la locale, sinon le premier. */
export function marketFor(id: string | undefined, localeTag: string): ProtoMarket {
  const byId = MARKETS.find((m) => m.id === id);
  if (byId) return byId;
  const byLocale = MARKETS.find((m) => m.defaultForLocales.includes(localeTag));
  const first = MARKETS[0];
  if (!first) throw new Error('scenario.json : aucun marché');
  return byLocale ?? first;
}

/** Montant d'une chaîne d'unités mineures, dans la devise du marché. */
export function money(market: ProtoMarket, minor: string): MinorUnitAmount {
  return { amountMinor: BigInt(minor), currency: market.currency, exponent: market.exponent };
}

export function carOf(market: ProtoMarket, id: string): ProtoCar {
  const car = market.cars.find((c) => c.id === id);
  if (!car) throw new Error(`scenario.json : voiture inconnue ${id}`);
  return car;
}

export function featuredCar(market: ProtoMarket): ProtoCar {
  return carOf(market, market.featured.carId);
}

export function planOf(market: ProtoMarket, id: string | undefined): ProtoPlan {
  const plans = market.featured.plans;
  const plan = plans.find((p) => p.id === id) ?? plans[0];
  if (!plan) throw new Error('scenario.json : aucun plan');
  return plan;
}

/** Un hôte n'est activable que si chaque interrupteur est ouvert et la capacité PSP validée. */
export function hostActivatable(gates: HostGates): boolean {
  return (
    gates.p2pPrivateHostsEnabled &&
    gates.insurerContractActive &&
    gates.fundsHoldingEnabled &&
    gates.payoutsEnabled &&
    gates.pspPayoutCapability === 'yes'
  );
}

export function hostTrip(market: ProtoMarket, id: string): HostTrip {
  const trip = market.host.trips.find((t) => t.id === id);
  if (!trip) throw new Error(`scenario.json : trip d'hôte inconnu ${id}`);
  return trip;
}
