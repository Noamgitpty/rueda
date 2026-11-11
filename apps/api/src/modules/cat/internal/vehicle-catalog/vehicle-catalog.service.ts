/**
 * Service du catalogue de référence des véhicules (US-113 ; 16 HST-050) : listes de choix
 * marque → modèle → année → finition de l'assistant de l'hôte (A10) et préremplissage du véhicule
 * depuis la variante choisie. Lecture seule ; la route HTTP et l'écran arrivent avec l'assistant
 * d'annonce (US-115). Un véhicule hors catalogue passe par la file d'ajout (US-114) et n'est
 * jamais publiable (OQ-CAT-01 g).
 */
import { CatalogError } from './errors.js';
import { prefillFromVariant } from './prefill.js';
import type { VehiclePrefill } from './prefill.js';
import type { MakeOption, ModelOption, VariantOption, VehicleCatalogStore } from './store.js';

export class VehicleCatalogService {
  constructor(private readonly store: VehicleCatalogStore) {}

  listMakes(): Promise<MakeOption[]> {
    return this.store.listMakes();
  }

  listModels(makeId: string): Promise<ModelOption[]> {
    return this.store.listModels(makeId);
  }

  /**
   * `year` : année du véhicule de l'hôte (entier), ou `null` pour toutes les années. `country` :
   * pays du compte d'hôte (US-115) ; les variantes d'un autre marché ne sont jamais proposées.
   */
  listVariants(
    modelId: string,
    year: number | null,
    country: string | null = null,
  ): Promise<VariantOption[]> {
    if (year !== null && !Number.isInteger(year)) return Promise.resolve([]);
    return this.store.listVariants(modelId, year, country);
  }

  /**
   * Préremplissage du véhicule depuis la variante : places, boîte, carburant, transmission
   * intégrale, consommation étiquetée. Variante inconnue, ou d'un autre marché que `country`
   * (US-115) : `CATALOG_VARIANT_NOT_FOUND` ; retirée
   * (elle, son modèle ou sa marque) : `CATALOG_VARIANT_RETIRED`.
   */
  async prefill(variantId: string, country: string | null = null): Promise<VehiclePrefill> {
    const view = await this.store.findVariant(variantId, country);
    if (view === null) {
      throw new CatalogError('CATALOG_VARIANT_NOT_FOUND', 'variante inconnue du catalogue');
    }
    return prefillFromVariant(view);
  }
}
