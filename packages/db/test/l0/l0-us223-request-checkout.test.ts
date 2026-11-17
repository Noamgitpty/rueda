/**
 * US-223 (partie 223c) — réservation sur demande au checkout (migrations 0121, 0122, ADR-146), sous
 * les rôles de production (assertion L0-05 : `withRole`), en USD (PA) et en PYG sans décimale (PY).
 * Personnes, sessions, devis figés et checkout par les VRAIES commandes (US-208, US-209, US-226) ;
 * interrupteurs `p2p_private_hosts_enabled` et `insurer_contract_active` ouverts par la procédure à
 * deux personnes d'US-125, et `booking_request_mode_enabled` posé par la fixture 9957, dans une
 * transaction ANNULÉE ; compte marchand FAKE de bac à sable et capacités du PSP posés dans la même
 * transaction.
 *
 * Attendus : jamais le code testé. Ils viennent de 19 US-223 (DoR 2 : tant que le mode n'est pas
 * ouvert, une annonce `instant_book = false` n'est jamais réservée comme INSTANT), de 17 §2.5
 * « Hold de demande REQUEST » (envoi : `cmd_place_hold` avec `kind = REQUEST`, `createHostedPayment`
 * en capture MANUAL, opération AUTH du montant total, jambes figées au devis ; moyens : seulement
 * ceux dont SUPPORTS_PREAUTH ET SUPPORTS_VOID sont validés, inconnue = « non »), de 08 E7 (règle 2)
 * et des vecteurs du checkout d'US-208 / US-226 (en-tête de l0-us223-checkout-payment) :
 * - PA : total 158,40 ; HOST 90,00 ; INSURER 21,00 ; TAX 0 ; PLATFORM 47,40 ;
 * - PY : total 1 415 002 ; HOST 750 001 ; INSURER 105 000 ; TAX 0 ; PLATFORM 560 001.
 * Paramètre de 0121 (PROPOSÉ, ADR-146) : booking_request_mode_enabled = faux dans chaque pays.
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
  failure,
  frozenQuote,
  openSwitch,
  protectionParams,
  quoteDocs,
  taxGroups,
} from '../support/checkout.ts';
import type { CheckoutVector, Person } from '../support/checkout.ts';

type Tx = pg.ClientBase;
type Json = Record<string, unknown>;

const NOW = '2026-12-01T12:00:00.000Z';
const START = '2026-12-10T15:00:00.000Z';
const MIN = 60_000;

const VECTORS: Readonly<Record<string, CheckoutVector & { platform: number }>> = {
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
    platform: 4_740,
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
    platform: 560_001,
  },
};

const at = (iso: string, minutes: number): string =>
  new Date(Date.parse(iso) + minutes * MIN).toISOString();

interface World {
  readonly groups: Map<string, string>;
  readonly account: string;
}

async function capability(
  tx: Tx,
  cc: CountryCase,
  name: string,
  value: unknown,
  status: 'VALIDATED_SANDBOX' | 'UNKNOWN',
): Promise<void> {
  await tx.query(
    `SELECT test_fixture.us024_set_capability('FAKE', $1, '*', $2, $3::jsonb, $4, $5::timestamptz)`,
    [cc.country, name, JSON.stringify(value), status, at(NOW, -3)],
  );
}

/** Capacités bloquantes validées (US-061), puis pré-autorisation et annulation au choix. */
async function capabilities(
  tx: Tx,
  cc: CountryCase,
  requestCaps: 'VALIDATED_SANDBOX' | 'UNKNOWN',
): Promise<void> {
  const { rows } = await tx.query<{ capability: string; kind: string }>(
    `SELECT capability, kind FROM core.payment_psp_capability_catalog WHERE blocking <> 'NO'`,
  );
  for (const r of rows) {
    const value = r.kind === 'bool' ? true : r.kind === 'int' ? 1 : 'FAKE_HMAC_SHA256';
    await capability(tx, cc, r.capability, value, 'VALIDATED_SANDBOX');
  }
  await capability(tx, cc, 'SUPPORTS_PREAUTH', true, 'VALIDATED_SANDBOX');
  await capability(tx, cc, 'SUPPORTS_VOID', true, requestCaps);
}

