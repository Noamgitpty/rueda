'use client';
/**
 * Réacceptation des documents après une version majeure (US-102, 16 ACC-001) : case obligatoire,
 * jamais pré-cochée, versions affichées renvoyées à l'API. Sans JavaScript (action serveur).
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, Checkbox, ErrorSummary } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../../locale-config.ts';
import styles from '../../_account/account.module.css';
import { acceptAction } from '../../login/actions.ts';
import type { AcceptState } from '../../login/actions.ts';

export interface AcceptFormProps {
  readonly localeTag: string;
  readonly versions: Readonly<Record<'TOS_GUEST' | 'PRIVACY', number>>;
}

const INITIAL: AcceptState = { errors: [] };

export function AcceptForm({ localeTag, versions }: AcceptFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const t = i18n.t.bind(i18n);
  const [state, action, pending] = useActionState(acceptAction, INITIAL);
  const messages = state.errors.map((e) => ({ fieldId: e.fieldId, message: t(e.key, e.values) }));
  const formError = messages.find((m) => m.fieldId === 's15-form')?.message;
  return (
    <form className={styles['stack']} action={action} noValidate>
      <input type="hidden" name="TOS_GUEST" value={versions.TOS_GUEST} />
      <input type="hidden" name="PRIVACY" value={versions.PRIVACY} />
      <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== 's15-form')} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      <Checkbox
        id="s15-accept"
        name="accept"
        label={t('web.s15.terms')}
        aria-required="true"
        error={messages.find((m) => m.fieldId === 's15-accept')?.message}
      />
      <Button type="submit" block loading={pending}>
        {t('web.s15.reaccept.cta')}
      </Button>
    </form>
  );
}
