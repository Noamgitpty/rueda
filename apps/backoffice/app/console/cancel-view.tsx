/**
 * Annulation d'un voyage déclenchée par l'ops (US-215 partie 215b, ADR-151 ; écran O01 de 10b ; 16
 * ADM-006, BKG-035). Composant de PRÉSENTATION pur (aucun appel réseau, aucun état) ; l'enchaînement
 * est dans `console-client.tsx`.
 *
 * Parcours en trois temps, comme les actions sensibles de la console : (1) qui demande l'annulation
 * (voyageur, hôte, plateforme), puis le formulaire propre à ce demandeur (motif qualifié en liste
 * FERMÉE, motif libre, pièces) ; (2) confirmation avant envoi (rien n'est envoyé avant) ; (3) état
 * RÉEL de la demande, lu dans l'API après l'envoi : en attente de règlement, réglée (porteur du
 * coût, remboursement et variation par jambe, ordres de remboursement), en revue FINANCE ou en échec,
 * avec la suite à donner. Jamais « C'est fait » tant que le règlement n'est pas fait.
 *
 * Aucun montant saisi : la plateforme le calcule (17 §10 NN3). Les montants affichés viennent de
 * l'API en unités mineures (texte) avec l'exposant de la devise : affichage seulement.
 */
import type { FormEvent, ReactNode } from 'react';
import type { MessageKey, Translator } from '@rueda/i18n';
import { Badge, Banner, Button, DataTable, TextField } from '@rueda/ui';
import styles from './console.module.css';

export const CANCEL_INITIATORS = ['GUEST', 'HOST', 'PLATFORM'] as const;
export type CancelInitiator = (typeof CANCEL_INITIATORS)[number];

/** Action de console de chaque demandeur (catalogue d'US-101, liaison de 0124). */
export const CANCEL_ACTION: Readonly<Record<CancelInitiator, string>> = {
  GUEST: 'CANCEL_TRIP_GUEST',
  HOST: 'CANCEL_TRIP_HOST',
  PLATFORM: 'CANCEL_TRIP_PLATFORM',
};

/** Sous-motifs « à cause du voyageur » de l'hôte (énumération fermée du catalogue, 0124). */
export const HOST_SUB_REASONS = [
  'INVALID_LICENSE',
  'IDENTITY_NOT_VERIFIED',
  'OTHER_DRIVER_SENT',
  'LICENSE_NOT_UPLOADED',
] as const;
export type HostSubReason = (typeof HOST_SUB_REASONS)[number];

/** Motifs de la plateforme (énumération fermée du catalogue, 0124). */
export const PLATFORM_REASONS = [
  'PLATFORM_TRUST_SAFETY',
  'PLATFORM_INCOMPLETE_STEPS',
  'GUEST_FRAUD_PROVEN',
  'HOST_ACCOUNT_CLOSED',
  'PLATFORM_REVIEW_DELAY',
  'PSP_FAILURE',
] as const;
export type PlatformReason = (typeof PLATFORM_REASONS)[number];

/** Saisie de l'agent, vérifiée avant la confirmation. */
export interface CancelDraft {
  readonly tripId: string;
  readonly initiator: CancelInitiator;
  /** Hôte : sous-motif « à cause du voyageur », ou null (annulation de l'hôte). */
  readonly subReason: HostSubReason | null;
  /** Plateforme : motif exigé. */
  readonly platformReason: PlatformReason | null;
  readonly reason: string;
  readonly evidence: readonly string[];
}

/** Règlement lié à une demande réglée (GET /console/cancellations/{id}, 0128). */
export interface CancellationSettlementView {
  readonly currency: string;
  readonly exponent: number;
  readonly guestRefundMinor: string;
  readonly hostPenaltyMinor: string;
  readonly hostCompensationMinor: string;
  readonly legs: readonly { readonly leg: string; readonly variationMinor: string }[];
  readonly refunds: readonly { readonly status: string; readonly amountMinor: string }[];
}

/** Dernière demande d'annulation d'un trip (0128). */
export interface CancellationView {
  readonly cancellationId: string;
  readonly tripId: string;
  readonly action: string;
  readonly requestedReason: string;
  readonly initiator: string;
  readonly subReason: string | null;
  readonly status: 'PENDING' | 'SETTLED' | 'FIN_REVIEW' | 'FAILED';
  readonly outcomeCode: string | null;
  readonly costBearer: string | null;
  readonly requestedAt: string;
  readonly decidedAt: string | null;
  readonly tripStatus: string;
  readonly settlement: CancellationSettlementView | null;
}

