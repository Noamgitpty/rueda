/**
 * Preuves des contrôles bloquants et de la revue des réservations signalées (US-209, partie 209a ;
 * migration 0112, ADR-135 ; fixture 9967) sous les rôles de production (assertion L0-05 en tête de
 * chaque connexion : `withRole` / `connectAs`), en USD (PA) et en PYG sans décimale (PY).
 * Personnes, sessions, devis et checkout par les VRAIES commandes ; interrupteurs ouverts par la
 * procédure à deux personnes d'US-125 dans une transaction ANNULÉE ; dossier d'identité écrit par la
 * fixture 9967 sous la forme de la décision du fournisseur (US-105 / US-106).
 *
 * Attendus : jamais le code testé. Ils viennent de 19 US-209, de 16 et de 08 :
 * - âge minimum 25 ans pour la classe Premium, 21 sinon (16 BKG-012, 08 « Recommandation LATAM »,
 *   graine `min_driver_age` 21 / PREMIUM 25), âge calculé à la date de DÉBUT du trip (08 BR-ACC-04) ;
 *   un voyageur de 24 ans ⇒ AGE_CLASS_MISMATCH (19 US-209, critère 1) ;
 * - permis valable jusqu'à la fin du trip (ADR-102, KYC_LICENSE_EXPIRED), vérification approuvée
 *   (KYC_NOT_APPROVED), consentement biométrique en vigueur (KYC_BIOMETRIC_CONSENT_MISSING, N-122) ;
 * - VER-007 en mode FLAG : entrée le 01/11 et fin le 31/01 ⇒ revue, jamais un refus ; fin à entrée
 *   + 90 j exactement (30/01) ⇒ aucun signalement (19 US-209, critère 2 ; 16 VER-007) ;
 * - réservation signalée et `flagged_booking_payment_order` = REVIEW_BEFORE_CHARGE (défaut) ⇒ hold
 *   `review_required`, échéance `review_hold_minutes` = 120 min (17 §7.2), aucune intention de
 *   paiement avant la décision ; PAY_THEN_REVIEW ⇒ hold ordinaire (TTL 10 min, 08 BR-BOOK-10), la
 *   revue reste en file (19 US-209, critère 4 ; 17 §2.5) ;
 * - règles de 16 ADM-029 : « compte créé il y a 2 h » et « Premium » ensemble ⇒ revue ; une seule
 *   règle faible ⇒ aucune revue (jamais plus lourd que Turo, ADR-135) ;
 * - mêmes contrôles au paiement et à la conversion (N-53, N-95, L2-PM-21).
 */
import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../src/index.ts';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES, inTx, newSlot, placeHold, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import {
  approveDriver,
  checkoutPerson,
  checkoutQuote,
  DAY_MS,
  failure,
  frozenQuote,
  listedListing,
  openSwitch,
  protectionParams,
  quoteDocs,
  setClock,
  setSwitch,
  taxGroups,
} from '../support/checkout.ts';
import type { CheckoutVector, Driver, Person } from '../support/checkout.ts';
import { person as staffPerson } from '../support/kyc.ts';
import { auditOf, elevate, login } from '../support/staff.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

const NOW = '2026-12-01T12:00:00.000Z';
/** Début du trip : 10:00 au Panama, 12:00 au Paraguay, le 10/12 dans les deux pays. */
const START = '2026-12-10T15:00:00.000Z';
const MIN = 60_000;
const ADULT: Driver = { birth: '1990-01-01', licenseExpiry: '2030-12-31' };
/** TTL initial d'un hold (08 BR-BOOK-10) et d'un hold de revue (17 §7.2 review_hold_minutes). */
const HOLD_TTL_MIN = 10;
const REVIEW_HOLD_MIN = 120;

/**
 * Vecteurs du devis (en-tête de l0-us208-checkout.test.ts) : TA01 en PA (40,00 × 3 j, ITBMS 7 % sur
 * le loyer, barème de test du trip fee à 0 %, total 128,40, HOST 9 000) ; D2 de 08 sans ses lignes
 * non taxées en PY (333 334 × 3 + trip fee 150 000 + taxes 115 000 = 1 265 002, HOST 750 001) ;
 * plus la protection minimale BASICA exigée depuis US-226 (grille de TEST de la fixture 9977, 16
 * PRC-018 ; vecteurs de l0-us208-checkout.test.ts) : PA 30,00, prime 21,00 (TJ01), total 158,40 ;
 * PY 150 000, prime 105 000 (TJ09a), total 1 415 002.
 */
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

const plus = (iso: string, minutes: number): string =>
  new Date(Date.parse(iso) + minutes * MIN).toISOString();

interface World {
  readonly groups: Map<string, string>;
}

function scenario(cc: CountryCase, now = NOW) {
  return (fn: (tx: Tx, w: World) => Promise<void>) =>
    withRole('app_api', (client) =>
      withTestTransaction(client, { virtualNow: now }, async (tx) => {
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
        await fn(tx, { groups: await taxGroups(tx, cc) });
      }),
    );
}

/** Annonce immédiate, classe de valeur du véhicule (NULL : sans classe), préavis du lieu. */
async function listing(
  tx: Tx,
  cc: CountryCase,
  valueClass: string | null = null,
  noticeMinutes: number | null = null,
): Promise<string> {
  const l = await listedListing(tx, cc, VECTORS[cc.country]!.daily);
  if (valueClass !== null) {
    await tx.query('SELECT test_fixture.us108_set_value_class($1, $2)', [l.vehicleId, valueClass]);
  }
  if (noticeMinutes !== null) {
    await tx.query('SELECT test_fixture.us209_set_notice($1, $2)', [l.vehicleId, noticeMinutes]);
  }
  return l.listingId;
}

/** `foreign_license_review_enabled` du pays (graine 0113 : false, DEC-FONDATEUR-22). */
async function foreignReview(tx: Tx, cc: CountryCase, on: boolean): Promise<void> {
  await tx.query('SELECT test_fixture.us209_set_param($1, $2, NULL, $3::jsonb)', [
    'foreign_license_review_enabled',
    cc.country,
    JSON.stringify(on),
  ]);
}

/** Éligibilité à la conversion du hold (vraie fonction, contexte du travailleur, fixture 9967). */
async function conversion(tx: Tx, holdId: string | null): Promise<string | undefined> {
  const r = await tx.query<{ r: string }>(
    'SELECT test_fixture.us209_conversion_eligibility($1) AS r',
    [holdId],
  );
  return r.rows[0]?.r;
}

async function guest(tx: Tx, cc: CountryCase, d: Driver | null = ADULT): Promise<Person> {
  const p = await checkoutPerson(tx, cc.country);
  if (d !== null) await approveDriver(tx, p, cc.country, d);
  return p;
}

/** Devis de 3 jours puis checkout du voyageur. */
async function book(
  tx: Tx,
  cc: CountryCase,
  w: World,
  p: Person,
  listingId: string,
  start = START,
  now = NOW,
) {
  const d = quoteDocs(cc, VECTORS[cc.country]!, w.groups, Date.parse(start), Date.parse(now));
  const quoteId = await frozenQuote(tx, p, listingId, d);
  return checkoutQuote(tx, p, quoteId);
}

async function holdRow(tx: Tx, holdId: string | null): Promise<Row> {
  const r = (await tx.query<Row>('SELECT * FROM test_fixture.us209_hold_row($1)', [holdId])).rows;
  if (!r[0]) throw new Error('hold introuvable');
  return r[0];
}

async function riskRows(tx: Tx, holdId: string | null): Promise<Row[]> {
  return (await tx.query<Row>('SELECT * FROM test_fixture.us209_risk_rows($1)', [holdId])).rows;
}

const codes = (row: Row | undefined): string[] =>
  ((row?.['rules_fired'] ?? []) as { code: string }[]).map((r) => r.code).sort();

