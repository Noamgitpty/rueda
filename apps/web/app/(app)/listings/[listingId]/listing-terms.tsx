import { Banner } from '@rueda/ui';
import type { Translator } from '@rueda/i18n';
import type { PublicListingView } from '../../../../account/host-listings.ts';
import type {
  ListingConditionsView,
  ProtectionLevel,
  SlotTermsView,
} from '../../../../account/listing-terms.ts';
import { PROTECTION_LEVELS, termsLanguageOf } from '../../../../account/listing-terms.ts';
import accountStyles from '../../_account/account.module.css';
import styles from '../../host/host.module.css';
import pageStyles from './listing.module.css';

/** Nom affiché du niveau de protection (clés de US-226). */
const LEVEL_KEY = {
  BASICA: 'common.quote.line.protectionBasica',
  ESTANDAR: 'common.quote.line.protectionEstandar',
  TOTAL: 'common.quote.line.protectionTotal',
} as const satisfies Record<ProtectionLevel, string>;

/** Heures entières d'une fenêtre en minutes (60 ⇒ 1), jamais moins d'une heure annoncée. */
const hoursOf = (minutes: number): number => Math.max(1, Math.floor(minutes / 60));

interface TermsProps {
  readonly i18n: Translator;
  readonly localeTag: string;
  readonly listing: PublicListingView;
  /** Conditions sans dates (`GET /listings/{id}/conditions`) ; `null` : illisibles ou en panne. */
  readonly conditions: ListingConditionsView | null;
  /** Conditions du créneau accepté ; `null` : pas de dates acceptées. */
  readonly slot: SlotTermsView | null;
}

/**
 * Annulation (16 LST-010 ; 08 BR-CXL-01, BR-CXL-06 ; 10b UX-54) : avec un créneau accepté, la date
 * limite calculée par la base pour une réservation faite maintenant (heure du lieu), ou « gratuite
 * pendant 1 h après la réservation » en dernière minute ; sans dates, la règle du pays. Politique
 * unique de la plateforme, jamais propre à l'hôte.
 */
function CancellationSection({ i18n, listing, conditions, slot }: Omit<TermsProps, 'localeTag'>) {
  const t = i18n.t.bind(i18n);
  const slotRule = slot?.cancellation ?? null;
  const policy = conditions?.cancellation ?? null;
  // heure du lieu du véhicule (fuseau rendu par l'API), jamais un fuseau supposé
  const timeZone = conditions?.timezone ?? listing.timezone;
  let lines: string[] = [];
  if (slotRule !== null) {
    if (slotRule.lastMinute || slotRule.freeUntil === null) {
      lines = [t('web.listing.cancel.lastMinute', { count: hoursOf(slotRule.windowMinutes) })];
    } else if (timeZone !== null) {
      lines = [
        t('web.listing.cancel.until', { date: i18n.dateTime(slotRule.freeUntil, timeZone) }),
      ];
    }
  } else if (policy !== null) {
    lines = [
      t('web.listing.cancel.lead', { count: policy.leadHours }),
      t('web.listing.cancel.late', {
        count: policy.thresholdHours,
        window: String(hoursOf(policy.windowMinutes)),
      }),
    ];
  }
  return (
    <section className={styles['section']} aria-labelledby="s03-cancel" data-testid="s03-cancel">
      <h2 id="s03-cancel" className={accountStyles['h2']}>
        {t('web.listing.cancel.title')}
      </h2>
      {lines.length === 0 ? (
        <p className={accountStyles['muted']}>{t('web.listing.cancel.unavailable')}</p>
      ) : (
        <>
          {lines.map((line) => (
            <p key={line} className={accountStyles['text']}>
              <span className={styles['strong']}>{line}</span>
            </p>
          ))}
          <p className={accountStyles['muted']}>{t('web.listing.cancel.after')}</p>
        </>
      )}
    </section>
  );
}

/**
 * Distance incluse (16 LST-012) : sur la période des dates acceptées (km par jour × jours
 * facturables, calculé par l'API), sinon par jour ; prix du km supplémentaire de l'hôte, dans la
 * devise du pays ; illimité ⇒ aucun prix du km. Jamais de miles.
 */
