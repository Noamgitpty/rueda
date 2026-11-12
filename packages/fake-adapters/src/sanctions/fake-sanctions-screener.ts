/**
 * FAKE du port `SanctionsScreener` (module KYC ; 16 VER-028 ; US-123, ADR-105). Simule un
 * prestataire de filtrage contre les listes de sanctions (ONU, OFAC, listes nationales) qui
 * reprend la session d'identité DÉJÀ vérifiée chez le fournisseur d'identité : l'application
 * n'envoie ni nom, ni date de naissance, ni pièce, seulement la référence de cette session.
 *
 * Le prestataire rend le résultat (`CLEAR`, `POTENTIAL_MATCH`, `CONFIRMED_MATCH`), la version de
 * chaque liste consultée et, en cas de correspondance, une référence OPAQUE de son dossier : jamais
 * une entrée de liste (nom, alias, programme). Les versions des listes sont une donnée fournie à la
 * construction (aucune constante pays).
 *
 * Pilotage par le test : `flag(sessionRef, résultat)` ; scénario `screen` du moteur commun (panne,
 * délai, issue inconnue, refus, idempotence par clé).
 */
import { assertFakeAllowed } from '../guard.ts';
import type { EnvironmentVariables } from '../guard.ts';
import type { FakeClock } from '../core/clock.ts';
import type { Outcome } from '../core/outcome.ts';
import { FakeRuntime, Sequence } from '../core/runtime.ts';

export type ScreeningResult = 'CLEAR' | 'POTENTIAL_MATCH' | 'CONFIRMED_MATCH';

export interface ScreeningRequest {
  readonly idempotencyKey: string;
  /** Fournisseur d'identité qui a vérifié la personne (code). */
  readonly identityProvider: string;
  /** Référence de la session d'identité approuvée chez ce fournisseur (jamais un nom). */
  readonly identitySessionRef: string;
  /** Pays du compte d'hôte (listes nationales à consulter), tiré de la configuration. */
  readonly country: string;
}

export interface ScreeningReport {
  readonly result: ScreeningResult;
  /** { LISTE : version } ; jamais une entrée de liste. */
  readonly listsVersion: Readonly<Record<string, string>>;
  /** Référence opaque du dossier de correspondance chez le prestataire ; `null` si `CLEAR`. */
  readonly matchRef: string | null;
  readonly screenedAt: Date;
}

export interface FakeSanctionsScreenerOptions {
  readonly clock: FakeClock;
  /** Versions des listes consultées (donnée du test). */
  readonly listsVersion: Readonly<Record<string, string>>;
  readonly env?: EnvironmentVariables;
}

export class FakeSanctionsScreener {
  readonly runtime: FakeRuntime<'screen', 'UNKNOWN_SUBJECT'>;
  readonly #options: FakeSanctionsScreenerOptions;
  readonly #flags = new Map<string, ScreeningResult>();
  readonly #cases = new Sequence('fk_aml_case');
  /** Requêtes reçues (lecture du test : aucune donnée personnelle n'y figure). */
  readonly received: ScreeningRequest[] = [];

  constructor(options: FakeSanctionsScreenerOptions) {
    assertFakeAllowed('FakeSanctionsScreener', options.env);
    this.#options = options;
    this.runtime = new FakeRuntime(options.clock);
  }

  /** Le test marque une session d'identité comme correspondant à une liste. */
  flag(identitySessionRef: string, result: Exclude<ScreeningResult, 'CLEAR'>): void {
    this.#flags.set(identitySessionRef, result);
  }

  async screen(
    request: ScreeningRequest,
  ): Promise<Outcome<ScreeningReport, 'UNKNOWN_SUBJECT'>> {
    return this.runtime.execute(
      'screen',
      { idempotencyKey: request.idempotencyKey, content: request },
      () => {
        this.received.push(request);
        if (request.identitySessionRef.length === 0) {
          return { ok: false, reason: 'UNKNOWN_SUBJECT' as const };
        }
        const result = this.#flags.get(request.identitySessionRef) ?? 'CLEAR';
        return {
          ok: true,
          value: {
            result,
            listsVersion: { ...this.#options.listsVersion },
            matchRef: result === 'CLEAR' ? null : this.#cases.next(),
            screenedAt: this.runtime.clock.now(),
          },
        };
      },
    );
  }
}
