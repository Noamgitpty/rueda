'use client';
/**
 * Formulaire de contestation d'une plaque ou d'un VIN (US-124, BOARD N-61) : action serveur, sans
 * JavaScript requis ; libellés visibles, erreurs liées à leur champ (10b UX-50) ; textes du
 * catalogue `@rueda/i18n` (es, en, fr, pt).
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, ErrorSummary, TextField } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../../locale-config.ts';
import styles from '../host.module.css';
import { openClaimAction } from './actions.ts';
import type { ClaimFormState } from './actions.ts';

const INITIAL: ClaimFormState = { errors: [] };

export function ClaimForm({
  localeTag,
  orgId,
  maxLabel,
}: {
  readonly localeTag: string;
  readonly orgId: string;
  readonly maxLabel: string;
}) {
  const formId = 'a10c-claim';
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const t = i18n.t.bind(i18n);
  const [state, run, pending] = useActionState(openClaimAction, INITIAL);
  const messages = state.errors.map((e) => ({ fieldId: e.fieldId, message: t(e.key, e.values) }));
  const formError = messages.find((m) => m.fieldId === formId)?.message;
  const errorOf = (id: string) => messages.find((m) => m.fieldId === id)?.message;
  return (
    <form
      id={formId}
      className={styles['actions']}
      action={run}
      noValidate
      aria-label={t('web.vehicleDocs.claims.open')}
    >
      <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== formId)} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      <input type="hidden" name="org" value={orgId} />
      <TextField
        i18n={i18n}
        id={`${formId}-plate`}
        name="plate"
        autoCapitalize="characters"
        maxLength={24}
        label={t('web.vehicleDocs.claims.plate')}
        defaultValue={state.values?.['plate']}
        error={errorOf(`${formId}-plate`)}
      />
      <TextField
        i18n={i18n}
        id={`${formId}-vin`}
        name="vin"
        autoCapitalize="characters"
        maxLength={40}
        label={t('web.vehicleDocs.claims.vin')}
        defaultValue={state.values?.['vin']}
        error={errorOf(`${formId}-vin`)}
      />
      <div className={styles['field']}>
        <label className={styles['strong']} htmlFor={`${formId}-file`}>
          {t('web.vehicleDocs.claims.file')}
        </label>
        <input
          id={`${formId}-file`}
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/heic,application/pdf"
          className={styles['file']}
          aria-describedby={`${formId}-file-hint`}
        />
        <p id={`${formId}-file-hint`} className={styles['hint']}>
          {t('web.vehicleDocs.upload.max', { max: maxLabel })}
        </p>
        {errorOf(`${formId}-file`) !== undefined && (
          <p className={styles['error']} role="alert">
            {errorOf(`${formId}-file`)}
          </p>
        )}
      </div>
      <Button type="submit" block loading={pending}>
        {t('web.vehicleDocs.claims.send')}
      </Button>
    </form>
  );
}
