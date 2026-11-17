/**
 * Remboursements d'un voyage lus par la console (US-224 partie 224d, ADR-154 ; 19 US-224 critère 1
 * « visible de l'ops » ; écran O01 de 10b ; 08 SM-8, E3, BR-PAY-08). Composant de PRÉSENTATION pur
 * (aucun appel réseau, aucun état) ; l'enchaînement est dans `console-client.tsx`.
 *
 * L'agent (OPS_AGENT, FINANCE, ADMIN ; la base reste juge) saisit l'identifiant d'un voyage et lit
 * chaque instance de remboursement : état SM-8, montant, rail, date d'émission (jamais une date de
 * réception), parts demandées par le règlement et ordre envoyé au prestataire (qui en diffèrent par
 * l'avance de la plateforme), motif de blocage et alerte FIN expliqués, avance. Lecture seule : la
 * console ne déclenche aucun remboursement. Montants en unités mineures (texte) avec l'exposant de
 * la devise : affichage seulement.
 */
import type { FormEvent } from 'react';
import type { MessageKey, Translator } from '@rueda/i18n';
import { Badge, Banner, Button, DataTable, TextField } from '@rueda/ui';
import styles from './console.module.css';

/** Rôles qui détiennent ops.platform_cancel ou finance.platform_advance (0034, 0035). */
export const REFUND_ROLES = new Set(['OPS_AGENT', 'FINANCE', 'ADMIN']);

const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;

export interface StaffRefundView {
  readonly instanceId: string;
  readonly status: string;
  readonly currency: string;
  readonly amountMinor: string;
  readonly rail: string;
  readonly attemptNo: number;
  readonly settlementVersion: number;
  readonly requestedLegs: Readonly<Record<string, string>>;
  readonly orderLegs: Readonly<Record<string, string>>;
  readonly orderStatus: string;
  readonly blockedReason: string | null;
  readonly finAlert: string | null;
  readonly advance: { readonly status: string; readonly amountMinor: string } | null;
  readonly plannedAt: string;
  readonly issuedAt: string | null;
}

export interface TripRefundsView {
  readonly tripId: string;
  readonly country: string;
  readonly exponent: number | null;
  readonly refunds: readonly StaffRefundView[];
}

export type RefundsState =
  | { readonly step: 'form'; readonly error?: MessageKey | undefined }
  | {
      readonly step: 'result';
      readonly tripId: string;
      /** `error` : lecture refusée ou impossible (expliquée par `notice`), jamais « rien ». */
      readonly view: TripRefundsView | 'error';
      readonly notice?: { readonly tone: 'warning' | 'danger'; readonly key: MessageKey };
    };

export interface RefundsHandlers {
  readonly onRefundsRead: (tripId: string) => void;
}

const STATUS_KEYS: Readonly<Record<string, MessageKey>> = {
  PLANNED: 'backoffice.refunds.status.PLANNED',
  BLOCKED_CHARGEBACK: 'backoffice.refunds.status.BLOCKED_CHARGEBACK',
  PENDING_CUSTOMER_CHOICE: 'backoffice.refunds.status.PENDING_CUSTOMER_CHOICE',
  PENDING_BANK_DETAILS: 'backoffice.refunds.status.PENDING_BANK_DETAILS',
  SUBMITTED: 'backoffice.refunds.status.SUBMITTED',
  SENT: 'backoffice.refunds.status.SENT',
  CONFIRMED: 'backoffice.refunds.status.CONFIRMED',
  FAILED: 'backoffice.refunds.status.FAILED',
  CREDITED: 'backoffice.refunds.status.CREDITED',
  CANCELLED: 'backoffice.refunds.status.CANCELLED',
  SUPERSEDED: 'backoffice.refunds.status.SUPERSEDED',
};

const STATUS_TONE: Readonly<Record<string, 'neutral' | 'success' | 'warning' | 'danger'>> = {
  CONFIRMED: 'success',
  CREDITED: 'success',
  FAILED: 'danger',
  BLOCKED_CHARGEBACK: 'warning',
};

