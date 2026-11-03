import type { MinorUnitAmount, Translator } from '@rueda/i18n';
import { Banner } from './banner.tsx';
import styles from './card.module.css';
import { Icon } from './icon.tsx';
import type { IconName } from './icon.tsx';

/** Instant à afficher au fuseau du véhicule (jamais celui du navigateur, 10b UX-53). */
export interface VehicleInstant {
  /** ISO 8601 avec fuseau (`Z` ou `±hh:mm`). */
  readonly instant: string;
  /** Fuseau IANA du véhicule (donnée de pays). */
  readonly timeZone: string;
}

interface DepositCommon {
  readonly i18n: Translator;
  readonly id: string;
  /** Montant BR-PAY-06 de la classe du véhicule (calculé par la plateforme). */
  readonly amount: MinorUnitAmount;
  /** Nom du marchand, tiré de la configuration du pays. */
  readonly merchantName: string;
  readonly hostName: string;
  /** Date de libération **au plus tard** (UX-22). */
  readonly releaseBy: VehicleInstant;
  readonly headingLevel?: 2 | 3 | 4 | undefined;
}

/**
 * Rail de la caution calculé pour les dates (10b §3.5) : pré-autorisation, ou débit puis
 * remboursement (avec la date d'émission du remboursement, UX-23).
 */
export type DepositBlockProps = DepositCommon &
  (
    | { readonly rail: 'preauth' }
    | { readonly rail: 'chargeRefund'; readonly refundIssuedOn: VehicleInstant }
  );

function Fact({ icon, children }: { readonly icon: IconName; readonly children: string }) {
  return (
    <li className={styles['fact']}>
      <span className={styles['factIcon']}>
        <Icon name={icon} />
      </span>
      <span>{children}</span>
    </li>
  );
}

/**
 * Bloc « Depósito de garantía » de la fiche et du checkout (10b UX-21) : les six réponses fixes —
 * combien, qui le retient, comment, ce qu'il couvre, ce qu'il ne couvre pas, quand il revient.
 * Tout vient de la plateforme ; rien ne dépend d'une déclaration de l'hôte.
 */
export function DepositBlock(props: DepositBlockProps) {
  const { i18n, id, amount, merchantName, hostName, releaseBy, headingLevel = 2 } = props;
  const Heading = `h${headingLevel}` as const;
  const titleId = `${id}-title`;
  return (
    <section id={id} className={styles['card']} aria-labelledby={titleId}>
      <div className={styles['section']}>
        <Heading id={titleId} className={styles['heading']}>
          {i18n.t('web.s03.deposit.title')}
        </Heading>
        <dl className={styles['amount']}>
          <dt>{i18n.t('web.deposit.amount')}</dt>
          <dd>{i18n.money(amount)}</dd>
        </dl>
        <ul className={styles['facts']}>
          <Fact icon="info">
            {i18n.t('web.deposit.holder', { merchant_name: merchantName, host_name: hostName })}
          </Fact>
          <Fact icon="info">
            {i18n.t(
              props.rail === 'preauth' ? 'web.deposit.how.preauth' : 'web.deposit.how.chargeRefund',
            )}
          </Fact>
          <Fact icon="check">{i18n.t('web.deposit.covers')}</Fact>
          <Fact icon="shield">{i18n.t('web.deposit.notCovers')}</Fact>
          <Fact icon="check">
            {i18n.t('web.deposit.releaseBy', {
              date: i18n.date(releaseBy.instant, releaseBy.timeZone),
            })}
          </Fact>
        </ul>
        {props.rail === 'chargeRefund' && (
          <Banner tone="warning">
            {i18n.t('web.deposit.debitWarning', {
              date: i18n.date(props.refundIssuedOn.instant, props.refundIssuedOn.timeZone),
            })}
          </Banner>
        )}
      </div>
    </section>
  );
}
