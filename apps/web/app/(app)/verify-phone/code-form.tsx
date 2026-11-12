'use client';
/**
 * Saisie du code (étape OTP de S15, US-104 ; 10b UX-38 : code à 6 chiffres collable, renvoi
 * proposé à 60 s, WCAG 3.3.8 sans test cognitif). Sans JavaScript (action serveur). Le délai de
 * renvoi est celui que l'API rend au chargement de l'écran : avant, « Reenviar en N s » et le
 * changement de numéro ; après, l'envoi d'un nouveau code (même formulaire du numéro, qui permet
 * aussi de corriger une faute de frappe). L'API ne renvoie jamais avant le délai.
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, ButtonLink, ErrorSummary, TextField } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import styles from '../_account/account.module.css';
import { verifyCodeAction } from './actions.ts';
import type { CodeFormState } from './actions.ts';

export interface CodeFormProps {
  readonly localeTag: string;
  /** Numéro masqué (indicatif et deux derniers chiffres), rendu par l'API. */
  readonly phone: string;
  readonly resendAfterS: number;
  readonly attemptsLeft: number | null;
}

const INITIAL: CodeFormState = { errors: [] };

export function CodeForm({ localeTag, phone, resendAfterS, attemptsLeft }: CodeFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const t = i18n.t.bind(i18n);
  const [state, action, pending] = useActionState(verifyCodeAction, INITIAL);
  const messages = state.errors.map((e) => ({ fieldId: e.fieldId, message: t(e.key, e.values) }));
  const errorOf = (id: string) => messages.find((m) => m.fieldId === id)?.message;
  const formError = errorOf('s15-form');
  return (
    <div className={styles['stack']}>
      <form className={styles['stack']} action={action} noValidate>
        <input type="hidden" name="attemptsLeft" value={attemptsLeft ?? ''} />
        <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== 's15-form')} />
        {formError !== undefined ? (
          <Banner tone="danger" live="assertive">
            {formError}
          </Banner>
        ) : (
          <Banner tone="success" live="polite">
            {t('web.s15.codeSent', { phone })}
          </Banner>
        )}
        <TextField
          i18n={i18n}
          id="s15-code"
          name="code"
          label={t('web.s15.code')}
          hint={t('web.s15.codeHint')}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          error={errorOf('s15-code')}
        />
        <Button type="submit" block loading={pending}>
          {t('web.s15.verify')}
        </Button>
      </form>
      {resendAfterS > 0 ? (
        <>
          <p className={styles['muted']}>{t('web.s15.resendIn', { count: resendAfterS })}</p>
          <ButtonLink variant="quiet" href="/verify-phone?change=1">
            {t('web.s15.changePhone')}
          </ButtonLink>
        </>
      ) : (
        <ButtonLink variant="secondary" href="/verify-phone?change=1">
          {t('web.s15.resend')}
        </ButtonLink>
      )}
    </div>
  );
}
