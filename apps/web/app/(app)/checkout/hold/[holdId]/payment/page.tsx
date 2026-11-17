import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Banner, Button, ButtonLink, EmptyState, ErrorState, LoadingState } from '@rueda/ui';
import { callApi, codeOf } from '../../../../../../account/api-client.ts';
import { checkoutHoldOf, isUuid } from '../../../../../../account/checkout.ts';
import {
  bookingReference,
  checkoutPaymentOf,
  localSlotOf,
  paymentHref,
  requestScreenOf,
} from '../../../../../../account/checkout-payment.ts';
import type {
  PaymentStateView,
  RequestScreen,
} from '../../../../../../account/checkout-payment.ts';
import { publicListingOf } from '../../../../../../account/host-listings.ts';
import { searchHref } from '../../../../../../account/search.ts';
import { clientContext } from '../../../../../../account/request.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../../../i18n.ts';
import accountStyles from '../../../../_account/account.module.css';
import { MAIN_ID } from '../../../../_shell/main-id.ts';
import styles from '../../../../host/host.module.css';
import { PayForm } from '../pay-form.tsx';
import { S06_TITLE_ID, StateAnnouncer } from './state-announcer.tsx';
import { VerifyingWatch } from './verifying-watch.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s06.status.title'), robots: { index: false, follow: false } };
}

function Shell({ children }: { readonly children: ReactNode }) {
  return (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      {children}
    </main>
  );
}

const BODY_ID = 's06-body';

/**
 * S06 — retour du PSP et attente de la preuve (US-223 partie 223b, ADR-142 ; 10b S06, UX-27,
 * règles 3 et 4 ; 16 PAY-034). L'état vient de `GET /checkout/holds/{id}/payment`, fondé sur l'état
 * du hold et le trip né de la conversion, jamais sur un statut d'opération du PSP :
 * - `VERIFYING` : « Pago en verificación », « No pagues de nuevo », relecture toutes les 5 s (une
 *   seule lecture de l'API : ni le hold ni la fiche ne sont relus pendant l'attente), attente lente
 *   (2 min) puis support (10 min), relecture arrêtée ensuite ; « Pagar de nuevo » désactivé ;
 * - `INTERRUPTED` : la page de paiement ne s'est pas ouverte (aucun ordre enregistré) : reprise,
 *   qui cherche d'abord l'ordre par la clé (jamais un second ordre, N-108) ;
 * - `CONFIRMED` : seulement si le hold est converti et le trip né (preuve par webhook signé) ;
 * - `DECLINED` : refus du PSP, aucun débit, hold gardé jusqu'à son heure limite (lue dans l'API,
 *   aucune durée écrite) et « Pagar de nuevo » ;
 * - `ENDED` : hold échu ou libéré sans paiement (N-169 : sortie vers la recherche) ; libéré par la
 *   revue d'une réservation signalée (`reviewState` = REJECTED, US-209c) : « Reserva no aprobada » ;
 * - `UNPROVEN` : hold terminé avec un ordre non prouvé : ne pas payer de nouveau, support ;
 * - `REFUND_DUE` : payé après la libération (`web.error.paidAfterRelease`, montant rendu par l'API).
 * `PAYABLE` (aucun ordre) : retour à S05. Le passage d'un état à l'autre est annoncé par une région
 * vive persistante et le focus passe au titre (`StateAnnouncer`).
 *
 * Demande à l'hôte (hold `REQUEST`, US-223 partie 223d, ADR-152 ; 10b S07 « Mode REQUEST », §4.3) :
 * le champ `request` du paiement choisit un écran dédié (`requestScreenOf`, fail-closed) :
 * - « Solicitud enviada » (10b S07, `web.s07.request.pending`) : l'heure limite est celle de la base
 *   (`respondBy`), au fuseau du véhicule ; aucune durée écrite ; aucune relecture automatique (la
 *   réponse peut prendre des heures : bouton « Actualizar el estado ») ;
 * - acceptée, capture en attente de sa preuve : relecture comme `VERIFYING`, jamais « confirmé »
 *   avant le webhook ;
 * - refusée (`web.error.requestDeclined`), expirée (`web.error.requestExpired`), capture non
 *   aboutie : aucun débit, recherche aux mêmes dates.
 * L'écran « demande envoyée » est numéroté S07 dans 10b ; il est servi par la route de S06 (le
 * retour du PSP), comme la confirmation (PROPOSÉ, ADR-152).
 */