export type CancelState =
  | {
      readonly step: 'form';
      readonly initiator: CancelInitiator | null;
      /** Saisie reprise après « Modifier ». */
      readonly draft?: CancelDraft | undefined;
      readonly error?: MessageKey | undefined;
    }
  | { readonly step: 'confirm'; readonly draft: CancelDraft }
  | {
      readonly step: 'state';
      readonly tripId: string;
      /** Lecture : demande, aucune demande (null), ou échec de lecture. */
      readonly view: CancellationView | null | 'error' | undefined;
      /** Refus de la demande (rien n'a été enregistré) ou message de l'envoi. */
      readonly notice?:
        { readonly tone: 'success' | 'warning' | 'danger'; readonly key: MessageKey } | undefined;
      /** Toujours en attente après les relectures automatiques. */
      readonly slow?: boolean | undefined;
      /** Le refus CANCELLATION_PENDING propose de lire la demande vivante. */
      readonly offerRead?: boolean | undefined;
    };

export interface CancelHandlers {
  readonly onCancelInitiator: (initiator: CancelInitiator) => void;
  readonly onCancelReview: (draft: CancelDraft) => void;
  readonly onCancelEdit: () => void;
  readonly onCancelConfirm: () => void;
  readonly onCancelRead: (tripId: string) => void;
  readonly onCancelRestart: () => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Refus de la commande liée (STAFF_ACTION_REFUSED, `values.reason`, 0124) expliqués à l'agent. */
export const CANCEL_REFUSAL_KEYS: Readonly<Record<string, MessageKey>> = {
  CANCEL_REASON_REQUIRED: 'backoffice.cancel.refused.CANCEL_REASON_REQUIRED',
  TRIP_TRANSITION_FORBIDDEN: 'backoffice.cancel.refused.TRIP_TRANSITION_FORBIDDEN',
  CANCELLATION_PENDING: 'backoffice.cancel.refused.CANCELLATION_PENDING',
  SELF_FORBIDDEN: 'backoffice.cancel.refused.SELF_FORBIDDEN',
  NOT_FOUND: 'backoffice.cancel.refused.NOT_FOUND',
};

/** Codes d'une demande garée (FIN_REVIEW, FAILED : `outcome_code`, processeur de 215a). */
export const CANCEL_OUTCOME_KEYS: Readonly<Record<string, MessageKey>> = {
  QUOTE_UNAVAILABLE: 'backoffice.cancel.outcome.QUOTE_UNAVAILABLE',
  PARAM_MISSING: 'backoffice.cancel.outcome.PARAM_MISSING',
  TRIP_NOT_CAPTURED: 'backoffice.cancel.outcome.TRIP_NOT_CAPTURED',
  ROW_SHAPE: 'backoffice.cancel.outcome.ROW_SHAPE',
  UNEXPECTED_ERROR: 'backoffice.cancel.outcome.UNEXPECTED_ERROR',
  RETRY_EXHAUSTED: 'backoffice.cancel.outcome.RETRY_EXHAUSTED',
  TRIP_TRANSITION_FORBIDDEN: 'backoffice.cancel.outcome.TRIP_TRANSITION_FORBIDDEN',
  TRIP_CANCELLATION_SETTLEMENT_MISMATCH:
    'backoffice.cancel.outcome.TRIP_CANCELLATION_SETTLEMENT_MISMATCH',
  REFUND_OUT_OF_RANGE: 'backoffice.cancel.outcome.REFUND_OUT_OF_RANGE',
  OPERATION_SETTLEMENT_FIN_REVIEW: 'backoffice.cancel.outcome.OPERATION_SETTLEMENT_FIN_REVIEW',
  REFUND_EXCEEDS_COLLECTED: 'backoffice.cancel.outcome.REFUND_EXCEEDS_COLLECTED',
  ADVANCE_DECISION_REQUIRED: 'backoffice.cancel.outcome.ADVANCE_DECISION_REQUIRED',
  SETTLEMENT_INPUT_INVALID: 'backoffice.cancel.outcome.SETTLEMENT_INPUT_INVALID',
  // US-224f (ADR-166) : remboursement réparti sur les moyens d'origine
  REFUND_RAIL_UNAVAILABLE: 'backoffice.cancel.outcome.REFUND_RAIL_UNAVAILABLE',
  REFUND_RAIL_NOT_NATIVE: 'backoffice.cancel.outcome.REFUND_RAIL_NOT_NATIVE',
  REFUND_EXCEEDS_TENDER: 'backoffice.cancel.outcome.REFUND_EXCEEDS_TENDER',
};

/** Libellés des trois actions (catalogue de la console, US-101). */
const WHO_KEYS: Readonly<Record<string, MessageKey>> = {
  GUEST: 'backoffice.action.CANCEL_TRIP_GUEST',
  HOST: 'backoffice.action.CANCEL_TRIP_HOST',
  PLATFORM: 'backoffice.action.CANCEL_TRIP_PLATFORM',
};

const SUB_KEYS: Readonly<Record<HostSubReason, MessageKey>> = {
  INVALID_LICENSE: 'backoffice.cancel.sub.INVALID_LICENSE',
  IDENTITY_NOT_VERIFIED: 'backoffice.cancel.sub.IDENTITY_NOT_VERIFIED',
  OTHER_DRIVER_SENT: 'backoffice.cancel.sub.OTHER_DRIVER_SENT',
  LICENSE_NOT_UPLOADED: 'backoffice.cancel.sub.LICENSE_NOT_UPLOADED',
};

const PLATFORM_KEYS: Readonly<Record<PlatformReason, MessageKey>> = {
  PLATFORM_TRUST_SAFETY: 'backoffice.cancel.platform.PLATFORM_TRUST_SAFETY',
  PLATFORM_INCOMPLETE_STEPS: 'backoffice.cancel.platform.PLATFORM_INCOMPLETE_STEPS',
  GUEST_FRAUD_PROVEN: 'backoffice.cancel.platform.GUEST_FRAUD_PROVEN',
  HOST_ACCOUNT_CLOSED: 'backoffice.cancel.platform.HOST_ACCOUNT_CLOSED',
  PLATFORM_REVIEW_DELAY: 'backoffice.cancel.platform.PLATFORM_REVIEW_DELAY',
  PSP_FAILURE: 'backoffice.cancel.platform.PSP_FAILURE',
};

const STATUS_KEYS: Readonly<
  Record<CancellationView['status'], { readonly title: MessageKey; readonly body: MessageKey }>
> = {
  PENDING: {
    title: 'backoffice.cancel.state.PENDING',
    body: 'backoffice.cancel.state.PENDINGBody',
  },
  SETTLED: {
    title: 'backoffice.cancel.state.SETTLED',
    body: 'backoffice.cancel.state.SETTLEDBody',
  },
  FIN_REVIEW: {
    title: 'backoffice.cancel.state.FIN_REVIEW',
    body: 'backoffice.cancel.state.FIN_REVIEWBody',
  },
  FAILED: { title: 'backoffice.cancel.state.FAILED', body: 'backoffice.cancel.state.FAILEDBody' },
};

const STATUS_TONE = {
  PENDING: 'info',
  SETTLED: 'success',
  FIN_REVIEW: 'warning',
  FAILED: 'danger',
} as const;

const BEARER_KEYS: Readonly<Record<string, MessageKey>> = {
  GUEST: 'backoffice.cancel.bearer.GUEST',
  HOST: 'backoffice.cancel.bearer.HOST',
  PLATFORM: 'backoffice.cancel.bearer.PLATFORM',
};

const TRIP_STATUS_KEYS: Readonly<Record<string, MessageKey>> = {
  CANCELLED_BY_GUEST: 'backoffice.cancel.trip.CANCELLED_BY_GUEST',
  CANCELLED_BY_HOST: 'backoffice.cancel.trip.CANCELLED_BY_HOST',
  CANCELLED_BY_PLATFORM: 'backoffice.cancel.trip.CANCELLED_BY_PLATFORM',
  NO_SHOW_GUEST: 'backoffice.cancel.trip.NO_SHOW_GUEST',
};

const LEG_KEYS: Readonly<Record<string, MessageKey>> = {
  HOST: 'backoffice.cancel.leg.HOST',
  INSURER: 'backoffice.cancel.leg.INSURER',
  TAX_THIRD_PARTY: 'backoffice.cancel.leg.TAX_THIRD_PARTY',
  PLATFORM: 'backoffice.cancel.leg.PLATFORM',
};

const REFUND_STATUS_KEYS: Readonly<Record<string, MessageKey>> = {
  PENDING: 'backoffice.cancel.refund.PENDING',
  SUBMITTED: 'backoffice.cancel.refund.SUBMITTED',
  SUCCEEDED: 'backoffice.cancel.refund.SUCCEEDED',
  FAILED: 'backoffice.cancel.refund.FAILED',
  UNKNOWN: 'backoffice.cancel.refund.UNKNOWN',
};

/** Texte d'un code connu, sinon le code lui-même (jamais un texte inventé). */
const labelOf = (i18n: Translator, keys: Readonly<Record<string, MessageKey>>, code: string) => {
  const key = keys[code];
  return key === undefined ? code : i18n.t(key);
};

/** Motif DEMANDÉ tel que l'agent l'a choisi (action, sous-motif ou motif de la plateforme). */
export function requestedLabel(i18n: Translator, v: CancellationView): string {
  if (v.action === 'CANCEL_TRIP_PLATFORM') return labelOf(i18n, PLATFORM_KEYS, v.requestedReason);
  if (v.action === 'CANCEL_TRIP_HOST') {
    if (v.subReason === null) return i18n.t('backoffice.cancel.sub.none');
    // la base stocke LICENSE_NOT_UPLOADED_1H (08) ; la console a envoyé LICENSE_NOT_UPLOADED
    const sub = v.subReason === 'LICENSE_NOT_UPLOADED_1H' ? 'LICENSE_NOT_UPLOADED' : v.subReason;
    return labelOf(i18n, SUB_KEYS, sub);
  }
  return i18n.t('backoffice.cancel.guestMotive');
}

/**
 * Contrôles de la saisie avant la confirmation (la base reste juge) : identifiant complet du trip,
 * motif de 10 à 1 000 caractères, motif de la plateforme exigé. Rend la clé du premier manquement.
 */
export function draftProblem(d: CancelDraft): MessageKey | null {
  if (!UUID.test(d.tripId)) return 'backoffice.cancel.error.trip';
  const n = [...d.reason.trim()].length;
  if (n < 10 || n > 1000) return 'backoffice.cancel.error.reason';
  if (d.initiator === 'PLATFORM' && d.platformReason === null) {
    return 'backoffice.cancel.error.platformReason';
  }
  return null;
}

function fieldOf(event: FormEvent<HTMLFormElement>, name: string): string {
  const value = new FormData(event.currentTarget).get(name);
  return typeof value === 'string' ? value : '';
}

function evidenceOf(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

const oneOf = <T extends string>(value: string, allowed: readonly T[]): T | null =>
  (allowed as readonly string[]).includes(value) ? (value as T) : null;

function money(i18n: Translator, s: CancellationSettlementView, minor: string): string {
  return i18n.money({ amountMinor: BigInt(minor), currency: s.currency, exponent: s.exponent });
}

export function CancelPanel({
  i18n,
  state,
  handlers,
  busy = false,
}: {
  readonly i18n: Translator;
  readonly state: CancelState;
  readonly handlers: CancelHandlers;
  readonly busy?: boolean;
}) {
  return (
    <section className={styles['panel']} aria-labelledby="cancel-heading">
      <h2 id="cancel-heading" className={styles['heading']} tabIndex={-1}>
        {i18n.t('backoffice.cancel.heading')}
      </h2>
      {state.step === 'form' && (
        <CancelForm i18n={i18n} state={state} handlers={handlers} busy={busy} />
      )}
      {state.step === 'confirm' && (
        <CancelConfirm i18n={i18n} draft={state.draft} handlers={handlers} busy={busy} />
      )}
      {state.step === 'state' && (
        <CancelStateView i18n={i18n} state={state} handlers={handlers} busy={busy} />
      )}
    </section>
  );
}

function CancelForm({
  i18n,
  state,
  handlers,
  busy,
}: {
  readonly i18n: Translator;
  readonly state: Extract<CancelState, { step: 'form' }>;
  readonly handlers: CancelHandlers;
  readonly busy: boolean;
}) {
  const { initiator, draft, error } = state;
  return (
    <>
      <p className={styles['muted']}>{i18n.t('backoffice.cancel.intro')}</p>
      {error !== undefined && (
        <Banner tone="danger" live="assertive">
          {i18n.t(error)}
        </Banner>
      )}
      <div role="group" aria-labelledby="cancel-who" className={styles['group']}>
        <h3 id="cancel-who" className={styles['label']}>
          {i18n.t('backoffice.cancel.who')}
        </h3>
        <div className={styles['actions']}>
          {CANCEL_INITIATORS.map((who) => (
            <Button
              key={who}
              variant={who === initiator ? 'primary' : 'secondary'}
              aria-pressed={who === initiator}
              onClick={() => handlers.onCancelInitiator(who)}
            >
              {labelOf(i18n, WHO_KEYS, who)}
            </Button>
          ))}
        </div>
      </div>
      {initiator === null ? (
        <p className={styles['muted']}>{i18n.t('backoffice.cancel.whoHint')}</p>
      ) : (
        <form
          className={styles['form']}
          data-testid="cancel-form"
          onSubmit={(e) => {
            e.preventDefault();
            handlers.onCancelReview({
              tripId: fieldOf(e, 'tripId').trim().toLowerCase(),
              initiator,
              subReason:
                initiator === 'HOST' ? oneOf(fieldOf(e, 'subReason'), HOST_SUB_REASONS) : null,
              platformReason:
                initiator === 'PLATFORM'
                  ? oneOf(fieldOf(e, 'platformReason'), PLATFORM_REASONS)
                  : null,
              reason: fieldOf(e, 'reason'),
              evidence: evidenceOf(fieldOf(e, 'evidence')),
            });
          }}
        >
          <TextField
            i18n={i18n}
            id="cancel-trip"
            name="tripId"
            autoComplete="off"
            spellCheck={false}
            defaultValue={draft?.tripId}
            label={i18n.t('backoffice.cancel.trip')}
          />
          {initiator === 'HOST' && (
            <div className={styles['group']}>
              <label className={styles['label']} htmlFor="cancel-sub">
                {i18n.t('backoffice.cancel.sub')}
              </label>
              <select
                id="cancel-sub"
                name="subReason"
                defaultValue={draft?.subReason ?? ''}
                className={styles['select']}
                aria-describedby="cancel-sub-hint"
              >
                <option value="">{i18n.t('backoffice.cancel.sub.none')}</option>
                {HOST_SUB_REASONS.map((s) => (
                  <option key={s} value={s}>
                    {i18n.t(SUB_KEYS[s])}
                  </option>
                ))}
              </select>
              <p id="cancel-sub-hint" className={styles['muted']}>
                {i18n.t('backoffice.cancel.subHint')}
              </p>
            </div>
          )}
          {initiator === 'PLATFORM' && (
            <div className={styles['group']}>
              <label className={styles['label']} htmlFor="cancel-platform">
                {i18n.t('backoffice.cancel.platform')}
              </label>
              {/* aucune présélection : le motif est un choix de l'agent (revue ux US-114) */}
              <select
                id="cancel-platform"
                name="platformReason"
                defaultValue={draft?.platformReason ?? ''}
                required
                className={styles['select']}
              >
                <option value="" disabled>
                  {i18n.t('backoffice.catalog.choose')}
                </option>
                {PLATFORM_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {i18n.t(PLATFORM_KEYS[r])}
                  </option>
                ))}
              </select>
            </div>
          )}
          <TextField
            i18n={i18n}
            id="cancel-reason"
            name="reason"
            minLength={10}
            maxLength={1000}
            defaultValue={draft?.reason}
            label={i18n.t('backoffice.action.reason')}
            hint={i18n.t('backoffice.action.reasonHint')}
          />
          <TextField
            i18n={i18n}
            id="cancel-evidence"
            name="evidence"
            autoComplete="off"
            spellCheck={false}
            optional
            defaultValue={draft?.evidence.join(', ')}
            label={i18n.t('backoffice.action.evidence')}
            hint={i18n.t('backoffice.action.evidenceHint')}
          />
          <p className={styles['muted']}>{i18n.t('backoffice.action.amountNote')}</p>
          <div className={styles['actions']}>
            <Button type="submit" variant="primary" loading={busy} data-testid="cancel-review">
              {i18n.t('backoffice.cancel.review')}
            </Button>
          </div>
        </form>
      )}
      <form
        className={styles['form']}
        aria-labelledby="cancel-read-heading"
        onSubmit={(e) => {
          e.preventDefault();
          handlers.onCancelRead(fieldOf(e, 'tripId').trim().toLowerCase());
        }}
      >
        <h3 id="cancel-read-heading" className={styles['label']}>
          {i18n.t('backoffice.cancel.readHeading')}
        </h3>
        <TextField
          i18n={i18n}
          id="cancel-read-trip"
          name="tripId"
          autoComplete="off"
          spellCheck={false}
          label={i18n.t('backoffice.cancel.trip')}
        />
        <div className={styles['actions']}>
          <Button type="submit" variant="secondary" loading={busy}>
            {i18n.t('backoffice.cancel.read')}
          </Button>
        </div>
      </form>
    </>
  );
}

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className={styles['fact']}>
      <dt className={styles['label']}>{label}</dt>
      <dd className={styles['factValue']}>{children}</dd>
    </div>
  );
}

