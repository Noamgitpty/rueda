/**
 * Liste d'avis publiés (US-317, ADR-190) : prénom de l'auteur (ou son rôle s'il est inconnu), note
 * globale, texte masqué par la base, date de publication au fuseau donné. Partagée par S13 / A12
 * (avis du trip, profil du voyageur), les avis reçus (droit d'accès), A13 et la fiche S03.
 */
import type { Translator } from '@rueda/i18n';
import { Badge, Icon } from '@rueda/ui';
import type { PublishedReview, ReviewSummary } from '../../../account/trip-reviews.ts';
import styles from './reviews.module.css';

const AUTHOR_KEYS = {
  GUEST: 'web.review.author.GUEST',
  HOST: 'web.review.author.HOST',
} as const;

export interface ReviewListProps {
  readonly i18n: Translator;
  readonly reviews: readonly PublishedReview[];
  /** Fuseau IANA d'affichage des dates. */
  readonly timezone: string;
  readonly testId: string;
}

export function ReviewList({ i18n, reviews, timezone, testId }: ReviewListProps) {
  const t = i18n.t.bind(i18n);
  return (
    <ul className={styles['list']} data-testid={testId}>
      {reviews.map((r) => (
        <li key={`${r.authorRole}-${r.publishedAt}`} className={styles['review']}>
          <p className={styles['author']}>{r.authorName ?? t(AUTHOR_KEYS[r.authorRole])}</p>
          <p className={styles['meta']}>
            <Icon name="star" /> {t('web.review.stars', { count: r.overall })}
            {' · '}
            <time dateTime={r.publishedAt}>{i18n.date(r.publishedAt, timezone)}</time>
          </p>
          {r.text !== null && <p className={styles['body']}>{r.text}</p>}
        </li>
      ))}
    </ul>
  );
}

/** Résumé d'une série d'avis : moyenne sur 5 et nombre d'avis ; sans avis, badge « Nuevo ». */
export function ReviewSummaryLine({
  i18n,
  summary,
  testId,
}: {
  readonly i18n: Translator;
  readonly summary: ReviewSummary;
  readonly testId: string;
}) {
  const t = i18n.t.bind(i18n);
  return (
    <p className={styles['meta']} data-testid={testId}>
      {summary.averageX100 === null ? (
        <Badge tone="neutral">{t('web.s02.new')}</Badge>
      ) : (
        <>
          <Icon name="star" /> {i18n.number(summary.averageX100 / 100, { fractionDigits: 1 })}
          {' · '}
          {t('web.reviews.count', { count: summary.reviewCount })}
        </>
      )}
    </p>
  );
}
