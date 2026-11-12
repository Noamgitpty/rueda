import { Banner } from '@rueda/ui';
import type { MessageKey, Translator } from '@rueda/i18n';
import type { RegulatoryNoticeView } from '../../../account/regulatory-notices.ts';
import accountStyles from './account.module.css';

/**
 * Avertissements réglementaires versionnés du pays (US-125 critère 4 ; 16 LEG-021) : un bandeau
 * par avertissement, titre et texte dans la langue de la vue, numéro de version affiché. Rien si
 * le pays n'en déclare aucun. Jamais l'état d'un interrupteur de mise en service (critère 5).
 */
export function RegulatoryNotices({
  i18n,
  notices,
  headingId,
  unavailable,
}: {
  readonly i18n: Translator;
  readonly notices: readonly RegulatoryNoticeView[];
  readonly headingId: string;
  /** L'API des avertissements n'a pas répondu : le dire, plutôt que n'afficher rien. */
  readonly unavailable?: boolean;
}) {
  const t = i18n.t.bind(i18n);
  if (unavailable === true && notices.length === 0) {
    return (
      <Banner tone="info" live="polite">
        {t('common.regulatory.unavailable')}
      </Banner>
    );
  }
  if (notices.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className={accountStyles['stackTight']}>
      <h2 id={headingId} className={accountStyles['h2']}>
        {t('common.regulatory.heading')}
      </h2>
      {notices.map((n) => (
        <Banner
          key={`${n.id}-${n.version}`}
          tone="warning"
          title={t(`${n.messageKey}.title` as MessageKey)}
        >
          {t(`${n.messageKey}.body` as MessageKey)}{' '}
          <span data-notice={n.id} data-notice-version={n.version}>
            {t('common.regulatory.version', { version: n.version })}
          </span>
        </Banner>
      ))}
    </section>
  );
}
