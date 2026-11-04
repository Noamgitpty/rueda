/**
 * Pièces communes de l'espace hôte (A01–A13) : navigation basse de l'hôte, carte du plan de gains,
 * ligne d'un voyageur, détail des **jambes** d'un trip, états de chargement et d'erreur.
 *
 * Aucun calcul de montant : la part de l'hôte, les jambes et les totaux sont lus dans
 * `scenario.json`, recalculés par l'oracle de 08 (`docs/design/US-033/prix_oracle.py`). La part
 * affichée est toujours celle du plan, figée sur le trip (`hostSharePctFrozen`, `sharePct`).
 */
import type { ReactNode } from 'react';
import { Avatar, Badge, Banner, ButtonLink, Icon, Skeleton } from '@rueda/ui';
import type { IconName } from '@rueda/ui';
import type { ScreenContext } from '../context.ts';
import type { CopyKey } from '../copy/index.ts';
import { carOf, money } from '../data/scenario.ts';
import type { HostTrip, ProtoCar } from '../data/scenario.ts';
import { cx, styles } from '../shell.tsx';

/** Prénom affiché d'une personne (le nom complet n'est jamais montré à l'autre partie). */
export const firstName = (name: string): string => name.split(' ')[0] ?? name;

export function hostCar(ctx: ScreenContext): ProtoCar {
  return carOf(ctx.market, ctx.market.host.carId);
}

export function amount(ctx: ScreenContext, minor: string): string {
  return ctx.i18n.money(money(ctx.market, minor));
}

export function tripDates(ctx: ScreenContext, trip: HostTrip): string {
  return `${ctx.date(trip.start)} – ${ctx.date(trip.end)}`;
}

/** Mois du scénario (« noviembre »), dans la langue et le fuseau du marché. */
export function monthName(ctx: ScreenContext): string {
  return new Intl.DateTimeFormat(ctx.i18n.profile.tag, {
    month: 'long',
    timeZone: ctx.market.timeZone,
  }).format(new Date(ctx.market.instants.monthRef));
}

const HOST_NAV: ReadonlyArray<{
  readonly screen: string;
  readonly icon: IconName;
  readonly key: CopyKey;
}> = [
  { screen: 'a02', icon: 'home', key: 'web.host.nav.home' },
  { screen: 'a05', icon: 'car', key: 'web.host.nav.bookings' },
  { screen: 'a06', icon: 'calendar', key: 'web.host.nav.calendar' },
  { screen: 'a08', icon: 'wallet', key: 'web.host.nav.earnings' },
];