function scenario(cc: CountryCase, requestMode: boolean) {
  return (fn: (tx: Tx, w: World) => Promise<void>) =>
    withRole('app_api', (client) =>
      withTestTransaction(client, { virtualNow: NOW }, async (tx) => {
        await openSwitch(tx, 'p2p_private_hosts_enabled', cc.country);
        await openSwitch(tx, 'insurer_contract_active', cc.country);
        if (requestMode) {
          await tx.query('SELECT test_fixture.us223c_set_request_mode($1, true)', [cc.country]);
        }
        const v = VECTORS[cc.country]!;
        if (v.schedule !== null) {
          await tx.query('SELECT test_fixture.us704_set_trip_fee_schedule($1, $2::jsonb)', [
            cc.country,
            JSON.stringify(v.schedule),
          ]);
        }
        await protectionParams(tx, cc.country, v);
        const acc = await tx.query<{ id: string }>(
          'SELECT test_fixture.us024_psp_account($1) AS id',
          [cc.country],
        );
        await fn(tx, { groups: await taxGroups(tx, cc), account: acc.rows[0]!.id });
      }),
    );
}

async function guest(tx: Tx, cc: CountryCase): Promise<Person> {
  const p = await checkoutPerson(tx, cc.country);
  await approveDriver(tx, p, cc.country, { birth: '1990-01-01', licenseExpiry: '2030-12-31' });
  return p;
}

/** Annonce LISTED (fixture 9998), immédiate ou sur demande, puis devis de 3 jours et checkout. */
async function checkout(tx: Tx, cc: CountryCase, w: World, p: Person, instant: boolean) {
  const v = VECTORS[cc.country]!;
  const { rows } = await tx.query<{ listing_id: string; vehicle_id: string }>(
    'SELECT * FROM test_fixture.us208_listed_listing($1, $2, $3, $4)',
    [cc.country, v.daily, 'AUTOMATIC', instant],
  );
  const listingId = rows[0]!.listing_id;
  const d = quoteDocs(cc, v, w.groups, Date.parse(START), Date.parse(NOW));
  const quoteId = await frozenQuote(tx, p, listingId, d);
  const shown = await tx.query<{ documents: { kind: string; version: number }[] | null }>(
    'SELECT documents FROM core.booking_checkout_quote($1, $2)',
    [p.hash, quoteId],
  );
  const documents = (shown.rows[0]?.documents ?? []).map((x) => ({
    kind: x.kind,
    version: x.version,
  }));
  const r = await tx.query<{ outcome: string; hold_id: string | null }>(
    'SELECT * FROM core.booking_cmd_checkout($1, $2, $3, $4, $5, $6::jsonb)',
    [p.hash, quoteId, 'Ana', 'Pérez', false, JSON.stringify(documents)],
  );
  return { quoteId, outcome: r.rows[0]!.outcome, holdId: r.rows[0]!.hold_id };
}

const pay = async (tx: Tx, hash: Buffer, holdId: string): Promise<Json> =>
  (
    await tx.query<{ r: Json }>('SELECT core.booking_cmd_checkout_pay($1, $2, $3) AS r', [
      hash,
      holdId,
      'CARD',
    ])
  ).rows[0]!.r;

const readRequest = async (tx: Tx, hash: Buffer, holdId: string): Promise<Json> =>
  (await tx.query<Json>('SELECT * FROM core.booking_checkout_request($1, $2)', [hash, holdId]))
    .rows[0]!;

