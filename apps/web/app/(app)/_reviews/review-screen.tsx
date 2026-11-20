/**
 * S13 (voyageur) et A12 (hôte) — avis d'un trip (US-317, ADR-190 ; 16 REV-001, REV-002, REV-004 ;
 * 10b S13 / A12) : écran commun au voyageur (`/trips/{id}/review`) et à l'hôte
 * (`/host/trips/{id}/review`). La partie est celle de la session, jugée par l'API et la base
 * (voyageur ou titulaire du compte d'hôte) ; un trip dont la session n'est pas partie rend le même
 * message qu'un trip inconnu.
 *
 * Contenu (10b S13 / A12, §4.3) : fenêtre rendue en date (`web.review.until`), double aveugle
 * (`web.review.blind` : l'autre partie ne verra rien avant que les deux aient noté ou que la
 * fenêtre soit passée), formulaire (note, sous-notes, texte exigé de 1 à 3), avis public sur le
 * profil du voyageur (A12) ou sur l'annonce et le profil de l'hôte (S13) ; après l'envoi, MON avis
 * (en attente ou publié) ; avis PUBLIÉS du trip ; pour l'hôte, profil du voyageur (avis des autres
 * hôtes). Fenêtre close : `web.review.closed`. Jamais l'avis scellé de l'autre partie : l'API ne le
 * sert pas. Rendu serveur ; jamais une note ni un texte dans une URL.
 */
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Badge, Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi, codeOf } from '../../../account/api-client.ts';
import { clientContext } from '../../../account/request.ts';
import { reviewDoneFromQuery, reviewPath, tripReviewsOf } from '../../../account/trip-reviews.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../i18n.ts';
import accountStyles from '../_account/account.module.css';
import { MAIN_ID } from '../_shell/main-id.ts';
import hostStyles from '../host/host.module.css';
import { ReviewForm } from './review-form.tsx';
import { ReviewList, ReviewSummaryLine } from './review-list.tsx';
import styles from './reviews.module.css';

const DONE_KEYS = {
  SUBMITTED: 'web.review.done.SUBMITTED',
  PUBLISHED: 'web.review.done.PUBLISHED',
} as const;
const STATUS_KEYS = {
  SUBMITTED: 'web.review.status.SUBMITTED',
  PUBLISHED: 'web.review.status.PUBLISHED',
} as const;

export interface ReviewScreenProps {
  readonly scope: 'guest' | 'host';
  readonly tripId: string;
  /** Retour au détail du trip (S09 ou A05). */
  readonly back: string;
  /** Compte d'hôte de la requête (`?org=`), gardé par le formulaire ; `null` côté voyageur. */
  readonly org: string | null;
  readonly query: Readonly<Record<string, string | string[] | undefined>>;
}

