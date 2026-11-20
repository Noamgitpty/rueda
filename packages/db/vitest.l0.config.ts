import { configDefaults, defineConfig } from 'vitest/config';
import { databaseTestOptions } from './vitest.shared.ts';

// pnpm test:l0 — preuves L0 (17 §11) sous les rôles de production.
//
// Budget de connexions (ADR-056, « Budget de connexions du banc ») : L0-02 ouvre une connexion
// directe par pose concurrente (100 en CI). Il tourne donc **seul**, dans un second groupe
// (`sequence.groupOrder: 1`, un seul fichier à la fois), après la fin de tous les autres fichiers
// L0, au lieu de partager `max_connections` avec eux. Le banc reste unique : le `globalSetup` est
// celui de la racine, exécuté une fois ; les projets héritent de ce qu'il fournit.
// US-024 : la conversion gardée lance la tâche d'expiration et les balayages, qui portent sur toute la
// base ; ses preuves tournent donc aussi seules, après les autres fichiers (aucun hold d'un fichier en
// cours n'est touché).
// US-025 : le fuzz C11 (et l'oracle C12) a sa propre configuration (`vitest.c11.config.ts`,
// `pnpm --filter @rueda/db test:c11`) et son propre job de CI, en parallèle de celui-ci (ADR-068).
// US-118 : la publication est prouvée dans des transactions annulées qui ouvrent les interrupteurs
// (deux personnes), posent un contrat d'assureur (une version en vigueur par pays : exclusion) et
// élèvent des membres du staff ; ces lignes partagées, tenues toute la transaction, provoquaient des
// interblocages avec les fichiers parallèles (US-108, US-114) : le fichier tourne donc seul, après.
// US-045 (N-17) : la passe C2 / C5 / C15 en horloge réelle ouvre une courte fenêtre de paramètre
// (fixture 9962) et lance la tâche d'expiration sur toute la base : elle tourne seule, après.
const ISOLATED = [
  'test/l0/l0-02-concurrency.test.ts',
  'test/l0/l0-06-real-clock.test.ts',
  'test/l0/l0-us024-conversion.test.ts',
  'test/l0/l0-us118-listing-publication.test.ts',
  // US-223 : paiement prouvé puis conversion, à deux sessions, données commitées et expiration sur
  // toute la base (comme US-024)
  'test/l0/l0-us223-conversion.test.ts',
  // US-223c : cycle d'une demande (autorisation, acceptation, refus, expiration) à deux sessions,
  // données commitées et expiration des demandes sur toute la base (comme US-223a)
  'test/l0/l0-us223-request.test.ts',
  // US-224 : ordres de règlement à deux sessions, données commitées, compte PSP ACTIVE le temps de
  // la course (un seul compte ACTIVE par pays)
  'test/l0/l0-us224-refund-race.test.ts',
  // US-224b : avance de Kmino décidée par deux personnes, mise en place et décision commitées sur
  // le compte PSP ACTIVE partagé du pays
  'test/l0/l0-us224b-advance-decision.test.ts',
  // US-215 : préparation et demandes de la console commitées (deux rôles), compte PSP ACTIVE du pays
  // partagé (fixture 9800, un seul compte ACTIVE par pays)
  'test/l0/l0-us215-trip-cancellation.test.ts',
  // US-709a : même monde qu'US-215 (préparation, demandes et lectures de l'ops commitées, compte PSP
  // ACTIVE du pays partagé) ; TRUNCATE refusé du host_ledger (verrou exclusif le temps de l'essai)
  'test/l0/l0-us709a-host-ledger.test.ts',
  // US-224d : remboursements préparés et VALIDÉS par le travailleur (deux rôles), compte PSP ACTIVE
  // du pays partagé (fixture 9800) ; lectures annulées
  'test/l0/l0-us224d-refund-read.test.ts',
  // US-217a : compte d'hôte et trips préparés et VALIDÉS par le travailleur (capture, règlement,
  // host_ledger), compte PSP ACTIVE du pays partagé (fixture 9800) ; lectures annulées
  'test/l0/l0-us217-host-receipt.test.ts',
  // US-224e : avance de Kmino décidée par deux personnes (comme US-224b) puis créance au host_ledger ;
  // hôte défaillant : préparation, restriction et action de la console commitées (comme US-709a),
  // compte PSP ACTIVE du pays partagé (fixture 9800)
  'test/l0/l0-us224e-host-receivable.test.ts',
  'test/l0/l0-us224e-defaulted-host.test.ts',
  // US-227 : trips, contrat d'assureur de test (période passée), bordereaux et décisions FINANCE
  // VALIDÉS (deux rôles), compte PSP ACTIVE du pays partagé (fixture 9800)
  'test/l0/l0-us227-insurer-ledger.test.ts',
  // US-221b : paiement prouvé puis conversion (report de la capture sur les soldes par jambe), à
  // deux sessions, données commitées, compte PSP ACTIVE du pays partagé (comme US-223a)
  'test/l0/l0-us221b-conversion-capture.test.ts',
  // US-224 (N-364) : marque de l'alerte et attente du choix contre la supersession, à deux sessions,
  // remboursement en échec préparé et VALIDÉ sur le compte PSP ACTIVE partagé du pays (fixture 9800)
  'test/l0/l0-us224-await-choice-race.test.ts',
  // US-702b : ré-autorisation contre décision de la même caution à deux sessions, caution commitée
  // puis toujours menée à un état final (aucune caution laissée dans une file)
  'test/l0/l0-us702b-deposit-race.test.ts',
  // US-708 : deux travailleurs préparent le versement du même trip, à deux sessions ; trip encaissé
  // et terminé VALIDÉ sur le compte PSP ACTIVE partagé du pays (fixture 9800), lot validé
  'test/l0/l0-us708-payout-race.test.ts',
  // US-703 : deux travailleurs planifient la tentative MIT du même débit, à deux sessions ; débit
  // VALIDÉ sur le compte PSP ACTIVE partagé du pays (fixture 9800), SUPPORTS_MIT remise inconnue
  'test/l0/l0-us703-mit-race.test.ts',
];
const C11 = ['test/l0/l0-c11-fuzz.test.ts'];
// US-049 : les attaques de la red team (test/redteam/<axe>/) tournent seules, après tous les autres
// fichiers (le hold et la conversion lancent des balayages sur toute la base), un fichier à la fois.
const REDTEAM = ['test/redteam/**/*.test.ts'];

export default defineConfig({
  test: {
    ...databaseTestOptions,
    projects: [
      {
        extends: true,
        test: {
          name: 'l0',
          include: ['test/l0/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...ISOLATED, ...C11],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'l0-concurrence',
          include: ISOLATED,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
      {
        extends: true,
        test: {
          name: 'l0-redteam',
          include: REDTEAM,
          fileParallelism: false,
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
