import type { MinorUnitAmount, Translator } from '@rueda/i18n';
import { cx } from './internal/cx.ts';
import styles from './price.module.css';

export interface PriceProps {
  readonly i18n: Translator;
  /**
   * Total du trip TTC pour les dates saisies (10b UX-15), calculé par le devis (PRC-025) : le
   * composant ne fait **aucun calcul**, il formate seulement (`formatMoney`, US-014).
   */
  readonly total: MinorUnitAmount;
  /** Nombre de jours facturés (libellé « Precio final · {count} días »). */
  readonly days: number;
  /** Prix par jour, en secondaire (déjà calculé). */
  readonly perDay?: MinorUnitAmount | undefined;
  readonly size?: 'md' | 'lg' | undefined;
  readonly align?: 'start' | 'end' | undefined;
  /** Prix susceptible de changer (âge, option) : annoncé poliment aux lecteurs d'écran (UX-20). */
  readonly live?: boolean | undefined;
}

/** Prix final : même chiffre et même libellé en liste, sur la fiche et au checkout (anti-C3). */
export function Price({
  i18n,
  total,
  days,
  perDay,
  size = 'md',
  align = 'start',
  live,
}: PriceProps) {
  return (
    <p
      className={cx(
        styles['price'],
        size === 'lg' && styles['large'],
        align === 'end' && styles['end'],
      )}
      aria-live={live ? 'polite' : undefined}
      aria-atomic={live ? true : undefined}
    >
      <span className={styles['total']}>{i18n.money(total)}</span>
      <span className={styles['label']}>
        {i18n.t('common.price.finalForDays', { count: days })}
      </span>
      {perDay && (
        <span className={styles['perDay']}>
          {i18n.t('common.price.perDay', { amount: i18n.money(perDay) })}
        </span>
      )}
    </p>
  );
}

export interface PriceLine {
  readonly id: string;
  readonly label: string;
  readonly amount: MinorUnitAmount;
}

export interface PriceBreakdownProps {
  readonly i18n: Translator;
  /** Lignes du devis dans l'ordre de 10b UX-17 ; une remise = une ligne négative, avec sa cause. */
  readonly lines: readonly PriceLine[];
  /** Total du devis (jamais recalculé ici). */
  readonly total: MinorUnitAmount;
  readonly open?: boolean | undefined;
}

/** Détail du prix ligne par ligne, déroulant natif (clavier et lecteurs d'écran sans script). */
export function PriceBreakdown({ i18n, lines, total, open }: PriceBreakdownProps) {
  return (
    <details className={styles['breakdown']} open={open}>
      <summary className={styles['summary']}>{i18n.t('common.price.details')}</summary>
      <dl className={styles['lines']}>
        {lines.map((line) => (
          <div key={line.id} className={styles['line']}>
            <dt>{line.label}</dt>
            <dd>{i18n.money(line.amount)}</dd>
          </div>
        ))}
        <div className={cx(styles['line'], styles['lineTotal'])}>
          <dt>{i18n.t('common.price.total')}</dt>
          <dd>{i18n.money(total)}</dd>
        </div>
      </dl>
    </details>
  );
}
