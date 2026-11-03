/**
 * S03 Fiche de la voiture — 10b §4.1 (UX-15, UX-17, UX-21, UX-54, UX-65), parcours 4.2.1.
 */
import {
  Badge,
  Banner,
  ButtonLink,
  CarIllustration,
  DepositBlock,
  HostCard,
  Icon,
  Price,
  PriceBreakdown,
  Rating,
  Skeleton,
} from '@rueda/ui';
import type { PriceLine } from '@rueda/ui';
import type { ScreenContext } from '../context.ts';
import { featuredCar, money, planOf } from '../data/scenario.ts';
import type { PlanId } from '../data/scenario.ts';
import { ActionBar, MiniMap, Row, cx, styles } from '../shell.tsx';

/** Lignes du prix final (montants fictifs déjà calculés, jamais additionnés ici). */
export function priceLines(
  ctx: ScreenContext,
  planId: PlanId | undefined,
): {
  readonly lines: PriceLine[];
  readonly total: ReturnType<typeof money>;
} {
  const { t, market } = ctx;
  const plan = planOf(market, planId);
  const f = market.featured;
  return {
    lines: [
      {
        id: 'rent',
        label: t('web.price.rent', { count: market.days }),
        amount: money(market, f.lines.rentMinor),
      },
      { id: 'tripFee', label: t('web.price.tripFee'), amount: money(market, f.lines.tripFeeMinor) },
      {
        id: 'protection',
        label: t('web.price.protection', { plan: t(`web.s05.plan.${plan.id}`) }),
        amount: money(market, plan.priceMinor),
      },
      {
        id: 'tax',
        label: market.taxLabel[ctx.copy.language],
        amount: money(market, plan.taxMinor),
      },
    ],
    total: money(market, plan.totalMinor),
  };
}

