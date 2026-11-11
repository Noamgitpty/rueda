/**
 * Préremplissage du véhicule de l'hôte depuis une variante du catalogue (US-113 critère 2 ;
 * 16 HST-050 « les caractéristiques sont préremplies depuis la variante et restent modifiables au
 * niveau du véhicule »). Fonction pure : la variante est lue par le magasin, sous la RLS d'app_api.
 *
 * Correspondance avec les colonnes du véhicule (17 §3.2.3 `vehicle`), PROPOSÉE (ADR-094) :
 * - boîte : `MT` → `MANUAL` ; `AT`, `CVT`, `DCT` → `AUTOMATIC` (la boîte exacte reste fournie) ;
 * - carburant : `PHEV` → `HYBRID` ; `LPG` → `null` (le véhicule n'a pas de valeur GPL : l'hôte
 *   choisit) ; les autres à l'identique ;
 * - transmission intégrale : `AWD` et `4X4` ;
 * - consommation : rendue avec sa source ; une valeur `EPA_US_REFERENCE` porte toujours le libellé
 *   « référence US » (17 §3.2.3), jamais une valeur nue.
 * Les libellés sont des clés du catalogue i18n (es, en, fr, pt), jamais du texte.
 */
import type { MessageKey } from '@rueda/i18n';
import { CatalogError } from './errors.js';
import type {
  BodyType,
  CatalogStatus,
  ConsumptionSource,
  Drive,
  Gearbox,
  ValueClass,
  VariantFuel,
} from './model.js';

export type VehicleTransmission = 'MANUAL' | 'AUTOMATIC';
export type VehicleFuel = 'GASOLINE' | 'DIESEL' | 'HYBRID' | 'EV';

/** Variante lue avec son modèle et sa marque (statuts compris). */
export interface VariantView {
  readonly id: string;
  readonly status: CatalogStatus;
  readonly makeId: string;
  readonly makeName: string;
  readonly makeStatus: CatalogStatus;
  readonly modelId: string;
  readonly modelName: string;
  readonly modelStatus: CatalogStatus;
  readonly bodyType: BodyType;
  readonly yearFrom: number;
  readonly yearTo: number | null;
  readonly trimName: string | null;
  readonly transmission: Gearbox;
  readonly fuelType: VariantFuel;
  readonly drive: Drive;
  readonly engineCc: number | null;
  readonly seats: number;
  readonly doors: number;
  readonly valueClass: ValueClass | null;
  readonly consumptionL100km: string | null;
  readonly consumptionSource: ConsumptionSource | null;
}

export interface ConsumptionPrefill {
  /** Litres aux 100 km, en chaîne décimale (jamais un flottant). */
  readonly litersPer100km: string;
  readonly source: ConsumptionSource;
  /** Mention obligatoire « référence US » pour une valeur EPA, sinon `null`. */
  readonly referenceLabel: MessageKey | null;
}

export interface VehiclePrefill {
  readonly variantId: string;
  readonly makeName: string;
  readonly modelName: string;
  readonly trimName: string | null;
  readonly bodyType: BodyType;
  readonly seats: number;
  readonly doors: number;
  readonly transmission: VehicleTransmission;
  readonly gearbox: Gearbox;
  readonly fuelType: VehicleFuel | null;
  readonly variantFuel: VariantFuel;
  readonly drive: Drive;
  readonly allWheelDrive: boolean;
  readonly valueClass: ValueClass | null;
  readonly consumption: ConsumptionPrefill | null;
  readonly labels: {
    readonly bodyType: MessageKey;
    readonly gearbox: MessageKey;
    readonly fuel: MessageKey;
    readonly drive: MessageKey;
  };
}

const TRANSMISSION: Readonly<Record<Gearbox, VehicleTransmission>> = {
  MT: 'MANUAL',
  AT: 'AUTOMATIC',
  CVT: 'AUTOMATIC',
  DCT: 'AUTOMATIC',
};