async function holdsOf(tx: Tx, p: Person): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    'SELECT pg_catalog.count(*)::int AS n FROM core.booking_checkout_hold WHERE guest_user_id = $1',
    [p.id],
  );
  return rows[0]?.n ?? -1;
}

async function checkoutConsents(tx: Tx, p: Person): Promise<number> {
  return (await tx.query<Row>('SELECT * FROM test_fixture.us208_consent_rows($1)', [p.id])).rows
    .length;
}

/** Intention de paiement du voyageur (vraie commande), erreur rendue sans abandonner la transaction. */
async function startPayment(tx: Tx, p: Person, holdId: string | null) {
  await tx.query(
    `SELECT pg_catalog.set_config('app.actor_kind', 'GUEST', true),
            pg_catalog.set_config('app.actor_id', $1, true)`,
    [p.id],
  );
  const e = await failure(tx, 'SELECT core.booking_cmd_start_payment($1, $2, $3)', [
    holdId,
    uuid(),
    'CARD',
  ]);
  await tx.query(
    `SELECT pg_catalog.set_config('app.actor_kind', '', true),
            pg_catalog.set_config('app.actor_id', '', true)`,
  );
  return e;
}

async function paymentOperations(tx: Tx, holdId: string | null): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    'SELECT pg_catalog.count(*)::int AS n FROM core.payment_payment_operation WHERE hold_id = $1',
    [holdId],
  );
  return rows[0]?.n ?? -1;
}

