import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import type { MessageKey } from '@rueda/i18n';
import { callApi, codeOf } from '../../../../../account/api-client.ts';
import { checkoutHoldOf, holdPayable, isUuid } from '../../../../../account/checkout.ts';
import {
  checkoutPaymentOf,
  depositRefusalMessage,
  paymentHref,
} from '../../../../../account/checkout-payment.ts';
import { publicListingOf } from '../../../../../account/host-listings.ts';
import { clientContext } from '../../../../../account/request.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../../i18n.ts';
import accountStyles from '../../../_account/account.module.css';
import { MAIN_ID } from '../../../_shell/main-id.ts';
import styles from '../../../host/host.module.css';
import { PayForm } from './pay-form.tsx';
import { StateAnnouncer } from './payment/state-announcer.tsx';
import { ReviewWatch } from './review-watch.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s05.hold.title'), robots: { index: false, follow: false } };
}

function Shell({ children }: { readonly children: ReactNode }) {
  return (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      {children}
    </main>
  );
}

/** Titre de la revue (S05, US-209c) : reçoit le focus quand l'état de revue change. */
const REVIEW_TITLE_ID = 's05-review-title';

const DOC_LABEL: Readonly<Record<string, MessageKey>> = {
  TOS_GUEST: 'web.s05.doc.TOS_GUEST',
  CANCELLATION_POLICY: 'web.s05.doc.CANCELLATION_POLICY',
  GEO_TERMS: 'web.s05.doc.GEO_TERMS',
};

/**
 * S05 — hold posé (US-208, partie 208b ; 10b UX `web.s05.hold.until`) : l'auto est gardé pour le
 * voyageur jusqu'à l'heure d'expiration du hold (heure du lieu), avec le total du devis engagé et
 * la version exacte de chaque document accepté (19 US-208 critère 3, relu par
 * `GET /checkout/holds/{id}`).
 *
 * US-223 partie 223b (ADR-142 ; 10b S05, UX-26) : bouton « Pagar {amount} » (total rendu par l'API)
 * et pré-écran court (« Vas a pagar {amount} en una página segura… ») ; un hold qui n'est plus
 * ACTIVE (paiement en cours, payé, échu, libéré) ouvre S06, dont l'état fait foi (N-169).
 *
 * US-209 partie 209c (ADR-144 ; 10b S05, UX-35 ; N-203) : un hold en revue avant le débit
 * (`reviewState` = PENDING) dit « Reserva en revisión: no se te cobró nada » et l'heure de la
 * réponse (échéance du hold de revue, lue dans l'API : aucune durée écrite), se relit seul et
 * n'offre AUCUN bouton « Pagar » ; approuvé (APPROVED), il dit la fenêtre de paiement réelle
 * (échéance prolongée par la décision) et « Pagar » revient. Le passage d'un état à l'autre est
 * annoncé par une région vive persistante et le focus passe au titre de la revue.
 */
