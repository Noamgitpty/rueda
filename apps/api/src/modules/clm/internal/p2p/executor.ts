/**
 * Travailleur des sinistres entre particuliers (US-318, ADR-198). Passe de la tâche périodique
 * `claim_decision_executor` (60 s), sous le nom `payment_command` (la base l'exige), après les
 * décisions d'US-309 :
 *
 * 1. vol présumé (`core.claim_theft_cases_due`) : un trip par transaction, ouverture du dossier
 *    (`core.claim_cmd_open_theft_case` : trip OVERDUE à l'étape T24H de l'escalade d'US-306,
 *    déclaration à l'assureur journalisée PENDING, versement retenu) ou clôture au retour
 *    (`core.claim_cmd_close_theft_case`) ;
 * 2. déclarations de vol à l'assureur partenaire (`core.claim_theft_declarations_due` : seulement
 *    du pays dont `insurer_contract_active` est vrai, lu en base, absent ⇒ faux). Chaque envoi tient
 *    dans UNE transaction : déclaration verrouillée et interrupteur relu AVANT l'appel au port
 *    (`core.claim_cmd_lock_theft_declaration`), appel, puis référence enregistrée
 *    (`core.claim_cmd_record_theft_declaration`). Production : AUCUN port (lot C) ⇒ rien n'est
 *    envoyé ;
 * 3. refacturations des amendes, péages et fourrières (`core.claim_traffic_charges_due`), une par
 *    transaction : `core.claim_cmd_execute_traffic_charge` notifie le débit SÉPARÉ du voyageur
 *    (US-703 : but INCIDENTAL, motif DELAYED_CHARGES, montant explicite de chaque jambe ; le débit
 *    est planifié et envoyé par `mit_charge_scheduler`, jamais la caution) ; une erreur de la base
 *    repousse de 15 min (`core.claim_cmd_defer_traffic_charge`), au 5e échec l'état est BLOCKED
 *    `RETRY_EXHAUSTED`.
 *
 * Aucune erreur n'est avalée en silence (revue code n° 1, n° 2) : chaque erreur de la base est
 * journalisée par son SQLSTATE (jamais un identifiant, 17 §6.3), comptée dans la passe et alertée
 * à l'ops (`CLAIM_P2P_FAILED`, P1, étiquette `error_code` = étape et SQLSTATE) ; une refacturation
 * BLOCKED (sans carte du loyer, essais épuisés) est alertée `CLAIM_TRAFFIC_BLOCKED` (P1). Un dossier
 * de vol qui ne s'ouvre pas est donc visible par l'ops ; il est retenté au passage suivant.
 *
 * La plateforme ne récupère ni ne coupe aucun véhicule (OQ-BR-17) et ne transfère aucune amende
 * (OQ-BR-19).
 */
import { randomUUID } from 'node:crypto';
import type { AlertChannel, SqlClient, WorkerTransactions } from '../../../bus/index.js';
import type { InsurerClaimResult, InsurerClaimsPort } from '../claims/executor.js';

/** Nom de travailleur exigé par la base pour les commandes d'argent. */
const PAYMENT_COMMAND = 'payment_command';
export const P2P_CLAIM_BATCH = 50;
const PROVIDER_REF = /^[A-Za-z0-9:._-]{1,100}$/;

export interface P2pClaimsExecutorDeps {
  readonly transactions: WorkerTransactions;
  readonly insurer: InsurerClaimsPort | null;
  readonly log?: (line: string) => void;
  /** Alertes de l'ops ; absent : journal seulement (tests). */
  readonly alerts?: AlertChannel;
}

export interface P2pClaimsPass {
  readonly theftOpened: number;
  readonly theftClosed: number;
  readonly theftDeclared: number;
  readonly insurerUnavailable: number;
  readonly trafficDone: number;
  readonly trafficBlocked: number;
  readonly trafficDeferred: number;
  /** Erreurs de la base de la passe (toutes étapes), journalisées et alertées. */
  readonly failed: number;
}

type Step =
  | 'THEFT_QUEUE'
  | 'THEFT_OPEN'
  | 'THEFT_CLOSE'
  | 'THEFT_DECLARE'
  | 'TRAFFIC_QUEUE'
  | 'TRAFFIC_EXECUTE';

