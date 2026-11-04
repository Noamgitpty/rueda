/**
 * Espace hôte au quotidien : A02 accueil (UX-39), A05 réservations (HDB-002, §4.1 bis), A06
 * calendrier (CAL-001 à 003), A08 gains et versements (UX-45, parcours 10b §4.2.9).
 *
 * Les états « normal » simulent un marché **ouvert** ; l'état réel d'aujourd'hui (interrupteurs à
 * `false`) est montré par A02 « fermé », A08 « versements fermés » et A07.
 */
import { Avatar, Badge, Banner, ButtonLink, CarIllustration, EmptyState, Icon } from '@rueda/ui';
import type { ScreenContext } from '../context.ts';
import { hostTrip } from '../data/scenario.ts';
import type { HostTrip } from '../data/scenario.ts';
import { ActionBar, AppHeader, Camino, MiniMap, Row, cx, styles } from '../shell.tsx';
import {
  ErrorBlock,
  GuestLine,
  HostNav,
  LegLines,
  LoadingBlock,
  amount,
  firstName,
  hostCar,
  monthName,
  tripDates,
} from './host-kit.tsx';

// ---------------------------------------------------------------- A02

export function A02({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, market, state } = ctx;
  const car = hostCar(ctx);
  const next = hostTrip(market, 'upcoming');
  const request = hostTrip(market, 'request');
  const guest = firstName(next.guest);
  const closed = state === 'closed';
  return (
    <>
      <AppHeader ctx={ctx} onPrimary />
      <section className={styles['hostHero']} aria-labelledby="a02-title">
        <Camino className={styles['heroCamino']} />
        <h1 id="a02-title" className={styles['display']}>
          {t('web.a02.greeting', { host_name: car.host.name })}
        </h1>
        <div className={styles['earnTile']}>
          <span className={styles['kicker']}>
            {t('web.a02.earnings.title', { month: monthName(ctx) })}
          </span>
          <span className={styles['earnAmount']}>
            {closed ? amount(ctx, '0') : amount(ctx, market.host.monthEarningsMinor)}
          </span>
          <a className={styles['earnLink']} href={ctx.href('a08')}>
            {t('web.a02.earnings.see')}
            <Icon name="back" className={styles['flip']} />
          </a>
        </div>
      </section>
      <main className={styles['content']}>
        {state === 'loading' && <LoadingBlock ctx={ctx} rows={4} />}
        {state === 'error' && (
          <ErrorBlock ctx={ctx} title={t('web.a02.error')} retry={ctx.href('a02')}>
            {t('web.a02.updatedAt', { date: ctx.date('monthRef'), time: ctx.time('monthRef') })}
          </ErrorBlock>
        )}
        {closed && (
          <Banner tone="info" icon="lock" title={t('web.a02.closed.title')}>
            {t('web.a07.waitingCountry', { brand: ctx.brand, country: ctx.country })}
          </Banner>
        )}
        {state === 'empty' && (
          <EmptyState icon="calendar" title={t('web.a02.empty')} body={t('web.a02.empty.body')} />
        )}
        {state === 'noShow' && (
          <Banner tone="warning" live="assertive" title={t('web.a02.noShow.title', { guest })}>
            {t('web.a02.noShow.body', { guest, brand: ctx.brand })}
          </Banner>
        )}
        {state === 'request' && (
          <section className={cx(styles['card'], styles['cardAccent'])} aria-labelledby="a02-req">
            <h2 id="a02-req" className={styles['h3']}>
              {t('web.a02.requests.title')}
            </h2>
            <GuestLine
              ctx={ctx}
              trip={request}
              end={<span className={styles['strong']}>{amount(ctx, request.hostMinor)}</span>}
            />
            <p className={styles['text']}>
              {t('web.a02.request.until', { date: ctx.dateTime('requestUntil') })}
            </p>
            <ButtonLink href={ctx.href('a05', { state: 'request' })}>
              {t('web.a02.request.open')}
            </ButtonLink>
          </section>
        )}
        {(state === 'normal' || state === 'request' || state === 'noShow') && (
          <>
            <section
              className={cx(styles['card'], styles['ticketHost'])}
              aria-labelledby="a02-next"
            >
              <p className={styles['kicker']}>{t('web.a02.next.handover')}</p>
              <h2 id="a02-next" className={styles['h3']}>
                {ctx.dateTime('start')}
              </h2>
              <GuestLine ctx={ctx} trip={next} detail={car.title} />
              <span className={styles['inline']}>
                <Badge tone="success">{t('web.host.guest.verified')}</Badge>
              </span>
              <MiniMap label={market.featured.meetArea} />
              <div className={styles['actions']}>
                <ButtonLink href={ctx.href('a03')}>{t('web.a02.next.start')}</ButtonLink>
                <ButtonLink variant="secondary" href={ctx.href('a02')}>
                  <Icon name="chat" />
                  {t('web.a02.message', { guest })}
                </ButtonLink>
              </div>
              {state === 'noShow' ? (
                <ButtonLink variant="secondary" href={ctx.href('o01', { state: 'item' })}>
                  {t('web.a02.noShow')}
                </ButtonLink>
              ) : (
                <div className={styles['stackTight']}>
                  <button
                    type="button"
                    className={styles['disabledButton']}
                    disabled
                    aria-describedby="a02-noshow"
                  >
                    {t('web.a02.noShow')}
                  </button>
                  <p id="a02-noshow" className={styles['muted']}>
                    {t('web.a02.noShow.at', { time: ctx.time('noShowAt'), guest })}
                  </p>
                </div>
              )}
            </section>
            <ul className={styles['rows']}>
              <Row
                icon="key"
                title={t('web.a02.next.return')}
                detail={`${ctx.dateTime('end')} · ${guest}`}
                end={
                  <a className={styles['link']} href={ctx.href('a04')}>
                    {t('web.a02.open')}
                  </a>
                }
              />
            </ul>
          </>
        )}
        {state !== 'loading' && (
          <section className={styles['section']} aria-labelledby="a02-cars">
            <div className={styles['sectionHead']}>
              <h2 id="a02-cars" className={styles['h2']}>
                {t('web.a02.cars.title')}
              </h2>
            </div>
            <ul className={styles['stack']}>
              <li className={styles['card']}>
                <div className={styles['trip']}>
                  <span className={styles['tripMedia']}>
                    <CarIllustration tone={car.carTone} kind={car.kind} />
                  </span>
                  <span className={styles['stackTight']}>
                    <span className={styles['inline']}>
                      {closed ? (
                        <Badge tone="warning" icon="lock">
                          {t('web.a10.status.ready')}
                        </Badge>
                      ) : (
                        <Badge tone="success">{t('web.a02.cars.listed')}</Badge>
                      )}
                    </span>
                    <span className={styles['strong']}>{car.title}</span>
                    <span className={styles['muted']}>
                      {t('web.a02.cars.perDay', { amount: amount(ctx, car.perDayMinor) })}
                    </span>
                  </span>
                </div>
              </li>
              <li className={styles['card']}>
                <div className={styles['trip']}>
                  <span className={styles['tripMedia']}>
                    <CarIllustration
                      tone={market.host.otherCar.tone}
                      kind={market.host.otherCar.kind}
                    />
                  </span>
                  <span className={styles['stackTight']}>
                    <span className={styles['inline']}>
                      <Badge tone="warning">{t('web.a02.cars.inReview')}</Badge>
                    </span>
                    <span className={styles['strong']}>{market.host.otherCar.title}</span>
                    <a className={styles['link']} href={ctx.href('a10', { sel: 'review' })}>
                      {t('web.a02.cars.continue')}
                    </a>
                  </span>
                </div>
              </li>
            </ul>
            <ButtonLink variant="secondary" href={ctx.href('a10', { sel: 'vehicle' })}>
              <Icon name="plus" />
              {t('web.a02.cars.add')}
            </ButtonLink>
          </section>
        )}
        {state !== 'loading' && (
          <ul className={styles['rows']}>
            <Row
              icon="document"
              title={t('web.a11.title')}
              end={
                <a className={styles['link']} href={ctx.href('a11')}>
                  {t('web.a02.open')}
                </a>
              }
            />
            <Row
              icon="user"
              title={t('web.a13.title')}
              end={
                <a className={styles['link']} href={ctx.href('a13')}>
                  {t('web.a02.open')}
                </a>
              }
            />
          </ul>
        )}
      </main>
      <HostNav ctx={ctx} current="a02" />
    </>
  );
}