export async function ReviewScreen({ scope, tripId, back, org, query }: ReviewScreenProps) {
  const [i18n, localeTag] = await Promise.all([getRequestI18n(), getRequestLocaleTag()]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  if (ctx.sessionToken === null) redirect('/login');
  const self = reviewPath(scope, tripId);
  const heading = t(scope === 'guest' ? 'web.review.heading.guest' : 'web.review.heading.host');
  const shell = (subtitle: string, body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={hostStyles['link']} href={back}>
          {t('web.review.back')}
        </a>
        <h1 className={accountStyles['h1']} data-testid="review-title">
          {heading}
        </h1>
        <p className={accountStyles['muted']}>{subtitle}</p>
      </header>
      {body}
    </main>
  );
  const notFound = shell(
    t('web.review.withUnknown'),
    <EmptyState icon="car" headingLevel={2} title={t('common.trips.notFound')} />,
  );
  if (self === null) return notFound;
  const reply = await callApi('GET', `/trips/${tripId}/reviews`, ctx);
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  if (reply.status === 404) return notFound;
  const view = tripReviewsOf(reply, tripId);
  if (view === null) {
    const retry = org === null ? self : `${self}?org=${org}`;
    return shell(
      t('web.review.withUnknown'),
      <ErrorState
        i18n={i18n}
        message={t('web.review.loadError')}
        action={<ButtonLink href={retry}>{t('web.review.retry')}</ButtonLink>}
      />,
    );
  }
  const name = view.counterpartName;
  const other = name ?? t(scope === 'guest' ? 'web.review.author.HOST' : 'web.review.author.GUEST');
  const done = reviewDoneFromQuery(query['rv']);
  const closed =
    view.mine === null &&
    !view.canSubmit &&
    view.endedAt !== null &&
    view.closesAt !== null &&
    Date.now() >= Date.parse(view.closesAt);
  return shell(
    name === null ? t('web.review.withUnknown') : t('web.review.with', { name }),
    <>
      {done !== null && (
        <div data-testid="review-done">
          <Banner tone="success" live="polite">
            {t(DONE_KEYS[done])}
          </Banner>
        </div>
      )}

      {view.mine !== null ? (
        <section
          className={hostStyles['section']}
          aria-labelledby="review-mine"
          data-testid="review-mine"
        >
          <h2 id="review-mine" className={accountStyles['h2']}>
            {t('web.review.mine')}
          </h2>
          <div className={styles['review']}>
            <p className={styles['meta']}>
              <Badge tone={view.mine.status === 'PUBLISHED' ? 'success' : 'neutral'}>
                {t(STATUS_KEYS[view.mine.status])}
              </Badge>
            </p>
            <p className={styles['author']}>
              {t('web.review.stars', { count: view.mine.overall })}
            </p>
            {view.mine.text !== null && <p className={styles['body']}>{view.mine.text}</p>}
            {view.mine.contactMasked && <p className={styles['hint']}>{t('web.review.masked')}</p>}
          </div>
        </section>
      ) : view.canSubmit && view.closesAt !== null ? (
        <section
          className={hostStyles['section']}
          aria-labelledby="review-new"
          data-testid="review-new"
        >
          <h2 id="review-new" className={accountStyles['h2']}>
            {t('web.review.until', { date: i18n.date(view.closesAt, view.timezone) })}
          </h2>
          <div data-testid="review-blind">
            <Banner tone="info">
              {t('web.review.blind', { name: other, count: view.windowDays ?? 0 })}
            </Banner>
          </div>
          <p className={styles['hint']}>
            {t(scope === 'guest' ? 'web.review.public.host' : 'web.review.public.guest')}
          </p>
          <ReviewForm localeTag={localeTag} scope={scope} tripId={tripId} org={org} />
        </section>
      ) : (
        <p className={accountStyles['muted']} data-testid="review-unavailable">
          {closed && view.closesAt !== null
            ? t('web.review.closed', { date: i18n.date(view.closesAt, view.timezone) })
            : view.endedAt === null
              ? t('common.reviews.notOpen')
              : t('common.reviews.windowClosed')}
        </p>
      )}

      <section
        className={hostStyles['section']}
        aria-labelledby="review-published"
        data-testid="review-published"
      >
        <h2 id="review-published" className={accountStyles['h2']}>
          {t('web.review.published')}
        </h2>
        {view.published.length === 0 ? (
          <p className={accountStyles['muted']}>{t('web.review.publishedEmpty')}</p>
        ) : (
          <ReviewList
            i18n={i18n}
            reviews={view.published}
            timezone={view.timezone}
            testId="review-published-list"
          />
        )}
      </section>

      {scope === 'host' && view.guestProfile !== null && (
        <section
          className={hostStyles['section']}
          aria-labelledby="review-guest-profile"
          data-testid="review-guest-profile"
        >
          <h2 id="review-guest-profile" className={accountStyles['h2']}>
            {t('web.review.guestProfile', { name: other })}
          </h2>
          <ReviewSummaryLine
            i18n={i18n}
            summary={view.guestProfile}
            testId="review-guest-profile-summary"
          />
          {view.guestProfile.reviews.length === 0 ? (
            <p className={accountStyles['muted']}>{t('web.review.guestProfileEmpty')}</p>
          ) : (
            <ReviewList
              i18n={i18n}
              reviews={view.guestProfile.reviews}
              timezone={view.timezone}
              testId="review-guest-profile-list"
            />
          )}
        </section>
      )}
    </>,
  );
}
