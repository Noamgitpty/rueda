'use client';
/**
 * Demande d'aide du trip (US-310, ADR-182 ; 16 SUP-004 « contact → ticket lié au trip ») : motif
 * fermé (radio, jamais présélectionné), rappel de l'urgence et de la confidentialité, bouton. Après
 * l'envoi : « Recibimos tu solicitud » et, hors plage, la réponse automatique annoncée, sans aucun
 * délai promis (SUP-020). Sans JavaScript : envoi natif. L'identifiant de la demande est posé par le
 * serveur à l'affichage (rejeu sans double demande).
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, ErrorSummary } from '@rueda/ui';
import { HELP_TOPICS } from '../../../../../account/help.ts';
import { LOCALE_CONFIG } from '../../../../../locale-config.ts';
import accountStyles from '../../../_account/account.module.css';
import styles from '../../../host/host.module.css';
import { requestHelpAction } from './actions.ts';
import type { HelpRequestState } from './actions.ts';
import { HELP_FORM_ID, HELP_TOPIC_ID } from './ids.ts';

const INITIAL: HelpRequestState = { errors: [] };

export interface HelpRequestFormProps {
  readonly localeTag: string;
  readonly tripId: string;
  readonly requestId: string;
  readonly brand: string;
}

export function HelpRequestForm({ localeTag, tripId, requestId, brand }: HelpRequestFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const t = i18n.t.bind(i18n);
  const [state, run, pending] = useActionState(requestHelpAction, INITIAL);
  const messages = state.errors.map((e) => ({ fieldId: e.fieldId, message: t(e.key, e.values) }));
  const formError = messages.find((m) => m.fieldId === HELP_FORM_ID)?.message;
  const topicError = messages.find((m) => m.fieldId === HELP_TOPIC_ID)?.message;
  if (state.sent !== undefined) {
    return (
      <div className={accountStyles['stackTight']} data-testid="s17-request-sent">
        <Banner tone="success" live="polite">
          {t('web.help.request.sent')}
        </Banner>
        <p className={accountStyles['text']}>
          {state.sent.outcome === 'EXISTS'
            ? t('web.help.request.exists')
            : state.sent.offHours
              ? t('web.help.request.offHours')
              : t('web.help.request.inHours')}
        </p>
      </div>
    );
  }
  return (
    <form
      id={HELP_FORM_ID}
      className={styles['actions']}
      action={run}
      noValidate
      aria-labelledby="s17-request-title"
    >
      <h2 id="s17-request-title" className={accountStyles['h2']}>
        {t('web.help.request.title', { brand })}
      </h2>
      <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== HELP_FORM_ID)} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      <input type="hidden" name="trip" value={tripId} />
      <input type="hidden" name="request" value={requestId} />
      <fieldset
        id={HELP_TOPIC_ID}
        className={styles['choices']}
        aria-describedby={topicError === undefined ? undefined : `${HELP_TOPIC_ID}-error`}
      >
        <legend className={styles['legend']}>{t('web.help.request.topic')}</legend>
        {topicError !== undefined && (
          <p id={`${HELP_TOPIC_ID}-error`} className={styles['error']}>
            {topicError}
          </p>
        )}
        {HELP_TOPICS.map((topic) => (
          <label key={topic} className={styles['choice']}>
            <input type="radio" name="topic" value={topic} data-testid={`s17-topic-${topic}`} />
            <span>{t(`web.help.topic.${topic}`)}</span>
          </label>
        ))}
      </fieldset>
      <p className={accountStyles['muted']}>{t('web.help.request.safetyHint')}</p>
      <p className={accountStyles['muted']}>{t('web.help.request.privacy')}</p>
      <Button type="submit" block loading={pending} data-testid="s17-request-submit">
        {t('web.help.request.submit')}
      </Button>
    </form>
  );
}
