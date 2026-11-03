import styles from './icon.module.css';
import { cx } from './internal/cx.ts';

/**
 * Icônes maison (10b UX-70 : rien de Turo), tracées en `currentColor` : elles prennent la couleur
 * et la taille du texte voisin. Toujours décoratives (`aria-hidden`) : le sens est porté par un
 * texte visible ou par le libellé du contrôle (10b UX-48, jamais la couleur ni l'icône seules).
 */
const PATHS = {
  heart:
    'M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.6 1.1 5 2.9 1.4-1.8 3-2.9 5-2.9 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z',
  star: 'M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6-4.5-4.2 6.1-.8z',
  check: 'M4.5 12.5l5 5 10-11',
  alert: 'M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.2v.3',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.3',
  shield: 'M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6zM8.5 12l2.5 2.5 4.5-5',
  camera:
    'M4 7.5h3.2L9 5h6l1.8 2.5H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  pin: 'M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11zM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',
  offline:
    'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.8a10 10 0 0 1 4.2-2.5M14.8 10.3A10 10 0 0 1 19 12.8M12 20v.3',
  car: 'M3.5 15.5v-3l2-4.5h13l2 4.5v3M3.5 15.5h17M6.5 18.5v-3M17.5 18.5v-3M7 12.5h.3M16.7 12.5h.3',
} as const;

export type IconName = keyof typeof PATHS;

/** Icônes pleines ; les autres sont tracées au trait. */
const FILLED: ReadonlySet<IconName> = new Set(['heart', 'star']);

export interface IconProps {
  readonly name: IconName;
  readonly className?: string | undefined;
  /** Pour `heart` : plein quand l'élément est enregistré. */
  readonly filled?: boolean | undefined;
}

export function Icon({ name, className, filled }: IconProps) {
  const solid = filled ?? FILLED.has(name);
  const outlined = name === 'heart' && !solid;
  return (
    <svg
      className={cx(styles['icon'], className)}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill={solid ? 'currentColor' : 'none'}
      stroke={solid && !outlined ? 'none' : 'currentColor'}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