/** SQLSTATE d'une erreur de la base ; sinon `UNEXPECTED` (aucun message, aucun identifiant). */
function sqlStateOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'UNEXPECTED';
}

export class P2pClaimsExecutor {
  readonly #deps: P2pClaimsExecutorDeps;
  readonly #failures = new Map<string, number>();

  constructor(deps: P2pClaimsExecutorDeps) {
    this.#deps = deps;
  }

  #run<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    return this.#deps.transactions.run(PAYMENT_COMMAND, fn);
  }

  /** Erreur de la base à une étape : comptée pour l'alerte de fin de passe. */
  #fail(step: Step, error: unknown): void {
    const key = `${step}_${sqlStateOf(error)}`;
    this.#failures.set(key, (this.#failures.get(key) ?? 0) + 1);
  }

  /** Vol présumé : ouvertures et clôtures dues, une transaction par trip ; ne lève jamais. */
  async thefts(): Promise<{ readonly opened: number; readonly closed: number }> {
    let due: { trip_id: string; action: string }[] = [];
    try {
      due = await this.#run(async (tx) => {
        const { rows } = await tx.query<{ trip_id: string; action: string }>(
          'SELECT trip_id::text AS trip_id, action FROM core.claim_theft_cases_due($1)',
          [P2P_CLAIM_BATCH],
        );
        return rows;
      });
    } catch (error) {
      this.#fail('THEFT_QUEUE', error);
    }
    let opened = 0;
    let closed = 0;
    for (const d of due) {
      const open = d.action === 'OPEN';
      try {
        const r = await this.#run(async (tx) => {
          const { rows } = open
            ? await tx.query<{ r: string }>(
                'SELECT core.claim_cmd_open_theft_case($1::uuid) AS r',
                [d.trip_id],
              )
            : await tx.query<{ r: string }>(
                'SELECT core.claim_cmd_close_theft_case($1::uuid) AS r',
                [d.trip_id],
              );
          return rows[0]?.r ?? 'NOT_FOUND';
        });
        if (r === 'OPENED') opened += 1;
        if (r === 'CLOSED') closed += 1;
      } catch (error) {
        this.#fail(open ? 'THEFT_OPEN' : 'THEFT_CLOSE', error);
      }
    }
    return { opened, closed };
  }

  /**
   * Déclarations de vol à l'assureur (pays ouverts seulement) ; aucun port : rien n'est envoyé.
   * Verrou et interrupteur relus avant l'appel, dans la transaction de l'enregistrement.
   */
  async declareThefts(): Promise<{ readonly declared: number; readonly unavailable: number }> {
    const insurer = this.#deps.insurer;
    if (insurer === null) return { declared: 0, unavailable: 0 };
    type Due = { id: string; country_code: string; currency: string; opened_at: string };
    let due: Due[] = [];
    try {
      due = await this.#run(async (tx) => {
        const { rows } = await tx.query<Due>(
          `SELECT theft_case_id::text AS id, country_code, currency,
                  pg_catalog.to_char(opened_at AT TIME ZONE 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS opened_at
             FROM core.claim_theft_declarations_due($1)`,
          [P2P_CLAIM_BATCH],
        );
        return rows;
      });
    } catch (error) {
      this.#fail('THEFT_DECLARE', error);
    }
    let declared = 0;
    let unavailable = 0;
    for (const d of due) {
      try {
        const sent = await this.#run(async (tx) => {
          const lock = await tx.query<{ r: string }>(
            'SELECT core.claim_cmd_lock_theft_declaration($1::uuid) AS r',
            [d.id],
          );
          const state = lock.rows[0]?.r ?? 'NOT_FOUND';
          if (state === 'ALREADY_SENT') return true;
          if (state !== 'READY') return false;
          let r: InsurerClaimResult;
          try {
            // vol : aucun coût constaté, le champ du port porte « 0 » (kind THEFT, revue code n° 4)
            r = await insurer.declare({
              declarationId: d.id,
              kind: 'THEFT',
              country: d.country_code,
              currency: d.currency,
              repairCostMinor: '0',
              reportedAt: d.opened_at,
            });
          } catch {
            r = { status: 'UNAVAILABLE' };
          }
          if (r.status !== 'DECLARED' || !PROVIDER_REF.test(r.providerRef)) return false;
          const rec = await tx.query<{ r: string }>(
            'SELECT core.claim_cmd_record_theft_declaration($1::uuid, $2) AS r',
            [d.id, r.providerRef],
          );
          const out = rec.rows[0]?.r;
          return out === 'SENT' || out === 'ALREADY_SENT';
        });
        if (sent) declared += 1;
        else unavailable += 1;
      } catch (error) {
        unavailable += 1;
        this.#fail('THEFT_DECLARE', error);
      }
    }
    return { declared, unavailable };
  }

  /** Une refacturation, dans sa propre transaction ; ne lève jamais. */
  async executeTraffic(id: string): Promise<'DONE' | 'BLOCKED' | 'DEFERRED'> {
    try {
      const outcome = await this.#run(async (tx) => {
        const { rows } = await tx.query<{ outcome: string }>(
          'SELECT outcome FROM core.claim_cmd_execute_traffic_charge($1::uuid, $2::uuid)',
          [id, randomUUID()],
        );
        return rows[0]?.outcome ?? 'NOT_FOUND';
      });
      if (outcome === 'DONE' || outcome === 'BLOCKED') return outcome;
      return 'DEFERRED';
    } catch (error) {
      // erreur de la base (invariant du débit, panne) : comptée, alertée, repoussée ; au 5e échec
      // la base passe la refacturation en BLOCKED RETRY_EXHAUSTED
      this.#fail('TRAFFIC_EXECUTE', error);
      try {
        const r = await this.#run(async (tx) => {
          const { rows } = await tx.query<{ r: string }>(
            'SELECT core.claim_cmd_defer_traffic_charge($1::uuid, $2) AS r',
            [id, 'EXECUTION_FAILED'],
          );
          return rows[0]?.r ?? 'NOT_DUE';
        });
        return r === 'BLOCKED' ? 'BLOCKED' : 'DEFERRED';
      } catch (deferError) {
        this.#fail('TRAFFIC_EXECUTE', deferError);
        return 'DEFERRED';
      }
    }
  }

  async process(): Promise<P2pClaimsPass> {
    this.#failures.clear();
    const t = await this.thefts();
    const d = await this.declareThefts();
    let due: string[] = [];
    try {
      due = await this.#run(async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          'SELECT traffic_charge_id::text AS id FROM core.claim_traffic_charges_due($1)',
          [P2P_CLAIM_BATCH],
        );
        return rows.map((r) => r.id);
      });
    } catch (error) {
      this.#fail('TRAFFIC_QUEUE', error);
    }
    let done = 0;
    let blocked = 0;
    let deferred = 0;
    for (const id of due) {
      const r = await this.executeTraffic(id);
      if (r === 'DONE') done += 1;
      else if (r === 'BLOCKED') blocked += 1;
      else deferred += 1;
    }
    let failed = 0;
    for (const [code, n] of [...this.#failures].sort(([a], [b]) => a.localeCompare(b))) {
      failed += n;
      this.#deps.log?.(
        JSON.stringify({ level: 'warn', worker: 'claim_p2p', error: code, failed: n }),
      );
      await this.#alert({
        code: 'CLAIM_P2P_FAILED',
        severity: 'P1',
        counts: { failed: n },
        labels: { error_code: code },
      });
    }
    if (blocked > 0) {
      await this.#alert({ code: 'CLAIM_TRAFFIC_BLOCKED', severity: 'P1', counts: { blocked } });
    }
    const pass: P2pClaimsPass = {
      theftOpened: t.opened,
      theftClosed: t.closed,
      theftDeclared: d.declared,
      insurerUnavailable: d.unavailable,
      trafficDone: done,
      trafficBlocked: blocked,
      trafficDeferred: deferred,
      failed,
    };
    this.#deps.log?.(JSON.stringify({ level: 'info', worker: 'claim_p2p', ...pass }));
    return pass;
  }

  async #alert(alert: Parameters<AlertChannel['send']>[0]): Promise<void> {
    try {
      await this.#deps.alerts?.send(alert);
    } catch {
      // un canal d'alerte en panne ne bloque jamais la passe ; le journal ci-dessus reste
      this.#deps.log?.(
        JSON.stringify({ level: 'error', worker: 'claim_p2p', alert: alert.code, sent: false }),
      );
    }
  }
}