describe.each(COUNTRIES)(
  'US-223c — réservation sur demande au checkout ($country, $currency)',
  (cc) => {
    const v = VECTORS[cc.country]!;
    const legs = {
      HOST: String(v.host),
      INSURER: String(v.insurer),
      TAX_THIRD_PARTY: '0',
      PLATFORM: String(v.platform),
    };

    it('DoR 2 : mode sur demande fermé (booking_request_mode_enabled = faux, 0121) ⇒ REQUEST_MODE_UNAVAILABLE, aucun hold, jamais une réservation INSTANT', async () => {
      await scenario(
        cc,
        false,
      )(async (tx, w) => {
        const p = await guest(tx, cc);
        const r = await checkout(tx, cc, w, p, false);
        expect(r).toMatchObject({ outcome: 'REQUEST_MODE_UNAVAILABLE', holdId: null });
        // le devis n'est pas engagé : un second essai rend le même refus (aucun hold posé)
        const again = await tx.query<{ outcome: string }>(
          'SELECT * FROM core.booking_cmd_checkout($1, $2, $3, $4, $5, $6::jsonb)',
          [p.hash, r.quoteId, 'Ana', 'Pérez', false, '[]'],
        );
        expect(again.rows[0]!.outcome).toBe('REQUEST_MODE_UNAVAILABLE');
      });
    });

    it('17 §2.5 « Envoi » : mode ouvert ⇒ hold REQUEST ; T1 : autorisation AUTH en capture MANUAL, montant et CHAQUE jambe du devis engagé ; rien n’est capturé', async () => {
      await scenario(
        cc,
        true,
      )(async (tx, w) => {
        const p = await guest(tx, cc);
        const r = await checkout(tx, cc, w, p, false);
        expect(r.outcome).toBe('DONE');
        const holdId = r.holdId!;
        expect(await readRequest(tx, p.hash, holdId)).toMatchObject({
          outcome: 'DONE',
          hold_kind: 'REQUEST',
          request_status: 'AUTHORIZING',
          request_respond_by: null,
        });
        await capabilities(tx, cc, 'VALIDATED_SANDBOX');
        const first = await pay(tx, p.hash, holdId);
        expect(first).toMatchObject({
          outcome: 'NEW_ORDER',
          amountMinor: String(v.total),
          currency: cc.currency,
          attemptNo: 1,
          legs,
          captureMode: 'MANUAL',
          provider: 'FAKE',
          method: 'CARD',
          pspAccountId: w.account,
        });
        expect(first['idemSent']).toBe(`hold:${holdId}:AUTH:a1`);
        expect(v.host + v.insurer + v.platform).toBe(v.total);
        // double clic : même autorisation, même clé, aucun nouvel ordre
        expect(await pay(tx, p.hash, holdId)).toMatchObject({
          outcome: 'RETRY_SAME_KEY',
          operationId: first['operationId'],
          idemSent: first['idemSent'],
          captureMode: 'MANUAL',
          legs,
        });
        const t2 = await tx.query<{ r: string }>(
          'SELECT core.booking_cmd_checkout_record_order($1, $2, $3, $4, $5) AS r',
          [p.hash, holdId, first['operationId'], `fake-${uuid()}`, at(NOW, 5)],
        );
        expect(t2.rows[0]!.r).toBe('RECORDED');
        expect(await readRequest(tx, p.hash, holdId)).toMatchObject({
          hold_kind: 'REQUEST',
          request_status: 'AUTHORIZING',
        });
      });
    });

    it('17 §2.5 « Moyens de paiement » : SUPPORTS_VOID inconnue (= non) ⇒ PAYMENT_METHOD_UNAVAILABLE avant tout ordre, le hold reste payable', async () => {
      await scenario(
        cc,
        true,
      )(async (tx, w) => {
        const p = await guest(tx, cc);
        const r = await checkout(tx, cc, w, p, false);
        expect(r.outcome).toBe('DONE');
        await capabilities(tx, cc, 'UNKNOWN');
        const e = await failure(tx, 'SELECT core.booking_cmd_checkout_pay($1, $2, $3)', [
          p.hash,
          r.holdId,
          'CARD',
        ]);
        expect(e).toMatchObject({ code: '55000', constraint: 'payment_method_unavailable' });
        expect(translateDbError(e ?? {}).code).toBe('PAYMENT_METHOD_UNAVAILABLE');
        const read = await tx.query<Json>('SELECT * FROM core.booking_checkout_payment($1, $2)', [
          p.hash,
          r.holdId,
        ]);
        expect(read.rows[0]).toMatchObject({ hold_status: 'ACTIVE', operation_status: null });
      });
    });

    it('réservation immédiate inchangée : annonce instantanée ⇒ hold CHECKOUT, capture AUTO, clé CAPTURE ; aucune demande lue', async () => {
      await scenario(
        cc,
        true,
      )(async (tx, w) => {
        const p = await guest(tx, cc);
        const r = await checkout(tx, cc, w, p, true);
        expect(r.outcome).toBe('DONE');
        expect(await readRequest(tx, p.hash, r.holdId!)).toMatchObject({
          hold_kind: 'CHECKOUT',
          request_status: null,
        });
        await capabilities(tx, cc, 'VALIDATED_SANDBOX');
        const first = await pay(tx, p.hash, r.holdId!);
        expect(first).toMatchObject({ outcome: 'NEW_ORDER', captureMode: 'AUTO', legs });
        expect(first['idemSent']).toBe(`hold:${r.holdId!}:CAPTURE:a1`);
      });
    });

    it('IDOR : demande d’un autre voyageur ⇒ HOLD_NOT_FOUND, sans session ⇒ AUTH_REQUIRED', async () => {
      await scenario(
        cc,
        true,
      )(async (tx, w) => {
        const p = await guest(tx, cc);
        const other = await guest(tx, cc);
        const r = await checkout(tx, cc, w, p, false);
        expect(r.outcome).toBe('DONE');
        expect(await readRequest(tx, other.hash, r.holdId!)).toMatchObject({
          outcome: 'HOLD_NOT_FOUND',
          hold_kind: null,
        });
        expect(await readRequest(tx, Buffer.alloc(32), r.holdId!)).toMatchObject({
          outcome: 'AUTH_REQUIRED',
        });
      });
    });
  },
);

