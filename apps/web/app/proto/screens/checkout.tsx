/**
 * S05 Checkout, S06 Redirection et attente du paiement, S07 Confirmation — 10b §4.1 (UX-20 à
 * UX-30), parcours 4.2.1. Le PSP est en `FAKE` : le prototype simule l'issue par un lien.
 */
import {
  Avatar,
  Banner,
  ButtonLink,
  CarIllustration,
  Checkbox,
  DepositBlock,
  ErrorState,
  Icon,
  LoadingState,
  Skeleton,
} from '@rueda/ui';
import type { ScreenContext } from '../context.ts';
import { featuredCar, money, planOf } from '../data/scenario.ts';
import type { PlanId } from '../data/scenario.ts';
import { ActionBar, AppHeader, BottomNav, Camino, MiniMap, Row, cx, styles } from '../shell.tsx';
import { planLines } from './car.tsx';
import { PlanChoices, PlanCta, PlanLines, PlanScope, PlanTotal } from './plan-picker.tsx';
import type { PlanView } from './plan-picker.tsx';
import { PriceLines } from './price-lines.tsx';
import type { PriceLineView } from './price-lines.tsx';

const PLAN_IDS: readonly PlanId[] = ['BASICA', 'ESTANDAR', 'TOTAL'];

function TripSummary({ ctx, exact }: { readonly ctx: ScreenContext; readonly exact?: boolean }) {
  const { t, market } = ctx;
  const car = featuredCar(market);
  return (
    <div className={styles['card']}>
      <div className={styles['trip']}>
        <span className={styles['tripMedia']}>
          <CarIllustration tone={car.carTone} kind={car.kind} />
        </span>
        <span className={styles['stackTight']}>
          <span className={styles['strong']}>{car.title}</span>
          <span className={styles['inline']}>
            <Avatar name={car.host.name} size="sm" tone={car.host.tone} decorative />
            <span className={styles['muted']}>{car.host.name}</span>
          </span>
        </span>
      </div>
      <div className={styles['timeline']}>
        <span className={styles['stackTight']}>
          <span className={styles['strong']}>{ctx.date('start')}</span>
          <span className={styles['muted']}>{ctx.time('start')}</span>
        </span>
        <span className={styles['timelineLine']} aria-hidden="true" />
        <span className={styles['stackTight']}>
          <span className={styles['strong']}>{ctx.date('end')}</span>
          <span className={styles['muted']}>{ctx.time('end')}</span>
        </span>
      </div>
      <p className={styles['muted']}>
        <Icon name="pin" />{' '}
        {exact
          ? market.featured.meetAddress
          : t('web.s05.meet', { place: market.featured.meetArea })}
      </p>
    </div>
  );
}

