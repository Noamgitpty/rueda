/**
 * S01 Accueil / recherche et S02 Résultats (+ feuillet des filtres) — 10b §4.1, parcours 4.2.1.
 */
import {
  Banner,
  Button,
  ButtonLink,
  CarCard,
  CarCardSkeleton,
  CarIllustration,
  Checkbox,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Skeleton,
  TextField,
} from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import type { ScreenContext } from '../context.ts';
import { money } from '../data/scenario.ts';
import type { ProtoCar } from '../data/scenario.ts';
import { AppHeader, BottomNav, Camino, HiddenContext, MiniMap, cx, styles } from '../shell.tsx';
import { Estimator } from './estimator.tsx';

function CarList({
  ctx,
  cars,
  rail,
}: {
  readonly ctx: ScreenContext;
  readonly cars: readonly ProtoCar[];
  readonly rail?: boolean;
}) {
  const { i18n, t, market } = ctx;
  return (
    <ul className={cx(rail ? styles['rail'] : styles['stack'])}>
      {cars.map((car) => (
        <li key={car.id}>
          <CarCard
            i18n={i18n}
            href={ctx.href('s03')}
            title={car.title}
            host={{ name: car.host.name, tone: car.host.tone }}
            rating={car.rating}
            trips={car.trips}
            place={car.place}
            distanceKm={car.distanceKm}
            total={money(market, car.totalMinor)}
            perDay={money(market, car.perDayMinor)}
            days={market.days}
            carTone={car.carTone}
            saveAction={
              <IconButton icon="heart" label={t('common.ui.car.save', { car: car.title })} />
            }
          />
        </li>
      ))}
    </ul>
  );
}

