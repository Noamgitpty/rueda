/**
 * Lecture défensive du calendrier (US-119) : une réponse mal formée est refusée en bloc (jamais
 * une donnée partielle) ; durées de préavis lisibles (16 CAL-003 : « préavis de 3 h »).
 */
import { describe, expect, it } from 'vitest';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { calendarOf, durationLabel, NOTICE_PRESETS } from './host-calendar.ts';

const ID = '11900000-0000-4000-8000-000000000001';
const LOC = '11900000-0000-4000-8000-000000000002';
const good = {
  vehicle: {
    id: ID,
    timezone: 'UTC',
    listed: true,
    locationId: LOC,
    noticeMinutes: null,
    effectiveNoticeMinutes: 180,
  },
  entries: [
    {
      id: ID,
      kind: 'HOST_BLOCK',
      startsAt: '2036-12-10T05:00:00.000Z',
      endsAt: '2036-12-13T05:00:00.000Z',
      startLocal: '2036-12-10T00:00',
      endLocal: '2036-12-13T00:00',
      removable: true,
    },
  ],
};
const reply = (json: unknown, status = 200) => ({ status, json, session: null });

describe('calendarOf', () => {
  it('réponse conforme : véhicule et occupations', () => {
    expect(calendarOf(reply(good))).toEqual(good);
  });

  it('refus en bloc : statut, type inconnu, borne locale mal formée, préavis non entier', () => {
    expect(calendarOf(reply(good, 404))).toBeNull();
    expect(calendarOf({ status: 'unavailable' })).toBeNull();
    const bad = (patch: (g: typeof good) => unknown) =>
      calendarOf(reply(patch(JSON.parse(JSON.stringify(good)) as typeof good)));
    expect(bad((g) => ({ ...g, entries: [{ ...g.entries[0], kind: 'GUEST' }] }))).toBeNull();
    expect(
      bad((g) => ({ ...g, entries: [{ ...g.entries[0], startLocal: '2036-12-10' }] })),
    ).toBeNull();
    expect(bad((g) => ({ ...g, vehicle: { ...g.vehicle, noticeMinutes: 1.5 } }))).toBeNull();
    expect(bad((g) => ({ ...g, vehicle: { ...g.vehicle, locationId: 'x' } }))).toBeNull();
  });
});

describe('durationLabel', () => {
  // première locale espagnole de la configuration (aucune locale écrite ici, ADR-024)
  const es = LOCALE_CONFIG.locales.find((l) => l.language === 'es');
  if (es === undefined) throw new Error('configuration sans locale espagnole');
  const t = createTranslator(getProfile(LOCALE_CONFIG, es.tag)).t;
  it('heures, puis jours entiers', () => {
    expect(durationLabel(t, 180)).toBe('3 horas');
    expect(durationLabel(t, 60)).toBe('1 hora');
    expect(durationLabel(t, 1_440)).toBe('1 día');
    expect(durationLabel(t, 10_080)).toBe('7 días');
  });

  it('préavis proposés : 1 h à 7 jours, au pas de 30 min', () => {
    expect(NOTICE_PRESETS[0]).toBe(60);
    expect(NOTICE_PRESETS.at(-1)).toBe(10_080);
    expect(NOTICE_PRESETS.every((m) => m % 30 === 0)).toBe(true);
  });
});
