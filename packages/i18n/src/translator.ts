import { CATALOGS } from './catalogs/index.ts';
import type {
  MessageKey,
  PluralCategory,
  PluralMessage,
  RegionalOverrides,
} from './catalogs/index.ts';
import { formatDate, formatDateTime, formatTime } from './date-format.ts';
import type { Instant } from './date-format.ts';
import type { LocaleProfile } from './locale-profile.ts';
import { formatMoney } from './money-format.ts';
import type { MinorUnitAmount } from './money-format.ts';
import { formatNumber } from './number-format.ts';
import type { FormatNumberOptions } from './number-format.ts';
import { fillPattern } from './pattern.ts';

/** Valeurs d'un message. Un nombre doit être entier : un montant se formate avant (`money`). */
export type MessageValues = Readonly<Record<string, string | number | bigint>>;

export interface Translator {
  readonly profile: LocaleProfile;
  /** Texte d'une clé ; variable manquante ou clé inconnue → erreur, jamais de « {x} » affiché. */
  t(key: MessageKey, values?: MessageValues): string;
  money(amount: MinorUnitAmount): string;
  number(value: number | bigint, options?: FormatNumberOptions): string;
  date(instant: Instant, timeZone: string): string;
  time(instant: Instant, timeZone: string): string;
  dateTime(instant: Instant, timeZone: string): string;
}

export class UnknownMessageKeyError extends Error {
  override readonly name = 'UnknownMessageKeyError';
}

function isPlural(message: unknown): message is PluralMessage {
  return typeof message === 'object' && message !== null;
}

/**
 * Traducteur d'une locale : catalogue de sa langue (`profile.language`), éventuellement
 * complété de surcharges régionales (es-PA, es-PY) passées par l'appelant.
 */
export function createTranslator(
  profile: LocaleProfile,
  overrides: RegionalOverrides = {},
): Translator {
  const base = CATALOGS[profile.language].messages;
  const plurals = new Intl.PluralRules(profile.tag);

  function render(values: MessageValues): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(values)) {
      if (typeof value === 'string') {
        out[name] = value;
      } else if (typeof value === 'bigint' || Number.isInteger(value)) {
        out[name] = formatNumber(value, profile.number);
      } else {
        throw new RangeError(`Valeur « ${name} » non entière : formater le nombre avant.`);
      }
    }
    return out;
  }

  function t(key: MessageKey, values: MessageValues = {}): string {
    const message = Object.hasOwn(overrides, key) ? overrides[key] : base[key];
    if (message === undefined) throw new UnknownMessageKeyError(`Clé inconnue : ${String(key)}.`);
    if (!isPlural(message)) return fillPattern(message, render(values));
    const count = values['count'];
    if (typeof count !== 'bigint' && !Number.isInteger(count)) {
      throw new RangeError(`La clé ${key} est au pluriel : « count » entier obligatoire.`);
    }
    const category = plurals.select(Number(count)) as PluralCategory;
    return fillPattern(message[category] ?? message.other, render(values));
  }

  return {
    profile,
    t,
    money: (amount) => formatMoney(amount, profile),
    number: (value, options) => formatNumber(value, profile.number, options),
    date: (instant, timeZone) => formatDate(instant, timeZone, profile),
    time: (instant, timeZone) => formatTime(instant, timeZone, profile),
    dateTime: (instant, timeZone) => formatDateTime(instant, timeZone, profile),
  };
}
