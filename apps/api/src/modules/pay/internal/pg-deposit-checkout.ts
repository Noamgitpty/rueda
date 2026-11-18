/**
 * Magasin de la caution du checkout sous `app_api` (US-701, ADR-169 ; migration 0146) :
 * - `core.payment_deposit_checkout(jeton, hold)` : contexte du hold du voyageur de la session
 *   (pays, devise et période du devis ENGAGÉ, classe du véhicule, compte marchand du pays,
 *   `platform.now()`) et, si elle existe, la décision figée telle que le voyageur peut la lire
 *   (mécanisme, montant, devise, libération : AUCUNE colonne [C2]) ;
 * - `core.payment_cmd_record_deposit_decision(jeton, hold, décision)` : écriture unique de
 *   `deposit_hold` (commande SECURITY DEFINER de cmd_hold_owner, revérifications fail-closed).
 * Paramètres liés, aucun SQL construit ; toute forme inattendue ⇒ erreur (503 chez l'appelant).
 */
import { PaymentError } from './errors.js';
import { DEPOSIT_TRIGGERS } from './deposit-triggers.js';
import { valueClassOf } from './deposit-checkout.js';
import type {
  DepositCheckoutRead,
  DepositCheckoutStore,
  DepositDecisionRecord,
  DepositReadRefusal,
  DepositRecordOutcome,
  RecordedDeposit,
} from './deposit-checkout.js';
import type { SqlExecutor } from './pg-stores.js';

const shape = (what: string): PaymentError =>
  new PaymentError('INVALID_REQUEST', `caution du checkout : ${what} illisible`);

const instant = (v: unknown, what: string): Date => {
  const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null;
  if (d === null || Number.isNaN(d.getTime())) throw shape(what);
  return d;
};
const text = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || v === '') throw shape(what);
  return v;
};
const MINOR = /^(0|[1-9][0-9]{0,18})$/;
const minor = (v: unknown, what: string): bigint => {
  const s = typeof v === 'number' || typeof v === 'bigint' ? String(v) : v;
  if (typeof s !== 'string' || !MINOR.test(s)) throw shape(what);
  return BigInt(s);
};

const RECORDED_MECHANISMS = ['NOT_REQUIRED', 'PREAUTH_SINGLE', 'REAUTH', 'CHARGE_THEN_REFUND'];
const RECORD_OUTCOMES: ReadonlySet<string> = new Set<DepositRecordOutcome>([
  'RECORDED',
  'EXISTING',
  'AUTH_REQUIRED',
  'HOLD_NOT_FOUND',
  'HOLD_NOT_PAYABLE',
  'QUOTE_UNAVAILABLE',
]);

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

export class PgDepositCheckoutStore implements DepositCheckoutStore {
  constructor(private readonly db: SqlExecutor) {}

  async read(proof: Buffer, holdId: string): Promise<DepositCheckoutRead | DepositReadRefusal> {
    const { rows } = await this.db.query(
      'SELECT * FROM core.payment_deposit_checkout($1, $2::uuid)',
      [proof, holdId],
    );
    const r = rows[0];
    const outcome = r === undefined ? '' : String(r['outcome']);
    if (
      outcome === 'AUTH_REQUIRED' ||
      outcome === 'HOLD_NOT_FOUND' ||
      outcome === 'QUOTE_UNAVAILABLE'
    ) {
      return outcome;
    }
    if (r === undefined || outcome !== 'DONE') throw shape('issue');
    const currency = text(r['currency'], 'devise');
    const mechanism = r['mechanism'];
    if (mechanism !== null && mechanism !== undefined) {
      if (typeof mechanism !== 'string' || !RECORDED_MECHANISMS.includes(mechanism)) {
        throw shape('mécanisme');
      }
      const deposit: RecordedDeposit = {
        mechanism: mechanism as RecordedDeposit['mechanism'],
        amountMinor: minor(r['amount_minor'], 'montant'),
        currency,
        releaseAt: r['release_at'] === null ? null : instant(r['release_at'], 'libération'),
      };
      return { kind: 'RECORDED', deposit };
    }
    const provider = r['provider'];
    return {
      kind: 'OPEN',
      context: {
        country: text(r['country_code'], 'pays'),
        currency,
        valueClass: valueClassOf(r['value_class']),
        scheduledStart: instant(r['scheduled_start'], 'début'),
        scheduledEnd: instant(r['scheduled_end'], 'fin'),
        provider: typeof provider === 'string' && provider !== '' ? provider : null,
        now: instant(r['now'], 'heure de la base'),
      },
    };
  }

  async record(
    proof: Buffer,
    holdId: string,
    record: DepositDecisionRecord,
  ): Promise<DepositRecordOutcome> {
    if (!record.triggers.every((t) => (DEPOSIT_TRIGGERS as readonly string[]).includes(t))) {
      throw shape('déclencheur');
    }
    const decision = {
      mechanism: record.mechanism,
      triggers: [...record.triggers],
      paramsSnapshot: record.paramsSnapshot,
      amountMinor: record.amountMinor.toString(),
      provider: record.provider,
      hRequiredHours: record.hRequiredHours,
      vHours: record.vHours,
      authAt: iso(record.authAt),
      releaseAt: iso(record.releaseAt),
      decisionAt: iso(record.decisionAt),
      reauthDueAt: iso(record.reauthDueAt),
    };
    const { rows } = await this.db.query<{ r: unknown }>(
      'SELECT core.payment_cmd_record_deposit_decision($1, $2::uuid, $3::jsonb) AS r',
      [proof, holdId, JSON.stringify(decision)],
    );
    const outcome = String(rows[0]?.r ?? '');
    if (!RECORD_OUTCOMES.has(outcome)) throw shape('issue de l’écriture');
    return outcome as DepositRecordOutcome;
  }
}