export default async function PaymentPage({
  params,
}: {
  readonly params: Promise<{ readonly holdId: string }>;
}) {
  const [i18n, localeTag, { holdId }] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    params,
  ]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  if (ctx.sessionToken === null) redirect('/login');
  const notFound = (
    <Shell>
      <h1 className={accountStyles['h1']}>{t('web.s06.status.title')}</h1>
      <EmptyState
        icon="car"
        headingLevel={2}
        title={t('web.s05.hold.notFound')}
        body={t('common.checkout.holdNotFound')}
        action={<ButtonLink href="/">{t('web.listing.search')}</ButtonLink>}
      />
    </Shell>
  );
  const failed = (
    <Shell>
      <h1 className={accountStyles['h1']}>{t('web.s06.status.title')}</h1>
      <ErrorState
        i18n={i18n}
        message={t('web.s05.error')}
        action={<ButtonLink href={paymentHref(holdId)}>{t('web.host.retry')}</ButtonLink>}
      />
    </Shell>
  );
  if (!isUuid(holdId)) return notFound;
  const reply = await callApi('GET', `/checkout/holds/${holdId}/payment`, ctx);
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  if (reply.status === 404) return notFound;
  const payment = checkoutPaymentOf(reply);
  if (payment === null) return failed;
  if (payment.state === 'PAYABLE') redirect(`/checkout/hold/${holdId}`);
  const reference = (
    <p className={accountStyles['text']} data-testid="s06-reference">
      {t('web.s06.reference', { reference: bookingReference(payment.holdId) })}
    </p>
  );
  const support = (
    <section className={styles['section']} aria-labelledby="s06-support">
      <h2 id="s06-support" className={accountStyles['h2']}>
        {t('web.s06.support')}
      </h2>
      <p className={accountStyles['text']}>{t('web.s06.supportBody')}</p>
    </section>
  );
  const page = (
    state: PaymentStateView | RequestScreen,
    title: string,
    announce: string,
    body: ReactNode,
  ) => (
    <Shell>
      <StateAnnouncer state={state} message={announce} />
      <header className={accountStyles['stackTight']}>
        <h1
          id={S06_TITLE_ID}
          tabIndex={-1}
          className={accountStyles['h1']}
          data-testid="s06-title"
          data-state={state}
        >
          {title}
        </h1>
      </header>
      {body}
    </Shell>
  );

  // US-223d : demande à l'hôte dans un état dédié (lit le hold et la fiche plus bas)
  const requestScreen = requestScreenOf(payment);
  // en attente de la preuve : une seule lecture de l'API à chaque relecture
  if (payment.state === 'VERIFYING' && requestScreen === null) {
    const title = t('web.s06.verifying.title');
    return page(
      'VERIFYING',
      title,
      title,
      <>
        <LoadingState i18n={i18n} label={title} />
        <p id={BODY_ID} className={accountStyles['text']}>
          {t('web.s06.verifying.body')}
        </p>
        {reference}
        <VerifyingWatch
          slow={`${t('web.s06.verifying.slow')} ${t('web.s06.verifying.notify')}`}
          supportTitle={t('web.s06.support')}
          supportBody={t('web.s06.supportBody')}
        />
        <ButtonLink variant="secondary" href={paymentHref(payment.holdId)}>
          {t('web.s06.refresh')}
        </ButtonLink>
        {/* un ordre est actif : « Pagar de nuevo » désactivé (anti double paiement, PAY-019) */}
        <Button variant="secondary" block disabled aria-describedby={BODY_ID}>
          {t('web.s06.payAgain')}
        </Button>
      </>,
    );
  }
  if (payment.state === 'INTERRUPTED') {
    const title = t('web.s06.interrupted.title');
    return page(
      'INTERRUPTED',
      title,
      title,
      <>
        <Banner tone="warning" live="off">
          {t('web.s06.interrupted.body')}
        </Banner>
        <PayForm
          localeTag={localeTag}
          holdId={payment.holdId}
          label={t('web.s06.interrupted.retry')}
          testId="s06-retry"
        />
        {reference}
      </>,
    );
  }
  if (payment.state === 'UNPROVEN') {
    const title = t('web.s06.unproven.title');
    const body = t('web.s06.unproven.body');
    return page(
      'UNPROVEN',
      title,
      `${title}. ${body}`,
      <>
        <Banner tone="warning" live="off">
          {body}
        </Banner>
        {reference}
        {support}
      </>,
    );
  }

  // états finaux qui citent l'auto, l'heure limite ou le montant : hold et fiche lus une fois
  const hold = checkoutHoldOf(await callApi('GET', `/checkout/holds/${holdId}`, ctx));
  const listing =
    hold === null
      ? null
      : publicListingOf(
          await callApi('GET', `/listings/${hold.listingId}`, { ...ctx, sessionToken: null }),
        );
  if (
    hold === null ||
    listing === null ||
    listing.currency !== hold.currency ||
    listing.timezone === null
  ) {
    return failed;
  }
  const car = (
    <p className={styles['strong']}>{`${listing.makeName} ${listing.modelName} ${listing.year}`}</p>
  );
  const search = <ButtonLink href="/">{t('web.listing.search')}</ButtonLink>;
  if (requestScreen !== null) {
    const host = listing.hostFirstName ?? t('web.s07.request.hostFallback');
    const tz = listing.timezone;
    switch (requestScreen) {
      case 'REQUEST_SENT': {
        // 10b S07 : heure limite de la base, jamais une durée écrite
        const title = t('web.s07.request.title');
        const body = t('web.s07.request.pending', {
          host_name: host,
          time: i18n.time(payment.request?.respondBy ?? payment.expiresAt, tz),
        });
        return page(
          requestScreen,
          title,
          `${title}. ${body}`,
          <>
            <Banner tone="info" live="off">
              {body}
            </Banner>
            <p className={accountStyles['text']}>{t('web.s07.request.authorized')}</p>
            {car}
            {reference}
            <ButtonLink variant="secondary" href={paymentHref(payment.holdId)}>
              {t('web.s06.refresh')}
            </ButtonLink>
          </>,
        );
      }
      case 'REQUEST_CAPTURING': {
        // acceptée : la capture attend sa preuve (webhook), relecture comme `VERIFYING`
        const title = t('web.s07.request.capturing.title');
        const body = t('web.s07.request.capturing.body', { host_name: host });
        return page(
          requestScreen,
          title,
          `${title}. ${body}`,
          <>
            <LoadingState i18n={i18n} label={title} />
            <p id={BODY_ID} className={accountStyles['text']}>
              {body}
            </p>
            {car}
            {reference}
            <VerifyingWatch
              slow={`${t('web.s06.verifying.slow')} ${t('web.s06.verifying.notify')}`}
              supportTitle={t('web.s06.support')}
              supportBody={t('web.s06.supportBody')}
            />
            <ButtonLink variant="secondary" href={paymentHref(payment.holdId)}>
              {t('web.s06.refresh')}
            </ButtonLink>
          </>,
        );
      }
      default: {
        // refusée, expirée, capture non aboutie : aucun débit ; recherche aux mêmes dates
        const start = localSlotOf(hold.startAt, tz);
        const end = localSlotOf(hold.endAt, tz);
        const again =
          start === null || end === null ? (
            search
          ) : (
            <ButtonLink
              href={searchHref({
                country: listing.country,
                city: listing.city,
                area: null,
                start,
                end,
              })}
            >
              {t('web.s06.request.searchCta')}
            </ButtonLink>
          );
        const [titleKey, body] =
          requestScreen === 'REQUEST_DECLINED'
            ? ([
                'web.s06.request.declined.title',
                t('web.error.requestDeclined', { host_name: host }),
              ] as const)
            : requestScreen === 'REQUEST_EXPIRED'
              ? ([
                  'web.s06.request.expired.title',
                  t('web.error.requestExpired', { host_name: host }),
                ] as const)
              : ([
                  'web.s06.request.captureFailed.title',
                  t('web.s06.request.captureFailed.body'),
                ] as const);
        const title = t(titleKey);
        return page(
          requestScreen,
          title,
          `${title}. ${body}`,
          <>
            <Banner tone="warning" live="off">
              {body}
            </Banner>
            {car}
            {reference}
            {again}
          </>,
        );
      }
    }
  }
  switch (payment.state) {
    case 'CONFIRMED': {
      const title = t('web.s06.confirmed.title');
      const body = t('web.s06.confirmed.body');
      return page(
        'CONFIRMED',
        title,
        `${title} ${body}`,
        <>
          <Banner tone="success" live="off">
            {body}
          </Banner>
          {car}
          {reference}
          {/* contrat de location du trip né de la conversion (S09 · contrat, US-211 partie 211b) */}
          {payment.tripId !== null && (
            <ButtonLink href={`/trips/${payment.tripId}/contract`} data-testid="s06-contract">
              {t('web.s06.confirmed.contract')}
            </ButtonLink>
          )}
          <ButtonLink variant="secondary" href={`/listings/${hold.listingId}`}>
            {t('web.s06.confirmed.cta')}
          </ButtonLink>
        </>,
      );
    }
    case 'DECLINED': {
      const title = t('web.s06.declined.title');
      const body = t('web.error.paymentDeclined', {
        hold_end_time: i18n.time(payment.expiresAt, listing.timezone),
      });
      return page(
        'DECLINED',
        title,
        `${title}. ${body}`,
        <>
          <Banner tone="danger" live="off">
            {body}
          </Banner>
          {car}
          <PayForm
            localeTag={localeTag}
            holdId={payment.holdId}
            label={t('web.s06.payAgain')}
            testId="s06-pay-again"
          />
          {reference}
        </>,
      );
    }
    case 'REFUND_DUE': {
      const title = t('web.s06.refund.title');
      const body = t('web.error.paidAfterRelease', {
        amount: i18n.money({
          amountMinor: hold.totalMinor,
          currency: hold.currency,
          exponent: listing.currencyExponent,
        }),
      });
      return page(
        'REFUND_DUE',
        title,
        `${title}. ${body}`,
        <>
          <Banner tone="info" live="off">
            {body}
          </Banner>
          {reference}
          {search}
        </>,
      );
    }
    default: {
      // ENDED : hold échu ou libéré sans paiement (N-169) ; libéré par la revue d'une réservation
      // signalée (refus ou revue non faite dans le délai, jamais distingués : US-209c, ADR-144)
      const rejected = hold.reviewState === 'REJECTED';
      const title = t(rejected ? 'web.s06.reviewRejected.title' : 'web.s06.ended.title');
      const body = t(rejected ? 'web.s06.reviewRejected.body' : 'web.s06.ended.body');
      return page(
        'ENDED',
        title,
        `${title}. ${body}`,
        <>
          <Banner tone="warning" live="off">
            {body}
          </Banner>
          {car}
          {search}
        </>,
      );
    }
  }
}
