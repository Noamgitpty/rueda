/**
 * Noms de lieux de test (ville, zone) pour les textes publics filtrés à la création d'un lieu
 * (16 HST-011, BOARD N-62, ADR-114 : ni adresse exacte ni contact hors plateforme).
 *
 * Un tirage de lettres a-z quelconques n'est PAS neutre : le filtre de contact cherche des noms de
 * messagerie comme sous-chaînes, sans bornes de mot (« wsp », abréviation de WhatsApp). Avec 10
 * lettres tirées sur 26, « Villa nuwspdwkyr » est refusé (`LOCATION_CITY_INVALID`) environ une fois
 * sur 2 200 tirages ; le lieu n'était pas créé, le véhicule tombait en `LOCATION_NOT_FOUND`, et le
 * test L0 échouait au hasard (CI de la PR #180, « véhicule refusé »).
 *
 * Alphabet du suffixe : consonnes seules, sans « w » ni « y ». Toute marque d'adresse du filtre
 * demande un chiffre ou un mot à voyelle (« esq », « casa », « calle »…), et toute messagerie,
 * nommée ou abrégée, contient une voyelle ou un « w » (« wsp », « wpp ») : aucun tirage ne peut en
 * former une. Aucun chiffre, et donc jamais trois chiffres de suite. 19^10 ≈ 6·10^12 tirages : deux
 * noms d'un même test ne se confondent pas.
 */
import { randomInt } from 'node:crypto';

/** Lettres admises dans le suffixe tiré (consonnes, sans « w » ni « y »). */
export const PLACE_NAME_ALPHABET = 'bcdfghjklmnpqrstvxz';
/** Longueur du suffixe tiré. */
export const PLACE_NAME_SUFFIX_LENGTH = 10;

/** Nom unique de ville ou de zone : `<préfixe> <10 consonnes>` (« Villa bxtrqzdlnh »). */
export function placeName(prefix: string): string {
  const suffix = Array.from(
    { length: PLACE_NAME_SUFFIX_LENGTH },
    () => PLACE_NAME_ALPHABET[randomInt(PLACE_NAME_ALPHABET.length)],
  ).join('');
  return `${prefix} ${suffix}`;
}
