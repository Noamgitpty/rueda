/**
 * US-113 — préremplissage depuis le catalogue (critère 2), sans base : magasin en mémoire construit
 * depuis la graine du dépôt (`data/vehicle-catalog.json`). Valeurs attendues : la ligne Hilux de la
 * graine (données, pas le code testé) et 17 §3.2.3 (`vehicle.transmission` MANUAL / AUTOMATIC,
 * `fuel_type` GASOLINE / DIESEL / HYBRID / EV ; EPA = « référence US »). La lecture réelle sous
 * app_api est prouvée par `vehicle-catalog.int.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { CATALOGS, CATALOG_LANGUAGES } from '@rueda/i18n';
import { describe, expect, it } from 'vitest';
import { CatalogError } from './errors.js';
import { parseVehicleCatalog } from './model.js';
import type { CatalogStatus, VehicleCatalogSeed } from './model.js';
import {
  BODY_TYPE_LABELS,
  DRIVE_LABELS,
  FUEL_LABELS,
  GEARBOX_LABELS,
  prefillFromVariant,
  US_REFERENCE_LABEL,
} from './prefill.js';
import type { VariantView } from './prefill.js';
import type { MakeOption, ModelOption, VariantOption, VehicleCatalogStore } from './store.js';
import { VehicleCatalogService } from './vehicle-catalog.service.js';

const SEED = parseVehicleCatalog(
  JSON.parse(readFileSync(new URL('../../data/vehicle-catalog.json', import.meta.url), 'utf8')),
);

/** Magasin en mémoire, mêmes règles de visibilité que la base (ACTIVE et RETIRED lisibles). */
class MemoryStore implements VehicleCatalogStore {
  constructor(private readonly seed: VehicleCatalogSeed) {}
  listMakes(): Promise<MakeOption[]> {
    return Promise.resolve(
      this.seed.makes
        .filter((m) => m.status === 'ACTIVE')
        .map((m) => ({ id: m.id, slug: m.slug, name: m.name, aliases: m.aliases })),
    );
  }
  listModels(makeId: string): Promise<ModelOption[]> {
    const make = this.seed.makes.find((m) => m.id === makeId && m.status === 'ACTIVE');
    return Promise.resolve(
      (make?.models ?? [])
        .filter((o) => o.status === 'ACTIVE')
        .map((o) => ({
          id: o.id,
          slug: o.slug,
          name: o.name,
          aliases: o.aliases,
          bodyType: o.bodyType,
        })),
    );
  }
  listVariants(modelId: string, year: number | null): Promise<VariantOption[]> {
    const model = this.seed.makes.flatMap((m) => m.models).find((o) => o.id === modelId);
    return Promise.resolve(
      (model?.variants ?? [])
        .filter(
          (v) =>
            v.status === 'ACTIVE' &&
            (year === null || (v.yearFrom <= year && (v.yearTo === null || v.yearTo >= year))),
        )
        .map((v) => ({
          id: v.id,
          yearFrom: v.yearFrom,
          yearTo: v.yearTo,
          trimName: v.trimName,
          transmission: v.transmission,
          fuelType: v.fuelType,
          drive: v.drive,
        })),
    );
  }
  findVariant(variantId: string): Promise<VariantView | null> {
    for (const m of this.seed.makes) {
      for (const o of m.models) {
        const v = o.variants.find((x) => x.id === variantId);
        if (v === undefined) continue;
        return Promise.resolve({
          id: v.id,
          status: v.status,
          makeId: m.id,
          makeName: m.name,
          makeStatus: m.status,
          modelId: o.id,
          modelName: o.name,
          modelStatus: o.status,
          bodyType: o.bodyType,
          yearFrom: v.yearFrom,
          yearTo: v.yearTo,
          trimName: v.trimName,
          transmission: v.transmission,
          fuelType: v.fuelType,
          drive: v.drive,
          engineCc: v.engineCc,
          seats: v.seats,
          doors: v.doors,
          valueClass: v.valueClass,
          consumptionL100km: v.consumptionL100km,
          consumptionSource: v.consumptionSource,
        });
      }
    }
    return Promise.resolve(null);
  }
}

const service = new VehicleCatalogService(new MemoryStore(SEED));

async function hiluxVariant(year: number, gearbox: string): Promise<VariantOption> {
  const toyota = (await service.listMakes()).find((m) => m.slug === 'toyota');
  if (!toyota) throw new Error('Toyota absente de la graine');
  const hilux = (await service.listModels(toyota.id)).find((o) => o.slug === 'hilux');
  if (!hilux) throw new Error('Hilux absent de la graine');
  expect(hilux.bodyType).toBe('PICKUP');
  const variant = (await service.listVariants(hilux.id, year)).find(
    (v) => v.transmission === gearbox,
  );
  if (!variant) throw new Error(`variante Hilux ${gearbox} ${year} absente`);
  return variant;
}

