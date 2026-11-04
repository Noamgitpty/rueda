/**
 * Le trip vu par l'hôte : A03 remise (UX-41, §4.1 bis « refus de remise »), A04 retour (UX-42),
 * A12 avis sur le voyageur (BR-REVIEW-02 à 04), A09 dossier de dommage (NOUVELLE-18, §4.2.6).
 * Photos de remise : gabarit d'angles d'US-031 (`packages/design-tokens/rules/photo.rules.json`).
 */
import { Badge, Banner, ButtonLink, Checkbox, Icon, PhotoSlot, Steps } from '@rueda/ui';
import type { PhotoSlotState } from '@rueda/ui';
import { PHOTO_RULES, angleKeyOf } from '@rueda/design-tokens';
import type { MessageKey } from '@rueda/i18n';
import type { ScreenContext } from '../context.ts';
import { hostTrip } from '../data/scenario.ts';
import { ActionBar, AppHeader, Camino, MiniMap, Row, cx, styles } from '../shell.tsx';
import { GuestLine, LoadingBlock, amount, firstName, hostCar, tripDates } from './host-kit.tsx';

const angleLabel = (ctx: ScreenContext, code: string): string =>
  ctx.t(`web.photo.angle.${angleKeyOf(code)}.label` as MessageKey);

/** Emplacements de la remise (US-031) : 15 extérieures, 8 intérieures, carburant, compteur. */
const HANDOVER = PHOTO_RULES.handover.slots;

// ---------------------------------------------------------------- A03

const A03_STEPS = ['arrival', 'license', 'photos', 'keys'] as const;
const A03_STEP_OF: Readonly<Record<string, number>> = {
  normal: 0,
  error: 0,
  license: 1,
  refuse: 1,
  photos: 2,
  loading: 2,
  keys: 3,
  done: 3,
};
const LICENSE_CHECKS = [
  'face',
  'name',
  'birthYear',
  'valid',
  'provisional',
  'restrictions',
] as const;

function handoverState(state: string, index: number): PhotoSlotState {
  if (state === 'keys' || state === 'done') return 'uploaded';
  if (state === 'loading') return index < 6 ? 'uploaded' : index < 8 ? 'uploading' : 'empty';
  return index < 5 ? 'uploaded' : index === 5 ? 'saved' : 'empty';
}

