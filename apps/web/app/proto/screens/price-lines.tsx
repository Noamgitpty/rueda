/**
 * Lignes du prix final, toujours visibles (revue UX US-033) : location, frais de service, protection,
 * taxe et total. Montants déjà formatés (oracle de 08, voir docs/design/US-033/prix_oracle.py).
 * Sans état ni effet : utilisable côté serveur et dans un composant client.
 */
import styles from '../proto.module.css';

export interface PriceLineView {
  readonly id: string;
  readonly label: string;
  readonly amount: string;
}

export function PriceLines({
  lines,
  totalLabel,
  total,
  totalKey,
}: {
  readonly lines: readonly PriceLineView[];
  readonly totalLabel: string;
  readonly total: string;
  /** Change quand le total change : rejoue l'apparition du montant (coupée si mouvement réduit). */
  readonly totalKey?: string | undefined;
}) {
  return (
    <dl className={styles['priceLines']}>
      {lines.map((line) => (
        <div key={line.id} className={styles['priceLine']}>
          <dt>{line.label}</dt>
          <dd>{line.amount}</dd>
        </div>
      ))}
      <div className={styles['priceTotal']}>
        <dt>{totalLabel}</dt>
        <dd key={totalKey} className={styles['priceTotalAmount']}>
          {total}
        </dd>
      </div>
    </dl>
  );
}