const FUEL: Readonly<Record<VariantFuel, VehicleFuel | null>> = {
  GASOLINE: 'GASOLINE',
  DIESEL: 'DIESEL',
  HYBRID: 'HYBRID',
  PHEV: 'HYBRID',
  EV: 'EV',
  LPG: null,
};

export const BODY_TYPE_LABELS: Readonly<Record<BodyType, MessageKey>> = {
  SUV: 'common.vehicle.bodyType.suv',
  PICKUP: 'common.vehicle.bodyType.pickup',
  SEDAN: 'common.vehicle.bodyType.sedan',
  HATCHBACK: 'common.vehicle.bodyType.hatchback',
  VAN: 'common.vehicle.bodyType.van',
  MINIVAN: 'common.vehicle.bodyType.minivan',
  COUPE: 'common.vehicle.bodyType.coupe',
  CONVERTIBLE: 'common.vehicle.bodyType.convertible',
  WAGON: 'common.vehicle.bodyType.wagon',
};

export const GEARBOX_LABELS: Readonly<Record<Gearbox, MessageKey>> = {
  MT: 'common.vehicle.gearbox.manual',
  AT: 'common.vehicle.gearbox.automatic',
  CVT: 'common.vehicle.gearbox.cvt',
  DCT: 'common.vehicle.gearbox.dualClutch',
};

export const FUEL_LABELS: Readonly<Record<VariantFuel, MessageKey>> = {
  GASOLINE: 'common.vehicle.fuel.gasoline',
  DIESEL: 'common.vehicle.fuel.diesel',
  HYBRID: 'common.vehicle.fuel.hybrid',
  PHEV: 'common.vehicle.fuel.plugInHybrid',
  EV: 'common.vehicle.fuel.electric',
  LPG: 'common.vehicle.fuel.lpg',
};

export const DRIVE_LABELS: Readonly<Record<Drive, MessageKey>> = {
  FWD: 'common.vehicle.drive.front',
  RWD: 'common.vehicle.drive.rear',
  AWD: 'common.vehicle.drive.allWheel',
  '4X4': 'common.vehicle.drive.fourByFour',
};

export const US_REFERENCE_LABEL: MessageKey = 'common.vehicle.consumption.usReference';

/**
 * Préremplit le véhicule depuis la variante. Variante, modèle ou marque retirés :
 * `CATALOG_VARIANT_RETIRED` (16 HST-050) ; en attente de revue : introuvable.
 */
export function prefillFromVariant(view: VariantView): VehiclePrefill {
  const statuses = [view.status, view.modelStatus, view.makeStatus];
  if (statuses.includes('PENDING_REVIEW')) {
    throw new CatalogError('CATALOG_VARIANT_NOT_FOUND', 'variante inconnue du catalogue');
  }
  if (statuses.includes('RETIRED')) {
    throw new CatalogError('CATALOG_VARIANT_RETIRED', 'variante retirée du catalogue');
  }
  const consumption: ConsumptionPrefill | null =
    view.consumptionL100km !== null && view.consumptionSource !== null
      ? {
          litersPer100km: view.consumptionL100km,
          source: view.consumptionSource,
          referenceLabel: view.consumptionSource === 'EPA_US_REFERENCE' ? US_REFERENCE_LABEL : null,
        }
      : null;
  return {
    variantId: view.id,
    makeName: view.makeName,
    modelName: view.modelName,
    trimName: view.trimName,
    bodyType: view.bodyType,
    seats: view.seats,
    doors: view.doors,
    transmission: TRANSMISSION[view.transmission],
    gearbox: view.transmission,
    fuelType: FUEL[view.fuelType],
    variantFuel: view.fuelType,
    drive: view.drive,
    allWheelDrive: view.drive === 'AWD' || view.drive === '4X4',
    valueClass: view.valueClass,
    consumption,
    labels: {
      bodyType: BODY_TYPE_LABELS[view.bodyType],
      gearbox: GEARBOX_LABELS[view.transmission],
      fuel: FUEL_LABELS[view.fuelType],
      drive: DRIVE_LABELS[view.drive],
    },
  };
}
