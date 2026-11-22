'use client';
/**
 * Formulaire de l'incident du voyageur (US-318 ; 16 CLM-002 ; 10b S17, S11) : deux questions
 * fermées (tiers impliqué, police prévenue ; jamais présélectionnées), puis l'envoi. Après l'envoi :
 * « Incidente registrado », l'heure du SERVEUR (fuseau du trip) et le nombre de photos jointes. Sans
 * JavaScript : envoi natif. L'identifiant de la requête est posé par le serveur à l'affichage.
 * Sans photo reçue, le bouton est inactif et une consigne dit pourquoi (revue ux n° 7) ; la base
 * reste juge (`INCIDENT_PHOTOS_REQUIRED`).
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, ErrorSummary } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../../../locale-config.ts';
import accountStyles from '../../../_account/account.module.css';
import styles from '../../../host/host.module.css';
import { reportIncidentAction } from './actions.ts';
import type { IncidentState } from './actions.ts';
import { INCIDENT_FORM_ID, INCIDENT_POLICE_ID, INCIDENT_THIRD_PARTY_ID } from './ids.ts';

const INITIAL: IncidentState = { errors: [] };

export interface IncidentFormProps {
  readonly localeTag: string;
  readonly tripId: string;
  readonly caseId: string;
  readonly requestId: string;
  readonly timezone: string;
  /** Photos déjà reçues dans la série INCIDENT (relues par la page après chaque envoi). */
  readonly photoCount: number;
}

export function IncidentForm({
  localeTag,
  tripId,
  caseId,
  requestId,
  timezone,
  photoCount,
}: IncidentFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const t = i18n.t.bind(i18n);
  const [state, run, pending] = useActionState(reportIncidentAction, INITIAL);
  const messages = state.errors.map((e) => ({ fieldId: e.fieldId, message: t(e.key, e.values) }));
  const formError = messages.find((m) => m.fieldId === INCIDENT_FORM_ID)?.message;
  const errorOf = (id: string) => messages.find((m) => m.fieldId === id)?.message;
  if (state.sent !== undefined) {
    return (
      <div className={accountStyles['stackTight']} data-testid="s17-incident-sent">
        <Banner tone="success" live="polite">
          {t('web.incident.sent')}
        </Banner>
        <p className={accountStyles['text']} data-testid="s17-incident-sent-at">
          {t('web.incident.sentAt', { time: i18n.dateTime(state.sent.reportedAt, timezone) })}
        </p>
        <p className={accountStyles['text']}>
          {t('web.incident.sentPhotos', { count: state.sent.photoCount })}
        </p>
        <p className={accountStyles['muted']}>{t('web.incident.next')}</p>
      </div>
    );
  }
  const question = (id: string, name: string, legend: string) => {
    const error = errorOf(id);
    return (
      <fieldset
        id={id}
        className={styles['choices']}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
      >
        <legend className={styles['legend']}>{legend}</legend>
        {error !== undefined && (
          <p id={`${id}-error`} className={styles['error']}>
            {error}
          </p>
        )}
        {(['yes', 'no'] as const).map((v) => (
          <label key={v} className={styles['choice']}>
            <input
              type="radio"
              name={name}
              value={v}
              defaultChecked={state.values?.[name === 'police' ? 'police' : 'thirdParty'] === v}
              data-testid={`${id}-${v}`}
            />
            <span>{t(v === 'yes' ? 'web.incident.yes' : 'web.incident.no')}</span>
          </label>
        ))}
      </fieldset>
    );
  };
  return (
    <form
      id={INCIDENT_FORM_ID}
      className={styles['actions']}
      action={run}
      noValidate
      aria-labelledby="s17-incident-form-title"
    >
      <h2 id="s17-incident-form-title" className={accountStyles['h2']}>
        {t('web.incident.form.title')}
      </h2>
      <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== INCIDENT_FORM_ID)} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          <span data-testid="s17-incident-error">{formError}</span>
        </Banner>
      )}
      <input type="hidden" name="trip" value={tripId} />
      <input type="hidden" name="case" value={caseId} />
      <input type="hidden" name="request" value={requestId} />
      {question(INCIDENT_THIRD_PARTY_ID, 'thirdParty', t('web.incident.thirdParty'))}
      {question(INCIDENT_POLICE_ID, 'police', t('web.incident.police'))}
      <p className={accountStyles['muted']}>{t('web.incident.serverTime')}</p>
      {photoCount === 0 && (
        <p
          id="s17-incident-submit-hint"
          className={styles['hint']}
          data-testid="s17-incident-need-photo"
        >
          {t('web.incident.needPhoto')}
        </p>
      )}
      <Button
        type="submit"
        block
        loading={pending}
        disabled={photoCount === 0}
        aria-describedby={photoCount === 0 ? 's17-incident-submit-hint' : undefined}
        data-testid="s17-incident-submit"
      >
        {t('web.incident.submit')}
      </Button>
    </form>
  );
}
