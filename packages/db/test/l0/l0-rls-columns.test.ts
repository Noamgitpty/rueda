/**
 * Colonnes lisibles, rôle par rôle (US-011 ; revue sécurité US-011, MAJEUR 1 ; 17 §2.3 RLS-26,
 * minimisation NOUVELLE-16). Liste EXACTE des colonnes que `app_api`, `app_worker` et `app_anon`
 * peuvent lire sur les tables ouvertes par 0025 ; aucun identifiant du personnel (`created_by`,
 * `updated_by`, `released_by`, `granted_by`, `approved_by`) lisible par `app_api` sur les tables
 * métier ; `app_anon` ne lit aucune colonne de `core`.
 */
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { withRole } from '../../src/testing/index.ts';

/** Colonnes accordées à app_api par 0025 (et 0022 pour aucune), triées à la comparaison. */
const API_COLUMNS: Record<string, readonly string[]> = {
  booking_trip: [
    'id',
    'public_ref',
    'guest_user_id',
    'org_id',
    'vehicle_id',
    'listing_id',
    'country_code',
    'currency',
    'timezone',
    'scheduled_start',
    'scheduled_end',
    'booked_at',
    'status',
    'requirements_status',
    'payment_status',
    'source_hold_id',
    'termination_reason',
    'cancellation_reason',
    'created_at',
    'updated_at',
  ],
  booking_checkout_hold: [
    'id',
    'guest_user_id',
    'vehicle_id',
    'org_id',
    'country_code',
    'quote_id',
    'kind',
    'status',
    'expires_at',
    'payment_in_flight_until',
    'expired_at',
    'released_at',
    'release_reason',
    'converted_trip_id',
    'compensated_at',
    'created_at',
    'updated_at',
  ],
  booking_guest_occupancy: [
    'id',
    'guest_user_id',
    'period',
    'active',
    'trip_id',
    'created_at',
    'updated_at',
  ],
  payment_payment_operation: [
    'id',
    'hold_id',
    'trip_id',
    'country_code',
    'kind',
    'purpose',
    'amount_minor',
    'currency',
    'status',
    'created_at',
    'updated_at',
  ],
  support_support_case: [
    'id',
    'requester_user_id',
    'country_code',
    'trip_id',
    'channel',
    'category',
    'priority',
    'status',
    'assignee_id',
    'reason',
    'sla_due_at',
    'created_at',
    'updated_at',
  ],
  iam_user_account: [
    'id',
    'email',
    'email_verified_at',
    'phone_e164',
    'phone_verified_at',
    'legal_first_name',
    'legal_last_name',
    'display_name',
    'date_of_birth',
    'preferred_locale',
    'residence_country',
    'status',
    'created_at',
    'updated_at',
  ],
  iam_organization: [
    'id',
    'kind',
    'holder_user_id',
    'country_code',
    'display_name',
    'tax_id',
    'status',
    'plan_code',
    'legal_entity_id',
    'created_at',
    'updated_at',
  ],
  iam_membership: [
    'id',
    'user_id',
    'org_id',
    'role',
    'vehicle_scope',
    'permission_overrides',
    'status',
    'invite_expires_at',
    'created_at',
    'updated_at',
  ],
  // règlements et jambes (0027, US-018) : tout sauf row_version de trip_leg_balance
  settlement_settlement: [
    'id',
    'trip_id',
    'segment_no',
    'version',
    'supersedes_id',
    'org_id',
    'country_code',
    'currency',
    'kind',
    'engine_version',
    'requested_reason',
    'reason',
    'origin',
    'qualification',
    'target_state',
    'host_eligible',
    'total_paid_minor',
    'guest_refund_minor',
    'tax_refund_minor',
    'retained_minor',
    'retained_tax_minor',
    'host_from_guest_minor',
    'host_compensation_minor',
    'host_earnings_minor',
    'platform_net_minor',
    'host_penalty_minor',
    'negative_leg',
    'inputs_hash',
    'param_snapshot_hash',
    'created_at',
  ],
  settlement_settlement_line: [
    'settlement_id',
    'line_type',
    'amount_minor',
    'refund_minor',
    'retained_minor',
  ],
  settlement_settlement_tax_line: [
    'settlement_id',
    'tax_group',
    'third_party',
    'tax_paid_minor',
    'tax_refund_minor',
    'retained_tax_minor',
  ],
  settlement_settlement_leg: [
    'settlement_id',
    'trip_id',
    'segment_no',
    'org_id',
    'country_code',
    'leg',
    'kept_minor',
    'advance_minor',
    'basis_minor',
    'variation_minor',
  ],
  settlement_trip_leg_balance: [
    'trip_id',
    'segment_no',
    'leg',
    'org_id',
    'country_code',
    'currency',
    'captured_minor',
    'refunded_minor',
    'reallocated_in_minor',
    'reallocated_out_minor',
    'released_minor',
    'frozen',
    'frozen_reason',
    'release_at',
    'created_at',
    'updated_at',
  ],
};

