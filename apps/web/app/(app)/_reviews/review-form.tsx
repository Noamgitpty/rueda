'use client';
/**
 * Formulaire de l'avis d'un trip (S13 voyageur, A12 hôte ; US-317, ADR-190 ; 10b S13 / A12) : note
 * globale (5 choix, étoiles de 48 px), sous-notes facultatives du rôle (BR-REVIEW-03), texte
 * (obligatoire de 1 à 3, 25 caractères au moins ; BR-REVIEW-04) avec l'aide « prénom seulement, ni
 * téléphone ni e-mail ». Erreur : bannière du formulaire ou erreur liée au champ ; la saisie est
 * gardée. Sans JavaScript : envoi natif.
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, ErrorSummary, fieldIds, Icon } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import {
  GUEST_SCORE_KEYS,
  HOST_SCORE_KEYS,
  REVIEW_TEXT_MAX_CHARS,
} from '../../../account/trip-reviews.ts';
import { submitReviewAction } from './review-actions.ts';
import type { ReviewFormState } from './review-actions.ts';
import { REVIEW_FORM_ID, REVIEW_OVERALL_ID, REVIEW_TEXT_ID } from './ids.ts';
import styles from './reviews.module.css';

const INITIAL: ReviewFormState = { errors: [], overall: '', text: '', scores: {} };
const SCORE_LABELS = {
  cleanliness: 'web.review.sub.cleanliness',
  communication: 'web.review.sub.communication',
  convenience: 'web.review.sub.convenience',
  accuracy: 'web.review.sub.accuracy',
  maintenance: 'web.review.sub.maintenance',
  punctuality: 'web.review.sub.punctuality',
  returnCondition: 'web.review.sub.returnCondition',
  rulesRespect: 'web.review.sub.rulesRespect',
} as const;
const STARS = [1, 2, 3, 4, 5] as const;

export interface ReviewFormProps {
  readonly localeTag: string;
  readonly scope: 'guest' | 'host';
  readonly tripId: string;
  /** Compte d'hôte de la requête (`?org=`), gardé au retour ; `null` côté voyageur. */
  readonly org: string | null;
}

export function ReviewForm({ localeTag, scope, tripId, org }: ReviewFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const t = i18n.t.bind(i18n);
  const [state, run, pending] = useActionState(submitReviewAction, INITIAL);
  const messages = state.errors.map((e) => ({ fieldId: e.fieldId, message: t(e.key, e.values) }));
  const formError = messages.find((m) => m.fieldId === REVIEW_FORM_ID)?.message;
  const overallError = messages.find((m) => m.fieldId === REVIEW_OVERALL_ID)?.message;
  const textError = messages.find((m) => m.fieldId === REVIEW_TEXT_ID)?.message;
  const overallIds = fieldIds(REVIEW_OVERALL_ID);
  const textIds = fieldIds(REVIEW_TEXT_ID);
  const keys = scope === 'guest' ? GUEST_SCORE_KEYS : HOST_SCORE_KEYS;
  return (
    <form
      id={REVIEW_FORM_ID}
      className={styles['form']}
      action={run}
      noValidate
      data-testid="review-form"
    >
      <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== REVIEW_FORM_ID)} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      <input type="hidden" name="trip" value={tripId} />
      <input type="hidden" name="scope" value={scope} />
      {org !== null && <input type="hidden" name="org" value={org} />}
      <fieldset
        id={REVIEW_OVERALL_ID}
        className={styles['fieldset']}
        aria-invalid={overallError !== undefined ? true : undefined}
        aria-describedby={overallError !== undefined ? overallIds.error : undefined}
      >
        <legend className={styles['label']}>{t('web.review.overall')}</legend>
        <div className={styles['stars']}>
          {STARS.map((n) => (
            <label key={n} className={styles['star']}>
              <input
                type="radio"
                name="overall"
                value={String(n)}
                defaultChecked={state.overall === String(n)}
                aria-label={t('web.review.stars', { count: n })}
                data-testid={`review-overall-${n}`}
              />
              <span aria-hidden="true">{n}</span>
              <Icon name="star" />
            </label>
          ))}
        </div>
        {overallError !== undefined && (
          <p id={overallIds.error} className={styles['error']}>
            {overallError}
          </p>
        )}
      </fieldset>
      <fieldset className={styles['fieldset']}>
        <legend className={styles['label']}>{t('web.review.subScores')}</legend>
        <div className={styles['scores']}>
          {keys.map((k) => (
            <div key={k} className={styles['score']}>
              <label className={styles['hint']} htmlFor={`review-score-${k}`}>
                {t(SCORE_LABELS[k])}
              </label>
              <select
                id={`review-score-${k}`}
                name={`score-${k}`}
                className={styles['select']}
                defaultValue={state.scores[k] ?? ''}
              >
                <option value="">{t('web.review.noScore')}</option>
                {STARS.map((n) => (
                  <option key={n} value={String(n)}>
                    {t('web.review.stars', { count: n })}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </fieldset>
      <div className={styles['field']}>
        <label className={styles['label']} htmlFor={REVIEW_TEXT_ID}>
          {t('web.review.text')}
        </label>
        <textarea
          id={REVIEW_TEXT_ID}
          name="text"
          className={styles['textarea']}
          maxLength={REVIEW_TEXT_MAX_CHARS}
          defaultValue={state.text}
          aria-invalid={textError !== undefined ? true : undefined}
          aria-describedby={[textError !== undefined ? textIds.error : '', textIds.hint]
            .filter(Boolean)
            .join(' ')}
          data-testid="review-text"
        />
        {textError !== undefined && (
          <p id={textIds.error} className={styles['error']}>
            {textError}
          </p>
        )}
        <p id={textIds.hint} className={styles['hint']}>
          {t('web.review.textHint')}
        </p>
      </div>
      <p className={styles['hint']}>{t('web.review.final')}</p>
      <Button type="submit" block loading={pending} data-testid="review-submit">
        {t('web.review.submit')}
      </Button>
    </form>
  );
}
