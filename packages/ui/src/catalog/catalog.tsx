import type { ReactNode } from 'react';
import type { MinorUnitAmount, Translator } from '@rueda/i18n';
import { Avatar } from '../avatar.tsx';
import { Badge } from '../badge.tsx';
import { Banner, EmptyState, ErrorState } from '../banner.tsx';
import { Button, ButtonLink } from '../button.tsx';
import { CarCard, CarCardSkeleton } from '../car-card.tsx';
import { DataTable } from '../data-table.tsx';
import { DepositBlock } from '../deposit-block.tsx';
import { Checkbox, ErrorSummary, TextField } from '../field.tsx';
import { HostCard } from '../host-card.tsx';
import { IconButton } from '../icon-button.tsx';
import { cx } from '../internal/cx.ts';
import { PhotoSlot } from '../photo-slot.tsx';
import { Price, PriceBreakdown } from '../price.tsx';
import { Rating } from '../rating.tsx';
import { LoadingState } from '../skeleton.tsx';
import { Steps } from '../steps.tsx';
import styles from './catalog.module.css';
import { SAMPLES } from './samples.ts';

const money = (currency: string, exponent: number, minor: string): MinorUnitAmount => ({
  amountMinor: BigInt(minor),
  currency,
  exponent,
});

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className={styles['section']} aria-labelledby={id}>
      <h2 id={id} className={styles['sectionTitle']}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function State({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles['state']}>
      <h3 className={styles['stateTitle']}>{title}</h3>
      {children}
    </div>
  );
}

export interface ComponentCatalogProps {
  readonly i18n: Translator;
  /** Cadre mobile de 360 px (10b UX-01). */
  readonly mobile?: boolean | undefined;
  /** Commandes de la vitrine (langue, thème, largeur), rendues par l'application. */
  readonly controls?: ReactNode;
}

/**
 * Vitrine vivante (US-032, DSN-005) : chaque composant de la bibliothèque dans ses états —
 * normal, vide, chargement, erreur, désactivé — dans la langue du traducteur reçu. Le thème
 * (clair ou sombre) et la largeur sont choisis par l'application qui l'affiche.
 */
