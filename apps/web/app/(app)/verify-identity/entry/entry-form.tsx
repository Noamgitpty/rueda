'use client';
/**
 * Formulaire de la déclaration d'entrée (US-209 partie 209c, ADR-144 ; 16 VER-007, UXQ-03) :
 * pays où l'on va conduire (pays de la configuration, jamais une constante), statut (touriste ou
 * résident, aucun choix pré-coché) et date d'entrée (obligatoire pour un touriste). Sans
 * JavaScript : envoi natif, même action serveur. Confirmation : région vive polie, date mise en
 * forme dans la langue de la vue ; refus : récapitulatif des erreurs, focus sur le récapitulatif.
 */
import { useActionState, useEffect, useRef } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, ErrorSummary, TextField } from '@rueda/ui';
import {
  ENTRY_FIELD,
  entryDayLabel,
  RESIDENCY_STATUSES,
} from '../../../../account/entry-declaration.ts';
import { LOCALE_CONFIG } from '../../../../locale-config.ts';
import styles from '../../_account/account.module.css';
import hostStyles from '../../host/host.module.css';
import { declareEntryAction } from '../actions.ts';
import type { EntryFormState } from '../actions.ts';

const INITIAL: EntryFormState = { errors: [], saved: null };
const SUMMARY_ID = 's04-entry-errors';

export interface EntryCountryOption {
  readonly code: string;
  readonly label: string;
}

export interface EntryFormProps {
  readonly localeTag: string;
  readonly countries: readonly EntryCountryOption[];
  readonly defaultCountry: string;
}

export function EntryForm({ localeTag, countries, defaultCountry }: EntryFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const t = i18n.t.bind(i18n);
  const [state, action, pending] = useActionState(declareEntryAction, INITIAL);
  const messages = state.errors.map((e) => ({ fieldId: e.fieldId, message: t(e.key) }));
  const errorOf = (id: string) => messages.find((m) => m.fieldId === id)?.message;
  const formError = errorOf(ENTRY_FIELD.form);
  const statusError = errorOf(ENTRY_FIELD.status);
  const countryError = errorOf(ENTRY_FIELD.country);
  const values = state.values ?? {};
  // refus rendu : le récapitulatif reçoit le focus (10b UX-50)
  const summary = useRef(state);
  useEffect(() => {
    if (summary.current === state) return;
    summary.current = state;
    if (state.errors.some((e) => e.fieldId !== ENTRY_FIELD.form)) {
      document.getElementById(SUMMARY_ID)?.focus();
    }
  }, [state]);

  return (
    <form
      id={ENTRY_FIELD.form}
      className={styles['stack']}
      action={action}
      noValidate
      data-testid="s04-entry-form"
    >
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="s04-entry-live">
        {state.saved !== null && (
          <Banner tone="success" live="off">
            {`${t('common.kyc.entryDeclared')} ${
              state.saved.residency === 'TOURIST' && state.saved.date !== ''
                ? t('web.s04.entry.savedTourist', { date: entryDayLabel(i18n, state.saved.date) })
                : t('web.s04.entry.savedResident')
            }`}
          </Banner>
        )}
      </div>
      <ErrorSummary
        i18n={i18n}
        id={SUMMARY_ID}
        errors={messages.filter((m) => m.fieldId !== ENTRY_FIELD.form)}
      />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      <div className={styles['field']}>
        <label className={styles['label']} htmlFor={ENTRY_FIELD.country}>
          {t('web.s04.entry.country')}
        </label>
        <select
          id={ENTRY_FIELD.country}
          name="country"
          className={styles['select']}
          defaultValue={values['country'] || defaultCountry}
          aria-invalid={countryError !== undefined ? true : undefined}
          aria-describedby={countryError !== undefined ? `${ENTRY_FIELD.country}-error` : undefined}
        >
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        {countryError !== undefined && (
          <p id={`${ENTRY_FIELD.country}-error`} className={styles['muted']} role="alert">
            {countryError}
          </p>
        )}
      </div>
      <fieldset
        id={ENTRY_FIELD.status}
        tabIndex={-1}
        className={hostStyles['choices']}
        aria-describedby={statusError !== undefined ? `${ENTRY_FIELD.status}-error` : undefined}
      >
        <legend className={hostStyles['legend']}>{t('web.s04.entry.status')}</legend>
        {RESIDENCY_STATUSES.map((r) => (
          <label key={r} className={hostStyles['choice']}>
            <input
              type="radio"
              name="residencyStatus"
              value={r}
              defaultChecked={values['residencyStatus'] === r}
              data-testid={`s04-entry-${r}`}
            />
            <span>{t(`web.s04.entry.${r}`)}</span>
          </label>
        ))}
        {statusError !== undefined && (
          <p id={`${ENTRY_FIELD.status}-error`} className={styles['muted']} role="alert">
            {statusError}
          </p>
        )}
      </fieldset>
      <TextField
        i18n={i18n}
        id={ENTRY_FIELD.date}
        name="entryDate"
        type="date"
        label={t('web.s04.entry.date')}
        hint={t('web.s04.entry.dateHint')}
        defaultValue={values['entryDate'] ?? ''}
        error={errorOf(ENTRY_FIELD.date)}
      />
      <Button type="submit" block loading={pending} data-testid="s04-entry-submit">
        {t('web.s04.entry.submit')}
      </Button>
    </form>
  );
}
