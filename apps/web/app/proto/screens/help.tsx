/**
 * S17 Aide et urgence — 10b §4.1 (UX-05, WCAG 3.2.6, BR-PROT-05) : les numéros d'abord, en texte,
 * même si le reste ne charge pas. Numéros d'exemple (scenario.json), à ne pas composer.
 */
import { Banner, Icon, Skeleton } from '@rueda/ui';
import type { ScreenContext } from '../context.ts';
import { AppHeader, BottomNav, styles } from '../shell.tsx';

export function S17({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, market, state } = ctx;
  const p = market.phones;
  return (
    <>
      <AppHeader ctx={ctx} title={t('web.s17.title')} />
      {state === 'offline' && (
        <Banner tone="warning" icon="offline">
          {t('web.s17.offline')}
        </Banner>
      )}
      <main className={styles['content']}>
        <section className={styles['emergency']} aria-labelledby="s17-emergency">
          <h1 id="s17-emergency" className={styles['h2']}>
            {t('web.s17.emergency')}
          </h1>
          <a className={styles['bigNumber']} href={`tel:${p.emergency}`}>
            {t('web.s17.emergencyNumber', { number: p.emergency })}
            <Icon name="phone" />
          </a>
          <a className={styles['bigNumber']} href={`tel:${p.roadside}`}>
            <span>
              {t('web.s17.roadside', { insurer: market.insurerName })}
              <br />
              {p.roadside}
            </span>
            <Icon name="phone" />
          </a>
          <a className={styles['bigNumber']} href={`tel:${p.traffic}`}>
            <span>
              {t('web.s17.traffic', { authority: market.trafficAuthority })}
              <br />
              {p.traffic}
            </span>
            <Icon name="phone" />
          </a>
        </section>
        <section className={styles['card']} aria-labelledby="s17-support">
          <h2 id="s17-support" className={styles['h3']}>
            {t('web.s17.support', { brand: ctx.brand })}
          </h2>
          <a className={styles['bigNumber']} href={`tel:${p.support}`}>
            <span>
              {t('web.s17.whatsapp')}
              <br />
              {p.support}
            </span>
            <Icon name="chat" />
          </a>
          <a className={styles['bigNumber']} href={`tel:${p.support}`}>
            {t('web.s17.call', { number: p.support })}
            <Icon name="phone" />
          </a>
          <p className={styles['muted']}>{t('web.s17.hours')}</p>
        </section>
        <section className={styles['section']} aria-labelledby="s17-faq">
          <h2 id="s17-faq" className={styles['h3']}>
            {t('web.s17.faq')}
          </h2>
          {state === 'loading' ? (
            <div className={styles['stackTight']} aria-busy="true">
              <Skeleton width="long" />
              <Skeleton width="medium" />
              <Skeleton width="long" />
            </div>
          ) : (
            <div>
              <details className={styles['faq']}>
                <summary>{t('web.s17.faq.deposit')}</summary>
                <p className={styles['muted']}>{t('web.s17.faq.deposit.body')}</p>
              </details>
              <details className={styles['faq']}>
                <summary>{t('web.s17.faq.late')}</summary>
                <p className={styles['muted']}>{t('web.s17.faq.late.body')}</p>
              </details>
              <details className={styles['faq']}>
                <summary>{t('web.s17.faq.damage')}</summary>
                <p className={styles['muted']}>{t('web.s17.faq.damage.body')}</p>
              </details>
            </div>
          )}
        </section>
      </main>
      <BottomNav ctx={ctx} current="s17" />
    </>
  );
}
