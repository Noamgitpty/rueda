'use client';
/**
 * Choix de la protection sur S05 (US-226 partie 226b, ADR-137 ; 16 PRT-001 / PRT-002 / BKG-003,
 * PRT-011 ; 10b S05 `web.s05.protection.title`) : âge déclaré du conducteur, niveaux vendus par
 * rang croissant avec leur prix par jour et pour la période (calculés par l'API), niveau du devis
 * présélectionné (`BASICA` au premier devis), aucune option « sans protection ».
 *
 * - Niveau refusé à l'âge déclaré : grisé (`disabled`) avec sa raison « dès {age} ans » ; avec
 *   JavaScript, l'âge saisi le rend choisissable tout de suite (affichage seulement : la base juge
 *   l'éligibilité au gel, `PROTECTION_LEVEL_NOT_ELIGIBLE`).
 * - Un SEUL gel par choix validé (« Actualizar el precio ») : changer de niveau ou d'âge ne fige
 *   rien tant que le voyageur ne valide pas ; même choix que le devis ⇒ bouton inactif
 *   (`aria-disabled`, aide liée), aucun envoi. Chaque gel compte dans
 *   `quote_freezes_per_guest_hour` (ADR-136).
 * - Sans JavaScript : envoi natif, l'action serveur fait les mêmes contrôles.
 */
import { startTransition, useActionState, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, ErrorSummary, TextField } from '@rueda/ui';
import {
  DRIVER_AGE_MAX,
  DRIVER_AGE_MIN,
  S05_PROTECTION_FIELD,
} from '../../../../account/checkout.ts';
import { LOCALE_CONFIG } from '../../../../locale-config.ts';
import accountStyles from '../../_account/account.module.css';
import styles from '../../host/host.module.css';
import { changeProtectionAction } from '../actions.ts';
import type { CheckoutFormState } from '../actions.ts';

const INITIAL: CheckoutFormState = { errors: [] };
const HINT_ID = 's05-protection-hint';

export interface ProtectionOptionProp {
  readonly level: string;
  /** Nom du niveau, déjà traduit. */
  readonly label: string;
  /** Prix par jour et pour la période, déjà formatés (montants de l'API). */
  readonly price: string;
  readonly minDriverAge: number | null;
  readonly selected: boolean;
  /** Éligibilité à l'âge déclaré du devis (rendu serveur). */
  readonly eligible: boolean;
}

export interface ProtectionFormProps {
  readonly localeTag: string;
  readonly quoteId: string;
  readonly driverAge: number | null;
  readonly options: readonly ProtectionOptionProp[];
}

/** Âge saisi lisible (années entières dans les bornes), sinon `undefined`. */
function ageOf(text: string): number | undefined {
  const v = text.trim();
  if (!/^[0-9]{1,3}$/.test(v)) return undefined;
  const n = Number(v);
  return n >= DRIVER_AGE_MIN && n <= DRIVER_AGE_MAX ? n : undefined;
}

