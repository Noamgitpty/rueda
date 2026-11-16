/**
 * test:int — magasin RÉEL de la recherche et de la fiche (`PgSearchStore`) sur la base jetable du
 * banc de @rueda/db, sous app_api (assertion L0-05 par connectAs) : US-205b, revue de code n° 1.
 * Le SQL ajouté par 205b (contrôle des dates et conditions en UNE requête, `LEFT JOIN LATERAL` sur
 * `core.catalog_public_terms` et `to_jsonb`, montants en texte ; `protectionOffered` par
 * `unnest` et `CROSS JOIN LATERAL`) et `termsOf` sont exécutés ici, en PA et en PY.
 *
 * Dans une transaction ANNULÉE : interrupteurs ouverts par la VRAIE procédure à deux personnes
 * d'US-125 ; deux annonces LISTED de la fixture 9998 ; contrat d'assureur posé par la fixture 9973
 * (aucune commande ne l'écrit) ; une annonce couverte (classe STANDARD, usage PARTICULAR), l'autre
 * sans classe de valeur, donc hors contrat ; distance de la fixture 9971.
 *
 * Attendus : 08 BR-CXL-01 (hors dernière minute, gratuite jusqu'au départ − 24 h ; départ dans
 * 20 h ⇒ dernière minute, réservation + 60 min, fenêtre de la graine du pays), 19 US-205 critères
 * 3 et 4 (protection rendue telle que posée au contrat, rien pour une annonce hors contrat), RC au
 * minimum du pays lu de la configuration du dépôt. Aucun code de pays ni de devise n'est écrit ici.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setSessionContext } from '@rueda/db';
import { connectAs, releaseClient } from '@rueda/db/testing';
// types du contexte fourni par le globalSetup du banc (inject('ruedaBench'))
import type {} from '@rueda/db/testing/global-setup';
import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countryCases } from '../../../../../test/support/countries.js';
import { CountryConfigService } from '../../../cfg/index.js';
import { PgSearchStore } from './store.js';

const NOW = '2026-12-01T12:00:00.000Z';
const HOUR = 3_600_000;
const SIGNUP = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const PHC =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
/** Données de TEST (unités mineures de la devise du pays), jamais des attendus de règle. */
const EXTRA_KM = '35';
const DEDUCTIBLES = { BASICA: '150000', ESTANDAR: '50000', TOTAL: '0' };
const EXCLUSIONS = {
  es: 'Exclusiones.',
  en: 'Exclusions.',
  fr: 'Exclusions.',
  'pt-BR': 'Exclusões.',
};

const sha = (): Buffer => createHash('sha256').update(randomBytes(32)).digest();
const config = new CountryConfigService().config;
const valueOf = (key: string, country: string) =>
  config.values.find((v) => v.key === key && v.country === country)?.value;

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

