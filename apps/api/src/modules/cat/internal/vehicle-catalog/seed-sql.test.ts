/**
 * US-113 — graine du catalogue des véhicules : la section générée de la migration 0059 est le rendu
 * exact des données, et aucune ligne sans source ni licence ne peut être rendue (critère 1, côté
 * générateur ; côté base : test-migrations/9970 et test/l0/l0-us113-vehicle-catalog.test.ts).
 * Pour réécrire la section après une modification des données (avant toute application en
 * environnement partagé : une migration appliquée est immuable, ADR-044) :
 *   RUEDA_WRITE_CATALOG_SEED=1 pnpm --filter @rueda/api exec vitest run src/modules/cat
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CatalogError } from './errors.js';
import { catalogId, parseVehicleCatalog } from './model.js';
import {
  CATALOG_MIGRATION_FILE,
  extractSeedSection,
  renderVehicleCatalogSeedSql,
  SEED_BEGIN,
  SEED_END,
} from './seed-sql.js';

const dataUrl = new URL('../../data/vehicle-catalog.json', import.meta.url);
const migrationUrl = new URL(
  `../../../../../../../packages/db/migrations/${CATALOG_MIGRATION_FILE}`,
  import.meta.url,
);
const raw = (): Record<string, unknown> =>
  JSON.parse(readFileSync(dataUrl, 'utf8')) as Record<string, unknown>;

type Row = Record<string, unknown>;

const rowsOf = (row: Row, field: string): Row[] => {
  const v = row[field];
  if (!Array.isArray(v)) throw new Error(`${field} : liste attendue`);
  return v as Row[];
};
const at = (list: Row[], i: number): Row => {
  const r = list[i];
  if (r === undefined) throw new Error(`index ${i} absent`);
  return r;
};

/** Accès typé aux lignes d'une copie de la graine (les données du dépôt ne sont jamais touchées). */
interface Editable {
  readonly root: Row;
  provenance(name: string): Row;
  make(mi: number): Row;
  model(mi: number, oi: number): Row;
  variant(mi: number, oi: number, vi: number): Row;
}

function tampered(edit: (d: Editable) => void): unknown {
  const root = raw();
  const d: Editable = {
    root,
    provenance: (name) => (root['provenances'] as Record<string, Row>)[name] ?? {},
    make: (mi) => at(rowsOf(root, 'makes'), mi),
    model: (mi, oi) => at(rowsOf(d.make(mi), 'models'), oi),
    variant: (mi, oi, vi) => at(rowsOf(d.model(mi, oi), 'variants'), vi),
  };
  edit(d);
  return root;
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof CatalogError) return error.code;
    throw error;
  }
  return 'OK';
}