/** Navigation basse de l'espace hôte (même PWA que le voyageur, 10b §4.3 espace `web`). */
export function HostNav({
  ctx,
  current,
}: {
  readonly ctx: ScreenContext;
  readonly current: string;
}) {
  return (
    <nav className={styles['nav']} aria-label={ctx.t('web.host.nav.label')}>
      <ul className={styles['navList']}>
        {HOST_NAV.map((item) => (
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

/**
 * Plan de gains de l'hôte (BR-PROT-06 [NOUS]) : un seul plan au lancement, `ESTÁNDAR`, part
 * lue dans les données ; franchise de l'hôte fixée avec l'assureur (pas encore connue).
 */
export function PlanCard({
  ctx,
  headingLevel = 3,
  children,
}: {
  readonly ctx: ScreenContext;
  readonly headingLevel?: 2 | 3;
  readonly children?: ReactNode;
}) {
  const { t, market } = ctx;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className={cx(styles['card'], styles['planCard'])}>
      <div className={styles['between']}>
        <Heading className={styles['h3']}>{t('web.host.plan.name')}</Heading>
        <Badge tone="success" icon="check">
          {t('web.host.plan.default')}
        </Badge>
      </div>
      <p className={styles['planShare']}>
        <span className={styles['planPct']}>
          {t('web.host.plan.pct', { pct: market.host.sharePct })}
        </span>
        <span>{t('web.host.plan.share')}</span>
      </p>
      <p className={styles['muted']}>
        {t('web.host.plan.deductible', { insurer: market.insurerName })}
      </p>
      {children}
    </div>
  );
}

export function GuestLine({
  ctx,
  trip,
  detail,
  end,
}: {
  readonly ctx: ScreenContext;
  readonly trip: HostTrip;
  readonly detail?: ReactNode;
  readonly end?: ReactNode;
}) {
  return (
    <div className={styles['guestLine']}>
      <Avatar name={trip.guest} tone={trip.guestTone} />
      <span className={styles['rowText']}>
        <span className={styles['strong']}>{firstName(trip.guest)}</span>
        <span className={styles['muted']}>{detail ?? tripDates(ctx, trip)}</span>
      </span>
      {end ?? <span />}
    </div>
  );
}

/**
 * Ce que le voyageur a payé et comment le règlement le répartit en jambes (08 E7) : part de
 * l'hôte selon son plan, protection pour l'assureur, {brand} (frais de service et taxe), taxe
 * reversée à un tiers si elle existe. La somme des jambes est le total payé (vérifié par l'oracle).
 */
export function LegLines({ ctx, trip }: { readonly ctx: ScreenContext; readonly trip: HostTrip }) {
  const { t, market } = ctx;
  const guest = firstName(trip.guest);
  const lines: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly minor: string;
  }> = [
    {
      id: 'host',
      label: t('web.a08.leg.host', {
        pct: market.host.sharePct,
        amount: amount(ctx, trip.rentMinor),
      }),
      minor: trip.hostMinor,
    },
    {
      id: 'insurer',
      label: t('web.a08.leg.insurer', { insurer: market.insurerName }),
      minor: trip.insurerMinor,
    },
    ...(BigInt(trip.taxThirdMinor) > 0n
      ? [{ id: 'tax', label: t('web.a08.leg.tax'), minor: trip.taxThirdMinor }]
      : []),
    {
      id: 'platform',
      label: t('web.a08.leg.platform', { brand: ctx.brand }),
      minor: trip.platformMinor,
    },
  ];
  return (
    <dl className={styles['priceLines']}>
      <div className={styles['priceLine']}>
        <dt>{t('web.a08.detail.paid', { guest })}</dt>
        <dd>{amount(ctx, trip.totalMinor)}</dd>
      </div>
      {lines.map((line) => (
        <div
          key={line.id}
          className={cx(styles['priceLine'], line.id === 'host' && styles['legHost'])}
        >
          <dt>{line.label}</dt>
          <dd>{amount(ctx, line.minor)}</dd>
        </div>
      ))}
      <div className={styles['priceTotal']}>
        <dt>{t('web.a08.detail.sum', { guest })}</dt>
        <dd>{amount(ctx, trip.totalMinor)}</dd>
      </div>
    </dl>
  );
}

export function LoadingBlock({
  ctx,
  rows = 3,
}: {
  readonly ctx: ScreenContext;
  readonly rows?: number;
}) {
  return (
    <div className={styles['stack']} aria-busy="true" role="status">
      <span className={styles['visuallyHidden']}>{ctx.t('proto.state.loading')}</span>
      <Skeleton shape="block" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} width={i % 2 === 0 ? 'long' : 'medium'} />
      ))}
    </div>
  );
}

export function ErrorBlock({
  ctx,
  title,
  children,
  retry,
}: {
  readonly ctx: ScreenContext;
  readonly title: string;
  readonly children?: ReactNode;
  readonly retry: string;
}) {
  return (
    <div className={styles['stack']}>
      <Banner tone="danger" title={title} live="assertive">
        {children ?? ctx.t('web.host.error.body')}
      </Banner>
      <ButtonLink variant="secondary" href={retry}>
        {ctx.t('web.common.retry')}
      </ButtonLink>
    </div>
  );
}