describe('US-223c rôles', () => {
  it('commandes de l’hôte et lecture de la demande : app_api seul ; expiration, preuve et VOID : app_worker seul', async () => {
    const hash = Buffer.alloc(32);
    const apiOnly: [string, unknown[]][] = [
      ['SELECT core.booking_cmd_accept_booking_request($1, $2, $3)', [hash, uuid(), uuid()]],
      ['SELECT core.booking_cmd_decline_booking_request($1, $2, $3)', [hash, uuid(), uuid()]],
      [
        'SELECT core.booking_cmd_request_record_capture($1, $2, $3, $4, $5)',
        [hash, uuid(), uuid(), uuid(), 'fake-x'],
      ],
      ['SELECT * FROM core.booking_checkout_request($1, $2)', [hash, uuid()]],
      ['SELECT * FROM core.booking_host_requests($1, $2, NULL, 10)', [hash, uuid()]],
    ];
    const workerOnly: [string, unknown[]][] = [
      ['SELECT core.booking_cmd_expire_booking_requests(10)', []],
      ['SELECT core.booking_request_authorized($1)', [uuid()]],
      ['SELECT core.booking_request_void($1, $2)', [uuid(), uuid()]],
    ];
    const internal: [string, unknown[]][] = [
      [
        `SELECT core.booking_place_hold_kind($1, '2030-01-01T00:00:00Z', '2030-01-02T00:00:00Z', false, 'REQUEST')`,
        [uuid()],
      ],
      [`SELECT core.booking_request_host_gate($1, $2, $3, 'ACCEPT')`, [hash, uuid(), uuid()]],
    ];
    for (const role of ['app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        for (const [sql, args] of [...apiOnly, ...internal]) {
          await expect(client.query(sql, args), `${role} ${sql}`).rejects.toMatchObject({
            code: '42501',
          });
        }
      });
    }
    for (const role of ['app_api', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        for (const [sql, args] of [...workerOnly, ...internal]) {
          await expect(client.query(sql, args), `${role} ${sql}`).rejects.toMatchObject({
            code: '42501',
          });
        }
      });
    }
  });
});
