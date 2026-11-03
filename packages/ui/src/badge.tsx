import type { ReactNode } from 'react';
import styles from './badge.module.css';
import { Icon } from './icon.tsx';
import type { IconName } from './icon.tsx';
import { cx } from './internal/cx.ts';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

/** Icône par défaut d'un ton d'état : un état n'est jamais porté par la couleur seule (UX-48). */
const TONE_ICON: Readonly<Record<BadgeTone, IconName | undefined>> = {
  neutral: undefined,
  success: 'check',
  warning: 'alert',
  danger: 'alert',
};

export interface BadgeProps {
  readonly children: ReactNode;
  readonly tone?: BadgeTone | undefined;
  /** Remplace l'icône du ton ; `null` la retire (le texte doit alors suffire). */
  readonly icon?: IconName | null | undefined;
  readonly className?: string | undefined;
}

/**
 * Pastille de statut (« Identidad verificada », « Nuevo »). Aucun badge de statut d'hôte ni nom
 * de programme (10b UX-65, anti-Turo).
 */
export function Badge({ children, tone = 'neutral', icon, className }: BadgeProps) {
  const name = icon === null ? undefined : (icon ?? TONE_ICON[tone]);
  return (
    <span className={cx(styles['badge'], styles[tone], className)}>
      {name && <Icon name={name} />}
      {children}
    </span>
  );
}
