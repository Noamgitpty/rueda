import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi } from '../../../../../account/api-client.ts';
import { guestTripOf } from '../../../../../account/guest-trips.ts';
import { clientContext } from '../../../../../account/request.ts';
import { UUID } from '../../../../../account/trip-claims.ts';
import {
  TRAFFIC_DONE_KEYS,
  TRAFFIC_GUEST_TONE,
  trafficDoneOf,
  trafficGuestHref,
  trafficGuestOf,
  trafficGuestStatusKey,
} from '../../../../../account/trip-traffic.ts';
import type { TrafficGuestCharge } from '../../../../../account/trip-traffic.ts';
import { getRequestBrand } from '../../../../../brand-source.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../../i18n.ts';
import accountStyles from '../../../_account/account.module.css';
import incidentalStyles from '../../../_incidental/incidental.module.css';
import { MAIN_ID } from '../../../_shell/main-id.ts';
import hostStyles from '../../../host/host.module.css';
import { TrafficAcceptForm, TrafficDisputeForm } from './traffic-guest-forms.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.trafficGuest.title'), robots: { index: false, follow: false } };
}

/**
 * S12 · amendes, péages et fourrière refacturés au voyageur (suite d'US-318, 0181, ADR-201,
 * PROPOSÉ « comme Turo » ; 08 BR-TT-02 : 48 h pour payer ou contester ; 10b S12) : pour chaque
 * refacturation, nature, référence de l'avis, date du fait, montant payé par l'hôte, frais de
 * gestion, total et échéance (fuseau du trip, format de la langue) ; « payer » et « contester »
 * (motif, photos du trip facultatives) tant qu'une réponse est possible ; sinon l'état et la
 * décision de la plateforme. Aucun débit avant la réponse ou l'échéance. Le fuseau et l'exposant de
 * la devise sont relus sur le trip du voyageur (`GET /trips/{id}`), jamais pris d'un formulaire.
 * Un trip d'une autre personne, ou inconnu, rend le même message (404 de l'API). En ligne seulement.
 */
