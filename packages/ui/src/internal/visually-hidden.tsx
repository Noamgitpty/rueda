import type { ReactNode } from 'react';
import styles from './a11y.module.css';

/** Texte lu par les lecteurs d'écran, invisible à l'écran. */
export function VisuallyHidden({ children }: { readonly children: ReactNode }) {
  return <span className={styles['srOnly']}>{children}</span>;
}
