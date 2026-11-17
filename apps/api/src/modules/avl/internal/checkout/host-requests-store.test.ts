/**
 * US-223c — `PgHostRequestStore` sur des lignes de la FORME exacte que rend `pg` (bigint en texte,
 * instants en `Date`, jsonb en objet, numeric en texte) pour les quatre fonctions de 0124 ; SQL et
 * paramètres liés relus. Les règles sont prouvées en base (l0-us223-request) ; ici, le parseur :
 * jambes exactement les quatre clés, montants entiers, issues connues, toute autre forme ⇒ panne
 * (jamais un succès supposé). Attendus : TJ01 de l'export des oracles, jamais le code testé.
 */
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import { HostRequestStoreError, PgHostRequestStore } from './host-requests-store.js';

const TJ01 = legVector(loadGoldenVectors(), 'TJ01');
const HOLD = '00000000-0000-4000-8000-00000223c1a1';
const ORG = '00000000-0000-4000-8000-00000223c1b1';
const OP = '00000000-0000-4000-8000-00000223c1c1';
const PROOF = Buffer.alloc(32, 7);

type Row = Record<string, unknown>;

function db(rows: Row[]) {
  const calls: { text: string; params: unknown[] }[] = [];
  return {
    calls,
    executor: {
      query: <R>(text: string, params: unknown[] = []) => {
        calls.push({ text, params });
        return Promise.resolve({ rows: rows as R[], rowCount: rows.length });
      },
    },
  };
}

const legsText = Object.fromEntries(
  Object.entries(TJ01.legsMinor).map(([k, v]) => [k, v.toString()]),
);

describe('US-223c — PgHostRequestStore (forme des lignes de pg)', () => {
  it('lecture : une demande, montants en texte, instants Date, note numeric en texte ; compte d’un autre ⇒ FORBIDDEN', async () => {
    const d = db([
      {
        outcome: 'DONE',
        hold_id: HOLD,
        status: 'AWAITING_HOST',
        vehicle_id: OP,
        scheduled_start: new Date('2036-12-10T15:00:00.000Z'),
        scheduled_end: new Date('2036-12-13T15:00:00.000Z'),
        timezone: 'Etc/UTC',
        request_respond_by: new Date('2036-12-01T16:00:00.000Z'),
        currency: TJ01.currency,
        total_minor: TJ01.totalMinor.toString(),
        host_leg_minor: (TJ01.legsMinor.HOST ?? 0n).toString(),
        guest_first_name: 'Ana',
        guest_age_years: 34,
        guest_rating: '4.80',
        guest_verified: true,
      },
    ]);
    const rows = await new PgHostRequestStore(d.executor).list(PROOF, ORG, null);
    expect(d.calls[0]?.text).toBe(
      'SELECT * FROM core.booking_host_requests($1, $2::uuid, $3::uuid, $4)',
    );
    expect(d.calls[0]?.params).toEqual([PROOF, ORG, null, 100]);
    expect(rows).toEqual([
      {
        holdId: HOLD,
        status: 'AWAITING_HOST',
        vehicleId: OP,
        scheduledStart: '2036-12-10T15:00:00.000Z',
        scheduledEnd: '2036-12-13T15:00:00.000Z',
        timezone: 'Etc/UTC',
        respondBy: '2036-12-01T16:00:00.000Z',
        currency: TJ01.currency,
        totalMinor: TJ01.totalMinor.toString(),
        hostLegMinor: (TJ01.legsMinor.HOST ?? 0n).toString(),
        guest: { firstName: 'Ana', ageYears: 34, rating: 4.8, verified: true },
      },
    ]);
    expect(
      await new PgHostRequestStore(db([{ outcome: 'FORBIDDEN', hold_id: null }]).executor).list(
        PROOF,
        ORG,
        HOLD,
      ),
    ).toBe('FORBIDDEN');
    await expect(
      new PgHostRequestStore(db([{ outcome: 'DONE', status: 'EXPIRED' }]).executor).list(
        PROOF,
        ORG,
        null,
      ),
    ).rejects.toBeInstanceOf(HostRequestStoreError);
  });

  it('acceptation : capture aux jambes du devis (bigint), référence de l’autorisation, lecture ou non ; refus et issue inconnue', async () => {
    const r = {
      outcome: 'CAPTURE_ORDER',
      operationId: OP,
      idemSent: `hold:${HOLD}:CAPTURE:a1`,
      amountMinor: TJ01.totalMinor.toString(),
      currency: TJ01.currency,
      legs: legsText,
      provider: 'FAKE',
      method: 'CARD',
      authorizationReference: 'fake-auth-1',
      lookup: false,
    };
    const d = db([{ r }]);
    const accepted = await new PgHostRequestStore(d.executor).accept(PROOF, ORG, HOLD);
    expect(d.calls[0]?.text).toBe(
      'SELECT core.booking_cmd_accept_booking_request($1, $2::uuid, $3::uuid) AS r',
    );
    expect(accepted).toEqual({
      kind: 'CAPTURE',
      capture: {
        outcome: 'CAPTURE_ORDER',
        operationId: OP,
        idemSent: `hold:${HOLD}:CAPTURE:a1`,
        provider: 'FAKE',
        method: 'CARD',
        amountMinor: TJ01.totalMinor,
        currency: TJ01.currency,
        legs: TJ01.legsMinor,
        authorizationReference: 'fake-auth-1',
        lookup: false,
      },
    });
    const store = (x: Row) => new PgHostRequestStore(db([{ r: x }]).executor);
    expect(await store({ outcome: 'CAPTURING' }).accept(PROOF, ORG, HOLD)).toEqual({
      kind: 'DONE',
      outcome: 'CAPTURING',
    });
    expect(await store({ outcome: 'REQUEST_EXPIRED' }).accept(PROOF, ORG, HOLD)).toEqual({
      kind: 'REFUSED',
      code: 'REQUEST_EXPIRED',
    });
    for (const bad of [
      { outcome: 'SOMETHING_NEW' },
      { ...r, legs: { HOST: '1' } },
      { ...r, amountMinor: '-1' },
      { ...r, legs: { ...legsText, HOST: '1.5' } },
    ]) {
      await expect(store(bad).accept(PROOF, ORG, HOLD)).rejects.toBeInstanceOf(
        HostRequestStoreError,
      );
    }
  });

  it('affinage et refus : issues connues seulement', async () => {
    const one = (r: unknown) => new PgHostRequestStore(db([{ r }]).executor);
    expect(await one('RECORDED').recordCapture(PROOF, ORG, HOLD, OP, 'fake-cap')).toBe('RECORDED');
    expect(await one('FORBIDDEN').recordCapture(PROOF, ORG, HOLD, OP, 'fake-cap')).toBe(
      'FORBIDDEN',
    );
    await expect(one('???').recordCapture(PROOF, ORG, HOLD, OP, 'x')).rejects.toBeInstanceOf(
      HostRequestStoreError,
    );
    expect(await one({ outcome: 'DECLINED' }).decline(PROOF, ORG, HOLD)).toEqual({
      kind: 'DECLINED',
    });
    expect(await one({ outcome: 'INVALID_TRANSITION' }).decline(PROOF, ORG, HOLD)).toEqual({
      kind: 'REFUSED',
      code: 'INVALID_TRANSITION',
    });
    await expect(one({ outcome: 'ACCEPTED' }).decline(PROOF, ORG, HOLD)).rejects.toBeInstanceOf(
      HostRequestStoreError,
    );
  });
});
