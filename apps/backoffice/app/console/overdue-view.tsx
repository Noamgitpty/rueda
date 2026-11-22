/**
 * Vue des retards de la console et escalade de non-restitution (US-306, ADR-193 ; 16 ADM-022,
 * TRP-038 ; 08 BR-RETURN-04 ; écran O01 de 10b). Composant de PRÉSENTATION pur (aucun appel
 * réseau, aucun état) ; l'enchaînement est dans `console-client.tsx`.
 *
 * L'agent (OPS_AGENT, ADMIN ; la base reste juge : ops.force_terminate_trip dans le pays du trip)
 * voit les trips en retard de ses pays, lus en direct : retard, étape du dossier (T30M, T2H, T6H,
 * T24H), prochaine étape et l'heure à partir de laquelle elle est possible, étapes déjà franchies.
 * Il prépare l'étape suivante (une seule à la fois), saisit son motif, puis confirme : l'action
 * `ESCALATE_OVERDUE` part avec l'étape demandée (liste fermée, jamais un montant). Ce que la
 * plateforme fait et ne fait pas est dit avant la confirmation : gabarits remis à l'hôte par
 * e-mail, plainte déposée par l'hôte, aucune récupération ni coupure du véhicule (OQ-BR-17).
 * Aucune donnée personnelle : identifiants techniques et heures seulement (contacts : fiche 360°).
 */
import type { FormEvent } from 'react';
import type { MessageKey, Translator } from '@rueda/i18n';
import { Badge, Banner, Button, DataTable, TextField } from '@rueda/ui';
import styles from './console.module.css';

/** Rôles qui détiennent ops.force_terminate_trip (0060) ; la base reste juge. */
export const OVERDUE_ROLES = new Set(['OPS_AGENT', 'ADMIN']);

/** Étape demandée à l'action ESCALATE_OVERDUE (saisie fermée `escalationStep`, 0173). */
export type EscalationStep = 'CONTACT' | 'FORMAL_NOTICE' | 'POLICE_REPORT';
export const ESCALATION_STEPS: readonly EscalationStep[] = [
  'CONTACT',
  'FORMAL_NOTICE',
  'POLICE_REPORT',
];

export interface OverdueEscalationView {
  readonly stage: string;
  readonly escalatedAt: string;
  readonly documents: readonly string[];
}

export interface OverdueTripView {
  readonly tripId: string;
  readonly country: string;
  readonly status: string;
  readonly stage: string | null;
  readonly scheduledEnd: string;
  readonly detectedAt: string | null;
  readonly lateMinutes: number;
  readonly nextStep: EscalationStep | null;
  readonly nextStepAt: string | null;
  readonly paramMissing: boolean;
  readonly nextTripAtRisk: boolean;
  readonly escalations: readonly OverdueEscalationView[];
}

export interface OverdueBoardView {
  readonly countries: readonly string[];
  readonly readAt: string;
  /** Plus de 500 trips après le filtre de séparation des tâches : seuls les 500 plus anciens. */
  readonly truncated: boolean;
  readonly trips: readonly OverdueTripView[];
}

export interface OverdueState {
  /** `error` : lecture refusée ou impossible (expliquée par `notice`), jamais « rien ». */
  readonly view?: OverdueBoardView | 'error' | undefined;
  /** Étape préparée (une à la fois) : formulaire de confirmation affiché. */
  readonly draft?:
    | {
        readonly tripId: string;
        readonly step: EscalationStep;
        readonly error?: MessageKey | undefined;
      }
    | undefined;
  readonly notice?:
    { readonly tone: 'success' | 'warning' | 'danger'; readonly key: MessageKey } | undefined;
}

export interface OverdueHandlers {
  readonly onOverdueRefresh: () => void;
  readonly onOverduePrepare: (tripId: string, step: EscalationStep) => void;
  readonly onOverdueCancel: () => void;
  readonly onOverdueEscalate: (tripId: string, step: EscalationStep, reason: string) => void;
}

const STAGE_KEYS: Readonly<Record<string, MessageKey>> = {
  T30M: 'backoffice.overdue.stage.T30M',
  T2H: 'backoffice.overdue.stage.T2H',
  T6H: 'backoffice.overdue.stage.T6H',
  T24H: 'backoffice.overdue.stage.T24H',
  RESOLVED: 'backoffice.overdue.stage.RESOLVED',
};

const STAGE_TONE: Readonly<Record<string, 'neutral' | 'warning' | 'danger'>> = {
  T30M: 'neutral',
  T2H: 'warning',
  T6H: 'warning',
  T24H: 'danger',
};

