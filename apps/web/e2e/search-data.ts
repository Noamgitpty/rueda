/**
 * Données de la recherche publique (US-201) du double de l'API (`e2e/stub-api.mjs`), fictives :
 * une ville, deux zones (la ville entière et « Barrio Norte »), une annonce publiée (la fiche
 * publique du double), une ville réservée dont la recherche rend 503 `SEARCH_UNAVAILABLE`.
 * Fuseau `UTC` : l'heure locale saisie est l'heure rendue. Dates loin dans le futur.
 */

/** Fiche publiée du double (e2e/stub-api.mjs). */
export const PUBLIC_ID = '11500000-0000-4000-8000-00000000f001';
export const COUNTRY = 'ZZ';
export const CITY = 'Ciudad Ficticia';
export const AREA = 'Barrio Norte';
/** Ville dont la recherche rend 503 dans le double. */
export const DOWN_CITY = 'Ciudad Caida';
export const START = { date: '2036-12-10', time: '10:00' } as const;
export const END = { date: '2036-12-12', time: '10:00' } as const;

/** Valeur d'option du lieu (forme de `placeValue`, account/search.ts). */
export const place = (city: string, area: string | null): string =>
  JSON.stringify([COUNTRY, city, area]);

/** URL de la page de résultats, comme l'envoie le formulaire GET de S01. */
export function searchUrl(
  city: string,
  area: string | null,
  start: { readonly date: string; readonly time: string } = START,
  end: { readonly date: string; readonly time: string } = END,
): string {
  return `/search?${new URLSearchParams({
    place: place(city, area),
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
  }).toString()}`;
}

/** Fiche S03 avec les dates reprises de la recherche (heures locales `AAAA-MM-JJTHH:MM`). */
export const listingWithDates = (): string =>
  `/listings/${PUBLIC_ID}?${new URLSearchParams({
    start: `${START.date}T${START.time}`,
    end: `${END.date}T${END.time}`,
  }).toString()}`;