const RAIL_KEYS: Readonly<Record<string, MessageKey>> = {
  NATIVE_PARTIAL: 'backoffice.refunds.rail.NATIVE_PARTIAL',
  ROLLBACK_AND_RECHARGE: 'backoffice.refunds.rail.ROLLBACK_AND_RECHARGE',
  BANK_TRANSFER: 'backoffice.refunds.rail.BANK_TRANSFER',
  CREDIT_CASH: 'backoffice.refunds.rail.CREDIT_CASH',
};

const LEG_KEYS: Readonly<Record<string, MessageKey>> = {
  HOST: 'backoffice.cancel.leg.HOST',
  INSURER: 'backoffice.cancel.leg.INSURER',
  TAX_THIRD_PARTY: 'backoffice.cancel.leg.TAX_THIRD_PARTY',
  PLATFORM: 'backoffice.cancel.leg.PLATFORM',
};

/**
 * Motifs de blocage (0123) et codes des alertes FIN (0127 : `BLOCKED:<motif>`, `FAILED`,
 * `SEND:<motif>`, `<phase>:<code>`) expliqués ; un code inconnu est montré tel quel.
 */
export const REFUND_REASON_KEYS: Readonly<Record<string, MessageKey>> = {
  ADVANCE_CAP_UNSET: 'backoffice.refunds.reason.ADVANCE_CAP_UNSET',
  HOST_ADVANCE_CAP: 'backoffice.refunds.reason.HOST_ADVANCE_CAP',
  PLATFORM_BALANCE_UNKNOWN: 'backoffice.refunds.reason.PLATFORM_BALANCE_UNKNOWN',
  SUPERSEDED_UNSENT: 'backoffice.refunds.reason.SUPERSEDED_UNSENT',
  NO_TARGET: 'backoffice.refunds.reason.NO_TARGET',
  MISMATCH: 'backoffice.refunds.reason.MISMATCH',
  REFUND_FAILED: 'backoffice.refunds.reason.REFUND_FAILED',
  REFUND_EXCEEDS_COLLECTED: 'backoffice.refunds.reason.REFUND_EXCEEDS_COLLECTED',
  SETTLEMENT_SUPERSEDED: 'backoffice.refunds.reason.SETTLEMENT_SUPERSEDED',
  FIN_REVIEW_REQUIRED: 'backoffice.refunds.reason.FIN_REVIEW_REQUIRED',
};

/** Code d'une alerte FIN (`FAILED` ⇒ REFUND_FAILED ; sinon le dernier segment). */
export function alertCodeOf(alert: string): string {
  if (alert === 'FAILED') return 'REFUND_FAILED';
  const parts = alert.split(':');
  return parts[parts.length - 1] ?? alert;
}

function reasonText(i18n: Translator, code: string): string {
  const key = REFUND_REASON_KEYS[code];
  return key === undefined ? i18n.t('backoffice.refunds.reason.other', { code }) : i18n.t(key);
}

function moneyOf(i18n: Translator, v: TripRefundsView, r: StaffRefundView, minor: string): string {
  return v.exponent === null
    ? `${minor} ${r.currency}`
    : i18n.money({ amountMinor: BigInt(minor), currency: r.currency, exponent: v.exponent });
}

function legsText(
  i18n: Translator,
  v: TripRefundsView,
  r: StaffRefundView,
  legs: Readonly<Record<string, string>>,
): string {
  return LEGS.filter((k) => legs[k] !== undefined)
    .map((k) => `${i18n.t(LEG_KEYS[k] as MessageKey)} ${moneyOf(i18n, v, r, legs[k] ?? '0')}`)
    .join(' · ');
}

function fieldOf(event: FormEvent<HTMLFormElement>, name: string): string {
  const value = new FormData(event.currentTarget).get(name);
  return typeof value === 'string' ? value : '';
}

