/**
 * Habillage commun des écrans du prototype : ruban « données fictives », barre d'outils (écran,
 * état, langue, thème, pays d'exemple), en-tête de l'application, navigation basse, barre d'action,
 * mini-carte et motif camino. Tout est en liens (fonctionne sans JavaScript).
 */
import type { ReactNode } from 'react';
import { Icon } from '@rueda/ui';
import type { IconName } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import type { ScreenContext } from './context.ts';
import { MARKETS } from './data/scenario.ts';
import { SCREENS, screenOf } from './options.ts';
import type { ProtoTheme } from './options.ts';
import styles from './proto.module.css';

const cx = (...names: Array<string | false | undefined>): string =>
  names.filter((n): n is string => Boolean(n)).join(' ');

export { cx };

interface Choice {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly current: boolean;
  readonly lang?: string;
}

function ChoiceGroup({
  legend,
  choices,
}: {
  readonly legend: string;
  readonly choices: readonly Choice[];
}) {
  return (
    <nav className={styles['toolbarGroup']} aria-label={legend}>
      <p className={styles['toolbarLegend']} aria-hidden="true">
        {legend}
      </p>
      <ul className={styles['chips']}>
        {choices.map((c) => (
          <li key={c.key}>
            <a
              className={styles['chip']}
              href={c.href}
              lang={c.lang}
              aria-current={c.current ? 'true' : undefined}
            >
              {c.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Barre d'outils du prototype (masquée en mode capture). */
export function Toolbar({ ctx, screen }: { readonly ctx: ScreenContext; readonly screen: string }) {
  const { t, options } = ctx;
  const spec = screenOf(screen);
  const current = ctx.i18n.profile.tag;
  return (
    <details className={styles['toolbar']}>
      <summary className={styles['toolbarSummary']}>
        <Icon name="sliders" />
        {t('proto.toolbar.label')}
      </summary>
      <div className={styles['toolbarBody']}>
        <ChoiceGroup
          legend={t('proto.toolbar.screen')}
          choices={SCREENS.map((s) => ({
            key: s.id,
            label: t(s.title),
            href: ctx.href(s.id, { locale: current }),
            current: s.id === screen,
          }))}
        />
        {spec && (
          <ChoiceGroup
            legend={t('proto.toolbar.state')}
            choices={spec.states.map((state) => ({
              key: state,
              label: t(`proto.state.${state}`),
              href: ctx.href(screen, { locale: current, state, sel: options.sel }),
              current: state === ctx.state,
            }))}
          />
        )}
        <ChoiceGroup
          legend={t('common.locale.switchLabel')}
          choices={LOCALE_CONFIG.locales.map((p) => ({
            key: p.tag,
            label: p.displayName,
            lang: p.tag,
            href: ctx.href(screen, { locale: p.tag, state: ctx.state, sel: options.sel }),
            current: p.tag === current,
          }))}
        />
        <ChoiceGroup
          legend={t('web.catalog.controls.theme')}
          choices={(['auto', 'light', 'dark'] as const satisfies readonly ProtoTheme[]).map(
            (mode) => ({
              key: mode,
              label: t(`web.catalog.controls.${mode}`),
              href: ctx.href(screen, {
                locale: current,
                theme: mode,
                state: ctx.state,
                sel: options.sel,
              }),
              current: options.theme === mode,
            }),
          )}
        />
        <ChoiceGroup
          legend={t('proto.toolbar.market')}
          choices={MARKETS.map((m) => ({
            key: m.id,
            label: m.countryName[ctx.copy.language],
            href: ctx.href(screen, {
              locale: current,
              market: m.id,
              state: ctx.state,
              sel: options.sel,
            }),
            current: m.id === ctx.market.id,
          }))}
        />
        <p className={styles['text']}>
          <a className={styles['link']} href={ctx.href(null, { locale: current })}>
            {t('proto.toolbar.index')}
          </a>
        </p>
      </div>
    </details>
  );
}

/** Nom de marque : initiale en couleur `primary`, le reste en couleur du texte (US-028). */
export function Wordmark({ brand }: { readonly brand: string }) {
  const [initial = '', ...rest] = Array.from(brand);
  return (
    <>
      <span className={styles['wordmarkInitial']}>{initial}</span>
      {rest.join('')}
    </>
  );
}

export function AppHeader({
  ctx,
  back,
  title,
  onPrimary,
}: {
  readonly ctx: ScreenContext;
  readonly back?: string | undefined;
  readonly title?: string | undefined;
  readonly onPrimary?: boolean | undefined;
}) {
  const { t } = ctx;
  return (
    <header className={cx(styles['header'], onPrimary && styles['headerOnPrimary'])}>
      {back && (
        <a className={styles['iconLink']} href={back} aria-label={t('web.header.back')}>
          <Icon name="back" />
        </a>
      )}
      {title ? (
        <h1 className={styles['headerTitle']}>{title}</h1>
      ) : (
        <a
          className={styles['wordmark']}
          href={ctx.href('s01')}
          aria-label={t('web.header.home', { brand: ctx.brand })}
        >
          <Wordmark brand={ctx.brand} />
        </a>
      )}
      <a className={styles['iconLink']} href={ctx.href('s17')}>
        <Icon name="help" />
        {t('web.header.help')}
      </a>
    </header>
  );
}

const NAV: ReadonlyArray<{
  readonly screen: string;
  readonly icon: IconName;
  readonly key: 'web.nav.explore' | 'web.nav.trips' | 'web.nav.help' | 'web.nav.account';
}> = [
  { screen: 's01', icon: 'search', key: 'web.nav.explore' },
  { screen: 's08', icon: 'car', key: 'web.nav.trips' },
  { screen: 's17', icon: 'help', key: 'web.nav.help' },
  { screen: 's14', icon: 'user', key: 'web.nav.account' },
];

export function BottomNav({
  ctx,
  current,
}: {
  readonly ctx: ScreenContext;
  readonly current: string;
}) {
  return (
    <nav className={styles['nav']} aria-label={ctx.t('web.nav.label')}>
      <ul className={styles['navList']}>
        {NAV.map((item) => (
          <li key={item.screen}>
            <a
              className={styles['navItem']}
              href={ctx.href(item.screen)}
              aria-current={item.screen === current ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              {ctx.t(item.key)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function ActionBar({
  price,
  children,
}: {
  readonly price?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className={styles['actionBar']}>
      {price && <div className={styles['actionBarPrice']}>{price}</div>}
      {children}
    </div>
  );
}

/** Motif signature « camino » (US-028) : tracé pointillé décoratif. */
export function Camino({ className }: { readonly className?: string | undefined }) {
  return (
    <svg className={className} viewBox="0 0 240 160" aria-hidden="true" focusable="false">
      <path d="M8 150 C 70 140, 60 90, 120 82 S 190 30, 232 10" />
      <path d="M40 158 C 100 150, 96 112, 150 104 S 214 60, 238 44" />
    </svg>
  );
}

/**
 * Mini-carte schématique (aucune tuile, aucune donnée réelle) : rues, zone approximative ou point
 * exact, position du voyageur et tracé camino. Décorative : l'information est dans le texte voisin
 * (WCAG 2.5.7, 10b S02 « liste équivalente »).
 */
export function MiniMap({
  label,
  zone,
  pins = 1,
}: {
  readonly label: string;
  readonly zone?: boolean | undefined;
  readonly pins?: number | undefined;
}) {
  const spots = [
    [210, 70],
    [120, 46],
    [262, 128],
    [80, 120],
  ] as const;
  return (
    <div className={styles['map']}>
      <svg
        viewBox="0 0 320 180"
        aria-hidden="true"
        focusable="false"
        preserveAspectRatio="xMidYMid slice"
      >
        <path className={styles['mapStreet']} d="M-10 140 L330 60" />
        <path className={styles['mapStreet']} d="M60 -10 L140 200" />
        <path className={styles['mapStreet']} d="M180 -10 L250 200" />
        <path className={styles['mapStreet']} d="M-10 40 L330 100" />
        {zone ? (
          <circle className={styles['mapZone']} cx="210" cy="70" r="38" />
        ) : (
          <path
            className={styles['mapRoute']}
            d="M70 150 C 120 140, 140 100, 170 92 S 200 76, 210 70"
          />
        )}
        {spots.slice(0, zone ? 0 : pins).map(([x, y]) => (
          <circle key={`${x}-${y}`} className={styles['mapPin']} cx={x} cy={y} r="9" />
        ))}
        {!zone && <circle className={styles['mapMe']} cx="70" cy="150" r="8" />}
      </svg>
      <span className={styles['mapLabel']}>
        <Icon name="pin" />
        {label}
      </span>
    </div>
  );
}

export function Row({
  icon,
  title,
  detail,
  end,
}: {
  readonly icon: IconName;
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  readonly end?: ReactNode;
}) {
  return (
    <li className={styles['row']}>
      <span className={styles['rowIcon']}>
        <Icon name={icon} />
      </span>
      <span className={styles['rowText']}>
        <span className={styles['strong']}>{title}</span>
        {detail && <span className={styles['muted']}>{detail}</span>}
      </span>
      {end ?? <span />}
    </li>
  );
}

export function HiddenContext({ ctx }: { readonly ctx: ScreenContext }) {
  const pairs: Array<readonly [string, string]> = [];
  if (ctx.options.locale) pairs.push(['lang', ctx.options.locale]);
  if (ctx.options.theme !== 'auto') pairs.push(['theme', ctx.options.theme]);
  if (ctx.options.market) pairs.push(['market', ctx.options.market]);
  if (ctx.options.capture) pairs.push(['capture', '1']);
  return (
    <>
      {pairs.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}

export { styles };
