'use client';
/**
 * Signature du contrat par le voyageur (S09, US-211 partie 211b ; 16 BKG-019 « acceptation
 * explicite, case + bouton ») : case jamais pré-cochée (10b UX-56), effet rappelé (heure du serveur,
 * empreinte du document affiché), bouton. Le document et son empreinte sont des champs cachés que
 * la base revérifie. Sans JavaScript : envoi natif.
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, Checkbox, ErrorSummary } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../../../locale-config.ts';
import accountStyles from '../../../_account/account.module.css';
import styles from '../../../host/host.module.css';
import { signContractAction } from './actions.ts';
import { SIGN_ACCEPT_ID, SIGN_FORM_ID } from './ids.ts';
import type { SignFormState } from './actions.ts';

const INITIAL: SignFormState = { errors: [] };

export interface SignFormProps {
  readonly localeTag: string;
  readonly tripId: string;
  readonly documentId: string;
  readonly sha256: string;
}

export function SignForm({ localeTag, tripId, documentId, sha256 }: SignFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const t = i18n.t.bind(i18n);
  const [state, run, pending] = useActionState(signContractAction, INITIAL);
  const messages = state.errors.map((e) => ({ fieldId: e.fieldId, message: t(e.key, e.values) }));
  const formError = messages.find((m) => m.fieldId === SIGN_FORM_ID)?.message;
  const acceptError = messages.find((m) => m.fieldId === SIGN_ACCEPT_ID)?.message;
  return (
    <form
      id={SIGN_FORM_ID}
      className={styles['actions']}
      action={run}
      noValidate
      aria-labelledby="s09-contract-sign-title"
    >
      <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== SIGN_FORM_ID)} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      <input type="hidden" name="trip" value={tripId} />
      <input type="hidden" name="document" value={documentId} />
      <input type="hidden" name="sha256" value={sha256} />
      <Checkbox
        id={SIGN_ACCEPT_ID}
        name="accepted"
        label={t('web.s09.contract.sign.accept')}
        hint={t('web.s09.contract.sign.hint')}
        error={acceptError}
      />
      <p className={accountStyles['muted']}>{t('web.s09.contract.toSign')}</p>
      <Button type="submit" block loading={pending} data-testid="s09-contract-sign">
        {t('web.s09.contract.sign.cta')}
      </Button>
    </form>
  );
}
