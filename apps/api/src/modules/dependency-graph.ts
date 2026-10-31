/**
 * Graphe des dépendances autorisées entre modules (bounded contexts) — **donnée** lue par la
 * règle de lint `rueda/module-boundaries` (eslint.config.mjs) et par les tests.
 *
 * Source : 17 §2.1 (carte, flèches pleines = appels d'interface) et §2.2 (colonne « Dépend de »).
 * Les deux sont fusionnés ; la table de §2.2 est la plus complète.
 *
 * Socle implicite : tout module hors socle peut dépendre de CFG, AUD et BUS. 17 §2.1 dit que
 * « les modules du socle (CFG, AUD, BUS) ne dépendent de personne » : l'ajout implicite ne peut
 * donc pas créer de cycle. BUS (outbox et bus d'événements) figure dans la carte de §2.1 mais
 * pas dans la table de §2.2 ; il est créé comme module du socle.
 *
 * Toute modification de ce fichier est une décision d'architecture : ADR + report dans 17 §2.2,
 * revue de l'agent architecture (19 §1.4 point 4). Le test `dependency-graph.test.ts` garantit
 * que le graphe reste acyclique.
 *
 * Fichier sans import et en syntaxe effaçable : il est chargé directement par Node (eslint).
 */

export const MODULE_CODES = [
  'IAM',
  'KYC',
  'CAT',
  'AVL',
  'PRC',
  'CTR',
  'PAY',
  'STL',
  'PYO',
  'TRP',
  'CLM',
  'MSG',
  'NTF',
  'REV',
  'SUP',
  'FIN',
  'RISK',
  'CFG',
  'AUD',
  'RPT',
  'BUS',
] as const;

export type ModuleCode = (typeof MODULE_CODES)[number];

/** Modules du socle : aucune dépendance, dépendance implicite de tous les autres. */
export const SOCLE_MODULES: readonly ModuleCode[] = ['CFG', 'AUD', 'BUS'];

export interface ModuleSpec {
  readonly code: ModuleCode;
  /** Nom du module dans 17 §2.2. */
  readonly name: string;
  /** Responsabilité, résumée de 17 §2.2. */
  readonly responsibility: string;
  /** Dépendances explicites (17 §2.2 « Dépend de » ∪ flèches pleines de §2.1). */
  readonly dependsOn: readonly ModuleCode[];
  /** Référence de la ligne source dans 17. */
  readonly source: string;
}

function allExcept(...excluded: ModuleCode[]): ModuleCode[] {
  return MODULE_CODES.filter((c) => !excluded.includes(c) && !SOCLE_MODULES.includes(c));
}