export function A03({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, i18n, market, state } = ctx;
  const trip = hostTrip(market, 'upcoming');
  const guest = firstName(trip.guest);
  const car = hostCar(ctx);
  const step = A03_STEP_OF[state] ?? 0;
  if (state === 'done') {
    return (
      <>
        <AppHeader ctx={ctx} back={ctx.href('a02')} title={t('web.a03.title', { guest })} />
        <section className={styles['joy']} aria-labelledby="a03-done">
          <Camino className={styles['joyCamino']} />
          <span className={styles['joyMark']} aria-hidden="true">
            <Icon name="key" />
          </span>
          <h1 id="a03-done" className={styles['joyTitle']}>
            {t('web.a03.done', { guest })}
          </h1>
          <p className={styles['text']}>
            {t('web.a03.done.return', { date: ctx.dateTime('end') })}
          </p>
        </section>
        <main className={styles['content']}>
          <ul className={styles['rows']}>
            <Row icon="camera" title={t('web.a03.done.photos', { count: HANDOVER.length })} />
            <Row icon="phone" title={t('web.s17.roadside', { insurer: market.insurerName })} />
          </ul>
        </main>
        <ActionBar>
          <ButtonLink block href={ctx.href('a02')}>
            {t('web.common.continue')}
          </ButtonLink>
        </ActionBar>
      </>
    );
  }
  const done = HANDOVER.filter((_, i) => handoverState(state, i) === 'uploaded').length;
  return (
    <>
      <AppHeader ctx={ctx} back={ctx.href('a02')} title={t('web.a03.title', { guest })} />
      <main className={styles['content']}>
        <Steps
          i18n={i18n}
          steps={A03_STEPS.map((s) => t(`web.a03.step.${s}`))}
          current={step}
          label={t('web.a03.title', { guest })}
        />
        {state === 'error' && (
          <Banner tone="danger" live="assertive" title={t('web.a03.blocked.title')}>
            {t('web.a03.blocked', { guest })}
          </Banner>
        )}
        {(state === 'normal' || state === 'error') && (
          <>
            <GuestLine
              ctx={ctx}
              trip={trip}
              detail={ctx.dateTime('start')}
              end={<Badge tone="success">{t('web.host.guest.verified')}</Badge>}
            />
            <MiniMap label={market.featured.meetAddress} />
            <p className={styles['muted']}>{t('web.a03.arrival.body', { guest })}</p>
          </>
        )}
        {(state === 'license' || state === 'refuse') && (
          <fieldset className={styles['choices']}>
            <legend className={styles['text']}>{t('web.a03.license.intro', { guest })}</legend>
            {LICENSE_CHECKS.map((c, i) => (
              <Checkbox
                key={c}
                id={`a03-${c}`}
                label={t(`web.a03.check.${c}`)}
                defaultChecked={state === 'license' || i !== 3}
              />
            ))}
          </fieldset>
        )}
        {state === 'refuse' && (
          <section
            className={cx(styles['card'], styles['refuseCard'])}
            aria-labelledby="a03-refuse"
          >
            <h2 id="a03-refuse" className={styles['h3']}>
              {t('web.a03.refuse')}
            </h2>
            <fieldset className={styles['choices']}>
              <legend className={styles['strong']}>{t('web.a05.reason.legend')}</legend>
              {(['license', 'identity', 'other'] as const).map((r) => (
                <label key={r} className={styles['choice']}>
                  <input type="radio" name="refuse" value={r} defaultChecked={r === 'license'} />
                  <span className={styles['choiceBody']}>{t(`web.a03.refuse.reason.${r}`)}</span>
                  <span />
                </label>
              ))}
            </fieldset>
            <Banner tone="info" icon="shield">
              {t('web.a03.refuse.ops', { brand: ctx.brand })}
            </Banner>
          </section>
        )}
        {(state === 'photos' || state === 'loading') && (
          <>
            <p className={styles['text']}>{t('web.a03.photos.intro', { guest })}</p>
            <div className={styles['stackTight']}>
              <label className={styles['strong']} htmlFor="a03-progress">
                {t('web.s09c.progress', { done, total: HANDOVER.length })}
              </label>
              <progress
                id="a03-progress"
                className={styles['range']}
                max={HANDOVER.length}
                value={done}
              />
            </div>
            {state === 'loading' && (
              <p className={styles['muted']} role="status">
                {t('web.a03.photos.sending')}
              </p>
            )}
            <div className={styles['photoGrid']}>
              {HANDOVER.slice(0, 8).map((slot, i) => (
                <PhotoSlot
                  key={slot.slotCode}
                  i18n={i18n}
                  angle={angleLabel(ctx, slot.angle.code)}
                  state={handoverState(state, i)}
                />
              ))}
            </div>
            <p className={styles['muted']}>
              {t('web.a03.photos.more', { count: HANDOVER.length - 8 })}
            </p>
          </>
        )}
        {state === 'keys' && (
          <>
            <h1 className={styles['h2']}>{t('web.a03.keys.title')}</h1>
            <ul className={styles['rows']}>
              <Row icon="check" title={t('web.a03.keys.license')} />
              <Row icon="check" title={t('web.a03.keys.photos', { count: done })} />
              <Row icon="fuel" title={t('web.a03.keys.fuel')} />
              <Row icon="car" title={car.title} detail={tripDates(ctx, trip)} />
            </ul>
          </>
        )}
      </main>
      <ActionBar>
        {state === 'normal' && (
          <ButtonLink block href={ctx.href('a03', { state: 'license' })}>
            <Icon name="pin" />
            {t('web.a03.arrived')}
          </ButtonLink>
        )}
        {state === 'error' && (
          <ButtonLink block variant="secondary" href={ctx.href('s17')}>
            <Icon name="phone" />
            {t('web.a03.blocked.support')}
          </ButtonLink>
        )}
        {state === 'license' && (
          <div className={styles['twoCols']}>
            <ButtonLink variant="secondary" href={ctx.href('a03', { state: 'refuse' })}>
              {t('web.a03.refuse')}
            </ButtonLink>
            <ButtonLink href={ctx.href('a03', { state: 'photos' })}>
              {t('web.common.continue')}
            </ButtonLink>
          </div>
        )}
        {state === 'refuse' && (
          <div className={styles['twoCols']}>
            <ButtonLink variant="secondary" href={ctx.href('a03', { state: 'license' })}>
              {t('web.a03.refuse.back')}
            </ButtonLink>
            <ButtonLink href={ctx.href('o01', { state: 'item' })}>
              {t('web.a03.refuse.confirm')}
            </ButtonLink>
          </div>
        )}
        {(state === 'photos' || state === 'loading') && (
          <ButtonLink block href={ctx.href('a03', { state: 'keys' })}>
            {t('web.common.continue')}
          </ButtonLink>
        )}
        {state === 'keys' && (
          <ButtonLink block href={ctx.href('a03', { state: 'done' })}>
            <Icon name="key" />
            {t('web.a03.handover')}
          </ButtonLink>
        )}
      </ActionBar>
    </>
  );
}

