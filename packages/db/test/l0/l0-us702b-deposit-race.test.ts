/**
 * US-702b (migrations 0146 et 0153, ADR-169 et ADR-172) — minuterie de ré-autorisation contre
 * décision finale sur la MÊME caution, sur DEUX connexions (modèle `rt-conc-*` et US-224 ; revues
 * qa n° 6 et sécurité n° 9 de la PR 248) : `payment_cmd_deposit_transition` (ré-autorisation
 * acceptée) et `payment_cmd_deposit_decide` (VOID entier) prennent le même verrou de ligne et
 * relisent rang et état sous ce verrou. Dans les deux ordres, une seule des deux aboutit, l'autre
 * rend `STALE` sans rien écrire ; un seul événement `deposit.decision.executed` ; la décision n'est
 * jamais suspendue (après une ré-autorisation gagnante, elle s'applique au rang suivant).
 * L'attente de la seconde session sur le verrou est OBSERVÉE (pg_stat_activity : `wait_event_type`
 * = `Lock`), jamais supposée par un délai. Une connexion par client, toujours libérée.
 *
 * Fichier ISOLÉ (`vitest.l0.config.ts`, projet `l0-concurrence`) : la caution de la fixture 9945
 * (`us701_converted_deposit`, rail a), avec sa disposition CONVERSION (fixture 9932), est validée (COMMIT), puis toujours menée à un état FINAL :
 * aucune caution de ce fichier ne reste dans une file. Aucun interrupteur de mise en service écrit.
 *
 * Sous app_worker (rôle de PRODUCTION, assertion L0-05 : withRole / connectAs), en USD (PA) et en
 * PYG (PY). Attendus : 08 BR-PAY-06 (« jamais suspendue »), 16 PAY-011 « États », T57 (300,00 de
 * test) et T73 (1 500 000 PYG) ; jamais le code testé.
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import { connectAs, releaseClient, withRole } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { payTx } from '../support/pay.ts';

type Row = Record<string, unknown>;

const H = 3_600_000;
const at = (iso: string, hours: number): string =>
  new Date(Date.parse(iso) + hours * H).toISOString();

/** 300,00 de T57 en USD (30 000 centimes) ; 1 500 000 de T73 a en PYG. */
const DEPOSIT: Readonly<Record<string, bigint>> = { USD: 30_000n, PYG: 1_500_000n };

/**
 * Rail (a), autorisée à début − 24 h : expiration début + 148 h, ré-autorisation échue à début +
 * 124 h, libération et décision à début + 146 h ; l'horloge est à début + 146 h (les deux échues).
 */
const START = '2032-03-01T10:00:00.000Z';
const EXPIRY = at(START, 148);
const RELEASE = at(START, 146);
const REAUTH_DUE = at(START, 124);
const NOW = RELEASE;
/** Nouvelle expiration après la ré-autorisation : NOW + 168 h (V de T57). */
const NEW_EXPIRY = at(NOW, 168);

