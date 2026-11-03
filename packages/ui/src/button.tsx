import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './button.module.css';
import { cx } from './internal/cx.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet';
export type ButtonSize = 'md' | 'sm';

interface ButtonLook {
  /** `primary` : l'action principale de l'écran, une seule (10b UX-68). */
  readonly variant?: ButtonVariant | undefined;
  /** `sm` garde la cible tactile de 48 px ; seuls la marge intérieure et le texte diminuent. */
  readonly size?: ButtonSize | undefined;
  /** Pleine largeur (barre d'action mobile). */
  readonly block?: boolean | undefined;
}

function lookClass({ variant = 'primary', size = 'md', block = false }: ButtonLook): string {
  return cx(
    styles['button'],
    styles[variant],
    size === 'sm' && styles['small'],
    block && styles['block'],
  );
}

export interface ButtonProps extends ButtonLook, ButtonHTMLAttributes<HTMLButtonElement> {
  /** Verbe + objet (10b UX-52) : « Reservar », « Aceptar y pagar US$ 145.00 ». */
  readonly children: ReactNode;
  /**
   * Action en cours : `aria-busy`, indicateur animé (arrêté avec `prefers-reduced-motion`) ; le
   * libellé reste lu. Le bouton n'est pas désactivé : un second clic est à ignorer par l'appelant.
   */
  readonly loading?: boolean;
}

/**
 * Bouton. Par défaut `type="button"` (jamais d'envoi de formulaire par surprise). L'état
 * désactivé existe pour la vitrine et les actions secondaires ; l'action principale d'un
 * formulaire n'est **jamais** désactivée : elle déclenche la validation (10b UX-50).
 */
export function Button({
  variant,
  size,
  block,
  loading = false,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-busy={loading || undefined}
      className={cx(lookClass({ variant, size, block }), className)}
    >
      {loading && <span className={styles['spinner']} aria-hidden="true" />}
      {children}
    </button>
  );
}

export interface ButtonLinkProps extends ButtonLook, AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly href: string;
  readonly children: ReactNode;
}

/** Lien présenté comme un bouton (navigation : « Publica tu auto »). */
export function ButtonLink({
  variant,
  size,
  block,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <a {...rest} className={cx(lookClass({ variant, size, block }), className)}>
      {children}
    </a>
  );
}