describe.each(COUNTRIES.map((c) => [c.country, c] as const))(
  'US-209 contrôles bloquants et revue (%s)',
  (_name, cc) => {
    const run = scenario(cc);

    it('critère 1 : classe Premium (25 ans) et voyageur de 24 ans à la date de début ⇒ AGE_CLASS_MISMATCH, rien d’écrit ; 25 ans le jour du début ⇒ réservé ; 24 ans sans classe (21 ans) ⇒ réservé', async () => {
      await run(async (tx, w) => {
        const premium = await listing(tx, cc, 'PREMIUM');
        const young = await guest(tx, cc, { ...ADULT, birth: '2001-12-11' });
        const r = await book(tx, cc, w, young, premium);
        expect(r).toMatchObject({ outcome: 'AGE_CLASS_MISMATCH', hold_id: null });
        expect(await holdsOf(tx, young)).toBe(0);
        expect(await checkoutConsents(tx, young)).toBe(0);

        const exactly = await guest(tx, cc, { ...ADULT, birth: '2001-12-10' });
        expect((await book(tx, cc, w, exactly, premium)).outcome).toBe('DONE');

        const standard = await listing(tx, cc);
        const other = await guest(tx, cc, { ...ADULT, birth: '2001-12-11' });
        expect((await book(tx, cc, w, other, standard)).outcome).toBe('DONE');
      });
    });

    it('critère 1 : vérification absente ⇒ KYC_NOT_APPROVED ; permis échu la veille de la fin ⇒ KYC_LICENSE_EXPIRED ; consentement biométrique refusé ⇒ KYC_BIOMETRIC_CONSENT_MISSING (N-122) ; permis valable le jour de la fin ⇒ réservé', async () => {
      await run(async (tx, w) => {
        const id = await listing(tx, cc);
        const none = await guest(tx, cc, null);
        expect((await book(tx, cc, w, none, id)).outcome).toBe('KYC_NOT_APPROVED');

        // fin du trip : 13/12 (début + 3 j), date locale dans les deux pays
        const expired = await guest(tx, cc, { ...ADULT, licenseExpiry: '2026-12-12' });
        expect((await book(tx, cc, w, expired, id)).outcome).toBe('KYC_LICENSE_EXPIRED');

        const withdrawn = await guest(tx, cc);
        await tx.query('SELECT test_fixture.us209_refuse_biometric($1, $2)', [
          withdrawn.id,
          cc.country,
        ]);
        expect((await book(tx, cc, w, withdrawn, id)).outcome).toBe(
          'KYC_BIOMETRIC_CONSENT_MISSING',
        );
        for (const p of [none, expired, withdrawn]) {
          expect(await holdsOf(tx, p)).toBe(0);
          expect(await checkoutConsents(tx, p)).toBe(0);
        }

        const lastDay = await guest(tx, cc, { ...ADULT, licenseExpiry: '2026-12-13' });
        expect((await book(tx, cc, w, lastDay, id)).outcome).toBe('DONE');
      });
    });

    it('US-226 et US-209 ensemble : devis avec protection et conducteur refusé ⇒ AGE_CLASS_MISMATCH ; devis sans protection ⇒ PROTECTION_LEVEL_REQUIRED, que le conducteur soit éligible ou non ; contrat d’assureur refermé ⇒ INSURER_CONTRACT_INACTIVE avant tout contrôle du conducteur', async () => {
      await run(async (tx, w) => {
        const premium = await listing(tx, cc, 'PREMIUM');
        const v = VECTORS[cc.country]!;
        const docsOf = (withProtection: boolean) =>
          quoteDocs(cc, v, w.groups, Date.parse(START), Date.parse(NOW), withProtection);
        // protection présente (US-226 satisfaite), conducteur de 24 ans en Premium (US-209 refuse)
        const young = await guest(tx, cc, { ...ADULT, birth: '2001-12-11' });
        const r1 = await checkoutQuote(
          tx,
          young,
          await frozenQuote(tx, young, premium, docsOf(true)),
        );
        expect(r1).toMatchObject({ outcome: 'AGE_CLASS_MISMATCH', hold_id: null });
        // devis sans protection : refus d'US-226, conducteur éligible ou non
        const adult = await guest(tx, cc);
        const r2 = await checkoutQuote(
          tx,
          adult,
          await frozenQuote(tx, adult, premium, docsOf(false)),
        );
        expect(r2).toMatchObject({ outcome: 'PROTECTION_LEVEL_REQUIRED', hold_id: null });
        const r3 = await checkoutQuote(
          tx,
          young,
          await frozenQuote(tx, young, premium, docsOf(false)),
        );
        expect(r3).toMatchObject({ outcome: 'PROTECTION_LEVEL_REQUIRED', hold_id: null });
        for (const p of [young, adult]) expect(await holdsOf(tx, p)).toBe(0);
        // les deux satisfaits : réservé (signalé en revue : compte récent et Premium)
        const ok = await checkoutQuote(
          tx,
          adult,
          await frozenQuote(tx, adult, premium, docsOf(true)),
        );
        expect(ok.outcome).toBe('DONE');
        expect(await holdRow(tx, ok.hold_id)).toMatchObject({ review_required: true });
        // contrat d'assureur refermé après le gel : refus d'US-226, jamais un code du conducteur
        const unverified = await guest(tx, cc, null);
        const late = await frozenQuote(tx, unverified, premium, docsOf(true));
        // nouvelle version de l'interrupteur à un autre instant que son ouverture (valid_from unique)
        await setClock(tx, plus(NOW, 1));
        await setSwitch(tx, 'insurer_contract_active', cc.country, false);
        expect(await checkoutQuote(tx, unverified, late)).toMatchObject({
          outcome: 'INSURER_CONTRACT_INACTIVE',
          hold_id: null,
        });
      });
    });

    it('critère 1, date LOCALE du début (08 BR-ACC-04) : départ le 11/12 à 02:00Z = 10/12 au soir dans le pays ⇒ né le 11/12/2001, 24 ans ce jour-là, refusé ; date de naissance inconnue ⇒ AGE_CLASS_MISMATCH ; né le 10/12/2001 ⇒ réservé', async () => {
      await run(async (tx, w) => {
        const premium = await listing(tx, cc, 'PREMIUM');
        const LOCAL_EVENING = '2026-12-11T02:00:00.000Z';
        const young = await guest(tx, cc, { ...ADULT, birth: '2001-12-11' });
        expect((await book(tx, cc, w, young, premium, LOCAL_EVENING)).outcome).toBe(
          'AGE_CLASS_MISMATCH',
        );
        const unknown = await guest(tx, cc, { ...ADULT, birth: null });
        expect((await book(tx, cc, w, unknown, premium, LOCAL_EVENING)).outcome).toBe(
          'AGE_CLASS_MISMATCH',
        );
        const exactly = await guest(tx, cc, { ...ADULT, birth: '2001-12-10' });
        expect((await book(tx, cc, w, exactly, premium, LOCAL_EVENING)).outcome).toBe('DONE');
      });
    });

    it('règles de 16 ADM-029 : départ dans moins de 3 h (préavis de l’hôte à 1 h) et compte récent ⇒ revue (50) ; classe LUXE et compte récent ⇒ revue ; dernière version inactive ⇒ règle non évaluée ; dernière version active ⇒ version citée', async () => {
      await run(async (tx, w) => {
        const soon = plus(NOW, 120);
        const p1 = await guest(tx, cc);
        const r1 = await book(tx, cc, w, p1, await listing(tx, cc, null, 60), soon);
        expect(r1.outcome).toBe('DONE');
        const [a1] = await riskRows(tx, r1.hold_id);
        expect(a1).toMatchObject({ decision: 'REVIEW', score: 50 });
        expect(codes(a1)).toEqual(['ACCOUNT_UNDER_24H', 'SHORT_NOTICE_START']);

        const p2 = await guest(tx, cc);
        const r2 = await book(tx, cc, w, p2, await listing(tx, cc, 'LUXE'));
        expect(r2.outcome).toBe('DONE');
        const [a2] = await riskRows(tx, r2.hold_id);
        expect(a2?.['rules_fired']).toContainEqual({
          code: 'HIGH_VALUE_CLASS',
          version: 1,
          signal: 'LUXE',
        });
        expect(a2).toMatchObject({ decision: 'REVIEW', score: 50 });

        // version 2 inactive de ACCOUNT_UNDER_24H, version 2 active de HIGH_VALUE_CLASS
        await tx.query('SELECT test_fixture.us209_rule_version($1, false)', ['ACCOUNT_UNDER_24H']);
        await tx.query('SELECT test_fixture.us209_rule_version($1, true)', ['HIGH_VALUE_CLASS']);
        const p3 = await guest(tx, cc);
        const r3 = await book(tx, cc, w, p3, await listing(tx, cc, 'PREMIUM'));
        expect(r3.outcome).toBe('DONE');
        expect(await holdRow(tx, r3.hold_id)).toMatchObject({ review_required: false });
        const [a3] = await riskRows(tx, r3.hold_id);
        expect(a3).toMatchObject({ decision: 'AUTO_OK', score: 25 });
        expect(a3?.['rules_fired']).toEqual([
          { code: 'HIGH_VALUE_CLASS', version: 2, signal: 'PREMIUM' },
        ]);
      });
    });

    it('N-122 : vrai retrait du consentement biométrique (vérification RECHECK / CONSENT_WITHDRAWN) ⇒ KYC_BIOMETRIC_CONSENT_MISSING au checkout, au démarrage du paiement et à la conversion', async () => {
      await run(async (tx, w) => {
        const before = await guest(tx, cc);
        await tx.query('SELECT test_fixture.us209_withdraw_biometric($1)', [before.id]);
        const r0 = await book(tx, cc, w, before, await listing(tx, cc));
        expect(r0).toMatchObject({ outcome: 'KYC_BIOMETRIC_CONSENT_MISSING', hold_id: null });

        const after = await guest(tx, cc);
        const r = await book(tx, cc, w, after, await listing(tx, cc));
        expect(r.outcome).toBe('DONE');
        expect(await conversion(tx, r.hold_id)).toBe('ELIGIBLE');
        await tx.query('SELECT test_fixture.us209_withdraw_biometric($1)', [after.id]);
        const e = await startPayment(tx, after, r.hold_id);
        expect(e).toMatchObject({ code: '55000', constraint: 'hold_kyc_consent_missing' });
        expect(translateDbError(e ?? {}).code).toBe('KYC_BIOMETRIC_CONSENT_MISSING');
        expect(await conversion(tx, r.hold_id)).toBe('KYC_BIOMETRIC_CONSENT_MISSING');
        expect(await paymentOperations(tx, r.hold_id)).toBe(0);
      });
    });

    it('N-95 : permis échu avant la fin et vérification retirée après la pose ⇒ refus au démarrage du paiement (KYC_LICENSE_EXPIRED, KYC_NOT_APPROVED) et à la conversion d’un hold du checkout', async () => {
      await run(async (tx, w) => {
        const lic = await guest(tx, cc);
        const r1 = await book(tx, cc, w, lic, await listing(tx, cc));
        expect(r1.outcome).toBe('DONE');
        // fin du trip le 13/12 : échéance le 12/12
        await tx.query('SELECT test_fixture.us209_set_license_expiry($1, $2::date)', [
          lic.id,
          '2026-12-12',
        ]);
        const e1 = await startPayment(tx, lic, r1.hold_id);
        expect(e1).toMatchObject({ code: '55000', constraint: 'hold_kyc_license_expired' });
        expect(translateDbError(e1 ?? {}).code).toBe('KYC_LICENSE_EXPIRED');
        expect(await conversion(tx, r1.hold_id)).toBe('KYC_LICENSE_EXPIRED');

        const rev = await guest(tx, cc);
        const r2 = await book(tx, cc, w, rev, await listing(tx, cc));
        expect(r2.outcome).toBe('DONE');
        await tx.query('SELECT test_fixture.us209_set_verification_status($1, $2)', [
          rev.id,
          'REVOKED',
        ]);
        const e2 = await startPayment(tx, rev, r2.hold_id);
        expect(e2).toMatchObject({ code: '55000', constraint: 'hold_kyc_not_approved' });
        expect(translateDbError(e2 ?? {}).code).toBe('KYC_NOT_APPROVED');
        expect(await conversion(tx, r2.hold_id)).toBe('KYC_NOT_APPROVED');
        for (const h of [r1.hold_id, r2.hold_id]) expect(await paymentOperations(tx, h)).toBe(0);
      });
    });

    describe('critère 2 : permis étranger, mode FLAG (16 VER-007)', () => {
      const LATER = '2027-01-20T12:00:00.000Z';
      const runLater = scenario(cc, LATER);
      const FOREIGN: Driver = { ...ADULT, licenseCountry: 'US' };

      it('entrée le 01/11, fin le 31/01 ⇒ réservation en revue (jamais refusée), évaluation REVIEW en file RISK_BOOKING ; fin le 30/01 (entrée + 90 j exactement) ⇒ aucun signalement', async () => {
        await runLater(async (tx, w) => {
          await foreignReview(tx, cc, true);
          const tourist = await guest(tx, cc, FOREIGN);
          const declared = await tx.query<{ outcome: string }>(
            'SELECT * FROM core.kyc_cmd_declare_entry($1, $2, $3, $4::date)',
            [tourist.hash, cc.country, 'TOURIST', '2026-11-01'],
          );
          expect(declared.rows[0]?.outcome).toBe('DONE');

          // fin le 31/01 : 10:00 au Panama, 12:00 au Paraguay
          const beyond = await book(
            tx,
            cc,
            w,
            tourist,
            await listing(tx, cc),
            '2027-01-28T15:00:00.000Z',
            LATER,
          );
          expect(beyond.outcome).toBe('DONE');
          const h = await holdRow(tx, beyond.hold_id);
          expect(h).toMatchObject({ status: 'ACTIVE', review_required: true, reviewed_at: null });
          expect(new Date(h['expires_at'] as Date).toISOString()).toBe(
            plus(LATER, REVIEW_HOLD_MIN),
          );
          const [a] = await riskRows(tx, beyond.hold_id);
          expect(a).toMatchObject({
            decision: 'REVIEW',
            explanation: 'CHECKOUT_RISK_REVIEW',
            decided_at: null,
            queue: 'RISK_BOOKING',
            queue_status: 'OPEN',
          });
          expect(a?.['rules_fired']).toContainEqual({
            code: 'FOREIGN_LICENSE_90D',
            version: 1,
            signal: 'BEYOND_90_DAYS',
          });

          // fin le 30/01 = 01/11 + 90 j : borne incluse, aucun signalement du permis
          const within = await book(
            tx,
            cc,
            w,
            tourist,
            await listing(tx, cc),
            '2027-01-27T15:00:00.000Z',
            LATER,
          );
          expect(within.outcome).toBe('DONE');
          const h2 = await holdRow(tx, within.hold_id);
          expect(h2).toMatchObject({ review_required: false });
          expect(new Date(h2['expires_at'] as Date).toISOString()).toBe(plus(LATER, HOLD_TTL_MIN));
          const rows = await riskRows(tx, within.hold_id);
          expect(rows.every((x) => !codes(x).includes('FOREIGN_LICENSE_90D'))).toBe(true);
          expect(rows.every((x) => x['queue'] === null)).toBe(true);
        });
      });

      it('permis étranger sans déclaration ⇒ revue (ENTRY_NOT_DECLARED : l’ops contrôle statut et date, UXQ-03) ; déclaration : date future ⇒ KYC_ENTRY_DATE_INVALID, touriste sans date ⇒ REQUEST_INVALID, sans session ⇒ AUTH_REQUIRED', async () => {
        await runLater(async (tx, w) => {
          await foreignReview(tx, cc, true);
          const silent = await guest(tx, cc, FOREIGN);
          const r = await book(
            tx,
            cc,
            w,
            silent,
            await listing(tx, cc),
            '2027-01-25T15:00:00.000Z',
            LATER,
          );
          expect(r.outcome).toBe('DONE');
          expect(await holdRow(tx, r.hold_id)).toMatchObject({ review_required: true });
          const [a] = await riskRows(tx, r.hold_id);
          expect(a?.['rules_fired']).toContainEqual({
            code: 'FOREIGN_LICENSE_90D',
            version: 1,
            signal: 'ENTRY_NOT_DECLARED',
          });

          const declare = async (hash: Buffer, residency: string, date: string | null) =>
            (
              await tx.query<{ outcome: string }>(
                'SELECT * FROM core.kyc_cmd_declare_entry($1, $2, $3, $4::date)',
                [hash, cc.country, residency, date],
              )
            ).rows[0]?.outcome;
          expect(await declare(silent.hash, 'TOURIST', '2027-01-22')).toBe(
            'KYC_ENTRY_DATE_INVALID',
          );
          expect(await declare(silent.hash, 'TOURIST', null)).toBe('REQUEST_INVALID');
          expect(await declare(Buffer.alloc(32), 'TOURIST', '2026-11-01')).toBe('AUTH_REQUIRED');
          expect(await declare(silent.hash, 'RESIDENT', null)).toBe('DONE');
          // résident à permis étranger ⇒ revue (16 VER-007), signal RESIDENT_FOREIGN_LICENSE
          const res = await book(
            tx,
            cc,
            w,
            silent,
            await listing(tx, cc),
            '2027-02-05T15:00:00.000Z',
            LATER,
          );
          expect(res.outcome).toBe('DONE');
          expect(await holdRow(tx, res.hold_id)).toMatchObject({ review_required: true });
          const [ra] = await riskRows(tx, res.hold_id);
          expect(ra?.['rules_fired']).toContainEqual({
            code: 'FOREIGN_LICENSE_90D',
            version: 1,
            signal: 'RESIDENT_FOREIGN_LICENSE',
          });
        });
      });

      it('paramètre pays foreign_license_review_enabled (DEC-FONDATEUR-22) : graine false ⇒ permis étranger sans déclaration jamais signalé, hold ordinaire ; true ⇒ revue avant le débit', async () => {
        await runLater(async (tx, w) => {
          const off = await guest(tx, cc, FOREIGN);
          const r = await book(
            tx,
            cc,
            w,
            off,
            await listing(tx, cc),
            '2027-01-25T15:00:00.000Z',
            LATER,
          );
          expect(r.outcome).toBe('DONE');
          expect(await holdRow(tx, r.hold_id)).toMatchObject({ review_required: false });
          const rows = await riskRows(tx, r.hold_id);
          expect(rows.every((x) => !codes(x).includes('FOREIGN_LICENSE_90D'))).toBe(true);

          await setClock(tx, plus(LATER, 1));
          await foreignReview(tx, cc, true);
          const on = await guest(tx, cc, FOREIGN);
          const r2 = await book(
            tx,
            cc,
            w,
            on,
            await listing(tx, cc),
            '2027-01-25T15:00:00.000Z',
            plus(LATER, 1),
          );
          expect(r2.outcome).toBe('DONE');
          expect(await holdRow(tx, r2.hold_id)).toMatchObject({ review_required: true });
          expect(codes((await riskRows(tx, r2.hold_id))[0])).toContain('FOREIGN_LICENSE_90D');
        });
      });

      it('date LOCALE de fin (16 VER-007) : fin le 31/01 à 02:00Z = 30/01 au soir dans le pays ⇒ aucun signalement (une date UTC signalerait)', async () => {
        await runLater(async (tx, w) => {
          await foreignReview(tx, cc, true);
          const tourist = await guest(tx, cc, FOREIGN);
          await tx.query('SELECT * FROM core.kyc_cmd_declare_entry($1, $2, $3, $4::date)', [
            tourist.hash,
            cc.country,
            'TOURIST',
            '2026-11-01',
          ]);
          // début 28/01 02:00Z, fin 31/01 02:00Z : le 30/01 au soir au Panama et au Paraguay
          const r = await book(
            tx,
            cc,
            w,
            tourist,
            await listing(tx, cc),
            '2027-01-28T02:00:00.000Z',
            LATER,
          );
          expect(r.outcome).toBe('DONE');
          const rows = await riskRows(tx, r.hold_id);
          expect(rows.every((x) => !codes(x).includes('FOREIGN_LICENSE_90D'))).toBe(true);
        });
      });
    });

    it('critère 4 : réservation signalée (compte de moins de 24 h et classe Premium, 16 ADM-029) et REVIEW_BEFORE_CHARGE ⇒ hold review_required de 120 min, aucune intention de paiement avant la décision (BOOKING_UNDER_REVIEW), évaluation en file', async () => {
      await run(async (tx, w) => {
        const p = await guest(tx, cc);
        const r = await book(tx, cc, w, p, await listing(tx, cc, 'PREMIUM'));
        expect(r.outcome).toBe('DONE');
        const h = await holdRow(tx, r.hold_id);
        expect(h).toMatchObject({ status: 'ACTIVE', review_required: true, reviewed_at: null });
        expect(new Date(h['expires_at'] as Date).toISOString()).toBe(plus(NOW, REVIEW_HOLD_MIN));

        const e = await startPayment(tx, p, r.hold_id);
        expect(e).toMatchObject({ code: '23514', constraint: 'hold_review_before_payment' });
        expect(translateDbError(e ?? {}).code).toBe('BOOKING_UNDER_REVIEW');
        expect(await paymentOperations(tx, r.hold_id)).toBe(0);

        const [a] = await riskRows(tx, r.hold_id);
        expect(a).toMatchObject({ decision: 'REVIEW', score: 50, queue: 'RISK_BOOKING' });
        expect(codes(a)).toEqual(['ACCOUNT_UNDER_24H', 'HIGH_VALUE_CLASS']);
      });
    });

    it('critère 4, branche PAY_THEN_REVIEW : même réservation signalée ⇒ hold ordinaire de 10 min, revue en file (portée par le trip)', async () => {
      await run(async (tx, w) => {
        await tx.query('SELECT test_fixture.us209_set_param($1, $2, NULL, $3::jsonb)', [
          'flagged_booking_payment_order',
          cc.country,
          '"PAY_THEN_REVIEW"',
        ]);
        const p = await guest(tx, cc);
        const r = await book(tx, cc, w, p, await listing(tx, cc, 'PREMIUM'));
        expect(r.outcome).toBe('DONE');
        const h = await holdRow(tx, r.hold_id);
        expect(h).toMatchObject({ status: 'ACTIVE', review_required: false });
        expect(new Date(h['expires_at'] as Date).toISOString()).toBe(plus(NOW, HOLD_TTL_MIN));
        const [a] = await riskRows(tx, r.hold_id);
        expect(a).toMatchObject({ decision: 'REVIEW', queue: 'RISK_BOOKING' });
      });
    });

    it('jamais plus lourd que Turo : une seule règle faible (compte récent, véhicule sans classe) ⇒ aucune revue, évaluation AUTO_OK hors file ; compte de plus de 24 h ⇒ aucune évaluation', async () => {
      await run(async (tx, w) => {
        const fresh = await guest(tx, cc);
        const r = await book(tx, cc, w, fresh, await listing(tx, cc));
        expect(r.outcome).toBe('DONE');
        expect(await holdRow(tx, r.hold_id)).toMatchObject({ review_required: false });
        const [a] = await riskRows(tx, r.hold_id);
        expect(a).toMatchObject({ decision: 'AUTO_OK', score: 25, queue: null });
        expect(codes(a)).toEqual(['ACCOUNT_UNDER_24H']);

        const old = await guest(tx, cc);
        const later = plus(NOW, 2 * 24 * 60);
        await setClock(tx, later);
        const r2 = await book(tx, cc, w, old, await listing(tx, cc), START, later);
        expect(r2.outcome).toBe('DONE');
        expect(await riskRows(tx, r2.hold_id)).toEqual([]);
      });
    });

    it('N-53, N-95, N-122 (L2-PM-21) : contrôles relus au démarrage du paiement ⇒ âge (paramètre relevé), consentement refusé, restriction : refus avant toute intention de paiement', async () => {
      await run(async (tx, w) => {
        const p = await guest(tx, cc);
        const r = await book(tx, cc, w, p, await listing(tx, cc));
        expect(r.outcome).toBe('DONE');
        expect(await holdRow(tx, r.hold_id)).toMatchObject({ review_required: false });

        await tx.query('SELECT test_fixture.us209_set_param($1, $2, NULL, $3::jsonb)', [
          'min_driver_age',
          cc.country,
          '99',
        ]);
        expect(await startPayment(tx, p, r.hold_id)).toMatchObject({
          code: '55000',
          constraint: 'hold_age_class_mismatch',
        });
        await tx.query('SELECT test_fixture.us209_refuse_biometric($1, $2)', [p.id, cc.country]);
        const consent = await startPayment(tx, p, r.hold_id);
        expect(consent).toMatchObject({ code: '55000', constraint: 'hold_kyc_consent_missing' });
        expect(translateDbError(consent ?? {}).code).toBe('KYC_BIOMETRIC_CONSENT_MISSING');
        await tx.query('SELECT test_fixture.us209_restrict($1)', [p.id]);
        const restricted = await startPayment(tx, p, r.hold_id);
        expect(restricted).toMatchObject({ code: '55000', constraint: 'hold_account_restricted' });
        expect(translateDbError(restricted ?? {}).code).toBe('ACCOUNT_RESTRICTED');
        expect(await paymentOperations(tx, r.hold_id)).toBe(0);
        expect(await holdRow(tx, r.hold_id)).toMatchObject({ status: 'ACTIVE' });
      });
    });

    it('N-53 (L2-PM-21) : restriction posée après la pose ⇒ la conversion n’est plus éligible (ACCOUNT_RESTRICTED : compensation, jamais un trip)', async () => {
      const api = await connectAs('app_api');
      const worker = await connectAs('app_worker');
      try {
        const guestId = uuid();
        const start = new Date(Date.parse(NOW) + 40 * DAY_MS).toISOString();
        const end = new Date(Date.parse(start) + DAY_MS).toISOString();
        const h = await inTx(api, { commit: true }, (tx) =>
          placeHold(tx, newSlot(start, end, 0), cc, guestId),
        );
        const eligibility = () =>
          inTx(worker, { worker: 'booking_conversion' }, async (tx) => {
            const q = await tx.query<{ r: string }>(
              'SELECT core.booking_conversion_eligibility($1) AS r',
              [h.holdId],
            );
            return q.rows[0]?.r;
          });
        expect(await eligibility()).not.toBe('ACCOUNT_RESTRICTED');
        await inTx(api, { commit: true }, (tx) =>
          tx.query('SELECT test_fixture.us209_restrict($1)', [guestId]),
        );
        expect(await eligibility()).toBe('ACCOUNT_RESTRICTED');
      } finally {
        await releaseClient(api);
        await releaseClient(worker);
      }
    });
  },
);

