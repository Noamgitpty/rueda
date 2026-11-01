import { describe, expect, it } from 'vitest';
import {
  checkTimeZoneData,
  formatDate,
  formatDateTime,
  formatTime,
  utcOffsetMinutes,
} from '../src/index.ts';
import { TIMEZONES, profile, tz } from './helpers.ts';

const ASUNCION = tz('America/Asuncion');
const PANAMA = tz('America/Panama');

describe('fuseaux des véhicules (17 §1.3, EC-33)', () => {
  it.each(TIMEZONES.expectations)(
    '$timeZone à $instant : $offsetMinutes min',
    ({ timeZone, instant, offsetMinutes }) => {
      expect(utcOffsetMinutes(instant, timeZone)).toBe(offsetMinutes);
    },
  );

  it('America/Asuncion = UTC−3 sur toutes les dates après 2024 de la fixture', () => {
    const asuncion = TIMEZONES.expectations.filter((e) => e.timeZone === ASUNCION);
    expect(asuncion.length).toBeGreaterThan(5);
    for (const e of asuncion) {
      expect(new Date(e.instant).getUTCFullYear()).toBeGreaterThan(2024);
      expect(e.offsetMinutes).toBe(-180);
    }
  });

  it('la tzdata embarquée est historisée (UTC−4 avant la loi)', () => {
    expect(checkTimeZoneData(TIMEZONES.historical)).toEqual([]);
  });

  it('checkTimeZoneData : conforme sur la fixture, écart signalé sinon', () => {
    expect(checkTimeZoneData(TIMEZONES.expectations)).toEqual([]);
    const wrong = [{ timeZone: ASUNCION, instant: '2025-07-15T12:00:00Z', offsetMinutes: -240 }];
    expect(checkTimeZoneData(wrong)).toHaveLength(1);
  });
});

describe('formatDate / formatTime / formatDateTime dans le fuseau du véhicule', () => {
  const noonUtc = '2025-07-01T12:00:00Z';

  it('jj/mm/aaaa et 24 h en espagnol', () => {
    expect(formatDateTime(noonUtc, ASUNCION, profile('es-PY'))).toBe('01/07/2025 09:00');
    expect(formatDateTime(noonUtc, PANAMA, profile('es-PA'))).toBe('01/07/2025 07:00');
  });

  it('jj/mm/aaaa et 12 h en anglais', () => {
    expect(formatDateTime(noonUtc, ASUNCION, profile('en'))).toBe('01/07/2025 9:00 AM');
    expect(formatDateTime('2025-07-01T20:30:00Z', PANAMA, profile('en'))).toBe(
      '01/07/2025 3:30 PM',
    );
  });

  it('minuit et changement de jour selon le fuseau', () => {
    expect(formatTime('2025-07-01T03:00:00Z', ASUNCION, profile('es-PY'))).toBe('00:00');
    expect(formatTime('2025-07-01T03:00:00Z', ASUNCION, profile('en'))).toBe('12:00 AM');
    expect(formatDate('2025-07-01T02:00:00Z', ASUNCION, profile('es-PY'))).toBe('30/06/2025');
    expect(formatDate('2025-07-01T02:00:00Z', PANAMA, profile('es-PA'))).toBe('30/06/2025');
  });

  it('ancienne date de bascule paraguayenne (1er dimanche d’octobre 2025) : pas de saut d’heure', () => {
    expect(formatTime('2025-10-05T03:30:00Z', ASUNCION, profile('es-PY'))).toBe('00:30');
    expect(formatTime('2025-10-05T04:30:00Z', ASUNCION, profile('es-PY'))).toBe('01:30');
  });

  it('fuseau obligatoire et instant avec fuseau obligatoire', () => {
    expect(() => formatDate(noonUtc, '', profile('es-PA'))).toThrow(RangeError);
    expect(() => formatDate(noonUtc, 'Mars/Olympus', profile('es-PA'))).toThrow(RangeError);
    expect(() => formatDate('2025-07-01T12:00:00', PANAMA, profile('es-PA'))).toThrow(RangeError);
    expect(() => formatDate('pas une date', PANAMA, profile('es-PA'))).toThrow(RangeError);
  });

  it('accepte un objet Date', () => {
    expect(formatDate(new Date(noonUtc), PANAMA, profile('en'))).toBe('01/07/2025');
  });
});
