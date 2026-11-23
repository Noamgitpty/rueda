/**
 * Le texte de 2a de la fixture de pose (`test_fixture.l0_place_hold`, 9002) et de la commande
 * réelle `core.booking_cmd_place_hold` (0037, US-023) est celui d'`EXPIRY_2A_SQL`, aux
 * paramètres près (revue sécurité US-007, constat mineur) : la pose de L0-02 et le plan de L0-04
 * mesurent la même instruction.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, TEST_MIGRATIONS_DIR } from '../../src/paths.ts';
import { EXPIRY_2A_SQL } from './expiry-2a.ts';

/** Espaces réduits ; aucun espace après « ( » ni avant « ) ». */
const normalize = (sql: string): string =>
  sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();

describe('instruction 2a : une seule source', () => {
  it('la fixture 9002 contient EXPIRY_2A_SQL aux paramètres près', () => {
    const fixture = readFileSync(join(TEST_MIGRATIONS_DIR, '9002_test_l0_concurrency.sql'), 'utf8');
    const expected = EXPIRY_2A_SQL.replaceAll('$1::uuid', 'p_vehicle_id')
      .replaceAll('$2::uuid', 'p_guest_id')
      .replaceAll('$3', 'p_sweep_grace_s')
      .replace(
        /RETURNING occupancy_id\s*\)\s*UPDATE core\.booking_vehicle_occupancy/,
        'RETURNING occupancy_id ), deactivated AS ( UPDATE core.booking_vehicle_occupancy',
      );
    expect(normalize(fixture)).toContain(normalize(`${expected} RETURNING ref_id )`));
  });

  // 0056 (US-049, F-RLS-02) remplace le corps de la commande, puis 0126 (US-223c) le déplace dans
  // core.booking_place_hold_kind et 0179 (US-007, ADR-199 : refus rapide) le remplace : la
  // définition en vigueur est celle de 0179, qui doit garder la même instruction 2a que 0037.
  it.each([
    '0037_booking_hold_commands.sql',
    '0056_booking_vehicle_ownership_guards.sql',
    '0126_booking_request_mode.sql',
    '0179_booking_hold_fast_refusal.sql',
  ])(
    'la commande réelle core.booking_cmd_place_hold (%s) contient EXPIRY_2A_SQL aux paramètres près',
    (file) => {
      const migration = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const expected = EXPIRY_2A_SQL.replaceAll('$1::uuid', 'p_vehicle_id')
        .replaceAll('$2::uuid', 'v_guest')
        .replaceAll('$3', 'v_grace');
      expect(normalize(migration)).toContain(normalize(`${expected};`));
    },
  );

  it('la ré-acquisition (core.booking_convert_payment, 0041, US-024) contient EXPIRY_2A_SQL, partie véhicule seule', () => {
    const migration = readFileSync(
      join(MIGRATIONS_DIR, '0041_booking_guarded_conversion.sql'),
      'utf8',
    );
    const expected = EXPIRY_2A_SQL.replaceAll('$1::uuid', 'v_vehicle')
      .replaceAll('$2::uuid', 'NULL::uuid')
      .replaceAll('$3', 'v_grace');
    expect(normalize(migration)).toContain(normalize(`${expected};`));
  });

  it('le texte de 2a garde ses invariants de 17 §2.5', () => {
    const sql = normalize(EXPIRY_2A_SQL);
    expect(sql).toContain('(h.vehicle_id = $1::uuid OR h.guest_user_id = $2::uuid)');
    expect(sql).toContain('FOR UPDATE OF h SKIP LOCKED');
    expect(sql).toContain("AND kind = 'HOLD'");
    expect(sql.replaceAll('platform.now()', '')).not.toMatch(/now\(\)/i);
  });

  // US-007 (ADR-199, 0179) : le refus rapide est un court-circuit sous le verrou du véhicule,
  // jamais une garde à la place de l'exclusion GiST ni une écriture.
  it('0179 : refus rapide après les verrous guest puis véhicule, avant 2a, sans écriture, puis insertion inchangée', () => {
    const sql = normalize(
      readFileSync(join(MIGRATIONS_DIR, '0179_booking_hold_fast_refusal.sql'), 'utf8'),
    );
    const guestLock = sql.indexOf("hashtextextended('guest:' || v_guest::text, 0)");
    const vehicleLock = sql.indexOf("hashtextextended('veh:' || p_vehicle_id::text, 0)");
    const fast = sql.indexOf("RAISE EXCEPTION 'hold: vehicle unavailable'");
    const expiry = sql.indexOf('WITH t AS (SELECT platform.now() AS ts), due AS');
    const insert = sql.indexOf('INSERT INTO core.booking_vehicle_occupancy');
    expect(guestLock).toBeGreaterThan(0);
    expect(vehicleLock).toBeGreaterThan(guestLock);
    expect(fast).toBeGreaterThan(vehicleLock);
    expect(expiry).toBeGreaterThan(fast);
    expect(insert).toBeGreaterThan(expiry);
    // même erreur que la contrainte : 23P01, vehicle_occupancy_no_overlap (VEHICLE_UNAVAILABLE)
    const raise = sql.slice(fast, sql.indexOf('END IF;', fast));
    expect(raise).toContain("ERRCODE = 'exclusion_violation'");
    expect(raise).toContain("CONSTRAINT = 'vehicle_occupancy_no_overlap'");
    expect(raise).not.toMatch(/DETAIL/);
    // entre le verrou du véhicule et le refus : une lecture, aucune écriture
    expect(sql.slice(vehicleLock, fast)).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });
});
