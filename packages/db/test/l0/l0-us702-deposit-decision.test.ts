/**
 * US-702 — décision de la caution (migration 0150, ADR-172) sous les rôles de PRODUCTION (assertion
 * L0-05 en tête de chaque connexion : withRole), en USD (PA) et en PYG sans décimale (PY),
 * transactions annulées :
 * - `app_api` (voyageur de la session) : l'écriture de la décision RECALCULE le fournisseur et
 *   l'échéancier (revues argent et sécurité d'US-701) : une décision qui raccourcit la libération ou
 *   choisit un autre connecteur est écrite avec les valeurs de la base ; validité V absente ou
 *   illisible ⇒ refus (fail-closed) ;
 * - `app_worker` (`payment_command`) : file des décisions échues à l'heure de la base, sans champ
 *   [C2] ; transition FINALE gardée (jamais avant l'heure de décision, jamais de capture après
 *   l'expiration, Σ capturé + libéré = montant, `REFUNDED` ⇔ rail b, rang attendu) et événement
 *   `deposit.decision.executed` dans la même transaction ; autre travailleur ⇒ rien lu, refus ;
 * - `app_anon` : aucune des fonctions de la caution (0146, 0150) n'est exécutable ;
 * - US-702b (0152) : V ne peut plus avancer la décision au-delà de la règle (rail revérifié en base) ;
 *   libération et décision EFFECTIVES sur le retour réel (`(checkout_at ?? scheduled_end) + 72 h`,
 *   un retour tardif ne prolonge jamais l'autorisation), dans la file des décisions et celle des
 *   ré-autorisations ; avis `notice` : VOID refusé ⇒ `BLOCKED_UNTIL_EXPIRY` et date d'expiration.
 * Attendus : 08 BR-PAY-06 (T57 : 300,00 de test, décision à fin + 70 h, libération fin + 72 h ; T73 :
 * 1 500 000 PYG), 16 PAY-011 « États », 17 §3.2.7, la graine (durées 24 / 72 / 2 / 24 h de 0009 et
 * 0142) — jamais le code testé. Personnes, devis et checkout par les VRAIES commandes (US-208,
 * US-223) ; interrupteurs ouverts par la procédure à deux personnes dans la transaction annulée.
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import {
  approveDriver,
  checkoutPerson,
  checkoutQuote,
  failure,
  frozenQuote,
  listedListing,
  openSwitch,
  protectionParams,
  quoteDocs,
  setClock,
  taxGroups,
} from '../support/checkout.ts';
import type { CheckoutVector, Person } from '../support/checkout.ts';
import { payTx } from '../support/pay.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

const NOW = '2026-12-01T12:00:00.000Z';
const START = '2026-12-10T15:00:00.000Z';
const H = 3_600_000;

/** Vecteurs du checkout d'US-223 (en-tête de l0-us223-checkout-payment) : devis de 3 jours. */
const VECTORS: Readonly<Record<string, CheckoutVector>> = {
  PA: {
    daily: 4_000,
    schedule: { tiers: [{ maxDays: null, rateBps: 0 }], minMinor: '0' },
    fee: 0,
    taxes: { TRIP_PRICE: 840 },
    host: 9_000,
    total: 15_840,
    basicaPrice: '1/4',
    protection: 3_000,
    insurer: 2_100,
  },
  PY: {
    daily: 333_334,
    schedule: null,
    fee: 150_000,
    taxes: { TRIP_PRICE: 100_000, TRIP_FEE: 15_000 },
    host: 750_001,
    total: 1_415_002,
    basicaPrice: '3/20',
    protection: 150_000,
    insurer: 105_000,
  },
};

/** 300,00 de T57 en USD (30 000 centimes) ; 1 500 000 de T73 a en PYG (`deposit_amount[PY][LUXE]`). */
const DEPOSIT: Readonly<Record<string, bigint>> = { USD: 30_000n, PYG: 1_500_000n };
const depositOf = (cc: CountryCase): bigint => {
  const d = DEPOSIT[cc.currency];
  if (d === undefined) throw new Error(`devise sans vecteur : ${cc.currency}`);
  return d;
};

const at = (iso: string, hours: number): string =>
  new Date(Date.parse(iso) + hours * H).toISOString();
const iso = (v: unknown): string | null => (v === null ? null : (v as Date).toISOString());

