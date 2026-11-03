/**
 * S05 Checkout, S06 Redirection et attente du paiement, S07 Confirmation — 10b §4.1 (UX-20 à
 * UX-30), parcours 4.2.1. Le PSP est en `FAKE` : le prototype simule l'issue par un lien.
 */
import {
  Avatar,
  Banner,
  Button,
  ButtonLink,
  CarIllustration,
  Checkbox,
  DepositBlock,
  ErrorState,
  Icon,
  LoadingState,
  Price,
  PriceBreakdown,
  Skeleton,
} from '@rueda/ui';
import type { ScreenContext } from '../context.ts';
import { featuredCar, money, planOf } from '../data/scenario.ts';
import type { PlanId } from '../data/scenario.ts';
import {
  ActionBar,
  AppHeader,
  BottomNav,
  HiddenContext,
  MiniMap,
  Row,
  cx,
  styles,
} from '../shell.tsx';
import { priceLines } from './car.tsx';

const PLAN_IDS: readonly PlanId[] = ['BASICA', 'ESTANDAR', 'TOTAL'];

function TripSummary({ ctx, exact }: { readonly ctx: ScreenContext; readonly exact?: boolean }) {
  const { t, market } = ctx;
  const car = featuredCar(market);
  return (
    <div className={styles['card']}>
      <div className={styles['trip']}>
        <span className={styles['tripMedia']}>
          <CarIllustration tone={car.carTone} />
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
  const { lines, total } = priceLines(ctx, planId);
  const request = state === 'request';
  const changed = money(market, f.changedTotalMinor);
  const cta = request ? t('web.s05.ctaRequest') : t('web.s05.cta', { amount: i18n.money(total) });
  return (
    <>
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
        {state === 'priceChanged' && (
          <Banner tone="warning" title={t('web.s05.priceChanged')} live="assertive">
            {t('web.s05.priceChangedBody', { amount: i18n.money(changed) })}
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
        <form
          className={styles['section']}
          action={ctx.href('s05').split('?')[0]}
          method="get"
          aria-labelledby="s05-protection"
        >
          <HiddenContext ctx={ctx} />
          {state !== 'normal' && <input type="hidden" name="state" value={state} />}
          <fieldset className={styles['choices']}>
            <legend id="s05-protection" className={styles['h3']}>
              {t('web.s05.protection.title')}
            </legend>
            {PLAN_IDS.map((id) => {
              const plan = planOf(market, id);
              return (
                <label key={id} className={styles['choice']}>
                  <input type="radio" name="sel" value={id} defaultChecked={id === planId} />
                  <span className={styles['choiceBody']}>
                    <span className={styles['strong']}>{t(`web.s05.plan.${id}`)}</span>
                    <span className={styles['muted']}>
                      {t('web.s05.plan.deductible', {
                        amount: i18n.money(money(market, plan.deductibleMinor)),
                      })}
                    </span>
                  </span>
                  <span className={styles['strong']}>
                    {id === 'BASICA'
                      ? t('web.s05.plan.included')
                      : i18n.money(money(market, plan.priceMinor))}
                  </span>
                </label>
              );
            })}
          </fieldset>
          <p className={styles['muted']}>{t('web.s05.plan.by', { insurer: market.insurerName })}</p>
          <Button type="submit" variant="secondary" size="sm">
            {t('web.s05.plan.apply')}
          </Button>
        </form>
        <section className={styles['section']} aria-labelledby="s05-price">
          <h2 id="s05-price" className={styles['visuallyHidden']}>
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
          ) : (
            <PriceBreakdown
              i18n={i18n}
              lines={lines}
              total={state === 'priceChanged' ? changed : total}
              open
            />
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
          <Price
            i18n={i18n}
            total={state === 'priceChanged' ? changed : total}
            days={market.days}
            live
          />
        }
      >
        {state === 'deposit' ? (
          <ButtonLink variant="secondary" href={ctx.href('s01')}>
            {t('web.s02.empty.dates')}
          </ButtonLink>
        ) : (
          <ButtonLink
            href={ctx.href(request ? 's07' : 's06', { state: request ? 'request' : 'normal' })}
          >
            {cta}
          </ButtonLink>
        )}
      </ActionBar>
    </>
  );
}

export function S06({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, i18n, market, state } = ctx;
  const { total } = priceLines(ctx, 'BASICA');
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
      <section className={styles['success']} aria-labelledby="s07-title">
        <span className={styles['successMark']} aria-hidden="true">
          <Icon name={request ? 'clock' : 'check'} />
        </span>
        <h1 id="s07-title" className={styles['display']}>
          {request ? t('web.s07.requestTitle') : t('web.s07.title')}
        </h1>
        <p className={styles['heroSubtitle']}>{t('web.s07.number', { code: f.bookingCode })}</p>
      </section>
      <main className={styles['content']}>
        {request ? (
          <Banner tone="info" icon="clock" live="polite">
            {t('web.s07.request.pending', {
              host_name: car.host.name,
              time: ctx.time('requestUntil'),
            })}
          </Banner>
        ) : null}
        <TripSummary ctx={ctx} exact={!request} />
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
