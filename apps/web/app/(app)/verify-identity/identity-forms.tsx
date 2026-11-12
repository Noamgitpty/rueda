'use client';
/**
 * Formulaires de l'écran S04 (US-105 ; 16 VER-001, VER-004 ; 10b S04, UX-56) : consentement
 * biométrique SÉPARÉ, case jamais pré-cochée, version affichée renvoyée ; retrait ; choix du pays
 * qui a délivré le permis (pays de la configuration, jamais une constante) puis départ vers le
 * parcours hébergé du fournisseur. Sans JavaScript (actions serveur) ; l'action n'est jamais
 * désactivée.
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, Checkbox, ErrorSummary } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import styles from '../_account/account.module.css';
import { consentAction, startAction, withdrawAction } from './actions.ts';
import type { IdentityFormState } from './actions.ts';

const INITIAL: IdentityFormState = { errors: [] };

function useMessages(localeTag: string, state: IdentityFormState) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const t = i18n.t.bind(i18n);
  const messages = state.errors.map((e) => ({ fieldId: e.fieldId, message: t(e.key, e.values) }));
  const errorOf = (id: string) => messages.find((m) => m.fieldId === id)?.message;
  return { i18n, t, messages, errorOf };
}

export interface ConsentFormProps {
  readonly localeTag: string;
  readonly version: number;
  readonly country: string | null;
}

export function ConsentForm({ localeTag, version, country }: ConsentFormProps) {
  const [state, action, pending] = useActionState(consentAction, INITIAL);
  const { i18n, t, messages, errorOf } = useMessages(localeTag, state);
  const formError = errorOf('s04-form');
  return (
    <form className={styles['stack']} action={action} noValidate>
      <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== 's04-form')} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      <input type="hidden" name="version" value={String(version)} />
      {country !== null && <input type="hidden" name="country" value={country} />}
      <Checkbox
        id="s04-consent"
        name="consent"
        label={t('web.s04.consent.checkbox')}
        hint={t('web.s04.consent.refusal')}
        aria-required="true"
        error={errorOf('s04-consent')}
      />
      <Button type="submit" block loading={pending}>
        {t('web.s04.consent.submit')}
      </Button>
    </form>
  );
}

export interface CountryOption {
  readonly code: string;
  readonly label: string;
}

export interface StartFormProps {
  readonly localeTag: string;
  readonly countries: readonly CountryOption[];
  readonly defaultCountry: string;
  readonly resume: boolean;
}

export function StartForm({ localeTag, countries, defaultCountry, resume }: StartFormProps) {
  const [state, action, pending] = useActionState(startAction, INITIAL);
  const { i18n, t, messages, errorOf } = useMessages(localeTag, state);
  const formError = errorOf('s04-form');
  const countryError = errorOf('s04-country');
  return (
    <form className={styles['stack']} action={action} noValidate>
      <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== 's04-form')} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      <input type="hidden" name="locale" value={localeTag} />
      <div className={styles['field']}>
        <label className={styles['label']} htmlFor="s04-country">
          {t('web.s04.country')}
        </label>
        <select
          id="s04-country"
          name="country"
          className={styles['select']}
          defaultValue={defaultCountry}
          aria-invalid={countryError !== undefined ? true : undefined}
          aria-describedby={countryError !== undefined ? 's04-country-error' : undefined}
        >
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        {countryError !== undefined && (
          <p id="s04-country-error" className={styles['muted']} role="alert">
            {countryError}
          </p>
        )}
      </div>
      <p className={styles['muted']}>{t('web.s04.hosted')}</p>
      <Button type="submit" block loading={pending}>
        {t(resume ? 'web.s04.resume' : 'web.s04.start')}
      </Button>
    </form>
  );
}

export function WithdrawForm({ localeTag }: { readonly localeTag: string }) {
  const [state, action, pending] = useActionState(withdrawAction, INITIAL);
  const { t, errorOf } = useMessages(localeTag, state);
  const formError = errorOf('s04-form');
  return (
    <form className={styles['stackTight']} action={action}>
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      <Button type="submit" variant="quiet" loading={pending}>
        {t('web.s04.consent.withdraw')}
      </Button>
    </form>
  );
}
