/**
 * Exécution des décisions de sinistre par Kmino (US-309, ADR-195 ; 19 US-309 « décision exécutée
 * par Kmino (débit MIT, ajustement de versement), jamais par l'hôte »). Tâche périodique
 * `claim_decision_executor` (60 s, PROPOSÉ) sous le nom `payment_command` (la base l'exige) :
 *
 * 1. file `core.claim_decisions_due` (décisions PENDING échues), une décision par transaction :
 *    `core.claim_cmd_execute_decision` notifie le débit SÉPARÉ du voyageur (US-703 : but DAMAGE,
 *    motif DAMAGE_SEPARATE, montant explicite de chaque jambe ; le débit lui-même est planifié et
 *    envoyé par `mit_charge_scheduler`, jamais la caution), écrit la franchise de l'hôte au
 *    host_ledger et journalise la déclaration à l'assureur ; une erreur de la base repousse la
 *    décision de 15 min (`core.claim_cmd_defer_decision`) et n'empêche jamais les suivantes ;
 * 2. déclarations à l'assureur en attente (`core.claim_insurer_declarations_due` : seulement du
 *    pays dont `insurer_contract_active` est vrai, lu en base, absent ⇒ faux), envoyées par le port
 *    de l'assureur hors transaction puis reportées (`core.claim_cmd_record_insurer_declaration`,
 *    interrupteur relu). Production : AUCUN port (lot C) ⇒ rien n'est envoyé, la déclaration reste
 *    journalisée et l'ops la transmet (16 CLM-001 bêta).
 *
 * Seuls des comptes sont journalisés, jamais un identifiant ni une donnée personnelle (17 §6.3).
 */
import { randomUUID } from 'node:crypto';
import type { BusRegistry, SqlClient, WorkerTransactions } from '../../../bus/index.js';

export const CLAIM_DECISION_WORKER = 'claim_decision_executor';
/** Nom de travailleur exigé par la base pour les commandes d'argent. */
export const CLAIM_PAYMENT_COMMAND_WORKER = 'payment_command';
export const CLAIM_DECISION_PERIOD_SECONDS = 60;
export const CLAIM_DECISION_BATCH = 50;

/** Déclaration envoyée à l'assureur partenaire : aucune donnée personnelle. */
export interface InsurerClaimRequest {
  readonly declarationId: string;
  readonly kind: 'DAMAGE' | 'INCIDENT';
  readonly country: string;
  readonly currency: string;
  readonly repairCostMinor: string;
  readonly reportedAt: string;
}

export type InsurerClaimResult =
  | { readonly status: 'DECLARED'; readonly providerRef: string }
  | { readonly status: 'UNAVAILABLE' };

/** Port de l'assureur partenaire (FAKE en tests ; aucun adaptateur en production avant le lot C). */
export interface InsurerClaimsPort {
  declare(request: InsurerClaimRequest): Promise<InsurerClaimResult>;
}

export interface ClaimDecisionExecutorDeps {
  readonly transactions: WorkerTransactions;
  readonly insurer: InsurerClaimsPort | null;
  readonly log?: (line: string) => void;
}

export interface ClaimExecutionPass {
  readonly due: number;
  readonly done: number;
  readonly blocked: number;
  readonly deferred: number;
  readonly declared: number;
  readonly insurerUnavailable: number;
}

const PROVIDER_REF = /^[A-Za-z0-9:._-]{1,100}$/;

export class ClaimDecisionExecutor {
  readonly #deps: ClaimDecisionExecutorDeps;

  constructor(deps: ClaimDecisionExecutorDeps) {
    this.#deps = deps;
  }

  /** Décisions échues (lecture sous `payment_command`). */
  static async due(tx: SqlClient, limit = CLAIM_DECISION_BATCH): Promise<string[]> {
    const { rows } = await tx.query<{ id: string }>(
      'SELECT decision_id::text AS id FROM core.claim_decisions_due($1)',
      [limit],
    );
    return rows.map((r) => r.id);
  }