export const STEP_KEYS: Readonly<Record<EscalationStep, MessageKey>> = {
  CONTACT: 'backoffice.overdue.step.CONTACT',
  FORMAL_NOTICE: 'backoffice.overdue.step.FORMAL_NOTICE',
  POLICE_REPORT: 'backoffice.overdue.step.POLICE_REPORT',
};

/** Ce que l'étape produit et ce qui est remis à l'hôte, dit avant la confirmation. */
const STEP_EFFECT_KEYS: Readonly<Record<EscalationStep, MessageKey>> = {
  CONTACT: 'backoffice.overdue.effect.CONTACT',
  FORMAL_NOTICE: 'backoffice.overdue.effect.FORMAL_NOTICE',
  POLICE_REPORT: 'backoffice.overdue.effect.POLICE_REPORT',
};

const DOCUMENT_KEYS: Readonly<Record<string, MessageKey>> = {
  CONTACT_SCRIPT: 'backoffice.overdue.document.CONTACT_SCRIPT',
  DEMAND_LETTER: 'backoffice.overdue.document.DEMAND_LETTER',
  GPS_REQUEST: 'backoffice.overdue.document.GPS_REQUEST',
  POLICE_REPORT_DRAFT: 'backoffice.overdue.document.POLICE_REPORT_DRAFT',
};

/**
 * Refus de la commande liée (0173, `values.reason`) expliqués ; un autre code : message de l'API.
 */
export const OVERDUE_REFUSAL_KEYS: Readonly<Record<string, MessageKey>> = {
  OVERDUE_STEP_TOO_EARLY: 'backoffice.overdue.refused.OVERDUE_STEP_TOO_EARLY',
  OVERDUE_STEP_OUT_OF_ORDER: 'backoffice.overdue.refused.OVERDUE_STEP_OUT_OF_ORDER',
  TRIP_NOT_OVERDUE: 'backoffice.overdue.refused.TRIP_NOT_OVERDUE',
  OVERDUE_CASE_MISSING: 'backoffice.overdue.refused.OVERDUE_CASE_MISSING',
  PARAM_MISSING: 'backoffice.overdue.refused.PARAM_MISSING',
  SELF_FORBIDDEN: 'backoffice.overdue.refused.SELF_FORBIDDEN',
};

const textOf = (i18n: Translator, keys: Readonly<Record<string, MessageKey>>, code: string) =>
  keys[code] === undefined ? code : i18n.t(keys[code] as MessageKey);

/** Retard lisible : heures et minutes (mesuré par la base à la lecture). */
function lateText(i18n: Translator, minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0
    ? i18n.t('backoffice.overdue.lateMinutes', { m })
    : i18n.t('backoffice.overdue.lateHours', { h, m });
}

const utc = (i18n: Translator, iso: string) => `${i18n.dateTime(iso, 'UTC')} UTC`;

function reasonOf(event: FormEvent<HTMLFormElement>): string {
  const value = new FormData(event.currentTarget).get('reason');
  return typeof value === 'string' ? value : '';
}