const viewOf = (over: Partial<VariantView>): VariantView => ({
  id: '00000000-0000-4000-8000-000000000113',
  status: 'ACTIVE',
  makeId: '00000000-0000-4000-8000-000000000001',
  makeName: 'Marque de test',
  makeStatus: 'ACTIVE',
  modelId: '00000000-0000-4000-8000-000000000002',
  modelName: 'Modèle de test',
  modelStatus: 'ACTIVE',
  bodyType: 'SEDAN',
  yearFrom: 2020,
  yearTo: null,
  trimName: null,
  transmission: 'AT',
  fuelType: 'GASOLINE',
  drive: 'FWD',
  engineCc: null,
  seats: 5,
  doors: 4,
  valueClass: null,
  consumptionL100km: null,
  consumptionSource: null,
  ...over,
});

describe('critère 2 : un Toyota Hilux de la graine préremplit le véhicule', () => {
  it('Hilux 2.4 manuel 2020 : 5 places, boîte manuelle, diésel, transmission intégrale', async () => {
    const variant = await hiluxVariant(2020, 'MT');
    const prefill = await service.prefill(variant.id);
    expect(prefill).toMatchObject({
      makeName: 'Toyota',
      modelName: 'Hilux',
      trimName: '2.4',
      bodyType: 'PICKUP',
      seats: 5,
      doors: 4,
      transmission: 'MANUAL',
      gearbox: 'MT',
      fuelType: 'DIESEL',
      drive: '4X4',
      allWheelDrive: true,
      consumption: null,
    });
  });

  it('Hilux 2.8 automatique : boîte AUTOMATIC, diésel, 4x4', async () => {
    const prefill = await service.prefill((await hiluxVariant(2022, 'AT')).id);
    expect(prefill).toMatchObject({
      transmission: 'AUTOMATIC',
      fuelType: 'DIESEL',
      allWheelDrive: true,
    });
  });

  it('année antérieure à la variante : aucune variante proposée', async () => {
    const toyota = (await service.listMakes()).find((m) => m.slug === 'toyota');
    const hilux = (await service.listModels(toyota?.id ?? '')).find((o) => o.slug === 'hilux');
    expect(await service.listVariants(hilux?.id ?? '', 2010)).toEqual([]);
    expect(await service.listVariants(hilux?.id ?? '', 2020.5)).toEqual([]);
  });

  it('libellés : clés du catalogue i18n, présentes et non vides dans les quatre langues', async () => {
    const prefill = await service.prefill((await hiluxVariant(2020, 'MT')).id);
    expect(prefill.specsComplete).toBe(true);
    for (const key of Object.values(prefill.labels)) {
      if (key === null) throw new Error('libellé absent pour une variante avec fiche');
      for (const lang of CATALOG_LANGUAGES) {
        const message = CATALOGS[lang].messages[key];
        expect(typeof message === 'string' && message.trim() !== '', `${lang} ${key}`).toBe(true);
      }
    }
  });
});

describe('consommation EPA étiquetée « référence US »', () => {
  it('valeur EPA : source et libellé « référence US » rendus avec la valeur', () => {
    const prefill = prefillFromVariant(
      viewOf({ consumptionL100km: '8.4', consumptionSource: 'EPA_US_REFERENCE' }),
    );
    expect(prefill.consumption).toEqual({
      litersPer100km: '8.4',
      source: 'EPA_US_REFERENCE',
      referenceLabel: US_REFERENCE_LABEL,
    });
  });

  it('la mention dit « US » dans les quatre langues', () => {
    expect(CATALOGS.es.messages[US_REFERENCE_LABEL]).toBe('referencia EE. UU.');
    expect(CATALOGS.en.messages[US_REFERENCE_LABEL]).toBe('US reference');
    expect(CATALOGS.fr.messages[US_REFERENCE_LABEL]).toBe('référence US');
    expect(CATALOGS.pt.messages[US_REFERENCE_LABEL]).toBe('referência dos EUA');
  });

  it('valeur de l’ops : rendue sans la mention ; aucune valeur : null, jamais bloquant', () => {
    expect(
      prefillFromVariant(viewOf({ consumptionL100km: '7.1', consumptionSource: 'OPS_CURATED' }))
        .consumption,
    ).toEqual({ litersPer100km: '7.1', source: 'OPS_CURATED', referenceLabel: null });
    expect(prefillFromVariant(viewOf({})).consumption).toBeNull();
  });
});

