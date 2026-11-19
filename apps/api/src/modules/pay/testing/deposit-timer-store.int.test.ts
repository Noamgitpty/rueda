/**
 * US-702 (suite des revues code et qa d'US-701) — magasins de la minuterie de la caution exécutés
 * sur PostgreSQL réel avec leurs fonctions SQL (paire TS / SQL ensemble), sous le rôle de production
 * `app_worker` (`withRole` : assertion L0-05 en tête), nom de travailleur `payment_command`, dans
 * chaque pays configuré (USD, PYG sans décimale), transactions ANNULÉES :
 * - `PgDepositTimerStore` (0146) : jointure `config_currency` (exposant de la devise), paramètres
 *   `::timestamptz`, file des ré-autorisations échues et transition `REAUTHORIZED` (rang attendu) ;
 * - `PgDepositDecisionStore` (0150) : file des décisions échues (montant en `bigint`, rail,
 *   expiration) et transition finale ; `DepositDecisionTimer` de bout en bout avec la configuration
 *   et les capacités lues en base (posées dans la transaction) et le PSP simulé : VOID de la caution
 *   entière à fin + 70 h, aucune capture (19 US-702 critère 2).
 * Attendus : 08 BR-PAY-06 (T57 : décision à fin + 70 h ; T59 en rail a), T73 (1 500 000 PYG),
 * `currencies.json` (lu comme donnée) — jamais le code testé.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { withRole, withTestTransaction } from '@rueda/db/testing';
import type {} from '@rueda/db/testing/global-setup';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  DepositDecisionTimer,
  NO_DEPOSIT_FEES,
  PgDepositDecisionStore,
} from '../internal/deposit-decision.js';
import { PgDepositTimerStore } from '../internal/deposit-timer.js';
import { PgDepositRailConfigReader } from '../internal/pg-deposit-config.js';
import { countryCases } from '../../../../test/support/countries.js';
import { fakeStack } from './fake-stack.js';
import { DepositRailExecutor } from '../internal/deposit-executor.js';
import { createCurrencyRegistry } from '@rueda/money';

const H = 3_600_000;
const read = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../cfg/data/${file}`, import.meta.url), 'utf8'));
const EXPONENTS = new Map(
  (read('currencies.json') as { currencies: { code: string; exponent: number }[] }).currencies.map(
    (c) => [c.code, c.exponent],
  ),
);
const TIME_ZONES = new Map(
  (read('countries.json') as { countries: { code: string; timeZone: string }[] }).countries.map(
    (c) => [c.code, c.timeZone],
  ),
);
/** 300,00 de T57 en centimes (exposant 2 : 30 000) ; 1 500 000 de T73 a sans décimale (exposant 0). */
const DEPOSIT_BY_EXPONENT = new Map<number, bigint>([
  [2, 30_000n],
  [0, 1_500_000n],
]);

const at = (iso: string, hours: number, minutes = 0): string =>
  new Date(Date.parse(iso) + hours * H + minutes * 60_000).toISOString();

async function workerTx<T>(virtualNow: string, fn: (tx: pg.ClientBase) => Promise<T>): Promise<T> {
  return withRole('app_worker', (client) =>
    withTestTransaction(client, { virtualNow }, async (tx) => {
      await tx.query(
        `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                pg_catalog.set_config('app.worker_name', 'payment_command', true)`,
      );
      return fn(tx);
    }),
  );
}
const setClock = (tx: pg.ClientBase, iso: string) =>
  tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso]);