  /** Une décision, dans sa propre transaction ; ne lève jamais. */
  async execute(decisionId: string): Promise<'DONE' | 'BLOCKED' | 'DEFERRED'> {
    try {
      const outcome = await this.#deps.transactions.run(
        CLAIM_PAYMENT_COMMAND_WORKER,
        async (tx) => {
          const { rows } = await tx.query<{ outcome: string }>(
            'SELECT outcome FROM core.claim_cmd_execute_decision($1::uuid, $2::uuid)',
            [decisionId, randomUUID()],
          );
          return rows[0]?.outcome ?? 'NOT_FOUND';
        },
      );
      if (outcome === 'DONE' || outcome === 'BLOCKED') return outcome;
      return 'DEFERRED';
    } catch {
      // erreur de la base (invariant du débit, panne) : la décision est repoussée, jamais perdue
      await this.#deps.transactions
        .run(CLAIM_PAYMENT_COMMAND_WORKER, (tx) =>
          tx.query('SELECT core.claim_cmd_defer_decision($1::uuid, $2)', [
            decisionId,
            'EXECUTION_FAILED',
          ]),
        )
        .catch(() => undefined);
      return 'DEFERRED';
    }
  }

  /** Déclarations à l'assureur (pays ouverts seulement) ; aucun port : rien n'est envoyé. */
  async declare(): Promise<{ readonly declared: number; readonly unavailable: number }> {
    const insurer = this.#deps.insurer;
    if (insurer === null) return { declared: 0, unavailable: 0 };
    const due = await this.#deps.transactions.run(CLAIM_PAYMENT_COMMAND_WORKER, async (tx) => {
      const { rows } = await tx.query<{
        declaration_id: string;
        kind: 'DAMAGE' | 'INCIDENT';
        country_code: string;
        currency: string;
        repair_cost_minor: string;
        reported_at: string;
      }>(
        `SELECT declaration_id::text AS declaration_id, kind, country_code, currency,
                repair_cost_minor::text AS repair_cost_minor,
                pg_catalog.to_char(reported_at AT TIME ZONE 'UTC',
                                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS reported_at
           FROM core.claim_insurer_declarations_due($1)`,
        [CLAIM_DECISION_BATCH],
      );
      return rows;
    });
    let declared = 0;
    let unavailable = 0;
    for (const d of due) {
      let r: InsurerClaimResult;
      try {
        r = await insurer.declare({
          declarationId: d.declaration_id,
          kind: d.kind,
          country: d.country_code,
          currency: d.currency,
          repairCostMinor: d.repair_cost_minor,
          reportedAt: d.reported_at,
        });
      } catch {
        r = { status: 'UNAVAILABLE' };
      }
      if (r.status !== 'DECLARED' || !PROVIDER_REF.test(r.providerRef)) {
        unavailable += 1;
        continue;
      }
      const ref = r.providerRef;
      const recorded = await this.#deps.transactions
        .run(CLAIM_PAYMENT_COMMAND_WORKER, async (tx) => {
          const { rows } = await tx.query<{ r: string }>(
            'SELECT core.claim_cmd_record_insurer_declaration($1::uuid, $2) AS r',
            [d.declaration_id, ref],
          );
          return rows[0]?.r ?? 'NOT_FOUND';
        })
        .catch(() => 'FAILED');
      if (recorded === 'SENT' || recorded === 'ALREADY_SENT') declared += 1;
      else unavailable += 1;
    }
    return { declared, unavailable };
  }

  async process(decisionIds: readonly string[]): Promise<ClaimExecutionPass> {
    let done = 0;
    let blocked = 0;
    let deferred = 0;
    for (const id of decisionIds) {
      const r = await this.execute(id);
      if (r === 'DONE') done += 1;
      else if (r === 'BLOCKED') blocked += 1;
      else deferred += 1;
    }
    const d = await this.declare().catch(() => ({ declared: 0, unavailable: 0 }));
    const pass: ClaimExecutionPass = {
      due: decisionIds.length,
      done,
      blocked,
      deferred,
      declared: d.declared,
      insurerUnavailable: d.unavailable,
    };
    this.#deps.log?.(JSON.stringify({ level: 'info', worker: CLAIM_DECISION_WORKER, ...pass }));
    return pass;
  }
}

/**
 * Tâche périodique `claim_decision_executor` : la file est lue sous le nom `payment_command`, puis
 * chaque décision est exécutée dans sa propre transaction. `insurer` : port de l'assureur
 * (`null` en production : aucun connecteur avant le lot C).
 */
export function registerClaimDecisionExecutor(
  registry: BusRegistry,
  transactions: WorkerTransactions,
  log: (line: string) => void,
  insurer: InsurerClaimsPort | null,
): void {
  const executor = new ClaimDecisionExecutor({ transactions, insurer, log });
  registry.registerPeriodic(
    CLAIM_DECISION_WORKER,
    CLAIM_DECISION_PERIOD_SECONDS,
    async (_payload, tx) => {
      await tx.query(`SELECT pg_catalog.set_config('app.worker_name', $1, true)`, [
        CLAIM_PAYMENT_COMMAND_WORKER,
      ]);
      const due = await ClaimDecisionExecutor.due(tx);
      await executor.process(due);
    },
  );
}
