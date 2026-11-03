import type { Translator } from '@rueda/i18n';
import { Icon } from '@rueda/ui';
import { OfflineRetry } from './offline-retry.tsx';
import { MAIN_ID } from '../_shell/main-id.ts';
import styles from './offline.module.css';

/** Contenu de l'écran hors ligne, sans accès à la requête : testable dans chaque locale. */
export function OfflineContent({ i18n }: { readonly i18n: Translator }) {
  return (
    <main
      id={MAIN_ID}
      tabIndex={-1}
      className={styles['offline']}
      aria-labelledby="offline-title"
      data-offline-screen=""
    >
      <span className={styles['mark']} aria-hidden="true">
        <Icon name="offline" />
      </span>
      <h1 id="offline-title" className={styles['title']}>
        {i18n.t('web.offline.title')}
      </h1>
      <p className={styles['body']}>{i18n.t('web.offline.body')}</p>
      <OfflineRetry label={i18n.t('web.offline.retry')} />
    </main>
  );
}
