/**
 * `placeName` (US-203, stabilité des preuves L0), sans base de données. Attendus : messageries et
 * marques d'adresse que les textes publics refusent (16 HST-011, BOARD N-62, ADR-114 : WhatsApp
 * et ses abréviations « wsp », « wpp », Telegram, Instagram, Facebook, TikTok, Signal, Viber,
 * « zap », « ig » ; voie ou logement numérotés, angle « esq ») ; jamais le filtre SQL lui-même.
 */
import { describe, expect, it } from 'vitest';
import { PLACE_NAME_ALPHABET, PLACE_NAME_SUFFIX_LENGTH, placeName } from './names.ts';

const REFUSED_WORDS = [
  'whatsapp',
  'whats',
  'wsp',
  'wpp',
  'telegram',
  'instagram',
  'insta',
  'ig',
  'facebook',
  'tiktok',
  'signal',
  'viber',
  'zap',
  'messenger',
  'snapchat',
  'discord',
  'arroba',
  'esq',
  'esquina',
];

describe('placeName', () => {
  it('donne « <préfixe> <10 consonnes> », sans chiffre ni voyelle ni « w »', () => {
    expect(PLACE_NAME_SUFFIX_LENGTH).toBe(10);
    expect(PLACE_NAME_ALPHABET).not.toMatch(/[aeiouyw0-9]/);
    for (let i = 0; i < 5_000; i += 1) {
      expect(placeName('Villa')).toMatch(/^Villa [bcdfghjklmnpqrstvxz]{10}$/);
    }
  });

  it('ne forme jamais un nom de messagerie ou une marque d’adresse refusés', () => {
    // chaque mot refusé contient une voyelle ou un « w », absents de l'alphabet
    for (const w of REFUSED_WORDS) expect(w).toMatch(/[aeiouyw]/);
    for (let i = 0; i < 5_000; i += 1) {
      const suffix = placeName('Barrio').slice('Barrio '.length);
      for (const w of REFUSED_WORDS) expect(suffix.includes(w)).toBe(false);
    }
  });

  it('distingue deux tirages', () => {
    const seen = new Set(Array.from({ length: 10_000 }, () => placeName('Villa')));
    expect(seen.size).toBe(10_000);
  });
});