function scenario(cc: CountryCase) {
  return (fn: (tx: Tx, groups: Map<string, string>) => Promise<void>) =>
    withRole('app_api', (client) =>
      withTestTransaction(client, { virtualNow: NOW }, async (tx) => {
        await openSwitch(tx, 'p2p_private_hosts_enabled', cc.country);
        await openSwitch(tx, 'insurer_contract_active', cc.country);
        const v = VECTORS[cc.country]!;
        if (v.schedule !== null) {
          await tx.query('SELECT test_fixture.us704_set_trip_fee_schedule($1, $2::jsonb)', [
            cc.country,
            JSON.stringify(v.schedule),
          ]);
        }
        await protectionParams(tx, cc.country, v);
        await tx.query('SELECT test_fixture.us024_psp_account($1)', [cc.country]);
        await tx.query("SELECT test_fixture.us225_param_version('deposit_amount', $1, $2::jsonb)", [
          cc.country,
          JSON.stringify({ LUXE: depositOf(cc).toString() }),
        ]);
        await fn(tx, await taxGroups(tx, cc));
      }),
    );
}

async function luxeHold(
  tx: Tx,
  cc: CountryCase,
  groups: Map<string, string>,
): Promise<{
  p: Person;
  hold: string;
}> {
  const p = await checkoutPerson(tx, cc.country);
  await approveDriver(tx, p, cc.country, { birth: '1990-01-01', licenseExpiry: '2030-12-31' });
  const v = VECTORS[cc.country]!;
  const l = await listedListing(tx, cc, v.daily);
  await tx.query('SELECT test_fixture.us108_set_value_class($1, $2)', [l.vehicleId, 'LUXE']);
  const d = quoteDocs(cc, v, groups, Date.parse(START), Date.parse(NOW));
  const quoteId = await frozenQuote(tx, p, l.listingId, d);
  const r = await checkoutQuote(tx, p, quoteId);
  expect(r.outcome).toBe('DONE');
  return { p, hold: r.hold_id! };
}

/** Décision HOSTILE : autre connecteur, libération et décision ramenées au début du trip. */
const hostile = (amount: bigint, mechanism: string, vHours: number) => ({
  mechanism,
  triggers: ['CLASS'],
  paramsSnapshot: { version: 1, riskEvaluated: false, youngestDriverAge: null },
  amountMinor: amount.toString(),
  provider: 'EVIL_PSP',
  hRequiredHours: 168,
  vHours,
  authAt: at(START, -1),
  releaseAt: at(START, 0),
  decisionAt: at(START, 0),
  reauthDueAt: null,
});

const schedule = async (tx: Tx, hold: string): Promise<Row> =>
  (await tx.query<Row>('SELECT * FROM test_fixture.us702_deposit_schedule($1)', [hold])).rows[0]!;