function DistanceSection({ i18n, listing, slot }: Omit<TermsProps, 'conditions' | 'localeTag'>) {
  const t = i18n.t.bind(i18n);
  const m = slot?.mileage ?? null;
  const included = m !== null ? m.mode === 'INCLUDED' : listing.mileageMode === 'INCLUDED';
  const perDay = m !== null ? m.includedKmPerDay : listing.includedKmPerDay;
  const extra = m !== null ? m.extraKmPriceMinor : listing.extraKmPriceMinor;
  return (
    <section
      className={styles['section']}
      aria-labelledby="s03-distance"
      data-testid="s03-distance"
    >
      <h2 id="s03-distance" className={accountStyles['h2']}>
        {t('web.listing.distance.title')}
      </h2>
      {!included || perDay === null ? (
        <p className={accountStyles['text']}>{t('web.host.listing.unlimited')}</p>
      ) : (
        <>
          {m?.includedKm !== null && m?.includedKm !== undefined && (
            <p className={accountStyles['text']}>
              <span className={styles['strong']}>
                {t('web.listing.distance.total', { count: m.includedKm })}
              </span>
            </p>
          )}
          <p className={accountStyles['text']}>
            {t('web.host.listing.kmPerDay', { count: perDay })}
          </p>
          {extra !== null && (
            <p className={accountStyles['text']}>
              {t('web.listing.distance.extra', {
                amount: i18n.money({
                  amountMinor: extra,
                  currency: listing.currency,
                  exponent: listing.currencyExponent,
                }),
              })}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Protection de l'assureur partenaire (16 LST-013, PRT-003, PRT-013 ; 08 BR-PROT-01, BR-PROT-03,
 * BR-PROT-04) : assureur et courtier cités, RC tiers incluse à tout niveau, Básica obligatoire et
 * déjà dans le prix final, franchise par niveau et exclusions, recopiées du contrat en vigueur
 * (mêmes sources que le contrat de location, US-211). Rien de promis si la base ne le promet pas
 * (19 US-205 critère 4) : le véhicule n'est alors pas réservable.
 */
function ProtectionSection({ i18n, localeTag, listing, conditions }: Omit<TermsProps, 'slot'>) {
  const t = i18n.t.bind(i18n);
  const p = conditions?.protection ?? null;
  const sameCurrency = conditions !== null && conditions.currency === listing.currency;
  const money = (amountMinor: bigint): string =>
    i18n.money({ amountMinor, currency: listing.currency, exponent: listing.currencyExponent });
  return (
    <section
      className={styles['section']}
      aria-labelledby="s03-protection"
      data-testid="s03-protection"
    >
      <h2 id="s03-protection" className={accountStyles['h2']}>
        {t('web.listing.protection.title')}
      </h2>
      {conditions === null ? (
        <p className={accountStyles['muted']}>{t('web.listing.protection.error')}</p>
      ) : p === null || !sameCurrency ? (
        <Banner tone="info">{t('web.listing.protection.unavailable')}</Banner>
      ) : (
        <>
          <p className={accountStyles['text']}>
            {t('web.listing.protection.insurer', { insurer: p.insurerName })}
          </p>
          <p className={accountStyles['text']}>
            <span className={styles['strong']}>
              {t('web.listing.protection.rc', { amount: money(p.rcAmountMinor) })}
            </span>
          </p>
          <p className={accountStyles['text']}>{t('web.listing.protection.basic')}</p>
          <h3 className={accountStyles['text']}>
            <span className={styles['strong']}>{t('web.listing.protection.deductibles')}</span>
          </h3>
          <dl className={pageStyles['terms']} data-testid="s03-deductibles">
            {PROTECTION_LEVELS.map((level) => (
              <div key={level} className={pageStyles['term']}>
                <dt>{t(LEVEL_KEY[level])}</dt>
                <dd>
                  {p.deductibles[level] === 0n
                    ? t('web.listing.protection.noDeductible')
                    : money(p.deductibles[level])}
                </dd>
              </div>
            ))}
          </dl>
          <h3 className={accountStyles['text']}>
            <span className={styles['strong']}>{t('web.listing.protection.exclusions')}</span>
          </h3>
          <p className={accountStyles['text']} data-testid="s03-exclusions">
            {p.exclusions[termsLanguageOf(localeTag)]}
          </p>
          <ul className={accountStyles['stackTight']} data-testid="s03-insurer-legal">
            {p.insurerLicenseRef !== null && (
              <li className={accountStyles['muted']}>
                {t('web.listing.protection.license', {
                  name: p.insurerName,
                  ref: p.insurerLicenseRef,
                })}
              </li>
            )}
            {p.brokerName !== null && (
              <li className={accountStyles['muted']}>
                {t('web.listing.protection.broker', { broker: p.brokerName })}
                {p.brokerLicenseRef !== null &&
                  ` · ${t('web.listing.protection.license', {
                    name: p.brokerName,
                    ref: p.brokerLicenseRef,
                  })}`}
              </li>
            )}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Caution de la plateforme (10b UX-21, 16 SRC-011 ; même règle que les cartes de la recherche,
 * ADR-131) : le montant si le pays ou la classe l'impose, sinon la mention générique ; jamais les
 * déclencheurs.
 */
function DepositSection({ i18n, listing, conditions }: Omit<TermsProps, 'slot' | 'localeTag'>) {
  const t = i18n.t.bind(i18n);
  const amount =
    conditions !== null && conditions.currency === listing.currency
      ? conditions.depositMinor
      : null;
  return (
    <section className={styles['section']} aria-labelledby="s03-deposit" data-testid="s03-deposit">
      <h2 id="s03-deposit" className={accountStyles['h2']}>
        {t('web.s03.deposit.title')}
      </h2>
      <p className={accountStyles['text']}>
        {amount === null
          ? t('web.search.deposit.maybe')
          : t('web.search.deposit.amount', {
              amount: i18n.money({
                amountMinor: amount,
                currency: listing.currency,
                exponent: listing.currencyExponent,
              }),
            })}
      </p>
    </section>
  );
}

/** Conditions de la fiche S03 (US-205) : annulation, distance, protection, caution. */
export function ListingTerms(props: TermsProps) {
  return (
    <>
      <CancellationSection
        i18n={props.i18n}
        listing={props.listing}
        conditions={props.conditions}
        slot={props.slot}
      />
      <DistanceSection i18n={props.i18n} listing={props.listing} slot={props.slot} />
      <ProtectionSection
        i18n={props.i18n}
        localeTag={props.localeTag}
        listing={props.listing}
        conditions={props.conditions}
      />
      <DepositSection i18n={props.i18n} listing={props.listing} conditions={props.conditions} />
    </>
  );
}

/** La fiche peut-elle proposer « Reservar » ? Seulement si la base promet la protection. */
export function protectionOffered(
  conditions: ListingConditionsView | null,
  listing: PublicListingView,
): boolean {
  return (
    conditions !== null &&
    conditions.protection !== null &&
    conditions.currency === listing.currency
  );
}
