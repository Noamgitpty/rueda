/**
 * S08 Mes voyages, S09 Détail du trip, S09 · check-in photo — 10b §4.1, §4.1 bis, parcours 4.2.4.
 */
import {
  Badge,
  Banner,
  ButtonLink,
  CarIllustration,
  Checkbox,
  EmptyState,
  Icon,
  PhotoSlot,
  Skeleton,
} from '@rueda/ui';
import type { PhotoSlotState } from '@rueda/ui';
import type { MessageKey } from '@rueda/i18n';
import type { ScreenContext } from '../context.ts';
import { carOf, featuredCar, money, planOf } from '../data/scenario.ts';
import type { ProtoCar } from '../data/scenario.ts';
import { ActionBar, AppHeader, BottomNav, MiniMap, Row, cx, styles } from '../shell.tsx';

function TripCard({
  ctx,
  car,
  when,
  status,
  done,
  href,
}: {
  readonly ctx: ScreenContext;
  readonly car: ProtoCar;
  readonly when: string;
  readonly status: string;
  readonly done?: boolean;
  readonly href: string;
}) {
  return (
    <li className={styles['card']}>
      <div className={styles['trip']}>
        <span className={styles['tripMedia']}>
          <CarIllustration tone={car.carTone} />
        </span>
        <span className={styles['stackTight']}>
          <span className={styles['inline']}>
            <Badge tone={done ? 'neutral' : 'success'}>{status}</Badge>
          </span>
          <span className={styles['strong']}>{car.title}</span>
          <span className={styles['muted']}>
            {car.host.name} · {when}
          </span>
        </span>
      </div>
      <ButtonLink variant={done ? 'secondary' : 'primary'} href={href}>
        {ctx.t('web.s08.open')}
      </ButtonLink>
    </li>
  );
}