describe.each(COUNTRIES)(
  'US-702 — échéancier recalculé par la base ($country, $currency)',
  (cc) => {
    const run = scenario(cc);
    const record = 'SELECT core.payment_cmd_record_deposit_decision($1, $2, $3::jsonb) AS r';

    it('T57 (pré-autorisation unique, V = 168 h) : fournisseur et échéancier de l’API ignorés ; auth = début − 24 h, libération = fin + 72 h, décision = fin + 70 h', async () => {
      await run(async (tx, groups) => {
        const { p, hold } = await luxeHold(tx, cc, groups);
        const r = await tx.query<{ r: string }>(record, [
          p.hash,
          hold,
          JSON.stringify(hostile(depositOf(cc), 'PREAUTH_SINGLE', 168)),
        ]);
        expect(r.rows[0]!.r).toBe('RECORDED');
        const s = await schedule(tx, hold);
        expect(s['provider']).toBe('FAKE');
        expect(s['v_hours_snapshot']).toBe(168);
        // devis de 3 jours : fin = début + 72 h
        expect(iso(s['auth_at'])).toBe(at(START, -24));
        expect(iso(s['release_at'])).toBe(at(START, 72 + 72));
        expect(iso(s['decision_at'])).toBe(at(START, 72 + 70));
        expect(s['reauth_due_at']).toBeNull();
      });
    });

    it('rail (a) (V = 48 h) : ré-autorisation à expiration − 24 h, décision à la libération (08 BR-PAY-06 « Mécanisme »)', async () => {
      await run(async (tx, groups) => {
        const { p, hold } = await luxeHold(tx, cc, groups);
        const r = await tx.query<{ r: string }>(record, [
          p.hash,
          hold,
          JSON.stringify(hostile(depositOf(cc), 'REAUTH', 48)),
        ]);
        expect(r.rows[0]!.r).toBe('RECORDED');
        const s = await schedule(tx, hold);
        // expiration prévue = auth + 48 h = début + 24 h ; ré-autorisation 24 h avant
        expect(iso(s['reauth_due_at'])).toBe(at(START, 0));
        expect(iso(s['decision_at'])).toBe(at(START, 144));
        expect(iso(s['release_at'])).toBe(at(START, 144));
      });
    });

    it('US-702b : V qui ne justifie pas le rail ⇒ refus (pré-autorisation unique : H_requise = 24 + 72 + 72 = 168 h > V = 167 h ; ré-autorisation : V = 24 h = deposit_reauth_lead_h), rien n’est écrit ; V = 168 h accepté (T57)', async () => {
      await run(async (tx, groups) => {
        const { p, hold } = await luxeHold(tx, cc, groups);
        for (const [mechanism, vHours] of [
          ['PREAUTH_SINGLE', 167],
          ['PREAUTH_SINGLE', 0],
          ['REAUTH', 24],
        ] as const) {
          const e = await failure(tx, record, [
            p.hash,
            hold,
            JSON.stringify(hostile(depositOf(cc), mechanism, vHours)),
          ]);
          expect(e, `${mechanism} ${vHours}`).toMatchObject({
            code: '23514',
            constraint: 'deposit_decision_mismatch',
          });
        }
        expect(await schedule(tx, hold)).toBeUndefined();
        // décision d'une pré-autorisation unique jamais plus de deposit_safety_h (2 h) avant la
        // libération, même avec un V gonflé (aucun VOID anticipé ; la pose réelle relira l'expiration)
        const r = await tx.query<{ r: string }>(record, [
          p.hash,
          hold,
          JSON.stringify(hostile(depositOf(cc), 'PREAUTH_SINGLE', 999_999)),
        ]);
        expect(r.rows[0]!.r).toBe('RECORDED');
        const s = await schedule(tx, hold);
        expect(iso(s['release_at'])).toBe(at(START, 72 + 72));
        expect(iso(s['decision_at'])).toBe(at(START, 72 + 72));
      });
    });

    it('fail-closed : V absent ou illisible ⇒ refus, rien n’est écrit (les durées de 08 sont typées par la garde de 0008)', async () => {
      await run(async (tx, groups) => {
        const { p, hold } = await luxeHold(tx, cc, groups);
        for (const vHours of [null, '168', 1.5]) {
          const bad = { ...hostile(depositOf(cc), 'PREAUTH_SINGLE', 168), vHours };
          const e = await failure(tx, record, [p.hash, hold, JSON.stringify(bad)]);
          expect(e, String(vHours)).toMatchObject({
            code: '23514',
            constraint: 'deposit_decision_mismatch',
          });
          expect(translateDbError(e ?? {}).code).toBe('INVARIANT_VIOLATION');
        }
        expect(await schedule(tx, hold)).toBeUndefined();
      });
    });
  },
);