describe('migration 0059 : graine générée', () => {
  const seed = parseVehicleCatalog(raw());
  const rendered = renderVehicleCatalogSeedSql(seed);

  if (process.env['RUEDA_WRITE_CATALOG_SEED'] === '1') {
    const current = readFileSync(migrationUrl, 'utf8').replaceAll('\r\n', '\n');
    const section = extractSeedSection(current);
    if (section === null) throw new Error('marqueurs de graine absents de la migration');
    writeFileSync(migrationUrl, current.replace(section, rendered), 'utf8');
  }

  it(`${CATALOG_MIGRATION_FILE} contient exactement le rendu des données`, () => {
    const section = extractSeedSection(readFileSync(migrationUrl, 'utf8'));
    expect(section).toBe(rendered);
  });

  it('la graine se termine par la section générée (rien après le marqueur de fin)', () => {
    const text = readFileSync(migrationUrl, 'utf8').replaceAll('\r\n', '\n');
    expect(text.endsWith(`${SEED_END}\n`)).toBe(true);
    expect(text.indexOf(SEED_BEGIN)).toBeGreaterThan(text.indexOf('ENABLE ROW LEVEL SECURITY'));
  });

  it('une instruction INSERT par table, chaque ligne avec source et licence non vides', () => {
    const inserts = rendered.split('\n').filter((l) => l.startsWith('INSERT INTO'));
    expect(inserts).toEqual([
      'INSERT INTO core.catalog_vehicle_make',
      'INSERT INTO core.catalog_vehicle_model',
      'INSERT INTO core.catalog_vehicle_variant',
    ]);
    const rows = rendered.split('\n').filter((l) => l.startsWith("  ('"));
    const variants = seed.makes.flatMap((m) => m.models.flatMap((o) => o.variants));
    const models = seed.makes.flatMap((m) => m.models);
    expect(rows).toHaveLength(seed.makes.length + models.length + variants.length);
    for (const row of rows) {
      expect(row).toMatch(/'OPS_CURATED', '[^']+', '.{20,}'\)[,;]?$/);
      expect(row).not.toContain('NULL)');
    }
  });

  it('graine PROPOSÉE : aucune consommation EPA tant qu’OQ-CAT-01 (b) est ouverte', () => {
    expect(rendered).not.toContain('EPA_US_REFERENCE');
  });

  it('identifiants stables : même chemin, même UUID (version 8, variante RFC)', () => {
    const hilux = seed.makes
      .find((m) => m.slug === 'toyota')
      ?.models.find((o) => o.slug === 'hilux');
    expect(hilux?.id).toBe(catalogId('model/toyota/hilux'));
    expect(hilux?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const all = seed.makes.flatMap((m) => [
      m.id,
      ...m.models.flatMap((o) => [o.id, ...o.variants.map((v) => v.id)]),
    ]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('toute variante a places, boîte, carburant et transmission (préremplissage complet)', () => {
    for (const v of seed.makes.flatMap((m) => m.models.flatMap((o) => o.variants))) {
      expect(v.seats).toBeGreaterThan(0);
      expect(v.transmission).toBeTruthy();
      expect(v.fuelType).toBeTruthy();
      expect(v.drive).toBeTruthy();
    }
  });
});

describe('graine refusée sans source ni licence (critère 1, côté générateur)', () => {
  it('provenance sans licenseNote : CATALOG_SOURCE_MISSING, rien n’est rendu', () => {
    const doc = tampered((d) => {
      d.provenance('ops-us113-v1')['licenseNote'] = '   ';
    });
    expect(codeOf(() => parseVehicleCatalog(doc))).toBe('CATALOG_SOURCE_MISSING');
  });

  it('provenance sans source : CATALOG_SOURCE_MISSING', () => {
    const doc = tampered((d) => {
      delete d.provenance('ops-us113-v1')['source'];
    });
    expect(codeOf(() => parseVehicleCatalog(doc))).toBe('CATALOG_SOURCE_MISSING');
  });

  it('une seule variante sans provenance : CATALOG_SOURCE_MISSING, toute la graine est refusée', () => {
    const doc = tampered((d) => {
      delete d.variant(0, 0, 0)['provenance'];
    });
    try {
      parseVehicleCatalog(doc);
      expect.unreachable('la graine devait être refusée');
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogError);
      const e = error as CatalogError;
      expect(e.code).toBe('CATALOG_SOURCE_MISSING');
      expect(e.details.join('\n')).toContain('hilux');
    }
  });

  it('provenance inconnue : CATALOG_SOURCE_MISSING', () => {
    const doc = tampered((d) => {
      d.make(1)['provenance'] = 'inexistante';
    });
    expect(codeOf(() => parseVehicleCatalog(doc))).toBe('CATALOG_SOURCE_MISSING');
  });

  it('source à la licence non validée (NHTSA vPIC, OQ-CAT-01 a) : CATALOG_SOURCE_UNLICENSED', () => {
    const doc = tampered((d) => {
      (d.root['provenances'] as Record<string, Row>)['vpic'] = {
        source: 'NHTSA_VPIC',
        licenseNote: 'licence à valider',
      };
      d.make(0)['provenance'] = 'vpic';
    });
    expect(codeOf(() => parseVehicleCatalog(doc))).toBe('CATALOG_SOURCE_UNLICENSED');
  });

  it('consommation EPA tant que la licence n’est pas validée (OQ-CAT-01 b) : CATALOG_SOURCE_UNLICENSED', () => {
    const doc = tampered((d) => {
      d.variant(0, 1, 0)['consumption'] = {
        litersPer100km: '6.2',
        source: 'EPA_US_REFERENCE',
      };
    });
    expect(codeOf(() => parseVehicleCatalog(doc))).toBe('CATALOG_SOURCE_UNLICENSED');
  });

  it('consommation EPA acceptée une fois la licence validée, avec sa source', () => {
    const doc = tampered((d) => {
      ((d.root['consumptionLicenses'] as Record<string, Row>)['EPA_US_REFERENCE'] ?? {})['status'] =
        'VALIDATED';
      d.variant(0, 1, 0)['consumption'] = {
        litersPer100km: '6.2',
        source: 'EPA_US_REFERENCE',
      };
    });
    const seed = parseVehicleCatalog(doc);
    const v = seed.makes[0]?.models[1]?.variants[0];
    expect(v?.consumptionL100km).toBe('6.2');
    expect(v?.consumptionSource).toBe('EPA_US_REFERENCE');
    expect(renderVehicleCatalogSeedSql(seed)).toContain(", 6.2, 'EPA_US_REFERENCE', ");
  });

  it('consommation sans source : CATALOG_SOURCE_MISSING', () => {
    const doc = tampered((d) => {
      d.variant(0, 1, 0)['consumption'] = { litersPer100km: '6.2' };
    });
    expect(codeOf(() => parseVehicleCatalog(doc))).toBe('CATALOG_SOURCE_MISSING');
  });

  it.each([
    ['énumération inconnue', (d: Editable) => (d.variant(0, 0, 0)['drive'] = 'TRACTION')],
    ['année de fin antérieure', (d: Editable) => (d.variant(0, 0, 0)['yearTo'] = 2000)],
    ['slug en double', (d: Editable) => (d.make(1)['slug'] = d.make(0)['slug'])],
    ['modèle sans variante (OQ-CAT-01 g)', (d: Editable) => (d.model(0, 0)['variants'] = [])],
    ['places nulles', (d: Editable) => (d.variant(0, 0, 0)['seats'] = 0)],
  ])('donnée invalide (%s) : CATALOG_DATA_INVALID', (_label, edit) => {
    expect(codeOf(() => parseVehicleCatalog(tampered(edit)))).toBe('CATALOG_DATA_INVALID');
  });

  it('apostrophes échappées dans le SQL rendu', () => {
    const seed = parseVehicleCatalog(
      tampered((d) => {
        d.make(0)['name'] = "Toyo'ta";
      }),
    );
    expect(renderVehicleCatalogSeedSql(seed)).toContain("'Toyo''ta'");
  });
});
