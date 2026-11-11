'use client';
/**
 * Connexion (S15, US-102) : e-mail et mot de passe, sans JavaScript (action serveur). Après la
 * connexion, une version majeure des documents fait passer par la réacceptation.
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, ButtonLink, ErrorSummary, TextField } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import styles from '../_account/account.module.css';
import { loginAction } from './actions.ts';
import type { LoginState } from './actions.ts';

const INITIAL: LoginState = { errors: [], email: '' };

export function LoginForm({ localeTag }: { readonly localeTag: string }) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const t = i18n.t.bind(i18n);
  const [state, action, pending] = useActionState(loginAction, INITIAL);
  const messages = state.errors.map((e) => ({ fieldId: e.fieldId, message: t(e.key, e.values) }));
  const formError = messages.find((m) => m.fieldId === 's15-form')?.message;
  const emailError = messages.find((m) => m.fieldId === 's15-login-email')?.message;
  return (
    <form className={styles['stack']} action={action} noValidate>
      <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== 's15-form')} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      <TextField
        i18n={i18n}
        id="s15-login-email"
        name="email"
        type="email"
        label={t('web.s15.email')}
        autoComplete="email"
        inputMode="email"
        defaultValue={state.email}
        error={emailError}
      />
      <TextField
        i18n={i18n}
        id="s15-login-password"
        name="password"
        type="password"
        label={t('web.s15.password')}
        autoComplete="current-password"
      />
      <Button type="submit" block loading={pending}>
        {t('web.s15.loginSubmit')}
      </Button>
      <ButtonLink variant="quiet" href="/signup">
        {t('web.s15.createAccount')}
      </ButtonLink>
    </form>
  );
}