describe.each(COUNTRIES)('US-702 — décision à l’heure de décision ($country, $currency)', (cc) => {
  /** T57 : trip de 72 h, autorisé à début − 24 h (expiration fin + 72 h), décision fin + 70 h. */
  const start = '2031-08-01T10:00:00.000Z';
  const end = at(start, 72);
  const expiry = at(end, 72);
  const release = at(end, 72);
  const decision = at(end, 70);
  const seed = async (tx: Tx, mechanism = 'PREAUTH_SINGLE') =>
    (
      await tx.query<Row>(
        `SELECT * FROM test_fixture.us702_converted_deposit($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          cc.country,
          cc.currency,
          cc.timezone,
          start,
          end,
          depositOf(cc).toString(),
          mechanism,
          mechanism === 'CHARGE_THEN_REFUND' ? null : expiry,
          release,
          mechanism === 'CHARGE_THEN_REFUND' ? release : decision,
          `fake-${uuid()}`,
        ],
      )
    ).rows[0]!;
  const dueOf = async (tx: Tx, id: unknown) =>
    (await tx.query<Row>('SELECT * FROM core.payment_deposit_decision_due(500)')).rows.filter(
      (r) => r['deposit_id'] === id,
    );
  const decideSql = 'SELECT core.payment_cmd_deposit_decide($1, $2, $3, $4, $5) AS r';
  const decide = async (
    tx: Tx,
    id: unknown,
    status: string,
    captured: bigint,
    released: bigint,
    seq = 0,
  ) =>
    (
      await tx.query<{ r: string }>(decideSql, [
        id,
        seq,
        status,
        captured.toString(),
        released.toString(),
      ])
    ).rows[0]!.r;

  it('critère 2 : échue seulement à fin + 70 h (heure de la base), sans champ [C2] ; VOID entier ⇒ VOIDED, événement deposit.decision.executed ; rejeu ⇒ STALE', async () => {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', virtualNow: at(end, 69) }, async (tx) => {
        const s = await seed(tx);
        const amount = depositOf(cc);
        expect(await dueOf(tx, s['deposit_id'])).toEqual([]);
        // jamais avant l'heure de décision
        expect(
          await failure(tx, decideSql, [s['deposit_id'], 0, 'VOIDED', '0', amount.toString()]),
        ).toMatchObject({ code: '55000', constraint: 'deposit_hold_guarded' });
        await setClock(tx, decision);
        const due = await dueOf(tx, s['deposit_id']);
        expect(due).toHaveLength(1);
        expect(due[0]).toMatchObject({
          trip_id: s['trip_id'],
          segment_id: s['segment_id'],
          tender_id: s['tender_id'],
          country_code: cc.country,
          currency: cc.currency,
          provider: 'FAKE',
          mechanism: 'PREAUTH_SINGLE',
          amount_minor: amount.toString(),
          reauth_seq: 0,
        });
        expect(iso(due[0]!['decision_at'])).toBe(decision);
        expect(Object.keys(due[0]!)).not.toContain('triggers');
        expect(Object.keys(due[0]!)).not.toContain('params_snapshot');
        expect(await decide(tx, s['deposit_id'], 'VOIDED', 0n, amount)).toBe('APPLIED');
        expect(await dueOf(tx, s['deposit_id'])).toEqual([]);
        expect(await decide(tx, s['deposit_id'], 'VOIDED', 0n, amount)).toBe('STALE');
        // journal : un événement, acteur SYSTEM, identifiants et montants seulement
        await tx.query(`SELECT pg_catalog.set_config('app.worker_name', 'outbox_relay', true)`);
        const ev = await tx.query<Row>(
          `SELECT type, actor_role, actor_user_id, country_code, payload
             FROM core.outbox_outbox_event WHERE aggregate_id = $1`,
          [s['deposit_id']],
        );
        expect(ev.rows).toHaveLength(1);
        expect(ev.rows[0]).toMatchObject({
          type: 'deposit.decision.executed',
          actor_role: 'SYSTEM',
          actor_user_id: null,
          country_code: cc.country,
        });
        const payload = ev.rows[0]!['payload'] as Record<string, unknown>;
        expect(payload).toMatchObject({
          deposit_id: s['deposit_id'],
          trip_id: s['trip_id'],
          status: 'VOIDED',
          captured_minor: '0',
          released_minor: amount.toString(),
          currency: cc.currency,
          notice: 'RELEASED',
        });
        expect(Date.parse(String(payload['auth_expiry_at']))).toBe(Date.parse(expiry));
        expect(Object.keys(payload).sort()).toEqual([
          'auth_expiry_at',
          'captured_minor',
          'currency',
          'decided_at',
          'deposit_id',
          'notice',
          'released_minor',
          'status',
          'trip_id',
        ]);
      }),
    );
  });

  it('forme finale : Σ ≠ montant, capture dans VOIDED, aucune capture dans PARTIALLY_CAPTURED ⇒ refus ; capture partielle valide ⇒ APPLIED', async () => {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', virtualNow: decision }, async (tx) => {
        const s = await seed(tx);
        const amount = depositOf(cc);
        const one = amount / 300n; // un « 1,00 » de la devise (300,00 ⇒ 1,00 ; 1 500 000 ⇒ 5 000)
        for (const [status, captured, released] of [
          ['PARTIALLY_CAPTURED', one, amount],
          ['VOIDED', one, amount - one],
          ['PARTIALLY_CAPTURED', 0n, amount],
        ] as const) {
          expect(
            await failure(tx, decideSql, [
              s['deposit_id'],
              0,
              status,
              captured.toString(),
              released.toString(),
            ]),
            `${status} ${captured} ${released}`,
          ).toMatchObject({ code: '23514', constraint: 'deposit_hold_final_shape' });
        }
        // 16 PAY-011 : REFUNDED réservé au rail « débit puis remboursement »
        expect(
          await failure(tx, decideSql, [s['deposit_id'], 0, 'REFUNDED', '0', amount.toString()]),
        ).toMatchObject({ code: '55000', constraint: 'deposit_hold_guarded' });
        expect(await decide(tx, s['deposit_id'], 'PARTIALLY_CAPTURED', one, amount - one)).toBe(
          'APPLIED',
        );
      }),
    );
  });

  it('08 BR-PAY-06 : après l’expiration, aucune capture ; EXPIRED (libération entière) seulement', async () => {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', virtualNow: expiry }, async (tx) => {
        const s = await seed(tx);
        const amount = depositOf(cc);
        const one = amount / 300n;
        expect(await dueOf(tx, s['deposit_id'])).toHaveLength(1);
        expect(
          await failure(tx, decideSql, [
            s['deposit_id'],
            0,
            'PARTIALLY_CAPTURED',
            one.toString(),
            (amount - one).toString(),
          ]),
        ).toMatchObject({ code: '55000', constraint: 'deposit_hold_guarded' });
        expect(await decide(tx, s['deposit_id'], 'EXPIRED', 0n, amount)).toBe('APPLIED');
      }),
    );
  });

  it('rail (b) : REFUNDED (remboursement entier) seulement ; rang périmé ⇒ STALE', async () => {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', virtualNow: release }, async (tx) => {
        const s = await seed(tx, 'CHARGE_THEN_REFUND');
        const amount = depositOf(cc);
        expect(
          await failure(tx, decideSql, [s['deposit_id'], 0, 'VOIDED', '0', amount.toString()]),
        ).toMatchObject({ code: '55000', constraint: 'deposit_hold_guarded' });
        expect(await decide(tx, s['deposit_id'], 'REFUNDED', 0n, amount, 1)).toBe('STALE');
        expect(await decide(tx, s['deposit_id'], 'REFUNDED', 0n, amount)).toBe('APPLIED');
      }),
    );
  });

  /** Avis et date d'expiration de l'unique événement de la caution (lecture de l'outbox). */
  const noticeOf = async (tx: Tx, id: unknown) => {
    await tx.query(`SELECT pg_catalog.set_config('app.worker_name', 'outbox_relay', true)`);
    const ev = await tx.query<Row>(
      'SELECT payload FROM core.outbox_outbox_event WHERE aggregate_id = $1',
      [id],
    );
    await tx.query(`SELECT pg_catalog.set_config('app.worker_name', 'payment_command', true)`);
    expect(ev.rows).toHaveLength(1);
    const payload = ev.rows[0]!['payload'] as Record<string, unknown>;
    return {
      notice: payload['notice'],
      authExpiryAt:
        payload['auth_expiry_at'] === null ? null : Date.parse(String(payload['auth_expiry_at'])),
    };
  };
  const recordReturn = (tx: Tx, trip: unknown, when: string) =>
    tx.query('SELECT test_fixture.us702b_record_return($1, $2)', [trip, when]);

  it('US-702b (08 E3 repli 4) : EXPIRED écrit à l’heure de décision, avant l’expiration (VOID refusé) ⇒ notice BLOCKED_UNTIL_EXPIRY et date d’expiration ; EXPIRED à l’expiration ⇒ RELEASED', async () => {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', virtualNow: decision }, async (tx) => {
        const amount = depositOf(cc);
        const refused = await seed(tx);
        expect(await decide(tx, refused['deposit_id'], 'EXPIRED', 0n, amount)).toBe('APPLIED');
        expect(await noticeOf(tx, refused['deposit_id'])).toEqual({
          notice: 'BLOCKED_UNTIL_EXPIRY',
          authExpiryAt: Date.parse(expiry),
        });
        const partial = await seed(tx);
        const one = amount / 300n;
        expect(
          await decide(tx, partial['deposit_id'], 'PARTIALLY_CAPTURED', one, amount - one),
        ).toBe('APPLIED');
        expect((await noticeOf(tx, partial['deposit_id'])).notice).toBe('PARTIALLY_CAPTURED');
        await setClock(tx, expiry);
        const lapsed = await seed(tx);
        expect(await decide(tx, lapsed['deposit_id'], 'EXPIRED', 0n, amount)).toBe('APPLIED');
        expect((await noticeOf(tx, lapsed['deposit_id'])).notice).toBe('RELEASED');
      }),
    );
  });

  it('US-702b (08 BR-PAY-06) : retour anticipé de 5 h ⇒ libération (checkout_at + 72 h = fin + 67 h) et décision à fin + 67 h, jamais avant ; garde de la transition sur la même heure', async () => {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', virtualNow: at(end, -5) }, async (tx) => {
        const s = await seed(tx);
        const amount = depositOf(cc);
        await recordReturn(tx, s['trip_id'], at(end, -5));
        await setClock(tx, new Date(Date.parse(at(end, 67)) - 1).toISOString());
        expect(await dueOf(tx, s['deposit_id'])).toEqual([]);
        expect(
          await failure(tx, decideSql, [s['deposit_id'], 0, 'VOIDED', '0', amount.toString()]),
        ).toMatchObject({ code: '55000', constraint: 'deposit_hold_guarded' });
        await setClock(tx, at(end, 67));
        const due = await dueOf(tx, s['deposit_id']);
        expect(due).toHaveLength(1);
        expect(iso(due[0]!['decision_at'])).toBe(at(end, 67));
        expect(await decide(tx, s['deposit_id'], 'VOIDED', 0n, amount)).toBe('APPLIED');
      }),
    );
  });

  it('US-702b (08 BR-PAY-06) : retour tardif de 5 h ⇒ la libération (fin + 77 h) ne prolonge pas l’autorisation : décision toujours à min(fin + 77 h, expiration − 2 h) = fin + 70 h', async () => {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', virtualNow: at(end, 5) }, async (tx) => {
        const s = await seed(tx);
        await recordReturn(tx, s['trip_id'], at(end, 5));
        await setClock(tx, at(end, 69));
        expect(await dueOf(tx, s['deposit_id'])).toEqual([]);
        await setClock(tx, decision);
        const due = await dueOf(tx, s['deposit_id']);
        expect(due).toHaveLength(1);
        expect(iso(due[0]!['decision_at'])).toBe(decision);
        expect(await decide(tx, s['deposit_id'], 'VOIDED', 0n, depositOf(cc))).toBe('APPLIED');
      }),
    );
  });

  it('US-702b (08 BR-PAY-06) : rail (b) sans expiration, retour tardif de 5 h ⇒ remboursement à checkout_at + 72 h = fin + 77 h, jamais à fin + 72 h', async () => {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', virtualNow: at(end, 5) }, async (tx) => {
        const s = await seed(tx, 'CHARGE_THEN_REFUND');
        const amount = depositOf(cc);
        await recordReturn(tx, s['trip_id'], at(end, 5));
        await setClock(tx, release);
        expect(await dueOf(tx, s['deposit_id'])).toEqual([]);
        expect(
          await failure(tx, decideSql, [s['deposit_id'], 0, 'REFUNDED', '0', amount.toString()]),
        ).toMatchObject({ code: '55000', constraint: 'deposit_hold_guarded' });
        await setClock(tx, at(end, 77));
        const due = await dueOf(tx, s['deposit_id']);
        expect(due).toHaveLength(1);
        expect(iso(due[0]!['decision_at'])).toBe(at(end, 77));
        expect(await decide(tx, s['deposit_id'], 'REFUNDED', 0n, amount)).toBe('APPLIED');
        expect(await noticeOf(tx, s['deposit_id'])).toEqual({
          notice: 'RELEASED',
          authExpiryAt: null,
        });
      }),
    );
  });

  it('autre travailleur : file vide, décision refusée (42501)', async () => {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', virtualNow: decision }, async (tx) => {
        const s = await seed(tx);
        await tx.query(`SELECT pg_catalog.set_config('app.worker_name', 'settlement', true)`);
        expect(await dueOf(tx, s['deposit_id'])).toEqual([]);
        const e = await failure(tx, decideSql, [
          s['deposit_id'],
          0,
          'VOIDED',
          '0',
          depositOf(cc).toString(),
        ]);
        expect(e).toMatchObject({ code: '42501', constraint: 'deposit_hold_command_forbidden' });
        expect(translateDbError(e ?? {}).code).toBe('FORBIDDEN');
      }),
    );
  });
});

describe.each(COUNTRIES)('US-702b — ré-autorisation et retour réel ($country, $currency)', (cc) => {
  /** T59 en rail (a) (fixture d'US-701) : expiration début + 144 h, libération début + 144 h 25. */
  const start = '2031-08-01T10:00:00.000Z';
  const end = at(start, 72);
  const expiry = at(start, 144);
  const release = new Date(Date.parse(start) + (144 * 60 + 25) * 60_000).toISOString();
  const reauthDue = at(start, 120);
  const seed = async (tx: Tx) =>
    (
      await tx.query<Row>(
        `SELECT * FROM test_fixture.us701_converted_deposit($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          cc.country,
          cc.currency,
          cc.timezone,
          start,
          end,
          depositOf(cc).toString(),
          expiry,
          release,
          release,
          reauthDue,
          `fake-${uuid()}`,
        ],
      )
    ).rows[0]!;
  const reauthOf = async (tx: Tx, id: unknown) =>
    (await tx.query<Row>('SELECT * FROM core.payment_deposit_reauth_due(500)')).rows.filter(
      (r) => r['deposit_id'] === id,
    );

  it('libération rendue = min(release_at, checkout_at + 72 h) : retour anticipé de 10 h ⇒ début + 134 h 25 ; retour tardif ⇒ release_at inchangée (aucune ré-autorisation de plus)', async () => {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', virtualNow: reauthDue }, async (tx) => {
        const early = await seed(tx);
        const late = await seed(tx);
        await tx.query('SELECT test_fixture.us702b_record_return($1, $2)', [
          early['trip_id'],
          at(end, -10),
        ]);
        await tx.query('SELECT test_fixture.us702b_record_return($1, $2)', [
          late['trip_id'],
          at(end, 10),
        ]);
        const e = await reauthOf(tx, early['deposit_id']);
        const l = await reauthOf(tx, late['deposit_id']);
        expect(e).toHaveLength(1);
        expect(l).toHaveLength(1);
        expect(iso(e[0]!['release_at'])).toBe(
          new Date(Date.parse(start) + (134 * 60 + 25) * 60_000).toISOString(),
        );
        expect(iso(l[0]!['release_at'])).toBe(release);
      }),
    );
  });
});

