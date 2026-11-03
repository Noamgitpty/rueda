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

  it('la commande réelle core.booking_cmd_place_hold (0037, US-023) contient EXPIRY_2A_SQL aux paramètres près', () => {
    const migration = readFileSync(join(MIGRATIONS_DIR, '0037_booking_hold_commands.sql'), 'utf8');
    const expected = EXPIRY_2A_SQL.replaceAll('$1::uuid', 'p_vehicle_id')
      .replaceAll('$2::uuid', 'v_guest')
      .replaceAll('$3', 'v_grace');
    expect(normalize(migration)).toContain(normalize(`${expected};`));
  });

  it('la ré-acquisition (core.booking_convert_payment, 0040, US-024) contient EXPIRY_2A_SQL, partie véhicule seule', () => {
    const migration = readFileSync(
      join(MIGRATIONS_DIR, '0040_booking_guarded_conversion.sql'),
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
});
