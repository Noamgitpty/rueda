import { describe, expect, it } from 'vitest';
import { CONSTRAINT_CODES, DB_BUSINESS_CODES, translateDbError } from './errors.ts';
import { listMigrations } from './migrate.ts';
import { MIGRATIONS_DIR } from './paths.ts';

/** Erreur de la forme de `pg.DatabaseError` (champs posés en propriétés propres). */
const pgError = (fields: Record<string, string>): Error =>
  Object.assign(new Error('message serveur avec une valeur sensible'), {
    detail: 'Key (guest_user_id, vehicle_id)=(…) already exists.',
    table: 'booking_checkout_hold',
    schema: 'core',
    ...fields,
  });

describe('translateDbError (17 §2.5 2d, §4.4, L0-08)', () => {
  it.each([
    ['23P01', 'vehicle_occupancy_no_overlap', 'VEHICLE_UNAVAILABLE'],
    ['23P01', 'guest_no_overlap', 'GUEST_OVERLAP'],
    ['23505', 'one_live_hold_per_guest_vehicle', 'HOLD_ALREADY_LIVE'],
    ['23505', 'webhook_inbox_dedup', 'WEBHOOK_DUPLICATE'],
    ['23505', 'one_conversion_per_hold', 'DUPLICATE_PAYMENT'],
    ['23505', 'payment_disposition_pkey', 'DISPOSITION_EXISTS'],
    ['23000', 'hold_terminal_status', 'INVALID_TRANSITION'],
    ['23000', 'trip_has_active_occupancy', 'INVARIANT_VIOLATION'],
    ['23000', 'occupancy_trip_guard', 'INVARIANT_VIOLATION'],
  ])('%s sur %s → %s, sans détail', (code, constraint, expected) => {
    const translated = translateDbError(pgError({ code, constraint }));
    expect(translated).toEqual({ code: expected, retryable: false });
    expect(Object.keys(translated).sort()).toEqual(['code', 'retryable']);
    const serialized = JSON.stringify(translated);
    expect(serialized).not.toMatch(/Key|sensible|booking_|core|already/);
  });

  it.each(['40P01', '40001'])('%s → RETRY, transaction à rejouer', (code) => {
    expect(translateDbError(pgError({ code }))).toEqual({ code: 'RETRY', retryable: true });
  });

  it('fail-closed : contrainte inconnue, SQLSTATE incohérent, erreur sans champ → INTERNAL_ERROR', () => {
    const internal = { code: 'INTERNAL_ERROR', retryable: false };
    expect(translateDbError(pgError({ code: '23505', constraint: 'inconnue' }))).toEqual(internal);
    // bon nom, mauvais SQLSTATE : on ne devine pas
    expect(
      translateDbError(pgError({ code: '23505', constraint: 'vehicle_occupancy_no_overlap' })),
    ).toEqual(internal);
    expect(translateDbError(new Error('x'))).toEqual(internal);
    expect(translateDbError(null)).toEqual(internal);
    expect(translateDbError('23P01')).toEqual(internal);
    // propriété héritée : ignorée (seules les propriétés propres de l'erreur sont lues)
    expect(translateDbError(pgError({ code: '23505', constraint: 'toString' }))).toEqual(internal);
  });

  it('chaque contrainte traduite existe dans les migrations de production, avec un code connu', () => {
    const sql = listMigrations([MIGRATIONS_DIR])
      .map((m) => m.sql)
      .join('\n');
    for (const [constraint, [, code]] of Object.entries(CONSTRAINT_CODES)) {
      expect(sql, constraint).toMatch(new RegExp(`\\b${constraint}\\b`));
      expect(DB_BUSINESS_CODES).toContain(code);
    }
  });
});