// ---------------------------------------------------------------- A04

const COMPARE = ['EXT_FRONT_34_DRIVER', 'EXT_REAR_34_PASSENGER', 'INT_DASHBOARD'] as const;

export function A04({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, i18n, market, state } = ctx;
  const trip = hostTrip(market, 'upcoming');
  const guest = firstName(trip.guest);
  const r = market.host.return;
  const f = market.featured;
  if (state === 'done') {
    return (
      <>
        <AppHeader ctx={ctx} back={ctx.href('a02')} title={t('web.a04.title', { guest })} />
        <section className={styles['joy']} aria-labelledby="a04-done">
          <Camino className={styles['joyCamino']} />
          <span className={styles['joyMark']} aria-hidden="true">
            <Icon name="check" />
          </span>
          <h1 id="a04-done" className={styles['joyTitle']}>
            {t('web.a04.done')}
          </h1>
          <p className={styles['text']}>
            {t('web.a04.done.body', { amount: amount(ctx, trip.hostMinor) })}
          </p>
        </section>
        <main className={styles['content']}>
          <Banner tone="info" icon="calendar">
            {t('web.a04.claimUntil', { date: ctx.dateTime('claimUntil') })}
          </Banner>
        </main>
        <ActionBar>
          <ButtonLink block href={ctx.href('a12')}>
            <Icon name="star" />
            {t('web.a04.review', { guest })}
          </ButtonLink>
        </ActionBar>
      </>
    );
  }
  const fee = state === 'fee' || state === 'error';
  return (
    <>
      <AppHeader ctx={ctx} back={ctx.href('a02')} title={t('web.a04.title', { guest })} />
      <main className={styles['content']}>
        {state === 'loading' && <LoadingBlock ctx={ctx} rows={4} />}
        {!fee && state !== 'loading' && (
          <>
            <section className={styles['section']} aria-labelledby="a04-compare">
              <h1 id="a04-compare" className={styles['h2']}>
                {t('web.a04.compare')}
              </h1>
              <div className={styles['compareHead']} aria-hidden="true">
                <span className={styles['muted']}>{t('web.a04.out')}</span>
                <span className={styles['muted']}>{t('web.a04.in')}</span>
              </div>
              {COMPARE.map((code) => (
                <div key={code} className={styles['compareRow']}>
                  <PhotoSlot
                    i18n={i18n}
                    angle={`${angleLabel(ctx, code)} · ${t('web.a04.out')}`}
                    state="uploaded"
                  />
                  <PhotoSlot
                    i18n={i18n}
                    angle={`${angleLabel(ctx, code)} · ${t('web.a04.in')}`}
                    state="uploaded"
                  />
                </div>
              ))}
            </section>
            <ul className={styles['rows']}>
              <Row
                icon="fuel"
                title={t('web.a04.fuel')}
                detail={t('web.a04.fuel.levels', {
                  out: t(`web.a04.fuel.${r.fuelOut}`),
                  in: t(`web.a04.fuel.${r.fuelIn}`),
                })}
              />
              <Row
                icon="route"
                title={t('web.a04.odometer', { count: r.odometerKm })}
                detail={t('web.a04.km.allowance', { count: f.kmPerDay * trip.days })}
              />
            </ul>
            <Banner tone="info" icon="calendar">
              {t('web.a04.claimUntil', { date: ctx.dateTime('claimUntil') })}
            </Banner>
            <div className={styles['actions']}>
              <ButtonLink variant="secondary" href={ctx.href('a04', { state: 'fee' })}>
                <Icon name="plus" />
                {t('web.a04.addFee')}
              </ButtonLink>
              <ButtonLink variant="quiet" href={ctx.href('a09')}>
                <Icon name="flag" />
                {t('web.a04.damage')}
              </ButtonLink>
            </div>
          </>
        )}
        {fee && (
          <form className={styles['stack']} action={ctx.href('a04').split('?')[0]} method="get">
            <h1 className={styles['h2']}>{t('web.a04.addFee')}</h1>
            {state === 'error' && (
              <Banner tone="danger" live="assertive">
                {t('web.a04.fee.missing')}
              </Banner>
            )}
            <fieldset className={styles['choices']}>
              <legend className={styles['strong']}>{t('web.a04.fee.legend')}</legend>
              {(
                [
                  ['fuel', f.fees.fuelMinor],
                  ['smoking', f.fees.smokingMinor],
                  ['pets', f.fees.petsMinor],
                ] as const
              ).map(([id, minor]) => (
                <label key={id} className={styles['choice']}>
                  <input type="radio" name="fee" value={id} defaultChecked={id === 'fuel'} />
                  <span className={styles['choiceBody']}>{t(`web.a04.fee.${id}`)}</span>
                  <span className={styles['strong']}>{amount(ctx, minor)}</span>
                </label>
              ))}
            </fieldset>
            <div className={styles['photoGrid']}>
              <PhotoSlot
                i18n={i18n}
                angle={t('web.a04.fee.proof')}
                state={state === 'error' ? 'failed' : 'uploaded'}
              />
            </div>
            <p className={styles['muted']}>{t('web.a04.fee.note', { guest, brand: ctx.brand })}</p>
          </form>
        )}
      </main>
      <ActionBar>
        {fee ? (
          <ButtonLink block href={ctx.href('a04', { state: state === 'error' ? 'error' : 'done' })}>
            {t('web.a04.fee.submit')}
          </ButtonLink>
        ) : (
          <ButtonLink block href={ctx.href('a04', { state: 'done' })}>
            {t('web.a04.close')}
          </ButtonLink>
        )}
      </ActionBar>
    </>
  );
}

