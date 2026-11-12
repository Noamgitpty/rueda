'use client';
/**
 * Saisie du numéro (étape OTP de S15, US-104 ; 10b W3 : indicatif pré-rempli selon le pays et
 * modifiable, format local accepté). Pays et exemples viennent de l'API (configuration pays),
 * jamais d'une constante. Sans JavaScript (action serveur) ; l'action n'est jamais désactivée.
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, ErrorSummary, TextField } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import styles from '../_account/account.module.css';
import { requestCodeAction } from './actions.ts';
import type { PhoneFormState } from './actions.ts';

export interface PhoneCountryOption {
  readonly code: string;
  readonly label: string;
  readonly example: string;
}

export interface PhoneFormProps {
  readonly localeTag: string;
  readonly countries: readonly PhoneCountryOption[];
  readonly defaultCountry: string;
}

export function PhoneForm({ localeTag, countries, defaultCountry }: PhoneFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const t = i18n.t.bind(i18n);
  const initial: PhoneFormState = { errors: [], phone: '', country: defaultCountry };
  const [state, action, pending] = useActionState(requestCodeAction, initial);
  const messages = state.errors.map((e) => ({ fieldId: e.fieldId, message: t(e.key, e.values) }));
  const errorOf = (id: string) => messages.find((m) => m.fieldId === id)?.message;
  const formError = errorOf('s15-form');
  const selected = countries.find((c) => c.code === state.country) ?? countries[0];
  return (
    <form className={styles['stack']} action={action} noValidate>
      <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== 's15-form')} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      <div className={styles['field']}>
        <label className={styles['label']} htmlFor="s15-country">
          {t('web.s15.phoneCountry')}
        </label>
        <select
          id="s15-country"
          name="country"
          className={styles['select']}
          defaultValue={selected?.code}
          autoComplete="tel-country-code"
        >
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <TextField
        i18n={i18n}
        id="s15-phone"
        name="phone"
        type="tel"
        label={t('web.s15.phone')}
        hint={selected !== undefined ? t('web.s15.phoneHint', { example: selected.example }) : null}
        autoComplete="tel-national"
        inputMode="tel"
        defaultValue={state.phone}
        error={errorOf('s15-phone')}
      />
      <Button type="submit" block loading={pending}>
        {t('web.s15.sendCode')}
      </Button>
    </form>
  );
}
