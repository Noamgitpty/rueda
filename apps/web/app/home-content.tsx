import type { MessageKey, Translator } from '@rueda/i18n';
import { CarIllustration, Icon } from '@rueda/ui';
import type { IconName } from '@rueda/ui';
import { MAIN_ID } from './(app)/_shell/main-id.ts';
import styles from './home.module.css';

interface Step {
  readonly title: MessageKey;
  readonly body: MessageKey;
  readonly icon: IconName;
}

const STEPS: readonly Step[] = [
  { title: 'web.s01.how.1', body: 'web.s01.how.1.body', icon: 'pin' },
  { title: 'web.s01.how.2', body: 'web.s01.how.2.body', icon: 'shield' },
  { title: 'web.s01.how.3', body: 'web.s01.how.3.body', icon: 'car' },
];

/**
 * Accueil dans la coquille (US-048) : bloc « nuit » avec le grand titre, l'auto dessinée maison et
 * le _camino_ qui se dessine une fois (motif signature, PROPOSITIONS US-028), puis « Cómo funciona »
 * relié par le _camino_ et l'invitation aux hôtes. Textes de 10b §4.3 (S01) ; la recherche, le rail
 * et l'estimateur de revenus de S01 arrivent avec le lot 2. Sans accès à la requête : testable dans
 * chaque locale. Styles : jetons seulement (US-030).
 */
export function HomeContent({ i18n }: { readonly i18n: Translator }) {
  const t = i18n.t.bind(i18n);
  return (
    <main id={MAIN_ID} tabIndex={-1} className={styles['page']}>
      <section className={styles['hero']} aria-labelledby="home-title">
        <h1 id="home-title" className={styles['title']}>
          {t('web.s01.title')}
        </h1>
        <p className={styles['subtitle']}>{t('web.s01.subtitle')}</p>
        <div className={styles['stage']} aria-hidden="true">
          <svg
            className={styles['camino']}
            viewBox="0 0 320 64"
            preserveAspectRatio="none"
            focusable="false"
          >
            <path pathLength={1} d="M6 52C70 58 96 20 160 30s104 28 154-14" />
          </svg>
          <CarIllustration tone={1} className={styles['car']} />
        </div>
        <p className={styles['tagline']}>
          <Icon name="check" />
          <span>{t('web.home.tagline')}</span>
        </p>
      </section>

      <section className={styles['section']} aria-labelledby="home-how">
        <h2 id="home-how" className={styles['heading']}>
          {t('web.s01.how.title')}
        </h2>
        <ol className={styles['steps']}>
          {STEPS.map(({ title, body, icon }) => (
            <li key={title} className={styles['step']}>
              <span className={styles['stepMark']}>
                <Icon name={icon} />
              </span>
              <div className={styles['stepText']}>
                <h3 className={styles['stepTitle']}>{t(title)}</h3>
                <p className={styles['stepBody']}>{t(body)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles['owner']} aria-labelledby="home-owner">
        <span className={styles['ownerMark']} aria-hidden="true">
          <CarIllustration tone={3} />
        </span>
        <h2 id="home-owner" className={styles['heading']}>
          {t('web.s01.owner.title')}
        </h2>
        <p className={styles['ownerBody']}>{t('web.s01.owner.body')}</p>
      </section>
    </main>
  );
}
