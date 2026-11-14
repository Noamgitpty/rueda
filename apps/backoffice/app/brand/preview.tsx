/**
 * Aperçu en direct d'un brouillon de marque (US-120, critère 1 ; 10b O02 « prévisualisation en
 * direct mobile et desktop, clair et sombre »). Les écrans S01, S03, S05, A02 et un e-mail sont
 * des **maquettes** composées des composants de `@rueda/ui`, rendues dans des cadres qui portent
 * les variables du brouillon (`previewStyleSheet`, attribut `data-brand-preview`) : la page de
 * la console garde son thème, la production n'est pas touchée (rien n'est publié).
 *
 * - Cadres inertes (`inert`) : rien n'y est cliquable ni focalisable ; aucun titre HTML (le plan
 *   de la page reste celui de la console) ; textes d'exemple du catalogue, dans la langue de la vue.
 * - Feuille injectée telle quelle : ses valeurs sortent de `buildTheme` (aucun `<`, `;` ni
 *   accolade possible) et l'attribut est contrôlé par `previewStyleSheet`.
 */
import { previewStyleSheet } from '@rueda/design-tokens';
import type { Mode, Theme } from '@rueda/design-tokens';
import type { MessageKey, Translator } from '@rueda/i18n';
import { Avatar, Badge, Banner, Button, CarIllustration, Rating } from '@rueda/ui';
import styles from './brand.module.css';
import { PREVIEW_ATTRIBUTE } from './brand-logic.ts';

export type PreviewWidth = 'mobile' | 'desktop';

export const PREVIEW_SCREENS = ['s01', 's03', 's05', 'a02', 'email'] as const;
export type PreviewScreen = (typeof PREVIEW_SCREENS)[number];

const SCREEN_KEYS: Readonly<Record<PreviewScreen, MessageKey>> = {
  s01: 'backoffice.o02.preview.s01',
  s03: 'backoffice.o02.preview.s03',
  s05: 'backoffice.o02.preview.s05',
  a02: 'backoffice.o02.preview.a02',
  email: 'backoffice.o02.preview.email',
};

function Brand({ name, logo }: { readonly name: string; readonly logo: string | undefined }) {
  return (
    <p className={styles['previewBrand']}>
      {logo !== undefined && <img className={styles['previewLogo']} src={logo} alt="" />}
      <span>{name}</span>
    </p>
  );
}

