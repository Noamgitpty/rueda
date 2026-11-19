/**
 * Décision de la caution à l'heure de décision (US-702, ADR-172 ; 08 BR-PAY-06 « Libération à
 * heure fixe, jamais suspendue », T57, T58 ; 16 PAY-011 / PAY-012 ; 19 US-702).
 *
 * Exécutée par la tâche périodique `deposit_timer` (après les ré-autorisations), sous le nom de
 * travailleur `payment_command` exigé par la base. La file `core.payment_deposit_decision_due` rend
 * les cautions AUTORISÉES dont la décision est échue (`decision_at ≤ platform.now()`) ou dont
 * l'autorisation a expiré ; rien d'autre n'y entre : une réclamation de dommage, une facture ou des
 * frais d'assistance ne suspendent jamais la libération. Pour chacune :
 * 1. autorisation déjà expirée ⇒ `EXPIRED` sans appel au PSP (jamais de capture après
 *    `auth_expiry`) ;
 * 2. sinon : configuration relue (capacités, `deposit_fee_notice_h`), frais annexes de la source
 *    (`DepositFeeSource` ; en production AUCUNE source n'existe encore : aucun frais ⇒ la caution
 *    est libérée en entier, les frais éventuels passent ensuite par MIT `DELAYED_CHARGES`, comme
 *    chez Turo), plan pur `planDepositDecision` (T57 : capture puis VOID ; T58 : VOID puis MIT),
 *    exécution par le port HORS transaction, clés de 08 E4 (même clé au rejeu) ;
 * 3. issue reportée par `core.payment_cmd_deposit_decide` (transition finale gardée et événement
 *    `deposit.decision.executed` dans la même transaction : journal et avis au voyageur).
 * Issue inconnue ou en cours ⇒ rien n'est écrit, la MÊME clé est rejouée au passage suivant
 * (17 §4.3). VOID refusé définitivement ⇒ l'autorisation est laissée expirer (08 E3 repli 4),
 * alerte ops `DEPOSIT_DECISION_FAILED`. Débit MIT refusé ou impossible ⇒ la caution reste libérée,
 * alerte `DEPOSIT_FEES_UNCOLLECTED` (frais à recouvrer, BR-PAY-10). Autre échec ⇒ alerte, rien
 * d'écrit, nouvel essai au passage suivant.
 * Aucun connecteur pour le fournisseur (production jusqu'au lot C) ⇒ rien n'est envoyé.
 * Journal : comptes et codes seulement, jamais un identifiant (17 §6.3).
 */
import type { AlertChannel, WorkerTransactions } from '../../bus/index.js';
import { createCurrencyRegistry, money } from '@rueda/money';
import { planDepositDecision } from './deposit-rails.js';
import type {
  DepositDecisionPlan,
  DepositHoldStatus,
  DepositIncidentalFee,
  DepositRail,
  DepositStep,
} from './deposit-rails.js';
import { DepositRailExecutor } from './deposit-executor.js';
import type { DepositExecution, DepositReference } from './deposit-executor.js';
import { PgDepositRailConfigReader } from './pg-deposit-config.js';
import type { DepositRailConfig } from './pg-deposit-config.js';
import type { PaymentConnectorRegistry } from './production.js';
import type { SqlExecutor } from './pg-stores.js';

/** Nom de travailleur exigé par la base pour la file et la transition. */
const PAYMENT_COMMAND_WORKER = 'payment_command';
export const DEPOSIT_DECISION_BATCH = 50;

const RAILS: readonly DepositRail[] = ['PREAUTH_SINGLE', 'REAUTH', 'CHARGE_THEN_REFUND'];

/** Caution dont la décision est échue (aucune donnée [C2]). */
export interface DueDepositDecision {
  readonly depositId: string;
  readonly tripId: string;
  readonly segmentId: string;
  readonly tenderId: string;
  readonly country: string;
  readonly currency: string;
  readonly currencyExponent: number;
  readonly provider: string;
  readonly providerReference: string;
  readonly mechanism: DepositRail;
  readonly amountMinor: bigint;
  readonly decisionAt: Date;
  /** `null` : rail « débit puis remboursement » (aucune autorisation à expirer). */
  readonly authExpiryAt: Date | null;
  readonly reauthSeq: number;
  /** `platform.now()` à la lecture de la file. */
  readonly now: Date;
}

/** Issue finale reportée à la base (Σ capturé + libéré = montant de la caution). */
export interface DepositOutcome {
  readonly status: Exclude<DepositHoldStatus, 'PLANNED' | 'AUTHORIZED'>;
  readonly capturedMinor: bigint;
  readonly releasedMinor: bigint;
}

/**
 * Frais annexes à décider sur la caution et carte du consentement MIT. Source de production :
 * `NO_DEPOSIT_FEES` (aucun registre des frais annexes ni carte enregistrée avant les stories qui les
 * livrent : rien n'est capturé sur la caution, PROPOSÉ, fail-closed).
 */