// ---------------------------------------------------------------------------------------------
// US-209, partie 209b (migration 0117, ADR-141) : décision motivée de l'ops sur une réservation
// signalée, hold de revue échu, dossier de la console, borne de la déclaration d'entrée.
// Attendus : 19 US-209 (critère 2 « la décision ops est motivée ») ; 17 §2.5 (« à l'approbation,
// une seule prolongation : expires_at = reviewed_at + hold_ttl_minutes, borne reviewed_at +
// hold_max_total_minutes » ; « revue refusée ou non faite dans le délai ⇒ RELEASED
// (REVIEW_REJECTED), aucun règlement, aucun débit » ; C20) ; 17 §7.2 (`hold_ttl_minutes` = 10,
// `hold_max_total_minutes` = 20) ; ADR-122 (jamais une action sur un sujet qui concerne l'agent).
// ---------------------------------------------------------------------------------------------

const REASON_OK = 'Permis et entrée vérifiés auprès du voyageur';
const REASON_KO = 'Pièces incohérentes avec la déclaration du voyageur';
const PURPOSE = 'Instruction de la réservation signalée assignée';
/** 17 §7.2 : `hold_max_total_minutes` = 20 (borne de la prolongation, au-delà du TTL). */
const HOLD_MAX_TOTAL_MIN = 20;

