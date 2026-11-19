'use client';
/**
 * Formulaire du compte de versement de l'hôte (US-707 ; 16 PYO-001 ; 10b UX-40, UX-43, UX-50) :
 * type de compte choisi par l'écran (champ caché), banque ou portefeuille (liste de la
 * configuration du pays, ou code saisi quand le pays n'en donne pas), numéro, prénoms et noms du
 * titulaire, numéro fiscal du titulaire (type enregistré de l'hôte). Sans JavaScript requis
 * (action serveur) ; libellés visibles, erreurs liées au champ et reprises dans le récapitulatif ;
 * l'action n'est jamais désactivée. Les champs ne sont pas contrôlés : après un envoi, ni le
 * numéro de compte ni le numéro fiscal ne sont réaffichés.
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import type { MessageKey } from '@rueda/i18n';
import { Banner, Button, ErrorSummary, TextField } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../../locale-config.ts';
import styles from '../../_account/account.module.css';
import { savePayoutAction } from './actions.ts';
import type { PayoutFormState } from './actions.ts';

const INITIAL: PayoutFormState = { errors: [] };

export interface PayoutFormProps {
  readonly localeTag: string;
  readonly orgId: string;
  /** Type de compte choisi (`BANK_ACCOUNT`, `WALLET`), offert par la configuration du pays. */
  readonly kind: string;
  /** Établissements de la configuration du pays ; `null` : code saisi librement. */
  readonly institutions: readonly string[] | null;
  /** Type du numéro fiscal enregistré de l'hôte (cédula, RUC… : données de configuration). */
  readonly taxKind: string;
  /** Un compte existe déjà : l'envoi est un changement (versements retenus 48 h). */
  readonly change: boolean;
}

export function PayoutForm({
  localeTag,
  orgId,
  kind,
  institutions,
  taxKind,
  change,
}: PayoutFormProps) {
  const [state, action, pending] = useActionState(savePayoutAction, INITIAL);
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const t = i18n.t.bind(i18n);
  const messages = state.errors.map((e) => ({ fieldId: e.fieldId, message: t(e.key, e.values) }));
  const errorOf = (id: string) => messages.find((m) => m.fieldId === id)?.message;
  const summary = messages.filter((m) => m.fieldId !== 'a07p-form');
  const formError = errorOf('a07p-form');
  const institutionError = errorOf('a07p-institution');
  return (
    <form
      id="a07p-form"
      className={styles['stack']}
      action={action}
      noValidate
      aria-labelledby="a07p-form-heading"
    >
      <h2 id="a07p-form-heading" className={styles['h2']}>
        {t(change ? 'web.a07.payout.changeHeading' : 'web.a07.payout.formHeading')}
      </h2>
      <p className={styles['muted']}>{t('web.a07.payout.ownNameOnly')}</p>
      {change && <p className={styles['muted']}>{t('web.a07.payout.changeHint')}</p>}
      <ErrorSummary i18n={i18n} errors={summary} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      <input type="hidden" name="org" value={orgId} />
      <input type="hidden" name="kind" value={kind} />
      <p className={styles['text']}>{t(`web.a07.payout.kind.${kind}` as MessageKey)}</p>
      {institutions === null ? (
        <TextField
          i18n={i18n}
          id="a07p-institution"
          name="institution"
          label={t('web.a07.payout.institutionCode')}
          hint={t('web.a07.payout.institutionHint')}
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          error={institutionError}
        />
      ) : (
        <div className={styles['field']}>
          <label className={styles['label']} htmlFor="a07p-institution">
            {t('web.a07.payout.institution')}
          </label>
          <select
            id="a07p-institution"
            name="institution"
            className={styles['select']}
            defaultValue={institutions[0]}
            aria-invalid={institutionError !== undefined ? true : undefined}
            aria-describedby={institutionError !== undefined ? 'a07p-institution-error' : undefined}
          >
            {institutions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          {institutionError !== undefined && (
            <p id="a07p-institution-error" className={styles['muted']} role="alert">
              {institutionError}
            </p>
          )}
        </div>
      )}
      <TextField
        i18n={i18n}
        id="a07p-number"
        name="accountNumber"
        label={t('web.a07.payout.accountNumber')}
        hint={t('web.a07.payout.accountNumberHint')}
        autoComplete="off"
        inputMode="numeric"
        spellCheck={false}
        maxLength={64}
        error={errorOf('a07p-number')}
      />
      <TextField
        i18n={i18n}
        id="a07p-given"
        name="holderGivenNames"
        label={t('web.a07.payout.holderGiven')}
        hint={t('web.a07.payout.holderHint')}
        autoComplete="given-name"
        maxLength={100}
        error={errorOf('a07p-given')}
      />
      <TextField
        i18n={i18n}
        id="a07p-surnames"
        name="holderSurnames"
        label={t('web.a07.payout.holderSurnames')}
        autoComplete="family-name"
        maxLength={100}
        error={errorOf('a07p-surnames')}
      />
      <TextField
        i18n={i18n}
        id="a07p-tax"
        name="holderTaxId"
        label={t('web.a07.payout.holderTaxId', { kind: taxKind })}
        hint={t('web.a07.tax.numberHint')}
        autoComplete="off"
        spellCheck={false}
        maxLength={64}
        error={errorOf('a07p-tax')}
      />
      <p className={styles['muted']}>{t('web.a07.payout.private')}</p>
      <Button type="submit" block loading={pending}>
        {t('web.a07.payout.save')}
      </Button>
    </form>
  );
}
