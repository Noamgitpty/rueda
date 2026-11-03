import type { Translator } from '@rueda/i18n';
import { Badge } from './badge.tsx';
import { Icon } from './icon.tsx';
import { VisuallyHidden } from './internal/visually-hidden.tsx';
import styles from './rating.module.css';

export interface RatingProps {
  readonly i18n: Translator;
  /** Note moyenne sur 5 ; absente : voiture sans avis, pastille « Nuevo ». */
  readonly value?: number | undefined;
  /** Nombre de trips terminés. */
  readonly trips: number;
}

/**
 * Note de l'hôte ou de la voiture : étoile générique en `currentColor` + chiffre (10b UX-65).
 * Le chiffre est formaté par la locale (« 4,9 » / « 4.9 ») ; le lecteur d'écran entend « sur 5 ».
 */
export function Rating({ i18n, value, trips }: RatingProps) {
  const tripsText = i18n.t('common.ui.rating.trips', { count: trips });
  if (value === undefined) {
    return (
      <span className={styles['rating']}>
        <Badge tone="neutral">{i18n.t('web.s02.new')}</Badge>
        {trips > 0 && <span className={styles['trips']}>{tripsText}</span>}
      </span>
    );
  }
  const rating = i18n.number(value, { fractionDigits: 1 });
  return (
    <span className={styles['rating']}>
      <Icon name="star" />
      <span className={styles['value']} aria-hidden="true">
        {rating}
      </span>
      <VisuallyHidden>{i18n.t('common.ui.rating.label', { rating })}</VisuallyHidden>
      <span className={styles['trips']}>· {tripsText}</span>
    </span>
  );
}