async function register(country: string): Promise<string> {
  const id = randomUUID();
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Staff', 'Test', 'es', $4, $5, 86400,
                                                NULL, $6, $7::jsonb, false) AS ok`,
    [id, `int205b-${id}@example.test`, PHC, randomUUID(), randomBytes(32), country, SIGNUP],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await client.query('SELECT test_fixture.iam_set_account_status($1, $2)', [id, 'ACTIVE']);
  return id;
}

async function staff(role: string, country: string): Promise<{ id: string; hash: Buffer }> {
  const id = await register(country);
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

async function listing(country: string, daily: string): Promise<{ id: string; vehicle: string }> {
  const { rows } = await client.query<{ listing_id: string; vehicle_id: string }>(
    'SELECT * FROM test_fixture.us208_listed_listing($1, $2, $3, $4)',
    [country, daily, 'AUTOMATIC', true],
  );
  if (!rows[0]) throw new Error('annonce de fixture');
  return { id: rows[0].listing_id, vehicle: rows[0].vehicle_id };
}

/** Instant UTC → heure locale « AAAA-MM-JJTHH:MM » du fuseau donné (saisie de la fiche). */
async function local(iso: string, timezone: string): Promise<string> {
  const { rows } = await client.query<{ l: string }>(
    `SELECT pg_catalog.to_char($1::timestamptz AT TIME ZONE $2, 'YYYY-MM-DD"T"HH24:MI') AS l`,
    [iso, timezone],
  );
  return rows[0]!.l;
}

describe.each(countryCases())(
  'PgSearchStore réel, conditions de la fiche ($country, $currency)',
  (cc) => {
    it('dates acceptées ⇒ conditions du départ en une requête (gratuite jusqu’au départ − 24 h, puis dernière minute à 20 h : réservation + fenêtre du pays) ; protection du contrat pour l’annonce couverte ; protectionOffered sur plusieurs annonces dont une hors contrat', async () => {
      await openSwitch('p2p_private_hosts_enabled', cc.country);
      await openSwitch('insurer_contract_active', cc.country);
      const store = new PgSearchStore(client);
      const daily = '4000';
      const covered = await listing(cc.country, daily);
      const uncovered = await listing(cc.country, daily);
      await client.query('SELECT test_fixture.us108_set_value_class($1, $2)', [
        covered.vehicle,
        'STANDARD',
      ]);
      await client.query('SELECT test_fixture.us205b_set_listing_mileage($1, $2, $3, $4)', [
        covered.id,
        'INCLUDED',
        200,
        EXTRA_KM,
      ]);
      const rc = valueOf('insurer_rc_minimum', cc.country);
      const window = valueOf('last_minute_free_window_minutes', cc.country);
      if (typeof rc !== 'string' || typeof window !== 'number') throw new Error('graine absente');
      await client.query(
        `SELECT test_fixture.us205_insurer_contract($1, $2, $3::bigint, $4::jsonb, $5::jsonb, $6)`,
        [
          cc.country,
          cc.currency,
          rc,
          JSON.stringify(DEDUCTIBLES),
          JSON.stringify(EXCLUSIONS),
          true,
        ],
      );

      // plusieurs annonces : seule celle que le contrat couvre promet la protection (une requête)
      const offered = await store.protectionOffered([covered.id, uncovered.id, randomUUID()]);
      expect([...offered]).toEqual([covered.id]);
      expect(await store.protectionOffered([])).toEqual(new Set());

      // départ le 10/12 à 10:00, heure du lieu, réservé le 01/12 : hors dernière minute
      const timezone = (await store.terms(covered.id, null))?.timezone;
      if (timezone === undefined) throw new Error('conditions absentes');
      const r = await store.slotCheck({
        listingId: covered.id,
        startLocal: '2026-12-10T10:00',
        endLocal: '2026-12-13T10:00',
      });
      if (r.outcome !== 'OK') throw new Error(`dates refusées : ${r.outcome}`);
      expect(r.timezone).toBe(timezone);
      const start = Date.parse(r.startAt);
      expect(await local(r.startAt, timezone)).toBe('2026-12-10T10:00');
      expect(r.terms).toMatchObject({
        currency: cc.currency,
        timezone,
        cancellation: {
          lastMinute: false,
          freeUntil: new Date(start - 24 * HOUR).toISOString(),
          lastMinuteWindowMinutes: window,
        },
        mileageMode: 'INCLUDED',
        includedKmPerDay: 200,
        extraKmPriceMinor: EXTRA_KM,
        protection: {
          insurerName: 'Aseguradora de prueba',
          brokerName: 'Corredor de prueba',
          rcAmountMinor: rc,
          deductibles: DEDUCTIBLES,
          exclusions: EXCLUSIONS,
        },
      });

      // départ dans 20 h : dernière minute (seuil de 25 h), gratuite pendant la fenêtre du pays
      const now = start - 20 * HOUR;
      await client.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
        new Date(now).toISOString(),
      ]);
      const late = await store.slotCheck({
        listingId: covered.id,
        startLocal: '2026-12-10T10:00',
        endLocal: '2026-12-13T10:00',
      });
      if (late.outcome !== 'OK') throw new Error(`dates refusées : ${late.outcome}`);
      expect(late.terms?.cancellation).toEqual({
        freeCancelLeadHours: 24,
        lastMinuteThresholdHours: 25,
        lastMinute: true,
        freeUntil: new Date(now + window * 60_000).toISOString(),
        lastMinuteWindowMinutes: window,
      });

      // annonce hors contrat : dates acceptées, aucune protection promise, distance illimitée
      const u = await store.slotCheck({
        listingId: uncovered.id,
        startLocal: '2026-12-10T10:00',
        endLocal: '2026-12-13T10:00',
      });
      if (u.outcome !== 'OK') throw new Error(`dates refusées : ${u.outcome}`);
      expect(u.terms).toMatchObject({
        protection: null,
        mileageMode: 'UNLIMITED',
        extraKmPriceMinor: null,
      });
    });
  },
);