interface StaffSession {
  readonly userId: string;
  readonly hash: Buffer;
}

/**
 * Agent du staff élevé par TOTP à l'instant virtuel de la transaction (vraies commandes, comme
 * `staffAt` de l0-us218 : la base calcule le pas sur `platform.now()`). `userId` : un compte
 * existant (le voyageur lui-même, pour la garde ADR-122) ; sinon une personne nouvelle du pays.
 */
async function staffNow(
  tx: Tx,
  cc: CountryCase,
  role = 'OPS_AGENT',
  userId: string | null = null,
): Promise<StaffSession> {
  const id = userId ?? (await staffPerson(tx, cc.country)).userId;
  await tx.query(`SELECT test_fixture.iam_grant_staff_role($1, $2, $3, $4::text[], NULL, NULL)`, [
    uuid(),
    id,
    role,
    [cc.country],
  ]);
  const factorId = uuid();
  const codeHash = createHash('sha256')
    .update(randomBytes(9).toString('base64url'), 'utf8')
    .digest();
  await tx.query(
    `SELECT test_fixture.iam_insert_pending_totp($1, $2, 'fake-vault:test-secret', $3, 86400)`,
    [factorId, id, codeHash],
  );
  const hash = await login(tx, id);
  const reveal = await tx.query<{ outcome: string }>(
    'SELECT outcome FROM core.iam_staff_cmd_enroll_reveal($1, $2)',
    [hash, codeHash],
  );
  if (reveal.rows[0]?.outcome !== 'OK') throw new Error('enrôlement refusé');
  const now = await tx.query<{ ms: string }>(
    'SELECT (extract(epoch FROM platform.now()) * 1000)::bigint::text AS ms',
  );
  const step = Math.floor(Number(now.rows[0]?.ms) / 1000 / 30);
  if ((await elevate(tx, hash, factorId, step)) !== 'ENROLLED') {
    throw new Error('élévation refusée');
  }
  return { userId: id, hash };
}

