import type { Translator } from '@rueda/i18n';
import { Button } from '@rueda/ui';
import { placeValue, TIME_SLOTS, wallClock } from '../../../account/search.ts';
import type { SearchAreaView, SearchInput } from '../../../account/search.ts';
import styles from './search.module.css';

/**
 * Formulaire de recherche de S01 (US-201 ; 16 SRC-001, bêta : lieu choisi dans la liste des villes
 * et zones déclarées par les hôtes, au lieu de l'autocomplétion) : « ¿Dónde? », départ et retour
 * (date et heure au pas de 30 min, heures du lieu de remise), bouton Buscar. Formulaire HTML en
 * GET vers `/search` : il marche sans JavaScript et l'URL garde la recherche (16 SRC-001, dates
 * conservées jusqu'à la fiche). `defaults` : recherche en cours, reprise pour la modifier.
 * Aucun texte en dur (catalogue i18n), jetons seulement.
 */
export function SearchForm({
  i18n,
  areas,
  defaults = null,
  error = null,
  idPrefix = 's01',
}: {
  readonly i18n: Translator;
  readonly areas: readonly SearchAreaView[];
  readonly defaults?: SearchInput | null;
  /** Message d'erreur déjà traduit (refus de la recherche), rendu sous le titre du formulaire. */
  readonly error?: string | null;
  readonly idPrefix?: string;
}) {
  const t = i18n.t.bind(i18n);
  const id = (name: string): string => `${idPrefix}-search-${name}`;
  const selected = defaults === null ? '' : placeValue(defaults);
  const [sd, st] = defaults === null ? ['', '10:00'] : defaults.start.split('T');
  const [ed, et] = defaults === null ? ['', '10:00'] : defaults.end.split('T');
  const timeLabel = (slot: string): string => i18n.time(wallClock(`2000-01-01T${slot}`), 'UTC');
  const times = (name: string, value: string | undefined, label: string) => (
    <div className={styles['field']}>
      <label className={styles['sub']} htmlFor={id(name)}>
        {label}
      </label>
      <select id={id(name)} name={name} className={styles['control']} defaultValue={value} required>
        {TIME_SLOTS.map((slot) => (
          <option key={slot} value={slot}>
            {timeLabel(slot)}
          </option>
        ))}
      </select>
    </div>
  );
  const date = (name: string, value: string | undefined, label: string) => (
    <div className={styles['field']}>
      <label className={styles['sub']} htmlFor={id(name)}>
        {label}
      </label>
      <input
        id={id(name)}
        name={name}
        type="date"
        className={styles['control']}
        defaultValue={value}
        required
      />
    </div>
  );
  return (
    <form
      className={styles['form']}
      action="/search"
      method="get"
      role="search"
      aria-labelledby={id('title')}
      aria-describedby={error === null ? id('hint') : `${id('error')} ${id('hint')}`}
    >
      <h2 id={id('title')} className={styles['label']}>
        {t('web.search.title')}
      </h2>
      {error !== null && (
        <p id={id('error')} className={styles['error']} role="alert">
          {error}
        </p>
      )}
      <div className={styles['field']}>
        <label className={styles['label']} htmlFor={id('place')}>
          {t('web.search.where')}
        </label>
        <select
          id={id('place')}
          name="place"
          className={styles['control']}
          defaultValue={selected}
          required
        >
          <option value="" disabled>
            {t('web.search.choosePlace')}
          </option>
          {areas.map((a) => (
            <option key={placeValue(a)} value={placeValue(a)}>
              {a.area === null
                ? t('web.search.wholeCity', { city: a.city })
                : `${a.area}, ${a.city}`}
            </option>
          ))}
        </select>
      </div>
      <fieldset className={styles['group']}>
        <legend className={styles['legend']}>{t('web.search.from')}</legend>
        <div className={styles['pair']}>
          {date('startDate', sd, t('web.search.date'))}
          {times('startTime', st, t('web.search.time'))}
        </div>
      </fieldset>
      <fieldset className={styles['group']}>
        <legend className={styles['legend']}>{t('web.search.until')}</legend>
        <div className={styles['pair']}>
          {date('endDate', ed, t('web.search.date'))}
          {times('endTime', et, t('web.search.time'))}
        </div>
      </fieldset>
      <p id={id('hint')} className={styles['hint']}>
        {t('web.search.localTime')}
      </p>
      <Button type="submit" block>
        {t('web.search.go')}
      </Button>
    </form>
  );
}
