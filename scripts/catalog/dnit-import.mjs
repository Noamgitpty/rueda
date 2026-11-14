#!/usr/bin/env node
// Construit apps/api/src/modules/cat/data/vehicle-catalog-dnit.json (suite d'US-113, ADR-109)
// depuis la liste normalisée des importations de la douane (DNIT – Gerencia General de Aduanas,
// données ouvertes, licence d'usage de l'information publique ; rapport d'analyse du 2026-11-12).
//
// Usage (une fois, par l'agent ou l'ops ; le JSON produit est la donnée versionnée qui fait foi) :
//   node scripts/catalog/dnit-import.mjs --csv <catalogue.csv> --market <code pays> [--min 30]
//
// Le CSV (colonnes marque, modele, annee_min, annee_max, unites_importees, premiere_importation,
// derniere_importation, exemples_libelles_bruts) est une DONNÉE externe : il n'est ni exécuté ni
// interprété, et ses exemples de libellés ne sont pas repris. Le pays du marché est un argument,
// jamais une constante du code (CLAUDE.md contrainte 3).
//
// Curation (PROPOSÉE, ADR-109) : seuil d'unités, libellés qui ne sont pas des modèles écartés,
// variantes d'écriture et alias rapprochés, noms commerciaux rétablis ; la graine v1
// (vehicle-catalog.json) garde ses lignes : un modèle déjà présent n'est jamais recréé, il ne
// reçoit qu'une variante de la douane pour les années que la v1 ne couvre pas.
//
// Lots (N-101, ADR-123) : une migration appliquée est immuable (ADR-044). Une ligne ajoutée après
// 0079 porte son lot (`LOTS`), rendu dans la migration de ce lot ; dès `SHARED_FROM_LOT`, la
// variante est commune à tous les pays (`market` nul), comme 0095 l'a fait pour le lot 1.
// L'empreinte SHA-256 du CSV est écrite dans le JSON (`sourceSha256`) : l'ops sait quel extrait a
// produit la liste ; rejouer le script sur un autre extrait change l'empreinte, visible au diff.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = new URL('../../', import.meta.url);
const V1 = new URL('apps/api/src/modules/cat/data/vehicle-catalog.json', ROOT);
const OUT = new URL('apps/api/src/modules/cat/data/vehicle-catalog-dnit.json', ROOT);
const PROVENANCE = 'dnit-aduanas-2026-11';
/** Dernière année d'import de l'échantillon dont l'absence vaut « modèle encore importé ». */
const STILL_IMPORTED_FROM = 2024;
const YEAR_FLOOR = 1950;

// ---- curation -----------------------------------------------------------------------------------
/** Libellés qui ne sont pas des modèles (mots du texte de la déclaration, codes d'usine, marques). */
const EXCLUDE = {
  Toyota: ['Sentadas', 'Destinados', 'Gran', 'Lan', 'Sportage'],
  Chevrolet: ['1-UNIDAD', 'Que', 'RLG26'],
  Hyundai: ['Mercancia', 'Naf'],
  Nissan: ['Sentadas', 'Sentada', 'Destinados', 'AX', 'UD'],
  Mitsubishi: ['Sentadas', 'Fuso'],
  Isuzu: ['Mercancia', 'QMR77L', 'QLR77L'],
  Suzuki: ['Sentadas', 'SV420D', 'MB308', 'YL4B', 'SDE8VXPA', 'Maruti'],
  Peugeot: ['Impulsado'],
  Haval: ['Cilind'],
  'Great Wall': ['Cil', 'Vehic'],
  DFSK: ['Total', 'Familiar', 'Sentadas'],
  JMC: ['Total', 'Kits', 'BD'],
  JAC: ['Lhd', 'Class'],
  Changan: ['Deepal'],
};

/**
 * Lignes ajoutées après la migration 0079 (lot 1) : marque → modèle → lot. Lot 2 (N-101, revue de
 * code US-113 n° 4) : JMC Vigor, vrai modèle (« CAMIONETA DOBLE CABINA MARCA JMC, MODELO VIGOR »),
 * écarté à tort par le lot 1.
 */
const LOTS = { JMC: { Vigor: 2 } };
/** Premier lot dont les variantes sont communes à tous les pays (0095 a ouvert le lot 1). */
const SHARED_FROM_LOT = 2;

