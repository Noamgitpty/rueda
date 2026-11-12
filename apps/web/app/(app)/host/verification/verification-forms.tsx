'use client';
/**
 * Formulaires de l'écran A07 (US-123 ; 10b A07, UX-40, UX-50) : profil fiscal (type de numéro
 * admis par le pays, tiré de la configuration via l'API ; numéro ; régime facultatif) et envoi du
 * dossier. Sans JavaScript requis (actions serveur) ; libellés visibles, erreurs liées au champ et
 * reprises dans le récapitulatif ; l'action n'est jamais désactivée.
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, ErrorSummary, TextField } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../../locale-config.ts';
import styles from '../../_account/account.module.css';
import { saveTaxAction, submitAction } from './actions.ts';
import type { VerificationFormState } from './actions.ts';

const INITIAL: VerificationFormState = { errors: [] };

function useMessages(localeTag: string, state: VerificationFormState, formId: string) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const t = i18n.t.bind(i18n);
  const messages = state.errors.map((e) => ({ fieldId: e.fieldId, message: t(e.key, e.values) }));
  const errorOf = (id: string) => messages.find((m) => m.fieldId === id)?.message;
  return {
    i18n,
    t,
    errorOf,
    summary: messages.filter((m) => m.fieldId !== formId),
    formError: errorOf(formId),
  };
}

export interface TaxFormProps {
  readonly localeTag: string;
  readonly orgId: string;
  /** Types de numéro admis dans le pays du compte d'hôte (données de configuration). */
  readonly kinds: readonly string[];
}

export function TaxForm({ localeTag, orgId, kinds }: TaxFormProps) {
  const [state, action, pending] = useActionState(saveTaxAction, INITIAL);
  const { i18n, t, errorOf, summary, formError } = useMessages(localeTag, state, 'a07-tax-form');
  const kindError = errorOf('a07-tax-kind');
  return (
    <form
      id="a07-tax-form"
      className={styles['stack']}
      action={action}
      noValidate
      aria-labelledby="a07-tax-heading"
    >
      <h3 id="a07-tax-heading" className={styles['h2']}>
        {t('web.a07.tax.heading')}
      </h3>
      <p className={styles['muted']}>{t('web.a07.tax.individualOnly')}</p>
      <ErrorSummary i18n={i18n} errors={summary} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      <input type="hidden" name="org" value={orgId} />
      <div className={styles['field']}>
        <label className={styles['label']} htmlFor="a07-tax-kind">
          {t('web.a07.tax.kind')}
        </label>
        <select
          id="a07-tax-kind"
          name="kind"
          className={styles['select']}
          defaultValue={kinds[0]}
          aria-invalid={kindError !== undefined ? true : undefined}
          aria-describedby={kindError !== undefined ? 'a07-tax-kind-error' : undefined}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        {kindError !== undefined && (
          <p id="a07-tax-kind-error" className={styles['muted']} role="alert">
            {kindError}
          </p>
        )}
      </div>
      <TextField
        i18n={i18n}
        id="a07-tax-number"
        name="taxId"
        label={t('web.a07.tax.number')}
        hint={t('web.a07.tax.numberHint')}
        autoComplete="off"
        inputMode="text"
        spellCheck={false}
        maxLength={64}
        error={errorOf('a07-tax-number')}
      />
      <TextField
        i18n={i18n}
        id="a07-tax-regime"
        name="regime"
        label={t('web.a07.tax.regime')}
        hint={t('web.a07.tax.regimeHint')}
        optional
        autoComplete="off"
        maxLength={32}
        error={errorOf('a07-tax-regime')}
      />
      <p className={styles['muted']}>{t('web.a07.tax.private')}</p>
      <Button type="submit" block loading={pending}>
        {t('web.a07.tax.save')}
      </Button>
    </form>
  );
}

export function SubmitForm({ localeTag, orgId }: { readonly localeTag: string; readonly orgId: string }) {
  const [state, action, pending] = useActionState(submitAction, INITIAL);
  const { t, formError } = useMessages(localeTag, state, 'a07-submit-form');
  return (
    <form id="a07-submit-form" className={styles['stackTight']} action={action} noValidate>
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      <input type="hidden" name="org" value={orgId} />
      <p className={styles['muted']}>{t('web.a07.submitHint')}</p>
      <Button type="submit" block loading={pending}>
        {t('web.a07.submit')}
      </Button>
    </form>
  );
}