async function setup(cc: CountryCase): Promise<{ deposit: string; amount: bigint }> {
  const amount = DEPOSIT[cc.currency];
  if (amount === undefined) throw new Error(`devise sans vecteur : ${cc.currency}`);
  const deposit = await withRole('app_worker', (client) =>
    payTx(client, { worker: 'payment_command', commit: true, virtualNow: NOW }, async (tx) => {
      const { rows } = await tx.query<Row>(
        `SELECT * FROM test_fixture.us701_converted_deposit($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          cc.country,
          cc.currency,
          cc.timezone,
          START,
          at(START, 72),
          amount.toString(),
          EXPIRY,
          RELEASE,
          RELEASE,
          REAUTH_DUE,
          `fake-${uuid()}`,
        ],
      );
      // disposition CONVERSION exigée au COMMIT (contrainte différée de 0006)
      await tx.query('SELECT test_fixture.us702b_conversion_disposition($1)', [
        rows[0]!['hold_id'],
      ]);
      return String(rows[0]!['deposit_id']);
    }),
  );
  return { deposit, amount };
}

async function begin(client: pg.Client): Promise<number> {
  await client.query('BEGIN');
  await setSessionContext(client, { kind: 'WORKER', workerName: 'payment_command' });
  await client.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [NOW]);
  const { rows } = await client.query<{ pid: number }>('SELECT pg_catalog.pg_backend_pid() AS pid');
  return rows[0]?.pid ?? -1;
}

const reauthorize = async (client: pg.ClientBase, deposit: string): Promise<string> =>
  (
    await client.query<{ r: string }>(
      `SELECT core.payment_cmd_deposit_transition($1, 'REAUTHORIZED', 0, $2, $3, NULL, NULL) AS r`,
      [deposit, NEW_EXPIRY, RELEASE],
    )
  ).rows[0]!.r;

const decide = async (
  client: pg.ClientBase,
  deposit: string,
  seq: number,
  amount: bigint,
): Promise<string> =>
  (
    await client.query<{ r: string }>(
      `SELECT core.payment_cmd_deposit_decide($1, $2, 'VOIDED', 0, $3) AS r`,
      [deposit, seq, amount.toString()],
    )
  ).rows[0]!.r;

/** Attend que la session `pid` soit BLOQUÉE sur un verrou ; échoue après 10 s. */
async function waitUntilLocked(observer: pg.Client, pid: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const { rows } = await observer.query<{ wait: string | null }>(
      'SELECT wait_event_type AS wait FROM pg_catalog.pg_stat_activity WHERE pid = $1',
      [pid],
    );
    if (rows[0]?.wait === 'Lock') return;
    if (Date.now() > deadline)
      throw new Error(`session ${String(pid)} jamais bloquée sur un verrou`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Trois connexions : deux concurrentes et une d'observation ; toujours libérées. */
async function withThree<T>(
  fn: (a: pg.Client, b: pg.Client, observer: pg.Client) => Promise<T>,
): Promise<T> {
  const a = await connectAs('app_worker');
  const b = await connectAs('app_worker');
  const observer = await connectAs('app_worker');
  try {
    return await fn(a, b, observer);
  } finally {
    for (const client of [a, b]) {
      await client.query('ROLLBACK').catch(() => undefined);
      await releaseClient(client);
    }
    await releaseClient(observer);
  }
}

/** État relu après la course (transaction annulée) : file des décisions et événements. */
async function after(deposit: string): Promise<{ due: Row[]; events: number }> {
  return withRole('app_worker', (client) =>
    payTx(client, { worker: 'payment_command', virtualNow: NOW }, async (tx) => {
      const due = (
        await tx.query<Row>('SELECT * FROM core.payment_deposit_decision_due(500)')
      ).rows.filter((r) => r['deposit_id'] === deposit);
      await tx.query(`SELECT pg_catalog.set_config('app.worker_name', 'outbox_relay', true)`);
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM core.outbox_outbox_event
          WHERE aggregate_id = $1 AND type = 'deposit.decision.executed'`,
        [deposit],
      );
      return { due, events: rows[0]?.n ?? -1 };
    }),
  );
}

describe.each(COUNTRIES)(
  'US-702b — ré-autorisation contre décision, deux connexions ($country, $currency)',
  (cc) => {
    it('la ré-autorisation tient le verrou : la décision attend puis rend STALE (rang périmé), rien n’est écrit ; la décision s’applique ensuite au rang 1 (jamais suspendue), un seul événement', async () => {
      const s = await setup(cc);
      await withThree(async (first, second, observer) => {
        await begin(first);
        const pid = await begin(second);
        expect(await reauthorize(first, s.deposit)).toBe('APPLIED');
        const racing = decide(second, s.deposit, 0, s.amount);
        await waitUntilLocked(observer, pid);
        await first.query('COMMIT');
        expect(await racing).toBe('STALE');
        await second.query('COMMIT');
      });
      const mid = await after(s.deposit);
      expect(mid.events).toBe(0);
      expect(mid.due).toHaveLength(1);
      expect(mid.due[0]).toMatchObject({ reauth_seq: 1 });
      expect((mid.due[0]!['auth_expiry_at'] as Date).toISOString()).toBe(NEW_EXPIRY);
      // état final : la décision au rang 1 (aucune caution de ce fichier ne reste dans une file)
      await withRole('app_worker', (client) =>
        payTx(client, { worker: 'payment_command', commit: true, virtualNow: NOW }, async (tx) => {
          expect(await decide(tx, s.deposit, 1, s.amount)).toBe('APPLIED');
        }),
      );
      const end = await after(s.deposit);
      expect(end).toEqual({ due: [], events: 1 });
    });

    it('la décision tient le verrou : la ré-autorisation attend puis rend STALE (caution finale), rien n’est écrit ; un seul événement', async () => {
      const s = await setup(cc);
      await withThree(async (first, second, observer) => {
        await begin(first);
        const pid = await begin(second);
        expect(await decide(first, s.deposit, 0, s.amount)).toBe('APPLIED');
        const racing = reauthorize(second, s.deposit);
        await waitUntilLocked(observer, pid);
        await first.query('COMMIT');
        expect(await racing).toBe('STALE');
        await second.query('COMMIT');
      });
      expect(await after(s.deposit)).toEqual({ due: [], events: 1 });
    });
  },
);
