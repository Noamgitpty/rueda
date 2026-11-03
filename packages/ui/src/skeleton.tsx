import type { ReactNode } from 'react';
import type { Translator } from '@rueda/i18n';
import { cx } from './internal/cx.ts';
import { VisuallyHidden } from './internal/visually-hidden.tsx';
import styles from './skeleton.module.css';

export interface SkeletonProps {
  readonly shape?: 'line' | 'block' | 'circle' | undefined;
  /** Largeur d'une ligne. */
  readonly width?: 'short' | 'medium' | 'long' | 'full' | undefined;
  readonly className?: string | undefined;
}

/** Forme grise d'attente, décorative. */
export function Skeleton({ shape = 'line', width = 'full', className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        styles['skeleton'],
        styles[shape],
        shape === 'line' && styles[width],
        className,
      )}
    />
  );
}

export interface LoadingStateProps {
  readonly i18n: Translator;
  /** Texte annoncé (défaut : « Cargando… »). */
  readonly label?: string | undefined;
  /** Squelettes à la forme du contenu attendu. */
  readonly children?: ReactNode;
}

/**
 * État de chargement (10b §4.1) : région `status` polie qui annonce le chargement une fois, et
 * squelettes à la forme du contenu (pas de bascule de mise en page à l'arrivée des données).
 */
export function LoadingState({ i18n, label, children }: LoadingStateProps) {
  return (
    <div className={styles['loading']} role="status" aria-busy="true">
      <VisuallyHidden>{label ?? i18n.t('common.ui.loading')}</VisuallyHidden>
      {children}
    </div>
  );
}
