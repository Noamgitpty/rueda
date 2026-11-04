/**
 * Inventaire des données personnelles (US-046, ADR-081 ; 17 §3.1.3, §3.1.4).
 *
 * `personal-data-inventory.json` classe CHAQUE colonne de CHAQUE table de production. Ce module :
 * - charge et valide l'inventaire (règles statiques, sans base) ;
 * - compare l'inventaire à une liste de colonnes réelles (catalogue PostgreSQL ou
 *   `docs/architecture/schema.md`, généré par la CI) : colonne non classée ou entrée orpheline ⇒
 *   échec ;
 * - vérifie sa cohérence avec la matrice d'autorisations d'US-043 (`authorization-matrix.json`).
 *
 * Les règles viennent de 17 §3.1.3 (classes A à E, crypto-shredding des registres immuables) et
 * §3.1.4 (C0 à C4) ; aucune ne vient du code testé.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../paths.ts';

export const DATA_CLASSES = ['C0', 'C1', 'C2', 'C3', 'C4'] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/** Classe de suppression (17 §3.1.3) ; T = technique (files, compteurs, journaux d'exploitation). */
export const LIFECYCLES = ['A', 'B', 'C', 'D', 'T'] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export const ERASURES = ['crypto-shredding', 'pseudonymisation', 'purge', 'derogation'] as const;
export type Erasure = (typeof ERASURES)[number];

export const EXPORT_CHANNELS = ['self', 'controller', 'none'] as const;
export type ExportChannel = (typeof EXPORT_CHANNELS)[number];

export type SubjectType = 'USER' | 'ORG';

export interface PersonalColumn {
  readonly class: DataClass;
  readonly erasure?: Erasure;
  /** Colonnes (type, identifiant) de la clé de sujet qui chiffre la valeur (crypto-shredding). */
  readonly key?: readonly [string, string];
  readonly justification?: string;
  /** Story qui lève la dérogation. */
  readonly report?: string;
  /** C4 lisible par app_api : justification obligatoire. */
  readonly apiRead?: string;
}

export type ColumnEntry = DataClass | PersonalColumn;

export interface InventoryTable {
  readonly lifecycle: Lifecycle;
  readonly subjects?: ReadonlyArray<{ readonly column: string; readonly type: SubjectType }>;
  readonly export: ExportChannel;
  /** Contenu de fichier hors base (magasin de preuves), chiffré par sujet. */
  readonly content?: {
    readonly erasure: 'crypto-shredding';
    readonly key: readonly [string, string];
    readonly classColumn: string;
  };
  readonly columns: Readonly<Record<string, ColumnEntry>>;
}

export interface PersonalDataInventory {
  readonly tables: Readonly<Record<string, InventoryTable>>;
}

export const DEFAULT_INVENTORY_PATH: string = join(PACKAGE_ROOT, 'personal-data-inventory.json');
export const DEFAULT_MATRIX_PATH: string = join(PACKAGE_ROOT, 'authorization-matrix.json');

export function loadPersonalDataInventory(file = DEFAULT_INVENTORY_PATH): PersonalDataInventory {
  return JSON.parse(readFileSync(file, 'utf8')) as PersonalDataInventory;
}

/** Classe d'une entrée de colonne. */
export const classOf = (entry: ColumnEntry): DataClass =>
  typeof entry === 'string' ? entry : entry.class;

/** Colonnes d'une classe donnée (ou de plusieurs). */
export function columnsOfClass(
  table: InventoryTable,
  classes: readonly DataClass[],
): Array<[string, ColumnEntry]> {
  return Object.entries(table.columns).filter(([, e]) => classes.includes(classOf(e)));
}

/**
 * Noms de colonnes qui désignent presque toujours une donnée personnelle ou un secret : dans une
 * table rattachée à une personne, une telle colonne doit être classée C2 ou plus (garde contre une
 * classification par défaut en C1).
 */
export const PERSONAL_NAME_PATTERN =
  /(^|_)(email|phone|phone_e164|first_name|last_name|display_name|date_of_birth|birth|ip|user_agent|address|tax_id|iban|account_number|document_number|license_number|password|token|secret|selfie|gps|lat|lng|latitude|longitude)(_enc)?$/;