function CancelConfirm({
  i18n,
  draft,
  handlers,
  busy,
}: {
  readonly i18n: Translator;
  readonly draft: CancelDraft;
  readonly handlers: CancelHandlers;
  readonly busy: boolean;
}) {
  const motive =
    draft.initiator === 'PLATFORM' && draft.platformReason !== null
      ? i18n.t(PLATFORM_KEYS[draft.platformReason])
      : draft.initiator === 'HOST'
        ? draft.subReason === null
          ? i18n.t('backoffice.cancel.sub.none')
          : i18n.t(SUB_KEYS[draft.subReason])
        : i18n.t('backoffice.cancel.guestMotive');
  return (
    <div className={styles['form']} data-testid="cancel-confirm">
      <h3 className={styles['label']}>{i18n.t('backoffice.cancel.confirmHeading')}</h3>
      <Banner tone="warning" live="polite">
        {i18n.t('backoffice.cancel.confirmIntro')}
      </Banner>
      <dl className={styles['facts']}>
        <Fact label={i18n.t('backoffice.cancel.trip')}>
          <code className={styles['code']}>{draft.tripId}</code>
        </Fact>
        <Fact label={i18n.t('backoffice.cancel.action')}>
          {labelOf(i18n, WHO_KEYS, draft.initiator)}
        </Fact>
        <Fact label={i18n.t('backoffice.cancel.motive')}>{motive}</Fact>
        <Fact label={i18n.t('backoffice.action.reason')}>{draft.reason.trim()}</Fact>
        <Fact label={i18n.t('backoffice.cancel.evidenceCount')}>
          {draft.evidence.length === 0
            ? i18n.t('backoffice.cancel.evidenceNone')
            : String(draft.evidence.length)}
        </Fact>
      </dl>
      {draft.initiator === 'HOST' && draft.subReason !== null && draft.evidence.length === 0 && (
        <Banner tone="warning" live="polite">
          {i18n.t('backoffice.cancel.noEvidenceWarning')}
        </Banner>
      )}
      <div className={styles['actions']}>
        <Button
          variant="primary"
          loading={busy}
          onClick={handlers.onCancelConfirm}
          data-testid="cancel-send"
        >
          {i18n.t('backoffice.cancel.confirm')}
        </Button>
        <Button variant="secondary" onClick={handlers.onCancelEdit}>
          {i18n.t('backoffice.cancel.edit')}
        </Button>
      </div>
    </div>
  );
}