export function ComponentCatalog({ i18n, mobile = false, controls }: ComponentCatalogProps) {
  const t = i18n.t;
  const s = SAMPLES;
  const state = {
    normal: t('web.catalog.state.normal'),
    empty: t('web.catalog.state.empty'),
    loading: t('web.catalog.state.loading'),
    error: t('web.catalog.state.error'),
    disabled: t('web.catalog.state.disabled'),
  };
  const [yaris, hrv] = s.cars;
  const p = s.price;
  const priceAmount = (minor: string) => money(p.currency, p.exponent, minor);
  const dep = s.deposit;
  const tz = s.timeZone;
  const car = (c: (typeof s.cars)[number], save?: ReactNode) => (
    <CarCard
      i18n={i18n}
      href={`#car-${c.id}`}
      title={c.title}
      host={c.host}
      rating={c.rating}
      trips={c.trips}
      place={c.place}
      distanceKm={c.distanceKm}
      days={c.days}
      total={money(c.currency, c.exponent, c.totalMinor)}
      perDay={money(c.currency, c.exponent, c.perDayMinor)}
      carTone={c.carTone}
      headingLevel={4}
      saveAction={save}
    />
  );
  const steps = [
    t('web.catalog.sample.step.dates'),
    t('web.catalog.sample.step.identity'),
    t('web.catalog.sample.step.payment'),
    t('web.catalog.sample.step.confirmation'),
  ];
  const columns = [
    { key: 'trip', header: t('web.catalog.sample.table.trip') },
    { key: 'dates', header: t('web.catalog.sample.table.dates') },
    { key: 'status', header: t('web.catalog.sample.table.status') },
    { key: 'earnings', header: t('web.catalog.sample.table.earnings'), align: 'end' as const },
  ];
  const rows = s.table.map((r) => ({
    id: r.id,
    cells: {
      trip: `${r.car} · ${r.guest}`,
      dates: `${i18n.date(r.start, tz)} – ${i18n.date(r.end, tz)}`,
      status:
        r.status === 'confirmed' ? (
          <Badge tone="success">{t('web.catalog.sample.table.confirmed')}</Badge>
        ) : (
          <Badge tone="warning">{t('web.catalog.sample.table.pending')}</Badge>
        ),
      earnings: i18n.money(priceAmount(r.earningsMinor)),
    },
  }));

  return (
    <div className={cx(styles['catalog'], mobile && styles['mobile'])}>
      <header className={styles['header']}>
        <h1 className={styles['title']}>{t('web.catalog.title')}</h1>
        <p className={styles['intro']}>{t('web.catalog.intro')}</p>
        {controls}
      </header>

      <Section id="cat-buttons" title={t('web.catalog.section.buttons')}>
        <State title={state.normal}>
          <div className={styles['row']}>
            <Button>{t('web.s03.cta')}</Button>
            <Button variant="secondary">{t('web.deposit.contest')}</Button>
            <Button variant="quiet">{t('common.price.details')}</Button>
            <ButtonLink href="#cat-buttons" variant="secondary" size="sm">
              {t('web.s01.owner.cta')}
            </ButtonLink>
            <IconButton
              icon="heart"
              label={t('common.ui.car.save', { car: yaris.title })}
              pressed={false}
            />
            <IconButton icon="heart" label={t('common.ui.car.save', { car: hrv.title })} pressed />
          </div>
          <Button block>{t('web.s03.cta')}</Button>
        </State>
        <State title={state.loading}>
          <div className={styles['row']}>
            <Button loading>{t('web.common.save')}</Button>
          </div>
        </State>
        <State title={state.disabled}>
          <div className={styles['row']}>
            <Button disabled>{t('web.common.save')}</Button>
            <Button variant="secondary" disabled>
              {t('web.deposit.contest')}
            </Button>
          </div>
        </State>
      </Section>

      <Section id="cat-fields" title={t('web.catalog.section.fields')}>
        <State title={state.normal}>
          <div className={styles['stack']}>
            <TextField
              i18n={i18n}
              id="cat-email"
              type="email"
              autoComplete="email"
              label={t('web.catalog.sample.emailLabel')}
              hint={t('web.catalog.sample.emailHint')}
            />
            <TextField
              i18n={i18n}
              id="cat-name"
              autoComplete="given-name"
              label={t('web.catalog.sample.nameLabel')}
              optional
            />
            <Checkbox id="cat-terms" label={t('web.catalog.sample.terms')} />
          </div>
        </State>
        <State title={state.error}>
          <div className={styles['stack']}>
            <ErrorSummary
              i18n={i18n}
              id="cat-summary"
              errors={[
                { fieldId: 'cat-email-error', message: t('common.auth.emailInvalid') },
                { fieldId: 'cat-terms-error', message: t('common.auth.termsNotAccepted') },
              ]}
            />
            <TextField
              i18n={i18n}
              id="cat-email-error"
              type="email"
              defaultValue="maria@"
              label={t('web.catalog.sample.emailLabel')}
              hint={t('web.catalog.sample.emailHint')}
              error={t('common.auth.emailInvalid')}
            />
            <Checkbox
              id="cat-terms-error"
              label={t('web.catalog.sample.terms')}
              error={t('common.auth.termsNotAccepted')}
            />
          </div>
        </State>
        <State title={state.disabled}>
          <div className={styles['stack']}>
            <TextField
              i18n={i18n}
              id="cat-email-disabled"
              type="email"
              defaultValue="maria@example.com"
              label={t('web.catalog.sample.emailLabel')}
              disabled
            />
            <Checkbox id="cat-terms-disabled" label={t('web.catalog.sample.terms')} disabled />
          </div>
        </State>
      </Section>

      <Section id="cat-badges" title={t('web.catalog.section.badges')}>
        <State title={state.normal}>
          <div className={styles['row']}>
            <Badge>{t('web.s02.new')}</Badge>
            <Badge tone="success">{t('web.host.guest.verified')}</Badge>
            <Badge tone="warning">{t('web.catalog.sample.table.pending')}</Badge>
            <Badge tone="danger">{t('web.catalog.state.error')}</Badge>
          </div>
          <div className={styles['row']}>
            <Avatar name="María José" size="sm" tone={1} />
            <Avatar name="Carlos Benítez" tone={2} />
            <Avatar name="Ana" size="lg" tone={3} />
            <Avatar name="Luis" size="lg" tone={4} decorative={false} />
          </div>
          <div className={styles['row']}>
            <Rating i18n={i18n} value={yaris.rating} trips={yaris.trips} />
          </div>
        </State>
        <State title={state.empty}>
          <div className={styles['row']}>
            <Rating i18n={i18n} trips={0} />
          </div>
        </State>
      </Section>

      <Section id="cat-price" title={t('web.catalog.section.price')}>
        <State title={state.normal}>
          <div className={styles['stack']}>
            <Price
              i18n={i18n}
              total={priceAmount(p.totalMinor)}
              perDay={priceAmount(yaris.perDayMinor)}
              days={p.days}
            />
            <Price
              i18n={i18n}
              size="lg"
              live
              total={money(hrv.currency, hrv.exponent, hrv.totalMinor)}
              perDay={money(hrv.currency, hrv.exponent, hrv.perDayMinor)}
              days={hrv.days}
            />
            <PriceBreakdown
              i18n={i18n}
              open
              lines={[
                {
                  id: 'rent',
                  label: t('web.catalog.sample.line.rent', { count: p.days }),
                  amount: priceAmount(p.rentMinor),
                },
                {
                  id: 'fee',
                  label: t('web.catalog.sample.line.tripFee'),
                  amount: priceAmount(p.tripFeeMinor),
                },
                {
                  id: 'protection',
                  label: t('web.catalog.sample.line.protection'),
                  amount: priceAmount(p.protectionMinor),
                },
                {
                  id: 'tax',
                  label: t('web.catalog.sample.line.tax'),
                  amount: priceAmount(p.taxMinor),
                },
              ]}
              total={priceAmount(p.totalMinor)}
            />
          </div>
        </State>
      </Section>

      <Section id="cat-cards" title={t('web.catalog.section.carCard')}>
        <State title={state.normal}>
          <div className={styles['grid']}>
            {car(
              yaris,
              <IconButton
                icon="heart"
                label={t('common.ui.car.save', { car: yaris.title })}
                pressed={false}
              />,
            )}
            {car(hrv)}
          </div>
        </State>
        <State title={state.loading}>
          <LoadingState i18n={i18n}>
            <div className={styles['grid']}>
              <CarCardSkeleton />
              <CarCardSkeleton />
            </div>
          </LoadingState>
        </State>
        <State title={state.empty}>
          <EmptyState title={t('web.s02.empty')} headingLevel={4} />
        </State>
        <State title={state.error}>
          <ErrorState
            i18n={i18n}
            message={t('common.error.server', { code: s.errorCode })}
            headingLevel={4}
            action={<Button variant="secondary">{t('web.catalog.sample.retry')}</Button>}
          />
        </State>
      </Section>

      <Section id="cat-host" title={t('web.catalog.section.host')}>
        <State title={state.normal}>
          <div className={styles['stack']}>
            <HostCard
              i18n={i18n}
              id="cat-host-card"
              name={s.host.name}
              titleForm={s.host.titleForm}
              tone={s.host.tone}
              rating={s.host.rating}
              trips={s.host.trips}
              memberSince={s.host.memberSince}
              verified
              responseRate={s.host.responseRate}
              responseHours={s.host.responseHours}
              quote={t('web.catalog.sample.hostQuote')}
              headingLevel={4}
            />
          </div>
        </State>
        <State title={state.empty}>
          <div className={styles['stack']}>
            <HostCard
              i18n={i18n}
              id="cat-host-new"
              name={hrv.host.name}
              tone={hrv.host.tone}
              trips={0}
              memberSince={s.host.memberSince}
              verified={false}
              headingLevel={4}
            />
          </div>
        </State>
      </Section>

      <Section id="cat-deposit" title={t('web.catalog.section.deposit')}>
        <State title={state.normal}>
          <div className={styles['stack']}>
            <DepositBlock
              i18n={i18n}
              id="cat-deposit-preauth"
              rail="preauth"
              amount={money(dep.currency, dep.exponent, dep.amountMinor)}
              merchantName={s.merchantName}
              hostName={s.host.name}
              releaseBy={{ instant: dep.releaseBy, timeZone: tz }}
              headingLevel={4}
            />
            <DepositBlock
              i18n={i18n}
              id="cat-deposit-charge"
              rail="chargeRefund"
              amount={money(dep.currency, dep.exponent, dep.amountMinor)}
              merchantName={s.merchantName}
              hostName={s.host.name}
              releaseBy={{ instant: dep.releaseBy, timeZone: tz }}
              refundIssuedOn={{ instant: dep.refundIssuedOn, timeZone: tz }}
              headingLevel={4}
            />
          </div>
        </State>
      </Section>

      <Section id="cat-banners" title={t('web.catalog.section.banners')}>
        <State title={state.normal}>
          <div className={styles['stack']}>
            <Banner tone="info" icon="offline" live="polite">
              {t('common.offline.banner')}
            </Banner>
            <Banner tone="success">{t('common.auth.emailVerified')}</Banner>
            <Banner tone="warning">{t('common.auth.rateLimited')}</Banner>
          </div>
        </State>
        <State title={state.error}>
          <div className={styles['stack']}>
            <Banner tone="danger" live="assertive">
              {t('common.auth.sessionRequired')}
            </Banner>
          </div>
        </State>
      </Section>

      <Section id="cat-steps" title={t('web.catalog.section.steps')}>
        <State title={state.normal}>
          <div className={styles['stack']}>
            <Steps i18n={i18n} steps={steps} current={1} />
          </div>
        </State>
      </Section>

      <Section id="cat-photo" title={t('web.catalog.section.photo')}>
        <State title={state.normal}>
          <div className={styles['grid']}>
            <PhotoSlot
              i18n={i18n}
              id="cat-photo-front"
              angle={t('web.catalog.sample.photo.front')}
              state="empty"
            />
            <PhotoSlot
              i18n={i18n}
              id="cat-photo-driver"
              angle={t('web.catalog.sample.photo.driverSide')}
              state="saved"
            />
            <PhotoSlot
              i18n={i18n}
              id="cat-photo-passenger"
              angle={t('web.catalog.sample.photo.passengerSide')}
              state="uploaded"
            />
          </div>
        </State>
        <State title={state.loading}>
          <div className={styles['grid']}>
            <PhotoSlot
              i18n={i18n}
              id="cat-photo-rear"
              angle={t('web.catalog.sample.photo.rear')}
              state="uploading"
            />
          </div>
        </State>
        <State title={state.error}>
          <div className={styles['grid']}>
            <PhotoSlot
              i18n={i18n}
              id="cat-photo-dashboard"
              angle={t('web.catalog.sample.photo.dashboard')}
              state="failed"
            />
          </div>
        </State>
      </Section>

      <Section id="cat-table" title={t('web.catalog.section.table')}>
        <State title={state.normal}>
          <DataTable
            id="cat-table-full"
            caption={t('web.catalog.sample.table.caption')}
            columns={columns}
            rows={rows}
          />
        </State>
        <State title={state.empty}>
          <DataTable
            id="cat-table-empty"
            caption={t('web.catalog.sample.table.caption')}
            columns={columns}
            rows={[]}
            empty={<EmptyState title={t('web.catalog.sample.table.empty')} headingLevel={4} />}
          />
        </State>
      </Section>
    </div>
  );
}
