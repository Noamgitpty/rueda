import type { ReactNode } from 'react';
import type { Translator } from '@rueda/i18n';
import styles from './banner.module.css';
import { Icon } from './icon.tsx';
import type { IconName } from './icon.tsx';
import { cx } from './internal/cx.ts';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger';

const TONE_ICON: Readonly<Record<BannerTone, IconName>> = {
  info: 'info',
  success: 'check',
  warning: 'alert',
  danger: 'alert',
};

export interface BannerProps {
  readonly tone?: BannerTone | undefined;
  readonly title?: string | undefined;
  readonly children: ReactNode;
  readonly icon?: IconName | undefined;
  /**
   * Annonce aux lecteurs d'écran (10b UX-48) : `polite` pour un message d'état (`role="status"`),
   * `assertive` pour une erreur (`role="alert"`), `off` (défaut) pour un texte statique.
   */
  readonly live?: 'off' | 'polite' | 'assertive' | undefined;
  readonly className?: string | undefined;
}

const ROLE = { off: undefined, polite: 'status', assertive: 'alert' } as const;

/** Bandeau d'information, de succès, d'attention ou d'erreur (hors connexion, caution…). */
export function Banner({
  tone = 'info',
  title,
  children,
  icon,
  live = 'off',
  className,
}: BannerProps) {
  return (
    <div className={cx(styles['banner'], styles[tone], className)} role={ROLE[live]}>
      <Icon name={icon ?? TONE_ICON[tone]} />
      <div className={styles['content']}>
        {title && <p className={styles['title']}>{title}</p>}
        <p className={styles['text']}>{children}</p>
      </div>
    </div>
  );
}

export interface EmptyStateProps {
  readonly title: string;
  readonly body?: string | undefined;
  /** Action qui fait avancer (« Quitar filtros »), jamais une impasse (10b §4.1). */
  readonly action?: ReactNode;
  readonly icon?: IconName | undefined;
  readonly headingLevel?: 2 | 3 | 4 | undefined;
}

/** État vide d'un écran ou d'une liste. */
export function EmptyState({
  title,
  body,
  action,
  icon = 'car',
  headingLevel = 2,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div className={styles['state']}>
      <span className={styles['stateIcon']}>
        <Icon name={icon} />
      </span>
      <Heading className={styles['stateTitle']}>{title}</Heading>
      {body && <p className={styles['stateBody']}>{body}</p>}
      {action}
    </div>
  );
}

export interface ErrorStateProps {
  readonly i18n: Translator;
  readonly title?: string | undefined;
  /**
   * Message structuré de 10b §3.12 : ce qui s'est passé + ce qui est sauvegardé + que faire
   * (par exemple `common.error.server`).
   */
  readonly message: string;
  /** Code de support, en petit et sélectionnable (jamais en premier plan). */
  readonly code?: string | undefined;
  readonly action?: ReactNode;
  readonly headingLevel?: 2 | 3 | 4 | undefined;
}

/** État d'erreur d'un écran : annoncé de façon assertive (10b UX-48). */
export function ErrorState({
  i18n,
  title,
  message,
  code,
  action,
  headingLevel = 2,
}: ErrorStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div className={styles['state']} role="alert">
      <span className={styles['stateIcon']}>
        <Icon name="alert" />
      </span>
      {title && <Heading className={styles['stateTitle']}>{title}</Heading>}
      <p className={styles['stateBody']}>{message}</p>
      {code && <p className={styles['code']}>{i18n.t('common.ui.error.code', { code })}</p>}
      {action}
    </div>
  );
}