/**
 * Variantes d'écriture, abréviations et noms régionaux rapprochés d'un modèle de la même marque.
 * Revus par N-101 sur les libellés bruts du CSV : « CHEVROLET TRUCKER LS 1.2 FLEX TURBO » est une
 * coquille du Tracker ; « MODELO ECO SPORT 1.4L » est l'EcoSport : rapprochements CONFIRMÉS.
 */
const MERGE = {
  Toyota: {
    Fun: 'Funcargo',
    Clavia: 'Vitz',
    Runner: '4RUNNER',
    Succed: 'Succeed',
    Regiusace: 'Hiace',
    Liteace: 'Townace',
  },
  Kia: { Morning: 'Picanto', 'Sephia-Ii': 'Sephia' },
  Chevrolet: { 'D-20': 'D20', 'C-10': 'C10', 'Cruze 5': 'Cruze', Trucker: 'Tracker' },
  Volkswagen: { Fusca: 'Escarabajo' },
  Hyundai: {
    Santafe: 'Santa Fe',
    'Grand Starex': 'H-1',
    Starex: 'H-1',
    H100: 'H-100',
    Grand: 'Grand I10',
    Avante: 'Elantra',
  },
  Nissan: { Navara: 'Frontier' },
  Mitsubishi: { Triton: 'L200', Strada: 'L200', Montero: 'Pajero' },
  Ford: {
    F1000: 'F-1000',
    F100: 'F-100',
    F150: 'F-150',
    F250: 'F-250',
    Versalles: 'Versailles',
    Sport: 'Ecosport',
  },
  Mazda: { BT50: 'BT-50', Axela: 'Mazda3' },
  Suzuki: { Gran: 'Grand Vitara' },
  Peugeot: { UP504: '504' },
  Chery: { T7: 'Tiggo 7' },
  Zotye: { Nomada: 'Nomad' },
};

/** Alias de recherche portés par le modèle cible d'un rapprochement (nouveaux modèles seulement). */
const MERGE_ALIASES = {
  Toyota: { Hiace: ['Regius Ace'], Townace: ['Lite Ace'] },
  Kia: { Picanto: ['Morning'] },
  Volkswagen: { Escarabajo: ['Fusca'] },
  Hyundai: { Elantra: ['Avante'] },
  Mitsubishi: { Pajero: ['Montero'] },
  Zotye: { Nomad: ['Nomada'] },
};

/** Noms commerciaux rétablis (casse, espaces, mots tronqués par l'extraction). */
const RENAME = {
  Toyota: { '4RUNNER': '4Runner', IQ: 'iQ', BB: 'bB', Touring: 'Touring Hiace' },
  Hyundai: { I30: 'i30', 'I-10': 'i10', 'Grand I10': 'Grand i10' },
  Nissan: { Up: 'Pick Up' },
  Mitsubishi: { Rvr: 'RVR', Fto: 'FTO', 'Pajero IO': 'Pajero iO' },
  Ford: { KA: 'Ka', Rey: 'Del Rey', F350: 'F-350' },
  BMW: { IX1: 'iX1' },
  MG: { Ehs: 'EHS' },
  Mini: { Jcw: 'JCW' },
  Audi: { 'E-Tron': 'e-tron' },
  BYD: { FO: 'F0', TI: 'Ti7', 'Yuan PRO': 'Yuan Pro', 'Song PRO': 'Song Pro' },
  JMC: { Up: 'Pick Up' },
  Mahindra: { Pik: 'Pik Up' },
  Tata: { Super: 'Super Ace' },
};

/** Alias des nouveaux modèles (abréviation de la douane ou nom commercial voisin). */
const MODEL_ALIASES = {
  Chery: { T2: ['Tiggo 2 Pro'], T4: ['Tiggo 4 Pro'], T8: ['Tiggo 8 Pro'], T9: ['Tiggo 9'] },
};

/**
 * Marques nouvelles : nom affiché et alias (nom court ou nom du groupe). Un alias qui ne diffère du
 * nom que par la casse, les accents ou la ponctuation est inutile : le générateur le refuse.
 */
const MAKE_NAMES = { Citroen: 'Citroën' };
const MAKE_ALIASES = {
  'Mercedes-Benz': ['Mercedes'],
  'Great Wall': ['GWM'],
  SsangYong: ['KGM', 'KG Mobility'],
  DFSK: ['Dongfeng Sokon'],
  MG: ['Morris Garages'],
};