type Review = Row & {
  readonly assessment_id: string | null;
  readonly item_id: string | null;
  readonly item_status: string | null;
};

async function review(tx: Tx, holdId: string | null): Promise<Review> {
  const r = (await tx.query<Review>('SELECT * FROM test_fixture.us209b_review($1)', [holdId])).rows;
  if (!r[0]) throw new Error('hold introuvable');
  return r[0];
}

const claimItem = async (tx: Tx, s: StaffSession, itemId: string | null) =>
  (
    await tx.query<{ outcome: string }>('SELECT * FROM core.support_staff_claim_item($1, $2, $3)', [
      s.hash,
      uuid(),
      itemId,
    ])
  ).rows[0]?.outcome;

interface ActionRow {
  readonly outcome: string;
  readonly action_id: string | null;
  readonly domain_ref: string | null;
  readonly detail: string | null;
}

const MANUAL_ACTION =
  'SELECT * FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, $6::jsonb, $7::uuid[])';

/** Action de console REVIEW_FLAGGED_BOOKING (cadre d'US-101), sans pièce. */
async function decide(
  tx: Tx,
  s: StaffSession,
  assessmentId: string | null,
  decision: string,
  reason = REASON_OK,
  requestId = uuid(),
): Promise<ActionRow> {
  const r = await tx.query<ActionRow>(MANUAL_ACTION, [
    s.hash,
    requestId,
    'REVIEW_FLAGGED_BOOKING',
    assessmentId,
    reason,
    JSON.stringify({ decision }),
    [],
  ]);
  if (!r.rows[0]) throw new Error('aucune issue');
  return r.rows[0];
}

const dossier = async (tx: Tx, s: StaffSession, itemId: string | null) =>
  (
    await tx.query<{ outcome: string; body: Record<string, unknown> | null }>(
      'SELECT * FROM core.support_staff_booking_review($1, $2, $3, $4)',
      [s.hash, uuid(), itemId, PURPOSE],
    )
  ).rows[0];

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(v as string).toISOString();

async function holdEvents(tx: Tx, holdId: string | null): Promise<Row[]> {
  return (await tx.query<Row>('SELECT * FROM test_fixture.us209b_events($1)', [holdId])).rows;
}