// ---------------------------------------------------------------- A05

const A05_TABS = ['upcoming', 'ongoing', 'past', 'cancelled'] as const;
type A05Tab = (typeof A05_TABS)[number];

const TRIPS_BY_TAB: Readonly<Record<A05Tab, readonly string[]>> = {
  upcoming: ['request', 'upcoming'],
  ongoing: [],
  past: ['past2', 'past1', 'hold'],
  cancelled: [],
};

function BookingCard({ ctx, trip }: { readonly ctx: ScreenContext; readonly trip: HostTrip }) {
  const { t } = ctx;
  const car = hostCar(ctx);
  const tone =
    trip.status === 'request' ? 'warning' : trip.status === 'upcoming' ? 'success' : 'neutral';
  return (
    <li className={styles['card']}>
      <div className={styles['between']}>
        <Badge tone={tone}>{t(`web.a05.status.${trip.status}`)}</Badge>
        <span className={styles['strong']}>
          {t('web.a05.earn', { amount: amount(ctx, trip.hostMinor) })}
        </span>
      </div>
      <GuestLine ctx={ctx} trip={trip} detail={`${car.title} · ${tripDates(ctx, trip)}`} />
      {trip.status === 'request' && (
        <ButtonLink href={ctx.href('a05', { state: 'request' })}>
          {t('web.a02.request.open')}
        </ButtonLink>
      )}
      {trip.status === 'upcoming' && (
        <div className={styles['twoCols']}>
          <ButtonLink variant="secondary" href={ctx.href('a03')}>
            {t('web.a02.next.start')}
          </ButtonLink>
          <ButtonLink variant="quiet" href={ctx.href('a05', { state: 'cancel' })}>
            {t('web.a05.cancel')}
          </ButtonLink>
        </div>
      )}
    </li>
  );
}

