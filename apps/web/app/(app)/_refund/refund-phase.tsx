import type { MessageKey, Translator } from '@rueda/i18n';
import { Badge } from '@rueda/ui';
import type { BadgeTone } from '@rueda/ui';
import type { RefundPhase } from '../../../account/trip-refunds.ts';
import styles from '../host/host.module.css';

/**
 * État d'un remboursement vu par le voyageur (S10) et par l'hôte (A05) (US-224 partie 224d,
 * ADR-154) : un badge (jamais la couleur seule, UX-48) et une phrase. Émis ⇒ « Émis le {date} » à
 * la date du fuseau du trip (BR-PAY-08 : date d'émission, jamais une date de réception) ; avant
 * l'émission, la date n'existe pas et rien n'est promis au-delà.
 */
const PHASE_KEYS: Readonly<Record<RefundPhase, MessageKey>> = {
  PREPARING: 'web.refund.status.PREPARING',
  ISSUED: 'web.refund.status.ISSUED',
  CONFIRMED: 'web.refund.status.CONFIRMED',
  ATTENTION: 'web.refund.status.ATTENTION',
};

const PHASE_TONE: Readonly<Record<RefundPhase, BadgeTone>> = {
  PREPARING: 'neutral',
  ISSUED: 'success',
  CONFIRMED: 'success',
  ATTENTION: 'warning',
};

export function RefundPhaseLines({
  i18n,
  phase,
  issuedAt,
  timezone,
  bankDelay,
}: {
  readonly i18n: Translator;
  readonly phase: RefundPhase;
  readonly issuedAt: string | null;
  readonly timezone: string;
  /** Voyageur seulement : délai de la banque (jamais une date de réception). */
  readonly bankDelay: boolean;
}) {
  const t = i18n.t.bind(i18n);
  return (
    <>
      <p>
        <Badge tone={PHASE_TONE[phase]}>{t(PHASE_KEYS[phase])}</Badge>
      </p>
      {phase === 'PREPARING' && <p className={styles['hint']}>{t('web.refund.preparing')}</p>}
      {phase === 'ATTENTION' && <p className={styles['hint']}>{t('web.refund.attention')}</p>}
      {issuedAt !== null && phase !== 'ATTENTION' && phase !== 'PREPARING' && (
        <>
          <p data-testid="refund-issued">
            {t('web.refund.issuedOn', { date: i18n.date(issuedAt, timezone) })}
          </p>
          {bankDelay && <p className={styles['hint']}>{t('web.refund.bankDelay')}</p>}
        </>
      )}
    </>
  );
}
