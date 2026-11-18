'use client';
/**
 * Recherche de constancia par l'hôte (US-212 ; 16 LEG-026 parcours EC-48) : plaque et date locale
 * de l'infraction, puis la liste des trips de son compte qui la couvrent (jusqu'au lendemain de la
 * fin, BR-TT-03), chacun avec le lien de sa constancia. Résultats rendus par l'action serveur
 * (jamais dans l'URL). Sans JavaScript : envoi natif.
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, ErrorSummary, TextField } from '@rueda/ui';
import { localInstant } from '../../../../account/trip-contract.ts';
import { LOCALE_CONFIG } from '../../../../locale-config.ts';
import accountStyles from '../../_account/account.module.css';
import styles from '../host.module.css';
import { searchConstanciaAction } from './actions.ts';
import type { ConstanciaSearchState } from './actions.ts';
import { SEARCH_DATE_ID, SEARCH_FORM_ID, SEARCH_PLATE_ID } from './ids.ts';

const INITIAL: ConstanciaSearchState = { errors: [], trips: null };

export function ConstanciaSearchForm({ localeTag }: { readonly localeTag: string }) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const t = i18n.t.bind(i18n);
  const [state, run, pending] = useActionState(searchConstanciaAction, INITIAL);
  const messages = state.errors.map((e) => ({ fieldId: e.fieldId, message: t(e.key, e.values) }));
  const errorOf = (id: string) => messages.find((m) => m.fieldId === id)?.message;
  const when = (local: string) => i18n.dateTime(localInstant(local), 'UTC');
  return (
    <>
      <form
        id={SEARCH_FORM_ID}
        className={styles['actions']}
        action={run}
        noValidate
        aria-labelledby="constancia-search-title"
      >
        <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== SEARCH_FORM_ID)} />
        {errorOf(SEARCH_FORM_ID) !== undefined && (
          <Banner tone="danger" live="assertive">
            {errorOf(SEARCH_FORM_ID)}
          </Banner>
        )}
        <TextField
          i18n={i18n}
          id={SEARCH_PLATE_ID}
          name="plate"
          label={t('web.constancia.search.plate')}
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={32}
          error={errorOf(SEARCH_PLATE_ID)}
        />
        <TextField
          i18n={i18n}
          id={SEARCH_DATE_ID}
          name="date"
          type="date"
          label={t('web.constancia.search.date')}
          error={errorOf(SEARCH_DATE_ID)}
        />
        <Button type="submit" block loading={pending} data-testid="constancia-search-submit">
          {t('web.constancia.search.submit')}
        </Button>
      </form>
      {state.trips !== null && (
        <section aria-live="polite" data-testid="constancia-search-results">
          {state.trips.length === 0 ? (
            <p className={accountStyles['text']}>{t('web.constancia.search.none')}</p>
          ) : (
            <ul className={accountStyles['stackTight']}>
              {state.trips.map((trip) => (
                <li key={trip.tripId} className={styles['card']}>
                  <p className={accountStyles['text']}>
                    {t('web.constancia.search.result', {
                      ref: trip.tripRef,
                      start: when(trip.startLocal),
                      end: when(trip.endLocal),
                    })}
                  </p>
                  <a className={styles['link']} href={`/trips/${trip.tripId}/constancia`}>
                    {t('web.constancia.search.open')}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