/** Tables lues en entier par les travailleurs (0007, US-006 ; 0027, US-018) ; aucune lecture IAM ni support. */
const WORKER_FULL_TABLES = [
  'booking_trip',
  'booking_checkout_hold',
  'booking_guest_occupancy',
  'payment_payment_operation',
  'settlement_settlement',
  'settlement_settlement_line',
  'settlement_settlement_tax_line',
  'settlement_settlement_leg',
  'settlement_trip_leg_balance',
];

const STAFF_ID_COLUMNS = ['created_by', 'updated_by', 'released_by', 'granted_by', 'approved_by'];

async function readable(client: pg.ClientBase, role: string, table: string): Promise<string[]> {
  const { rows } = await client.query<{ col: string }>(
    `SELECT a.attname::text AS col
       FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = ('core.' || $2)::regclass AND a.attnum > 0 AND NOT a.attisdropped
        AND pg_catalog.has_column_privilege($1, a.attrelid, a.attnum, 'SELECT')`,
    [role, table],
  );
  return rows.map((r) => r.col).sort();
}

async function allColumns(client: pg.ClientBase, table: string): Promise<string[]> {
  const { rows } = await client.query<{ col: string }>(
    `SELECT a.attname::text AS col FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = ('core.' || $1)::regclass AND a.attnum > 0 AND NOT a.attisdropped`,
    [table],
  );
  return rows.map((r) => r.col).sort();
}

describe('colonnes lisibles, rôle par rôle (US-011)', () => {
  it('app_api : liste exacte par table ouverte ; ni colonnes d’audit ni drapeaux internes', async () => {
    await withRole('app_api', async (client) => {
      for (const [table, cols] of Object.entries(API_COLUMNS)) {
        expect(await readable(client, 'app_api', table), table).toEqual([...cols].sort());
      }
    });
  });

  it('app_worker : tables AVL / PAY de 0007 en entier, aucune colonne IAM ni support', async () => {
    await withRole('app_worker', async (client) => {
      for (const table of Object.keys(API_COLUMNS)) {
        const expected = WORKER_FULL_TABLES.includes(table) ? await allColumns(client, table) : [];
        expect(await readable(client, 'app_worker', table), table).toEqual(expected);
      }
    });
  });

  it('app_anon : aucune colonne d’aucune table de core', async () => {
    await withRole('app_anon', async (client) => {
      const { rows } = await client.query<{ t: string }>(
        `SELECT c.relname::text AS t
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relkind IN ('r', 'p', 'v', 'm')
            AND pg_catalog.has_any_column_privilege('app_anon', c.oid, 'SELECT')`,
      );
      expect(rows).toEqual([]);
    });
  });

  it('aucun identifiant du personnel lisible par app_api sur les tables métier (booking, payment, iam, support, audit, settlement)', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ col: string }>(
        `SELECT c.relname || '.' || a.attname AS col
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          WHERE n.nspname = 'core' AND c.relkind IN ('r', 'p')
            AND c.relname ~ '^(booking|payment|iam|support|audit|settlement)_'
            AND a.attname = ANY ($1::name[])
            AND pg_catalog.has_column_privilege('app_api', c.oid, a.attnum, 'SELECT')`,
        [STAFF_ID_COLUMNS],
      );
      expect(rows).toEqual([]);
    });
  });
});