// ---------------------------------------------------------------- A12

const SUBS = ['punctuality', 'condition', 'communication', 'rules'] as const;

export function A12({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, market, state } = ctx;
  const trip = hostTrip(market, 'upcoming');
  const guest = firstName(trip.guest);
  return (
    <>
      <AppHeader ctx={ctx} back={ctx.href('a02')} title={t('web.a12.title', { guest })} />
      <main className={styles['content']}>
        {state === 'sent' ? (
          <section className={styles['stack']} aria-labelledby="a12-sent">
            <span className={styles['successMark']} aria-hidden="true">
              <Icon name="star" />
            </span>
            <h1 id="a12-sent" className={styles['h1']}>
              {t('web.a12.sent.title')}
            </h1>
            <p className={styles['text']}>{t('web.a12.sent', { guest })}</p>
          </section>
        ) : state === 'error' ? (
          <Banner tone="warning" live="assertive" icon="clock">
            {t('web.review.closed', { date: ctx.date('reviewUntil') })}
          </Banner>
        ) : state === 'loading' ? (
          <LoadingBlock ctx={ctx} rows={4} />
        ) : (
          <form className={styles['stack']} action={ctx.href('a12').split('?')[0]} method="get">
            <p className={styles['strong']}>
              {t('web.review.until', { date: ctx.date('reviewUntil') })}
            </p>
            <p className={styles['muted']}>{t('web.review.blind', { name: guest, count: 10 })}</p>
            <fieldset className={styles['stars']}>
              <legend className={styles['h3']}>{t('web.a12.overall')}</legend>
              <div className={styles['starRow']}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n} className={styles['star']}>
                    <input type="radio" name="overall" value={n} defaultChecked={n === 5} />
                    <Icon name="star" />
                    <span className={styles['visuallyHidden']}>
                      {t('web.a12.stars', { count: n })}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {SUBS.map((sub) => (
              <fieldset key={sub} className={styles['subRating']}>
                <legend className={styles['strong']}>{t(`web.a12.sub.${sub}`)}</legend>
                <div className={styles['starRow']}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <label key={n} className={styles['starSmall']}>
                      <input
                        type="radio"
                        name={sub}
                        value={n}
                        defaultChecked={n === (sub === 'condition' ? 4 : 5)}
                      />
                      <span aria-hidden="true">{n}</span>
                      <span className={styles['visuallyHidden']}>
                        {t('web.a12.stars', { count: n })}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <div className={styles['stackTight']}>
              <label className={styles['strong']} htmlFor="a12-text">
                {t('web.a12.text')}
              </label>
              <textarea
                id="a12-text"
                className={styles['textarea']}
                rows={4}
                aria-describedby="a12-hint"
              />
              <p id="a12-hint" className={styles['muted']}>
                {t('web.a12.text.hint', { count: 25 })}
              </p>
            </div>
            <p className={styles['muted']}>{t('web.a12.public', { guest })}</p>
          </form>
        )}
      </main>
      <ActionBar>
        {state === 'sent' || state === 'error' ? (
          <ButtonLink block href={ctx.href('a02')}>
            {t('web.common.continue')}
          </ButtonLink>
        ) : (
          <ButtonLink block href={ctx.href('a12', { state: 'sent' })}>
            {t('web.a12.submit')}
          </ButtonLink>
        )}
      </ActionBar>
    </>
  );
}

// ---------------------------------------------------------------- A09

export function A09({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, market, state } = ctx;
  const trip = hostTrip(market, 'hold');
  const guest = firstName(trip.guest);
  const car = hostCar(ctx);
  const decided = state === 'decided';
  const timeline: ReadonlyArray<{
    readonly key: string;
    readonly text: string;
    readonly done: boolean;
  }> = [
    {
      key: 'reported',
      text: t('web.a09.tl.reported', { date: ctx.date('claimFiled') }),
      done: true,
    },
    {
      key: 'evidence',
      text: t('web.a09.tl.evidence', { date: ctx.date('evidenceUntil') }),
      done: state !== 'error',
    },
    {
      key: 'insurer',
      text: t('web.a09.tl.insurer', { insurer: market.insurerName }),
      done: decided,
    },
    { key: 'decision', text: t('web.a09.tl.decision'), done: decided },
  ];
  return (
    <>
      <AppHeader
        ctx={ctx}
        back={ctx.href('a08')}
        title={t('web.a09.title', { code: market.host.damageCode })}
      />
      <main className={styles['content']}>
        <div className={styles['between']}>
          <span className={styles['strong']}>{car.title}</span>
          <Badge tone={decided ? 'success' : 'warning'}>
            {decided
              ? t('web.a09.status.decided')
              : t('web.a09.status.review', { insurer: market.insurerName })}
          </Badge>
        </div>
        <GuestLine ctx={ctx} trip={trip} />
        {state === 'error' && (
          <Banner tone="warning" live="assertive" title={t('web.a09.missing.title')}>
            {t('web.a09.missing', { date: ctx.date('evidenceUntil') })}
          </Banner>
        )}
        {decided && (
          <Banner tone="success" live="polite">
            {t('web.a09.decided', {
              insurer: market.insurerName,
              amount: amount(ctx, trip.hostMinor),
            })}
          </Banner>
        )}
        {state === 'loading' ? (
          <LoadingBlock ctx={ctx} rows={4} />
        ) : (
          <>
            <ol className={styles['claimTimeline']}>
              {timeline.map((item) => (
                <li key={item.key} className={item.done ? styles['claimDone'] : undefined}>
                  <Icon name={item.done ? 'check' : 'clock'} />
                  <span>{item.text}</span>
                </li>
              ))}
            </ol>
            <section className={styles['section']} aria-labelledby="a09-evidence">
              <h2 id="a09-evidence" className={styles['h3']}>
                {t('web.a09.evidence')}
              </h2>
              <ul className={styles['rows']}>
                <Row icon="camera" title={t('web.a09.ev.hostBefore', { count: HANDOVER.length })} />
                <Row icon="camera" title={t('web.a09.ev.hostAfter', { count: HANDOVER.length })} />
                <Row
                  icon="camera"
                  title={t('web.a09.ev.guestBefore', { guest, count: HANDOVER.length })}
                />
                <Row
                  icon="camera"
                  title={t('web.a09.ev.guestAfter', { guest, count: HANDOVER.length })}
                />
                <Row
                  icon="document"
                  title={t('web.a09.quote', { amount: amount(ctx, market.host.damageQuoteMinor) })}
                  end={
                    state === 'error' ? (
                      <Badge tone="danger">{t('web.a09.quote.missing')}</Badge>
                    ) : (
                      <Badge tone="success">{t('web.a07.status.done')}</Badge>
                    )
                  }
                />
              </ul>
            </section>
            {!decided && (
              <Banner tone="info" icon="wallet">
                {t('web.a09.payout', { amount: amount(ctx, trip.hostMinor) })}
              </Banner>
            )}
          </>
        )}
      </main>
      <ActionBar>
        {state === 'error' ? (
          <ButtonLink block href={ctx.href('a09')}>
            <Icon name="camera" />
            {t('web.a09.upload')}
          </ButtonLink>
        ) : (
          <ButtonLink block variant={decided ? 'primary' : 'secondary'} href={ctx.href('a08')}>
            {t('web.a09.back')}
          </ButtonLink>
        )}
      </ActionBar>
    </>
  );
}
