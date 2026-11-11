/**
 * test:int — catalogue de référence des véhicules de bout en bout sur la base jetable du banc de
 * @rueda/db, sous app_api (assertion L0-05 par connectAs, une connexion par test) :
 * `VehicleCatalogService` + `PgVehicleCatalogStore` + tables de 0059 et fixtures 9970.
 *
 * Critère 2 de 19 US-113 : un Toyota Hilux de la graine préremplit places, boîte, carburant et
 * transmission intégrale ; une consommation EPA porte « référence US ». Valeurs attendues : la
 * ligne Hilux des données de graine (`data/vehicle-catalog.json`) et 17 §3.2.3, jamais le code
 * testé. Le catalogue est commun aux pays (`market` nul) : chaque pays configuré (PA en USD, PY en
 * PYG, lus dans les données CFG) voit les mêmes lignes.
 */
import { readFileSync } from 'node:fs';
import { connectAs, releaseClient } from '@rueda/db/testing';
// types du contexte fourni par le globalSetup du banc (inject('ruedaBench'))
import type {} from '@rueda/db/testing/global-setup';
import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countryCases } from '../../../../../test/support/countries.js';
import { parseVehicleCatalog } from './model.js';
import { US_REFERENCE_LABEL } from './prefill.js';
import { PgVehicleCatalogStore } from './store.js';
import { VehicleCatalogService } from './vehicle-catalog.service.js';

const SEED = parseVehicleCatalog(
  JSON.parse(readFileSync(new URL('../../data/vehicle-catalog.json', import.meta.url), 'utf8')),
);
/** Fixtures 9970 (base de test seulement). */
const EPA_VARIANT = '11300000-0000-4000-8000-000000000202';
const RETIRED_VARIANT = '11300000-0000-4000-8000-000000000203';

let client: pg.Client;
let catalog: VehicleCatalogService;

beforeEach(async () => {
  client = await connectAs('app_api');
  catalog = new VehicleCatalogService(new PgVehicleCatalogStore(client));
});

afterEach(async () => {
  await releaseClient(client);
});

describe.each(countryCases())('catalogue des véhicules, hôte en $country ($currency)', () => {
  it('critère 2 : Hilux 2.4 manuel de la graine → 5 places, manuelle, diésel, 4x4', async () => {
    const toyota = (await catalog.listMakes()).find((m) => m.slug === 'toyota');
    expect(toyota?.id).toBe(SEED.makes.find((m) => m.slug === 'toyota')?.id);
    const hilux = (await catalog.listModels(toyota?.id ?? '')).find((o) => o.slug === 'hilux');
    expect(hilux?.bodyType).toBe('PICKUP');
    const variants = await catalog.listVariants(hilux?.id ?? '', 2020);
    expect(variants.map((v) => v.transmission).sort()).toEqual(['AT', 'MT']);
    const manual = variants.find((v) => v.transmission === 'MT');
    const prefill = await catalog.prefill(manual?.id ?? '');
    expect(prefill).toMatchObject({
      makeName: 'Toyota',
      modelName: 'Hilux',
      seats: 5,
      transmission: 'MANUAL',
      gearbox: 'MT',
      fuelType: 'DIESEL',
      drive: '4X4',
      allWheelDrive: true,
      consumption: null,
    });
  });

  it('consommation EPA : valeur, source et mention « référence US »', async () => {
    const prefill = await catalog.prefill(EPA_VARIANT);
    expect(prefill.consumption).toEqual({
      litersPer100km: '4.2',
      source: 'EPA_US_REFERENCE',
      referenceLabel: US_REFERENCE_LABEL,
    });
    expect(prefill.fuelType).toBe('HYBRID');
    expect(prefill.transmission).toBe('AUTOMATIC');
  });

  it('variante retirée : CATALOG_VARIANT_RETIRED ; inconnue : CATALOG_VARIANT_NOT_FOUND', async () => {
    await expect(catalog.prefill(RETIRED_VARIANT)).rejects.toMatchObject({
      code: 'CATALOG_VARIANT_RETIRED',
    });
    await expect(catalog.prefill('11300000-0000-4000-8000-00000000ffff')).rejects.toMatchObject({
      code: 'CATALOG_VARIANT_NOT_FOUND',
    });
    await expect(catalog.prefill('pas-un-uuid')).rejects.toMatchObject({
      code: 'CATALOG_VARIANT_NOT_FOUND',
    });
  });

  it('listes de choix : toutes les marques de la graine, ni marque retirée ni en attente', async () => {
    const slugs = (await catalog.listMakes()).map((m) => m.slug);
    for (const make of SEED.makes) expect(slugs).toContain(make.slug);
    expect(slugs).not.toContain('zz-us113-preuve');
    expect(slugs).not.toContain('zz-us113-attente');
    const retiredMake = (await catalog.listMakes()).find((m) => m.slug === 'zz-us113-retiree');
    const models = await catalog.listModels(retiredMake?.id ?? '');
    expect(await catalog.listVariants(models[0]?.id ?? '', null)).toEqual([]);
  });

  it('chaque modèle de la graine a au moins une variante proposée (OQ-CAT-01 g)', async () => {
    for (const make of SEED.makes) {
      for (const model of make.models) {
        expect((await catalog.listVariants(model.id, null)).length, model.slug).toBeGreaterThan(0);
      }
    }
  });
});
