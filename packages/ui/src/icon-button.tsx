import type { ButtonHTMLAttributes } from 'react';
import styles from './icon-button.module.css';
import { Icon } from './icon.tsx';
import type { IconName } from './icon.tsx';
import { cx } from './internal/cx.ts';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly icon: IconName;
  /** Nom accessible obligatoire (« Guardar Toyota Yaris 2021 ») : l'icône seule ne dit rien. */
  readonly label: string;
  /** Bascule (enregistré / non enregistré) : `aria-pressed`, icône pleine quand vrai. */
  readonly pressed?: boolean | undefined;
}

/** Bouton d'icône rond de 48 px, sur verre (repli opaque sans `backdrop-filter`). */
export function IconButton({
  icon,
  label,
  pressed,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={cx(styles['iconButton'], className)}
    >
      <Icon name={icon} filled={pressed} />
    </button>
  );
}
