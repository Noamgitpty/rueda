/**
 * Contrat de location d'un trip, partie commune des écrans S09 (voyageur) et A03 (hôte) — US-211
 * partie 211b (ADR-149 ; 10b UX-51 « documents générés en PDF balisé ou en HTML accessible
 * équivalent ») :
 *   - RÉSUMÉ en tête (liste de définitions) : période à l'heure locale avec le NOM du pays, auto,
 *     total payé, protection et franchise, caution, kilométrage, annulation, retard ;
 *   - lien vers le PDF (même texte, empreinte affichée) ;
 *   - ÉQUIVALENT HTML du PDF : le texte figé tel qu'imprimé (bloc de signature compris), partie
 *     espagnole (fait foi) puis traduction de courtoisie, chacune dans sa langue (`lang`).
 * Composant serveur, sans JavaScript ; aucune donnée personnelle hors du texte du contrat.
 */
import type { MessageKey, Translator } from '@rueda/i18n';
import { ButtonLink } from '@rueda/ui';
import type {
  ContractLineView,
  ContractPartView,
  TripContractView,
} from '../../../account/trip-contract.ts';
import { countryName, localInstant } from '../../../account/trip-contract.ts';
import accountStyles from '../_account/account.module.css';
import hostStyles from '../host/host.module.css';
import styles from './contract.module.css';

const LEVELS: Readonly<Record<string, MessageKey>> = {
  BASICA: 'ctr.contract.level.basica',
  ESTANDAR: 'ctr.contract.level.estandar',
  TOTAL: 'ctr.contract.level.total',
};

/** Ligne du texte figé : titres en h3 / h4 sous le titre de section (h2) de l'écran. */
function Line({ line }: { readonly line: ContractLineView }) {
  switch (line.style) {
    case 'title':
      return <h3 className={accountStyles['h2']}>{line.text}</h3>;
    case 'h':
      return <h4 className={hostStyles['strong']}>{line.text}</h4>;
    case 'note':
      return <p className={styles['note']}>{line.text}</p>;
    case 'sig':
      return <p className={styles['sig']}>{line.text}</p>;
    default:
      return <p className={accountStyles['text']}>{line.text}</p>;
  }
}

function Part({ part, t }: { readonly part: ContractPartView; readonly t: Translator['t'] }) {
  const label = t(part.authoritative ? 'web.contract.authoritative' : 'web.contract.courtesy');
  return (
    <section className={styles['part']} aria-label={label}>
      {/* rappel dans la langue de la vue ; le texte du contrat, dans la langue de sa partie */}
      <p className={accountStyles['muted']}>{label}</p>
      <div
        className={styles['lines']}
        lang={part.lang}
        data-testid={part.authoritative ? 'contract-text-es' : 'contract-text-courtesy'}
      >
        {part.lines.map((l, i) => (
          <Line key={i} line={l} />
        ))}
      </div>
    </section>
  );
}

export interface ContractViewProps {
  readonly i18n: Translator;
  readonly localeTag: string;
  readonly contract: TripContractView;
  /** Lien du PDF (relais du site). */
  readonly pdfHref: string;
  /** Lien de la version en vigueur, quand une version plus ancienne est affichée. */
  readonly latestHref: string;
}

/** Résumé, état des versions, PDF et texte complet (équivalent HTML du PDF). */
export function ContractView({
  i18n,
  localeTag,
  contract,
  pdfHref,
  latestHref,
}: ContractViewProps) {
  const t = i18n.t.bind(i18n);
  const s = contract.summary;
  const money = (amountMinor: string) =>
    i18n.money({
      amountMinor: BigInt(amountMinor),
      currency: s.currency,
      exponent: s.currencyExponent,
    });
  const when = (local: string) => i18n.dateTime(localInstant(local), 'UTC');
  const level = LEVELS[s.protection.level];
  const c = s.cancellation;
  const items: readonly [MessageKey, string][] = [
    [
      'web.contract.label.period',
      t('web.contract.period', {
        start: when(s.startLocal),
        end: when(s.endLocal),
        country: countryName(localeTag, s.country),
      }),
    ],
    [
      'web.contract.label.vehicle',
      t('web.contract.vehicle', {
        make: s.vehicle.make,
        model: s.vehicle.model,
        year: String(s.vehicle.year),
      }),
    ],
    ['web.contract.label.total', money(s.priceTotalMinor)],
    [
      'web.contract.label.protection',
      t('web.contract.protection', {
        level: level === undefined ? s.protection.level : t(level),
        amount: money(s.protection.deductibleMinor),
      }),
    ],
    [
      'web.contract.label.deposit',
      s.depositMinor === null ? t('web.contract.depositNone') : money(s.depositMinor),
    ],
    [
      'web.contract.label.mileage',
      s.mileage.mode === 'UNLIMITED' ||
      s.mileage.includedKm === null ||
      s.mileage.extraKmPriceMinor === null
        ? t('web.contract.mileageUnlimited')
        : t('web.contract.mileageIncluded', {
            km: i18n.number(s.mileage.includedKm),
            price: money(s.mileage.extraKmPriceMinor),
          }),
    ],
    [
      'web.contract.label.cancellation',
      c === null
        ? t('web.contract.cancelPolicy')
        : t('web.contract.cancelFree', {
            date: when(c.freeUntilLocal),
            dur: t(c.penaltyDays === '1' ? 'web.contract.oneDay' : 'web.contract.halfDay'),
            amount: money(c.retainedMinor),
          }),
    ],
    [
      'web.contract.label.lateReturn',
      s.lateGraceMinutes === null
        ? t('web.contract.lateNone')
        : t('web.contract.late', { minutes: s.lateGraceMinutes }),
    ],
  ];
  return (
    <>
      {contract.version < contract.latestVersion && (
        <p className={accountStyles['text']} data-testid="contract-older">
          {t('web.contract.older', { version: contract.version })}{' '}
          <a className={hostStyles['link']} href={latestHref}>
            {t('web.contract.latest')}
          </a>
        </p>
      )}
      <section className={hostStyles['section']} aria-labelledby="contract-summary">
        <h2 id="contract-summary" className={accountStyles['h2']}>
          {t('web.contract.summary')}
        </h2>
        <p className={accountStyles['muted']}>
          {t('web.contract.ref', { ref: s.tripRef, version: contract.version })}
        </p>
        <dl className={styles['summary']} data-testid="contract-summary">
          {items.map(([label, value]) => (
            <div key={label} className={styles['item']}>
              <dt>{t(label)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <ButtonLink variant="secondary" href={pdfHref} data-testid="contract-pdf">
          {t('web.contract.pdf')}
        </ButtonLink>
        <p className={styles['hash']}>{t('web.contract.hash', { hash: contract.sha256 })}</p>
      </section>
      {contract.parts !== null && (
        <section className={hostStyles['section']} aria-labelledby="contract-text">
          <h2 id="contract-text" className={accountStyles['h2']}>
            {t('web.contract.text')}
          </h2>
          {contract.parts.map((p) => (
            <Part key={p.lang} part={p} t={t} />
          ))}
        </section>
      )}
    </>
  );
}
