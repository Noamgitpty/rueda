import type { ReactNode } from 'react';
import type { MinorUnitAmount, Translator } from '@rueda/i18n';
import { Avatar } from './avatar.tsx';
import type { AvatarTone } from './avatar.tsx';
import styles from './card.module.css';
import { CarIllustration } from './car-illustration.tsx';
import type { CarKind } from './car-illustration.tsx';
import { Icon } from './icon.tsx';
import { cx } from './internal/cx.ts';
import { Price } from './price.tsx';
import { Rating } from './rating.tsx';
import { Skeleton } from './skeleton.tsx';

export interface CarCardProps {
  readonly i18n: Translator;
  /** Lien vers la fiche (S03). */
  readonly href: string;
  /** Modèle et année : « Toyota Yaris 2021 ». */
  readonly title: string;
  readonly host: { readonly name: string; readonly tone?: AvatarTone | undefined };
  /** Note moyenne ; absente : « Nuevo ». */
  readonly rating?: number | undefined;
  readonly trips: number;
  /** Quartier (donnée de l'annonce). */
  readonly place?: string | undefined;
  /** Distance au point de recherche, en km (affichée avec une décimale). */
  readonly distanceKm?: number | undefined;
  /** Total du trip TTC (devis) et prix par jour : déjà calculés, seulement formatés ici. */
  readonly total: MinorUnitAmount;
  readonly perDay: MinorUnitAmount;
  readonly days: number;
  /** Photo de l'hôte ou illustration ; défaut : voiture dessinée. */
  readonly media?: ReactNode;
  /** Bouton « enregistrer » (un `IconButton`, rendu par l'application cliente). */
  readonly saveAction?: ReactNode;
  readonly headingLevel?: 2 | 3 | 4 | undefined;
  readonly carTone?: 1 | 2 | 3 | 4 | undefined;
  /** Silhouette du véhicule (citadine, berline, SUV, pick-up, monospace). */
  readonly carKind?: CarKind | undefined;
}

/**
 * Carte de voiture (S02, 10b UX-65) : la voiture précise et son hôte, note, trips, quartier et
 * distance, prix final du trip et prix par jour. Toute la carte mène à la fiche (lien étiré, une
 * seule tabulation) ; le bouton « enregistrer » reste au-dessus du lien.
 */
export function CarCard({
  i18n,
  href,
  title,
  host,
  rating,
  trips,
  place,
  distanceKm,
  total,
  perDay,
  days,
  media,
  saveAction,
  headingLevel = 3,
  carTone,
  carKind,
}: CarCardProps) {
  const Heading = `h${headingLevel}` as const;
  const distance =
    distanceKm === undefined
      ? undefined
      : i18n.t('common.ui.distance', { distance: i18n.number(distanceKm, { fractionDigits: 1 }) });
  const where = [place, distance].filter((part): part is string => Boolean(part)).join(' · ');
  return (
    <article className={cx(styles['card'], styles['interactive'])}>
      <div className={styles['media']}>
        {media ?? <CarIllustration tone={carTone} kind={carKind} />}
      </div>
      {saveAction && <div className={styles['save']}>{saveAction}</div>}
      <div className={styles['body']}>
        <Heading className={styles['title']}>
          <a className={styles['link']} href={href}>
            {title}
          </a>
        </Heading>
        <div className={styles['meta']}>
          <span className={styles['host']}>
            <Avatar name={host.name} size="sm" tone={host.tone} />
            {host.name}
          </span>
          <Rating i18n={i18n} value={rating} trips={trips} />
        </div>
        {where !== '' && (
          <p className={styles['meta']}>
            <span className={styles['place']}>
              <Icon name="pin" />
              {where}
            </span>
          </p>
        )}
        <Price i18n={i18n} total={total} perDay={perDay} days={days} />
      </div>
    </article>
  );
}

/** Carte de voiture en chargement, même gabarit (aucun saut à l'arrivée des données). */
export function CarCardSkeleton() {
  return (
    <div className={styles['card']} aria-hidden="true">
      <Skeleton shape="block" />
      <div className={styles['skeletonBody']}>
        <Skeleton width="long" />
        <span className={styles['skeletonRow']}>
          <Skeleton shape="circle" />
          <Skeleton width="medium" />
        </span>
        <Skeleton width="short" />
      </div>
    </div>
  );
}
