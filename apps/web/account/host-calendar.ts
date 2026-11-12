/**
 * Lecture défensive de la réponse du calendrier d'un véhicule (US-119, ADR-100) et présentation
 * des durées de préavis, côté SERVEUR du site seulement. Une réponse mal formée est refusée
 * (`null`) : l'écran affiche son état d'erreur, jamais une donnée partielle. Aucune constante de
 * pays : le fuseau, le préavis du pays et la publication viennent de l'API.
 */
import type { Translator } from '@rueda/i18n';
import type { ApiResult } from './api-client.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const KINDS = new Set(['TRIP', 'HOLD', 'HOST_BLOCK', 'BUFFER']);
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const intOrNull = (v: unknown): number | null | undefined =>
  v === null ? null : typeof v === 'number' && Number.isInteger(v) ? v : undefined;

export type EntryKind = 'TRIP' | 'HOLD' | 'HOST_BLOCK' | 'BUFFER';

export interface CalendarEntryView {
  readonly id: string;
  readonly kind: EntryKind;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly startLocal: string;
  readonly endLocal: string;
  readonly removable: boolean;
}

export interface VehicleCalendarView {
  readonly vehicle: {
    readonly id: string;
    readonly timezone: string;
    readonly listed: boolean;
    readonly locationId: string;
    readonly noticeMinutes: number | null;
    readonly effectiveNoticeMinutes: number | null;
  };
  readonly entries: readonly CalendarEntryView[];
}

/** `GET …/vehicles/{vehicleId}/calendar` ; `null` si la réponse est illisible ou refusée. */
export function calendarOf(reply: ApiResult): VehicleCalendarView | null {
  if (reply.status !== 200 || !isObj(reply.json)) return null;
  const v = reply.json['vehicle'];
  const list = reply.json['entries'];
  if (!isObj(v) || !Array.isArray(list)) return null;
  const notice = intOrNull(v['noticeMinutes']);
  const effective = intOrNull(v['effectiveNoticeMinutes']);
  if (
    !UUID.test(String(v['id'])) ||
    !UUID.test(String(v['locationId'])) ||
    typeof v['timezone'] !== 'string' ||
    typeof v['listed'] !== 'boolean' ||
    notice === undefined ||
    effective === undefined
  ) {
    return null;
  }
  const entries: CalendarEntryView[] = [];
  for (const e of list as unknown[]) {
    if (
      !isObj(e) ||
      !UUID.test(String(e['id'])) ||
      !KINDS.has(String(e['kind'])) ||
      typeof e['startsAt'] !== 'string' ||
      typeof e['endsAt'] !== 'string' ||
      !LOCAL.test(String(e['startLocal'])) ||
      !LOCAL.test(String(e['endLocal'])) ||
      typeof e['removable'] !== 'boolean'
    ) {
      return null;
    }
    entries.push({
      id: String(e['id']),
      kind: e['kind'] as EntryKind,
      startsAt: e['startsAt'],
      endsAt: e['endsAt'],
      startLocal: String(e['startLocal']),
      endLocal: String(e['endLocal']),
      removable: e['removable'],
    });
  }
  return {
    vehicle: {
      id: String(v['id']),
      timezone: v['timezone'],
      listed: v['listed'],
      locationId: String(v['locationId']),
      noticeMinutes: notice,
      effectiveNoticeMinutes: effective,
    },
    entries,
  };
}

/**
 * Préavis proposés à l'hôte, en minutes (08 BR-BOOK-04, comme Turo : 1 h à 1 semaine ; PROPOSÉ,
 * docs/team/COMME_TURO.md). La base accepte tout pas de 30 min entre ces bornes.
 */
export const NOTICE_PRESETS: readonly number[] = [
  60, 120, 180, 360, 720, 1_440, 2_880, 4_320, 10_080,
];

/** Durée lisible : en jours si elle tombe sur des jours entiers, sinon en heures. */
export function durationLabel(t: Translator['t'], minutes: number): string {
  if (minutes >= 1_440 && minutes % 1_440 === 0) {
    return t('web.calendar.duration.days', { count: minutes / 1_440 });
  }
  return t('web.calendar.duration.hours', { count: minutes / 60 });
}
