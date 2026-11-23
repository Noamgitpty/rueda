/**
 * Numéros d'aide et d'urgence d'un pays (S17, US-310, ADR-182 ; 10b S17 « en tête, les numéros » ;
 * 08 BR-PROT-05). Ordre de 10b : urgence (numéro du pays et autorité de circulation), assistance
 * de l'assureur partenaire (panne, accident), support de la plateforme et sa plage publiée.
 * Rendu CÔTÉ SERVEUR, en texte dans la page (10b : « numéros affichés en texte même si le chargement
 * échoue ») ; chaque numéro est aussi un lien `tel:`. Un numéro absent (hors production : la
 * production refuse de démarrer sans lui) renvoie à l'aide dans l'appli, jamais un numéro inventé ;
 * aucune plage publiée (SUP-020) : aucun horaire ni délai promis. Jamais le téléphone d'une partie
 * du trip.
 */
import type { Translator } from '@rueda/i18n';
import type { HelpCountry } from '../../../account/help.ts';
import { telHref } from '../../../account/help.ts';
import accountStyles from '../_account/account.module.css';
import styles from '../host/host.module.css';

export interface HelpNumbersProps {
  readonly i18n: Translator;
  readonly help: HelpCountry;
  readonly brand: string;
  /** Préfixe des identifiants (plusieurs pays sur un même écran). */
  readonly idPrefix: string;
  /** Titre du pays affiché au-dessus des numéros (plusieurs pays) ; absent : aucun. */
  readonly countryHeading?: boolean;
  /**
   * Page d'incident (US-318, revue ux n° 3) : numéro de l'assureur absent ⇒ renvoyer aussi au
   * numéro d'urgence et à l'autorité de circulation DU PAYS (données de pays), en plus de l'aide.
   */
  readonly emergencyFallback?: boolean;
}

export function HelpNumbers({
  i18n,
  help,
  brand,
  idPrefix,
  countryHeading,
  emergencyFallback,
}: HelpNumbersProps) {
  const t = i18n.t.bind(i18n);
  const id = (part: string) => `${idPrefix}-${part}`;
  const Heading = countryHeading === true ? 'h3' : 'h2';
  return (
    <div className={accountStyles['stack']} data-testid={id('numbers')} data-country={help.country}>
      {countryHeading === true && (
        <h2 className={accountStyles['h2']}>{help.names[i18n.profile.language]}</h2>
      )}
      <section className={styles['card']} aria-labelledby={id('emergencyTitle')}>
        <Heading id={id('emergencyTitle')} className={accountStyles['h2']}>
          {t('web.help.emergency.title')}
        </Heading>
        <p className={styles['strong']}>
          <a
            className={styles['link']}
            href={telHref(help.emergencyNumber)}
            data-testid={id('emergencyCall')}
          >
            {t('web.help.emergency.call', { number: help.emergencyNumber })}
          </a>
        </p>
        <p className={accountStyles['text']}>
          {t('web.help.emergency.accident', { authority: t(help.authorityKey) })}
        </p>
        <p className={accountStyles['muted']}>{t('web.help.emergency.safety')}</p>
      </section>

      <section className={styles['card']} aria-labelledby={id('roadsideTitle')}>
        <Heading id={id('roadsideTitle')} className={accountStyles['h2']}>
          {t('web.help.roadside.title')}
        </Heading>
        {help.insurerAssistancePhone !== null ? (
          <p className={styles['strong']}>
            <a
              className={styles['link']}
              href={telHref(help.insurerAssistancePhone)}
              data-testid={id('roadsideCall')}
            >
              {t('web.help.roadside.number', { number: help.insurerAssistancePhone })}
            </a>
          </p>
        ) : (
          <>
            <p className={accountStyles['text']} data-testid={id('roadsideInApp')}>
              {t('web.help.roadside.inApp')}
            </p>
            {emergencyFallback === true && (
              <p className={accountStyles['text']} data-testid={id('roadsideFallback')}>
                {t('web.help.roadside.useEmergency', {
                  number: help.emergencyNumber,
                  authority: t(help.authorityKey),
                })}
              </p>
            )}
          </>
        )}
      </section>

      <section className={styles['card']} aria-labelledby={id('supportTitle')}>
        <Heading id={id('supportTitle')} className={accountStyles['h2']}>
          {t('web.help.support.title', { brand })}
        </Heading>
        {help.supportPhone !== null ? (
          <p className={styles['strong']}>
            <a
              className={styles['link']}
              href={telHref(help.supportPhone)}
              data-testid={id('supportCall')}
            >
              {t('web.help.support.number', { number: help.supportPhone })}
            </a>
          </p>
        ) : (
          <p className={accountStyles['text']} data-testid={id('supportInApp')}>
            {t('web.help.support.inApp')}
          </p>
        )}
        <p className={accountStyles['muted']} data-testid={id('supportHours')}>
          {help.supportHours !== null
            ? t('web.help.support.hours', {
                from: help.supportHours.from,
                to: help.supportHours.to,
              })
            : t('web.help.support.noHours')}
        </p>
      </section>
    </div>
  );
}
