import type { LocaleProfile } from './locale-profile.ts';
import { fillPattern } from './pattern.ts';

/**
 * Formats de date et d'heure **dans le fuseau du véhicule** (17 §1.3). Le fuseau est un
 * paramètre obligatoire, sans valeur par défaut : il vient de la donnée du véhicule
 * (`timezone` IANA, hérité de son lieu), jamais du code ni du navigateur.
 */

/** Instant UTC : `Date` ou chaîne ISO 8601 avec fuseau (sérialisation de `timestamptz`). */
export type Instant = Date | string;

function toDate(instant: Instant): Date {
  if (typeof instant === 'string' && !/(Z|[+-]\d{2}:?\d{2})$/.test(instant)) {
    throw new RangeError(`Instant ISO 8601 avec fuseau attendu, reçu « ${instant} ».`);
  }
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) throw new RangeError('Instant invalide.');
  return date;
}

function assertTimeZone(timeZone: string): void {
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    throw new RangeError('Fuseau IANA du véhicule obligatoire.');
  }
  // Lève RangeError si le fuseau est inconnu de la base tzdata embarquée.
  new Intl.DateTimeFormat('en', { timeZone });
}

type Parts = Record<'day' | 'month' | 'year' | 'hour' | 'minute' | 'dayPeriod', string>;

function partsOf(date: Date, timeZone: string, profile: LocaleProfile): Parts {
  const formatter = new Intl.DateTimeFormat(`${profile.tag}-u-nu-latn`, {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: profile.date.hour,
    minute: '2-digit',
    hourCycle: profile.date.hourCycle,
  });
  const parts: Parts = { day: '', month: '', year: '', hour: '', minute: '', dayPeriod: '' };
  for (const part of formatter.formatToParts(date)) {
    if (part.type in parts) parts[part.type as keyof Parts] = part.value;
  }
  return parts;
}

export function formatDate(instant: Instant, timeZone: string, profile: LocaleProfile): string {
  assertTimeZone(timeZone);
  return fillPattern(profile.date.datePattern, partsOf(toDate(instant), timeZone, profile));
}

export function formatTime(instant: Instant, timeZone: string, profile: LocaleProfile): string {
  assertTimeZone(timeZone);
  return fillPattern(profile.date.timePattern, partsOf(toDate(instant), timeZone, profile));
}

export function formatDateTime(instant: Instant, timeZone: string, profile: LocaleProfile): string {
  assertTimeZone(timeZone);
  const parts = partsOf(toDate(instant), timeZone, profile);
  return fillPattern(profile.date.dateTimePattern, {
    date: fillPattern(profile.date.datePattern, parts),
    time: fillPattern(profile.date.timePattern, parts),
  });
}

/**
 * Décalage UTC du fuseau à cet instant, en minutes (−180 pour UTC−3), lu dans la base tzdata
 * embarquée. Sert au contrôle de démarrage de 17 §1.3 (America/Asuncion = UTC−3, OQ-BR-20).
 */
export function utcOffsetMinutes(instant: Instant, timeZone: string): number {
  assertTimeZone(timeZone);
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(toDate(instant))
    .find((part) => part.type === 'timeZoneName')?.value;
  if (name === 'GMT') return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name ?? '');
  if (!match) throw new RangeError(`Décalage illisible pour ${timeZone} : « ${String(name)} ».`);
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

export interface TimeZoneExpectation {
  readonly timeZone: string;
  readonly instant: string;
  readonly offsetMinutes: number;
}

/**
 * Vérifie la base tzdata embarquée contre des attentes (fixtures ou configuration). Retourne la
 * liste des écarts ; vide = conforme. Le refus de démarrer est à la charge de l'appelant.
 */
export function checkTimeZoneData(expectations: readonly TimeZoneExpectation[]): readonly string[] {
  const failures: string[] = [];
  for (const { timeZone, instant, offsetMinutes } of expectations) {
    const actual = utcOffsetMinutes(instant, timeZone);
    if (actual !== offsetMinutes) {
      failures.push(`${timeZone} à ${instant} : ${actual} min au lieu de ${offsetMinutes} min`);
    }
  }
  return failures;
}
