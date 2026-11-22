/**
 * US-313 — red team du lot 3, axe « dossier de preuve » (19 US-313 critère 2 ; pré-mortem du lot 3,
 * RT-L3-D03 ; risque L3-PM-47) : EXPORT DU DOSSIER DE PREUVE PAR UN AUTRE HÔTE, par le voyageur, par
 * un hôte qui est aussi agent de l'ops, par un agent d'un autre pays, sans la permission ou sans
 * dossier de support. Rôles de PRODUCTION seulement (`withRole` : assertion L0-05 en tête de chaque
 * test), USD (PA) et PYG sans décimale (PY), transaction ANNULÉE, horloge virtuelle 2094. TESTS
 * SEULEMENT : aucun correctif. Rapport : docs/team/redteam/L3-preuves-versements.md.
 *
 * Attendus (jamais le code testé) : 19 US-308 et 16 CLM-034 (dossier généré à la demande par l'ops,
 * pour un dossier de support OUVERT du trip, assigné au demandeur) ; 17 §2.3 (`data.export` de l'OPS,
 * limité à sa file, refus journalisé) ; ADR-122 (séparation des tâches : l'hôte du trip, même agent
 * de l'ops, ne s'exporte pas lui-même). Une personne qui n'est pas un agent de l'ops (hôte,
 * voyageur) n'a aucune session élevée : refus d'authentification, pas de dossier créé.
 *
 * Les preuves L0 d'US-308 jouent déjà la plupart de ces refus ; cette passe les REJOUE pour le
 * scénario du pré-mortem « un autre hôte » et ajoute : (1) l'hôte d'un AUTRE trip qui est aussi
 * agent de l'ops, avec SON propre dossier de support (assigné, ouvert, mais sur un autre trip) ;
 * (2) la lecture de l'état du dossier par un agent qui n'est pas le demandeur et par les parties.
 */
import { describe, expect, it } from 'vitest';
import { setActor } from '../../support/audit.ts';
import { COUNTRIES } from '../../support/avl.ts';
import type { CountryCase } from '../../support/avl.ts';
import { newHash } from '../../support/golive.ts';
import { createStaff } from '../../support/staff.ts';
import { checkinOpenWorld, plus, rolledBack, uuid } from './support-l3.ts';
import type { Row, Tx, World } from './support-l3.ts';

const T0 = '2094-07-01T09:00:00.000Z';
const START = '2094-07-10T15:00:00.000Z';
const END = '2094-07-13T15:00:00.000Z';
const REASON = 'Litige de dommage : dossier pour l’assureur partenaire';
const REQUEST = `SELECT outcome, bundle_id::text AS bundle_id, status
  FROM core.support_staff_request_evidence_bundle($1, $2::uuid, $3::uuid, $4::uuid, $5, $6)`;
const STATUS =
  'SELECT outcome, body FROM core.support_staff_evidence_bundle($1, $2::uuid, $3::uuid)';

/** Session élevée de staff (fixture 9650) ouverte à l'heure de la transaction ; contexte STAFF. */
async function elevated(tx: Tx, userId: string): Promise<Buffer> {
  const hash = newHash();
  await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [userId, hash]);
  await setActor(tx, { kind: 'STAFF', actorId: userId });
  return hash;
}

async function supportCase(
  tx: Tx,
  c: CountryCase,
  trip: string,
  assignee: string,
  status = 'OPEN',
): Promise<string> {
  const id = uuid();
  await tx.query('SELECT test_fixture.rls_insert_support_case($1, $2, $3, $4, $5, $6, $7)', [
    id,
    c.country,
    trip,
    assignee,
    status,
    'CLAIM',
    null,
  ]);
  return id;
}

async function request(tx: Tx, hash: Buffer, trip: string, caseId: string): Promise<Row> {
  return (await tx.query<Row>(REQUEST, [hash, uuid(), trip, caseId, 'INSURER', REASON])).rows[0]!;
}

/** Trip dont la remise est ouverte, CGU acceptées avant la réservation (comme US-308). */
async function tripOf(tx: Tx, c: CountryCase): Promise<World> {
  const w = await checkinOpenWorld(tx, c, START, END);
  await tx.query('SELECT test_fixture.us308_consent($1, $2, $3)', [
    w.guest,
    'TOS_GUEST',
    plus(T0, -86_400),
  ]);
  await tx.query('SELECT test_fixture.us308_consent($1, $2, $3)', [
    w.holder,
    'TOS_HOST',
    plus(T0, -86_400),
  ]);
  return w;
}