export function S05({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, i18n, market, state } = ctx;
  const car = featuredCar(market);
  const f = market.featured;
  const planId = PLAN_IDS.find((p) => p === ctx.options.sel) ?? 'BASICA';
  const request = state === 'request';
  const changed = state === 'priceChanged';
  const totalLabel = t('common.price.total');
  const caption = t('common.price.finalForDays', { count: market.days });
  const plans: PlanView[] = PLAN_IDS.map((id) => {
    const plan = planOf(market, id);
    const { lines, total } = planLines(ctx, id);
    return {
      id,
      name: t(`web.s05.plan.${id}`),
      badge: id === 'BASICA' ? t('web.s05.plan.required') : undefined,
      deductible: t('web.s05.plan.deductible', {
        amount: i18n.money(money(market, plan.deductibleMinor)),
      }),
      price: i18n.money(money(market, plan.priceMinor)),
      lines,
      total: i18n.money(total),
      cta: request ? t('web.s05.ctaRequest') : t('web.s05.cta', { amount: i18n.money(total) }),
    };
  });
  const c = f.changed;
  const changedLines: PriceLineView[] = [
    {
      id: 'rent',
      label: t('web.price.rent', { count: market.days }),
      amount: i18n.money(money(market, c.rentMinor)),
    },
    {
      id: 'tripFee',
      label: t('web.price.tripFee'),
      amount: i18n.money(money(market, c.tripFeeMinor)),
    },
    {
      id: 'protection',
      label: t('web.price.protection', { plan: t('web.s05.plan.BASICA') }),
      amount: i18n.money(money(market, c.protectionMinor)),
    },
    {
      id: 'tax',
      label: market.taxLabel[ctx.copy.language],
      amount: i18n.money(money(market, c.taxMinor)),
    },
  ];
  const changedTotal = i18n.money(money(market, c.totalMinor));
  return (
    <PlanScope plans={plans} initial={changed ? 'BASICA' : planId}>
      <AppHeader ctx={ctx} back={ctx.href('s03')} title={t('web.s05.title')} />
      <main className={styles['content']}>
        {state === 'error' ? (
          <ErrorState
            i18n={i18n}
            message={t('common.error.server', { code: f.errorCode })}
            code={f.errorCode}
            action={<ButtonLink href={ctx.href('s05')}>{t('web.common.retry')}</ButtonLink>}
          />
        ) : (
          <Banner tone="info" icon="clock">
            {t('web.s05.hold.until', { time: ctx.time('holdUntil') })}
          </Banner>
        )}
        {changed && (
          <Banner tone="warning" title={t('web.s05.priceChanged')} live="assertive">
            {t('web.s05.priceChangedBody', { amount: changedTotal })}
          </Banner>
        )}
        {state === 'deposit' && (
          <Banner tone="danger" live="assertive">
            {t('web.deposit.unavailable', { count: f.depositMaxDays })}
          </Banner>
        )}
        <section className={styles['section']} aria-labelledby="s05-trip">
          <h2 id="s05-trip" className={styles['h3']}>
            {t('web.s05.trip')}
          </h2>
          <TripSummary ctx={ctx} />
        </section>
        <section className={styles['section']} aria-labelledby="s05-driver">
          <h2 id="s05-driver" className={styles['h3']}>
            {t('web.s05.driver')}
          </h2>
          <ul className={styles['rows']}>
            <Row
              icon="user"
              title={market.guestName}
              detail={t('web.s05.driverVerified')}
              end={<Icon name="check" />}
            />
          </ul>
        </section>
        {!changed && (
          <PlanChoices
            legend={t('web.s05.protection.title')}
            plans={plans}
            note={`${t('web.s05.plan.by', { insurer: market.insurerName })} ${t('web.s05.plan.change')}`}
          />
        )}
        <section className={styles['section']} aria-labelledby="s05-price">
          <h2 id="s05-price" className={styles['h3']}>
            {t('common.price.details')}
          </h2>
          {state === 'loading' ? (
            <div className={styles['stackTight']} aria-busy="true">
              <p className={styles['muted']} role="status">
                {t('web.s05.recalc')}
              </p>
              <Skeleton width="long" />
              <Skeleton width="medium" />
              <Skeleton width="full" />
            </div>
          ) : changed ? (
            <PriceLines lines={changedLines} totalLabel={totalLabel} total={changedTotal} />
          ) : (
            <PlanLines totalLabel={totalLabel} />
          )}
        </section>
        <DepositBlock
          i18n={i18n}
          id="s05-deposit"
          amount={money(market, f.depositMinor)}
          merchantName={ctx.brand}
          hostName={car.host.name}
          releaseBy={{ instant: market.instants.releaseBy, timeZone: market.timeZone }}
          rail="preauth"
        />
        <Banner tone="info" icon="pin">
          {t('web.s05.zones', { country: ctx.country })}
        </Banner>
        <fieldset className={styles['choices']}>
          <legend className={styles['h3']}>{t('web.s05.consents')}</legend>
          {car.manual && <Checkbox id="s05-manual" label={t('web.s05.manual')} />}
          <Checkbox id="s05-contract" label={t('web.s05.contract', { host_name: car.host.name })} />
          <Checkbox id="s05-mit" label={t('web.s05.mitConsent')} />
          <Checkbox id="s05-whatsapp" label={t('web.s05.whatsapp')} />
        </fieldset>
        <p className={styles['muted']}>{t('web.s05.review.notice')}</p>
      </main>
      <ActionBar
        price={
          changed ? (
            <p className={styles['barPrice']}>
              <span className={styles['priceTotalAmount']}>{changedTotal}</span>
              <span className={styles['muted']}>{caption}</span>
            </p>
          ) : (
            <PlanTotal caption={caption} />
          )
        }
      >
        {state === 'deposit' ? (
          <ButtonLink variant="secondary" href={ctx.href('s01')}>
            {t('web.s02.empty.dates')}
          </ButtonLink>
        ) : changed ? (
          <ButtonLink href={ctx.href('s05')}>{t('web.s05.priceChangedAccept')}</ButtonLink>
        ) : (
          <PlanCta
            href={ctx.href(request ? 's07' : 's06', { state: request ? 'request' : 'normal' })}
          />
        )}
      </ActionBar>
    </PlanScope>
  );
}