describe.each(COUNTRIES.map((c) => [c.country, c] as const))(
  'US-209b décision de l’ops sur une réservation signalée (%s)',
  (_name, cc) => {
    const run = scenario(cc);

    /** Réservation signalée (compte de moins de 24 h et Premium, 16 ADM-029) : hold de revue. */
    async function flagged(tx: Tx, w: World, listingId?: string) {
      const p = await guest(tx, cc);
      const id = listingId ?? (await listing(tx, cc, 'PREMIUM'));
      const r = await book(tx, cc, w, p, id);
      expect(r.outcome).toBe('DONE');
      const rv = await review(tx, r.hold_id);
      expect(rv).toMatchObject({ item_status: 'OPEN', decision: 'REVIEW' });
      return { p, holdId: r.hold_id, listingId: id, rv };
    }

    it('critère 2 (fin) : ADR-122 lève le conflit présumé (un agent neutre prend l’élément) ; APPROVED motivé ⇒ reviewed_at, UNE prolongation (hold_ttl_minutes depuis la décision, ≤ hold_max_total_minutes), occupation prolongée, élément DONE, évaluation décidée, motif et auteur journalisés, événement sans donnée personnelle ; seconde décision refusée', async () => {
      await run(async (tx, w) => {
        const f = await flagged(tx, w);
        const ops = await staffNow(tx, cc);
        expect(await claimItem(tx, ops, f.rv.item_id)).toBe('CLAIMED');
        const requestId = uuid();
        const r = await decide(tx, ops, f.rv.assessment_id, 'APPROVED', REASON_OK, requestId);
        expect(r).toMatchObject({ outcome: 'DONE', action_id: requestId, domain_ref: f.holdId });

        const h = await holdRow(tx, f.holdId);
        expect(h).toMatchObject({ status: 'ACTIVE', review_required: true });
        expect(iso(h['reviewed_at'])).toBe(NOW);
        expect(iso(h['expires_at'])).toBe(plus(NOW, HOLD_TTL_MIN));
        expect(HOLD_TTL_MIN).toBeLessThanOrEqual(HOLD_MAX_TOTAL_MIN);
        const rv = await review(tx, f.holdId);
        expect(rv).toMatchObject({
          item_status: 'DONE',
          item_decision: 'APPROVED',
          reviewed_by: ops.userId,
          occupancy_active: true,
        });
        expect(iso(rv['decided_at'])).toBe(NOW);
        expect(iso(rv['occupancy_expires_at'])).toBe(plus(NOW, HOLD_TTL_MIN));
        const m = (
          await tx.query<Row>('SELECT * FROM test_fixture.us209b_manual_action($1)', [requestId])
        ).rows[0];
        expect(m).toMatchObject({
          action_code: 'REVIEW_FLAGGED_BOOKING',
          subject_type: 'RISK_ASSESSMENT',
          subject_id: f.rv.assessment_id,
          country_code: cc.country,
          actor_user_id: ops.userId,
          reason: REASON_OK,
          input: { decision: 'APPROVED' },
          outcome: 'DONE',
          domain_ref: f.holdId,
          audit_linked: true,
        });
        expect((await auditOf(tx, ops.userId)).at(-1)).toMatchObject({
          action_code: 'MANUAL_ACTION_DONE',
          reason: REASON_OK,
        });
        const [e] = (await holdEvents(tx, f.holdId)).filter(
          (x) => x['type'] === 'booking.hold.review_decided',
        );
        expect(e).toMatchObject({ actor_user_id: ops.userId, actor_role: 'OPS_AGENT' });
        expect(e?.['payload']).toMatchObject({ hold_id: f.holdId, decision: 'APPROVED' });
        expect(Object.keys(e?.['payload'] as object).sort()).toEqual(
          ['decision', 'expires_at', 'hold_id', 'org_id', 'released', 'vehicle_id'].sort(),
        );

        // une seule décision : nouvelle demande refusée, rien ne bouge (prolongation unique)
        const again = await decide(tx, ops, f.rv.assessment_id, 'REJECTED', REASON_KO);
        expect(again).toMatchObject({ outcome: 'REFUSED', detail: 'ALREADY_DECIDED' });
        expect(iso((await holdRow(tx, f.holdId))['expires_at'])).toBe(plus(NOW, HOLD_TTL_MIN));
        // même request_id : DUPLICATE (idempotence du cadre d'US-101)
        expect(
          (await decide(tx, ops, f.rv.assessment_id, 'APPROVED', REASON_OK, requestId)).outcome,
        ).toBe('DUPLICATE');
      });
    });

    it('après l’approbation, le paiement reprend par le chemin d’US-223 (REVIEW_BEFORE_CHARGE) : avant la décision BOOKING_UNDER_REVIEW ; après, NEW_ORDER au total du devis engagé ; aucun trip sans preuve du PSP', async () => {
      await run(async (tx, w) => {
        await tx.query('SELECT test_fixture.us024_psp_account($1)', [cc.country]);
        const { rows } = await tx.query<{ capability: string; kind: string }>(
          `SELECT capability, kind FROM core.payment_psp_capability_catalog WHERE blocking <> 'NO'`,
        );
        for (const c of rows) {
          const value = c.kind === 'bool' ? true : c.kind === 'int' ? 1 : 'FAKE_HMAC_SHA256';
          await tx.query(
            `SELECT test_fixture.us024_set_capability('FAKE', $1, '*', $2, $3::jsonb, $4, $5::timestamptz)`,
            [cc.country, c.capability, JSON.stringify(value), 'VALIDATED_SANDBOX', plus(NOW, -3)],
          );
        }
        const f = await flagged(tx, w);
        const before = await failure(tx, 'SELECT core.booking_cmd_checkout_pay($1, $2, $3)', [
          f.p.hash,
          f.holdId,
          'CARD',
        ]);
        expect(before).toMatchObject({ code: '23514', constraint: 'hold_review_before_payment' });
        expect(translateDbError(before ?? {}).code).toBe('BOOKING_UNDER_REVIEW');
        expect(await paymentOperations(tx, f.holdId)).toBe(0);

        const ops = await staffNow(tx, cc);
        expect(await claimItem(tx, ops, f.rv.item_id)).toBe('CLAIMED');
        expect((await decide(tx, ops, f.rv.assessment_id, 'APPROVED')).outcome).toBe('DONE');
        const r = await tx.query<{ r: Record<string, unknown> }>(
          'SELECT core.booking_cmd_checkout_pay($1, $2, $3) AS r',
          [f.p.hash, f.holdId, 'CARD'],
        );
        expect(r.rows[0]?.r).toMatchObject({
          outcome: 'NEW_ORDER',
          amountMinor: String(VECTORS[cc.country]!.total),
          currency: cc.currency,
          holdId: f.holdId,
        });
        // opération de paiement invisible à app_api (US-223) : l'état du hold en témoigne
        expect(await holdRow(tx, f.holdId)).toMatchObject({ status: 'PAYMENT_IN_FLIGHT' });
        // la conversion exige toujours la preuve signée du PSP (US-223a) : aucun trip ici
        expect((await holdEvents(tx, f.holdId)).map((x) => x['type'])).not.toContain(
          'booking.trip.booked',
        );
      });
    });

    it('REJECTED motivé ⇒ RELEASED / REVIEW_REJECTED, occupation libérée (créneau de nouveau réservable), aucun paiement possible, aucun débit', async () => {
      await run(async (tx, w) => {
        const f = await flagged(tx, w);
        const ops = await staffNow(tx, cc);
        expect(await claimItem(tx, ops, f.rv.item_id)).toBe('CLAIMED');
        expect(await decide(tx, ops, f.rv.assessment_id, 'REJECTED', REASON_KO)).toMatchObject({
          outcome: 'DONE',
          domain_ref: f.holdId,
        });
        expect(await holdRow(tx, f.holdId)).toMatchObject({ status: 'RELEASED' });
        expect(await review(tx, f.holdId)).toMatchObject({
          release_reason: 'REVIEW_REJECTED',
          released_by: ops.userId,
          occupancy_active: false,
          deactivated_reason: 'HOLD_RELEASED',
          item_status: 'DONE',
          item_decision: 'REJECTED',
          reviewed_by: ops.userId,
        });
        expect(await startPayment(tx, f.p, f.holdId)).not.toBeNull();
        expect(await paymentOperations(tx, f.holdId)).toBe(0);
        // créneau libéré : un autre voyageur réserve les mêmes dates
        const other = await guest(tx, cc);
        expect((await book(tx, cc, w, other, f.listingId)).outcome).toBe('DONE');
      });
    });

    it('hold de revue non revu dans le délai (17 §2.5) ⇒ RELEASED / REVIEW_REJECTED (jamais EXPIRED), sans débit, élément de file clos CANCELLED ; une décision tardive est refusée', async () => {
      await run(async (tx, w) => {
        const f = await flagged(tx, w);
        const ops = await staffNow(tx, cc);
        expect(await claimItem(tx, ops, f.rv.item_id)).toBe('CLAIMED');
        const late = plus(NOW, REVIEW_HOLD_MIN + 1);
        await setClock(tx, late);
        const ops2 = await staffNow(tx, cc);
        // l'élément est pris par le premier agent : le second n'en est pas le preneur
        expect((await decide(tx, ops2, f.rv.assessment_id, 'APPROVED')).detail).toBe(
          'ITEM_NOT_CLAIMED',
        );
        // l'expiration ciblée de la pose suivante sur le véhicule (2a, texte EXPIRY_2A_SQL
        // inchangé) sort le hold de revue échu : RELEASED / REVIEW_REJECTED
        const other = await guest(tx, cc);
        expect((await book(tx, cc, w, other, f.listingId, START, late)).outcome).toBe('DONE');
        expect(await holdRow(tx, f.holdId)).toMatchObject({
          status: 'RELEASED',
          reviewed_at: null,
        });
        const rv = await review(tx, f.holdId);
        expect(rv).toMatchObject({
          release_reason: 'REVIEW_REJECTED',
          expired_at: null,
          occupancy_active: false,
          item_status: 'CANCELLED',
          item_decision: 'HOLD_RELEASED',
          decided_at: null,
        });
        expect(iso(rv['released_at'])).toBe(late);
        expect(await paymentOperations(tx, f.holdId)).toBe(0);
        expect((await decide(tx, ops, f.rv.assessment_id, 'REJECTED', REASON_KO)).detail).toBe(
          'ITEM_NOT_CLAIMED',
        );
      });
    });

    it('APPROVED d’un hold dont le début prévu est passé (C20) ⇒ START_PASSED, rien d’écrit ; voyageur devenu inéligible ⇒ GUEST_INELIGIBLE, le refus reste possible', async () => {
      await run(async (tx, w) => {
        // départ dans 1 h 30 (préavis de l'hôte à 1 h) et compte récent : 50, revue (120 min)
        const soon = plus(NOW, 90);
        const p = await guest(tx, cc);
        const r = await book(tx, cc, w, p, await listing(tx, cc, null, 60), soon);
        expect(r.outcome).toBe('DONE');
        const rv = await review(tx, r.hold_id);
        expect(rv.item_status).toBe('OPEN');
        const f = await flagged(tx, w);
        await tx.query('SELECT test_fixture.us209_restrict($1)', [f.p.id]);

        // le début prévu est passé, l'échéance du hold de revue (NOW + 120 min) ne l'est pas
        await setClock(tx, plus(NOW, 91));
        const ops = await staffNow(tx, cc);
        expect(await claimItem(tx, ops, rv.item_id)).toBe('CLAIMED');
        expect((await decide(tx, ops, rv.assessment_id, 'APPROVED')).detail).toBe('START_PASSED');
        expect(await holdRow(tx, r.hold_id)).toMatchObject({ status: 'ACTIVE', reviewed_at: null });
        expect(await review(tx, r.hold_id)).toMatchObject({ item_status: 'IN_REVIEW' });

        expect(await claimItem(tx, ops, f.rv.item_id)).toBe('CLAIMED');
        expect((await decide(tx, ops, f.rv.assessment_id, 'APPROVED')).detail).toBe(
          'GUEST_INELIGIBLE',
        );
        expect(await holdRow(tx, f.holdId)).toMatchObject({ reviewed_at: null });
        expect((await decide(tx, ops, f.rv.assessment_id, 'REJECTED', REASON_KO)).outcome).toBe(
          'DONE',
        );
      });
    });

    it('séparation des tâches (ADR-122) : le voyageur devenu agent ⇒ SELF_FORBIDDEN à la prise, au dossier et à la décision ; agent sans prise ⇒ ITEM_NOT_CLAIMED ; FINANCE ⇒ FORBIDDEN ; décision hors énumération ⇒ 22023 ; rien d’écrit', async () => {
      await run(async (tx, w) => {
        const f = await flagged(tx, w);
        const self = await staffNow(tx, cc, 'OPS_AGENT', f.p.id);
        expect(await claimItem(tx, self, f.rv.item_id)).toBe('SELF_FORBIDDEN');
        expect((await dossier(tx, self, f.rv.item_id))?.outcome).toBe('SELF_FORBIDDEN');
        expect(await decide(tx, self, f.rv.assessment_id, 'APPROVED')).toMatchObject({
          outcome: 'REFUSED',
          detail: 'SELF_FORBIDDEN',
        });
        const ops = await staffNow(tx, cc);
        expect((await decide(tx, ops, f.rv.assessment_id, 'APPROVED')).detail).toBe(
          'ITEM_NOT_CLAIMED',
        );
        const finance = await staffNow(tx, cc, 'FINANCE');
        expect((await decide(tx, finance, f.rv.assessment_id, 'APPROVED')).outcome).toBe(
          'FORBIDDEN',
        );
        expect(
          await failure(tx, MANUAL_ACTION, [
            ops.hash,
            uuid(),
            'REVIEW_FLAGGED_BOOKING',
            f.rv.assessment_id,
            REASON_OK,
            JSON.stringify({ decision: 'MAYBE' }),
            [],
          ]),
        ).toMatchObject({ code: '22023' });
        expect(await holdRow(tx, f.holdId)).toMatchObject({ status: 'ACTIVE', reviewed_at: null });
        expect(await review(tx, f.holdId)).toMatchObject({ item_status: 'OPEN', decided_at: null });
      });
    });

    it('dossier de la console (O01) : élément pris en charge ⇒ règles, score, état et échéance du hold, période, déclaration d’entrée, accès journalisé AVANT la lecture ; élément non pris ⇒ CASE_REQUIRED', async () => {
      await run(async (tx, w) => {
        const f = await flagged(tx, w);
        const declared = await tx.query<{ outcome: string }>(
          'SELECT * FROM core.kyc_cmd_declare_entry($1, $2, $3, $4::date)',
          [f.p.hash, cc.country, 'TOURIST', '2026-11-20'],
        );
        expect(declared.rows[0]?.outcome).toBe('DONE');
        const ops = await staffNow(tx, cc);
        expect((await dossier(tx, ops, f.rv.item_id))?.outcome).toBe('CASE_REQUIRED');
        expect(await claimItem(tx, ops, f.rv.item_id)).toBe('CLAIMED');
        const d = await dossier(tx, ops, f.rv.item_id);
        expect(d?.outcome).toBe('GRANTED');
        expect(d?.body).toMatchObject({
          itemId: f.rv.item_id,
          assessmentId: f.rv.assessment_id,
          holdId: f.holdId,
          guestUserId: f.p.id,
          country: cc.country,
          score: 50,
          holdStatus: 'ACTIVE',
          reviewBeforeCharge: true,
          reviewedAt: null,
          itemStatus: 'IN_REVIEW',
          entryDeclaration: { residencyStatus: 'TOURIST', entryDate: '2026-11-20' },
        });
        expect(iso(d?.body?.['expiresAt'])).toBe(plus(NOW, REVIEW_HOLD_MIN));
        expect(iso(d?.body?.['startsAt'])).toBe(START);
        expect(
          ((d?.body?.['rulesFired'] ?? []) as { code: string }[]).map((x) => x.code).sort(),
        ).toEqual(['ACCOUNT_UNDER_24H', 'HIGH_VALUE_CLASS']);
        expect((await auditOf(tx, ops.userId)).at(-1)).toMatchObject({
          action_code: 'STAFF_DATA_ACCESS',
          subject_type: 'RISK_ASSESSMENT',
          reason: PURPOSE,
          after: { access_kind: 'READ_C2_SUPPORT', field_or_file: 'booking_review' },
        });
      });
    });

    it('branche PAY_THEN_REVIEW : APPROVED ⇒ décision enregistrée, hold inchangé (aucune revue avant le débit) ; REJECTED d’un hold encore ACTIVE ⇒ RELEASED / REVIEW_REJECTED', async () => {
      await run(async (tx, w) => {
        await tx.query('SELECT test_fixture.us209_set_param($1, $2, NULL, $3::jsonb)', [
          'flagged_booking_payment_order',
          cc.country,
          '"PAY_THEN_REVIEW"',
        ]);
        const a = await flagged(tx, w);
        const b = await flagged(tx, w);
        const h0 = await holdRow(tx, a.holdId);
        expect(h0).toMatchObject({ review_required: false });
        const ops = await staffNow(tx, cc);
        expect(await claimItem(tx, ops, a.rv.item_id)).toBe('CLAIMED');
        expect((await decide(tx, ops, a.rv.assessment_id, 'APPROVED')).outcome).toBe('DONE');
        const h1 = await holdRow(tx, a.holdId);
        expect(h1).toMatchObject({ status: 'ACTIVE', reviewed_at: null });
        expect(iso(h1['expires_at'])).toBe(iso(h0['expires_at']));
        expect(await review(tx, a.holdId)).toMatchObject({
          item_status: 'DONE',
          reviewed_by: ops.userId,
        });

        expect(await claimItem(tx, ops, b.rv.item_id)).toBe('CLAIMED');
        expect((await decide(tx, ops, b.rv.assessment_id, 'REJECTED', REASON_KO)).outcome).toBe(
          'DONE',
        );
        expect(await review(tx, b.holdId)).toMatchObject({
          release_reason: 'REVIEW_REJECTED',
          occupancy_active: false,
        });
      });
    });

    it('déclaration d’entrée bornée (N-172) : 5 déclarations en une heure ⇒ la 6ᵉ RATE_LIMITED, rien d’écrit ; une heure après la première ⇒ DONE', async () => {
      await run(async (tx) => {
        const p = await guest(tx, cc);
        const declare = async () =>
          (
            await tx.query<{ outcome: string }>(
              'SELECT * FROM core.kyc_cmd_declare_entry($1, $2, $3, $4::date)',
              [p.hash, cc.country, 'TOURIST', '2026-11-20'],
            )
          ).rows[0]?.outcome;
        for (let i = 0; i < 5; i += 1) expect(await declare()).toBe('DONE');
        expect(await declare()).toBe('RATE_LIMITED');
        await setClock(tx, plus(NOW, 59));
        expect(await declare()).toBe('RATE_LIMITED');
        await setClock(tx, plus(NOW, 60));
        expect(await declare()).toBe('DONE');
      });
    });
  },
);

