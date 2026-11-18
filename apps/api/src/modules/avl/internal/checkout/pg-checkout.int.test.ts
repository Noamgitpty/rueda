/**
 * test:int — checkout de bout en bout sur la base jetable du banc de @rueda/db, sous app_api
 * (assertion L0-05 par connectAs) : `CheckoutService` + VRAIS `PgQuoteStore` et `PgCheckoutStore`
 * + instantané de la configuration du dépôt (`QuoteService`, comme `main.ts`) + commandes de 0108
 * et 0110 (revues argent et sécurité d'US-226a, constat 1 : la lecture du devis par le magasin réel
 * n'était couverte que par des doubles).
 *
 * Dans une transaction ANNULÉE : interrupteurs `p2p_private_hosts_enabled` et
 * `insurer_contract_active` ouverts par la VRAIE procédure à deux personnes d'US-125 ; voyageur
 * inscrit et session ouverte par les vraies commandes ; annonce LISTED de la fixture 9998.
 *
 * Attendus (jamais le code testé), configuration du dépôt (grille de protection et parts de
 * l'assureur de TEST, barème du trip fee du pays) :
 * - exposant 2 (trip A de 08 : 40,00 × 3 j) : P 120,00 ; F 18,00 (15 %) ; taxe 9,66 (TJ01) ;
 *   protection BASICA 30,00 (1/4, la protection du trip A) ; total 177,66 ; prime 21,00 (TJ01) ;
 * - exposant 0 (D2 de 08 : 333 334 × 3 j) : P 1 000 002 ; F 150 000 ; taxe 100 000 + 15 000 ;
 *   protection BASICA roundHalfUp(83 333,5) = 83 334 × 3 = 250 002 ; total 1 515 004 ;
 *   prime roundHalfUp(175 001,4) = 175 001 ;
 * - TOTAL refusé sans âge déclaré (16 PRT-002, dès 21 ans dans la grille de test) ;
 * - total de la carte et de la fiche (pricer de la recherche, protection minimale) égal au total du
 *   checkout, au même instant (16 SRC-042, N-141 ; US-226 partie 226b).
 * Aucun code de pays ni de devise n'est écrit ici : ils sont lus des données (ADR-024).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setSessionContext } from '@rueda/db';
import { connectAs, releaseClient } from '@rueda/db/testing';
// types du contexte fourni par le globalSetup du banc (inject('ruedaBench'))
import type {} from '@rueda/db/testing/global-setup';
import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countryCases } from '../../../../../test/support/countries.js';
import { PgHostListingStore, PgSearchStore } from '../../../cat/index.js';
import { CountryConfigService } from '../../../cfg/index.js';
import {
  PgQuoteStore,
  QuoteHttpError,
  QuoteService,
  searchQuotePricer,
} from '../../../prc/index.js';
import { CheckoutService, LOG_CHECKOUT_FAILURE } from './checkout.service.js';
import { PgCheckoutStore } from './store.js';

const NOW = '2026-12-01T12:00:00.000Z';
const START = '2026-12-10T10:00:00.000Z';
const END = '2026-12-13T10:00:00.000Z';
const SIGNUP = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const PHC =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';

interface Expected {
  readonly daily: string;
  readonly lines: Readonly<Record<string, string>>;
  readonly total: string;
  /**
   * US-205b : retenue d'une annulation hors fenêtre (08 BR-CXL-06, 3 jours ⇒ j = 1) : P / 3 + F / 3
   * et la taxe retenue au prorata de la base taxable remboursée, protection remboursée en entier.
   */
  readonly retained: string;
}