export function ProtectionForm({ localeTag, quoteId, driverAge, options }: ProtectionFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const t = i18n.t.bind(i18n);
  const [state, action, pending] = useActionState(changeProtectionAction, INITIAL);
  const kept = state.values ?? {};
  const current = options.find((o) => o.selected)?.level ?? options[0]?.level ?? '';
  const [ageText, setAgeText] = useState(
    kept['driverAge'] ?? (driverAge === null ? '' : String(driverAge)),
  );
  const [level, setLevel] = useState(kept['protectionLevel'] ?? current);
  const typed = ageOf(ageText);
  // âge saisi ≠ âge du devis : l'éligibilité suit la saisie ; sinon celle calculée par l'API
  const ageEdited = ageText.trim() !== (driverAge === null ? '' : String(driverAge));
  const allowed = (o: ProtectionOptionProp): boolean =>
    ageEdited
      ? o.minDriverAge === null || (typed !== undefined && typed >= o.minDriverAge)
      : o.eligible;
  const chosen =
    options.find((o) => o.level === level && allowed(o))?.level ??
    options.find((o) => o.selected && allowed(o))?.level ??
    options.find(allowed)?.level ??
    current;
  const changed = chosen !== current || ageEdited;

  const messages = state.errors.map((e) => ({
    fieldId: e.fieldId,
    message:
      e.key === 'web.s05.age.invalid'
        ? t(e.key, { min: DRIVER_AGE_MIN, max: DRIVER_AGE_MAX })
        : t(e.key),
  }));
  const fieldError = (id: string) => messages.find((m) => m.fieldId === id)?.message;
  const formError = fieldError(S05_PROTECTION_FIELD.form);
  const levelsError = fieldError(S05_PROTECTION_FIELD.levels);

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (pending || !changed) event.preventDefault();
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !changed) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };

  return (
    <form
      className={styles['section']}
      action={action}
      onSubmit={onSubmit}
      noValidate
      aria-labelledby="s05-protection-title"
      data-testid={S05_PROTECTION_FIELD.form}
    >
      <h2 id="s05-protection-title" className={accountStyles['h2']}>
        {t('web.s05.protection.title')}
      </h2>
      <p className={accountStyles['muted']}>{t('web.s05.protection.intro')}</p>
      <input type="hidden" name="quoteId" value={quoteId} />
      <ErrorSummary
        i18n={i18n}
        errors={messages.filter((m) => m.fieldId !== S05_PROTECTION_FIELD.form)}
      />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      <TextField
        i18n={i18n}
        id={S05_PROTECTION_FIELD.age}
        name="driverAge"
        label={t('web.s05.age.label')}
        hint={t('web.s05.age.hint')}
        inputMode="numeric"
        autoComplete="off"
        maxLength={3}
        optional
        value={ageText}
        onChange={(e) => setAgeText(e.currentTarget.value)}
        error={fieldError(S05_PROTECTION_FIELD.age)}
      />
      <fieldset
        id={S05_PROTECTION_FIELD.levels}
        className={styles['choices']}
        aria-describedby={
          levelsError === undefined ? undefined : `${S05_PROTECTION_FIELD.levels}-error`
        }
      >
        <legend className={styles['legend']}>{t('web.s05.protection.legend')}</legend>
        {levelsError !== undefined && (
          <p id={`${S05_PROTECTION_FIELD.levels}-error`} className={styles['error']}>
            {levelsError}
          </p>
        )}
        {options.map((o) => {
          const enabled = allowed(o);
          const id = S05_PROTECTION_FIELD.level(o.level);
          const reasonId = `${id}-reason`;
          return (
            <label key={o.level} className={styles['choice']} htmlFor={id}>
              <input
                id={id}
                type="radio"
                name="protectionLevel"
                value={o.level}
                checked={chosen === o.level}
                disabled={!enabled}
                aria-describedby={enabled ? undefined : reasonId}
                onChange={() => setLevel(o.level)}
              />
              <span className={accountStyles['stackTight']}>
                <span className={styles['strong']}>{o.label}</span>
                <span className={accountStyles['text']}>{o.price}</span>
                {!enabled && o.minDriverAge !== null && (
                  <span id={reasonId} className={styles['hint']}>
                    {t('web.s05.protection.minAge', { age: o.minDriverAge })}
                    {typed === undefined ? ` ${t('web.s05.protection.ageNeeded')}` : ''}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>
      <Button
        type="submit"
        variant="secondary"
        block
        loading={pending}
        aria-disabled={!changed || undefined}
        aria-describedby={changed ? undefined : HINT_ID}
        onClick={onClick}
        data-testid="s05-protection-apply"
      >
        {t('web.s05.protection.apply')}
      </Button>
      {!changed && (
        <p id={HINT_ID} className={accountStyles['muted']}>
          {t('web.s05.protection.unchanged')}
        </p>
      )}
    </form>
  );
}
