/**
 * Saisie du calendrier de l'hôte (US-119 ; 16 CAL-002, CAL-003 ; 08 BR-BOOK-03, BR-BOOK-04,
 * BR-BOOK-07 ; ADR-100). Fonctions pures : la base revérifie tout (commandes
 * `core.catalog_cmd_*` de 0070) et convertit l'heure LOCALE dans le fuseau du véhicule, lu du
 * catalogue (jamais du client, jamais une constante de pays : L1-PM-22).
 *
 * Un blocage se saisit par JOURS (`from`, `to` inclus, `AAAA-MM-JJ`) ou par HEURES (`start`, `end`,
 * `AAAA-MM-JJTHH:MM`, au pas de 30 min, fin exclue). Le préavis se saisit en minutes (60 à 10 080,
 * au pas de 30) ou `null` (défaut du pays).
 */
import { FieldValidationError } from '../host-listings/model.js';
import type { FieldProblem } from '../host-listings/model.js';

/** Période locale du véhicule, [début, fin), au format `AAAA-MM-JJTHH:MM`. */
export interface LocalPeriod {
  readonly startLocal: string;
  readonly endLocal: string;
}

/** Bornes du préavis de l'hôte (08 BR-BOOK-04, comme Turo : 1 h à 1 semaine), au pas de 30 min. */
export const NOTICE_MIN_MINUTES = 60;
export const NOTICE_MAX_MINUTES = 10_080;
export const SLOT_MINUTES = 30;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** Jour civil réel (pas de 31 février) : composantes, sinon `null`. */
function civilDay(s: unknown): { y: number; m: number; d: number } | null {
  if (typeof s !== 'string') return null;
  const r = DAY.exec(s);
  if (r === null) return null;
  const [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** Heure locale au pas de 30 min, sinon `null`. */
function slotTime(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const r = TIME.exec(s);
  if (r === null) return null;
  if (civilDay(`${r[1]}-${r[2]}-${r[3]}`) === null) return null;
  const [hh, mm] = [Number(r[4]), Number(r[5])];
  if (hh > 23 || mm % SLOT_MINUTES !== 0) return null;
  return s;
}

/** Lendemain d'un jour civil, à minuit local. */
function nextMidnight(day: { y: number; m: number; d: number }): string {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + 1));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T00:00`;
}

/**
 * Corps d'un blocage : jours `{ from, to }` (inclus) ou heures `{ start, end }` (fin exclue).
 * Champs inconnus ou mélangés : refus.
 */
export function parseBlock(body: Record<string, unknown>): LocalPeriod {
  const keys = Object.keys(body).sort().join(',');
  const problems: FieldProblem[] = [];
  if (keys === 'from,to') {
    const from = civilDay(body['from']);
    const to = civilDay(body['to']);
    if (from === null) problems.push({ field: 'from', reason: 'INVALID' });
    if (to === null) problems.push({ field: 'to', reason: 'INVALID' });
    if (from !== null && to !== null) {
      const startLocal = `${pad(from.y, 4)}-${pad(from.m)}-${pad(from.d)}T00:00`;
      const endLocal = nextMidnight(to);
      if (endLocal <= startLocal) problems.push({ field: 'to', reason: 'INVALID' });
      if (problems.length === 0) return { startLocal, endLocal };
    }
  } else if (keys === 'end,start') {
    const start = slotTime(body['start']);
    const end = slotTime(body['end']);
    if (start === null) problems.push({ field: 'start', reason: 'INVALID' });
    if (end === null) problems.push({ field: 'end', reason: 'INVALID' });
    if (start !== null && end !== null) {
      if (end <= start) problems.push({ field: 'end', reason: 'INVALID' });
      if (problems.length === 0) return { startLocal: start, endLocal: end };
    }
  } else {
    problems.push({ field: 'from', reason: 'REQUIRED' });
  }
  throw new FieldValidationError(problems);
}

/** Corps d'un préavis : `{ minutes }`, entier de 60 à 10 080 au pas de 30, ou `null`. */
export function parseNotice(body: Record<string, unknown>): number | null {
  const keys = Object.keys(body);
  const m = body['minutes'];
  if (keys.length !== 1 || keys[0] !== 'minutes') {
    throw new FieldValidationError([{ field: 'minutes', reason: 'REQUIRED' }]);
  }
  if (m === null) return null;
  if (
    typeof m !== 'number' ||
    !Number.isInteger(m) ||
    m < NOTICE_MIN_MINUTES ||
    m > NOTICE_MAX_MINUTES ||
    m % SLOT_MINUTES !== 0
  ) {
    throw new FieldValidationError([{ field: 'minutes', reason: 'INVALID' }]);
  }
  return m;
}
