/**
 * Suite d'US-113 — import de la douane (ADR-109 ; lots et catalogue partagé : N-101, ADR-123) : la
 * section générée de chaque migration de lot (0079 pour le lot 1, 0096 pour le lot 2) est le rendu
 * exact des données, aucune ligne sans source ni licence validée ne peut être rendue, aucune
 * ligne ne double la graine v1, et la v1 n'est jamais recréée ni chevauchée.
 * Côté base : test-migrations/9981 (sous migrator) et test/l0/l0-us113-customs-import.test.ts.
 * Réécrire la section après une modification des données (avant toute application en environnement
 * partagé : une migration appliquée est immuable, ADR-044) :
 *   RUEDA_WRITE_CATALOG_SEED=1 pnpm --filter @rueda/api exec vitest run src/modules/cat
 * Valeurs attendues : le rapport d'import du 2026-11-12 (liste de test de SRC_VEHICLE_DATA §1) et
 * les données elles-mêmes, jamais le code testé.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CatalogError } from './errors.js';
import { catalogId, parseVehicleCatalog } from './model.js';
import {
  CUSTOMS_BEGIN,
  CUSTOMS_END,
  CUSTOMS_MIGRATION_FILE,
  CUSTOMS_MIGRATIONS,
  duplicateKey,
  extractCustomsSection,
  parseCustomsCatalog,
  renderCustomsSeedSql,
} from './customs-import.js';

const v1Url = new URL('../../data/vehicle-catalog.json', import.meta.url);
const dataUrl = new URL('../../data/vehicle-catalog-dnit.json', import.meta.url);
const migrationUrlOf = (file: string): URL =>
  new URL(`../../../../../../../packages/db/migrations/${file}`, import.meta.url);
const migrationUrl = migrationUrlOf(CUSTOMS_MIGRATION_FILE);
const V1 = parseVehicleCatalog(JSON.parse(readFileSync(v1Url, 'utf8')) as unknown);

type Row = Record<string, unknown>;
const raw = (): Row => JSON.parse(readFileSync(dataUrl, 'utf8')) as Row;
const makesOf = (d: Row): Row[] => d['makes'] as Row[];
const modelsOf = (m: Row): Row[] => m['models'] as Row[];
const makeBySlug = (d: Row, slug: string): Row => {
  const m = makesOf(d).find((x) => x['slug'] === slug);
  if (m === undefined) throw new Error(`marque ${slug} absente des données`);
  return m;
};
const firstNew = (d: Row): { make: Row; model: Row } => {
  const make = makesOf(d).find((m) => m['existing'] !== true);
  const model = make && modelsOf(make)[0];
  if (!make || !model) throw new Error('aucune marque nouvelle dans les données');
  return { make, model };
};

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof CatalogError) return error.code;
    throw error;
  }
  return 'OK';
}

describe('migrations 0079 et 0096 : graine générée de la douane, un lot par migration', () => {
  const data = parseCustomsCatalog(raw(), V1);
  const rendered = renderCustomsSeedSql(data);

  if (process.env['RUEDA_WRITE_CATALOG_SEED'] === '1') {
    for (const [lot, file] of Object.entries(CUSTOMS_MIGRATIONS)) {
      const url = migrationUrlOf(file);
      const current = readFileSync(url, 'utf8').replaceAll('\r\n', '\n');
      const begin = current.indexOf(CUSTOMS_BEGIN);
      const end = current.indexOf(CUSTOMS_END);
      if (begin < 0 || end < begin) throw new Error(`marqueurs absents de la migration ${file}`);
      writeFileSync(
        url,
        current.slice(0, begin) +
          renderCustomsSeedSql(data, Number(lot)) +
          current.slice(end + CUSTOMS_END.length + 1),
      );
    }
  }

  it('la section de la migration est le rendu exact des données', () => {
    const section = extractCustomsSection(readFileSync(migrationUrl, 'utf8'));
    expect(section).toBe(rendered);
  });

  it('chaque lot a sa migration, dont la section est le rendu exact de ses seules lignes', () => {
    expect(CUSTOMS_MIGRATIONS[1]).toBe(CUSTOMS_MIGRATION_FILE);
    const lots = new Set([...data.makes, ...data.models, ...data.variants].map((x) => x.lot));
    for (const lot of lots) expect(CUSTOMS_MIGRATIONS[lot], `lot ${lot}`).toBeDefined();
    for (const [lot, file] of Object.entries(CUSTOMS_MIGRATIONS)) {
      const url = migrationUrlOf(file);
      expect(existsSync(url), file).toBe(true);
      expect(extractCustomsSection(readFileSync(url, 'utf8')), file).toBe(
        renderCustomsSeedSql(data, Number(lot)),
      );
    }
    // une ligne n'est rendue que dans la migration de son lot (jamais deux fois)
    const lot2 = renderCustomsSeedSql(data, 2);
    for (const v of data.variants.filter((x) => x.lot === 1))
      expect(lot2.includes(v.id), v.modelSlug).toBe(false);
  });

  it('lot 2 (N-101) : JMC Vigor rétabli, variante sans fiche commune à tous les pays', () => {
    const jmc = data.makes.find((m) => m.slug === 'jmc');
    const vigor = data.models.find((o) => o.slug === 'vigor' && o.makeId === jmc?.id);
    expect(jmc?.lot).toBe(1);
    expect(vigor?.lot).toBe(2);
    const variant = data.variants.find((v) => v.modelId === vigor?.id);
    // rapport : JMC Vigor, 34 unités importées de 2015 à 2018, sans année-modèle lue
    expect(variant).toMatchObject({ lot: 2, market: null, yearFrom: 2014, yearTo: null });
    const sql = renderCustomsSeedSql(data, 2);
    expect(sql).not.toContain('INSERT INTO core.catalog_vehicle_make');
    expect(sql).toContain(`'${vigor?.id ?? '?'}'`);
    expect(sql).toMatch(/, NULL, 1\)\n {2}\) AS r \(id, model_id, year_from, year_to, market/);
  });

  it('empreinte du CSV source consignée (revue de code US-113 n° 3)', () => {
    expect(data.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    // extrait du 2026-11-12 joint au rapport d'analyse (catalogue-douane-py.csv)
    expect(data.sourceSha256).toBe(
      'e72363eea995bc7212c6f12c5267909b51c19e6084201c38552dd15135bd401a',
    );
    expect(createHash('sha256').update('').digest('hex')).not.toBe(data.sourceSha256);
  });

  it('au moins 600 modèles nouveaux et 50 marques nouvelles, chacun avec une variante sans fiche', () => {
    // rapport : 758 modèles d'au moins 30 unités, 66 marques, moins les libellés écartés et les
    // doublons rapprochés de la v1 (14 marques, 43 modèles)
    expect(data.makes.length).toBeGreaterThanOrEqual(50);
    expect(data.models.length).toBeGreaterThanOrEqual(600);
    expect(data.existing).toEqual({ makes: 14, models: 43 });
    const withVariant = new Set(data.variants.map((v) => v.modelId));
    for (const o of data.models) expect(withVariant.has(o.id), o.slug).toBe(true);
    for (const v of data.variants) {
      // marché à l'insertion : la source pour le lot 1 (0079), commun dès sharedFromLot (ADR-123)
      expect(v.market).toBe(v.lot >= data.sharedFromLot ? null : raw()['market']);
      expect(v.provenance.source).toBe('DNIT_ADUANAS_PY');
    }
  });

  it('chaque ligne porte source DNIT_ADUANAS_PY et la note de licence du rapport', () => {
    for (const row of [...data.makes, ...data.models, ...data.variants]) {
      expect(row.provenance.source).toBe('DNIT_ADUANAS_PY');
      expect(row.provenance.licenseNote).toContain(
        'Licencia de Uso de la Información Pública del Gobierno Paraguayo',
      );
      expect(row.provenance.licenseNote).toContain('última actualización: octubre 2026');
      expect(row.provenance.licenseNote).toContain('sin aval oficial');
    }
  });

  it('liste de test du rapport (SRC_VEHICLE_DATA §1) : chaque modèle est au catalogue', () => {
    const names = new Set<string>();
    for (const m of V1.makes) for (const o of m.models) names.add(`${m.name}|${o.name}`);
    const makeName = new Map([...V1.makes, ...data.makes].map((m) => [m.id, m.name]));
    for (const o of data.models) names.add(`${makeName.get(o.makeId) ?? '?'}|${o.name}`);
    for (const expected of [
      'Toyota|Hilux',
      'Chevrolet|S10',
      'Nissan|Frontier',
      'Toyota|Fortuner',
      'Toyota|Rush',
      'Mitsubishi|L200',
      'Suzuki|Swift',
      'Toyota|Yaris',
      'Toyota|Yaris Cross',
      'Kia|Picanto',
      'Fiat|Strada',
      'Chevrolet|Onix',
      'Hyundai|Creta',
      'Nissan|Kicks',
      'Hyundai|Accent',
      'Suzuki|Vitara',
      'Suzuki|Grand Vitara',
      'Toyota|Vitz',
      'Toyota|Premio',
      'Geely|Coolray',
      'BYD|Song Plus',
      'Haval|H6',
      'Great Wall|Wingle',
    ]) {
      expect(names.has(expected), expected).toBe(true);
    }
  });

  it('aucun doublon : marques et modèles uniques après normalisation (casse, accents, ponctuation)', () => {
    const makeKeys = [...V1.makes, ...data.makes].map((m) => duplicateKey(m.name));
    expect(new Set(makeKeys).size).toBe(makeKeys.length);
    const byMake = new Map<string, string[]>();
    for (const m of V1.makes)
      byMake.set(
        m.id,
        m.models.map((o) => duplicateKey(o.name)),
      );
    for (const o of data.models) {
      byMake.set(o.makeId, [...(byMake.get(o.makeId) ?? []), duplicateKey(o.name)]);
    }
    for (const [make, keys] of byMake) expect(new Set(keys).size, make).toBe(keys.length);
    const ids = [...data.makes, ...data.models, ...data.variants].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('la v1 garde ses lignes : aucune marque ni aucun modèle recréé, aucune année chevauchée', () => {
    const v1Ids = new Set(V1.makes.flatMap((m) => [m.id, ...m.models.map((o) => o.id)]));
    for (const x of [...data.makes, ...data.models]) expect(v1Ids.has(x.id), x.slug).toBe(false);
    const v1Models = new Map(V1.makes.flatMap((m) => m.models.map((o) => [o.id, o] as const)));
    const extended = data.variants.filter((v) => v1Models.has(v.modelId));
    expect(extended.length).toBeGreaterThan(0);
    for (const v of extended) {
      const from = Math.min(...(v1Models.get(v.modelId)?.variants ?? []).map((x) => x.yearFrom));
      expect(v.yearTo, v.modelSlug).not.toBeNull();
      expect(v.yearTo ?? Infinity, v.modelSlug).toBeLessThan(from);
    }
    // Hilux de la v1 : identifiant stable, une variante de la douane pour les années antérieures
    const hilux = catalogId('model/toyota/hilux');
    expect(extended.some((v) => v.modelId === hilux)).toBe(true);
  });
});

describe('le générateur refuse fail-closed', () => {
  it('ligne sans provenance ⇒ CATALOG_SOURCE_MISSING', () => {
    const d = raw();
    delete firstNew(d).model['provenance'];
    expect(codeOf(() => parseCustomsCatalog(d, V1))).toBe('CATALOG_SOURCE_MISSING');
  });

  it('provenance sans licenseNote ni source ⇒ CATALOG_SOURCE_MISSING', () => {
    for (const field of ['licenseNote', 'source']) {
      const d = raw();
      for (const p of Object.values(d['provenances'] as Record<string, Row>)) p[field] = '  ';
      expect(
        codeOf(() => parseCustomsCatalog(d, V1)),
        field,
      ).toBe('CATALOG_SOURCE_MISSING');
    }
  });

  it('licence de la source non validée ⇒ CATALOG_SOURCE_UNLICENSED', () => {
    const d = raw();
    (d['sourceLicenses'] as Record<string, Row>)['DNIT_ADUANAS_PY'] = { status: 'TO_VALIDATE' };
    expect(codeOf(() => parseCustomsCatalog(d, V1))).toBe('CATALOG_SOURCE_UNLICENSED');
  });

  it('source qui doit fournir une fiche (OPS_CURATED) ⇒ CATALOG_DATA_INVALID', () => {
    const d = raw();
    for (const p of Object.values(d['provenances'] as Record<string, Row>))
      p['source'] = 'OPS_CURATED';
    (d['sourceLicenses'] as Record<string, Row>)['OPS_CURATED'] = { status: 'VALIDATED' };
    expect(codeOf(() => parseCustomsCatalog(d, V1))).toBe('CATALOG_DATA_INVALID');
  });

  it('doublon d’un modèle de la v1 sous un autre slug (« D MAX ») ⇒ CATALOG_DATA_INVALID', () => {
    const d = raw();
    modelsOf(makeBySlug(d, 'isuzu')).push({
      slug: 'd-max-bis',
      name: 'D MAX',
      provenance: Object.keys(d['provenances'] as Row)[0],
      variant: { yearFrom: 2005, yearTo: null },
    });
    expect(codeOf(() => parseCustomsCatalog(d, V1))).toBe('CATALOG_DATA_INVALID');
  });

  it('marque nouvelle qui double une marque de la v1 (« TOYOTA ») ⇒ CATALOG_DATA_INVALID', () => {
    const d = raw();
    const { make } = firstNew(d);
    make['aliases'] = ['TOYOTA'];
    expect(codeOf(() => parseCustomsCatalog(d, V1))).toBe('CATALOG_DATA_INVALID');
  });

  it('modèle de la v1 recréé (sans « existing ») ou modifié (alias) ⇒ CATALOG_DATA_INVALID', () => {
    const d = raw();
    const hilux = modelsOf(makeBySlug(d, 'toyota')).find((o) => o['slug'] === 'hilux');
    if (!hilux) throw new Error('Hilux absent des données');
    delete hilux['existing'];
    expect(codeOf(() => parseCustomsCatalog(d, V1))).toBe('CATALOG_DATA_INVALID');
    const e = raw();
    const h2 = modelsOf(makeBySlug(e, 'toyota')).find((o) => o['slug'] === 'hilux');
    if (!h2) throw new Error('Hilux absent des données');
    h2['aliases'] = ['Vigo'];
    expect(codeOf(() => parseCustomsCatalog(e, V1))).toBe('CATALOG_DATA_INVALID');
  });

  it('variante de la douane qui chevauche les années de la v1 ⇒ CATALOG_DATA_INVALID', () => {
    const d = raw();
    const hilux = modelsOf(makeBySlug(d, 'toyota')).find((o) => o['slug'] === 'hilux');
    if (!hilux) throw new Error('Hilux absent des données');
    hilux['variant'] = { yearFrom: 1989, yearTo: null };
    expect(codeOf(() => parseCustomsCatalog(d, V1))).toBe('CATALOG_DATA_INVALID');
  });

  it('modèle nouveau sans variante, années invalides, marché absent ⇒ CATALOG_DATA_INVALID', () => {
    const cases: Array<(d: Row) => void> = [
      (d) => {
        firstNew(d).model['variant'] = null;
      },
      (d) => {
        firstNew(d).model['variant'] = { yearFrom: 1949, yearTo: null };
      },
      (d) => {
        firstNew(d).model['variant'] = { yearFrom: 2020, yearTo: 2019 };
      },
      (d) => {
        delete d['market'];
      },
    ];
    for (const [i, edit] of cases.entries()) {
      const d = raw();
      edit(d);
      expect(
        codeOf(() => parseCustomsCatalog(d, V1)),
        `cas ${i}`,
      ).toBe('CATALOG_DATA_INVALID');
    }
  });

  it('lot inconnu, lot d’un modèle antérieur à sa marque, lot sur une ligne de la v1, partage ou empreinte invalides ⇒ CATALOG_DATA_INVALID', () => {
    const cases: Array<(d: Row) => void> = [
      (d) => {
        firstNew(d).model['lot'] = 99;
      },
      (d) => {
        firstNew(d).model['lot'] = 0;
      },
      (d) => {
        const { make } = firstNew(d);
        make['lot'] = 2;
        for (const o of modelsOf(make)) delete o['lot'];
      },
      (d) => {
        makeBySlug(d, 'toyota')['lot'] = 2;
      },
      (d) => {
        delete d['sharedFromLot'];
      },
      (d) => {
        d['sourceSha256'] = 'abc';
      },
      (d) => {
        delete d['sourceSha256'];
      },
    ];
    for (const [i, edit] of cases.entries()) {
      const d = raw();
      edit(d);
      expect(
        codeOf(() => parseCustomsCatalog(d, V1)),
        `cas ${i}`,
      ).toBe('CATALOG_DATA_INVALID');
    }
  });

  it('aucune ligne rendue tant qu’un défaut subsiste', () => {
    const d = raw();
    delete firstNew(d).make['provenance'];
    expect(() => parseCustomsCatalog(d, V1)).toThrow(CatalogError);
  });
});
