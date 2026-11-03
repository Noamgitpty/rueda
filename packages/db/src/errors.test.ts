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
    ['23000', 'settlement_version_taken', 'SETTLEMENT_EXISTS'],
    ['23505', 'settlement_version_unique', 'SETTLEMENT_EXISTS'],
    ['23000', 'settlement_trip_version', 'SETTLEMENT_STALE'],
    ['23000', 'settlement_unbalanced', 'SETTLEMENT_UNBALANCED'],
    ['23514', 'settlement_balance', 'SETTLEMENT_UNBALANCED'],
    ['55000', 'host_payout_rail_unavailable', 'HOST_PAYOUT_RAIL_UNAVAILABLE'],
    ['55000', 'leg_already_released', 'LEG_ALREADY_RELEASED'],
    ['55000', 'leg_frozen', 'LEG_ALREADY_RELEASED'],
    ['55000', 'leg_movement_exceeds_balance', 'LEG_AMOUNT_NEGATIVE'],
    ['23514', 'settlement_leg_kept_nonneg', 'LEG_AMOUNT_NEGATIVE'],
    ['23514', 'trip_leg_balance_nonneg', 'LEG_AMOUNT_NEGATIVE'],
    ['23000', 'settlement_immutable', 'IMMUTABLE_RECORD'],
    // US-022 (0032) : blocages de l'hôte et tampons
    ['42501', 'occupancy_host_forbidden', 'FORBIDDEN'],
    ['23P01', 'occupancy_vehicle_single_org', 'FORBIDDEN'],
    ['23514', 'occupancy_period_invalid', 'INVALID_PERIOD'],
    ['23514', 'period_valid', 'INVALID_PERIOD'],
    ['55000', 'occupancy_buffer_trip_state', 'INVALID_TRANSITION'],
    ['55000', 'occupancy_buffer_param_missing', 'PARAM_MISSING'],
    // commandes de hold (0037, US-023)
    ['42501', 'hold_forbidden', 'FORBIDDEN'],
    ['55000', 'hold_vehicle_unknown', 'VEHICLE_UNAVAILABLE'],
    ['55000', 'hold_host_not_active', 'HOST_NOT_ACTIVATED'],
    ['55000', 'hold_self_booking', 'SELF_BOOKING_FORBIDDEN'],
    ['55000', 'hold_param_missing', 'PARAM_MISSING'],
    ['55000', 'hold_guest_limit', 'HOLD_LIMIT_REACHED'],
    ['55000', 'hold_guest_overlap', 'GUEST_OVERLAP'],
    ['55000', 'hold_rate_limited', 'HOLD_RATE_LIMITED'],
    ['55000', 'hold_release_terminal', 'INVALID_TRANSITION'],
    ['23000', 'hold_guarded_columns', 'IMMUTABLE_RECORD'],
    ['23000', 'booking_record_no_delete', 'IMMUTABLE_RECORD'],
    ['23514', 'hold_review_before_payment', 'BOOKING_UNDER_REVIEW'],
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