/** Attendus par exposant de la devise du pays (voir l'en-tête). */
const EXPECTED: Readonly<Record<number, Expected>> = {
  2: {
    daily: '4000',
    lines: { TRIP_PRICE: '12000', TRIP_FEE: '1800', PROTECTION: '3000' },
    total: '17766',
    // 40,00 + 6,00 + (9,66 − roundHalfUp(9,66 × 92,00 / 138,00) = 3,22) = 49,22
    retained: '4922',
  },
  0: {
    daily: '333334',
    lines: { TRIP_PRICE: '1000002', TRIP_FEE: '150000', PROTECTION: '250002' },
    total: '1515004',
    // 333 334 + 50 000 + (115 000 − roundHalfUp(115 000 × 766 668 / 1 150 002) = 38 333) = 421 667
    retained: '421667',
  },
};

const sha = (): Buffer => createHash('sha256').update(randomBytes(32)).digest();

let client: pg.Client;

beforeEach(async () => {
  client = await connectAs('app_api');
  await client.query('BEGIN');
  await client.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [NOW]);
});

afterEach(async () => {
  await client.query('ROLLBACK');
  await releaseClient(client);
});

async function register(country: string, first = 'Ana', last = 'Pérez'): Promise<string> {
  const id = randomUUID();
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, $4, $5, 'es', $6, $7, 86400, NULL,
                                                $8, $9::jsonb, false) AS ok`,
    [
      id,
      `int226-${id}@example.test`,
      PHC,
      first,
      last,
      randomUUID(),
      randomBytes(32),
      country,
      SIGNUP,
    ],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await client.query('SELECT test_fixture.iam_set_account_status($1, $2)', [id, 'ACTIVE']);
  return id;
}

async function staff(role: string, country: string): Promise<{ id: string; hash: Buffer }> {
  const id = await register(country, 'Staff', 'Test');
  await client.query(
    `SELECT test_fixture.iam_grant_staff_role($1, $2, $3, $4::text[], NULL, NULL)`,
    [randomUUID(), id, role, [country]],
  );
  const hash = sha();
  await client.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [id, hash]);
  return { id, hash };
}

/** Interrupteur ouvert par la procédure à deux personnes d'US-125 (transaction annulée). */
async function openSwitch(key: string, country: string): Promise<void> {
  const as = async (who: { id: string; hash: Buffer }) =>
    setSessionContext(client, {
      kind: 'STAFF',
      actorId: who.id,
      countryScope: [country],
      sessionTokenHash: who.hash.toString('hex'),
    });
  const requester = await staff('ADMIN', country);
  const approver = await staff('SUPERADMIN', country);
  // tête de chaîne d'audit AVANT le verrou consultatif de la commande (fixture 9957) : même ordre
  // que test/support/golive.ts, jamais l'ordre inverse d'une autre transaction (40P01)
  await client.query('SELECT test_fixture.audit_chain_head_lock()');
  await as(requester);
  const r = await client.query<{ outcome: string; request_id: string | null }>(
    'SELECT outcome, request_id FROM core.config_cmd_request_go_live_switch($1, $2, $3, $4, $5, $6)',
    [requester.hash, randomUUID(), key, country, true, 'DEC-FONDATEUR-15'],
  );
  if (r.rows[0]?.outcome !== 'REQUESTED') throw new Error(`demande : ${r.rows[0]?.outcome}`);
  await as(approver);
  const a = await client.query<{ outcome: string }>(
    'SELECT outcome FROM core.config_cmd_approve_go_live_switch($1, $2)',
    [approver.hash, r.rows[0].request_id],
  );
  if (a.rows[0]?.outcome !== 'APPLIED') throw new Error(`approbation : ${a.rows[0]?.outcome}`);
}

async function guestSession(country: string): Promise<Buffer> {
  const id = await register(country);
  const hash = sha();
  const s = await client.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, 86400, 'NONE', NULL, 'vitest') AS expires_at`,
    [randomUUID(), id, hash],
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  // US-209 (16 BKG-012) : conducteur vérifié, majeur, permis du pays valable (fixture 9967)
  await client.query('SELECT test_fixture.us209_driver($1, $2, $3::date, $4::date, $5)', [
    id,
    country,
    '1990-01-01',
    '2030-12-31',
    country,
  ]);
  return hash;
}