function CancelStateView({
  i18n,
  state,
  handlers,
  busy,
}: {
  readonly i18n: Translator;
  readonly state: Extract<CancelState, { step: 'state' }>;
  readonly handlers: CancelHandlers;
  readonly busy: boolean;
}) {
  const { view, notice, tripId } = state;
  return (
    <div className={styles['form']} data-testid="cancel-state">
      <h3 className={styles['label']}>{i18n.t('backoffice.cancel.stateHeading')}</h3>
      {notice !== undefined && (
        <Banner tone={notice.tone} live="polite">
          {i18n.t(notice.key)}
        </Banner>
      )}
      {view === 'error' && (
        <Banner tone="danger" live="polite">
          {i18n.t('backoffice.cancel.readError')}
        </Banner>
      )}
      {view === null && <p className={styles['muted']}>{i18n.t('backoffice.cancel.none')}</p>}
      {view !== null && view !== 'error' && view !== undefined && (
        <CancellationDetails i18n={i18n} view={view} slow={state.slow === true} />
      )}
      <div className={styles['actions']}>
        {(state.offerRead === true || (view !== undefined && view !== null)) && (
          <Button variant="secondary" loading={busy} onClick={() => handlers.onCancelRead(tripId)}>
            {i18n.t(
              state.offerRead === true ? 'backoffice.cancel.readLive' : 'backoffice.cancel.refresh',
            )}
          </Button>
        )}
        <Button variant="quiet" onClick={handlers.onCancelRestart}>
          {i18n.t('backoffice.cancel.restart')}
        </Button>
      </div>
    </div>
  );
}

