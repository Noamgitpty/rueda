/**
 * S14 Compte et préférences (10b §4.1) : statut de vérification et validité, photo de profil
 * (obligatoire avant la première réservation, UX-37), langue, matrice des canaux (marketing jamais
 * pré-coché), export des données, entrée « Publica tu auto » vers l'espace hôte (A01 puis A07).
 */
import { Avatar, Badge, Banner, ButtonLink, CarIllustration, Icon } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import type { ScreenContext } from '../context.ts';
import { AppHeader, BottomNav, Row, cx, styles } from '../shell.tsx';
import { ErrorBlock, LoadingBlock, hostCar } from './host-kit.tsx';

const CATEGORIES = ['trips', 'messages', 'promos'] as const;
const CHANNELS = ['email', 'whatsapp', 'push'] as const;

export function S14({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, market, state } = ctx;
  const current = ctx.i18n.profile.tag;
  const car = hostCar(ctx);
  return (
    <>
      <AppHeader ctx={ctx} />
      <main className={styles['content']}>
        <h1 className={styles['h1']}>{t('web.s14.title')}</h1>
        <div className={styles['hostStrip']}>
          {state === 'noPhoto' ? (
            <span className={cx(styles['hostAvatar'], styles['avatarEmpty'])} aria-hidden="true">
              <Icon name="camera" />
            </span>
          ) : (
            <span className={styles['hostAvatarSlot']}>
              <Avatar name={market.guestName} size="lg" tone={2} />
            </span>
          )}
          <span className={styles['h3']}>{market.guestName}</span>
          <span className={styles['inline']}>
            <Badge tone="success">{t('web.host.guest.verified')}</Badge>
          </span>
        </div>
        {state === 'noPhoto' && (
          <Banner tone="warning" live="polite">
            {t('web.s14.profilePhoto')}
          </Banner>
        )}
        {state === 'noPhoto' && (
          <ButtonLink href={ctx.href('s14')}>
            <Icon name="camera" />
            {t('web.s14.addPhoto')}
          </ButtonLink>
        )}
        {state === 'error' && (
          <ErrorBlock ctx={ctx} title={t('web.s14.error')} retry={ctx.href('s14')} />
        )}
        {state === 'loading' ? (
          <LoadingBlock ctx={ctx} rows={5} />
        ) : (
          <>
            <ul className={styles['rows']}>
              <Row
                icon="shield"
                title={t('web.s14.verification')}
                detail={t('web.s14.verification.until', { date: ctx.date('licenseLimit') })}
              />
              <Row icon="phone" title={t('web.s15.phone')} detail={market.phoneMasked} />
            </ul>
            <section className={styles['section']} aria-labelledby="s14-lang">
              <h2 id="s14-lang" className={styles['h3']}>
                {t('web.s14.language')}
              </h2>
              <ul className={styles['chips']}>
                {LOCALE_CONFIG.locales.map((p) => (
                  <li key={p.tag}>
                    <a
                      className={styles['chip']}
                      href={ctx.href('s14', { locale: p.tag, state })}
                      lang={p.tag}
                      aria-current={p.tag === current ? 'true' : undefined}
                    >
                      {p.displayName}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
            <section className={styles['section']} aria-labelledby="s14-channels">
              <h2 id="s14-channels" className={styles['h3']}>
                {t('web.s14.channels')}
              </h2>
              <table className={styles['matrix']}>
                <caption className={styles['visuallyHidden']}>{t('web.s14.channels')}</caption>
                <thead>
                  <tr>
                    <td />
                    {CHANNELS.map((c) => (
                      <th key={c} scope="col">
                        {t(`web.s14.ch.${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CATEGORIES.map((cat) => (
                    <tr key={cat}>
                      <th scope="row">{t(`web.s14.cat.${cat}`)}</th>
                      {CHANNELS.map((c) => (
                        <td key={c}>
                          <label className={styles['matrixCell']}>
                            <input
                              type="checkbox"
                              className={styles['matrixBox']}
                              defaultChecked={
                                cat !== 'promos' && !(cat === 'messages' && c === 'email')
                              }
                              aria-label={`${t(`web.s14.cat.${cat}`)} · ${t(`web.s14.ch.${c}`)}`}
                            />
                          </label>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className={styles['muted']}>{t('web.s14.channels.note')}</p>
            </section>
            <section
              className={cx(styles['card'], styles['cardPrimary'], styles['becomeHost'])}
              aria-labelledby="s14-host"
            >
              <CarIllustration
                className={styles['becomeHostCar']}
                tone={car.carTone}
                kind={car.kind}
              />
              <h2 id="s14-host" className={styles['h3']}>
                {t('web.s14.becomeHost')}
              </h2>
              <p className={styles['muted']}>
                {t('web.s14.becomeHost.body', { brand: ctx.brand })}
              </p>
              <ButtonLink variant="secondary" href={ctx.href('a01')}>
                {t('web.a01.cta')}
              </ButtonLink>
            </section>
            <ul className={styles['rows']}>
              <Row icon="document" title={t('web.s14.export')} detail={t('web.s14.export.body')} />
              <Row icon="close" title={t('web.s14.delete')} />
            </ul>
          </>
        )}
      </main>
      <BottomNav ctx={ctx} current="s14" />
    </>
  );
}
