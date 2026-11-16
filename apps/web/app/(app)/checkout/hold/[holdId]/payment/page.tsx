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
import { publicListingOf } from '../../../../../../account/host-listings.ts';
import { clientContext } from '../../../../../../account/request.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../../../i18n.ts';
import accountStyles from '../../../../_account/account.module.css';
import { MAIN_ID } from '../../../../_shell/main-id.ts';
import styles from '../../../../host/host.module.css';
import { PayForm } from '../pay-form.tsx';
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

/**
 * S06 — retour du PSP et attente de la preuve (US-223 partie 223b, ADR-142 ; 10b S06, UX-27,
 * règles 3 et 4 ; 16 PAY-034). L'état vient de `GET /checkout/holds/{id}/payment`, fondé sur l'état
 * du hold et le trip né de la conversion, jamais sur un statut d'opération du PSP :
 * - `VERIFYING` : « Pago en verificación », progression, « No pagues de nuevo », relecture toutes les
 *   5 s, attente lente (2 min) puis support (10 min) ; « Pagar de nuevo » désactivé (ordre actif) ;
 * - `CONFIRMED` : seulement si le hold est converti et le trip né (preuve par webhook signé) ;
 * - `DECLINED` : refus du PSP, aucun débit, hold gardé jusqu'à son heure limite (lue dans l'API,
 *   aucune durée écrite) et « Pagar de nuevo » ;
 * - `ENDED` : hold échu ou libéré sans paiement (N-169 : sortie vers la recherche) ;
 * - `UNPROVEN` : hold terminé avec un ordre non prouvé : ne pas payer de nouveau, support ;
 * - `REFUND_DUE` : payé après la libération (`web.error.paidAfterRelease`, montant rendu par l'API).
 * `PAYABLE` (aucun ordre) : retour à S05.
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
  if (!isUuid(holdId)) return notFound;
  const reply = await callApi('GET', `/checkout/holds/${holdId}/payment`, ctx);
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  if (reply.status === 404) return notFound;
  const payment = checkoutPaymentOf(reply);
  if (payment?.state === 'PAYABLE') redirect(`/checkout/hold/${holdId}`);
  const hold =
    payment === null
      ? null
      : checkoutHoldOf(await callApi('GET', `/checkout/holds/${holdId}`, ctx));
  const listing =
    hold === null
      ? null
      : publicListingOf(
          await callApi('GET', `/listings/${hold.listingId}`, { ...ctx, sessionToken: null }),
        );
  if (
    payment === null ||
    hold === null ||
    listing === null ||
    listing.currency !== hold.currency ||
    listing.timezone === null
  ) {
    return (
      <Shell>
        <h1 className={accountStyles['h1']}>{t('web.s06.status.title')}</h1>
        <ErrorState
          i18n={i18n}
          message={t('web.s05.error')}
          action={<ButtonLink href={paymentHref(holdId)}>{t('web.host.retry')}</ButtonLink>}
        />
      </Shell>
    );
  }
  const tz = listing.timezone;
  const reference = t('web.s06.reference', { reference: bookingReference(payment.holdId) });
  const amount = i18n.money({
    amountMinor: hold.totalMinor,
    currency: hold.currency,
    exponent: listing.currencyExponent,
  });
  const support = (
    <section className={styles['section']} aria-labelledby="s06-support">
      <h2 id="s06-support" className={accountStyles['h2']}>
        {t('web.s06.support')}
      </h2>
      <p className={accountStyles['text']}>{t('web.s06.supportBody')}</p>
    </section>
  );
  const car = (
    <p className={styles['strong']}>{`${listing.makeName} ${listing.modelName} ${listing.year}`}</p>
  );
  const search = <ButtonLink href="/">{t('web.listing.search')}</ButtonLink>;
  let body: ReactNode;
  let title: string;
  switch (payment.state) {
    case 'CONFIRMED':
      title = t('web.s06.confirmed.title');
      body = (
        <>
          <Banner tone="success" live="polite">
            {t('web.s06.confirmed.body')}
          </Banner>
          {car}
          <p className={accountStyles['text']} data-testid="s06-reference">
            {reference}
          </p>
          <ButtonLink href={`/listings/${hold.listingId}`}>{t('web.s06.confirmed.cta')}</ButtonLink>
        </>
      );
      break;
    case 'DECLINED':
      title = t('web.s06.declined.title');
      body = (
        <>
          <Banner tone="danger" live="assertive">
            {t('web.error.paymentDeclined', { hold_end_time: i18n.time(payment.expiresAt, tz) })}
          </Banner>
          {car}
          <PayForm
            localeTag={localeTag}
            holdId={payment.holdId}
            label={t('web.s06.payAgain')}
            testId="s06-pay-again"
          />
          <p className={accountStyles['text']} data-testid="s06-reference">
            {reference}
          </p>
        </>
      );
      break;
    case 'ENDED':
      title = t('web.s06.ended.title');
      body = (
        <>
          <Banner tone="warning" live="polite">
            {t('web.s06.ended.body')}
          </Banner>
          {car}
          {search}
        </>
      );
      break;
    case 'UNPROVEN':
      title = t('web.s06.unproven.title');
      body = (
        <>
          <Banner tone="warning" live="polite">
            {t('web.s06.unproven.body')}
          </Banner>
          <p className={accountStyles['text']} data-testid="s06-reference">
            {reference}
          </p>
          {support}
        </>
      );
      break;
    case 'REFUND_DUE':
      title = t('web.s06.refund.title');
      body = (
        <>
          <Banner tone="info" live="polite">
            {t('web.error.paidAfterRelease', { amount })}
          </Banner>
          <p className={accountStyles['text']} data-testid="s06-reference">
            {reference}
          </p>
          {search}
        </>
      );
      break;
    default:
      // VERIFYING : jamais « confirmé » avant la preuve (UX-27)
      title = t('web.s06.verifying.title');
      body = (
        <>
          <LoadingState i18n={i18n} label={t('web.s06.verifying.title')} />
          <p className={accountStyles['text']} role="status">
            {t('web.s06.verifying.body')}
          </p>
          <p className={accountStyles['text']} data-testid="s06-reference">
            {reference}
          </p>
          <VerifyingWatch
            slow={`${t('web.s06.verifying.slow')} ${t('web.s06.verifying.notify')}`}
            supportTitle={t('web.s06.support')}
            supportBody={t('web.s06.supportBody')}
            reference={reference}
          />
          <ButtonLink variant="secondary" href={paymentHref(payment.holdId)}>
            {t('web.s06.refresh')}
          </ButtonLink>
          {/* un ordre est actif : « Pagar de nuevo » désactivé (anti double paiement, PAY-019) */}
          <Button variant="quiet" block disabled>
            {t('web.s06.payAgain')}
          </Button>
        </>
      );
  }
  return (
    <Shell>
      <header className={accountStyles['stackTight']}>
        <h1 className={accountStyles['h1']} data-testid="s06-title" data-state={payment.state}>
          {title}
        </h1>
      </header>
      {body}
    </Shell>
  );
}