function CancellationDetails({
  i18n,
  view,
  slow,
}: {
  readonly i18n: Translator;
  readonly view: CancellationView;
  readonly slow: boolean;
}) {
  const keys = STATUS_KEYS[view.status];
  const s = view.settlement;
  return (
    <>
      <Banner tone={STATUS_TONE[view.status]} live="polite">
        <span data-testid="cancel-status">{i18n.t(keys.title)}</span>
      </Banner>
      <p className={styles['muted']}>{i18n.t(keys.body)}</p>
      {view.status === 'PENDING' && slow && (
        <p className={styles['muted']}>{i18n.t('backoffice.cancel.slow')}</p>
      )}
      <dl className={styles['facts']}>
        <Fact label={i18n.t('backoffice.cancel.requestId')}>
          <code className={styles['code']}>{view.cancellationId}</code>
        </Fact>
        <Fact label={i18n.t('backoffice.cancel.trip')}>
          <code className={styles['code']}>{view.tripId}</code>
        </Fact>
        <Fact label={i18n.t('backoffice.cancel.action')}>
          {labelOf(i18n, WHO_KEYS, view.initiator)}
        </Fact>
        <Fact label={i18n.t('backoffice.cancel.motive')}>{requestedLabel(i18n, view)}</Fact>
        <Fact label={i18n.t('backoffice.cancel.requestedAt')}>
          {`${i18n.dateTime(view.requestedAt, 'UTC')} UTC`}
        </Fact>
        {view.outcomeCode !== null && (
          <Fact label={i18n.t('backoffice.cancel.why')}>
            {labelOf(i18n, CANCEL_OUTCOME_KEYS, view.outcomeCode)}
          </Fact>
        )}
        {view.status === 'SETTLED' && (
          <Fact label={i18n.t('backoffice.cancel.outcome')}>
            <Badge tone="neutral" icon={null}>
              {labelOf(i18n, TRIP_STATUS_KEYS, view.tripStatus)}
            </Badge>
          </Fact>
        )}
        {view.costBearer !== null && (
          <Fact label={i18n.t('backoffice.cancel.bearer')}>
            {labelOf(i18n, BEARER_KEYS, view.costBearer)}
          </Fact>
        )}
        {s !== null && (
          <>
            <Fact label={i18n.t('backoffice.cancel.refundTotal')}>
              {money(i18n, s, s.guestRefundMinor)}
            </Fact>
            {s.hostPenaltyMinor !== '0' && (
              <Fact label={i18n.t('backoffice.cancel.penalty')}>
                {money(i18n, s, s.hostPenaltyMinor)}
              </Fact>
            )}
            {s.hostCompensationMinor !== '0' && (
              <Fact label={i18n.t('backoffice.cancel.compensation')}>
                {money(i18n, s, s.hostCompensationMinor)}
              </Fact>
            )}
          </>
        )}
      </dl>
      {s !== null && (
        <>
          <DataTable
            id="cancel-legs"
            caption={i18n.t('backoffice.cancel.legsCaption')}
            columns={[
              { key: 'leg', header: i18n.t('backoffice.cancel.legColumn') },
              { key: 'amount', header: i18n.t('backoffice.cancel.amountColumn'), align: 'end' },
            ]}
            rows={s.legs.map((l) => ({
              id: l.leg,
              cells: {
                leg: labelOf(i18n, LEG_KEYS, l.leg),
                amount: money(i18n, s, l.variationMinor),
              },
            }))}
          />
          <DataTable
            id="cancel-refunds"
            caption={i18n.t('backoffice.cancel.refundsCaption')}
            columns={[
              { key: 'amount', header: i18n.t('backoffice.cancel.amountColumn'), align: 'end' },
              { key: 'status', header: i18n.t('backoffice.cancel.refundStatusColumn') },
            ]}
            rows={s.refunds.map((r, n) => ({
              id: `${String(n)}`,
              cells: {
                amount: money(i18n, s, r.amountMinor),
                status: labelOf(i18n, REFUND_STATUS_KEYS, r.status),
              },
            }))}
          />
        </>
      )}
    </>
  );
}
