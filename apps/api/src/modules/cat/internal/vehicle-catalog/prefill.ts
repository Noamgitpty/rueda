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
 *
 * Variante sans fiche (source sans caractéristiques techniques, ADR-109 : import de la douane) :
 * carrosserie, places, portes, boîte, carburant et transmission sont `null`, `specsComplete` vaut
 * `false` ; rien n'est deviné, l'hôte les saisit lui-même (le véhicule les exige) et l'ops les
 * complète au catalogue. La variante reste choisissable.
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
  readonly bodyType: BodyType | null;
  readonly yearFrom: number;
  readonly yearTo: number | null;
  readonly trimName: string | null;
  readonly transmission: Gearbox | null;
  readonly fuelType: VariantFuel | null;
  readonly drive: Drive | null;
  readonly engineCc: number | null;
  readonly seats: number | null;
  readonly doors: number | null;
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
  /** `false` : variante sans fiche (ADR-109), les champs techniques nuls sont à saisir. */
  readonly specsComplete: boolean;
  readonly bodyType: BodyType | null;
  readonly seats: number | null;
  readonly doors: number | null;
  readonly transmission: VehicleTransmission | null;
  readonly gearbox: Gearbox | null;
  readonly fuelType: VehicleFuel | null;
  readonly variantFuel: VariantFuel | null;
  readonly drive: Drive | null;
  /** `null` : transmission inconnue (variante sans fiche). */
  readonly allWheelDrive: boolean | null;
  readonly valueClass: ValueClass | null;
  readonly consumption: ConsumptionPrefill | null;
  readonly labels: {
    readonly bodyType: MessageKey | null;
    readonly gearbox: MessageKey | null;
    readonly fuel: MessageKey | null;
    readonly drive: MessageKey | null;
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
  const { bodyType, transmission, fuelType, drive } = view;
  const specsComplete =
    bodyType !== null &&
    transmission !== null &&
    fuelType !== null &&
    drive !== null &&
    view.seats !== null &&
    view.doors !== null;
  return {
    variantId: view.id,
    makeName: view.makeName,
    modelName: view.modelName,
    trimName: view.trimName,
    specsComplete,
    bodyType,
    seats: view.seats,
    doors: view.doors,
    transmission: transmission === null ? null : TRANSMISSION[transmission],
    gearbox: transmission,
    fuelType: fuelType === null ? null : FUEL[fuelType],
    variantFuel: fuelType,
    drive,
    allWheelDrive: drive === null ? null : drive === 'AWD' || drive === '4X4',
    valueClass: view.valueClass,
    consumption,
    labels: {
      bodyType: bodyType === null ? null : BODY_TYPE_LABELS[bodyType],
      gearbox: transmission === null ? null : GEARBOX_LABELS[transmission],
      fuel: fuelType === null ? null : FUEL_LABELS[fuelType],
      drive: drive === null ? null : DRIVE_LABELS[drive],
    },
  };
}