function Screen({
  i18n,
  screen,
  brand,
}: {
  readonly i18n: Translator;
  readonly screen: PreviewScreen;
  readonly brand: { readonly name: string; readonly logo: string | undefined };
}) {
  switch (screen) {
    case 's01':
      return (
        <>
          <Brand {...brand} />
          <p className={styles['previewTitle']}>{i18n.t('web.s01.title')}</p>
          <p className={styles['previewMuted']}>{i18n.t('web.s01.subtitle')}</p>
          <p className={styles['previewField']}>{i18n.t('backoffice.o02.sample.where')}</p>
          <Button type="button" block>
            {i18n.t('backoffice.o02.sample.search')}
          </Button>
          <ol className={styles['previewList']}>
            <li>{i18n.t('web.s01.how.1')}</li>
            <li>{i18n.t('web.s01.how.2')}</li>
            <li>{i18n.t('web.s01.how.3')}</li>
          </ol>
        </>
      );
    case 's03':
      return (
        <>
          <CarIllustration tone={1} className={styles['previewCar']} />
          <p className={styles['previewTitle']}>{i18n.t('backoffice.o02.sample.car')}</p>
          <Rating i18n={i18n} value={4.8} trips={12} />
          <p className={styles['previewRow']}>
            <Avatar name={i18n.t('backoffice.o02.sample.host')} size="sm" decorative />
            <span>{i18n.t('backoffice.o02.sample.host')}</span>
            <Badge tone="success">{i18n.t('backoffice.o02.sample.verified')}</Badge>
          </p>
          <Button type="button" block>
            {i18n.t('web.s03.cta')}
          </Button>
        </>
      );
    case 's05':
      return (
        <>
          <p className={styles['previewTitle']}>{i18n.t('backoffice.o02.sample.checkout')}</p>
          <ul className={styles['previewList']}>
            <li>{i18n.t('backoffice.o02.sample.plan1')}</li>
            <li className={styles['previewSelected']}>{i18n.t('backoffice.o02.sample.plan2')}</li>
            <li>{i18n.t('backoffice.o02.sample.plan3')}</li>
          </ul>
          <Banner tone="info">{i18n.t('backoffice.o02.sample.checkoutNote')}</Banner>
          <Button type="button" block>
            {i18n.t('backoffice.o02.sample.pay')}
          </Button>
        </>
      );
    case 'a02':
      return (
        <>
          <p className={styles['previewTitle']}>{i18n.t('backoffice.o02.sample.greeting')}</p>
          <p className={styles['previewRow']}>
            <Badge tone="success">{i18n.t('backoffice.o02.sample.confirmed')}</Badge>
            <Badge tone="warning">{i18n.t('backoffice.o02.sample.pending')}</Badge>
            <Badge tone="danger">{i18n.t('backoffice.o02.sample.late')}</Badge>
          </p>
          <p className={styles['previewRow']}>
            <Avatar name={i18n.t('backoffice.o02.sample.host')} tone={2} decorative />
            <Avatar name={i18n.t('backoffice.o02.sample.guest')} tone={3} decorative />
            <span className={styles['previewMuted']}>
              {i18n.t('backoffice.o02.sample.nextTrip')}
            </span>
          </p>
          <Button type="button" variant="secondary" block>
            {i18n.t('backoffice.o02.sample.addCar')}
          </Button>
        </>
      );
    case 'email':
      return (
        <>
          <div className={styles['previewMailHead']}>
            <Brand {...brand} />
          </div>
          <p className={styles['previewTitle']}>{i18n.t('backoffice.o02.sample.mailTitle')}</p>
          <p>{i18n.t('backoffice.o02.sample.mailBody')}</p>
          <Button type="button">{i18n.t('backoffice.o02.sample.mailCta')}</Button>
          <p className={styles['previewMuted']}>{i18n.t('backoffice.o02.sample.mailFooter')}</p>
        </>
      );
  }
}

export function BrandPreview({
  i18n,
  theme,
  brandName,
  logo,
  mode,
  width,
}: {
  readonly i18n: Translator;
  /** Thème compilé du brouillon ; absent (format invalide) : squelette, rien n'est rendu. */
  readonly theme: Theme | undefined;
  readonly brandName: string;
  readonly logo: Readonly<Record<Mode, string | undefined>>;
  readonly mode: Mode;
  readonly width: PreviewWidth;
}) {
  if (theme === undefined) {
    return <p className={styles['muted']}>{i18n.t('backoffice.o02.preview.unavailable')}</p>;
  }
  return (
    <>
      <style
        id="brand-preview-theme"
        dangerouslySetInnerHTML={{ __html: previewStyleSheet(theme, PREVIEW_ATTRIBUTE) }}
      />
      <div className={styles[width === 'mobile' ? 'framesMobile' : 'framesDesktop']}>
        {PREVIEW_SCREENS.map((screen) => (
          <figure key={screen} className={styles['figure']}>
            <figcaption className={styles['caption']}>{i18n.t(SCREEN_KEYS[screen])}</figcaption>
            <div
              {...{ [PREVIEW_ATTRIBUTE]: mode }}
              className={styles['frame']}
              data-screen={screen}
              inert
            >
              <Screen
                i18n={i18n}
                screen={screen}
                brand={{ name: brandName, logo: logo[mode] ?? logo.light }}
              />
            </div>
          </figure>
        ))}
      </div>
    </>
  );
}