/** Règles statiques de l'inventaire ; renvoie la liste des manquements (vide = conforme). */
export function checkInventoryRules(inventory: PersonalDataInventory): string[] {
  const errors: string[] = [];
  for (const [name, table] of Object.entries(inventory.tables)) {
    const at = (col?: string): string => (col ? `${name}.${col}` : name);
    if (!LIFECYCLES.includes(table.lifecycle)) errors.push(`${at()} : lifecycle invalide`);
    if (!EXPORT_CHANNELS.includes(table.export)) errors.push(`${at()} : export invalide`);
    for (const s of table.subjects ?? []) {
      if (!(s.column in table.columns)) errors.push(`${at()} : sujet ${s.column} absent`);
    }
    if (table.export === 'controller' && !(table.subjects?.length ?? 0)) {
      errors.push(`${at()} : export controller sans colonne de sujet`);
    }
    if (table.content) {
      for (const k of [...table.content.key, table.content.classColumn]) {
        if (!(k in table.columns)) errors.push(`${at()} : colonne ${k} du contenu absente`);
      }
    }
    for (const [col, entry] of Object.entries(table.columns)) {
      const cls = classOf(entry);
      if (!DATA_CLASSES.includes(cls)) {
        errors.push(`${at(col)} : classe ${String(cls)} inconnue`);
        continue;
      }
      const e = typeof entry === 'string' ? undefined : entry;
      if (cls === 'C2' || cls === 'C3') {
        if (!e?.erasure || !ERASURES.includes(e.erasure)) {
          errors.push(`${at(col)} : ${cls} sans méthode d'effacement`);
          continue;
        }
        if (table.lifecycle === 'A' && e.erasure === 'pseudonymisation') {
          // registre immuable : jamais d'UPDATE (17 §3.1.3) ; seule la destruction de clé efface
          errors.push(`${at(col)} : pseudonymisation impossible dans un registre immuable (A)`);
        }
        if (e.erasure === 'crypto-shredding') {
          const key = e.key;
          if (!key || key.length !== 2 || key.some((k) => !(k in table.columns))) {
            errors.push(`${at(col)} : crypto-shredding sans colonnes de clé (type, identifiant)`);
          }
          if (!col.endsWith('_enc')) errors.push(`${at(col)} : colonne chiffrée non suffixée _enc`);
        }
        if (e.erasure === 'derogation') {
          if (!e.justification || e.justification.trim().length < 40) {
            errors.push(`${at(col)} : dérogation sans justification (≥ 40 caractères)`);
          }
          if (!e.report || !/^US-\d{3}$/.test(e.report)) {
            errors.push(`${at(col)} : dérogation sans story de report (US-xxx)`);
          }
        }
      } else if (e?.erasure !== undefined) {
        errors.push(`${at(col)} : méthode d'effacement sur une colonne ${cls}`);
      }
      if (cls === 'C4' && !/(hash|_ref|dek|^key)$/.test(col)) {
        // un secret n'est stocké que haché, enveloppé ou par référence au coffre (17 §3.1.4)
        errors.push(
          `${at(col)} : C4 ni haché, ni enveloppé, ni référence (nom *_hash, *_ref, *dek)`,
        );
      }
      if (e?.apiRead !== undefined && cls !== 'C4') {
        errors.push(`${at(col)} : apiRead réservé au C4`);
      }
      if ((table.subjects?.length ?? 0) > 0 && PERSONAL_NAME_PATTERN.test(col)) {
        if (cls === 'C0' || cls === 'C1') {
          errors.push(
            `${at(col)} : nom de donnée personnelle classé ${cls} dans une table de sujet`,
          );
        }
      }
    }
  }
  return errors;
}

/** Colonnes réelles : `schema.table` → noms de colonnes. */
export type CatalogColumns = ReadonlyMap<string, readonly string[]>;

/** Compare l'inventaire aux colonnes réelles (catalogue ou document de schéma). */
export function checkInventoryCoverage(
  inventory: PersonalDataInventory,
  actual: CatalogColumns,
): string[] {
  const errors: string[] = [];
  for (const [table, cols] of actual) {
    const entry = inventory.tables[table];
    if (!entry) {
      errors.push(`${table} : table absente de l'inventaire (classer chacune de ses colonnes)`);
      continue;
    }
    for (const c of cols) {
      if (!(c in entry.columns)) errors.push(`${table}.${c} : colonne non classée`);
    }
    for (const c of Object.keys(entry.columns)) {
      if (!cols.includes(c)) errors.push(`${table}.${c} : entrée sans colonne`);
    }
  }
  for (const table of Object.keys(inventory.tables)) {
    if (!actual.has(table)) errors.push(`${table} : entrée sans table`);
  }
  return errors;
}

/**
 * Colonnes des tables de `docs/architecture/schema.md` (section « Tables », généré par la CI
 * depuis le catalogue de production, ADR-079).
 */