describe('correspondance vers le véhicule (17 §3.2.3, ADR-094)', () => {
  it.each([
    ['MT', 'MANUAL'],
    ['AT', 'AUTOMATIC'],
    ['CVT', 'AUTOMATIC'],
    ['DCT', 'AUTOMATIC'],
  ] as const)('boîte %s → %s', (gearbox, expected) => {
    expect(prefillFromVariant(viewOf({ transmission: gearbox })).transmission).toBe(expected);
  });

  it.each([
    ['GASOLINE', 'GASOLINE'],
    ['DIESEL', 'DIESEL'],
    ['HYBRID', 'HYBRID'],
    ['PHEV', 'HYBRID'],
    ['EV', 'EV'],
    ['LPG', null],
  ] as const)('carburant %s → %s', (fuel, expected) => {
    expect(prefillFromVariant(viewOf({ fuelType: fuel })).fuelType).toBe(expected);
  });

  it.each([
    ['FWD', false],
    ['RWD', false],
    ['AWD', true],
    ['4X4', true],
  ] as const)('transmission %s : intégrale = %s', (drive, expected) => {
    expect(prefillFromVariant(viewOf({ drive })).allWheelDrive).toBe(expected);
  });

  it('chaque énumération a un libellé dans les quatre langues', () => {
    const keys = [
      ...Object.values(BODY_TYPE_LABELS),
      ...Object.values(GEARBOX_LABELS),
      ...Object.values(FUEL_LABELS),
      ...Object.values(DRIVE_LABELS),
      US_REFERENCE_LABEL,
    ];
    for (const key of keys) {
      for (const lang of CATALOG_LANGUAGES) {
        expect(CATALOGS[lang].messages[key], `${lang} ${key}`).toBeTruthy();
      }
    }
  });
});

describe('variante retirée ou inconnue', () => {
  it.each(['status', 'modelStatus', 'makeStatus'] as const)(
    '%s RETIRED : CATALOG_VARIANT_RETIRED',
    (field) => {
      const view = viewOf({ [field]: 'RETIRED' as CatalogStatus });
      expect(() => prefillFromVariant(view)).toThrow(CatalogError);
      try {
        prefillFromVariant(view);
      } catch (error) {
        expect((error as CatalogError).code).toBe('CATALOG_VARIANT_RETIRED');
      }
    },
  );

  it('variante inconnue : CATALOG_VARIANT_NOT_FOUND', async () => {
    await expect(service.prefill('00000000-0000-4000-8000-00000000dead')).rejects.toMatchObject({
      code: 'CATALOG_VARIANT_NOT_FOUND',
    });
  });

  it('en attente de revue : traitée comme inconnue', () => {
    try {
      prefillFromVariant(viewOf({ status: 'PENDING_REVIEW' }));
      expect.unreachable();
    } catch (error) {
      expect((error as CatalogError).code).toBe('CATALOG_VARIANT_NOT_FOUND');
    }
  });
});

describe('variante sans fiche (import de la douane, ADR-109)', () => {
  const specless = viewOf({
    bodyType: null,
    transmission: null,
    fuelType: null,
    drive: null,
    seats: null,
    doors: null,
  });

  it('choisissable : préremplit marque, modèle et rien d’autre, jamais une valeur devinée', () => {
    expect(prefillFromVariant(specless)).toEqual({
      variantId: specless.id,
      makeName: 'Marque de test',
      modelName: 'Modèle de test',
      trimName: null,
      specsComplete: false,
      bodyType: null,
      seats: null,
      doors: null,
      transmission: null,
      gearbox: null,
      fuelType: null,
      variantFuel: null,
      drive: null,
      allWheelDrive: null,
      valueClass: null,
      consumption: null,
      labels: { bodyType: null, gearbox: null, fuel: null, drive: null },
    });
  });

  it('une seule caractéristique manquante suffit à marquer la fiche incomplète', () => {
    expect(prefillFromVariant(viewOf({ seats: null })).specsComplete).toBe(false);
    expect(prefillFromVariant(viewOf({ drive: null })).allWheelDrive).toBeNull();
    expect(prefillFromVariant(viewOf({})).specsComplete).toBe(true);
  });

  it('statuts : une variante sans fiche retirée reste refusée (CATALOG_VARIANT_RETIRED)', () => {
    expect(() => prefillFromVariant({ ...specless, status: 'RETIRED' })).toThrow(CatalogError);
  });
});
