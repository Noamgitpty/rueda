import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi } from '../../../account/api-client.ts';
import { clientContext } from '../../../account/request.ts';
import { receivedReviewsOf } from '../../../account/trip-reviews.ts';
import type { ReviewSummary } from '../../../account/trip-reviews.ts';
import { getRequestI18n } from '../../../i18n.ts';
import accountStyles from '../_account/account.module.css';
import { ReviewList, ReviewSummaryLine } from '../_reviews/review-list.tsx';
import { MAIN_ID } from '../_shell/main-id.ts';
import hostStyles from '../host/host.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.reviews.received.title'), robots: { index: false, follow: false } };
}

/**
 * Avis reçus par la personne de la session (US-317, ADR-190 ; 19 US-317 critère 3 : avis de
 * l'hôte « consultable par lui », droit d'accès, Ley 81) : avis PUBLIÉS sur elle comme voyageur et,
 * si elle est hôte, comme hôte ; prénom de l'auteur seulement. Dates en UTC (l'avis n'est pas
 * rattaché ici au fuseau d'un trip ; aucune constante de pays). Lecture seule.
 */
export default async function ReceivedReviewsPage() {
  const i18n = await getRequestI18n();
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  if (ctx.sessionToken === null) redirect('/login');
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={hostStyles['link']} href="/trips">
          {t('web.review.back')}
        </a>
        <h1 className={accountStyles['h1']} data-testid="reviews-title">
          {t('web.reviews.received.title')}
        </h1>
        <p className={accountStyles['muted']}>{t('web.reviews.received.intro')}</p>
      </header>
      {body}
    </main>
  );
  const reply = await callApi('GET', '/reviews/received', ctx);
  if (reply.status === 401) redirect('/login');
  const view = receivedReviewsOf(reply);
  if (view === null) {
    return shell(
      <ErrorState
        i18n={i18n}
        message={t('web.review.loadError')}
        action={<ButtonLink href="/reviews">{t('web.review.retry')}</ButtonLink>}
      />,
    );
  }
  const block = (id: string, title: string, summary: ReviewSummary) => (
    <section className={hostStyles['section']} aria-labelledby={id} data-testid={id}>
      <h2 id={id} className={accountStyles['h2']}>
        {title}
      </h2>
      <ReviewSummaryLine i18n={i18n} summary={summary} testId={`${id}-summary`} />
      {summary.reviews.length === 0 ? (
        <p className={accountStyles['muted']}>{t('web.reviews.received.empty')}</p>
      ) : (
        <ReviewList i18n={i18n} reviews={summary.reviews} timezone="UTC" testId={`${id}-list`} />
      )}
    </section>
  );
  const empty = view.asGuest.reviewCount === 0 && (view.asHost?.reviewCount ?? 0) === 0;
  return shell(
    <>
      {empty && <EmptyState icon="car" headingLevel={2} title={t('web.reviews.received.empty')} />}
      {block('reviews-as-guest', t('web.reviews.received.asGuest'), view.asGuest)}
      {view.asHost !== null &&
        block('reviews-as-host', t('web.reviews.received.asHost'), view.asHost)}
    </>,
  );
}
