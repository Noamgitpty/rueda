import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Banner, Button, ButtonLink, EmptyState, ErrorState, LoadingState } from '@rueda/ui';
import { callApi, codeOf } from '../../../../../../account/api-client.ts';
import { checkoutHoldOf, isUuid } from '../../../../../../account/checkout.ts';
import {
  bookingReference,
  checkoutPaymentOf,
  paymentHref,
} from '../../../../../../account/checkout-payment.ts';
import type { PaymentStateView } from '../../../../../../account/checkout-payment.ts';
import { publicListingOf } from '../../../../../../account/host-listings.ts';
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
  const page = (state: PaymentStateView, title: string, announce: string, body: ReactNode) => (
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

  // en attente de la preuve : une seule lecture de l'API à chaque relecture
  if (payment.state === 'VERIFYING') {
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
          <ButtonLink href={`/listings/${hold.listingId}`}>{t('web.s06.confirmed.cta')}</ButtonLink>
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
