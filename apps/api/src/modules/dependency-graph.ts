/**
 * Graphe des dépendances autorisées entre modules (bounded contexts) — **donnée** lue par la
 * règle de lint `rueda/module-boundaries` (eslint.config.mjs) et par les tests.
 *
 * Source : 17 §2.1 (carte, flèches pleines = appels d'interface) et §2.2 (colonne « Dépend de »).
 * Les deux sont fusionnés ; la table de §2.2 est la plus complète. `docs-sync.test.ts` (US-038)
 * compare `dependsOn` à la colonne « Dépend de » de 17 §2.2 : un écart non listé y fait échouer la CI.
 *
 * Socle implicite : tout module hors socle peut dépendre de CFG, AUD et BUS. Dans le socle,
 * BUS ne dépend de personne ; CFG et AUD ne dépendent que de BUS, car ils publient des
 * événements par l'outbox (`config.param.changed`, `privacy.dsr.status_changed`,
 * `security.incident.opened`, 17 §2.2). 17 §2.1 dit « le socle ne dépend de personne » :
 * lecture corrigée par la revue d'architecture US-001 (« le socle ne dépend que de BUS »,
 * à reporter dans 17). Aucun cycle possible : BUS est un puits. BUS (outbox et bus
 * d'événements) figure dans la carte de §2.1 mais pas dans la table de §2.2 ; il est créé
 * comme module du socle.
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

/** Modules du socle : dépendance implicite de tous les autres ; entre eux, seulement vers BUS. */
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
      "comptes, authentification (mot de passe, OTP, TOTP du staff), sessions, compte d'hôte et co-hôtes, rôles et permissions, restrictions, blocage d'un voyageur par un hôte",
    dependsOn: ['CFG', 'NTF'],
    source: '17 §2.2 (NTF : envoi OTP)',
  },
  KYC: {
    code: 'KYC',
    name: 'KYC / KYB',
    responsibility:
      "vérification du conducteur et de l'hôte (personne physique, numéro fiscal), pièces, liveness, contrôle du permis à la remise, filtrage sanctions de l'hôte",
    dependsOn: ['IAM', 'CFG', 'AUD'],
    source: '17 §2.2 ; §2.1 KYC --> IAM',
  },
  CAT: {
    code: 'CAT',
    name: 'Catalog / Listings',
    responsibility:
      "lieux de remise de l'hôte, véhicules, annonces, photos, documents du véhicule, éligibilité au contrat d'assureur, flux iCal",
    dependsOn: ['IAM', 'KYC', 'CFG'],
    source: '17 §2.2 ; §2.1 CAT --> KYC',
  },
  AVL: {
    code: 'AVL',
    name: 'Availability & Booking',
    responsibility:
      'occupation unique, hold CHECKOUT, réservation, trip, segments, conducteurs, annulations et no-shows, import iCal en blocages',
    dependsOn: ['PRC', 'PAY', 'CTR', 'KYC', 'RISK', 'CAT', 'CFG'],
    source: '17 §2.2 ; §2.1 AVL --> PRC, PAY, CTR, RISK, KYC',
  },
  PRC: {
    code: 'PRC',
    name: 'Pricing & Quotes',
    responsibility:
      'devis versionné, jours facturables, lignes (trip fee, protection), taxes, instantané des paramètres, versions de prix du trip',
    dependsOn: ['CAT', 'CFG'],
    source: '17 §2.2 ; §2.1 PRC --> CFG, CAT',
  },
  CTR: {
    code: 'CTR',
    name: 'Contracts & Documents',
    responsibility:
      "gabarits juridiques versionnés, génération PDF (contrat entre l'hôte et le voyageur), signature électronique, consentements",
    dependsOn: ['IAM', 'CFG', 'AUD'],
    source: '17 §2.2',
  },
  PAY: {
    code: 'PAY',
    name: 'Payments abstraction',
    responsibility:
      'adaptateurs PSP de place de marché, sous-marchands hôtes, capacités, opérations avec montants par jambe, commandes monétaires, webhooks, remboursements, caution',
    // 17 v6 §2.2 : CFG, AUD. L'ancienne flèche PAY → CTR (« mandat PSP », terme historique de
    // l'annexe B) est retirée par US-038 (ADR-079) : aucun import réel, resserrement seul.
    dependsOn: ['CFG', 'AUD'],
    source: '17 v6 §2.2 (« CFG, AUD »)',
  },
  STL: {
    code: 'STL',
    name: 'Settlement engine & Ledger',
    responsibility:
      'règlement économique pur, jambes, grand livre en partie double, host_ledger, insurer_ledger et bordereaux, avances de Kmino',
    dependsOn: ['PRC', 'PAY', 'CFG'],
    source: '17 §2.2 ; §2.1 STL --> PAY, PRC (rupture du cycle STL ↔ PAY)',
  },
  PYO: {
    code: 'PYO',
    name: 'Payouts',
    responsibility:
      "compte de versement vérifié de l'hôte, lots depuis la jambe HOST, compensation des débits (NETTING), gel et reprise",
    dependsOn: ['STL', 'PAY', 'KYC'],
    source: '17 §2.2 ; §2.1 PYO --> STL',
  },
  TRP: {
    code: 'TRP',
    name: 'Trip operations',
    responsibility:
      "check-in et check-out par l'hôte et le voyageur, hors ligne, retards et non-restitution, refus du véhicule, remises du jour",
    dependsOn: ['AVL', 'KYC', 'PAY', 'AUD'],
    source: '17 §2.2 ; §2.1 TRP --> AVL, AUD',
  },
  CLM: {
    code: 'CLM',
    name: 'Claims & Disputes',
    responsibility:
      'dommages et incidents, factures annexes, débits de dommage par jambe, litiges, dossiers de preuve, décisions',
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
      "console interne, fiche 360°, files de revue (KYC, annonces, vérification d'hôte), dossiers de support, actions manuelles",
    // « tous (lecture), IAM » : tous sauf RPT (RPT lit SUP ; l'inverse créerait un cycle).
    dependsOn: allExcept('SUP', 'RPT'),
    source: '17 §2.2 (« tous (lecture), IAM ») ; §2.1 SUP --> CLM',
  },
  FIN: {
    code: 'FIN',
    name: 'Finance & Tax',
    responsibility:
      "configuration fiscale, documents fiscaux de Kmino (PAC, SIFEN), relevés de gains de l'hôte, rapprochements par jambe, exports comptables",
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
    dependsOn: ['BUS'],
    source: '17 §2.2 (« — » ; BUS pour publier config.param.changed, revue architecture US-001)',
  },
  AUD: {
    code: 'AUD',
    name: 'Audit & Evidence store',
    responsibility:
      "journal d'audit chaîné, accès aux données, fichiers, clés par sujet, incidents",
    dependsOn: ['BUS'],
    source:
      '17 §2.2 (« — » ; BUS pour publier privacy.dsr.*, security.incident.*, revue architecture US-001)',
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
    source: '17 §2.1 (socle, absent de la table §2.2 ; ne dépend de personne)',
  },
};

/** Répertoire d'un module sous `apps/api/src/modules/`. */
export function moduleDir(code: ModuleCode): string {
  return code.toLowerCase();
}

/**
 * Dépendances autorisées : explicites + socle implicite (modules hors socle seulement ; dans le
 * socle, seules les dépendances explicites vers BUS valent). Triées, sans doublon.
 */
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