export function S06({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, i18n, market, state } = ctx;
  const { total } = planLines(ctx, 'BASICA');
  return (
    <>
      <AppHeader
        ctx={ctx}
        back={state === 'normal' ? ctx.href('s05') : undefined}
        title={t('web.s06.title')}
      />
      <main className={styles['content']}>
        {state === 'normal' && (
          <div className={styles['stack']}>
            <div className={cx(styles['card'], styles['cardPrimary'])}>
              <p className={styles['kicker']}>
                {t('web.s06.pre.title', { merchant_name: ctx.brand })}
              </p>
              <p className={styles['display']}>{i18n.money(total)}</p>
              <p className={styles['muted']}>
                {t('web.s06.pre.leaving', { amount: i18n.money(total) })}
              </p>
            </div>
            <Banner tone="info" icon="clock">
              {t('web.s05.hold.until', { time: ctx.time('holdUntil') })}
            </Banner>
            <ul className={styles['rows']}>
              <Row
                icon="shield"
                title={t('web.s06.secure', { brand: ctx.brand })}
                detail={market.pspName}
              />
            </ul>
            <ButtonLink href={ctx.href('s06', { state: 'loading' })}>{t('web.s06.go')}</ButtonLink>
            <p className={styles['muted']}>{t('proto.fake.note')}</p>
          </div>
        )}
        {(state === 'loading' || state === 'slow') && (
          <div className={styles['stack']}>
            <h1 className={styles['h1']}>{t('web.s06.verifying.title')}</h1>
            <LoadingState i18n={i18n} label={t('web.s06.verifying.title')} />
            <p className={styles['text']} role="status">
              {t(state === 'slow' ? 'web.s06.verifying.slow' : 'web.s06.verifying.body')}
            </p>
            {state === 'slow' && (
              <ButtonLink variant="secondary" href={ctx.href('s17')}>
                {t('web.s06.support')}
              </ButtonLink>
            )}
            <ButtonLink variant="quiet" href={ctx.href('s07')}>
              {t('proto.fake.pay')}
            </ButtonLink>
          </div>
        )}
        {state === 'error' && (
          <div className={styles['stack']}>
            <Banner tone="danger" live="assertive">
              {t('web.error.paymentDeclined', { hold_end_time: ctx.time('holdUntil') })}
            </Banner>
            <ButtonLink href={ctx.href('s06', { state: 'loading' })}>
              {t('web.s06.payAgain')}
            </ButtonLink>
            <ButtonLink variant="quiet" href={ctx.href('s17')}>
              {t('web.s06.support')}
            </ButtonLink>
          </div>
        )}
      </main>
    </>
  );
}

