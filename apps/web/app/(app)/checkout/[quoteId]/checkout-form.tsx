'use client';
/**
 * Formulaire de S05 (US-208, partie 208b ; ADR-134) : conducteur, case de la boîte manuelle, une
 * case par document avec le lien vers la version exacte affichée, bouton de pose du hold.
 *
 * Bouton « inactif » (19 US-208 critère 3) : tant qu'un nom manque ou qu'une case n'est pas
 * cochée, le bouton porte `aria-disabled="true"` (aspect désactivé, annoncé comme tel) et une aide
 * liée (`aria-describedby`) dit ce qui manque ; il reste focalisable et un clic n'envoie RIEN :
 * il affiche le récapitulatif des erreurs (10b UX-50 : l'action principale déclenche la
 * validation, jamais un bouton muet). Sans JavaScript : envoi natif, l'action serveur refuse de la
 * même façon (`TERMS_NOT_ACCEPTED`…). Pendant l'envoi : `aria-busy` et second clic ignoré (un seul
 * hold par devis). Cases jamais pré-cochées (10b UX-56).
 */
import { startTransition, useActionState, useEffect, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, Checkbox, ErrorSummary, TextField } from '@rueda/ui';
import { DRIVER_NAME_MAX, S05_FIELD } from '../../../../account/checkout.ts';
import type { CheckoutDocumentKind, CheckoutFieldError } from '../../../../account/checkout.ts';
import { LOCALE_CONFIG } from '../../../../locale-config.ts';
import accountStyles from '../../_account/account.module.css';
import styles from '../../host/host.module.css';
import { placeHoldAction, renewQuoteAction } from '../actions.ts';
import type { CheckoutFormState } from '../actions.ts';

const INITIAL: CheckoutFormState = { errors: [] };
const HINT_ID = 's05-hold-hint';
const SUMMARY_ID = 's05-errors';

export interface CheckoutDocumentProp {
  readonly kind: CheckoutDocumentKind;
  readonly version: number;
  readonly title: string;
  readonly href: string;
}

export interface CheckoutFormProps {
  readonly localeTag: string;
  readonly quoteId: string;
  readonly manualRequired: boolean;
  /** Total du devis déjà formaté (libellé du bouton). */
  readonly amount: string;
  readonly documents: readonly CheckoutDocumentProp[];
}