export type DepositFeeSource = (due: DueDepositDecision) => Promise<{
  readonly fees: readonly DepositIncidentalFee[];
  /** Jeton de la carte enregistrée (consentement MIT) ; `null` : aucun débit MIT possible. */
  readonly instrumentToken: string | null;
}>;

export const NO_DEPOSIT_FEES: DepositFeeSource = () =>
  Promise.resolve({ fees: [], instrumentToken: null });

export type DepositDecisionStep =
  | 'NO_CONNECTOR'
  | 'PARTIALLY_CAPTURED'
  | 'VOIDED'
  | 'REFUNDED'
  | 'EXPIRED'
  | 'PENDING'
  | 'FAILED'
  | 'STALE'
  | 'ERROR';

const instant = (v: unknown): Date => {
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new TypeError('instant illisible');
  return d;
};
const str = (v: unknown): string => {
  if (typeof v !== 'string' || v === '') throw new TypeError('colonne inattendue');
  return v;
};
const minor = (v: unknown): bigint => {
  const s = typeof v === 'bigint' ? v.toString() : String(v);
  if (!/^(0|[1-9][0-9]{0,18})$/.test(s)) throw new TypeError('montant illisible');
  return BigInt(s);
};
const rail = (v: unknown): DepositRail => {
  if (!(RAILS as readonly unknown[]).includes(v)) throw new TypeError('mécanisme inattendu');
  return v as DepositRail;
};

/** File et transition finale de la base (fonctions SECURITY DEFINER, `payment_command`). */
export class PgDepositDecisionStore {
  constructor(private readonly db: SqlExecutor) {}

  async due(limit: number): Promise<DueDepositDecision[]> {
    const { rows } = await this.db.query(
      `SELECT d.*, c.exponent AS currency_exponent
         FROM core.payment_deposit_decision_due($1::integer) AS d
         JOIN core.config_currency AS c ON c.code = d.currency`,
      [limit],
    );
    return rows.map((r) => ({
      depositId: str(r['deposit_id']),
      tripId: str(r['trip_id']),
      segmentId: str(r['segment_id']),
      tenderId: str(r['tender_id']),
      country: str(r['country_code']),
      currency: str(r['currency']),
      currencyExponent: Number(r['currency_exponent']),
      provider: str(r['provider']),
      providerReference: str(r['provider_reference']),
      mechanism: rail(r['mechanism']),
      amountMinor: minor(r['amount_minor']),
      decisionAt: instant(r['decision_at']),
      authExpiryAt: r['auth_expiry_at'] === null ? null : instant(r['auth_expiry_at']),
      reauthSeq: Number(r['reauth_seq']),
      now: instant(r['now']),
    }));
  }

  /** `APPLIED` ; `STALE` : la caution a changé entre-temps (rang ou état), rien n'est écrit. */
  async decide(
    depositId: string,
    expectedSeq: number,
    outcome: DepositOutcome,
  ): Promise<'APPLIED' | 'STALE'> {
    const { rows } = await this.db.query<{ r: unknown }>(
      `SELECT core.payment_cmd_deposit_decide($1::uuid, $2::integer, $3, $4::bigint, $5::bigint)
                AS r`,
      [
        depositId,
        expectedSeq,
        outcome.status,
        outcome.capturedMinor.toString(),
        outcome.releasedMinor.toString(),
      ],
    );
    const r = String(rows[0]?.r ?? '');
    if (r !== 'APPLIED' && r !== 'STALE') throw new TypeError('issue inattendue de la décision');
    return r;
  }
}

export interface DepositDecisionDeps {
  /** Configuration du pays et du fournisseur (`PgDepositRailConfigReader`, transaction propre). */
  readonly config: (country: string, provider: string) => Promise<DepositRailConfig>;
  /** Transition finale (`PgDepositDecisionStore.decide`, transaction propre). */
  readonly decide: PgDepositDecisionStore['decide'];
  readonly fees: DepositFeeSource;
  readonly alerts: Pick<AlertChannel, 'send'>;
  readonly connectors: PaymentConnectorRegistry;
}

/** Dépendances de production : chaque lecture et chaque écriture dans sa transaction. */
export function postgresDepositDecisionDeps(
  transactions: WorkerTransactions,
  alerts: Pick<AlertChannel, 'send'>,
  connectors: PaymentConnectorRegistry,
  fees: DepositFeeSource = NO_DEPOSIT_FEES,
): DepositDecisionDeps {
  return {
    config: (country, provider) =>
      transactions.run(PAYMENT_COMMAND_WORKER, (db) =>
        new PgDepositRailConfigReader(db).read(country, provider),
      ),
    decide: (depositId, expectedSeq, outcome) =>
      transactions.run(PAYMENT_COMMAND_WORKER, (db) =>
        new PgDepositDecisionStore(db).decide(depositId, expectedSeq, outcome),
      ),
    fees,
    alerts,
    connectors,
  };
}