describe('US-701 / US-702 — droits ciblés des fonctions de la caution', () => {
  const API = [
    'core.payment_deposit_checkout(bytea, uuid)',
    'core.payment_cmd_record_deposit_decision(bytea, uuid, jsonb)',
  ];
  const WORKER = [
    'core.payment_deposit_reauth_due(integer)',
    'core.payment_cmd_deposit_transition(uuid, text, integer, timestamptz, timestamptz, timestamptz, text)',
    'core.payment_deposit_decision_due(integer)',
    'core.payment_cmd_deposit_decide(uuid, integer, text, bigint, bigint)',
  ];

  it('has_function_privilege : app_anon n’exécute aucune fonction de la caution ; app_api seulement celles du voyageur, app_worker seulement celles du travailleur', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{ fn: string; role: string; x: boolean }>(
        `SELECT f AS fn, r AS role, pg_catalog.has_function_privilege(r, f, 'EXECUTE') AS x
           FROM unnest($1::text[]) AS f, unnest(ARRAY['app_anon', 'app_api', 'app_worker']) AS r
          ORDER BY 1, 2`,
        [[...API, ...WORKER]],
      );
      for (const r of rows) {
        const expected =
          (r.role === 'app_api' && API.includes(r.fn)) ||
          (r.role === 'app_worker' && WORKER.includes(r.fn));
        expect(r.x, `${r.role} ${r.fn}`).toBe(expected);
      }
      expect(rows).toHaveLength((API.length + WORKER.length) * 3);
    });
  });
});
