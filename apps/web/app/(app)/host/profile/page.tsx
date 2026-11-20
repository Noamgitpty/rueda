import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { ButtonLink, EmptyState, ErrorState, HostCard } from '@rueda/ui';
import { callApi } from '../../../../account/api-client.ts';
import { clientContext } from '../../../../account/request.ts';
import { memberYearOf, ratingOf, receivedReviewsOf } from '../../../../account/trip-reviews.ts';
import { getRequestI18n } from '../../../../i18n.ts';
import accountStyles from '../../_account/account.module.css';
import { ReviewList } from '../../_reviews/review-list.tsx';
import { MAIN_ID } from '../../_shell/main-id.ts';
import styles from '../host.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.a13.title'), robots: { index: false, follow: false } };
}

/**
 * A13 — profil public de l'hôte, aperçu tel que le voient les voyageurs (US-317, ADR-190 ; 10b A13 ;
 * 16 LST-020) : bloc de l'hôte de la fiche (prénom, note ou badge « Nuevo », trips réalisés,
 * ancienneté) et avis publiés des voyageurs. La présentation, la promesse et les langues (10b A13)
 * relèvent d'une suite. Lecture seule ; prénom seulement.
 */
export default async function HostPublicProfilePage() {
  const i18n = await getRequestI18n();
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  if (ctx.sessionToken === null) redirect('/login');
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={styles['link']} href="/host">
          {t('web.a05.back')}
        </a>
        <h1 className={accountStyles['h1']} data-testid="a13-title">
          {t('web.a13.title')}
        </h1>
        <p className={accountStyles['muted']}>{t('web.a13.preview')}</p>
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
        action={<ButtonLink href="/host/profile">{t('web.review.retry')}</ButtonLink>}
      />,
    );
  }
  const host = view.asHost;
  if (host === null || host.firstName === null) {
    return shell(<EmptyState icon="car" headingLevel={2} title={t('web.host.loginRequired')} />);
  }
  return shell(
    <>
      <HostCard
        i18n={i18n}
        id="a13-host"
        name={host.firstName}
        rating={ratingOf(host.averageX100)}
        trips={host.tripCount}
        memberSince={memberYearOf(host.memberSince)}
        verified={false}
      />
      <section
        className={styles['section']}
        aria-labelledby="a13-reviews"
        data-testid="a13-reviews"
      >
        <h2 id="a13-reviews" className={accountStyles['h2']}>
          {t('web.a13.reviews')}
        </h2>
        {host.reviews.length === 0 ? (
          <p className={accountStyles['muted']}>{t('web.reviews.received.empty')}</p>
        ) : (
          <ReviewList i18n={i18n} reviews={host.reviews} timezone="UTC" testId="a13-reviews-list" />
        )}
      </section>
    </>,
  );
}