export function S08({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, market, state } = ctx;
  const tab = ctx.options.sel === 'past' ? 'past' : 'upcoming';
  const car = featuredCar(market);
  const past = carOf(market, market.pastTrip.carId);
  return (
    <>
      <AppHeader ctx={ctx} />
      {state === 'offline' && (
        <Banner tone="warning" icon="offline">
          {t('common.offline.banner')}
        </Banner>
      )}
      <main className={styles['content']}>
        <h1 className={styles['h1']}>{t('web.s08.title')}</h1>
        <nav aria-label={t('web.s08.title')}>
          <ul className={styles['segments']}>
            {(['upcoming', 'past'] as const).map((id) => (
              <li key={id}>
                <a
                  className={styles['tab']}
                  href={ctx.href('s08', { state, sel: id })}
                  aria-current={id === tab ? 'true' : undefined}
                >
                  {t(`web.s08.tabs.${id}`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {state === 'empty' && (
          <EmptyState
            title={t('web.s08.empty')}
            action={<ButtonLink href={ctx.href('s01')}>{t('web.s08.search')}</ButtonLink>}
          />
        )}
        {state === 'loading' && (
          <div className={styles['stack']} aria-busy="true">
            <Skeleton shape="block" />
            <Skeleton shape="block" />
          </div>
        )}
        {state === 'error' && (
          <Banner tone="danger" title={t('web.s08.error')} live="assertive">
            {t('common.offline.banner')}
          </Banner>
        )}
        {state === 'error' && (
          <ButtonLink variant="secondary" href={ctx.href('s08')}>
            {t('web.common.retry')}
          </ButtonLink>
        )}
        {(state === 'normal' || state === 'offline' || state === 'error') && (
          <ul className={styles['stack']}>
            {tab === 'upcoming' ? (
              <TripCard
                ctx={ctx}
                car={car}
                when={`${ctx.date('start')} – ${ctx.date('end')}`}
                status={t('web.s08.status.confirmed')}
                href={ctx.href('s09')}
              />
            ) : (
              <TripCard
                ctx={ctx}
                car={past}
                when={`${ctx.date('pastStart')} – ${ctx.date('pastEnd')}`}
                status={t('web.s08.status.done')}
                done
                href={ctx.href('s09')}
              />
            )}
          </ul>
        )}
      </main>
      <BottomNav ctx={ctx} current="s08" />
    </>
  );
}

export function S09({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, i18n, market, state } = ctx;
  const car = featuredCar(market);
  const f = market.featured;
  const total = money(market, planOf(market, 'BASICA').totalMinor);
  return (
    <>
      <AppHeader
        ctx={ctx}
        back={ctx.href('s08')}
        title={t('web.s09.title', { host_name: car.host.name })}
      />
      {state === 'offline' && (
        <Banner tone="warning" icon="offline">
          {t('common.offline.banner')}
        </Banner>
      )}
      <main className={styles['content']}>
        {state === 'hostNoShow' && (
          <div className={styles['stack']}>
            <Banner tone="danger" live="assertive">
              {t('web.error.hostNoShow', { host_name: car.host.name })}
            </Banner>
            <div className={styles['twoCols']}>
              <ButtonLink href={ctx.href('s08', { state: 'empty' })}>
                {t('web.s09.hostNoShow.cancel')}
              </ButtonLink>
              <ButtonLink variant="secondary" href={ctx.href('s09')}>
                {t('web.s09.hostNoShow.wait')}
              </ButtonLink>
            </div>
          </div>
        )}
        {state === 'late' && (
          <Banner tone="success" live="polite">
            {t('web.s09.lateDone', { host_name: car.host.name })}
          </Banner>
        )}
        <div className={cx(styles['card'], styles['cardPrimary'])}>
          <p className={styles['kicker']}>{t('web.s09.when', { date: ctx.dateTime('start') })}</p>
          <p className={styles['h2']}>{car.title}</p>
          <p className={styles['muted']}>{t('web.s07.number', { code: f.bookingCode })}</p>
        </div>
        {state === 'loading' ? (
          <div className={styles['stack']} aria-busy="true">
            <Skeleton shape="block" />
            <Skeleton width="long" />
            <Skeleton width="medium" />
          </div>
        ) : (
          <>
            <section className={styles['section']} aria-labelledby="s09-meet">
              <h2 id="s09-meet" className={styles['h3']}>
                {t('web.s09.meet')}
              </h2>
              <MiniMap label={f.meetAddress} />
            </section>
            <ul className={styles['rows']}>
              <Row icon="chat" title={t('web.s07.message', { host_name: car.host.name })} />
              <Row icon="document" title={t('web.s09.docs')} detail={t('web.s09.docs.body')} />
              <Row icon="document" title={t('web.s09.contract')} />
              <Row
                icon="shield"
                title={t('web.s09.payment')}
                detail={t('web.s09.paid', { amount: i18n.money(total) })}
              />
              <Row
                icon="key"
                title={t('web.s09.deposit.title')}
                detail={t('web.deposit.releaseBy', { date: ctx.date('releaseBy') })}
              />
            </ul>
            <section className={styles['emergency']} aria-labelledby="s09-emergency">
              <h2 id="s09-emergency" className={styles['h3']}>
                {t('web.s09.emergency')}
              </h2>
              <a className={styles['bigNumber']} href={`tel:${market.phones.emergency}`}>
                {t('web.s17.emergencyNumber', { number: market.phones.emergency })}
                <Icon name="phone" />
              </a>
              <a className={styles['bigNumber']} href={`tel:${market.phones.roadside}`}>
                {t('web.s17.roadside', { insurer: market.insurerName })}
                <Icon name="phone" />
              </a>
            </section>
            <div className={styles['actions']}>
              <ButtonLink variant="secondary" href={ctx.href('s09', { state: 'late' })}>
                <Icon name="clock" />
                {t('web.s09.lateButton')}
              </ButtonLink>
              <ButtonLink variant="quiet" href={ctx.href('s17')}>
                {t('web.s09.refuse')}
              </ButtonLink>
              <ButtonLink variant="quiet" href={ctx.href('s17')}>
                {t('web.s09.report')}
              </ButtonLink>
              <ButtonLink variant="quiet" href={ctx.href('s17')}>
                {t('web.s09.cancel')}
              </ButtonLink>
            </div>
          </>
        )}
      </main>
      <ActionBar>
        <ButtonLink block href={ctx.href('s09c')}>
          <Icon name="camera" />
          {t('web.s09.checkin')}
        </ButtonLink>
      </ActionBar>
    </>
  );
}

const SLOTS: ReadonlyArray<{ readonly key: MessageKey; readonly zone: 'ext' | 'int' }> = [
  { key: 'web.photo.angle.extFront.label', zone: 'ext' },
  { key: 'web.photo.angle.extFront34Driver.label', zone: 'ext' },
  { key: 'web.photo.angle.extProfileDriver.label', zone: 'ext' },
  { key: 'web.photo.angle.extRear.label', zone: 'ext' },
  { key: 'web.photo.angle.intDashboard.label', zone: 'int' },
  { key: 'web.photo.angle.intFrontSeats.label', zone: 'int' },
  { key: 'web.photo.angle.gaugeFuel.label', zone: 'int' },
  { key: 'web.photo.angle.gaugeOdometer.label', zone: 'int' },
];

/** 15 extérieures + 8 intérieures + carburant + compteur (10b S09 · check-in, UX-07). */
const HANDOVER_TOTAL = 25;

function slotState(state: string, index: number): PhotoSlotState {
  if (state === 'done') return 'uploaded';
  if (state === 'offline') return index < 5 ? 'saved' : 'empty';
  if (state === 'loading') return index < 3 ? 'uploaded' : index < 5 ? 'uploading' : 'empty';
  if (state === 'error') return index < 3 ? 'uploaded' : index === 3 ? 'failed' : 'empty';
  return index < 4 ? 'uploaded' : index === 4 ? 'saved' : 'empty';
}

export function S09c({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, i18n, state } = ctx;
  const done =
    state === 'done' ? HANDOVER_TOTAL : state === 'offline' ? 5 : state === 'loading' ? 5 : 4;
  return (
    <>
      <AppHeader ctx={ctx} back={ctx.href('s09')} title={t('web.s09c.title')} />
      <main className={styles['content']}>
        {state === 'done' ? (
          <div className={styles['stack']}>
            <span className={styles['successMark']} aria-hidden="true">
              <Icon name="check" />
            </span>
            <h1 className={styles['h1']}>{t('web.s09c.done')}</h1>
            <ButtonLink href={ctx.href('s09')}>{t('web.common.continue')}</ButtonLink>
          </div>
        ) : (
          <p className={styles['text']}>{t('web.s09c.intro')}</p>
        )}
        {state === 'offline' && (
          <Banner tone="warning" icon="offline" live="polite">
            {t('web.error.offlinePhotos')}
          </Banner>
        )}
        {state === 'error' && (
          <Banner tone="warning" live="assertive">
            {t('web.s09c.blurry')}
          </Banner>
        )}
        <div className={styles['stackTight']}>
          <label className={styles['strong']} htmlFor="s09c-progress">
            {t('web.s09c.progress', { done, total: HANDOVER_TOTAL })}
          </label>
          <progress
            id="s09c-progress"
            className={styles['range']}
            max={HANDOVER_TOTAL}
            value={done}
          />
        </div>
        {(['ext', 'int'] as const).map((zone) => (
          <section key={zone} className={styles['section']} aria-labelledby={`s09c-${zone}`}>
            <h2 id={`s09c-${zone}`} className={styles['h3']}>
              {t(zone === 'ext' ? 'web.s09c.exterior' : 'web.s09c.interior')}
            </h2>
            <div className={styles['photoGrid']}>
              {SLOTS.map((slot, index) =>
                slot.zone === zone ? (
                  <PhotoSlot
                    key={slot.key}
                    i18n={i18n}
                    angle={t(slot.key)}
                    state={slotState(state, index)}
                  />
                ) : null,
              )}
            </div>
          </section>
        ))}
        {state === 'offline' && (
          <p className={styles['muted']}>{t('web.checkin.queue.savedOnDevice')}</p>
        )}
        <Checkbox id="s09c-board" label={t('web.s09c.board')} />
      </main>
      {state !== 'done' && (
        <ActionBar>
          <ButtonLink block href={ctx.href('s09c', { state: 'done' })}>
            {t('web.s09c.finish')}
          </ButtonLink>
        </ActionBar>
      )}
    </>
  );
}