// ---- outils -------------------------------------------------------------------------------------
export const slugOf = (s) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
export const keyOf = (s) => slugOf(s).replaceAll('-', '');

/** CSV RFC 4180 minimal (guillemets doublés), en-tête en première ligne. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) rows.push([...row, cell]);
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const int = (v) => (v === '' ? null : Number.parseInt(v, 10));

function main() {
  const { values } = parseArgs({
    options: {
      csv: { type: 'string' },
      market: { type: 'string' },
      min: { type: 'string', default: '30' },
    },
  });
  if (!values.csv || !/^[A-Z]{2}$/.test(values.market ?? '')) {
    console.error('usage : dnit-import.mjs --csv <fichier> --market <code pays> [--min 30]');
    process.exit(2);
  }
  const minUnits = Number.parseInt(values.min, 10);
  const v1 = JSON.parse(readFileSync(V1, 'utf8'));
  const csvBytes = readFileSync(values.csv);
  const sourceSha256 = createHash('sha256').update(csvBytes).digest('hex');
  const all = parseCsv(csvBytes.toString('utf8'));
  const kept = all.filter((r) => int(r.unites_importees) >= minUnits);

  const stats = { csvRows: all.length, aboveMin: kept.length, excluded: [], merged: [], v1: [] };
  /** marque → nom final → agrégat */
  const byMake = new Map();
  for (const r of kept) {
    const make = r.marque;
    let name = r.modele;
    if ((EXCLUDE[make] ?? []).includes(name)) {
      stats.excluded.push(`${make} ${name}`);
      continue;
    }
    if (MERGE[make]?.[name] !== undefined) {
      stats.merged.push(`${make} ${name} → ${MERGE[make][name]}`);
      name = MERGE[make][name];
    }
    name = RENAME[make]?.[name] ?? name;
    const models = byMake.get(make) ?? new Map();
    byMake.set(make, models);
    const a = models.get(name) ?? {
      name,
      yearMin: null,
      yearMax: null,
      units: 0,
      firstImport: null,
      lastImport: null,
      sources: 0,
    };
    const lo = int(r.annee_min);
    const hi = int(r.annee_max);
    if (lo !== null) a.yearMin = a.yearMin === null ? lo : Math.min(a.yearMin, lo);
    if (hi !== null) a.yearMax = a.yearMax === null ? hi : Math.max(a.yearMax, hi);
    a.units += int(r.unites_importees);
    const first = int(r.premiere_importation);
    const last = int(r.derniere_importation);
    a.firstImport = a.firstImport === null ? first : Math.min(a.firstImport, first);
    a.lastImport = a.lastImport === null ? last : Math.max(a.lastImport, last);
    a.sources += 1;
    models.set(name, a);
  }

  const v1Makes = new Map(v1.makes.map((m) => [keyOf(m.name), m]));
  for (const m of v1.makes) for (const a of m.aliases ?? []) v1Makes.set(keyOf(a), m);

  const makes = [];
  for (const [make, models] of byMake) {
    const existing = v1Makes.get(keyOf(make));
    const makeSlug = existing?.slug ?? slugOf(make);
    const v1Models = new Map();
    for (const o of existing?.models ?? []) {
      v1Models.set(keyOf(o.name), o);
      for (const a of o.aliases ?? []) v1Models.set(keyOf(a), o);
    }
    const out = [];
    for (const a of models.values()) {
      const lastSeen = a.lastImport ?? 0;
      let yearFrom = Math.max(YEAR_FLOOR, a.yearMin ?? (a.firstImport ?? YEAR_FLOOR) - 1);
      let yearTo = lastSeen >= STILL_IMPORTED_FROM ? null : a.yearMax;
      const v1Model = v1Models.get(keyOf(a.name));
      const lot = LOTS[make]?.[a.name];
      const entry = v1Model
        ? { slug: v1Model.slug, name: v1Model.name, existing: true }
        : { slug: slugOf(a.name), name: a.name, ...(lot ? { lot } : {}) };
      if (v1Model) {
        // variante de la douane seulement pour les années antérieures à la v1
        const v1From = Math.min(...v1Model.variants.map((v) => v.yearFrom));
        stats.v1.push(`${make} ${a.name} → ${v1Model.name} (v1 dès ${v1From})`);
        if (yearFrom >= v1From) {
          entry.variant = null;
        } else {
          yearTo = v1From - 1;
          entry.variant = { yearFrom, yearTo };
        }
      } else {
        if (yearTo !== null && yearTo < yearFrom) yearTo = yearFrom;
        const aliases = [
          ...(MERGE_ALIASES[make]?.[a.name] ?? []),
          ...(MODEL_ALIASES[make]?.[a.name] ?? []),
        ];
        if (aliases.length > 0) entry.aliases = aliases;
        entry.variant = { yearFrom, yearTo };
      }
      entry.provenance = PROVENANCE;
      entry.units = a.units;
      entry.imported = [a.firstImport, a.lastImport];
      out.push(entry);
    }
    out.sort((x, y) => x.name.localeCompare(y.name, 'en') || x.slug.localeCompare(y.slug));
    const makeEntry = existing
      ? { slug: makeSlug, name: existing.name, existing: true }
      : {
          slug: makeSlug,
          name: MAKE_NAMES[make] ?? make,
          ...(MAKE_ALIASES[make] ? { aliases: MAKE_ALIASES[make] } : {}),
        };
    makes.push({ ...makeEntry, provenance: PROVENANCE, models: out });
  }
  makes.sort((x, y) => x.name.localeCompare(y.name, 'en'));

  const doc = {
    $comment:
      "Import de la douane du Paraguay (suite d'US-113, ADR-109) : marques et modèles d'au moins `minUnits` unités importées (8703 et 8704 jusqu'à 5 t, régimes définitifs, échantillon 1997–2026), normalisés et rapprochés de la graine v1 par scripts/catalog/dnit-import.mjs. Aucune caractéristique technique : la douane n'en donne pas (à compléter par l'ops). `existing` : ligne de la graine v1, jamais recréée ; `variant` : variante sans fiche, années indicatives, insérée au marché `market` (pays de la source) pour le lot 1, commune à tous les pays dès `sharedFromLot` (la migration 0095 a rendu communes celles du lot 1, ADR-123) ; `lot` : lot d'import (1 par défaut : migration 0079 ; 2 : 0096) ; `sourceSha256` : empreinte du CSV source ; `units` et `imported` : traçabilité, jamais chargés. Rendu : apps/api/src/modules/cat/internal/vehicle-catalog/customs-import.ts.",
    version: 1,
    market: values.market,
    sharedFromLot: SHARED_FROM_LOT,
    sourceSha256,
    minUnits,
    sourceLicenses: {
      DNIT_ADUANAS_PY: {
        status: 'VALIDATED',
        note: 'Licencia de Uso de la Información Pública del Gobierno Paraguayo (Decreto 4064, Ley 5282/2014) : copier, extraire, transformer, citer la source et la date, sans aval officiel ; CONFIRMÉE par le rapport du 2026-11-12, ce n’est pas un avis juridique',
      },
    },
    provenances: {
      [PROVENANCE]: {
        source: 'DNIT_ADUANAS_PY',
        sourceRef:
          'DNIT-Aduanas SOFIA, datosabiertos.aduana.gov.py, ítems 8703 y 8704 ≤ 5 t, muestra 1997–2026 extraída el 2026-11-12, catálogo DNIT v1',
        licenseNote:
          'Datos abiertos de la DNIT – Gerencia General de Aduanas (https://datosabiertos.aduana.gov.py), última actualización: octubre 2026, consultado 2026-11-12. Licencia de Uso de la Información Pública del Gobierno Paraguayo (Decreto 4064 / Ley 5282/2014, https://www.paraguay.gov.py/datos-abiertos/licencias): uso y transformación libres citando la fuente y la fecha; normalización propia de la plataforma, sin aval oficial del Estado paraguayo.',
      },
    },
    makes,
  };
  writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
  const newMakes = makes.filter((m) => !m.existing).length;
  const models = makes.flatMap((m) => m.models);
  console.log(
    JSON.stringify(
      {
        ...stats,
        makes: makes.length,
        newMakes,
        newModels: models.filter((o) => !o.existing).length,
        v1Models: models.filter((o) => o.existing).length,
        v1Extended: models.filter((o) => o.existing && o.variant).length,
        unitsKept: models.reduce((s, o) => s + o.units, 0),
      },
      null,
      1,
    ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