export function S01({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, i18n, market, state } = ctx;
  const featured = market.cars[0];
  const perDay = featured ? money(market, featured.perDayMinor) : undefined;
  // Estimateur de démonstration : jours × prix moyen de la zone (entiers exacts, aucun arrondi).
  const steps = perDay
    ? Array.from({ length: 30 }, (_, i) => ({
        days: i + 1,
        daysLabel: t('web.s01.owner.days', { count: i + 1 }),
        amount: i18n.money({ ...perDay, amountMinor: perDay.amountMinor * BigInt(i + 1) }),
      }))
    : [];
  return (
    <>
      <AppHeader ctx={ctx} onPrimary />
      {state === 'offline' && (
        <Banner tone="warning" icon="offline">
          {t('common.offline.banner')}
        </Banner>
      )}
      <section className={styles['hero']} aria-labelledby="s01-title">
        <Camino className={styles['heroCamino']} />
        <p className={styles['kicker']}>{t('web.s01.kicker', { country: ctx.country })}</p>
        <h1 id="s01-title" className={styles['display']}>
          {t('web.s01.title')}
        </h1>
        <p className={styles['heroSubtitle']}>{t('web.s01.subtitle')}</p>
        <CarIllustration className={styles['heroCar']} tone={2} />
      </section>
      <form
        className={styles['searchCard']}
        action={ctx.href('s02').split('?')[0]}
        method="get"
        role="search"
        aria-label={t('web.search.label')}
      >
        <HiddenContext ctx={ctx} />
        <TextField
          i18n={i18n}
          id="s01-place"
          name="place"
          label={t('web.search.place')}
          placeholder={t('web.search.placeHint')}
          defaultValue={state === 'empty' ? undefined : market.searchSummary.place}
          autoComplete="off"
        />
        <div className={styles['searchField']}>
          <Icon name="calendar" />
          <span className={styles['searchFieldText']}>
            <span className={styles['searchFieldLabel']}>{t('web.search.dates')}</span>
            <span className={styles['searchFieldValue']}>
              {ctx.dateTime('start')} – {ctx.dateTime('end')}
            </span>
          </span>
        </div>
        <TextField
          i18n={i18n}
          id="s01-age"
          name="age"
          type="number"
          inputMode="numeric"
          label={t('web.search.age')}
          hint={t('web.search.ageHint')}
          defaultValue="30"
        />
        <div className={styles['actions']}>
          <Button type="submit" block>
            {t('web.search.submit')}
          </Button>
          <ButtonLink variant="secondary" href={ctx.href('s02')}>
            <Icon name="pin" />
            {t('web.search.nearMe')}
          </ButtonLink>
        </div>
      </form>
      <main className={styles['content']}>
        {state === 'error' && (
          <>
            <ErrorState
              i18n={i18n}
              message={t('web.s01.error.places')}
              action={<ButtonLink href={ctx.href('s01')}>{t('web.common.retry')}</ButtonLink>}
            />
            <Banner tone="info">{t('web.error.notServed', { city: market.notServedCity })}</Banner>
          </>
        )}
        {state === 'empty' && (
          <section className={styles['section']} aria-labelledby="s01-places">
            <h2 id="s01-places" className={styles['h2']}>
              {t('web.s01.places.title')}
            </h2>
            <ul className={styles['chips']}>
              {market.places.map((place) => (
                <li key={place}>
                  <a className={styles['chip']} href={ctx.href('s02')}>
                    <Icon name="pin" />
                    {place}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        {(state === 'normal' || state === 'offline' || state === 'loading') && (
          <section className={styles['section']} aria-labelledby="s01-rail">
            <h2 id="s01-rail" className={styles['h2']}>
              {t('web.s01.rail.title')}
            </h2>
            {state === 'loading' ? (
              <div className={styles['rail']} aria-busy="true">
                <CarCardSkeleton />
                <CarCardSkeleton />
              </div>
            ) : (
              <CarList ctx={ctx} cars={market.cars} rail />
            )}
          </section>
        )}
        <section className={cx(styles['card'], styles['cardAccent'])} aria-labelledby="s01-review">
          <h2 id="s01-review" className={styles['kicker']}>
            {t('web.s01.review.title')}
          </h2>
          <p className={styles['quote']}>{t('proto.sample.review')}</p>
        </section>
        <section className={styles['section']} aria-labelledby="s01-how">
          <h2 id="s01-how" className={styles['h2']}>
            {t('web.s01.how.title')}
          </h2>
          <ol className={styles['steps']}>
            {(['1', '2', '3'] as const).map((n) => (
              <li key={n} className={styles['step']}>
                <span className={styles['strong']}>{t(`web.s01.how.${n}`)}</span>
                <span className={styles['muted']}>{t(`web.s01.how.${n}.body`)}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className={cx(styles['card'], styles['cardPrimary'])} aria-labelledby="s01-owner">
          <h2 id="s01-owner" className={styles['h2']}>
            {t('web.s01.owner.title')}
          </h2>
          <p className={styles['muted']}>{t('web.s01.owner.body')}</p>
          {perDay && (
            <Estimator
              label={t('web.s01.owner.daysLabel')}
              perMonth={t('web.s01.owner.perMonth')}
              steps={steps}
              initialDays={10}
            />
          )}
          {perDay && (
            <p className={styles['muted']}>
              {t('web.s01.owner.note', { amount: i18n.money(perDay) })}
            </p>
          )}
          <ButtonLink variant="secondary" href={ctx.href('s01')}>
            {t('web.s01.owner.cta')}
          </ButtonLink>
        </section>
        <nav className={styles['toolbarGroup']} aria-label={t('web.s01.language')}>
          <p className={styles['toolbarLegend']} aria-hidden="true">
            <Icon name="globe" /> {t('web.s01.language')}
          </p>
          <ul className={styles['chips']}>
            {LOCALE_CONFIG.locales.map((p) => (
              <li key={p.tag}>
                <a
                  className={styles['chip']}
                  href={ctx.href('s01', { locale: p.tag, state })}
                  lang={p.tag}
                  aria-current={p.tag === i18n.profile.tag ? 'true' : undefined}
                >
                  {p.displayName}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </main>
      <BottomNav ctx={ctx} current="s01" />
    </>
  );
}

const SORTS = ['distance', 'price', 'rating'] as const;
type Sort = (typeof SORTS)[number];

function sorted(cars: readonly ProtoCar[], sort: Sort): ProtoCar[] {
  const list = [...cars];
  if (sort === 'price') {
    list.sort((a, b) => {
      const x = BigInt(a.perDayMinor);
      const y = BigInt(b.perDayMinor);
      return x < y ? -1 : x > y ? 1 : 0;
    });
  } else if (sort === 'rating') {
    list.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  } else {
    list.sort((a, b) => a.distanceKm - b.distanceKm);
  }
  return list;
}

function FiltersSheet({ ctx, count }: { readonly ctx: ScreenContext; readonly count: number }) {
  const { t, i18n, market } = ctx;
  const bars = Array.from({ length: 10 }, (_, i) => i);
  const prices = market.cars.map((c) => BigInt(c.perDayMinor));
  const low = prices.reduce((a, b) => (b < a ? b : a));
  const high = prices.reduce((a, b) => (b > a ? b : a));
  return (
    <div className={styles['scrim']}>
      <section
        className={styles['sheet']}
        role="dialog"
        aria-modal="true"
        aria-labelledby="s02f-title"
      >
        <span className={styles['grabber']} aria-hidden="true" />
        <div className={styles['between']}>
          <h2 id="s02f-title" className={styles['h2']}>
            {t('web.s02f.title')}
          </h2>
          <a
            className={styles['iconLink']}
            href={ctx.href('s02')}
            aria-label={t('web.common.close')}
          >
            <Icon name="close" />
          </a>
        </div>
        <fieldset className={styles['choices']}>
          <legend className={styles['h3']}>{t('web.s02f.price')}</legend>
          <div className={styles['histogram']} aria-hidden="true">
            {bars.map((i) => (
              <span
                key={`bar-${i.toString()}`}
                className={cx(styles['bar'], i > 1 && i < 8 && styles['barOn'])}
              />
            ))}
          </div>
          <div className={styles['twoCols']}>
            <TextField
              i18n={i18n}
              id="s02f-min"
              label={t('web.s02f.min')}
              defaultValue={i18n.money(money(market, low.toString()))}
            />
            <TextField
              i18n={i18n}
              id="s02f-max"
              label={t('web.s02f.max')}
              defaultValue={i18n.money(money(market, high.toString()))}
            />
          </div>
        </fieldset>
        <fieldset className={styles['choices']}>
          <legend className={styles['h3']}>{t('web.s02f.type')}</legend>
          <ul className={styles['chips']}>
            {(['hatch', 'sedan', 'suv', 'pickup'] as const).map((type, i) => (
              <li key={type}>
                <a
                  className={styles['chip']}
                  href={ctx.href('s02', { state: 'sheet' })}
                  aria-pressed={i === 0 ? 'true' : 'false'}
                >
                  {t(`web.s02f.type.${type}`)}
                </a>
              </li>
            ))}
          </ul>
        </fieldset>
        <fieldset className={styles['choices']}>
          <legend className={styles['h3']}>{t('web.s02f.gearbox')}</legend>
          <ul className={styles['chips']}>
            {(['automatic', 'manual'] as const).map((g, i) => (
              <li key={g}>
                <a
                  className={styles['chip']}
                  href={ctx.href('s02', { state: 'sheet' })}
                  aria-pressed={i === 0 ? 'true' : 'false'}
                >
                  {t(`web.s02f.gearbox.${g}`)}
                </a>
              </li>
            ))}
          </ul>
        </fieldset>
        <div className={styles['stackTight']}>
          <Checkbox id="s02f-verified" label={t('web.s02f.verified')} defaultChecked />
          <Checkbox id="s02f-instant" label={t('web.s02f.instant')} defaultChecked={count === 0} />
        </div>
        <p className={styles['muted']} role="status">
          {count === 0 ? t('web.s02f.none') : t('web.s02f.updating')}
        </p>
        <div className={styles['twoCols']}>
          <ButtonLink variant="quiet" href={ctx.href('s02', { state: 'sheet' })}>
            {t('web.s02f.clear')}
          </ButtonLink>
          {count === 0 ? (
            <Button disabled aria-describedby="s02f-none">
              {t('web.s02f.show', { count })}
            </Button>
          ) : (
            <ButtonLink href={ctx.href('s02')}>{t('web.s02f.show', { count })}</ButtonLink>
          )}
        </div>
        {count === 0 && (
          <p id="s02f-none" className={styles['visuallyHidden']}>
            {t('web.s02f.none')}
          </p>
        )}
      </section>
    </div>
  );
}

export function S02({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, i18n, market, state } = ctx;
  const sort: Sort = SORTS.find((s) => s === ctx.options.sel) ?? 'distance';
  const cars = sorted(market.cars, sort);
  const summary = t('web.s02.summary', {
    place: market.searchSummary.place,
    dates: market.searchSummary.dates,
  });
  const showList =
    state === 'normal' || state === 'offline' || state === 'sheet' || state === 'sheetEmpty';
  return (
    <>
      <AppHeader ctx={ctx} back={ctx.href('s01')} title={summary} />
      {state === 'offline' && (
        <Banner tone="warning" icon="offline">
          {t('common.offline.banner')}
        </Banner>
      )}
      <main className={styles['content']}>
        <div className={styles['between']}>
          <h1 className={styles['h2']} aria-live="polite">
            {state === 'empty' || state === 'error'
              ? summary
              : t('web.s02.count', { count: state === 'loading' ? 0 : cars.length })}
          </h1>
          <ButtonLink variant="secondary" size="sm" href={ctx.href('s02', { state: 'sheet' })}>
            <Icon name="sliders" />
            {t('web.s02.filters')}
          </ButtonLink>
        </div>
        {state === 'empty' && (
          <EmptyState
            title={t('web.s02.empty')}
            icon="calendar"
            action={
              <div className={styles['actions']}>
                <ButtonLink href={ctx.href('s01')}>{t('web.s02.empty.dates')}</ButtonLink>
                <ButtonLink variant="secondary" href={ctx.href('s02')}>
                  {t('web.s02.empty.widen')}
                </ButtonLink>
                <ButtonLink variant="quiet" href={ctx.href('s02', { state: 'empty' })}>
                  {t('web.s02.empty.notify')}
                </ButtonLink>
              </div>
            }
          />
        )}
        {state === 'error' && (
          <ErrorState
            i18n={i18n}
            message={t('web.s02.error')}
            code={market.featured.errorCode}
            action={<ButtonLink href={ctx.href('s02')}>{t('web.common.retry')}</ButtonLink>}
          />
        )}
        {state === 'loading' && (
          <div className={styles['stack']} aria-busy="true">
            <Skeleton shape="block" />
            <CarCardSkeleton />
            <CarCardSkeleton />
          </div>
        )}
        {showList && (
          <>
            <nav aria-label={t('web.s02.sort.label')}>
              <ul className={styles['segments']}>
                {SORTS.map((s) => (
                  <li key={s}>
                    <a
                      className={styles['tab']}
                      href={ctx.href('s02', { sel: s })}
                      aria-current={s === sort ? 'true' : undefined}
                    >
                      {t(`web.s02.sort.${s}`)}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <section aria-label={t('web.s02.map.label')} className={styles['stackTight']}>
              <MiniMap label={market.searchSummary.place} pins={cars.length} />
              <p className={styles['muted']}>{t('web.s02.map.list')}</p>
            </section>
            <CarList ctx={ctx} cars={cars} />
          </>
        )}
      </main>
      <BottomNav ctx={ctx} current="s01" />
      {(state === 'sheet' || state === 'sheetEmpty') && (
        <FiltersSheet ctx={ctx} count={state === 'sheetEmpty' ? 0 : cars.length - 1} />
      )}
    </>
  );
}
