/**
 * US-019 — port PaymentProvider côté base (migration 0028), sous les rôles de PRODUCTION
 * (CLAUDE.md point 6 ; assertion L0-05 en tête de chaque test par withRole / connectAs).
 *
 * Critères (19 US-019) :
 * 1. même clé d'idempotence, montant (ou jambes) différent ⇒ IDEMPOTENCY_CONFLICT ;
 * 2. webhook à signature invalide ⇒ REJECTED_SIGNATURE ; doublon ⇒ dédoublonné par webhook_inbox ;
 * 3. C19 : compte FAKE en production refusé (CHECK + trigger), refus de démarrage (garde lue en
 *    base), webhook FAKE sur la base de production ⇒ NOT_FOUND sans écriture ;
 * 5. jambes explicites : Σ jambes = montant, jambes ≥ 0, sinon LEG_SUM_MISMATCH / LEG_AMOUNT_NEGATIVE ;
 * 6. aucun PAN ni CVV en base (schéma, contrainte webhook_inbox_no_pan).
 * Plus : rangs des statuts (17 §4.4 point 7), dédoublonnage, quarantaine à ± 5 min (heure de la
 * base). Montants : vecteurs TJ des oracles (`@rueda/money/golden-vectors`), en USD (PA) et en PYG
 * sans décimale (PY).
 */
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { GoldenLegVector } from '@rueda/money/golden-vectors';
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../src/index.ts';
import { withRole } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import {
  applyStatus,
  caught,
  insertAccount,
  insertTrip,
  payTx,
  publicWebhookId,
  recordOperation,
  signedWebhook,
  uuid,
} from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';

const set = loadGoldenVectors();
/** Capture du trip et variation de son règlement, par devise (08 E7 : TJ01 / TJ02b, TJ08a / TJ08b). */
const VECTORS: Record<string, { capture: GoldenLegVector; variation: GoldenLegVector }> = {
  [legVector(set, 'TJ01').currency]: {
    capture: legVector(set, 'TJ01'),
    variation: legVector(set, 'TJ02b'),
  },
  [legVector(set, 'TJ08a').currency]: {
    capture: legVector(set, 'TJ08a'),
    variation: legVector(set, 'TJ08b'),
  },
};
const legsOf = (v: GoldenLegVector): Legs => ({ ...v.legsMinor });
const negate = (l: Legs): Legs => ({
  HOST: -l.HOST,
  INSURER: -l.INSURER,
  TAX_THIRD_PARTY: -l.TAX_THIRD_PARTY,
  PLATFORM: -l.PLATFORM,
});
const sha256 = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();
const T0 = '2031-07-01T08:00:00.000Z';

