'use client';
/**
 * Formulaire d'envoi d'un message (S16, US-525) : zone de texte avec libellé visible et aide
 * (« coordonne ici la remise, jamais de données de paiement »), bouton d'envoi. Erreur : bannière
 * du formulaire ou erreur liée au champ ; le texte saisi et l'identifiant du message sont gardés
 * pour réessayer sans doublon. Sans JavaScript : envoi natif.
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, ErrorSummary, fieldIds } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import { MESSAGE_MAX_CHARS } from '../../../account/trip-messages.ts';
import { postMessageAction } from './actions.ts';
import type { MessageFormState } from './actions.ts';
import { MESSAGE_BODY_ID, MESSAGE_FORM_ID } from './ids.ts';
import styles from './messages.module.css';

const INITIAL: MessageFormState = { errors: [], draft: '' };

export interface MessageFormProps {
  readonly localeTag: string;
  readonly tripId: string;
  readonly scope: 'guest' | 'host';
  /** Identifiant du message, tiré au rendu de la page (réessai sans doublon). */
  readonly messageId: string;
}

export function MessageForm({ localeTag, tripId, scope, messageId }: MessageFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const t = i18n.t.bind(i18n);
  const [state, run, pending] = useActionState(postMessageAction, INITIAL);
  const messages = state.errors.map((e) => ({ fieldId: e.fieldId, message: t(e.key, e.values) }));
  const formError = messages.find((m) => m.fieldId === MESSAGE_FORM_ID)?.message;
  const bodyError = messages.find((m) => m.fieldId === MESSAGE_BODY_ID)?.message;
  const ids = fieldIds(MESSAGE_BODY_ID);
  return (
    <form
      id={MESSAGE_FORM_ID}
      className={styles['form']}
      action={run}
      noValidate
      data-testid="s16-form"
    >
      <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== MESSAGE_FORM_ID)} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      <input type="hidden" name="trip" value={tripId} />
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="id" value={messageId} />
      <div className={styles['field']}>
        <label className={styles['label']} htmlFor={MESSAGE_BODY_ID}>
          {t('web.s16.form.label')}
        </label>
        <textarea
          id={MESSAGE_BODY_ID}
          name="body"
          className={styles['textarea']}
          rows={3}
          maxLength={MESSAGE_MAX_CHARS}
          required
          defaultValue={state.draft}
          aria-invalid={bodyError !== undefined ? true : undefined}
          aria-describedby={[bodyError !== undefined ? ids.error : '', ids.hint]
            .filter(Boolean)
            .join(' ')}
          data-testid="s16-body"
        />
        {bodyError !== undefined && (
          <p id={ids.error} className={styles['error']}>
            {bodyError}
          </p>
        )}
        <p id={ids.hint} className={styles['hint']}>
          {t('web.s16.form.hint')}
        </p>
      </div>
      <Button type="submit" block loading={pending} data-testid="s16-send">
        {t('web.s16.form.send')}
      </Button>
    </form>
  );
}
