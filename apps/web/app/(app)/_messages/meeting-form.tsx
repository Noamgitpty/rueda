'use client';
/**
 * Formulaire de proposition d'un rendez-vous par l'hôte (S16, US-316, ADR-186) : étape (remise ou
 * retour), lieu (libellé visible, aide « lieu public, sans téléphone, e-mail ni lien »), date et
 * heure à l'heure locale du trip. Erreur : bannière du formulaire ou erreur liée au champ ; la
 * saisie et l'identifiant de la proposition sont gardés pour réessayer sans doublon. Sans
 * JavaScript : envoi natif.
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, ErrorSummary, fieldIds } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import { MEETING_KINDS, PLACE_MAX_CHARS } from '../../../account/trip-meetings.ts';
import { proposeMeetingAction } from './meeting-actions.ts';
import type { MeetingFormState } from './meeting-actions.ts';
import { MEETING_FORM_ID, MEETING_PLACE_ID, MEETING_WHEN_ID } from './ids.ts';
import styles from './messages.module.css';

const INITIAL: MeetingFormState = { errors: [], place: '', when: '', kind: 'PICKUP' };
const KIND_KEYS = {
  PICKUP: 'web.s16.meeting.kind.PICKUP',
  RETURN: 'web.s16.meeting.kind.RETURN',
} as const;

export interface MeetingFormProps {
  readonly localeTag: string;
  readonly tripId: string;
  /** Fuseau IANA du trip (heure murale du champ). */
  readonly timezone: string;
  /** Identifiant de la proposition, tiré au rendu de la page (réessai sans doublon). */
  readonly meetingId: string;
}

export function MeetingForm({ localeTag, tripId, timezone, meetingId }: MeetingFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const t = i18n.t.bind(i18n);
  const [state, run, pending] = useActionState(proposeMeetingAction, INITIAL);
  const messages = state.errors.map((e) => ({ fieldId: e.fieldId, message: t(e.key, e.values) }));
  const formError = messages.find((m) => m.fieldId === MEETING_FORM_ID)?.message;
  const placeError = messages.find((m) => m.fieldId === MEETING_PLACE_ID)?.message;
  const whenError = messages.find((m) => m.fieldId === MEETING_WHEN_ID)?.message;
  const placeIds = fieldIds(MEETING_PLACE_ID);
  const whenIds = fieldIds(MEETING_WHEN_ID);
  return (
    <form
      id={MEETING_FORM_ID}
      className={styles['form']}
      action={run}
      noValidate
      data-testid="s16-meeting-form"
    >
      <h3 className={styles['label']}>{t('web.s16.meeting.form.title')}</h3>
      <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== MEETING_FORM_ID)} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      <input type="hidden" name="trip" value={tripId} />
      <input type="hidden" name="id" value={meetingId} />
      <input type="hidden" name="zone" value={timezone} />
      <fieldset className={`${styles['field']} ${styles['fieldset']}`}>
        <legend className={styles['label']}>{t('web.s16.meeting.form.kind')}</legend>
        <div className={styles['choices']}>
          {MEETING_KINDS.map((k) => (
            <label key={k} className={styles['choice']}>
              <input type="radio" name="kind" value={k} defaultChecked={state.kind === k} />
              {t(KIND_KEYS[k])}
            </label>
          ))}
        </div>
      </fieldset>
      <div className={styles['field']}>
        <label className={styles['label']} htmlFor={MEETING_PLACE_ID}>
          {t('web.s16.meeting.form.place')}
        </label>
        <input
          id={MEETING_PLACE_ID}
          name="place"
          type="text"
          className={styles['input']}
          maxLength={PLACE_MAX_CHARS}
          required
          defaultValue={state.place}
          aria-invalid={placeError !== undefined ? true : undefined}
          aria-describedby={[placeError !== undefined ? placeIds.error : '', placeIds.hint]
            .filter(Boolean)
            .join(' ')}
          data-testid="s16-meeting-place"
        />
        {placeError !== undefined && (
          <p id={placeIds.error} className={styles['error']}>
            {placeError}
          </p>
        )}
        <p id={placeIds.hint} className={styles['hint']}>
          {t('web.s16.meeting.form.placeHint')}
        </p>
      </div>
      <div className={styles['field']}>
        <label className={styles['label']} htmlFor={MEETING_WHEN_ID}>
          {t('web.s16.meeting.form.when')}
        </label>
        <input
          id={MEETING_WHEN_ID}
          name="when"
          type="datetime-local"
          className={styles['input']}
          required
          defaultValue={state.when}
          aria-invalid={whenError !== undefined ? true : undefined}
          aria-describedby={[whenError !== undefined ? whenIds.error : '', whenIds.hint]
            .filter(Boolean)
            .join(' ')}
          data-testid="s16-meeting-when"
        />
        {whenError !== undefined && (
          <p id={whenIds.error} className={styles['error']}>
            {whenError}
          </p>
        )}
        <p id={whenIds.hint} className={styles['hint']}>
          {t('web.s16.meeting.form.whenHint')}
        </p>
      </div>
      <Button type="submit" block loading={pending} data-testid="s16-meeting-submit">
        {t('web.s16.meeting.form.submit')}
      </Button>
    </form>
  );
}
