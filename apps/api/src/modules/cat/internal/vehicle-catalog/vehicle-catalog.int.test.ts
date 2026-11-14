/**
 * test:int — catalogue de référence des véhicules de bout en bout sur la base jetable du banc de
 * @rueda/db, sous app_api (assertion L0-05 par connectAs, une connexion par test) :
 * `VehicleCatalogService` + `PgVehicleCatalogStore` + tables de 0063 et fixtures 9970.
 *
 * Critère 2 de 19 US-113 : un Toyota Hilux de la graine préremplit places, boîte, carburant et
 * transmission intégrale ; une consommation EPA porte « référence US ». Valeurs attendues : la
 * ligne Hilux des données de graine (`data/vehicle-catalog.json`) et 17 §3.2.3, jamais le code
 * testé. Le catalogue est commun aux pays (`market` nul) : chaque pays configuré (PA en USD, PY en
 * PYG, lus dans les données CFG) voit les mêmes lignes.
 *
 * Import de la douane (suite d'US-113, migration 0079, fixtures 9981, ADR-109) : variantes sans
 * fiche communes à tous les pays depuis 0095 (N-101, ADR-123 ; lot 2 : 0096) ; un hôte de CHAQUE
 * pays trouve la marque, le modèle et la variante, et le préremplissage ne rend que marque et
 * modèle (`specsComplete` faux, aucune valeur technique devinée).
 */
import { readFileSync } from 'node:fs';
import { connectAs, releaseClient } from '@rueda/db/testing';
// types du contexte fourni par le globalSetup du banc (inject('ruedaBench'))
import type {} from '@rueda/db/testing/global-setup';
import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countryCases } from '../../../../../test/support/countries.js';
import { parseCustomsCatalog } from './customs-import.js';
import { catalogId, parseVehicleCatalog } from './model.js';
import { US_REFERENCE_LABEL } from './prefill.js';
import { PgVehicleCatalogStore } from './store.js';
import { VehicleCatalogService } from './vehicle-catalog.service.js';

const SEED = parseVehicleCatalog(
  JSON.parse(readFileSync(new URL('../../data/vehicle-catalog.json', import.meta.url), 'utf8')),
);
const CUSTOMS_RAW = JSON.parse(
  readFileSync(new URL('../../data/vehicle-catalog-dnit.json', import.meta.url), 'utf8'),
) as unknown;
const CUSTOMS = parseCustomsCatalog(CUSTOMS_RAW, SEED);
/** Fixture 9981 : variante sans fiche commune aux pays. */
const SPECLESS_VARIANT = '11300000-0000-4000-8000-000000000d42';
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

describe.each(countryCases())(
  'import de la douane, hôte en $country ($currency)',
  ({ country }) => {
    const premio = catalogId('model/toyota/premio');
    const premioVariant = CUSTOMS.variants.find((v) => v.modelId === premio);

    it('liste de test du rapport : marques et modèles importés listés dans chaque pays (N-101)', async () => {
      const makes = (await catalog.listMakes(country)).map((m) => m.slug);
      for (const make of CUSTOMS.makes) expect(makes, make.slug).toContain(make.slug);
      // marques de la v1 : toujours listées (variantes communes)
      for (const make of SEED.makes) expect(makes).toContain(make.slug);
      const toyota = SEED.makes.find((m) => m.slug === 'toyota')?.id ?? '';
      const models = await catalog.listModels(toyota, country);
      expect(models.some((o) => o.slug === 'premio')).toBe(true);
      // lot 2 (0096) : JMC Vigor rétabli, proposé dans chaque pays
      const jmc = CUSTOMS.makes.find((m) => m.slug === 'jmc')?.id ?? '';
      expect((await catalog.listModels(jmc, country)).map((o) => o.slug)).toContain('vigor');
      expect(models.some((o) => o.slug === 'hilux')).toBe(true);
      // sans pays (compatibilité) : tout ce qui est ACTIVE
      expect((await catalog.listMakes()).length).toBeGreaterThanOrEqual(makes.length);
    });

    it('modèle importé : carrosserie nulle, variante sans fiche, préremplissage sans valeur devinée', async () => {
      if (premioVariant === undefined) throw new Error('Premio absent des données de la douane');
      const toyota = SEED.makes.find((m) => m.slug === 'toyota')?.id ?? '';
      const model = (await catalog.listModels(toyota)).find((o) => o.slug === 'premio');
      expect(model?.bodyType).toBeNull();
      const variants = await catalog.listVariants(premio, premioVariant.yearFrom, country);
      expect(variants.map((v) => v.id)).toEqual([premioVariant.id]);
      expect(variants[0]).toMatchObject({ transmission: null, fuelType: null, drive: null });
      expect(await catalog.prefill(premioVariant.id, country)).toMatchObject({
        makeName: 'Toyota',
        modelName: 'Premio',
        specsComplete: false,
        bodyType: null,
        seats: null,
        transmission: null,
        fuelType: null,
        allWheelDrive: null,
      });
    });

    it('Hilux de la v1 : années antérieures par la variante de la douane, fiche v1 intacte ensuite', async () => {
      const hilux = catalogId('model/toyota/hilux');
      const old = CUSTOMS.variants.find((v) => v.modelId === hilux);
      if (old === undefined) throw new Error('variante de la douane du Hilux absente');
      const before = await catalog.listVariants(hilux, old.yearFrom, country);
      expect(before.map((v) => v.id)).toEqual([old.id]);
      const recent = await catalog.listVariants(hilux, 2020, country);
      expect(recent.map((v) => v.transmission).sort()).toEqual(['AT', 'MT']);
    });

    it('fixture 9981 (sans fiche, commune) : choisissable dans chaque pays, specsComplete faux', async () => {
      const prefill = await catalog.prefill(SPECLESS_VARIANT, country);
      expect(prefill).toMatchObject({
        makeName: 'Marque douane de test',
        specsComplete: false,
        labels: { bodyType: null, gearbox: null, fuel: null, drive: null },
      });
    });
  },
);