export function OverduePanel({
  i18n,
  state,
  handlers,
  busy = false,
}: {
  readonly i18n: Translator;
  readonly state: OverdueState;
  readonly handlers: OverdueHandlers;
  readonly busy?: boolean;
}) {
  const view = state.view;
  const draft = state.draft;
  return (
    <section className={styles['panel']} aria-labelledby="overdue-heading">
      <h2 id="overdue-heading" className={styles['heading']} tabIndex={-1}>
        {i18n.t('backoffice.overdue.heading')}
      </h2>
      <p className={styles['muted']}>{i18n.t('backoffice.overdue.lead')}</p>
      <div className={styles['actions']}>
        <Button variant="secondary" loading={busy} onClick={handlers.onOverdueRefresh}>
          {i18n.t('backoffice.overdue.refresh')}
        </Button>
      </div>
      {view !== undefined && view !== 'error' && (
        <p className={styles['muted']} data-testid="overdue-read-at">
          {i18n.t('backoffice.overdue.readAt', {
            at: utc(i18n, view.readAt),
            countries: view.countries.join(', '),
          })}
        </p>
      )}
      {view !== undefined && view !== 'error' && view.truncated && (
        <Banner tone="warning" live="polite">
          {i18n.t('backoffice.overdue.truncated')}
        </Banner>
      )}
      {state.notice !== undefined && (
        <Banner tone={state.notice.tone} live="polite">
          {i18n.t(state.notice.key)}
        </Banner>
      )}
      {view !== undefined && view !== 'error' && (
        <OverdueTable i18n={i18n} view={view} handlers={handlers} busy={busy} />
      )}
      {draft !== undefined && (
        <form
          className={styles['form']}
          aria-labelledby="overdue-confirm-heading"
          onSubmit={(e) => {
            e.preventDefault();
            handlers.onOverdueEscalate(draft.tripId, draft.step, reasonOf(e));
          }}
        >
          <h3 id="overdue-confirm-heading" className={styles['label']} tabIndex={-1}>
            {i18n.t('backoffice.overdue.confirmHeading', {
              step: i18n.t(STEP_KEYS[draft.step]),
              tripId: draft.tripId,
            })}
          </h3>
          <p>{i18n.t(STEP_EFFECT_KEYS[draft.step])}</p>
          <p className={styles['muted']}>{i18n.t('backoffice.overdue.never')}</p>
          <TextField
            i18n={i18n}
            id="overdue-reason"
            name="reason"
            minLength={10}
            maxLength={1000}
            label={i18n.t('backoffice.action.reason')}
            hint={i18n.t('backoffice.overdue.reasonHint')}
            error={draft.error !== undefined ? i18n.t(draft.error) : undefined}
          />
          <div className={styles['actions']}>
            <Button type="submit" loading={busy}>
              {i18n.t('backoffice.overdue.confirm', { step: i18n.t(STEP_KEYS[draft.step]) })}
            </Button>
            <Button variant="quiet" onClick={handlers.onOverdueCancel}>
              {i18n.t('backoffice.overdue.cancel')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function OverdueTable({
  i18n,
  view,
  handlers,
  busy,
}: {
  readonly i18n: Translator;
  readonly view: OverdueBoardView;
  readonly handlers: OverdueHandlers;
  readonly busy: boolean;
}) {
  if (view.trips.length === 0) {
    return (
      <p className={styles['muted']} data-testid="overdue-none">
        {i18n.t('backoffice.overdue.none')}
      </p>
    );
  }
  return (
    <DataTable
      id="overdue-table"
      caption={i18n.t('backoffice.overdue.caption')}
      columns={[
        { key: 'trip', header: i18n.t('backoffice.overdue.tripColumn') },
        { key: 'stage', header: i18n.t('backoffice.overdue.stageColumn') },
        { key: 'next', header: i18n.t('backoffice.overdue.nextColumn') },
      ]}
      rows={view.trips.map((t) => ({
        id: t.tripId,
        cells: {
          trip: (
            <ul className={styles['list']}>
              <li>
                <code>{t.tripId}</code>
              </li>
              <li>
                {t.country} · {lateText(i18n, t.lateMinutes)}
              </li>
              <li>{i18n.t('backoffice.overdue.end', { at: utc(i18n, t.scheduledEnd) })}</li>
              {t.nextTripAtRisk && <li>{i18n.t('backoffice.overdue.nextTripAtRisk')}</li>}
            </ul>
          ),
          stage: (
            <ul className={styles['list']}>
              <li>
                <Badge tone={STAGE_TONE[t.stage ?? ''] ?? 'neutral'} icon={null}>
                  {t.stage === null
                    ? i18n.t('backoffice.overdue.stage.none')
                    : textOf(i18n, STAGE_KEYS, t.stage)}
                </Badge>
              </li>
              {t.escalations.map((e) => (
                <li key={e.stage} data-testid="overdue-escalation">
                  {i18n.t('backoffice.overdue.escalated', {
                    stage: textOf(i18n, STAGE_KEYS, e.stage),
                    at: utc(i18n, e.escalatedAt),
                    documents: e.documents.map((d) => textOf(i18n, DOCUMENT_KEYS, d)).join(', '),
                  })}
                </li>
              ))}
            </ul>
          ),
          next: <NextStep i18n={i18n} trip={t} handlers={handlers} busy={busy} />,
        },
      }))}
    />
  );
}

function NextStep({
  i18n,
  trip,
  handlers,
  busy,
}: {
  readonly i18n: Translator;
  readonly trip: OverdueTripView;
  readonly handlers: OverdueHandlers;
  readonly busy: boolean;
}) {
  if (trip.paramMissing) {
    return <span>{i18n.t('backoffice.overdue.paramMissing')}</span>;
  }
  if (trip.nextStep === null) {
    return <span>{i18n.t('backoffice.overdue.allDone')}</span>;
  }
  const step = trip.nextStep;
  return (
    <ul className={styles['list']}>
      <li>{i18n.t(STEP_KEYS[step])}</li>
      {trip.nextStepAt !== null && (
        <li>{i18n.t('backoffice.overdue.from', { at: utc(i18n, trip.nextStepAt) })}</li>
      )}
      <li>
        <Button
          variant="secondary"
          loading={busy}
          aria-label={i18n.t('backoffice.overdue.prepareFor', {
            step: i18n.t(STEP_KEYS[step]),
            tripId: trip.tripId,
          })}
          onClick={() => handlers.onOverduePrepare(trip.tripId, step)}
        >
          {i18n.t('backoffice.overdue.prepare')}
        </Button>
      </li>
    </ul>
  );
}
