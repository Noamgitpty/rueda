import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi, codeOf } from '../../../../../account/api-client.ts';
import { guestTripOf } from '../../../../../account/guest-trips.ts';
import { clientContext } from '../../../../../account/request.ts';
import { UUID } from '../../../../../account/trip-contract.ts';
import { guestReceiptOf, taxPercentOf } from '../../../../../account/trip-receipt.ts';
import { getRequestBrand } from '../../../../../brand-source.ts';
import { getRequestI18n } from '../../../../../i18n.ts';
import accountStyles from '../../../_account/account.module.css';
import { MAIN_ID } from '../../../_shell/main-id.ts';
import styles from '../../../host/host.module.css';
import { GuestTripCard } from '../../guest-trip-card.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s09.receipt.title'), robots: { index: false, follow: false } };
}

/**
 * S09 · reçu — reçu du paiement du voyageur (US-217 partie 217b, ADR-161 / ADR-167 ; 19 US-217
 * critère 1, US-214 critère 2, US-212 critère 3 ; 10b S09 ; 16 FIN-018, FIN-002 ; 08 BR-PRICE-12).
 * Montants lus de `GET /trips/{id}/receipt`, jamais recalculés (PYG sans décimale) : total payé à
 * Kmino, trip fee facturé et sa taxe de ligne (rendue seulement tant que rien du trip fee n'est
 * remboursé, N-337), part remboursée et part conservée, remboursement DÛ par le règlement avec un
 * lien vers S10 pour son état et sa date d'émission (N-338 : jamais « remboursé » ici). Mention
 * d'intermédiaire entre particuliers et hôte en prénom et initiale (lus de `GET /trips/{id}`,
 * N-346). Reçu sans valeur fiscale : aucune société émettrice ni mention fiscale tant qu'ADR-013 /
 * OQ-MK-06 ne sont pas tranchées (`fiscalDocument = OFF_PLATFORM`) ; HTML accessible, sans PDF
 * (10b UX-51 admet l'HTML accessible équivalent). Trip sans paiement enregistré : « pas encore
 * disponible » (409) ; trip d'une autre personne ou inconnu : même message (404).
 */
export default async function GuestReceiptPage({
  params,
}: {
  readonly params: Promise<{ readonly tripId: string }>;
}) {
  const [i18n, { tripId }, brand] = await Promise.all([
    getRequestI18n(),
    params,
    getRequestBrand(),
  ]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  if (ctx.sessionToken === null) redirect('/login');
  const self = `/trips/${tripId}/receipt`;
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        {UUID.test(tripId) && (
          <a className={styles['link']} href={`/trips/${tripId}`}>
            {t('web.s09.receipt.back')}
          </a>
        )}
        <h1 className={accountStyles['h1']} data-testid="s09r-title">
          {t('web.s09.receipt.title')}
        </h1>
      </header>
      {body}
    </main>
  );
  const notFound = shell(
    <EmptyState icon="car" headingLevel={2} title={t('common.receipt.notFound')} />,
  );
  if (!UUID.test(tripId)) return notFound;
  const [reply, tripReply] = await Promise.all([
    callApi('GET', `/trips/${tripId}/receipt`, ctx),
    callApi('GET', `/trips/${tripId}`, ctx),
  ]);
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  if (reply.status === 404) return notFound;
  if (reply.status === 409) {
    return shell(
      <EmptyState
        icon="car"
        headingLevel={2}
        title={t('common.receipt.notReady')}
        action={<ButtonLink href={`/trips/${tripId}`}>{t('web.s09.receipt.back')}</ButtonLink>}
      />,
    );
  }
  const receipt = guestReceiptOf(reply);
  // le voyage (hôte, auto, référence) : sans lui, le reçu reste lisible sans la carte
  const trip = tripReply.status === 200 ? guestTripOf(tripReply, tripId) : null;
  if (receipt === null) {
    return shell(
      <ErrorState
        i18n={i18n}
        message={t('common.receipt.unavailable')}
        action={<ButtonLink href={self}>{t('web.contract.retry')}</ButtonLink>}
      />,
    );
  }
  const money = (amountMinor: bigint) =>
    i18n.money({ amountMinor, currency: receipt.currency, exponent: receipt.currencyExponent });
  const fee = receipt.tripFee;
  const row = (label: string, value: string, testId: string) => (
    <div className={styles['between']}>
      <span>{label}</span>
      <span className={styles['strong']} data-testid={testId}>
        {value}
      </span>
    </div>
  );
  return shell(
    <>
      {trip !== null && <GuestTripCard i18n={i18n} trip={trip} headingLevel={2} link={false} />}
      <p className={accountStyles['text']} data-testid="s09r-intermediary">
        {trip?.hostName
          ? t('web.s09.receipt.intermediary', { brand: brand.name, host: trip.hostName })
          : t('web.s09.receipt.intermediaryNoHost', { brand: brand.name })}
      </p>

      <section className={styles['section']} aria-labelledby="s09r-payment">
        <h2 id="s09r-payment" className={accountStyles['h2']}>
          {t('web.s09.receipt.payment')}
        </h2>
        {row(
          t('web.s09.receipt.totalPaid', { brand: brand.name }),
          money(receipt.totalPaidMinor),
          's09r-total',
        )}
      </section>

      {fee !== null && (
        <section className={styles['section']} aria-labelledby="s09r-fee" data-testid="s09r-fee">
          <h2 id="s09r-fee" className={accountStyles['h2']}>
            {t('web.s09.receipt.fee.title')}
          </h2>
          {row(t('web.s09.receipt.fee.charged'), money(fee.chargedMinor), 's09r-fee-charged')}
          {fee.taxMinor !== null &&
            row(
              t('web.s09.receipt.fee.tax', {
                rate:
                  fee.taxRateBps === null
                    ? '—'
                    : i18n.number(taxPercentOf(fee.taxRateBps), {
                        fractionDigits: fee.taxRateBps % 100 === 0 ? 0 : 2,
                      }),
              }),
              money(fee.taxMinor),
              's09r-fee-tax',
            )}
          {fee.refundedMinor > 0n && (
            <>
              {row(
                t('web.s09.receipt.fee.refunded'),
                money(fee.refundedMinor),
                's09r-fee-refunded',
              )}
              {row(
                t('web.s09.receipt.fee.retained', { brand: brand.name }),
                money(fee.retainedMinor),
                's09r-fee-retained',
              )}
            </>
          )}
          {fee.taxMinor === null && fee.refundedMinor > 0n && (
            <p className={styles['hint']}>{t('web.s09.receipt.fee.taxElsewhere')}</p>
          )}
        </section>
      )}

      {receipt.refundDueMinor > 0n && (
        <section
          className={styles['section']}
          aria-labelledby="s09r-refund"
          data-testid="s09r-refund"
        >
          <h2 id="s09r-refund" className={accountStyles['h2']}>
            {t('web.s09.receipt.refund.title')}
          </h2>
          {row(t('web.s09.receipt.refund.due'), money(receipt.refundDueMinor), 's09r-refund-due')}
          <p className={styles['hint']}>
            {t('web.s09.receipt.refund.hint', { brand: brand.name })}
          </p>
          <a
            className={styles['link']}
            href={`/trips/${tripId}/refund`}
            data-testid="s09r-refund-link"
          >
            {t('web.s09.receipt.refund.link')}
          </a>
        </section>
      )}

      <p className={styles['hint']} data-testid="s09r-fiscal">
        {t('web.s09.receipt.fiscal')}
      </p>
    </>,
  );
}
