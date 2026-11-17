import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi, codeOf } from '../../../../../account/api-client.ts';
import { clientContext } from '../../../../../account/request.ts';
import { UUID } from '../../../../../account/trip-contract.ts';
import { phaseOf, tripRefundsOf } from '../../../../../account/trip-refunds.ts';
import type { RefundRail } from '../../../../../account/trip-refunds.ts';
import { getRequestI18n } from '../../../../../i18n.ts';
import accountStyles from '../../../_account/account.module.css';
import { RefundPhaseLines } from '../../../_refund/refund-phase.tsx';
import { MAIN_ID } from '../../../_shell/main-id.ts';
import styles from '../../../host/host.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s10.refund.title'), robots: { index: false, follow: false } };
}

const RAIL_KEYS = {
  NATIVE_PARTIAL: 'web.s10.refund.rail.NATIVE_PARTIAL',
  ROLLBACK_AND_RECHARGE: 'web.s10.refund.rail.ROLLBACK_AND_RECHARGE',
  BANK_TRANSFER: 'web.s10.refund.rail.BANK_TRANSFER',
  CREDIT_CASH: 'web.s10.refund.rail.CREDIT_CASH',
} as const satisfies Readonly<Record<RefundRail, string>>;

/**
 * S10 · remboursement — ce que le voyageur reçoit après l'annulation de son voyage (US-224 partie
 * 224d, ADR-154 ; 19 US-224 critère 1 ; 10b S10 « {brand} rembourse, par jambe, sur le moyen
 * d'origine, date d'émission promise », UX-31 ; 08 BR-PAY-08). Kmino rembourse lui-même le montant
 * calculé par le règlement, sans attendre l'hôte ; chaque remboursement montre son montant (lu de
 * l'API, jamais recalculé), le moyen (rail), son état et, une fois émis, sa date d'émission dans le
 * fuseau du voyage (jamais une date de réception). Un voyage d'une autre personne, ou inconnu, rend
 * le même message (404 de l'API, rien n'est révélé). Lecture seule : l'annulation par le voyageur
 * reste une demande au support jusqu'au lot 5 (10b S10).
 */
export default async function TripRefundPage({
  params,
}: {
  readonly params: Promise<{ readonly tripId: string }>;
}) {
  const [i18n, { tripId }] = await Promise.all([getRequestI18n(), params]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  if (ctx.sessionToken === null) redirect('/login');
  const self = `/trips/${tripId}/refund`;
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <h1 className={accountStyles['h1']} data-testid="s10-refund-title">
          {t('web.s10.refund.title')}
        </h1>
      </header>
      {body}
    </main>
  );
  const notFound = shell(
    <EmptyState icon="car" headingLevel={2} title={t('common.refund.notFound')} />,
  );
  if (!UUID.test(tripId)) return notFound;
  const reply = await callApi('GET', `/trips/${tripId}/refunds`, ctx);
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  if (reply.status === 404) return notFound;
  const view = tripRefundsOf(reply);
  if (view === null || view.viewerRole !== 'GUEST') {
    return shell(
      <ErrorState
        i18n={i18n}
        message={t('web.s10.refund.loadError')}
        action={<ButtonLink href={self}>{t('web.contract.retry')}</ButtonLink>}
      />,
    );
  }
  const shown = view.refunds.flatMap((r) => {
    const phase = phaseOf(r.status);
    return phase === null ? [] : [{ ...r, phase }];
  });
  if (shown.length === 0) {
    return shell(
      <EmptyState
        icon="car"
        headingLevel={2}
        title={t('web.s10.refund.none')}
        body={t('web.s10.refund.noneHint')}
      />,
    );
  }
  const money = (minor: string) =>
    i18n.money({
      amountMinor: BigInt(minor),
      currency: view.currency,
      exponent: view.currencyExponent,
    });
  return shell(
    <>
      <p className={accountStyles['text']}>{t('web.s10.refund.lead')}</p>
      <ul className={styles['rows']} data-testid="s10-refunds">
        {shown.map((r) => (
          <li key={`${r.plannedAt}-${r.amountMinor}`} className={styles['card']}>
            <div className={styles['between']}>
              <span>{t('web.s10.refund.amount')}</span>
              <span className={styles['strong']} data-testid="s10-refund-amount">
                {money(r.amountMinor)}
              </span>
            </div>
            <RefundPhaseLines
              i18n={i18n}
              phase={r.phase}
              issuedAt={r.issuedAt}
              timezone={view.timezone}
              bankDelay
            />
            <p className={styles['hint']}>{t(RAIL_KEYS[r.rail])}</p>
          </li>
        ))}
      </ul>
    </>,
  );
}
