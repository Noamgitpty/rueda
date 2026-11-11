'use client';
/**
 * Formulaire d'inscription S15 (US-102), maquette US-033 (`app/proto/screens/account.tsx`) : nom
 * et prénom comme sur le permis, e-mail, mot de passe, case CGU + confidentialité OBLIGATOIRE et
 * jamais pré-cochée, opt-in des communications facultatif et jamais pré-coché (16 ACC-001, 10b
 * UX-56). Fonctionne sans JavaScript (action serveur, `useActionState`) ; l'action principale
 * n'est jamais désactivée (UX-50) : la validation est celle de l'API, affichée champ par champ et
 * dans un récapitulatif (WCAG 3.3.1).
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, ButtonLink, Checkbox, ErrorSummary, TextField } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import styles from '../_account/account.module.css';
import { signupAction } from './actions.ts';
import type { SignupState } from './actions.ts';

export interface SignupFormProps {
  readonly localeTag: string;
  readonly country: string | null;
  readonly tosVersion: number;
  readonly privacyVersion: number;
  /** Au moins un document affiché est un BROUILLON (OQ-BR-24). */
  readonly draft: boolean;
  readonly termsHref: string;
  readonly privacyHref: string;
}

const INITIAL: SignupState = {
  errors: [],
  values: { firstName: '', lastName: '', email: '', marketing: false },
};

export function SignupForm(props: SignupFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, props.localeTag));
  const t = i18n.t.bind(i18n);
  const [state, action, pending] = useActionState(signupAction, INITIAL);
  const messages = state.errors.map((e) => ({ fieldId: e.fieldId, message: t(e.key, e.values) }));
  const errorOf = (id: string) => messages.find((m) => m.fieldId === id)?.message;
  const formError = errorOf('s15-form');
  return (
    <form className={styles['stack']} action={action} noValidate>
      <input type="hidden" name="locale" value={props.localeTag} />
      <input type="hidden" name="country" value={props.country ?? ''} />
      <input type="hidden" name="tosVersion" value={props.tosVersion} />
      <input type="hidden" name="privacyVersion" value={props.privacyVersion} />
      <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== 's15-form')} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      <TextField
        i18n={i18n}
        id="s15-first"
        name="firstName"
        label={t('web.s15.firstName')}
        autoComplete="given-name"
        defaultValue={state.values.firstName}
        error={errorOf('s15-first')}
      />
      <TextField
        i18n={i18n}
        id="s15-last"
        name="lastName"
        label={t('web.s15.lastName')}
        autoComplete="family-name"
        defaultValue={state.values.lastName}
      />
      <TextField
        i18n={i18n}
        id="s15-email"
        name="email"
        type="email"
        label={t('web.s15.email')}
        autoComplete="email"
        inputMode="email"
        defaultValue={state.values.email}
        error={errorOf('s15-email')}
      />
      <TextField
        i18n={i18n}
        id="s15-password"
        name="password"
        type="password"
        label={t('web.s15.password')}
        hint={t('web.s15.passwordHint')}
        autoComplete="new-password"
        error={errorOf('s15-password')}
      />
      {props.draft && <Banner tone="warning">{t('web.legal.draft')}</Banner>}
      <ul className={styles['links']}>
        <li>
          <a className={styles['link']} href={props.termsHref} target="_blank" rel="noopener">
            {t('web.s15.readTerms')}
          </a>
        </li>
        <li>
          <a className={styles['link']} href={props.privacyHref} target="_blank" rel="noopener">
            {t('web.s15.readPrivacy')}
          </a>
        </li>
      </ul>
      <Checkbox
        id="s15-terms"
        name="terms"
        label={t('web.s15.terms')}
        aria-required="true"
        error={errorOf('s15-terms')}
      />
      <Checkbox
        id="s15-marketing"
        name="marketing"
        label={t('web.s15.marketing')}
        defaultChecked={state.values.marketing}
      />
      <Button type="submit" block loading={pending}>
        {t('web.s15.signup')}
      </Button>
      <ButtonLink variant="quiet" href="/login">
        {t('web.s15.login')}
      </ButtonLink>
    </form>
  );
}