export function S07({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, market, state } = ctx;
  const car = featuredCar(market);
  const f = market.featured;
  const request = state === 'request';
  if (state === 'error') {
    return (
      <>
        <AppHeader ctx={ctx} />
        <main className={styles['content']}>
          <Banner tone="warning" live="assertive">
            {t('web.error.requestExpired', { host_name: car.host.name })}
          </Banner>
          <ButtonLink href={ctx.href('s02')}>{t('web.search.submit')}</ButtonLink>
        </main>
        <BottomNav ctx={ctx} current="s08" />
      </>
    );
  }
  return (
    <>
      <AppHeader ctx={ctx} onPrimary />
      <section className={styles['joy']} aria-labelledby="s07-title">
        <Camino className={styles['joyCamino']} />
        <span className={styles['joyMark']} aria-hidden="true">
          <Icon name={request ? 'clock' : 'check'} />
        </span>
        <h1 id="s07-title" className={styles['joyTitle']}>
          {request ? t('web.s07.requestTitle') : t('web.s07.title')}
        </h1>
        <p className={styles['joyCode']}>{t('web.s07.number', { code: f.bookingCode })}</p>
      </section>
      {!request && (
        <section className={styles['ticket']} aria-labelledby="s07-recap">
          <h2 id="s07-recap" className={styles['kicker']}>
            {t('web.s07.recap')}
          </h2>
          <p className={styles['ticketDate']}>
            {ctx.date('start')} <span className={styles['ticketTime']}>{ctx.time('start')}</span>
          </p>
          <p className={styles['text']}>
            <Icon name="pin" /> {f.meetAddress}
          </p>
          <span className={styles['ticketCut']} aria-hidden="true" />
          <div className={styles['inline']}>
            <Avatar name={car.host.name} size="md" tone={car.host.tone} decorative />
            <span className={styles['stackTight']}>
              <span className={styles['muted']}>{t('web.s07.recap.host')}</span>
              <span className={styles['strong']}>{car.host.name}</span>
            </span>
          </div>
        </section>
      )}
      <main className={styles['content']}>
        {request ? (
          <Banner tone="info" icon="clock" live="polite">
            {t('web.s07.request.pending', {
              host_name: car.host.name,
              time: ctx.time('requestUntil'),
            })}
          </Banner>
        ) : null}
        {request && <TripSummary ctx={ctx} />}
        {!request && (
          <section className={styles['section']} aria-labelledby="s07-meet">
            <h2 id="s07-meet" className={styles['h3']}>
              {t('web.s07.address')}
            </h2>
            <MiniMap label={f.meetAddress} />
            <ul className={styles['rows']}>
              <Row icon="clock" title={t('web.s07.when', { date: ctx.dateTime('start') })} />
              <Row icon="document" title={t('web.s07.bring', { host_name: car.host.name })} />
              <Row
                icon="camera"
                title={t('web.s07.checkinOpens', { date: ctx.date('checkinOpens') })}
              />
            </ul>
          </section>
        )}
        <ButtonLink variant={request ? 'secondary' : 'primary'} href={ctx.href('s09')}>
          <Icon name="chat" />
          {t('web.s07.message', { host_name: car.host.name })}
        </ButtonLink>
        {!request && (
          <Banner tone="info" icon="shield">
            {t('web.s07.safety', { brand: ctx.brand })}
          </Banner>
        )}
        <div className={styles['twoCols']}>
          <ButtonLink variant="secondary" size="sm" href={ctx.href('s07', { state })}>
            <Icon name="calendar" />
            {t('web.s07.calendar')}
          </ButtonLink>
          <ButtonLink variant="secondary" size="sm" href={ctx.href('s07', { state })}>
            <Icon name="document" />
            {t('web.s07.receipt')}
          </ButtonLink>
        </div>
        <div className={cx(styles['card'], styles['cardAccent'])}>
          <p className={styles['text']}>{t('web.s07.install', { brand: ctx.brand })}</p>
        </div>
        <ButtonLink variant="quiet" href={ctx.href('s08')}>
          {t('web.s07.trips')}
        </ButtonLink>
      </main>
      <BottomNav ctx={ctx} current="s08" />
    </>
  );
}