describe.each(countryCases())(
  '$country ($currency) — magasins de la minuterie sur base réelle',
  (c) => {
    const exponent = EXPONENTS.get(c.currency);
    const amount = exponent === undefined ? undefined : DEPOSIT_BY_EXPONENT.get(exponent);
    if (amount === undefined) throw new Error(`devise sans vecteur : ${c.currency}`);
    const timezone = TIME_ZONES.get(c.country);

    it('PgDepositTimerStore : ré-autorisation échue lue (exposant de config_currency, instants), transition REAUTHORIZED appliquée puis STALE', async () => {
      // T59 en rail (a) : autorisée à début − 24 h (expiration début + 144 h), ré-autorisation à + 120 h
      const start = '2031-08-01T10:00:00.000Z';
      const release = at(start, 144, 25);
      await workerTx(at(start, 119), async (tx) => {
        const seeded = await tx.query<{ deposit_id: string; trip_id: string }>(
          `SELECT * FROM test_fixture.us701_converted_deposit($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            c.country,
            c.currency,
            timezone,
            start,
            at(start, 72),
            amount.toString(),
            at(start, 144),
            release,
            release,
            at(start, 120),
            `fake-${randomUUID()}`,
          ],
        );
        const id = seeded.rows[0]!.deposit_id;
        const store = new PgDepositTimerStore(tx);
        const mine = async () => (await store.due(500)).filter((d) => d.depositId === id);
        expect(await mine()).toEqual([]);
        await setClock(tx, at(start, 120));
        const [due] = await mine();
        expect(due).toMatchObject({
          tripId: seeded.rows[0]!.trip_id,
          country: c.country,
          currency: c.currency,
          currencyExponent: exponent,
          provider: 'FAKE',
          reauthSeq: 0,
        });
        expect(due?.authExpiryAt.toISOString()).toBe(at(start, 144));
        expect(due?.releaseAt.toISOString()).toBe(release);
        expect(due?.now.toISOString()).toBe(at(start, 120));
        const schedule = {
          authExpiryAt: new Date(at(start, 288)),
          decisionAt: new Date(release),
          reauthDueAt: null,
        };
        expect(await store.transition(id, 'REAUTHORIZED', 0, schedule)).toBe('APPLIED');
        expect(await mine()).toEqual([]);
        expect(await store.transition(id, 'REAUTHORIZED', 0, schedule)).toBe('STALE');
      });
    });

    it('PgDepositDecisionStore et DepositDecisionTimer : décision échue à fin + 70 h lue (montant bigint, rail, expiration), configuration relue en base, VOID de la caution entière, puis STALE', async () => {
      // T57 : trip de 72 h, expiration fin + 72 h, décision fin + 70 h
      const start = '2031-09-01T10:00:00.000Z';
      const end = at(start, 72);
      await workerTx(at(end, 69), async (tx) => {
        // pose sur le FAKE (lot C : à `auth_at`) : la référence du PSP est celle de la caution
        const stack = fakeStack();
        const order = await new DepositRailExecutor(stack.provider).place(
          {
            depositId: randomUUID(),
            tripReference: randomUUID(),
            tripId: randomUUID(),
            segmentId: randomUUID(),
            tenderId: randomUUID(),
            currency: createCurrencyRegistry([{ code: c.currency, exponent: exponent ?? 0 }]).get(
              c.currency,
            ),
          },
          {
            mechanism: 'PREAUTH_SINGLE',
            amountMinor: amount,
            fundsHoldingEnabled: false,
            attemptNo: 1,
          },
        );
        stack.psp.customerPays(order.providerReference);
        // capacités du FAKE pour la carte, posées dans la transaction annulée (inconnue = non)
        for (const name of [
          'SUPPORTS_PREAUTH',
          'SUPPORTS_VOID',
          'SUPPORTS_PARTIAL_CAPTURE',
          'SUPPORTS_MIT',
        ]) {
          await tx.query(
            `SELECT test_fixture.us024_set_capability('FAKE', $1, '*', $2, 'true'::jsonb, 'VALIDATED_SANDBOX', $3::timestamptz)`,
            [c.country, name, at(end, 69)],
          );
        }
        const seeded = await tx.query<{ deposit_id: string; trip_id: string }>(
          `SELECT * FROM test_fixture.us702_converted_deposit($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            c.country,
            c.currency,
            timezone,
            start,
            end,
            amount.toString(),
            'PREAUTH_SINGLE',
            at(end, 72),
            at(end, 72),
            at(end, 70),
            order.providerReference,
          ],
        );
        const id = seeded.rows[0]!.deposit_id;
        const store = new PgDepositDecisionStore(tx);
        const mine = async () => (await store.due(500)).filter((d) => d.depositId === id);
        expect(await mine()).toEqual([]);
        await setClock(tx, at(end, 70));
        const [due] = await mine();
        expect(due).toMatchObject({
          tripId: seeded.rows[0]!.trip_id,
          country: c.country,
          currency: c.currency,
          currencyExponent: exponent,
          provider: 'FAKE',
          mechanism: 'PREAUTH_SINGLE',
          amountMinor: amount,
          reauthSeq: 0,
        });
        expect(due?.decisionAt.toISOString()).toBe(at(end, 70));
        expect(due?.authExpiryAt?.toISOString()).toBe(at(end, 72));
        const decided: string[] = [];
        const timer = new DepositDecisionTimer({
          config: (country, provider) => new PgDepositRailConfigReader(tx).read(country, provider),
          decide: async (depositId, seq, outcome) => {
            const r = await store.decide(depositId, seq, outcome);
            decided.push(
              `${outcome.status}:${outcome.capturedMinor}:${outcome.releasedMinor}:${r}`,
            );
            return r;
          },
          fees: NO_DEPOSIT_FEES,
          alerts: { send: () => Promise.resolve() },
          connectors: { get: (name) => (name === 'FAKE' ? stack.provider : undefined) },
        });
        expect(await timer.process(due!)).toBe('VOIDED');
        // critère 2 : VOID de la caution entière, rien de capturé, aucun mouvement de fonds
        expect(decided).toEqual([`VOIDED:0:${amount}:APPLIED`]);
        expect(stack.psp.calls('VOID')).toBe(1);
        expect(stack.psp.calls('CAPTURE')).toBe(0);
        expect(stack.psp.movements()).toEqual([]);
        expect(await mine()).toEqual([]);
        expect(
          await store.decide(id, 0, { status: 'VOIDED', capturedMinor: 0n, releasedMinor: amount }),
        ).toBe('STALE');
      });
    });
  },
);
