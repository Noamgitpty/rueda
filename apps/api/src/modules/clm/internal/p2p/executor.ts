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
 *    du pays dont `insurer_contract_active` est vrai, lu en base, absent ⇒ faux), envoyées par le
 *    port de l'assureur hors transaction puis reportées (`core.claim_cmd_record_theft_declaration`,
 *    interrupteur relu). Production : AUCUN port (lot C) ⇒ rien n'est envoyé ;
 * 3. refacturations des amendes, péages et fourrières (`core.claim_traffic_charges_due`), une par
 *    transaction : `core.claim_cmd_execute_traffic_charge` notifie le débit SÉPARÉ du voyageur
 *    (US-703 : but INCIDENTAL, motif DELAYED_CHARGES, montant explicite de chaque jambe ; le débit
 *    est planifié et envoyé par `mit_charge_scheduler`, jamais la caution) ; une erreur de la base
 *    repousse la refacturation de 15 min (`core.claim_cmd_defer_traffic_charge`).
 *
 * La plateforme ne récupère ni ne coupe aucun véhicule (OQ-BR-17) et ne transfère aucune amende
 * (OQ-BR-19). Seuls des comptes sont journalisés, jamais un identifiant (17 §6.3).
 */
import { randomUUID } from 'node:crypto';
import type { SqlClient, WorkerTransactions } from '../../../bus/index.js';
import type { InsurerClaimResult, InsurerClaimsPort } from '../claims/executor.js';

/** Nom de travailleur exigé par la base pour les commandes d'argent. */
const PAYMENT_COMMAND = 'payment_command';
export const P2P_CLAIM_BATCH = 50;
const PROVIDER_REF = /^[A-Za-z0-9:._-]{1,100}$/;

export interface P2pClaimsExecutorDeps {
  readonly transactions: WorkerTransactions;
  readonly insurer: InsurerClaimsPort | null;
  readonly log?: (line: string) => void;
}

export interface P2pClaimsPass {
  readonly theftOpened: number;
  readonly theftClosed: number;
  readonly theftDeclared: number;
  readonly insurerUnavailable: number;
  readonly trafficDone: number;
  readonly trafficBlocked: number;
  readonly trafficDeferred: number;
}

export class P2pClaimsExecutor {
  readonly #deps: P2pClaimsExecutorDeps;

  constructor(deps: P2pClaimsExecutorDeps) {
    this.#deps = deps;
  }

  #run<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    return this.#deps.transactions.run(PAYMENT_COMMAND, fn);
  }

  /** Vol présumé : ouvertures et clôtures dues, une transaction par trip ; ne lève jamais. */
  async thefts(): Promise<{ readonly opened: number; readonly closed: number }> {
    const due = await this.#run<{ trip_id: string; action: string }[]>(async (tx) => {
      const { rows } = await tx.query<{ trip_id: string; action: string }>(
        'SELECT trip_id::text AS trip_id, action FROM core.claim_theft_cases_due($1)',
        [P2P_CLAIM_BATCH],
      );
      return rows;
    }).catch(() => []);
    let opened = 0;
    let closed = 0;
    for (const d of due) {
      const r = await this.#run<string>(async (tx) => {
        const { rows } =
          d.action === 'OPEN'
            ? await tx.query<{ r: string }>(
                'SELECT core.claim_cmd_open_theft_case($1::uuid) AS r',
                [d.trip_id],
              )
            : await tx.query<{ r: string }>(
                'SELECT core.claim_cmd_close_theft_case($1::uuid) AS r',
                [d.trip_id],
              );
        return rows[0]?.r ?? 'NOT_FOUND';
      }).catch(() => 'FAILED');
      if (r === 'OPENED') opened += 1;
      if (r === 'CLOSED') closed += 1;
    }
    return { opened, closed };
  }

  /** Déclarations de vol à l'assureur (pays ouverts seulement) ; aucun port : rien n'est envoyé. */
  async declareThefts(): Promise<{ readonly declared: number; readonly unavailable: number }> {
    const insurer = this.#deps.insurer;
    if (insurer === null) return { declared: 0, unavailable: 0 };
    type Due = { id: string; country_code: string; currency: string; opened_at: string };
    const due = await this.#run<Due[]>(async (tx) => {
      const { rows } = await tx.query<Due>(
        `SELECT theft_case_id::text AS id, country_code, currency,
                  pg_catalog.to_char(opened_at AT TIME ZONE 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS opened_at
             FROM core.claim_theft_declarations_due($1)`,
        [P2P_CLAIM_BATCH],
      );
      return rows;
    });
    let declared = 0;
    let unavailable = 0;
    for (const d of due) {
      let r: InsurerClaimResult;
      try {
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
      if (r.status !== 'DECLARED' || !PROVIDER_REF.test(r.providerRef)) {
        unavailable += 1;
        continue;
      }
      const ref = r.providerRef;
      const recorded = await this.#run<string>(async (tx) => {
        const { rows } = await tx.query<{ r: string }>(
          'SELECT core.claim_cmd_record_theft_declaration($1::uuid, $2) AS r',
          [d.id, ref],
        );
        return rows[0]?.r ?? 'NOT_FOUND';
      }).catch(() => 'FAILED');
      if (recorded === 'SENT' || recorded === 'ALREADY_SENT') declared += 1;
      else unavailable += 1;
    }
    return { declared, unavailable };
  }

  /** Une refacturation, dans sa propre transaction ; ne lève jamais. */
  async executeTraffic(id: string): Promise<'DONE' | 'BLOCKED' | 'DEFERRED'> {
    try {
      const outcome = await this.#run<string>(async (tx) => {
        const { rows } = await tx.query<{ outcome: string }>(
          'SELECT outcome FROM core.claim_cmd_execute_traffic_charge($1::uuid, $2::uuid)',
          [id, randomUUID()],
        );
        return rows[0]?.outcome ?? 'NOT_FOUND';
      });
      if (outcome === 'DONE' || outcome === 'BLOCKED') return outcome;
      return 'DEFERRED';
    } catch {
      // erreur de la base (invariant du débit, panne) : la refacturation est repoussée, jamais perdue
      await this.#run(async (tx) =>
        tx.query('SELECT core.claim_cmd_defer_traffic_charge($1::uuid, $2)', [
          id,
          'EXECUTION_FAILED',
        ]),
      ).catch(() => undefined);
      return 'DEFERRED';
    }
  }

  async process(): Promise<P2pClaimsPass> {
    const t = await this.thefts();
    const d = await this.declareThefts().catch(() => ({ declared: 0, unavailable: 0 }));
    const due = await this.#run<string[]>(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        'SELECT traffic_charge_id::text AS id FROM core.claim_traffic_charges_due($1)',
        [P2P_CLAIM_BATCH],
      );
      return rows.map((r) => r.id);
    }).catch(() => []);
    let done = 0;
    let blocked = 0;
    let deferred = 0;
    for (const id of due) {
      const r = await this.executeTraffic(id);
      if (r === 'DONE') done += 1;
      else if (r === 'BLOCKED') blocked += 1;
      else deferred += 1;
    }
    const pass: P2pClaimsPass = {
      theftOpened: t.opened,
      theftClosed: t.closed,
      theftDeclared: d.declared,
      insurerUnavailable: d.unavailable,
      trafficDone: done,
      trafficBlocked: blocked,
      trafficDeferred: deferred,
    };
    this.#deps.log?.(JSON.stringify({ level: 'info', worker: 'claim_p2p', ...pass }));
    return pass;
  }
}
