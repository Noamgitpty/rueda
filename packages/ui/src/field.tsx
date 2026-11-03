import type { InputHTMLAttributes, ReactNode } from 'react';
import type { Translator } from '@rueda/i18n';
import styles from './field.module.css';
import { Icon } from './icon.tsx';
import { cx } from './internal/cx.ts';

/** Identifiants des textes liés à un champ (`aria-describedby`). */
export function fieldIds(id: string): { readonly hint: string; readonly error: string } {
  return { hint: `${id}-hint`, error: `${id}-error` };
}

function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  const ids = fieldIds(id);
  const list = [error ? ids.error : '', hint ? ids.hint : ''].filter(Boolean);
  return list.length > 0 ? list.join(' ') : undefined;
}

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'children' | 'aria-invalid'
> {
  readonly i18n: Translator;
  /** Identifiant unique : relie libellé, aide, erreur et récapitulatif d'erreurs. */
  readonly id: string;
  /** Libellé visible, toujours (jamais un simple texte indicatif dans le champ). */
  readonly label: string;
  readonly hint?: ReactNode;
  /** Message d'erreur (structure de 10b §3.12) ; présent ⇒ `aria-invalid`. */
  readonly error?: ReactNode;
  /** Champ facultatif : « (opcional) » s'ajoute au libellé ; sinon le champ est requis. */
  readonly optional?: boolean | undefined;
}

/** Champ texte (e-mail, téléphone, nom, montant saisi…). */
export function TextField({
  i18n,
  id,
  label,
  hint,
  error,
  optional = false,
  className,
  type = 'text',
  ...rest
}: TextFieldProps) {
  const ids = fieldIds(id);
  return (
    <div className={cx(styles['field'], className)}>
      <label className={styles['label']} htmlFor={id}>
        {label}
        {optional && <span className={styles['optional']}> {i18n.t('common.ui.optional')}</span>}
      </label>
      <input
        {...rest}
        id={id}
        type={type}
        required={!optional}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={styles['input']}
      />
      {error && (
        <p id={ids.error} className={styles['error']}>
          <Icon name="alert" />
          <span>{error}</span>
        </p>
      )}
      {hint && (
        <p id={ids.hint} className={styles['hint']}>
          {hint}
        </p>
      )}
    </div>
  );
}

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'type' | 'children' | 'aria-invalid'
> {
  readonly id: string;
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
}

/** Case à cocher, jamais pré-cochée pour un consentement (10b UX-56). */
export function Checkbox({ id, label, hint, error, className, ...rest }: CheckboxProps) {
  const ids = fieldIds(id);
  return (
    <div className={cx(styles['field'], className)}>
      <label className={styles['check']} htmlFor={id}>
        <input
          {...rest}
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={styles['checkInput']}
        />
        <span>{label}</span>
      </label>
      {error && (
        <p id={ids.error} className={styles['error']}>
          <Icon name="alert" />
          <span>{error}</span>
        </p>
      )}
      {hint && (
        <p id={ids.hint} className={styles['hint']}>
          {hint}
        </p>
      )}
    </div>
  );
}

export interface ErrorSummaryProps {
  readonly i18n: Translator;
  readonly id?: string | undefined;
  /** Une entrée par champ en erreur, dans l'ordre du formulaire. */
  readonly errors: ReadonlyArray<{ readonly fieldId: string; readonly message: string }>;
}

/**
 * Récapitulatif des erreurs en tête de formulaire (10b UX-50) : région assertive (UX-48), un lien
 * par champ. À afficher après une tentative d'envoi ; rien n'est rendu sans erreur.
 */
export function ErrorSummary({ i18n, id = 'error-summary', errors }: ErrorSummaryProps) {
  if (errors.length === 0) return null;
  const titleId = `${id}-title`;
  return (
    <div id={id} className={styles['summary']} role="alert" aria-labelledby={titleId} tabIndex={-1}>
      <h2 id={titleId} className={styles['summaryTitle']}>
        <Icon name="alert" />
        {i18n.t('common.ui.errorSummary.title', { count: errors.length })}
      </h2>
      <ul className={styles['summaryList']}>
        {errors.map((e) => (
          <li key={e.fieldId}>
            <a href={`#${e.fieldId}`}>{e.message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
