/**
 * Débit des frais annexes par Kmino (US-706, ADR-197 ; 16 CLM-021 « Kmino tranche à l'échéance et
 * débite […] avec des montants explicites par jambe » ; 19 US-706 « débit par US-703 »). Tâche
 * périodique `incidental_invoice_executor` (60 s, PROPOSÉ) sous le nom `payment_command` (la base
 * l'exige) :
 *
 * 1. file `core.claim_incidental_invoices_due` (frais payés par le voyageur, décidés par l'ops, ou
 *    sans réponse dont l'échéance `invoice_guest_response_h` est passée à l'heure de la base) ;
 * 2. un frais par transaction : `core.claim_cmd_charge_incidental` relit l'état et l'échéance sous
 *    le verrou du trip, puis notifie le débit SÉPARÉ d'US-703 (but INCIDENTAL, motif
 *    DELAYED_CHARGES, montant explicite de chaque jambe, jamais la caution) ; le débit lui-même est
 *    planifié et envoyé par `mit_charge_scheduler` (préavis et accord des réseaux). Avant l'échéance
 *    ou contesté sans décision : rien (`GUEST_RESPONSE_WINDOW_OPEN`, `INCIDENTAL_DISPUTED`). Une
 *    erreur de la base repousse le frais de 15 min (`core.claim_cmd_defer_incidental`) et n'empêche
 *    jamais les suivants.
 *
 * Seuls des comptes sont journalisés, jamais un identifiant ni une donnée personnelle (17 §6.3).
 */
import { randomUUID } from 'node:crypto';
import type { BusRegistry, SqlClient, WorkerTransactions } from '../../../bus/index.js';

export const INCIDENTAL_WORKER = 'incidental_invoice_executor';
/** Nom de travailleur exigé par la base pour les commandes d'argent. */
export const INCIDENTAL_PAYMENT_COMMAND_WORKER = 'payment_command';
export const INCIDENTAL_PERIOD_SECONDS = 60;
export const INCIDENTAL_BATCH = 50;

export interface IncidentalExecutorDeps {
  readonly transactions: WorkerTransactions;
  readonly log?: (line: string) => void;
}

export type IncidentalChargeOutcome = 'CHARGED' | 'NOT_DUE' | 'BLOCKED' | 'DONE' | 'DEFERRED';

export interface IncidentalPass {
  readonly due: number;
  readonly charged: number;
  readonly notDue: number;
  readonly blocked: number;
  readonly done: number;
  readonly deferred: number;
}

const OUTCOMES: readonly string[] = ['CHARGED', 'NOT_DUE', 'BLOCKED', 'DONE'];

export class IncidentalInvoiceExecutor {
  readonly #deps: IncidentalExecutorDeps;

  constructor(deps: IncidentalExecutorDeps) {
    this.#deps = deps;
  }

  /** Frais échus (lecture sous `payment_command`). */
  static async due(tx: SqlClient, limit = INCIDENTAL_BATCH): Promise<string[]> {
    const { rows } = await tx.query<{ id: string }>(
      'SELECT invoice_id::text AS id FROM core.claim_incidental_invoices_due($1)',
      [limit],
    );
    return rows.map((r) => r.id);
  }

  /** Un frais, dans sa propre transaction ; ne lève jamais. */
  async charge(invoiceId: string): Promise<IncidentalChargeOutcome> {
    try {
      const outcome = await this.#deps.transactions.run(
        INCIDENTAL_PAYMENT_COMMAND_WORKER,
        async (tx) => {
          const { rows } = await tx.query<{ outcome: string }>(
            'SELECT outcome FROM core.claim_cmd_charge_incidental($1::uuid, $2::uuid)',
            [invoiceId, randomUUID()],
          );
          return rows[0]?.outcome ?? 'NOT_FOUND';
        },
      );
      if (OUTCOMES.includes(outcome)) return outcome as IncidentalChargeOutcome;
      // issue inconnue (NOT_FOUND…) : repoussée et codée, jamais relue en boucle (revue code)
      await this.#defer(
        invoiceId,
        /^[A-Z][A-Z0-9_]{1,63}$/.test(outcome) ? outcome : 'UNKNOWN_OUTCOME',
      );
      return 'DEFERRED';
    } catch {
      // erreur de la base (invariant du débit, panne) : le frais est repoussé, jamais perdu
      await this.#defer(invoiceId, 'EXECUTION_FAILED');
      return 'DEFERRED';
    }
  }

  async #defer(invoiceId: string, code: string): Promise<void> {
    await this.#deps.transactions
      .run(INCIDENTAL_PAYMENT_COMMAND_WORKER, (tx) =>
        tx.query('SELECT core.claim_cmd_defer_incidental($1::uuid, $2)', [invoiceId, code]),
      )
      .catch(() => undefined);
  }

  async process(invoiceIds: readonly string[]): Promise<IncidentalPass> {
    const count: Record<IncidentalChargeOutcome, number> = {
      CHARGED: 0,
      NOT_DUE: 0,
      BLOCKED: 0,
      DONE: 0,
      DEFERRED: 0,
    };
    for (const id of invoiceIds) count[await this.charge(id)] += 1;
    const pass: IncidentalPass = {
      due: invoiceIds.length,
      charged: count.CHARGED,
      notDue: count.NOT_DUE,
      blocked: count.BLOCKED,
      done: count.DONE,
      deferred: count.DEFERRED,
    };
    this.#deps.log?.(JSON.stringify({ level: 'info', worker: INCIDENTAL_WORKER, ...pass }));
    return pass;
  }
}

/**
 * Tâche périodique `incidental_invoice_executor` : la file est lue sous le nom `payment_command`,
 * puis chaque frais est débité dans sa propre transaction.
 */
export function registerIncidentalInvoiceExecutor(
  registry: BusRegistry,
  transactions: WorkerTransactions,
  log: (line: string) => void,
): void {
  const executor = new IncidentalInvoiceExecutor({ transactions, log });
  registry.registerPeriodic(INCIDENTAL_WORKER, INCIDENTAL_PERIOD_SECONDS, async (_payload, tx) => {
    await tx.query(`SELECT pg_catalog.set_config('app.worker_name', $1, true)`, [
      INCIDENTAL_PAYMENT_COMMAND_WORKER,
    ]);
    const due = await IncidentalInvoiceExecutor.due(tx);
    await executor.process(due);
  });
}