export default async function HoldPage({
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
      <h1 className={accountStyles['h1']}>{t('web.s05.hold.title')}</h1>
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
  const reply = await callApi('GET', `/checkout/holds/${holdId}`, ctx);
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  if (reply.status === 404) return notFound;
  const hold = checkoutHoldOf(reply);
  // paiement en cours, payé, échu ou libéré : l'état du paiement (S06) fait foi
  if (hold !== null && hold.status !== 'ACTIVE') redirect(paymentHref(hold.holdId));
  // US-223d (ADR-152) : un hold payable est-il une demande à l'hôte ? Seul le paiement le dit
  // (`request`, hold REQUEST) ; lu avec la fiche, jamais déduit du mode actuel de l'annonce
  const payable = hold !== null && holdPayable(hold);
  const [listingReply, paymentReply] =
    hold === null
      ? [null, null]
      : await Promise.all([
          callApi('GET', `/listings/${hold.listingId}`, { ...ctx, sessionToken: null }),
          payable ? callApi('GET', `/checkout/holds/${holdId}/payment`, ctx) : null,
        ]);
  const listing = listingReply === null ? null : publicListingOf(listingReply);
  const payment = paymentReply === null ? null : checkoutPaymentOf(paymentReply);
  if (
    hold === null ||
    listing === null ||
    listing.currency !== hold.currency ||
    listing.timezone === null ||
    // type du hold illisible : ni « Pagar » ni « Enviar solicitud » (fail-closed)
    (payable && payment === null)
  ) {
    return (
      <Shell>
        <h1 className={accountStyles['h1']}>{t('web.s05.hold.title')}</h1>
        <ErrorState
          i18n={i18n}
          message={t('web.s05.error')}
          action={<ButtonLink href={`/checkout/hold/${holdId}`}>{t('web.host.retry')}</ButtonLink>}
        />
      </Shell>
    );
  }
  const tz = listing.timezone;
  // heure limite rendue par l'API : réponse de la revue, ou fin de la fenêtre de paiement
  const until = i18n.time(hold.expiresAt, tz);
  const announce =
    hold.reviewState === 'PENDING'
      ? `${t('web.s05.review.title')}. ${t('web.s05.review.until', { time: until })}`
      : hold.reviewState === 'APPROVED'
        ? `${t('web.s05.review.approvedTitle')}. ${t('web.s05.review.approvedBody', { time: until })}`
        : '';
  // total du devis engagé, tel que la base l'a rejoué (jamais recalculé ici)
  const amount = i18n.money({
    amountMinor: hold.totalMinor,
    currency: hold.currency,
    exponent: listing.currencyExponent,
  });
  // US-701 (ADR-169 ; 08 BR-PAY-06) : caution décidée AVANT le paiement, rendue par l'API (montant,
  // nature, libération ; jamais les déclencheurs) ; réservation impossible ⇒ aucun bouton « Pagar »
  const deposit = payment?.deposit ?? null;
  const depositBlocked = deposit?.status === 'UNAVAILABLE';
  const depositRefusal = deposit?.status === 'UNAVAILABLE' ? depositRefusalMessage(deposit) : null;
  return (
    <Shell>
      <StateAnnouncer
        state={hold.reviewState}
        message={announce}
        focusId={REVIEW_TITLE_ID}
        testId="s05-live"
      />
      <header className={accountStyles['stackTight']}>
        <h1 className={accountStyles['h1']}>{t('web.s05.hold.title')}</h1>
      </header>
      {hold.reviewState === 'PENDING' ? (
        // revue avant le débit (UXQ-08) : aucun paiement possible, réponse à l'heure lue dans l'API
        <section
          className={styles['section']}
          aria-labelledby={REVIEW_TITLE_ID}
          data-testid="s05-review"
          data-state="PENDING"
        >
          <h2 id={REVIEW_TITLE_ID} tabIndex={-1} className={accountStyles['h2']}>
            {t('web.s05.review.title')}
          </h2>
          <p className={accountStyles['text']}>{t('web.s05.review.until', { time: until })}</p>
          <p className={accountStyles['muted']}>{t('web.s05.review.comeBack')}</p>
          <ReviewWatch until={hold.expiresAt} />
          <ButtonLink variant="secondary" href={`/checkout/hold/${hold.holdId}`}>
            {t('web.s06.refresh')}
          </ButtonLink>
          <p className={accountStyles['muted']}>{t('web.s05.review.entryHint')}</p>
          <ButtonLink variant="quiet" href="/verify-identity/entry">
            {t('web.s04.entry.open')}
          </ButtonLink>
        </section>
      ) : hold.reviewState === 'APPROVED' ? (
        <section
          className={styles['section']}
          aria-labelledby={REVIEW_TITLE_ID}
          data-testid="s05-review"
          data-state="APPROVED"
        >
          <h2 id={REVIEW_TITLE_ID} tabIndex={-1} className={accountStyles['h2']}>
            {t('web.s05.review.approvedTitle')}
          </h2>
          <Banner tone="success" live="off">
            {t('web.s05.review.approvedBody', { time: until })}
          </Banner>
        </section>
      ) : (
        <Banner tone="success" live="polite">
          {t('web.s05.hold.until', { time: until })}
        </Banner>
      )}
      <section className={styles['section']} aria-labelledby="s05-hold-trip">
        <h2 id="s05-hold-trip" className={accountStyles['h2']}>
          {t('web.s05.summary.title')}
        </h2>
        <p className={styles['strong']}>
          {`${listing.makeName} ${listing.modelName} ${listing.year}`}
        </p>
        <dl className={accountStyles['stackTight']}>
          <div>
            <dt className={accountStyles['muted']}>{t('web.s05.summary.pickup')}</dt>
            <dd className={accountStyles['text']}>{i18n.dateTime(hold.startAt, tz)}</dd>
          </div>
          <div>
            <dt className={accountStyles['muted']}>{t('web.s05.summary.return')}</dt>
            <dd className={accountStyles['text']}>{i18n.dateTime(hold.endAt, tz)}</dd>
          </div>
        </dl>
        <p className={styles['price']} data-testid="s05-hold-total">
          {t('web.s05.hold.total', { amount })}
        </p>
      </section>
      <section className={styles['section']} aria-labelledby="s05-hold-docs">
        <h2 id="s05-hold-docs" className={accountStyles['h2']}>
          {t('web.s05.hold.documents')}
        </h2>
        <ul className={styles['list']} data-testid="s05-hold-documents">
          {hold.documents.map((d) => (
            <li key={d.kind}>
              {t('web.s05.hold.accepted', {
                document: t(DOC_LABEL[d.kind] ?? 'web.s05.doc.TOS_GUEST'),
                version: String(d.version),
              })}
            </li>
          ))}
        </ul>
      </section>
      {/* US-701 : caution de la plateforme (10b §3.5, UX-24) : aucune, montant et libération au plus
          tard, ou refus avant le paiement avec les jours possibles et une sortie */}
      {deposit !== null && (
        <section
          className={styles['section']}
          aria-labelledby="s05-deposit-title"
          data-testid="s05-deposit"
          data-state={deposit.status}
        >
          <h2 id="s05-deposit-title" className={accountStyles['h2']}>
            {t('web.s03.deposit.title')}
          </h2>
          {deposit.status === 'NONE' && (
            <p className={accountStyles['text']}>{t('web.deposit.none')}</p>
          )}
          {deposit.status === 'REQUIRED' && (
            <>
              <dl className={accountStyles['stackTight']}>
                <div>
                  <dt className={accountStyles['muted']}>{t('web.deposit.amount')}</dt>
                  <dd className={styles['strong']} data-testid="s05-deposit-amount">
                    {i18n.money({
                      amountMinor: deposit.amountMinor,
                      currency: deposit.currency,
                      exponent: listing.currencyExponent,
                    })}
                  </dd>
                </div>
              </dl>
              <p className={accountStyles['text']}>
                {t(
                  deposit.kind === 'CHARGE'
                    ? 'web.deposit.how.chargeRefund'
                    : 'web.deposit.how.preauth',
                )}
              </p>
              <p className={accountStyles['muted']}>
                {t('web.deposit.releaseBy', { date: i18n.dateTime(deposit.releaseAt, tz) })}
              </p>
            </>
          )}
          {depositRefusal !== null && (
            <>
              <Banner tone="danger" live="assertive">
                {depositRefusal.key === 'web.deposit.unavailable'
                  ? t(depositRefusal.key, { count: depositRefusal.count })
                  : t(depositRefusal.key)}
              </Banner>
              {/* US-702 (revue ux d'US-701) : sortie vers la recherche elle-même, autres dates ou
                  autre voiture */}
              <ButtonLink variant="secondary" href="/search">
                {t('web.listing.search')}
              </ButtonLink>
            </>
          )}
        </section>
      )}
      {/* US-223b : paiement sur la page hébergée du PSP (10b UX-26), montant rendu par l'API ;
          jamais pendant une revue avant le débit (US-209c, N-203) ; jamais si la caution est
          impossible (US-701) */}
      {payable && !depositBlocked && payment?.request === null && (
        <section className={styles['section']} aria-labelledby="s05-pay-title">
          <h2 id="s05-pay-title" className={accountStyles['h2']}>
            {t('web.s05.pay.title')}
          </h2>
          <p className={accountStyles['text']}>{t('web.s06.pre.leaving', { amount })}</p>
          <PayForm
            localeTag={localeTag}
            holdId={hold.holdId}
            label={t('web.s05.cta', { amount })}
            testId="s05-pay"
            mitConsentMode={payment?.mitConsentMode ?? null}
          />
        </section>
      )}
      {/* US-223d : demande à l'hôte (10b S05 `web.s05.ctaRequest`) : le paiement est autorisé sur
          la page du PSP, débité seulement si l'hôte accepte (ADR-146) */}
      {payable && !depositBlocked && payment !== null && payment.request !== null && (
        <section
          className={styles['section']}
          aria-labelledby="s05-pay-title"
          data-testid="s05-request"
        >
          <h2 id="s05-pay-title" className={accountStyles['h2']}>
            {t('web.s05.request.title')}
          </h2>
          <p className={accountStyles['text']}>
            {t('web.s05.request.authorize', {
              amount,
              host_name: listing.hostFirstName ?? t('web.s07.request.hostFallback'),
            })}
          </p>
          <PayForm
            localeTag={localeTag}
            holdId={hold.holdId}
            label={t('web.s05.ctaRequest')}
            testId="s05-pay"
            mitConsentMode={payment?.mitConsentMode ?? null}
          />
        </section>
      )}
      <ButtonLink variant="quiet" href={`/listings/${hold.listingId}`}>
        {t('web.s05.back')}
      </ButtonLink>
    </Shell>
  );
}
