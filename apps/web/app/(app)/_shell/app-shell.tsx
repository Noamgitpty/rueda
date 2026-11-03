import type { ReactNode } from 'react';
import type { LocaleProfile, Translator } from '@rueda/i18n';
import type { ShellBrand } from '../../../brand-source.ts';
import { LanguageMenu } from './language-menu.tsx';
import { ShellRuntime } from './shell-runtime.tsx';
import styles from './shell.module.css';
import { Wordmark } from './wordmark.tsx';

import { MAIN_ID } from './main-id.ts';

export { MAIN_ID };

export interface AppShellProps {
  readonly brand: ShellBrand;
  readonly i18n: Translator;
  readonly locales: readonly LocaleProfile[];
  /** Service worker enregistré (build de production seulement). */
  readonly serviceWorker: boolean;
  readonly children: ReactNode;
}

/**
 * Coquille de l'application (US-048) : lien d'évitement, en-tête collant en verre (marque, choix
 * de la langue, UX-11), bandeau hors ligne annoncé (UX-48), puis l'écran, qui porte son propre `<main>`. Mobile d'abord (360 px,
 * UX-01) ; aucune couche flottante en bas d'écran, réservée à la barre d'action (UX-05).
 * Aucune donnée de requête lue ici : rendu testable dans chaque locale et chaque thème.
 */
export function AppShell({ brand, i18n, locales, serviceWorker, children }: AppShellProps) {
  return (
    <div className={styles['shell']}>
      <a className={styles['skip']} href={`#${MAIN_ID}`}>
        {i18n.t('web.shell.skipToContent')}
      </a>
      <header className={styles['header']}>
        <div className={styles['bar']}>
          <Wordmark brand={brand} label={i18n.t('web.shell.homeLink', { brand: brand.name })} />
          <LanguageMenu i18n={i18n} locales={locales} />
        </div>
        <ShellRuntime
          serviceWorker={serviceWorker}
          offlineText={i18n.t('common.offline.banner')}
          restoredText={i18n.t('common.offline.restored')}
        />
      </header>
      <div className={styles['content']}>{children}</div>
    </div>
  );
}