describe.each(COUNTRIES)('RT-L3 export du dossier de preuve ($country, $currency)', (c) => {
  it('RT-L3-D03 (L3-PM-47) : l’hôte d’un autre trip, le voyageur, l’hôte-agent sur le dossier d’un autre trip, l’agent d’un autre pays ou sans permission, l’agent sans dossier ne créent AUCUN dossier ; seul l’agent assigné à un dossier ouvert du trip le fait ; l’état n’est lu que par le demandeur', async () => {
    await rolledBack(T0, async (tx) => {
      const victim = await tripOf(tx, c);
      const attackerHostTrip = await tripOf(tx, c); // l'hôte attaquant et son propre trip
      const other = COUNTRIES.find((x) => x.country !== c.country) ?? c;
      const ops = (await createStaff(tx, 'OPS_AGENT', [c.country], { withFactor: false })).userId;
      const colleague = (await createStaff(tx, 'OPS_AGENT', [c.country], { withFactor: false }))
        .userId;
      const away = (await createStaff(tx, 'OPS_AGENT', [other.country], { withFactor: false }))
        .userId;
      const support = (await createStaff(tx, 'SUPPORT_AGENT', [c.country], { withFactor: false }))
        .userId;
      // l'hôte attaquant est AUSSI agent de l'ops du pays (compte ACTIVE, rôle OPS_AGENT)
      await tx.query(`SELECT test_fixture.iam_set_account_status($1, 'ACTIVE')`, [
        attackerHostTrip.holder,
      ]);
      await tx.query(
        `SELECT test_fixture.iam_grant_staff_role($1, $2, 'OPS_AGENT', $3::text[], NULL, NULL)`,
        [uuid(), attackerHostTrip.holder, [c.country]],
      );

      const caseOfVictim = await supportCase(tx, c, victim.trip, ops);
      const closed = await supportCase(tx, c, victim.trip, ops, 'CLOSED');
      const attackerOwnCase = await supportCase(
        tx,
        c,
        attackerHostTrip.trip,
        attackerHostTrip.holder,
      );

      // 1. l'hôte d'un autre trip et le voyageur : leur session n'est pas une session élevée de staff
      for (const hash of [attackerHostTrip.h, victim.g]) {
        const r = await request(tx, hash, victim.trip, caseOfVictim);
        expect(['AUTH_REQUIRED', 'MFA_REQUIRED'], String(r['outcome'])).toContain(r['outcome']);
        expect(r['bundle_id']).toBeNull();
      }

      // 2. refus de l'ops : sans permission, autre pays, dossier d'un collègue, dossier clos, dossier
      //    d'un AUTRE trip (y compris le dossier de l'hôte-agent, assigné et ouvert), dossier inconnu
      const refusals: readonly [string, string, string, string][] = [
        [support, caseOfVictim, 'FORBIDDEN', 'sans la permission'],
        [away, caseOfVictim, 'FORBIDDEN', 'autre pays'],
        [colleague, caseOfVictim, 'CASE_REQUIRED', 'dossier d’un collègue'],
        [ops, closed, 'CASE_REQUIRED', 'dossier clos'],
        [ops, attackerOwnCase, 'CASE_REQUIRED', 'dossier d’un autre trip'],
        [ops, uuid(), 'CASE_REQUIRED', 'dossier inconnu'],
        [attackerHostTrip.holder, attackerOwnCase, 'CASE_REQUIRED', 'hôte-agent, son dossier'],
        [attackerHostTrip.holder, caseOfVictim, 'CASE_REQUIRED', 'hôte-agent, dossier de l’autre'],
      ];
      for (const [who, caseId, expected, label] of refusals) {
        const r = await request(tx, await elevated(tx, who), victim.trip, caseId);
        expect(r['outcome'], label).toBe(expected);
        expect(r['bundle_id'], label).toBeNull();
      }

      // 3. témoin : l'agent assigné au dossier ouvert du trip obtient le dossier
      const opsHash = await elevated(tx, ops);
      const ok = (
        await tx.query<Row>(REQUEST, [
          opsHash,
          uuid(),
          victim.trip,
          caseOfVictim,
          'INSURER',
          REASON,
        ])
      ).rows[0]!;
      expect(ok['outcome']).toBe('REQUESTED');
      const bundleId = String(ok['bundle_id']);
      expect(bundleId).not.toBe('null');

      // 4. lecture de l'état : les parties (même autre hôte) et un agent qui n'est pas le demandeur
      for (const hash of [attackerHostTrip.h, victim.g, victim.h]) {
        const r = (await tx.query<Row>(STATUS, [hash, uuid(), bundleId])).rows[0]!;
        expect(['AUTH_REQUIRED', 'MFA_REQUIRED', 'FORBIDDEN', 'NOT_FOUND']).toContain(r['outcome']);
        expect(r['body'] ?? null).toBeNull();
      }
      for (const who of [colleague, away, support]) {
        const r = (await tx.query<Row>(STATUS, [await elevated(tx, who), uuid(), bundleId]))
          .rows[0]!;
        expect(['FORBIDDEN', 'NOT_FOUND', 'CASE_REQUIRED']).toContain(r['outcome']);
        expect(r['body'] ?? null).toBeNull();
      }
      // le demandeur lit son dossier
      const own = (await tx.query<Row>(STATUS, [await elevated(tx, ops), uuid(), bundleId]))
        .rows[0]!;
      expect(own['outcome']).not.toBe('NOT_FOUND');
      expect(own['outcome']).not.toBe('FORBIDDEN');
    });
  });
});