export const MODULES: Readonly<Record<ModuleCode, ModuleSpec>> = {
  IAM: {
    code: 'IAM',
    name: 'Identity & Access',
    responsibility:
      'comptes, authentification, sessions, organisations, rôles et permissions, restrictions',
    dependsOn: ['CFG', 'NTF'],
    source: '17 §2.2 (NTF : envoi OTP)',
  },
  KYC: {
    code: 'KYC',
    name: 'KYC / KYB',
    responsibility:
      'vérification du conducteur, pièces, liveness, KYB des agences, sanctions, police flotte',
    dependsOn: ['IAM', 'CFG', 'AUD'],
    source: '17 §2.2 ; §2.1 KYC --> IAM',
  },
  CAT: {
    code: 'CAT',
    name: 'Catalog / Listings',
    responsibility:
      'lieux, véhicules, annonces, photos, politique de caution, import CSV, flux iCal',
    dependsOn: ['IAM', 'KYC', 'CFG'],
    source: '17 §2.2 ; §2.1 CAT --> KYC',
  },
  AVL: {
    code: 'AVL',
    name: 'Availability & Booking',
    responsibility: 'occupation unique, holds TTL, réservation, trip, annulations et no-shows',
    dependsOn: ['PRC', 'PAY', 'CTR', 'KYC', 'RISK', 'CAT', 'CFG'],
    source: '17 §2.2 ; §2.1 AVL --> PRC, PAY, CTR, RISK, KYC',
  },
  PRC: {
    code: 'PRC',
    name: 'Pricing & Quotes',
    responsibility: 'devis versionné, jours facturables, lignes, taxes, versions de prix du trip',
    dependsOn: ['CAT', 'CFG'],
    source: '17 §2.2 ; §2.1 PRC --> CFG, CAT',
  },
  CTR: {
    code: 'CTR',
    name: 'Contracts & Documents',
    responsibility:
      'gabarits juridiques, génération PDF, signature électronique, consentements, mandats',
    dependsOn: ['IAM', 'CFG', 'AUD'],
    source: '17 §2.2',
  },
  PAY: {
    code: 'PAY',
    name: 'Payments abstraction',
    responsibility:
      'adaptateurs PSP, opérations de paiement, commandes monétaires, webhooks, remboursements',
    dependsOn: ['CFG', 'CTR', 'AUD'],
    source: '17 §2.2 (CTR : mandat)',
  },
  STL: {
    code: 'STL',
    name: 'Settlement engine & Ledger',
    responsibility:
      'règlement économique pur, grand livre en partie double, host_ledger, commission',
    dependsOn: ['PRC', 'PAY', 'CFG'],
    source: '17 §2.2 ; §2.1 STL --> PAY, PRC (rupture du cycle STL ↔ PAY)',
  },
  PYO: {
    code: 'PYO',
    name: 'Payouts',
    responsibility: 'comptes de versement, lots de versement, compensation des débits (P0-B)',
    dependsOn: ['STL', 'PAY', 'KYC'],
    source: '17 §2.2 ; §2.1 PYO --> STL',
  },
  TRP: {
    code: 'TRP',
    name: 'Trip operations',
    responsibility: 'check-in, check-out, inspections, hors ligne, retards et non-restitution',
    dependsOn: ['AVL', 'KYC', 'PAY', 'AUD'],
    source: '17 §2.2 ; §2.1 TRP --> AVL, AUD',
  },
  CLM: {
    code: 'CLM',
    name: 'Claims & Disputes',
    responsibility:
      'dommages et incidents, factures annexes, litiges, dossiers de preuve, décisions',
    dependsOn: ['TRP', 'STL', 'PAY', 'AUD'],
    source: '17 §2.2 ; §2.1 CLM --> TRP, STL',
  },
  MSG: {
    code: 'MSG',
    name: 'Messaging',
    responsibility: 'fil par trip, masquage des coordonnées, détection du marché gris',
    dependsOn: ['IAM', 'AVL'],
    source: '17 §2.2 ; §2.1 MSG --> IAM',
  },
  NTF: {
    code: 'NTF',
    name: 'Notifications',
    responsibility:
      'règles événement → destinataires → canaux → gabarit, repli, idempotence, préférences',
    dependsOn: ['CFG'],
    source: '17 §2.2 ; §2.1 NTF --> CFG',
  },
  REV: {
    code: 'REV',
    name: 'Reviews',
    responsibility: 'avis guest, avis hôte (P1), agrégats',
    dependsOn: ['AVL'],
    source: '17 §2.2 ; §2.1 REV --> AVL',
  },
  SUP: {
    code: 'SUP',
    name: 'Support & back-office',
    responsibility:
      'console interne, fiche 360°, files de revue, dossiers de support, actions manuelles',
    // « tous (lecture), IAM » : tous sauf RPT (RPT lit SUP ; l'inverse créerait un cycle).
    dependsOn: allExcept('SUP', 'RPT'),
    source: '17 §2.2 (« tous (lecture), IAM ») ; §2.1 SUP --> CLM',
  },
  FIN: {
    code: 'FIN',
    name: 'Finance & Tax',
    responsibility:
      'configuration fiscale, documents fiscaux, relevés de commission, rapprochements',
    dependsOn: ['STL', 'CFG'],
    source: '17 §2.2 ; §2.1 FIN --> STL',
  },
  RISK: {
    code: 'RISK',
    name: 'Fraud / Risk',
    responsibility:
      'règles de risque, évaluation à la réservation, file de revue, journal explicable',
    dependsOn: ['IAM', 'KYC', 'CFG'],
    source: '17 §2.2',
  },
  CFG: {
    code: 'CFG',
    name: 'Country configuration',
    responsibility:
      'pays, devises, fuseaux, locales, paramètres versionnés, fériés, entités juridiques',
    dependsOn: [],
    source: '17 §2.2 (socle : aucune dépendance, §2.1)',
  },
  AUD: {
    code: 'AUD',
    name: 'Audit & Evidence store',
    responsibility:
      "journal d'audit chaîné, accès aux données, fichiers, clés par sujet, incidents",
    dependsOn: [],
    source: '17 §2.2 (socle : aucune dépendance, §2.1)',
  },
  RPT: {
    code: 'RPT',
    name: 'Reporting',
    responsibility: 'vues de lecture (tableaux de bord, KPI), exports CSV',
    // « lecture seule de tous ».
    dependsOn: allExcept('RPT'),
    source: '17 §2.2 (« lecture seule de tous »)',
  },
  BUS: {
    code: 'BUS',
    name: "Outbox et bus d'événements",
    responsibility: 'outbox transactionnelle et diffusion des événements de domaine (17 §4)',
    dependsOn: [],
    source: '17 §2.1 (socle, absent de la table §2.2)',
  },
};

/** Répertoire d'un module sous `apps/api/src/modules/`. */
export function moduleDir(code: ModuleCode): string {
  return code.toLowerCase();
}

/** Dépendances autorisées : explicites + socle implicite (hors socle). Triées, sans doublon. */
export function allowedDependencies(code: ModuleCode): ModuleCode[] {
  const spec = MODULES[code];
  const implicit = SOCLE_MODULES.includes(code) ? [] : SOCLE_MODULES;
  const all = new Set<ModuleCode>([...spec.dependsOn, ...implicit]);
  all.delete(code);
  return MODULE_CODES.filter((c) => all.has(c));
}

/** Chemin (segment) du dossier des modules, tel que vu par la règle de lint. */
export const MODULES_PATH = 'apps/api/src/modules';

/** Options de la règle `rueda/module-boundaries`. */
export function toModuleBoundariesOptions(): {
  modulesPath: string;
  modules: Record<string, { code: string; allowed: string[] }>;
} {
  const modules: Record<string, { code: string; allowed: string[] }> = {};
  for (const code of MODULE_CODES) {
    modules[moduleDir(code)] = { code, allowed: allowedDependencies(code).map(moduleDir) };
  }
  return { modulesPath: MODULES_PATH, modules };
}

/** Renvoie un cycle (liste de codes) s'il en existe un, sinon `null`. */
export function findCycle(
  edges: (code: ModuleCode) => readonly ModuleCode[] = allowedDependencies,
): ModuleCode[] | null {
  const state = new Map<ModuleCode, 'visiting' | 'done'>();
  const stack: ModuleCode[] = [];
  const visit = (code: ModuleCode): ModuleCode[] | null => {
    const s = state.get(code);
    if (s === 'done') return null;
    if (s === 'visiting') return [...stack.slice(stack.indexOf(code)), code];
    state.set(code, 'visiting');
    stack.push(code);
    for (const dep of edges(code)) {
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(code, 'done');
    return null;
  };
  for (const code of MODULE_CODES) {
    const cycle = visit(code);
    if (cycle) return cycle;
  }
  return null;
}