export function CheckoutForm({
  localeTag,
  quoteId,
  manualRequired,
  amount,
  documents,
}: CheckoutFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const t = i18n.t.bind(i18n);
  const [state, action, pending] = useActionState(placeHoldAction, INITIAL);
  const kept = state.values ?? {};
  const [first, setFirst] = useState(kept['firstName'] ?? '');
  const [last, setLast] = useState(kept['lastName'] ?? '');
  const [manual, setManual] = useState(kept['manual'] === 'on');
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(
    () => new Set(documents.filter((d) => kept[`accept.${d.kind}`] === 'on').map((d) => d.kind)),
  );
  const [tried, setTried] = useState(false);
  // tentative d'envoi refusée à l'écran : le récapitulatif, rendu, reçoit le focus (10b UX-50)
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (attempt > 0) document.getElementById(SUMMARY_ID)?.focus();
  }, [attempt]);

  // ce qui manque, dans l'ordre du formulaire (mêmes règles que l'action serveur)
  const missing: CheckoutFieldError[] = [];
  if (first.trim() === '') {
    missing.push({ fieldId: S05_FIELD.firstName, key: 'web.s05.driver.firstRequired' });
  }
  if (last.trim() === '') {
    missing.push({ fieldId: S05_FIELD.lastName, key: 'web.s05.driver.lastRequired' });
  }
  if (manualRequired && !manual) {
    missing.push({ fieldId: S05_FIELD.manual, key: 'common.checkout.manualNotConfirmed' });
  }
  for (const d of documents) {
    if (!accepted.has(d.kind)) {
      missing.push({
        fieldId: S05_FIELD.document(d.kind),
        key: 'common.checkout.termsNotAccepted',
      });
    }
  }
  const ready = missing.length === 0;
  const shown: readonly CheckoutFieldError[] = tried && !ready ? missing : state.errors;
  const messages = shown.map((e) => ({ fieldId: e.fieldId, message: t(e.key) }));
  const fieldError = (id: string) => messages.find((m) => m.fieldId === id)?.message;
  const formError = fieldError(S05_FIELD.form);

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (pending) {
      event.preventDefault();
      return;
    }
    if (!ready) {
      event.preventDefault();
      setTried(true);
      setAttempt((n) => n + 1);
    }
  };

  // envoi par l'écran (JavaScript) : l'action est appelée sans la réinitialisation automatique du
  // formulaire de React, la saisie reste à l'écran après un refus ; sans JavaScript, l'attribut
  // `action` envoie le formulaire et l'état rendu reprend la saisie (`values`)
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !ready) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };

  const toggle = (kind: string, on: boolean) =>
    setAccepted((prev) => {
      const next = new Set(prev);
      if (on) next.add(kind);
      else next.delete(kind);
      return next;
    });

  return (
    <form
      className={accountStyles['stack']}
      action={action}
      onSubmit={onSubmit}
      noValidate
      data-testid="s05-form"
    >
      <input type="hidden" name="quoteId" value={quoteId} />
      <input type="hidden" name="manualRequired" value={manualRequired ? '1' : '0'} />
      {documents.map((d) => (
        <input key={d.kind} type="hidden" name={`version.${d.kind}`} value={d.version} />
      ))}
      <ErrorSummary
        i18n={i18n}
        id={SUMMARY_ID}
        errors={messages.filter((m) => m.fieldId !== S05_FIELD.form)}
      />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}

      <fieldset className={styles['section']}>
        <legend className={accountStyles['h2']}>{t('web.s05.driver.title')}</legend>
        <p className={accountStyles['muted']}>{t('web.s05.driver.hint')}</p>
        <TextField
          i18n={i18n}
          id={S05_FIELD.firstName}
          name="firstName"
          label={t('web.s05.driver.first')}
          autoComplete="given-name"
          maxLength={DRIVER_NAME_MAX}
          value={first}
          onChange={(e) => setFirst(e.currentTarget.value)}
          error={fieldError(S05_FIELD.firstName)}
        />
        <TextField
          i18n={i18n}
          id={S05_FIELD.lastName}
          name="lastName"
          label={t('web.s05.driver.last')}
          autoComplete="family-name"
          maxLength={DRIVER_NAME_MAX}
          value={last}
          onChange={(e) => setLast(e.currentTarget.value)}
          error={fieldError(S05_FIELD.lastName)}
        />
        {manualRequired && (
          <Checkbox
            id={S05_FIELD.manual}
            name="manual"
            label={t('web.s05.manual')}
            hint={t('web.s05.manual.hint')}
            aria-required="true"
            checked={manual}
            onChange={(e) => setManual(e.currentTarget.checked)}
            error={fieldError(S05_FIELD.manual)}
          />
        )}
      </fieldset>

      <fieldset className={styles['section']}>
        <legend className={accountStyles['h2']}>{t('web.s05.terms.title')}</legend>
        {documents.map((d) => (
          <Checkbox
            key={d.kind}
            id={S05_FIELD.document(d.kind)}
            name={`accept.${d.kind}`}
            label={t('web.s05.terms.accept', { title: d.title })}
            aria-required="true"
            checked={accepted.has(d.kind)}
            onChange={(e) => toggle(d.kind, e.currentTarget.checked)}
            error={fieldError(S05_FIELD.document(d.kind))}
            hint={
              <a className={accountStyles['link']} href={d.href} target="_blank" rel="noopener">
                {t('web.s05.terms.read', { title: d.title, version: String(d.version) })}
              </a>
            }
          />
        ))}
      </fieldset>

      <p className={accountStyles['muted']}>{t('web.s05.hold.notice')}</p>
      <Button
        type="submit"
        block
        loading={pending}
        aria-disabled={!ready || undefined}
        aria-describedby={ready ? undefined : HINT_ID}
        onClick={onClick}
        data-testid="s05-submit"
      >
        {t('web.s05.hold.cta', { amount })}
      </Button>
      {!ready && (
        <p id={HINT_ID} className={accountStyles['muted']}>
          {t('web.s05.hold.missing')}
        </p>
      )}
    </form>
  );
}

/** Prix expiré (16 PRC-025) : nouveau devis pour la même annonce et la même période. */
export function RenewForm({ localeTag, quoteId }: { localeTag: string; quoteId: string }) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const [state, action, pending] = useActionState(renewQuoteAction, INITIAL);
  const error = state.errors[0];
  return (
    <form action={action} className={accountStyles['stack']} data-testid="s05-renew">
      <input type="hidden" name="quoteId" value={quoteId} />
      {error !== undefined && (
        <Banner tone="danger" live="assertive">
          {i18n.t(error.key)}
        </Banner>
      )}
      <Button
        type="submit"
        block
        loading={pending}
        onClick={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        {i18n.t('web.s05.expired.cta')}
      </Button>
    </form>
  );
}