describe('US-209b rôles', () => {
  it('commande liée, dossier et déclaration lus par la console : aucun rôle applicatif ; dossier de la console : app_api seul', async () => {
    for (const role of ['app_api', 'app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        await expect(
          client.query(
            'SELECT * FROM core.booking_manual_action_review_flagged($1, $2, $3, $4, $5::jsonb, $6, $7, $8)',
            [
              Buffer.alloc(32),
              uuid(),
              'REVIEW_FLAGGED_BOOKING',
              uuid(),
              '{"decision":"APPROVED"}',
              REASON_OK,
              uuid(),
              'OPS_AGENT',
            ],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          client.query('SELECT core.booking_staff_review_dossier($1)', [uuid()]),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          client.query('SELECT core.kyc_staff_entry_declaration($1, $2)', [
            uuid(),
            COUNTRIES[0].country,
          ]),
        ).rejects.toMatchObject({ code: '42501' });
        if (role !== 'app_api') {
          await expect(
            client.query('SELECT * FROM core.support_staff_booking_review($1, $2, $3, $4)', [
              Buffer.alloc(32),
              uuid(),
              uuid(),
              PURPOSE,
            ]),
          ).rejects.toMatchObject({ code: '42501' });
        }
      });
    }
  });
});

describe('US-209 rôles', () => {
  it('éligibilité du conducteur et aides du checkout : aucun rôle applicatif ; déclaration d’entrée : app_api seul', async () => {
    for (const role of ['app_api', 'app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        await expect(
          client.query('SELECT * FROM core.kyc_checkout_driver($1, $2, $3, $4, 21)', [
            uuid(),
            NOW,
            START,
            COUNTRIES[0].country,
          ]),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          client.query('SELECT core.booking_guest_eligibility($1)', [uuid()]),
        ).rejects.toMatchObject({ code: '42501' });
        if (role !== 'app_api') {
          await expect(
            client.query("SELECT * FROM core.kyc_cmd_declare_entry($1, $2, 'RESIDENT', NULL)", [
              Buffer.alloc(32),
              COUNTRIES[0].country,
            ]),
          ).rejects.toMatchObject({ code: '42501' });
        }
        await expect(
          client.query('SELECT 1 FROM core.kyc_entry_declaration'),
        ).rejects.toMatchObject({ code: '42501' });
      });
    }
  });
});