export function A05({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, market, state } = ctx;
  const tab: A05Tab = A05_TABS.find((x) => x === ctx.options.sel) ?? 'upcoming';
  const request = hostTrip(market, 'request');
  const next = hostTrip(market, 'upcoming');
  const car = hostCar(ctx);
  if (state === 'request' || state === 'cancel') {
    const trip = state === 'request' ? request : next;
    const guest = firstName(trip.guest);
    return (
      <>
        <AppHeader ctx={ctx} back={ctx.href('a05')} title={t('web.a05.title')} />
        <main className={styles['content']}>
          <section className={styles['card']} aria-labelledby="a05-detail">
            <div className={styles['tripMediaWide']}>
              <CarIllustration tone={car.carTone} kind={car.kind} />
            </div>
            <h1 id="a05-detail" className={styles['h2']}>
              {state === 'request'
                ? t('web.a05.request.title', { guest, car: car.title })
                : t('web.a05.cancel.title', { guest })}
            </h1>
            <GuestLine
              ctx={ctx}
              trip={trip}
              end={<Badge tone="success">{t('web.host.guest.verified')}</Badge>}
            />
            <ul className={styles['rows']}>
              <Row
                icon="calendar"
                title={tripDates(ctx, trip)}
                detail={t('web.a05.days', { count: trip.days })}
              />
              <Row
                icon="wallet"
                title={t('web.a05.earn', { amount: amount(ctx, trip.hostMinor) })}
                detail={t('web.a05.earn.body', { pct: market.host.sharePct })}
              />
            </ul>
          </section>
          {state === 'request' ? (
            <Banner tone="warning" icon="clock">
              {t('web.a02.request.until', { date: ctx.dateTime('requestUntil') })}
            </Banner>
          ) : (
            <form className={styles['stack']} action={ctx.href('a05').split('?')[0]} method="get">
              <fieldset className={styles['choices']}>
                <legend className={styles['strong']}>{t('web.a05.reason.legend')}</legend>
                {(['unavailable', 'damage', 'safety', 'other'] as const).map((r) => (
                  <label key={r} className={styles['choice']}>
                    <input
                      type="radio"
                      name="reason"
                      value={r}
                      defaultChecked={r === 'unavailable'}
                    />
                    <span className={styles['choiceBody']}>{t(`web.a05.reason.${r}`)}</span>
                    <span />
                  </label>
                ))}
              </fieldset>
              <Banner tone="danger" icon="alert" title={t('web.a05.cancel')}>
                {t('web.a05.cancelWarning', {
                  amount: amount(ctx, market.host.cancelPenaltyMinor),
                })}
              </Banner>
              <p className={styles['muted']}>{t('web.a05.cancel.review')}</p>
            </form>
          )}
        </main>
        <ActionBar>
          {state === 'request' ? (
            <div className={styles['twoCols']}>
              <ButtonLink variant="secondary" href={ctx.href('a05')}>
                {t('web.a05.decline')}
              </ButtonLink>
              <ButtonLink href={ctx.href('a02')}>{t('web.a05.accept')}</ButtonLink>
            </div>
          ) : (
            <div className={styles['twoCols']}>
              <ButtonLink variant="secondary" href={ctx.href('a05')}>
                {t('web.a05.cancel.keep')}
              </ButtonLink>
              <ButtonLink href={ctx.href('a05', { sel: 'cancelled' })}>
                {t('web.a05.cancel.confirm')}
              </ButtonLink>
            </div>
          )}
        </ActionBar>
      </>
    );
  }
  const trips = state === 'empty' ? [] : TRIPS_BY_TAB[tab].map((id) => hostTrip(market, id));
  return (
    <>
      <AppHeader ctx={ctx} title={t('web.a05.title')} />
      <main className={styles['content']}>
        <nav aria-label={t('web.a05.title')}>
          <ul className={styles['chips']}>
            {A05_TABS.map((id) => (
              <li key={id}>
                <a
                  className={styles['chip']}
                  href={ctx.href('a05', state === 'normal' ? { sel: id } : { state, sel: id })}
                  aria-current={id === tab ? 'true' : undefined}
                >
                  {t(`web.a05.tab.${id}`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {state === 'loading' && <LoadingBlock ctx={ctx} rows={3} />}
        {state === 'error' && (
          <ErrorBlock ctx={ctx} title={t('web.a05.error')} retry={ctx.href('a05')} />
        )}
        {(state === 'normal' || state === 'empty') &&
          (trips.length === 0 ? (
            <EmptyState icon="calendar" title={t('web.a05.empty')} body={t('web.a05.empty.body')} />
          ) : (
            <ul className={styles['stack']}>
              {trips.map((trip) => (
                <BookingCard key={trip.id} ctx={ctx} trip={trip} />
              ))}
            </ul>
          ))}
      </main>
      <HostNav ctx={ctx} current="a05" />
    </>
  );
}

// ---------------------------------------------------------------- A06

type DayKind = 'booked' | 'requested' | 'blocked' | 'open';

export function A06({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, market, state } = ctx;
  const cal = market.host.calendar;
  const car = hostCar(ctx);
  const [yearText = '2026', monthText = '12'] = cal.month.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Semaine commençant le lundi ; noms des jours par Intl (langue de la vue).
  const lead = (first.getUTCDay() + 6) % 7;
  const tag = ctx.i18n.profile.tag;
  const weekday = new Intl.DateTimeFormat(tag, { weekday: 'narrow', timeZone: 'UTC' });
  const weekdayLong = new Intl.DateTimeFormat(tag, { weekday: 'long', timeZone: 'UTC' });
  const monday = new Date(Date.UTC(year, month - 1, 1 + ((8 - first.getUTCDay()) % 7)));
  const heads = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.getTime() + i * 86_400_000);
    return { short: weekday.format(d), long: weekdayLong.format(d) };
  });
  const caption = new Intl.DateTimeFormat(tag, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(first);
  const empty = state === 'empty';
  const kindOf = (day: number): DayKind => {
    if (empty) return 'open';
    if (cal.booked.includes(day)) return 'booked';
    if (cal.requested.includes(day)) return 'requested';
    if (cal.blocked.includes(day)) return 'blocked';
    return 'open';
  };
  const cells: Array<number | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  const next = hostTrip(market, 'upcoming');
  return (
    <>
      <AppHeader ctx={ctx} title={t('web.a06.title')} />
      <main className={styles['content']}>
        <ul className={styles['chips']} aria-label={t('web.a02.cars.title')}>
          <li>
            <a className={styles['chip']} href={ctx.href('a06', { state })} aria-current="true">
              {car.title}
            </a>
          </li>
          <li>
            <a className={styles['chip']} href={ctx.href('a10', { sel: 'review' })}>
              {market.host.otherCar.title}
            </a>
          </li>
        </ul>
        {state === 'error' && (
          <Banner tone="danger" live="assertive" title={t('web.a06.conflict.title')}>
            {t('web.a06.conflict', {
              from: ctx.date('start'),
              to: ctx.date('end'),
              guest: firstName(next.guest),
            })}
          </Banner>
        )}
        {empty && (
          <EmptyState icon="calendar" title={t('web.a06.empty')} body={t('web.a06.empty.body')} />
        )}
        {state === 'loading' ? (
          <LoadingBlock ctx={ctx} rows={5} />
        ) : (
          <table className={styles['calendar']}>
            <caption className={styles['h3']}>{caption}</caption>
            <thead>
              <tr>
                {heads.map((h) => (
                  <th key={h.long} scope="col" abbr={h.long}>
                    {h.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, w) => (
                <tr key={w}>
                  {week.map((day, i) =>
                    day === null ? (
                      <td key={`x${i}`} />
                    ) : (
                      <td key={day} className={styles[`day_${kindOf(day)}`]}>
                        <span aria-hidden="true">{day}</span>
                        <span className={styles['visuallyHidden']}>
                          {`${day} · ${t(`web.a06.legend.${kindOf(day)}`)}`}
                        </span>
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ul className={styles['legend']} aria-label={t('web.a06.legend')}>
          {(['booked', 'requested', 'blocked', 'open'] as const).map((k) => (
            <li key={k}>
              <span className={cx(styles['legendSwatch'], styles[`day_${k}`])} aria-hidden="true" />
              {t(`web.a06.legend.${k}`)}
            </li>
          ))}
        </ul>
        <section className={styles['section']} aria-labelledby="a06-settings">
          <h2 id="a06-settings" className={styles['h3']}>
            {t('web.a06.settings')}
          </h2>
          <ul className={styles['rows']}>
            <Row icon="clock" title={t('web.a06.notice', { count: cal.noticeHours })} />
            <Row icon="route" title={t('web.a06.buffer', { count: cal.bufferHours })} />
            <Row
              icon="calendar"
              title={t('web.a06.duration', { min: cal.minDays, max: cal.maxDays })}
            />
            <Row
              icon="wallet"
              title={t('web.a06.price', { amount: amount(ctx, car.perDayMinor) })}
              end={
                <a className={styles['link']} href={ctx.href('a10', { sel: 'price' })}>
                  {t('web.a10.edit')}
                </a>
              }
            />
          </ul>
        </section>
      </main>
      <ActionBar>
        <ButtonLink block href={ctx.href('a06', { state: 'error' })}>
          <Icon name="lock" />
          {t('web.a06.block')}
        </ButtonLink>
      </ActionBar>
      <HostNav ctx={ctx} current="a06" />
    </>
  );
}

// ---------------------------------------------------------------- A08

const PAYOUT_TONE = { sent: 'success', scheduled: 'neutral', onHold: 'warning' } as const;

export function A08({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, market, state } = ctx;
  const off = state === 'payoutsOff';
  const done = market.host.trips.filter(
    (trip): trip is HostTrip & { status: 'sent' | 'scheduled' | 'onHold' } =>
      trip.status === 'sent' || trip.status === 'scheduled' || trip.status === 'onHold',
  );
  const scheduled = hostTrip(market, 'past2');
  const hold = hostTrip(market, 'hold');
  const status = (trip: (typeof done)[number]): string => {
    if (off) return t('web.a08.status.recorded');
    if (trip.status === 'onHold')
      return t('web.a08.status.onHold', { reason: t('web.a08.hold.reason') });
    return t(`web.a08.status.${trip.status}`);
  };
  const detail = (trip: (typeof done)[number]): string => {
    if (off || trip.status === 'onHold') return tripDates(ctx, trip);
    return trip.payout
      ? `${tripDates(ctx, trip)} · ${t('web.a08.payoutOn', { date: ctx.date(trip.payout) })}`
      : tripDates(ctx, trip);
  };
  return (
    <>
      <AppHeader ctx={ctx} title={t('web.a08.title')} />
      <main className={styles['content']}>
        {state === 'loading' && <LoadingBlock ctx={ctx} rows={4} />}
        {state === 'error' && (
          <ErrorBlock ctx={ctx} title={t('web.a08.error')} retry={ctx.href('a08')} />
        )}
        {state === 'empty' && (
          <EmptyState icon="wallet" title={t('web.a08.empty')} body={t('web.a08.empty.body')} />
        )}
        {(state === 'normal' || state === 'onHold' || off) && (
          <>
            <section
              className={cx(styles['card'], styles['cardPrimary'])}
              aria-labelledby="a08-month"
            >
              <p className={styles['kicker']}>
                {t('web.a02.earnings.title', { month: monthName(ctx) })}
              </p>
              <p id="a08-month" className={styles['earnAmount']}>
                {amount(ctx, market.host.monthEarningsMinor)}
              </p>
              <p className={styles['muted']}>{t('web.a08.plan', { pct: market.host.sharePct })}</p>
              {!off && (
                <p className={styles['payoutPill']}>
                  <Icon name="calendar" />
                  {t('web.a08.payoutOn', { date: ctx.date('payoutOn') })} ·{' '}
                  {amount(ctx, scheduled.hostMinor)}
                </p>
              )}
            </section>
            {off && (
              <Banner tone="info" icon="lock">
                {t('web.a08.payoutsOff', { country: ctx.country })}
              </Banner>
            )}
            {state === 'onHold' && (
              <Banner tone="warning" live="polite" title={t('web.a08.hold.title')}>
                {t('web.a08.hold.banner', {
                  amount: amount(ctx, hold.hostMinor),
                  guest: firstName(hold.guest),
                })}
              </Banner>
            )}
            <section className={styles['section']} aria-labelledby="a08-trips">
              <h2 id="a08-trips" className={styles['h3']}>
                {t('web.a08.trips')}
              </h2>
              <ul className={styles['rows']}>
                {done.map((trip) => (
                  <li key={trip.id} className={styles['payoutRow']}>
                    <Avatar name={trip.guest} tone={trip.guestTone} size="sm" />
                    <span className={styles['rowText']}>
                      <span className={styles['strong']}>{firstName(trip.guest)}</span>
                      <span className={styles['muted']}>{detail(trip)}</span>
                      <span>
                        <Badge tone={off ? 'neutral' : PAYOUT_TONE[trip.status]}>
                          {status(trip)}
                        </Badge>
                      </span>
                    </span>
                    <span className={styles['strong']}>{amount(ctx, trip.hostMinor)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <details className={styles['card']} open>
              <summary className={styles['detailsSummary']}>
                {t('web.a08.detail.title', { guest: firstName(scheduled.guest) })}
              </summary>
              <LegLines ctx={ctx} trip={scheduled} />
            </details>
            <ul className={styles['rows']}>
              <Row icon="info" title={t('web.a08.deductions.none')} />
              <Row
                icon="document"
                title={t('web.a08.statement.month', { month: monthName(ctx) })}
                end={
                  <a className={styles['link']} href={ctx.href('a08')}>
                    {t('web.a08.download')}
                  </a>
                }
              />
              <Row icon="document" title={t('web.a08.statement.year')} />
            </ul>
          </>
        )}
      </main>
      {state === 'onHold' && (
        <ActionBar>
          <ButtonLink block href={ctx.href('a09')}>
            {t('web.a08.hold.action')}
          </ButtonLink>
        </ActionBar>
      )}
      <HostNav ctx={ctx} current="a08" />
    </>
  );
}