/**
 * Plaque unique par construction (BOARD N-186) : `letter` puis 8 chiffres hexadécimaux du compteur
 * de test de la base (fixture 9999), au lieu d'un tirage au hasard exposé à
 * `catalog_vehicle_plate_unique` sur une base partagée par tous les fichiers.
 */
async function uniquePlate(db: pg.ClientBase, letter: string): Promise<string> {
  const { rows } = await db.query<{ n: string }>(
    'SELECT test_fixture.next_unique_serial()::text AS n',
  );
  const n = rows[0]?.n;
  if (n === undefined) throw new Error('compteur unique de test indisponible (fixture 9999)');
  const hex = BigInt(n).toString(16).toUpperCase();
  if (hex.length > 8) throw new Error(`compteur unique de test hors de 8 chiffres : ${hex}`);
  return `${letter}${hex.padStart(8, '0')}`;
}

describe.each(countryCases())(
  'checkout réel, devis avec protection ($country, $currency)',
  (cc) => {
    it('gel puis lecture par les vrais magasins : ligne PROTECTION rejouée, niveau BASICA présélectionné, interrupteur et niveaux proposés ; hold posé ; TOTAL sans âge refusé', async () => {
      const service = new QuoteService(new CountryConfigService());
      const exponent = service.params({ country: cc.country, at: new Date(NOW) }).currency.exponent;
      const want = EXPECTED[exponent];
      if (want === undefined) throw new Error(`aucun attendu pour l'exposant ${exponent}`);
      await openSwitch('p2p_private_hosts_enabled', cc.country);
      await openSwitch('insurer_contract_active', cc.country);
      const { rows } = await client.query<{ listing_id: string }>(
        'SELECT * FROM test_fixture.us208_listed_listing($1, $2, $3, $4)',
        [cc.country, want.daily, 'AUTOMATIC', true],
      );
      const listingId = rows[0]!.listing_id;
      const guest = await guestSession(cc.country);
      const checkout = new CheckoutService(
        (ctx) => service.params(ctx),
        new PgQuoteStore(client),
        new PgCheckoutStore(client),
        LOG_CHECKOUT_FAILURE,
        (ctx) => service.cancellationParams(ctx),
      );

      const created = await checkout.createQuote(guest, { listingId, startAt: START, endAt: END });
      expect(created.protectionLevel).toBe('BASICA');
      expect(created.driverAge).toBeNull();
      expect(created.insurerContractActive).toBe(true);
      expect(Object.fromEntries(created.lines.map((l) => [l.type, l.amountMinor]))).toEqual(
        want.lines,
      );
      expect(created.totalMinor).toBe(want.total);
      expect(created.protectionOptions.map((o) => [o.level, o.eligible, o.selected])).toEqual([
        ['BASICA', true, true],
        ['ESTANDAR', true, false],
        ['TOTAL', false, false],
      ]);
      expect(created.protectionOptions[0]?.lineMinor).toBe(want.lines['PROTECTION']);

      // US-205b : distance de l'annonce figée (fixture illimitée), annulation gratuite de la base
      // (départ dans plus de 25 h : départ − 24 h) et retenue hors fenêtre du moteur de règlement
      // sur le devis rejoué (3 jours ⇒ j = 1, 08 BR-CXL-06)
      expect(created.mileage).toEqual({
        mode: 'UNLIMITED',
        includedKm: null,
        extraKmPriceMinor: null,
      });
      expect(created.cancellation).toMatchObject({ lastMinute: false, endsAtStart: false });
      expect(Date.parse(created.cancellation?.freeUntil ?? '')).toBe(
        Date.parse(START) - 24 * 3_600_000,
      );
      expect(created.lateCancellation).toEqual({ penaltyDays: '1', retainedMinor: want.retained });

      const read = await checkout.quote(guest, created.quoteId);
      expect(read).toEqual(created);

      // N-141 / 16 SRC-042 : même total sur la carte de résultats, la fiche et le checkout, au même
      // instant (revue argent de 226a, n° 7) ; la fiche lit l'annonce par le vrai magasin de la
      // recherche, la carte passe par le même pricer avec le prix de l'annonce
      const pricer = searchQuotePricer((ctx) => service.params(ctx));
      const slot = await new PgSearchStore(client).listingPrice(listingId);
      if (slot === null) throw new Error('prix de la fiche introuvable');
      const fiche = pricer.price({
        listingId,
        country: cc.country,
        currency: slot.currency,
        dailyPriceMinor: slot.dailyPriceMinor,
        startAt: START,
        endAt: END,
        quotedAt: slot.quotedAt,
      });
      const card = pricer.price({
        listingId,
        country: cc.country,
        currency: created.currency,
        dailyPriceMinor: want.daily,
        startAt: START,
        endAt: END,
        quotedAt: NOW,
      });
      expect(fiche).toEqual({ totalMinor: want.total, billableDays: 3 });
      expect(card).toEqual({ totalMinor: want.total, billableDays: 3 });
      expect(created.totalMinor).toBe(want.total);

      // US-514 (0144) : un lieu de retour qui n'est pas le lieu de prise ⇒ ONE_WAY_NOT_ALLOWED,
      // jugé par la vraie lecture de la base, sans engager le devis (le hold suivant est posé)
      await expect(
        checkout.checkout(guest, created.quoteId, {
          driver: { firstName: 'Ana', lastName: 'Pérez' },
          acceptedDocuments: created.documents.map((d) => ({ kind: d.kind, version: d.version })),
          returnLocationId: '00000000-0000-4000-8000-0000000514b2',
        }),
      ).rejects.toMatchObject({ code: 'ONE_WAY_NOT_ALLOWED' });

      const hold = await checkout.checkout(guest, created.quoteId, {
        driver: { firstName: 'Ana', lastName: 'Pérez' },
        acceptedDocuments: created.documents.map((d) => ({ kind: d.kind, version: d.version })),
      });
      expect(hold).toMatchObject({
        status: 'ACTIVE',
        quoteId: created.quoteId,
        totalMinor: want.total,
        // US-209c (0120) : hold ordinaire, aucune revue avant le débit
        reviewState: 'NONE',
      });

      await expect(
        checkout.createQuote(guest, {
          listingId,
          startAt: START,
          endAt: END,
          protectionLevel: 'TOTAL',
        }),
      ).rejects.toMatchObject({ code: 'PROTECTION_LEVEL_NOT_ELIGIBLE' });
      await expect(
        checkout.createQuote(guest, {
          listingId,
          startAt: START,
          endAt: END,
          protectionLevel: null,
        }),
      ).rejects.toBeInstanceOf(QuoteHttpError);
    });

    it('US-205b (revue de code n° 3) : annonce à 200 km par jour ⇒ distance INCLUDED de freezeQuote rejouée par la base, 600 km et prix du km figés, relus identiques', async () => {
      const service = new QuoteService(new CountryConfigService());
      const exponent = service.params({ country: cc.country, at: new Date(NOW) }).currency.exponent;
      const want = EXPECTED[exponent];
      if (want === undefined) throw new Error(`aucun attendu pour l'exposant ${exponent}`);
      await openSwitch('p2p_private_hosts_enabled', cc.country);
      await openSwitch('insurer_contract_active', cc.country);
      const { rows } = await client.query<{ listing_id: string }>(
        'SELECT * FROM test_fixture.us208_listed_listing($1, $2, $3, $4)',
        [cc.country, want.daily, 'AUTOMATIC', true],
      );
      const listingId = rows[0]!.listing_id;
      await client.query('SELECT test_fixture.us205b_set_listing_mileage($1, $2, $3, $4)', [
        listingId,
        'INCLUDED',
        200,
        '35',
      ]);
      const guest = await guestSession(cc.country);
      const checkout = new CheckoutService(
        (ctx) => service.params(ctx),
        new PgQuoteStore(client),
        new PgCheckoutStore(client),
        LOG_CHECKOUT_FAILURE,
        (ctx) => service.cancellationParams(ctx),
      );
      const created = await checkout.createQuote(guest, { listingId, startAt: START, endAt: END });
      // 19 US-205 critère 2 : 200 km par jour × 3 jours facturables
      expect(created.mileage).toEqual({
        mode: 'INCLUDED',
        includedKm: 600,
        extraKmPriceMinor: '35',
      });
      expect(created.totalMinor).toBe(want.total);
      expect(await checkout.quote(guest, created.quoteId)).toEqual(created);
    });

    // le plan lu par le devis du checkout (jambe HOST) est prouvé par les L0 d'US-226 : un seul
    // plan vendu (ESTÁNDAR) ne le distingue pas du plan par défaut ici (revues de 226a, n° 5)
    it('plans de gains par le vrai magasin de CAT : plan par défaut lu, plan choisi enregistré puis lu, PRO refusé, compte d’un autre invisible', async () => {
      const store = new PgHostListingStore(client);
      const holderId = await register(cc.country);
      const hostHash = sha();
      await client.query(
        `SELECT core.iam_cmd_open_session($1, $2, $3, 86400, 'NONE', NULL, 'vitest')`,
        [randomUUID(), holderId, hostHash],
      );
      const acc = await client.query<{ outcome: string; org_id: string | null }>(
        'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
        [hostHash, cc.country, 'INDIVIDUAL'],
      );
      const org = acc.rows[0]?.org_id;
      if (acc.rows[0]?.outcome !== 'DONE' || !org) throw new Error('compte d’hôte refusé');
      const loc = await client.query<{ location_id: string | null }>(
        'SELECT * FROM core.catalog_cmd_create_location($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [hostHash, org, 'HOME', 'Casa', 'Calle 1', 'Ciudad', null, null, null],
      );
      const veh = await client.query<{ vehicle_id: string | null }>(
        `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, NULL, NULL, 'Marca',
                                                       'Modelo', 2021, NULL, 'AUTOMATIC',
                                                       5::smallint, 'GASOLINE', 42000, false,
                                                       false)`,
        [hostHash, org, loc.rows[0]?.location_id, await uniquePlate(client, 'C')],
      );
      const vehicleId = veh.rows[0]?.vehicle_id;
      if (!vehicleId) throw new Error('véhicule refusé');

      const initial = await store.earningsPlans(hostHash, org);
      // plan par défaut du pays (host_default_plan) et plans vendus (host_share_pct) du dépôt
      const defaultPlan = new CountryConfigService().config.values.find(
        (v) => v.key === 'host_default_plan' && v.country === cc.country,
      )?.value;
      expect(initial).toMatchObject({
        defaultPlan,
        vehicles: [{ vehicleId, planCode: defaultPlan, chosen: false, chosenAt: null }],
      });
      expect(initial?.offered.map((o) => o.planCode)).toContain(defaultPlan);
      expect(initial?.offered.map((o) => o.planCode)).not.toContain('PRO');

      expect(await store.setEarningsPlan(hostHash, org, vehicleId, String(defaultPlan))).toEqual({
        outcome: 'DONE',
        id: defaultPlan,
      });
      expect((await store.setEarningsPlan(hostHash, org, vehicleId, 'PRO')).outcome).toBe(
        'EARNINGS_PLAN_NOT_AVAILABLE',
      );
      const after = await store.earningsPlans(hostHash, org);
      expect(after?.vehicles[0]).toMatchObject({ planCode: defaultPlan, chosen: true });
      // autre session : compte d'un autre ⇒ rien
      expect(await store.earningsPlans(sha(), org)).toBeNull();
    });
  },
);
