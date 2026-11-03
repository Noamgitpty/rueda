import styles from './car-illustration.module.css';
import { cx } from './internal/cx.ts';

export interface CarIllustrationProps {
  /** Ton de carrosserie (1 à 4, couleurs des avatars du thème). */
  readonly tone?: 1 | 2 | 3 | 4 | undefined;
  readonly className?: string | undefined;
}

/**
 * Illustration générique de voiture, vue de profil, en attendant les photos de l'hôte (10b
 * UX-65, UX-70). Décorative : le modèle et l'année sont écrits à côté.
 */
export function CarIllustration({ tone = 1, className }: CarIllustrationProps) {
  return (
    <svg
      className={cx(styles['car'], styles[`tone${tone}`], className)}
      viewBox="0 0 240 100"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M14 70c0-10 6-14 16-16l32-4c12-14 28-22 50-22h38c18 0 32 8 46 22l18 4c10 2 14 8 14 16v4c0 3-2 4-5 4H18c-3 0-4-2-4-4z"
      />
      <path className={styles['window']} d="M78 50c9-11 20-16 34-16h16v16z" />
      <path className={styles['window']} d="M134 34h16c14 0 24 6 35 16h-51z" />
      <rect className={styles['light']} x="214" y="58" width="10" height="5" rx="2" />
      <circle className={styles['tyre']} cx="62" cy="78" r="16" />
      <circle className={styles['hub']} cx="62" cy="78" r="7" />
      <circle className={styles['tyre']} cx="184" cy="78" r="16" />
      <circle className={styles['hub']} cx="184" cy="78" r="7" />
    </svg>
  );
}