export default async function GuestTrafficChargesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly tripId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, localeTag, brand, { tripId }, query] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    getRequestBrand(),
    params,
    searchParams,
  ]);
  const t = i18n.t.bind(i18n);
  const done = trafficDoneOf(query['done']);
  const back = UUID.test(tripId) ? `/trips/${tripId}` : '/trips';
  const values = { brand: brand.name };
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={hostStyles['link']} href={back}>
          {t('web.traffic.back')}
        </a>
        <h1 className={accountStyles['h1']} data-testid="traffic-guest-title">
          {t('web.trafficGuest.title')}
        </h1>
      </header>
      {body}
    </main>
  );
  const ctx = await clientContext();
  if (ctx.sessionToken === null) {
    return shell(
      <EmptyState
        icon="car"
        headingLevel={2}
        title={t('web.host.loginRequired')}
        action={<ButtonLink href="/login">{t('web.host.login')}</ButtonLink>}
      />,
    );
  }
  const notFound = shell(
    <EmptyState icon="car" headingLevel={2} title={t('common.tripClaims.notFound')} />,
  );
  if (!UUID.test(tripId)) return notFound;
  const [tripReply, reply] = await Promise.all([
    callApi('GET', `/trips/${tripId}`, ctx),
    callApi('GET', `/trips/${tripId}/traffic-charges`, ctx),
  ]);
  if ([tripReply.status, reply.status].some((s) => s === 404 || s === 401)) return notFound;
  const trip = guestTripOf(tripReply, tripId);
  const view = trafficGuestOf(reply, tripId);
  if (trip === null || view === null) {
    return shell(
      <ErrorState
        i18n={i18n}
        message={t('common.tripClaims.unavailable')}
        action={
          <ButtonLink href={trafficGuestHref(tripId)}>{t('web.incidental.retry')}</ButtonLink>
        }
      />,
    );
  }
  const date = (iso: string) => i18n.dateTime(iso, trip.timezone);
  const money = (minor: string) =>
    i18n.money({
      amountMinor: BigInt(minor),
      currency: view.currency,
      exponent: trip.currencyExponent,
    });
  // heure du rendu (serveur) : seulement pour dire si l'échéance est passée ; la base fait foi
  const now = Date.now();

  const charge = (c: TrafficGuestCharge) => (
    <li
      key={c.id}
      className={`${hostStyles['card']} ${incidentalStyles['invoice']}`}
      data-testid="traffic-charge"
    >
      <div className={hostStyles['between']}>
        <h3 className={accountStyles['h2']}>{t(`web.traffic.kind.${c.kind}`)}</h3>
        <span className={incidentalStyles['amount']} data-testid="traffic-total-shown">
          {money(c.totalMinor)}
        </span>
      </div>
      <p className={accountStyles['text']} data-testid="traffic-reference">
        {t('web.traffic.review.reference', { reference: c.reference })}
      </p>
      <p className={accountStyles['text']}>
        {t('web.traffic.review.at', { time: date(c.occurredAt) })}
      </p>
      <p className={accountStyles['text']} data-testid="traffic-amount">
        {t('web.trafficGuest.amount', { amount: money(c.amountMinor) })}
      </p>
      <p className={accountStyles['text']} data-testid="traffic-fee">
        {t('web.traffic.sent.fee', { amount: money(c.adminFeeMinor) })}
      </p>
      <p className={hostStyles['strong']} data-testid="traffic-total">
        {t('web.trafficGuest.total', { amount: money(c.totalMinor) })}
      </p>
      <Banner tone={TRAFFIC_GUEST_TONE[c.status]} live="off">
        <span data-testid="traffic-status">
          {t(trafficGuestStatusKey(c, now), { ...values, date: date(c.responseDueAt) })}
        </span>
      </Banner>
      {c.disputeReason !== null && (
        <>
          <p className={accountStyles['muted']}>{t('web.trafficGuest.disputeReason')}</p>
          <p className={incidentalStyles['quote']} data-testid="traffic-dispute-reason">
            {c.disputeReason}
          </p>
        </>
      )}
      {c.decisionRationale !== null && (
        <>
          <p className={accountStyles['muted']}>{t('web.incidental.decision', values)}</p>
          <p className={incidentalStyles['quote']} data-testid="traffic-decision">
            {c.decisionRationale}
          </p>
          {c.decidedAt !== null && (
            <p className={accountStyles['muted']}>
              {t('web.trafficGuest.decidedAt', { date: date(c.decidedAt) })}
            </p>
          )}
        </>
      )}
      {c.canRespond && (
        <>
          <TrafficAcceptForm
            localeTag={localeTag}
            tripId={view.tripId}
            chargeId={c.id}
            total={money(c.totalMinor)}
            brand={brand.name}
          />
          <TrafficDisputeForm
            localeTag={localeTag}
            tripId={view.tripId}
            chargeId={c.id}
            photos={view.photos}
            brand={brand.name}
          />
        </>
      )}
    </li>
  );

  return shell(
    <>
      {done !== null && (
        <Banner tone="success" live="polite">
          <span data-testid="traffic-done">{t(TRAFFIC_DONE_KEYS[done], values)}</span>
        </Banner>
      )}
      <p className={accountStyles['text']}>{t('web.trafficGuest.lead', values)}</p>
      {view.charges.length === 0 ? (
        <p className={accountStyles['muted']} data-testid="traffic-empty">
          {t('web.trafficGuest.empty')}
        </p>
      ) : (
        <section className={hostStyles['section']} aria-labelledby="traffic-guest-list">
          <h2 id="traffic-guest-list" className={accountStyles['h2']}>
            {t('web.trafficGuest.list')}
          </h2>
          <ul className={incidentalStyles['invoices']}>{view.charges.map(charge)}</ul>
        </section>
      )}
    </>,
  );
}