/** Sans carte enregistrée, un débit MIT est impossible : les frais deviennent une dette (BR-PAY-10). */
export function withoutMit(plan: DepositDecisionPlan): DepositDecisionPlan {
  return {
    ...plan,
    steps: plan.steps.map((s): DepositStep =>
      s.op === 'MIT_CHARGE' ? { op: 'DEBT', amountMinor: s.amountMinor, parts: s.parts } : s,
    ),
  };
}

const capturedOf = (exec: DepositExecution): bigint =>
  exec.completed.reduce((sum, r) => (r.step.op === 'CAPTURE' ? sum + r.step.amountMinor : sum), 0n);

export class DepositDecisionTimer {
  constructor(private readonly deps: DepositDecisionDeps) {}

  /** Une caution ; ne lève jamais (une caution ne bloque pas les suivantes). */
  async process(due: DueDepositDecision): Promise<DepositDecisionStep> {
    try {
      if (due.authExpiryAt !== null && due.authExpiryAt.getTime() <= due.now.getTime()) {
        // l'autorisation est tombée seule : jamais de capture après `auth_expiry` (08 BR-PAY-06)
        return await this.#report(due, {
          status: 'EXPIRED',
          capturedMinor: 0n,
          releasedMinor: due.amountMinor,
        });
      }
      const provider = this.deps.connectors.get(due.provider);
      if (provider === undefined) return 'NO_CONNECTOR';
      const config = await this.deps.config(due.country, due.provider);
      const { fees, instrumentToken } = await this.deps.fees(due);
      const currency = createCurrencyRegistry([
        { code: due.currency, exponent: due.currencyExponent },
      ]).get(due.currency);
      // délai de notification absent : aucun frais n'est capturable sur la caution (fail-closed)
      const noticeH = config.feeNoticeH;
      const planned = planDepositDecision({
        mechanism: due.mechanism,
        amount: money(due.amountMinor, currency),
        decisionAt: due.decisionAt,
        feeNoticeH: noticeH ?? 0,
        fees: noticeH === null ? fees.map((f) => ({ ...f, proven: false })) : fees,
        caps: { capabilities: config.capabilities },
      });
      const plan = instrumentToken === null ? withoutMit(planned) : planned;
      const ref: DepositReference = {
        depositId: due.depositId,
        tripReference: due.tripId,
        tripId: due.tripId,
        segmentId: due.segmentId,
        tenderId: due.tenderId,
        currency,
      };
      const exec = await new DepositRailExecutor(provider).execute(ref, plan, {
        providerReference: due.providerReference,
        instrumentToken: instrumentToken ?? '',
        attemptNo: 1,
      });
      const final = exec.fallback ?? plan;
      if (exec.failed === null) {
        const step = await this.#report(due, {
          status: final.finalStatus as DepositOutcome['status'],
          capturedMinor: final.capturedMinor,
          releasedMinor: final.releasedMinor,
        });
        if (step !== 'STALE' && final.steps.some((s) => s.op === 'DEBT')) {
          await this.#alert('DEPOSIT_FEES_UNCOLLECTED', 'P2', due);
        }
        return step;
      }
      if (exec.failed.needsLookup) return 'PENDING';
      const failedOp = exec.failed.step.op;
      if (failedOp === 'MIT_CHARGE') {
        // la caution est déjà libérée (VOID ou capture faits) : seuls les frais restent dus
        const step = await this.#report(due, {
          status: final.finalStatus as DepositOutcome['status'],
          capturedMinor: final.capturedMinor,
          releasedMinor: final.releasedMinor,
        });
        if (step !== 'STALE') await this.#alert('DEPOSIT_FEES_UNCOLLECTED', 'P2', due);
        return step;
      }
      if (failedOp === 'VOID') {
        // 08 E3 repli 4 : annulation refusée ⇒ l'autorisation est laissée expirer
        const captured = capturedOf(exec);
        const step = await this.#report(due, {
          status: captured > 0n ? 'PARTIALLY_CAPTURED' : 'EXPIRED',
          capturedMinor: captured,
          releasedMinor: due.amountMinor - captured,
        });
        if (step !== 'STALE') await this.#alert('DEPOSIT_DECISION_FAILED', 'P1', due);
        return step;
      }
      await this.#alert('DEPOSIT_DECISION_FAILED', 'P1', due);
      return 'FAILED';
    } catch {
      return 'ERROR';
    }
  }

  async #report(due: DueDepositDecision, outcome: DepositOutcome): Promise<DepositDecisionStep> {
    const applied = await this.deps.decide(due.depositId, due.reauthSeq, outcome);
    return applied === 'STALE' ? 'STALE' : outcome.status;
  }

  async #alert(
    code: 'DEPOSIT_DECISION_FAILED' | 'DEPOSIT_FEES_UNCOLLECTED',
    severity: 'P1' | 'P2',
    due: DueDepositDecision,
  ): Promise<void> {
    await this.deps.alerts.send({
      code,
      severity,
      counts: { deposits: 1 },
      labels: { country: due.country, provider: due.provider },
    });
  }
}