export function S03({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, i18n, market, state } = ctx;
  const car = featuredCar(market);
  const f = market.featured;
  const { lines, total } = priceLines(ctx, 'BASICA');
  const isNew = state === 'empty';
  const request = state === 'request';
  if (state === 'loading') {
    return (
      <main className={styles['content']} aria-busy="true">
        <Skeleton shape="block" />
        <Skeleton width="long" />
        <Skeleton width="medium" />
        <Skeleton shape="block" />
        <Skeleton width="full" />
        <Skeleton width="short" />
      </main>
    );
  }
  return (
    <>
      <div className={styles['gallery']}>
        <div className={styles['galleryBar']}>
          <a
            className={styles['glassButton']}
            href={ctx.href('s02')}
            aria-label={t('web.s03.back')}
          >
            <Icon name="back" />
          </a>
          <span className={styles['galleryActions']}>
            <a
              className={styles['glassButton']}
              href={ctx.href('s03')}
              aria-label={t('web.s03.share')}
            >
              <Icon name="share" />
            </a>
            <a
              className={styles['glassButton']}
              href={ctx.href('s03')}
              aria-label={t('common.ui.car.save', { car: car.title })}
            >
              <Icon name="heart" />
            </a>
          </span>
        </div>
        <CarIllustration className={styles['galleryCar']} tone={car.carTone} />
        <span className={styles['galleryCount']}>
          {t('web.s03.photos', { n: 1, total: f.photosTotal, host_name: car.host.name })}
        </span>
      </div>
      <main className={styles['content']}>
        {state === 'error' && (
          <Banner tone="danger" title={t('web.s03.error.title')} live="assertive">
            {t('web.error.datesUnavailable', {
              date_unavailable: ctx.date('unavailable'),
              date_suggested: ctx.date('suggested'),
            })}
          </Banner>
        )}
        {state === 'error' && (
          <ButtonLink variant="secondary" href={ctx.href('s03')}>
            {t('web.s03.error.use')}
          </ButtonLink>
        )}
        <header className={styles['stackTight']}>
          <h1 className={styles['h1']}>{car.title}</h1>
          <div className={styles['inline']}>
            {isNew ? (
              <Badge>{t('web.s02.new')}</Badge>
            ) : (
              <Rating i18n={i18n} value={car.rating} trips={car.trips} />
            )}
            <span className={styles['muted']}>· {car.place}</span>
          </div>
          <div className={styles['inline']}>
            <Badge tone="success" icon={request ? 'clock' : 'check'}>
              {request
                ? t('web.s03.request', { host_name: car.host.name, count: f.requestHours })
                : t('web.s03.instant')}
            </Badge>
          </div>
        </header>

        <section className={styles['section']} aria-labelledby="s03-features">
          <h2 id="s03-features" className={styles['visuallyHidden']}>
            {t('web.s03.features.title')}
          </h2>
          <ul className={styles['features']}>
            <li className={styles['feature']}>
              <Icon name="user" />
              {t('web.s03.features.seats', { count: f.seats })}
            </li>
            <li className={styles['feature']}>
              <Icon name="gearbox" />
              {t(car.manual ? 'web.s03.features.manual' : 'web.s03.features.automatic')}
            </li>
            <li className={styles['feature']}>
              <Icon name="fuel" />
              {t('web.s03.features.fuel')}
            </li>
            <li className={styles['feature']}>
              <Icon name="route" />
              {t('web.s03.features.km', { count: f.kmPerDay })}
            </li>
          </ul>
        </section>

        <Banner tone="warning" icon="clock">
          {t('web.s03.signal.bookedAfter')}
        </Banner>

        <HostCard
          i18n={i18n}
          id="s03-host"
          name={car.host.name}
          titleForm={car.host.titleForm}
          tone={car.host.tone}
          rating={isNew ? undefined : car.rating}
          trips={isNew ? 0 : car.trips}
          memberSince={car.host.memberSince}
          verified
          responseRate={car.host.responseRate}
          responseHours={car.host.responseHours}
        />

        <section className={styles['section']} aria-labelledby="s03-rules">
          <h2 id="s03-rules" className={styles['h3']}>
            {t('web.s03.rules.title', { host_name: car.host.name })}
          </h2>
          <ul className={styles['rows']}>
            <Row
              icon="alert"
              title={t('web.s03.rules.smoking', {
                amount: i18n.money(money(market, f.fees.smokingMinor)),
              })}
            />
            <Row
              icon="heart"
              title={t('web.s03.rules.pets', {
                amount: i18n.money(money(market, f.fees.petsMinor)),
              })}
            />
            <Row
              icon="fuel"
              title={t('web.s03.rules.fuel', {
                amount: i18n.money(money(market, f.fees.fuelMinor)),
              })}
            />
          </ul>
        </section>

        <section className={styles['section']} aria-labelledby="s03-reviews">
          <h2 id="s03-reviews" className={styles['h3']}>
            {t('web.s03.reviews.title')}
          </h2>
          {isNew ? (
            <p className={styles['muted']}>{t('web.s03.reviews.empty')}</p>
          ) : (
            <figure className={cx(styles['card'])}>
              <blockquote className={styles['quote']}>{t('proto.sample.review')}</blockquote>
            </figure>
          )}
        </section>

        <section className={styles['section']} aria-labelledby="s03-meet">
          <h2 id="s03-meet" className={styles['h3']}>
            {t('web.s03.meet.title')}
          </h2>
          <MiniMap label={f.meetArea} zone />
          <p className={styles['muted']}>{t('web.s03.meet.approx')}</p>
        </section>

        <section className={styles['section']} aria-labelledby="s03-price">
          <h2 id="s03-price" className={styles['h3']}>
            {t('common.price.total')}
          </h2>
          <Price
            i18n={i18n}
            total={total}
            days={market.days}
            perDay={money(market, car.perDayMinor)}
            size="lg"
          />
          <PriceBreakdown i18n={i18n} lines={lines} total={total} />
        </section>

        <ul className={styles['rows']}>
          <Row
            icon="calendar"
            title={t('web.s03.cancel.title')}
            detail={t('web.s03.cancel.free', { date: ctx.date('freeCancelUntil') })}
          />
          <Row
            icon="shield"
            title={t('web.s03.protection.title')}
            detail={t('web.s03.protection.body', { insurer: market.insurerName })}
          />
        </ul>

        <DepositBlock
          i18n={i18n}
          id="s03-deposit"
          amount={money(market, f.depositMinor)}
          merchantName={ctx.brand}
          hostName={car.host.name}
          releaseBy={{ instant: market.instants.releaseBy, timeZone: market.timeZone }}
          rail="preauth"
        />

        <section className={styles['section']} aria-labelledby="s03-docs">
          <h2 id="s03-docs" className={styles['h3']}>
            {t('web.s03.docs.title')}
          </h2>
          <p className={styles['text']}>{t('web.s03.kyc.notice')}</p>
          <p className={styles['muted']}>
            {t('web.s03.kyc.90days', {
              date_limit: ctx.date('licenseLimit'),
              date_end: ctx.date('end'),
            })}
          </p>
        </section>
      </main>
      <ActionBar price={<Price i18n={i18n} total={total} days={market.days} />}>
        <ButtonLink href={ctx.href('s15')}>{t('web.s03.cta')}</ButtonLink>
      </ActionBar>
    </>
  );
}
