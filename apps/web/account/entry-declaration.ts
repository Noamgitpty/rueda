/**
 * Déclaration d'entrée du voyageur à permis étranger (US-209 partie 209c, ADR-144 ; 16 VER-007,
 * UXQ-03) : saisie de l'écran `/verify-identity/entry` lue d'un `FormData` (bornée), contrôles de
 * forme (mêmes règles que `POST /identity/entry-declaration` d'US-209b : touriste ⇒ date
 * obligatoire, jour réel du calendrier), corps envoyé à l'API et date mise en forme par langue.
 * La date d'entrée est un JOUR (sans heure) : elle est rendue à midi UTC dans le fuseau UTC, donc
 * le même jour dans toutes les langues (jamais décalée par un fuseau).
 */
import type { MessageKey, Translator } from '@rueda/i18n';

export const RESIDENCY_STATUSES = ['TOURIST', 'RESIDENT'] as const;
export type ResidencyStatus = (typeof RESIDENCY_STATUSES)[number];

/** Champs de l'écran (identifiants stables : récapitulatif d'erreurs, e2e). */
export const ENTRY_FIELD = {
  form: 's04-entry-form',
  country: 's04-entry-country',
  status: 's04-entry-status',
  date: 's04-entry-date',
} as const;

export interface EntryInput {
  readonly country: string;
  readonly residency: ResidencyStatus | null;
  /** Jour `AAAA-MM-JJ` ou chaîne vide. */
  readonly date: string;
}

export interface EntryFieldError {
  readonly fieldId: string;
  readonly key: MessageKey;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Jour réel du calendrier (2031-02-31 refusé), comme `isCalendarDay` de l'API. */
export function isCalendarDay(value: string): boolean {
  const m = DAY.exec(value);
  if (m === null) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

const text = (form: FormData, name: string, max: number): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
};

export function entryInputOf(form: FormData): EntryInput {
  const residency = text(form, 'residencyStatus', 10);
  return {
    country: text(form, 'country', 2),
    residency: (RESIDENCY_STATUSES as readonly string[]).includes(residency)
      ? (residency as ResidencyStatus)
      : null,
    date: text(form, 'entryDate', 10),
  };
}

/** Contrôles de forme, dans l'ordre de l'écran ; aucune date future jugée ici (la base le fait). */
export function entryInputErrors(input: EntryInput): EntryFieldError[] {
  const errors: EntryFieldError[] = [];
  if (!/^[A-Z]{2}$/.test(input.country)) {
    errors.push({ fieldId: ENTRY_FIELD.country, key: 'common.legal.countryUnknown' });
  }
  if (input.residency === null) {
    errors.push({ fieldId: ENTRY_FIELD.status, key: 'web.s04.entry.statusRequired' });
  }
  if (input.date === '' && input.residency === 'TOURIST') {
    errors.push({ fieldId: ENTRY_FIELD.date, key: 'web.s04.entry.dateRequired' });
  } else if (input.date !== '' && !isCalendarDay(input.date)) {
    errors.push({ fieldId: ENTRY_FIELD.date, key: 'common.kyc.entryDateInvalid' });
  }
  return errors;
}

/** Corps de `POST /identity/entry-declaration` (date seulement si saisie). */
export function entryRequestOf(input: EntryInput): Record<string, string> {
  return {
    country: input.country,
    residencyStatus: input.residency ?? '',
    ...(input.date !== '' ? { entryDate: input.date } : {}),
  };
}

/** Date d'entrée dans la langue de la vue (jour exact, aucun décalage de fuseau). */
export function entryDayLabel(i18n: Translator, day: string): string {
  return i18n.date(`${day}T12:00:00Z`, 'UTC');
}