export function RefundsPanel({
  i18n,
  state,
  handlers,
  busy = false,
}: {
  readonly i18n: Translator;
  readonly state: RefundsState;
  readonly handlers: RefundsHandlers;
  readonly busy?: boolean;
}) {
  return (
    <section className={styles['panel']} aria-labelledby="refunds-heading">
      <h2 id="refunds-heading" className={styles['heading']} tabIndex={-1}>
        {i18n.t('backoffice.refunds.heading')}
      </h2>
      <p className={styles['muted']}>{i18n.t('backoffice.refunds.lead')}</p>
      <form
        className={styles['form']}
        onSubmit={(e) => {
          e.preventDefault();
          handlers.onRefundsRead(fieldOf(e, 'tripId').trim().toLowerCase());
        }}
      >
        <TextField
          i18n={i18n}
          id="refunds-trip"
          name="tripId"
          autoComplete="off"
          spellCheck={false}
          label={i18n.t('backoffice.refunds.trip')}
          error={
            state.step === 'form' && state.error !== undefined ? i18n.t(state.error) : undefined
          }
        />
        <div className={styles['actions']}>
          <Button type="submit" variant="secondary" loading={busy}>
            {i18n.t('backoffice.refunds.read')}
          </Button>
        </div>
      </form>
      {state.step === 'result' && state.notice !== undefined && (
        <Banner tone={state.notice.tone} live="polite">
          {i18n.t(state.notice.key)}
        </Banner>
      )}
      {state.step === 'result' && state.view !== 'error' && (
        <RefundsTable i18n={i18n} view={state.view} />
      )}
    </section>
  );
}

function RefundsTable({
  i18n,
  view,
}: {
  readonly i18n: Translator;
  readonly view: TripRefundsView;
}) {
  if (view.refunds.length === 0) {
    return (
      <p className={styles['muted']} data-testid="refunds-none">
        {i18n.t('backoffice.refunds.none')}
      </p>
    );
  }
  return (
    <DataTable
      id="refunds-table"
      caption={i18n.t('backoffice.refunds.caption')}
      columns={[
        { key: 'status', header: i18n.t('backoffice.refunds.statusColumn') },
        { key: 'amount', header: i18n.t('backoffice.refunds.amountColumn'), align: 'end' },
        { key: 'issued', header: i18n.t('backoffice.refunds.issuedColumn') },
        { key: 'detail', header: i18n.t('backoffice.refunds.detailColumn') },
      ]}
      rows={view.refunds.map((r) => {
        const reasons = [
          ...(r.blockedReason === null ? [] : [r.blockedReason]),
          ...(r.finAlert === null ? [] : [alertCodeOf(r.finAlert)]),
        ].filter((c, n, all) => all.indexOf(c) === n);
        return {
          id: r.instanceId,
          cells: {
            status: (
              <Badge tone={STATUS_TONE[r.status] ?? 'neutral'} icon={null}>
                {STATUS_KEYS[r.status] === undefined
                  ? r.status
                  : i18n.t(STATUS_KEYS[r.status] as MessageKey)}
              </Badge>
            ),
            amount: moneyOf(i18n, view, r, r.amountMinor),
            issued:
              r.issuedAt === null
                ? i18n.t('backoffice.refunds.notIssued')
                : `${i18n.dateTime(r.issuedAt, 'UTC')} UTC`,
            detail: (
              <ul className={styles['list']}>
                <li>
                  {RAIL_KEYS[r.rail] === undefined
                    ? r.rail
                    : i18n.t(RAIL_KEYS[r.rail] as MessageKey)}
                  {' · '}
                  {i18n.t('backoffice.refunds.attempt', {
                    n: r.attemptNo,
                    v: r.settlementVersion,
                  })}
                </li>
                <li>
                  {i18n.t('backoffice.refunds.requested', {
                    legs: legsText(i18n, view, r, r.requestedLegs),
                  })}
                </li>
                <li>
                  {i18n.t('backoffice.refunds.order', {
                    legs: legsText(i18n, view, r, r.orderLegs),
                  })}
                </li>
                {r.advance !== null && (
                  <li>
                    {i18n.t('backoffice.refunds.advance', {
                      amount: moneyOf(i18n, view, r, r.advance.amountMinor),
                    })}
                  </li>
                )}
                {reasons.map((code) => (
                  <li key={code} data-testid="refunds-reason">
                    {reasonText(i18n, code)}
                  </li>
                ))}
              </ul>
            ),
          },
        };
      })}
    />
  );
}