export function parseSchemaDocColumns(markdown: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let inTables = false;
  let current: string[] | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      inTables = line.startsWith('## Tables');
      current = undefined;
      continue;
    }
    if (!inTables) continue;
    const heading = /^### `([a-z_]+\.[a-z_0-9]+)`/.exec(line);
    if (heading) {
      current = [];
      out.set(heading[1] as string, current);
      continue;
    }
    const column = /^\| `([a-z_0-9]+)` \| `[^`]+` \| (oui|non) \|/.exec(line);
    if (column && current) current.push(column[1] as string);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Cohérence avec la matrice d'autorisations d'US-043
// ---------------------------------------------------------------------------------------------

type Grant = '*' | readonly string[] | undefined;

export interface AuthorizationMatrix {
  readonly relations: Readonly<
    Record<
      string,
      {
        readonly type: 'table' | 'view';
        readonly droits: Readonly<
          Record<'app_api' | 'app_worker' | 'app_anon', Readonly<Record<string, Grant>>>
        >;
        readonly lecture?: Readonly<Record<string, string>>;
      }
    >
  >;
}

export function loadAuthorizationMatrix(file = DEFAULT_MATRIX_PATH): AuthorizationMatrix {
  return JSON.parse(readFileSync(file, 'utf8')) as AuthorizationMatrix;
}

/** Acteurs d'`app_api` dont la lecture « personnelle » ouvre l'export en libre-service. */
export const SELF_ACTORS = ['voyageur', 'hote', 'cohote'] as const;
export type SelfActor = (typeof SELF_ACTORS)[number];

/** Prédicat de la matrice qui restreint aux lignes de l'acteur, de son compte ou de ses véhicules. */
export const isPersonalPredicate = (p: string | undefined): boolean =>
  typeof p === 'string' && /:acteur|:org|:vehicules/.test(p);

/** Colonnes lisibles par `role` d'après la matrice (toutes si `*`). */
export function grantedColumns(
  matrix: AuthorizationMatrix,
  inventory: PersonalDataInventory,
  relation: string,
  role: 'app_api' | 'app_worker' | 'app_anon',
): string[] {
  const grant = matrix.relations[relation]?.droits[role]?.['SELECT'];
  if (grant === undefined) return [];
  if (grant === '*') return Object.keys(inventory.tables[relation]?.columns ?? {});
  return [...grant];
}

/**
 * Cohérence inventaire × matrice (US-043) :
 * - app_anon ne lit aucune colonne C2, C3 ou C4 ;
 * - app_api ne lit aucune colonne C3 (lecture journalisée par fonction, 17 §3.1.4) ni C4 sans
 *   `apiRead` ;
 * - une table dont app_api lit une colonne C2 n'est lisible par un voyageur, un hôte, un co-hôte,
 *   un hôte à org forgée ou une session sans contexte que sur SES lignes (prédicat personnel) ou
 *   pas du tout ;
 * - export `self` ⇔ la matrice donne au voyageur, à l'hôte ou au co-hôte un prédicat personnel :
 *   l'export en libre-service couvre exactement ce que la personne peut lire d'elle-même.
 */
export function checkMatrixCoherence(
  inventory: PersonalDataInventory,
  matrix: AuthorizationMatrix,
): string[] {
  const errors: string[] = [];
  for (const [name, table] of Object.entries(inventory.tables)) {
    const rel = matrix.relations[name];
    if (!rel) {
      errors.push(`${name} : absente de la matrice d'autorisations (US-043)`);
      continue;
    }
    const anon = grantedColumns(matrix, inventory, name, 'app_anon');
    const api = grantedColumns(matrix, inventory, name, 'app_api');
    for (const col of anon) {
      const e = table.columns[col];
      if (e !== undefined && ['C2', 'C3', 'C4'].includes(classOf(e))) {
        errors.push(`${name}.${col} : ${classOf(e)} lisible par app_anon`);
      }
    }
    let apiReadsC2 = false;
    for (const col of api) {
      const e = table.columns[col];
      if (e === undefined) {
        errors.push(`${name}.${col} : droit de la matrice sur une colonne absente de l'inventaire`);
        continue;
      }
      const cls = classOf(e);
      if (cls === 'C3') errors.push(`${name}.${col} : C3 lisible par app_api`);
      if (cls === 'C4' && (typeof e === 'string' || !e.apiRead)) {
        errors.push(`${name}.${col} : C4 lisible par app_api sans justification (apiRead)`);
      }
      if (cls === 'C2') apiReadsC2 = true;
    }
    const lecture = rel.lecture ?? {};
    if (apiReadsC2) {
      for (const actor of ['sans_contexte', 'voyageur', 'hote', 'cohote', 'hote_org_forgee']) {
        // un voyageur, un hôte ou une session sans contexte ne lit des C2 que de SES lignes
        const p = lecture[actor];
        if (p === 'tout') {
          errors.push(`${name} : données C2 lisibles « tout » par l'acteur ${actor}`);
        } else if (p !== undefined && p !== 'aucune' && !isPersonalPredicate(p)) {
          errors.push(
            `${name} : données C2 lisibles par ${actor} hors de ses propres lignes (${p})`,
          );
        }
      }
    }
    const personal = SELF_ACTORS.some((a) => isPersonalPredicate(lecture[a]));
    if (rel.type === 'table') {
      if (personal && table.export !== 'self') {
        errors.push(`${name} : lisible par la personne (matrice) mais export ${table.export}`);
      }
      if (!personal && table.export === 'self') {
        errors.push(`${name} : export self sans prédicat personnel dans la matrice`);
      }
    }
  }
  return errors;
}