describe('C19 — base de PRODUCTION du banc (migrations de production seules)', () => {
  it('platform.deployment_env() = production, sans paramètre de test ; garde de démarrage : 0 compte FAKE', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<{ env: string; src: string }>(
          `SELECT platform.deployment_env() AS env, p.prosrc AS src
             FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'platform' AND p.proname = 'deployment_env'`,
        );
        expect(rows[0]?.env).toBe('production');
        expect(rows[0]?.src).not.toMatch(/test_deployment_env|current_setting/);
        await client.query(
          `SELECT pg_catalog.set_config('app.test_deployment_env', 'test', false)`,
        );
        const guard = await client.query<{ deployment_env: string; fake_accounts: number }>(
          'SELECT deployment_env, fake_accounts FROM core.payment_startup_guard()',
        );
        expect(guard.rows).toEqual([{ deployment_env: 'production', fake_accounts: 0 }]);
      },
      { database: 'production' },
    );
  });

  it('aucun rôle applicatif n’écrit un compte PSP en production ; webhook FAKE inconnu ⇒ aucune ligne', async () => {
    await withRole(
      'app_worker',
      async (client) => {
        for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          const { rows } = await client.query<{ has: boolean }>(
            `SELECT pg_catalog.has_table_privilege('app_worker', 'core.payment_psp_account', $1) AS has`,
            [priv],
          );
          expect(rows[0]?.has, priv).toBe(false);
        }
      },
      { database: 'production' },
    );
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM core.payment_resolve_webhook_account('FAKE', $1)`,
          [publicWebhookId()],
        );
        expect(rows).toEqual([]);
      },
      { database: 'production' },
    );
  });
});

describe.each(COUNTRIES)('US-019 — $country ($currency)', (c) => {
  const v = VECTORS[c.currency];
  if (v === undefined) throw new Error(`aucun vecteur TJ en ${c.currency}`);
  const capture = { amountMinor: v.capture.totalMinor, legs: legsOf(v.capture) };
  const refund = { amountMinor: -v.variation.totalMinor, legs: negate(legsOf(v.variation)) };

  describe('C19 — garde FAKE', () => {
    it('compte FAKE écrit quand la base est en production ⇒ refus (psp_account_fake_forbidden)', async () => {
      await withRole('app_worker', async (client) => {
        await payTx(client, { deploymentEnv: 'production' }, async (tx) => {
          const err = await caught(tx, () =>
            insertAccount(tx, { country: c.country, status: 'PENDING_VALIDATION' }),
          );
          expect(err).toMatchObject({ code: '23000', constraint: 'psp_account_fake_forbidden' });
          expect(translateDbError(err).code).toBe('FAKE_FORBIDDEN_IN_PRODUCTION');
          // un compte réel en bac à sable reste admis
          await insertAccount(tx, {
            provider: 'TILOPAY',
            country: c.country,
            status: 'PENDING_VALIDATION',
          });
        });
        // créé hors production, puis activé quand la base passe en production : refusé
        await payTx(client, {}, async (tx) => {
          const id = await insertAccount(tx, { country: c.country, status: 'PENDING_VALIDATION' });
          await tx.query(
            `SELECT pg_catalog.set_config('app.test_deployment_env', 'production', true)`,
          );
          const err = await caught(tx, () =>
            tx.query(`UPDATE core.payment_psp_account SET status = 'ACTIVE' WHERE id = $1`, [id]),
          );
          expect(err).toMatchObject({ code: '23000', constraint: 'psp_account_fake_forbidden' });
        });
      });
    });

    it('FAKE en LIVE ⇒ CHECK psp_account_fake_sandbox_only ; LIVE réel actif sans porte PAY-041 ⇒ refus ; PLATFORM_MOR fermé', async () => {
      await withRole('app_worker', async (client) => {
        await payTx(client, {}, async (tx) => {
          const live = await caught(tx, () =>
            insertAccount(tx, {
              country: c.country,
              environment: 'LIVE',
              status: 'PENDING_VALIDATION',
            }),
          );
          expect(live).toMatchObject({
            code: '23514',
            constraint: 'psp_account_fake_sandbox_only',
          });
          expect(translateDbError(live).code).toBe('FAKE_FORBIDDEN_IN_PRODUCTION');
          const gate = await caught(tx, () =>
            insertAccount(tx, { provider: 'DLOCAL', country: c.country, environment: 'LIVE' }),
          );
          expect(gate).toMatchObject({ code: '23514', constraint: 'psp_account_live_gate' });
          const mor = await caught(tx, () =>
            tx.query(
              `INSERT INTO core.payment_psp_account (id, provider, country_code, environment, collection_mode,
                                                     public_webhook_id)
               VALUES ($1, 'DLOCAL', $2, 'SANDBOX', 'PLATFORM_MOR', $3)`,
              [uuid(), c.country, publicWebhookId()],
            ),
          );
          expect(mor).toMatchObject({
            code: '23514',
            constraint: 'psp_account_platform_mor_closed',
          });
        });
      });
    });

    it('refus de démarrage : la garde voit le compte FAKE quand la base est en production', async () => {
      await withRole('app_worker', async (client) => {
        await payTx(client, {}, async (tx) => {
          await insertAccount(tx, { country: c.country, status: 'PENDING_VALIDATION' });
          await tx.query(
            `SELECT pg_catalog.set_config('app.test_deployment_env', 'production', true)`,
          );
          const { rows } = await tx.query<{ deployment_env: string; fake_accounts: number }>(
            'SELECT deployment_env, fake_accounts FROM core.payment_startup_guard()',
          );
          expect(rows[0]?.deployment_env).toBe('production');
          expect(rows[0]?.fake_accounts).toBeGreaterThanOrEqual(1);
        });
      });
    });

    it('webhook FAKE posté quand la base est en production ⇒ NOT_FOUND, aucune ligne de webhook_inbox', async () => {
      const hook = publicWebhookId();
      let accountId = '';
      await withRole('app_worker', (client) =>
        payTx(client, { commit: true }, async (tx) => {
          accountId = await insertAccount(tx, {
            country: c.country,
            status: 'PENDING_VALIDATION',
            publicWebhookId: hook,
          });
        }),
      );
      await withRole('app_api', async (client) => {
        await payTx(client, { deploymentEnv: 'production', commit: true }, async (tx) => {
          const resolved = await tx.query(
            `SELECT * FROM core.payment_resolve_webhook_account('FAKE', $1)`,
            [hook],
          );
          expect(resolved.rows).toEqual([]);
          const { rows } = await tx.query<{ outcome: string; inbox_id: string | null }>(
            `SELECT outcome, inbox_id FROM core.payment_cmd_receive_webhook($1, 'evt_1', $2, true, NULL, '{}'::jsonb, '[]'::jsonb)`,
            [accountId, sha256(`evt:${hook}`)],
          );
          expect(rows).toEqual([{ outcome: 'NOT_FOUND', inbox_id: null }]);
        });
        // hors production : le même compte est résolu (référence du secret seulement)
        await payTx(client, {}, async (tx) => {
          const { rows } = await tx.query<{ account_id: string; webhook_secret_ref: string }>(
            `SELECT account_id, webhook_secret_ref FROM core.payment_resolve_webhook_account('FAKE', $1)`,
            [hook],
          );
          expect(rows).toEqual([
            { account_id: accountId, webhook_secret_ref: 'vault:psp/test/webhook' },
          ]);
        });
      });
      await withRole('app_worker', (client) =>
        payTx(client, { worker: 'webhook_ingest' }, async (tx) => {
          const { rows } = await tx.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM core.payment_webhook_inbox WHERE psp_account_id = $1`,
            [accountId],
          );
          expect(rows[0]?.n).toBe(0);
        }),
      );
    });
  });

  describe('opérations : idempotence et jambes (08 E4, E7 règle 1)', () => {
    it('même clé, même contenu ⇒ rejeu ; montant ou jambes différents ⇒ IDEMPOTENCY_CONFLICT', async () => {
      await withRole('app_worker', async (client) => {
        await payTx(client, { worker: 'payment_command' }, async (tx) => {
          const account = await insertAccount(tx, { country: c.country });
          const trip = await insertTrip(tx, c);
          const idem = `${trip}:1:v1:CAPTURE:card:i1:a1`;
          const base = {
            tripId: trip,
            accountId: account,
            currency: c.currency,
            idemPlain: idem,
            ...capture,
          };
          const first = await recordOperation(tx, base);
          expect(first.replayed).toBe(false);
          expect(await recordOperation(tx, { ...base, id: uuid() })).toEqual({
            operation_id: first.operation_id,
            replayed: true,
          });
          // montant différent (une unité de moins sur PLATFORM)
          const amount = await caught(tx, () =>
            recordOperation(tx, {
              ...base,
              amountMinor: capture.amountMinor - 1n,
              legs: { ...capture.legs, PLATFORM: capture.legs.PLATFORM - 1n },
            }),
          );
          expect(amount).toMatchObject({
            code: '23000',
            constraint: 'payment_operation_idempotency_conflict',
          });
          expect(translateDbError(amount).code).toBe('IDEMPOTENCY_CONFLICT');
          // même montant, jambes différentes (une unité de HOST passée à PLATFORM)
          const legs = await caught(tx, () =>
            recordOperation(tx, {
              ...base,
              legs: {
                ...capture.legs,
                HOST: capture.legs.HOST - 1n,
                PLATFORM: capture.legs.PLATFORM + 1n,
              },
            }),
          );
          expect(translateDbError(legs).code).toBe('IDEMPOTENCY_CONFLICT');
          // jambes enregistrées : exactement les quatre jambes du vecteur
          const { rows } = await tx.query<{
            leg: string;
            amount_minor: string;
            country_code: string;
          }>(
            `SELECT leg, amount_minor::text, country_code FROM core.payment_payment_operation_leg
              WHERE operation_id = $1 ORDER BY leg`,
            [first.operation_id],
          );
          expect(Object.fromEntries(rows.map((r) => [r.leg, BigInt(r.amount_minor)]))).toEqual(
            capture.legs,
          );
          expect(new Set(rows.map((r) => r.country_code))).toEqual(new Set([c.country]));
          // contrôle différé satisfait
          await tx.query('SET CONSTRAINTS ALL IMMEDIATE');
        });
      });
    });

    it('Σ jambes ≠ montant ⇒ LEG_SUM_MISMATCH ; jambe négative ⇒ LEG_AMOUNT_NEGATIVE ; jambes manquantes ⇒ 22023', async () => {
      await withRole('app_worker', async (client) => {
        await payTx(client, { worker: 'payment_command' }, async (tx) => {
          const account = await insertAccount(tx, { country: c.country });
          const trip = await insertTrip(tx, c);
          const base = { tripId: trip, accountId: account, currency: c.currency };
          const sum = await caught(tx, () =>
            recordOperation(tx, {
              ...base,
              idemPlain: `${trip}:sum`,
              amountMinor: capture.amountMinor + 1n,
              legs: capture.legs,
            }),
          );
          expect(translateDbError(sum).code).toBe('LEG_SUM_MISMATCH');
          const neg = await caught(tx, () =>
            recordOperation(tx, {
              ...base,
              idemPlain: `${trip}:neg`,
              amountMinor: capture.amountMinor,
              legs: {
                ...capture.legs,
                HOST: -1n,
                PLATFORM: capture.legs.PLATFORM + capture.legs.HOST + 1n,
              },
            }),
          );
          expect(translateDbError(neg).code).toBe('LEG_AMOUNT_NEGATIVE');
          const missing = await caught(tx, () =>
            tx.query(
              `SELECT * FROM core.payment_cmd_record_operation($1, NULL, $2, $3, 'CARD', 'CAPTURE', 'RENT', $4, $5, 1,
                                                                $6, $6, $7::jsonb)`,
              [
                uuid(),
                trip,
                account,
                capture.amountMinor.toString(),
                c.currency,
                `${trip}:missing`,
                '{"HOST":"1"}',
              ],
            ),
          );
          expect(missing?.code).toBe('22023');
          // remboursement : jambes = débit de chaque jambe (variation TJ, 08 E7 règle 3)
          const r = await recordOperation(tx, {
            ...base,
            kind: 'REFUND',
            idemPlain: `${trip}:1:v1:REFUND:card:i1:a1`,
            ...refund,
          });
          expect(r.replayed).toBe(false);
          // réaffectation de somme nulle (TJ05b : HOST → PLATFORM)
          const tj05b = legVector(set, 'TJ05b');
          if (tj05b.currency === c.currency) {
            const moved = tj05b.legsMinor.PLATFORM;
            const ok = await recordOperation(tx, {
              ...base,
              kind: 'LEG_REALLOCATION',
              idemPlain: `${trip}:realloc`,
              amountMinor: moved,
              legs: { HOST: -moved, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: moved },
            });
            expect(ok.replayed).toBe(false);
          }
          await tx.query('SET CONSTRAINTS ALL IMMEDIATE');
        });
      });
    });

    it('idem_sent ni clé ni SHA-256 ⇒ refus ; SHA-256 de la clé ⇒ accepté ; devise du trip exigée', async () => {
      await withRole('app_worker', async (client) => {
        await payTx(client, { worker: 'payment_command' }, async (tx) => {
          const account = await insertAccount(tx, { country: c.country });
          const trip = await insertTrip(tx, c);
          const idem = `${trip}:1:v1:CAPTURE:card:i1:a1`;
          const base = {
            tripId: trip,
            accountId: account,
            currency: c.currency,
            idemPlain: idem,
            ...capture,
          };
          expect(
            (await caught(tx, () => recordOperation(tx, { ...base, idemSent: 'autre' })))?.code,
          ).toBe('22023');
          const hashed = createHash('sha256').update(idem, 'utf8').digest('hex');
          expect((await recordOperation(tx, { ...base, idemSent: hashed })).replayed).toBe(false);
          const other = COUNTRIES.find((x) => x.currency !== c.currency);
          const cur = await caught(tx, () =>
            recordOperation(tx, {
              ...base,
              idemPlain: `${idem}:cur`,
              currency: other?.currency ?? 'XXX',
            }),
          );
          expect(translateDbError(cur).code).toBe('PAYMENT_SUBJECT_MISMATCH');
        });
      });
    });

    it('réservée au travailleur payment_command ; compte inactif ⇒ PSP_ACCOUNT_INACTIVE ; app_api n’a pas EXECUTE', async () => {
      await withRole('app_worker', async (client) => {
        await payTx(client, { worker: 'booking_conversion' }, async (tx) => {
          const account = await insertAccount(tx, { country: c.country });
          const trip = await insertTrip(tx, c);
          const err = await caught(tx, () =>
            recordOperation(tx, {
              tripId: trip,
              accountId: account,
              currency: c.currency,
              idemPlain: `${trip}:w`,
              ...capture,
            }),
          );
          expect(err?.code).toBe('42501');
        });
        await payTx(client, { worker: 'payment_command' }, async (tx) => {
          const account = await insertAccount(tx, { country: c.country, status: 'SUSPENDED' });
          const trip = await insertTrip(tx, c);
          const err = await caught(tx, () =>
            recordOperation(tx, {
              tripId: trip,
              accountId: account,
              currency: c.currency,
              idemPlain: `${trip}:s`,
              ...capture,
            }),
          );
          expect(translateDbError(err).code).toBe('PSP_ACCOUNT_INACTIVE');
        });
      });
      await withRole('app_api', async (client) => {
        const { rows } = await client.query<{ has: boolean }>(
          `SELECT pg_catalog.has_function_privilege('app_api',
             'core.payment_cmd_record_operation(uuid,uuid,uuid,uuid,text,text,text,bigint,text,integer,text,text,jsonb)',
             'EXECUTE') AS has`,
        );
        expect(rows[0]?.has).toBe(false);
      });
    });
  });

  describe('contrôle différé des jambes au COMMIT (payment_operation_legs_check)', () => {
    // écriture BRUTE (fixture 9500) qui contourne la commande : seul le trigger différé refuse
    const rawCommit = async (
      kind: string,
      amountMinor: bigint,
      legs: Record<string, bigint> | null,
      withAccount = true,
    ): Promise<{ code?: string; constraint?: string; column?: string } | null> => {
      try {
        await withRole('app_worker', (client) =>
          payTx(client, { commit: true }, async (tx) => {
            const trip = await insertTrip(tx, c);
            await tx.query(
              `SELECT test_fixture.pay_insert_operation_raw($1, $2, $3, $4::bigint, $5::jsonb, $6)`,
              [
                uuid(),
                trip,
                kind,
                amountMinor.toString(),
                legs === null
                  ? null
                  : JSON.stringify(
                      Object.fromEntries(Object.entries(legs).map(([k, v]) => [k, v.toString()])),
                    ),
                withAccount,
              ],
            );
          }),
        );
      } catch (error) {
        return error as { code?: string; constraint?: string; column?: string };
      }
      return null;
    };
    const legs = capture.legs as Record<string, bigint>;

    it('jambes valides : COMMIT accepté', async () => {
      expect(await rawCommit('CAPTURE', capture.amountMinor, legs)).toBeNull();
    });

    it('Σ jambes ≠ montant ⇒ refus au COMMIT (LEG_SUM_MISMATCH)', async () => {
      const err = await rawCommit('CAPTURE', capture.amountMinor + 1n, legs);
      expect(err).toMatchObject({ code: '23000', constraint: 'payment_operation_leg_sum' });
      expect(translateDbError(err).code).toBe('LEG_SUM_MISMATCH');
    });

    it('jambe négative (somme juste) ⇒ refus au COMMIT (LEG_AMOUNT_NEGATIVE)', async () => {
      const bad = { ...legs, HOST: -1n, PLATFORM: capture.legs.PLATFORM + capture.legs.HOST + 1n };
      const err = await rawCommit('CAPTURE', capture.amountMinor, bad);
      expect(err).toMatchObject({ code: '23000', constraint: 'payment_operation_leg_negative' });
      expect(translateDbError(err).code).toBe('LEG_AMOUNT_NEGATIVE');
    });

    it('jambes incomplètes, absentes ou sur un VOID ⇒ refus au COMMIT ; sans compte PSP ⇒ refus immédiat (NOT NULL, US-023)', async () => {
      const { TAX_THIRD_PARTY: _t, ...three } = legs;
      expect(_t).toBe(capture.legs.TAX_THIRD_PARTY);
      for (const err of [
        await rawCommit('CAPTURE', capture.amountMinor, three),
        await rawCommit('CAPTURE', capture.amountMinor, {}),
        await rawCommit('VOID', capture.amountMinor, legs),
      ]) {
        expect(err).toMatchObject({ code: '23000', constraint: 'payment_operation_legs_complete' });
      }
      // 0038 (report US-019) : toute opération porte son compte PSP
      expect(await rawCommit('CAPTURE', capture.amountMinor, legs, false)).toMatchObject({
        code: '23502',
        column: 'psp_account_id',
      });
    });

    it('réaffectation : Σ ≠ 0 ⇒ refus ; Σ = 0 et montant = Σ des crédits ⇒ accepté', async () => {
      const moved = capture.legs.PLATFORM;
      const ok = { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: -moved, PLATFORM: moved };
      expect(await rawCommit('LEG_REALLOCATION', moved, ok)).toBeNull();
      const err = await rawCommit('LEG_REALLOCATION', moved, { ...ok, PLATFORM: moved + 1n });
      expect(err).toMatchObject({ code: '23000', constraint: 'payment_operation_leg_sum' });
    });
  });

  describe('statuts : rangs de 17 §4.4 point 7, journalisés', () => {
    it('SUBMITTED, SUCCEEDED appliqués ; SUBMITTED tardif STALE ; doublon DUPLICATE ; FAILED contradictoire CONFLICT', async () => {
      await withRole('app_worker', async (client) => {
        await payTx(client, { worker: 'payment_command' }, async (tx) => {
          const account = await insertAccount(tx, { country: c.country });
          const trip = await insertTrip(tx, c);
          const { operation_id: op } = await recordOperation(tx, {
            tripId: trip,
            accountId: account,
            currency: c.currency,
            idemPlain: `${trip}:1:v1:CAPTURE:card:i1:a1`,
            ...capture,
          });
          expect(await applyStatus(tx, op, 'SUBMITTED', 'API_RESPONSE', 'fk_tx_000001')).toBe(
            'APPLIED',
          );
          // US-049 (RC-5, 0055) : sans webhook signé reçu, aucune preuve WEBHOOK_SIGNED
          expect(await applyStatus(tx, op, 'SUCCEEDED', 'WEBHOOK')).toBe('UNPROVEN');
          expect(
            await applyStatus(
              tx,
              op,
              'SUCCEEDED',
              'WEBHOOK',
              null,
              await signedWebhook(tx, op, 'SUCCEEDED'),
            ),
          ).toBe('APPLIED');
          expect(await applyStatus(tx, op, 'SUBMITTED', 'WEBHOOK')).toBe('STALE');
          expect(await applyStatus(tx, op, 'SUCCEEDED', 'WEBHOOK')).toBe('DUPLICATE');
          expect(await applyStatus(tx, op, 'FAILED', 'WEBHOOK')).toBe('CONFLICT');
          expect(await applyStatus(tx, uuid(), 'SUCCEEDED', 'WEBHOOK')).toBe('NOT_FOUND');
          const { rows } = await tx.query<{
            status: string;
            provider_reference: string;
            proof_type: string;
          }>(
            `SELECT status, provider_reference, proof_type FROM core.payment_payment_operation WHERE id = $1`,
            [op],
          );
          expect(rows[0]).toEqual({
            status: 'SUCCEEDED',
            provider_reference: 'fk_tx_000001',
            proof_type: 'WEBHOOK_SIGNED',
          });
          const events = await tx.query<{ status: string; outcome: string }>(
            `SELECT status, outcome FROM core.payment_payment_operation_event WHERE operation_id = $1 ORDER BY at, id`,
            [op],
          );
          expect(events.rows.map((e) => e.outcome).sort()).toEqual(
            ['APPLIED', 'APPLIED', 'CONFLICT', 'DUPLICATE', 'STALE'].sort(),
          );
          // référence PSP contradictoire ⇒ CONFLICT
          const { operation_id: op2 } = await recordOperation(tx, {
            tripId: trip,
            accountId: account,
            currency: c.currency,
            idemPlain: `${trip}:1:v1:CAPTURE:card:i2:a1`,
            ...capture,
          });
          expect(await applyStatus(tx, op2, 'UNKNOWN', 'API_RESPONSE', 'ref-a')).toBe('APPLIED');
          expect(await applyStatus(tx, op2, 'SUCCEEDED', 'POLL', 'ref-b')).toBe('CONFLICT');
        });
        // un travailleur hors liste ne peut pas appliquer de statut
        await payTx(client, { worker: 'trip_lifecycle' }, async (tx) => {
          const err = await caught(tx, () => applyStatus(tx, uuid(), 'SUCCEEDED'));
          expect(err?.code).toBe('42501');
        });
      });
    });
  });

  describe('webhook_inbox : signature, dédoublonnage, quarantaine, aucun PAN', () => {
    async function account(): Promise<string> {
      let id = '';
      await withRole('app_worker', (client) =>
        payTx(client, { commit: true }, async (tx) => {
          id = await insertAccount(tx, { country: c.country, status: 'PENDING_VALIDATION' });
        }),
      );
      return id;
    }

    const receive = (
      tx: pg.ClientBase,
      accountId: string,
      opts: {
        eventId: string;
        valid?: boolean;
        signedAt?: string | null;
        headers?: object;
        events?: unknown[];
      },
    ) =>
      tx.query<{ outcome: string; inbox_id: string | null }>(
        `SELECT outcome, inbox_id FROM core.payment_cmd_receive_webhook($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
        [
          accountId,
          opts.eventId,
          sha256(`${opts.valid === false ? 'rejected' : 'evt'}:${opts.eventId}`),
          opts.valid ?? true,
          opts.signedAt ?? null,
          JSON.stringify(opts.headers ?? { 'content-type': 'application/json' }),
          JSON.stringify(
            opts.events ?? [
              {
                type: 'payment.captured',
                providerReference: 'fk_tx_000001',
                merchantReference: null,
                status: 'SUCCEEDED',
                occurredAt: T0,
              },
            ],
          ),
        ],
      );

    it('reçu, doublon (200 sans traitement), signature invalide (REJECTED_SIGNATURE, sans événement)', async () => {
      const accountId = await account();
      const eventId = `evt_${uuid()}`;
      await withRole('app_api', async (client) => {
        await payTx(client, { commit: true }, async (tx) => {
          expect((await receive(tx, accountId, { eventId })).rows[0]?.outcome).toBe('RECEIVED');
          expect((await receive(tx, accountId, { eventId })).rows[0]).toEqual({
            outcome: 'DUPLICATE',
            inbox_id: null,
          });
          expect((await receive(tx, accountId, { eventId, valid: false })).rows[0]?.outcome).toBe(
            'REJECTED_SIGNATURE',
          );
        });
      });
      await withRole('app_worker', (client) =>
        payTx(client, { worker: 'webhook_ingest' }, async (tx) => {
          const { rows } = await tx.query<{
            processing_status: string;
            signature_valid: boolean;
            has_events: boolean;
          }>(
            `SELECT processing_status, signature_valid, normalized_events IS NOT NULL AS has_events
               FROM core.payment_webhook_inbox WHERE psp_account_id = $1 ORDER BY processing_status`,
            [accountId],
          );
          expect(rows).toEqual([
            { processing_status: 'RECEIVED', signature_valid: true, has_events: true },
            { processing_status: 'REJECTED_SIGNATURE', signature_valid: false, has_events: false },
          ]);
        }),
      );
    });

    it('horodatage signé à plus de 5 min de l’heure de la BASE ⇒ QUARANTINED ; à 5 min ⇒ RECEIVED', async () => {
      const accountId = await account();
      await withRole('app_api', async (client) => {
        await payTx(client, { virtualNow: T0 }, async (tx) => {
          const late = new Date(Date.parse(T0) - 5 * 60_000 - 1_000).toISOString();
          const edge = new Date(Date.parse(T0) - 5 * 60_000).toISOString();
          expect(
            (await receive(tx, accountId, { eventId: `e_${uuid()}`, signedAt: late })).rows[0]
              ?.outcome,
          ).toBe('QUARANTINED');
          expect(
            (await receive(tx, accountId, { eventId: `e_${uuid()}`, signedAt: edge })).rows[0]
              ?.outcome,
          ).toBe('RECEIVED');
        });
      });
    });

    it('PAN (13 à 19 chiffres, Luhn) dans les événements ou les en-têtes ⇒ refusé par webhook_inbox_no_pan ; masqué ⇒ accepté', async () => {
      const accountId = await account();
      // numéro de test public d'un réseau (Luhn valide), jamais une carte réelle
      const pan = '4111 1111 1111 1111';
      await withRole('app_api', async (client) => {
        await payTx(client, {}, async (tx) => {
          const inEvents = await caught(tx, () =>
            receive(tx, accountId, {
              eventId: `e_${uuid()}`,
              events: [
                {
                  type: 'x',
                  providerReference: pan,
                  merchantReference: null,
                  status: 'FAILED',
                  occurredAt: T0,
                },
              ],
            }),
          );
          expect(inEvents).toMatchObject({ code: '23514', constraint: 'webhook_inbox_no_pan' });
          const inHeaders = await caught(tx, () =>
            receive(tx, accountId, {
              eventId: `e_${uuid()}`,
              headers: { 'x-debug': pan.replace(/ /g, '') },
            }),
          );
          expect(inHeaders).toMatchObject({ code: '23514', constraint: 'webhook_inbox_no_pan' });
          const masked = await receive(tx, accountId, {
            eventId: `e_${uuid()}`,
            headers: { 'x-debug': '411111******1111', t: '1700000000' },
          });
          expect(masked.rows[0]?.outcome).toBe('RECEIVED');
        });
      });
    });

    it('clé de dédoublonnage hors 16 à 64 octets ⇒ 22023', async () => {
      const accountId = await account();
      await withRole('app_api', async (client) => {
        await payTx(client, {}, async (tx) => {
          const err = await caught(tx, () =>
            tx.query(
              `SELECT * FROM core.payment_cmd_receive_webhook($1, NULL, '\\x01'::bytea, true, NULL, NULL, NULL)`,
              [accountId],
            ),
          );
          expect(err?.code).toBe('22023');
        });
      });
    });
  });
});

describe('aucun PAN ni CVV en base (17 §1.6, portée SAQ A)', () => {
  it.each(['main', 'production'] as const)(
    'base %s : aucune colonne de carte (PAN, CVV, piste, numéro de carte)',
    async (database) => {
      await withRole(
        'app_api',
        async (client) => {
          const { rows } = await client.query<{ col: string }>(
            `SELECT n.nspname || '.' || c.relname || '.' || a.attname AS col
             FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p', 'v', 'm')
              AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_toast'
              AND a.attname ~* '(^|_)(pan|cvv|cvc|cvv2|cid|track[12]?|card_?number|card_?no)($|_)'`,
          );
          expect(rows).toEqual([]);
        },
        { database },
      );
    },
  );

  it('jambes immuables : ni UPDATE ni DELETE pour personne ; app_api sans contexte : 0 ligne', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ role: string; priv: string; has: boolean }>(
        `SELECT r.role, p.priv,
                pg_catalog.has_table_privilege(r.role, 'core.payment_payment_operation_leg', p.priv) AS has
           FROM unnest(ARRAY['app_api', 'app_worker', 'app_anon', 'cmd_money_owner', 'integrity_owner']) AS r(role),
                unnest(ARRAY['UPDATE', 'DELETE', 'TRUNCATE']) AS p(priv)`,
      );
      expect(rows.filter((r) => r.has)).toEqual([]);
      const legs = await client.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM core.payment_payment_operation_leg',
      );
      expect(legs.rows[0]?.n).toBe(0);
    });
  });
});
