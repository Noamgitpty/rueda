/**
 * US-215 (partie 215c, migration 0132, ADR-156) — suites N-116 et N-126 des revues d'US-122 (passe
 * n° 2), sous le rôle de PRODUCTION app_api (`rolledBack` → `withRole` : assertion L0-05 en tête),
 * en PA (USD) et en PY (PYG), dans des transactions annulées. Personnes, hôtes et membres du staff
 * sont créés par les vraies commandes (inscription, compte d'hôte, élévation TOTP) ; les fixtures
 * ne posent que ce que la production atteint par un autre chemin (co-hôte, trip à venir).
 *
 * Attendus tirés de 17 §2.3 (« un agent ne décide pas sur son propre dossier », RLS-24), d'ADR-122
 * (garde unique : la personne, les personnes de ses comptes d'hôte, un compte lié ; type inconnu =
 * conflit), d'ADR-124 (point 1 : cinq entrées « non gardées, suivi » ; point 6 : avis du voyageur)
 * et de 08 BR-TRUST-09, jamais du code testé :
 * - N-116 : `support_staff_profile`, `support_staff_add_note`, `support_staff_open_case`,
 *   `support_staff_set_case_status` et `iam_staff_cmd_data_access` refusent un sujet qui concerne
 *   l'agent (SELF_FORBIDDEN, journalisé STAFF_FORBIDDEN avec `reason` = SELF), ADMIN compris, sans
 *   rien écrire ni rendre ; le cas légitime (autre agent) est inchangé ;
 * - N-126 : une seconde restriction d'une autre sorte ne prévient pas une seconde fois le
 *   voyageur ; la levée de la DERNIÈRE restriction le prévient (une fois par trip à venir) ;
 * - N-123 (serveur) : la fiche de l'hôte porte ses trips à venir en tant qu'hôte (`hostTrips`).
 */
import { describe, expect, it } from 'vitest';
import { act, accessRows, first } from '../redteam/l1/support-host.ts';
import { cohost, staffPerson } from '../redteam/l1/support-p2.ts';
import { byCountry, hostOf, ops, rolledBack, uuid } from '../redteam/l1/support.ts';
import type { Tx } from '../redteam/l1/support.ts';
import { auditOf, installTestProofKey } from '../support/staff.ts';

const PURPOSE = 'Instruction du dossier assigné à l’agent';
const FIELD = 'identity_document.number_enc';
const DAY = 86_400_000;

interface Result {
  readonly outcome: string;
  readonly body: Record<string, unknown> | null;
}
interface Who {
  readonly userId: string;
  readonly hash: Buffer;
}

const profile = (tx: Tx, s: Who, user: string) =>
  first<Result>(tx, 'SELECT * FROM core.support_staff_profile($1, $2, $3, $4)', [
    s.hash,
    uuid(),
    user,
    PURPOSE,
  ]);
const note = (tx: Tx, s: Who, user: string, body: string) =>
  first<Result>(tx, 'SELECT * FROM core.support_staff_add_note($1, $2, $3, $4)', [
    s.hash,
    uuid(),
    user,
    body,
  ]);
const openCase = (tx: Tx, s: Who, requester: string) =>
  first<Result>(tx, 'SELECT * FROM core.support_staff_open_case($1, $2, $3, $4, $5, $6)', [
    s.hash,
    uuid(),
    requester,
    'ACCOUNT',
    'NORMAL',
    'WHATSAPP',
  ]);
const caseStatus = (tx: Tx, s: Who, caseId: string, status: string) =>
  first<Result>(tx, 'SELECT * FROM core.support_staff_set_case_status($1, $2, $3, $4)', [
    s.hash,
    uuid(),
    caseId,
    status,
  ]);
const dataAccess = (tx: Tx, s: Who, caseId: string, subjectType: string, subject: string) =>
  first<{ outcome: string; access_id: string | null }>(
    tx,
    'SELECT * FROM core.iam_staff_cmd_data_access($1, $2, $3, $4, $5, $6, $7, $8)',
    [s.hash, uuid(), caseId, subjectType, subject, FIELD, 'READ_C3', PURPOSE],
  );

/** Dernière ligne d'audit de l'agent : refus journalisé de la garde (raison SELF). */
async function lastRefusal(tx: Tx, actor: string) {
  const last = (await auditOf(tx, actor)).at(-1);
  return { action: last?.action_code, reason: last?.after?.['reason'] };
}
const SELF_LOGGED = { action: 'STAFF_FORBIDDEN', reason: 'SELF' };

/** Identifiant d'un dossier ouvert par `s` (issue OPENED attendue). */
async function caseOf(tx: Tx, s: Who, requester: string): Promise<string> {
  const r = await openCase(tx, s, requester);
  expect(r.outcome).toBe('OPENED');
  return String(r.body?.['caseId'] ?? '');
}

describe.each(byCountry)(
  'US-215c — N-116 : la garde ADR-122 sur cinq entrées (%s, %s)',
  (country) => {
    it('fiche 360° : ni la sienne ni celle d’une personne de ses comptes d’hôte (ADMIN compris), refus journalisé sans ligne d’accès ; un autre ADMIN la lit', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const host = await hostOf(tx, country);
        const agent = await staffPerson(tx, country, 'ADMIN');
        expect(await profile(tx, agent, agent.userId)).toEqual({
          outcome: 'SELF_FORBIDDEN',
          body: null,
        });
        expect(await lastRefusal(tx, agent.userId)).toEqual(SELF_LOGGED);
        // co-hôte du compte d'hôte de la personne (ADR-124, F2-C-05)
        await cohost(tx, agent.userId, host.org);
        expect((await profile(tx, agent, host.userId)).outcome).toBe('SELF_FORBIDDEN');
        expect(await lastRefusal(tx, agent.userId)).toEqual(SELF_LOGGED);
        expect(await accessRows(tx, agent.userId)).toEqual([]);
        // témoin : un ADMIN sans lien lit la fiche, journalisée
        const other = await ops(tx, 'ADMIN', [country]);
        const r = await profile(tx, other, host.userId);
        expect(r.outcome).toBe('GRANTED');
        expect(JSON.stringify(r.body)).toContain(host.org);
      });
    });

    it('note interne : jamais sur soi, aucune note écrite ; un autre agent écrit la sienne', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const agent = await staffPerson(tx, country, 'ADMIN');
        const secret = `Note sur soi-même ${uuid()}`;
        expect(await note(tx, agent, agent.userId, secret)).toEqual({
          outcome: 'SELF_FORBIDDEN',
          body: null,
        });
        expect(await lastRefusal(tx, agent.userId)).toEqual(SELF_LOGGED);
        const other = await ops(tx, 'ADMIN', [country]);
        expect((await note(tx, other, agent.userId, 'Note légitime d’un collègue')).outcome).toBe(
          'ADDED',
        );
        const read = await profile(tx, other, agent.userId);
        expect(read.outcome).toBe('GRANTED');
        expect(JSON.stringify(read.body)).not.toContain(secret);
        expect(JSON.stringify(read.body)).toContain('Note légitime d’un collègue');
      });
    });

    it('ouverture d’un dossier : jamais pour soi ni pour une personne de ses comptes d’hôte ; pour un autre, ouvert et couvrant sa fiche', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const host = await hostOf(tx, country);
        const stranger = await hostOf(tx, country);
        const agent = await staffPerson(tx, country, 'OPS_AGENT');
        expect(await openCase(tx, agent, agent.userId)).toEqual({
          outcome: 'SELF_FORBIDDEN',
          body: null,
        });
        expect(await lastRefusal(tx, agent.userId)).toEqual(SELF_LOGGED);
        await cohost(tx, agent.userId, host.org);
        expect((await openCase(tx, agent, host.userId)).outcome).toBe('SELF_FORBIDDEN');
        // aucun dossier ouvert : la fiche de l'hôte reste hors de portée de l'OPS
        expect((await profile(tx, agent, host.userId)).outcome).toBe('SELF_FORBIDDEN');
        // témoin : un dossier pour une personne sans lien couvre sa fiche (comportement inchangé)
        await caseOf(tx, agent, stranger.userId);
        expect((await profile(tx, agent, stranger.userId)).outcome).toBe('GRANTED');
      });
    });

    it('état d’un dossier : l’ADMIN demandeur du dossier ne le change pas, état inchangé ; l’ADMIN qui l’a ouvert le résout', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const opener = await ops(tx, 'ADMIN', [country]);
        const requester = await staffPerson(tx, country, 'ADMIN');
        const caseId = await caseOf(tx, opener, requester.userId);
        expect(await caseStatus(tx, requester, caseId, 'CLOSED')).toEqual({
          outcome: 'SELF_FORBIDDEN',
          body: null,
        });
        expect(await lastRefusal(tx, requester.userId)).toEqual(SELF_LOGGED);
        // dossier ni fermé ni changé : son ouvreur le passe encore à RESOLVED
        expect(await caseStatus(tx, opener, caseId, 'RESOLVED')).toEqual({
          outcome: 'UPDATED',
          body: { caseId, status: 'RESOLVED' },
        });
      });
    });

    it('porte des lectures C3 : ni un dossier ni un sujet qui concerne l’agent, type de sujet inconnu refusé (fail-closed), aucune ligne d’accès ; le cas légitime est accordé', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const host = await hostOf(tx, country);
        const admin = await ops(tx, 'ADMIN', [country]);
        const caseId = await caseOf(tx, admin, host.userId);
        // sujet = l'agent lui-même, dans un dossier légitime
        expect((await dataAccess(tx, admin, caseId, 'USER', admin.userId)).outcome).toBe(
          'SELF_FORBIDDEN',
        );
        expect(await lastRefusal(tx, admin.userId)).toEqual(SELF_LOGGED);
        // type de sujet que la garde ne connaît pas : conflit présumé
        expect((await dataAccess(tx, admin, caseId, 'WIDGET', host.userId)).outcome).toBe(
          'SELF_FORBIDDEN',
        );
        expect(await accessRows(tx, admin.userId)).toEqual([]);
        // co-hôte de l'hôte : dossier ET sujet le concernent
        const cohostAdmin = await staffPerson(tx, country, 'ADMIN');
        await cohost(tx, cohostAdmin.userId, host.org);
        expect((await dataAccess(tx, cohostAdmin, caseId, 'USER', host.userId)).outcome).toBe(
          'SELF_FORBIDDEN',
        );
        expect(await accessRows(tx, cohostAdmin.userId)).toEqual([]);
        // témoin : sujet sans lien, `USER` comme USER_ACCOUNT — accordé, une ligne d'accès
        const granted = await dataAccess(tx, admin, caseId, 'USER', host.userId);
        expect(granted.outcome).toBe('GRANTED');
        expect((await accessRows(tx, admin.userId)).map((r) => r.id)).toEqual([granted.access_id]);
        expect((await dataAccess(tx, admin, caseId, 'USER_ACCOUNT', host.userId)).outcome).toBe(
          'GRANTED',
        );
      });
    });
  },
);

describe.each(byCountry)(
  'US-215c — N-126 : avis du voyageur à la pose et à la levée de la restriction de l’hôte (%s, %s)',
  (country, _currency, cc) => {
    /** Hôte réel avec un trip à venir d'un voyageur (fixture de trip, comme rt-l1-11). */
    async function hostWithTrip(tx: Tx) {
      const host = await hostOf(tx, country);
      const trip = uuid();
      await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
        trip,
        uuid(),
        host.org,
        uuid(),
        cc.country,
        cc.currency,
        cc.timezone,
        new Date(Date.now() + 5 * DAY).toISOString(),
        new Date(Date.now() + 8 * DAY).toISOString(),
      ]);
      return { host, trip };
    }
    const noticesOf = async (tx: Tx, trip: string) => {
      const rows = (
        await tx.query<{ type: string }>(
          'SELECT * FROM test_fixture.us122b_events_mentioning($1::text[])',
          [[trip]],
        )
      ).rows;
      return {
        restricted: rows.filter((r) => r.type === 'booking.trip.host_restricted').length,
        lifted: rows.filter((r) => r.type === 'booking.trip.host_restriction_lifted').length,
      };
    };

    it('une seule notification par restriction effective, une à la levée de la dernière, et de nouveau à une nouvelle pose', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const { host, trip } = await hostWithTrip(tx);
        const agent = await ops(tx, 'OPS_AGENT', [country]);
        const step = async (action: string, kind: string) =>
          (await act(tx, agent, action, host.userId, { input: { kind }, scope: [country] }))
            .outcome;

        expect(await step('RESTRICT_ACCOUNT', 'TS_HOLD')).toBe('DONE');
        expect(await noticesOf(tx, trip)).toEqual({ restricted: 1, lifted: 0 });
        // N-123 (serveur) : l'ops voit le trip à venir dans la fiche de l'hôte
        const admin = await ops(tx, 'ADMIN', [country]);
        const read = await profile(tx, admin, host.userId);
        expect(read.outcome).toBe('GRANTED');
        expect(JSON.stringify(read.body?.['hostTrips'])).toContain(trip);

        // seconde sorte de restriction : aucun second avis
        expect(await step('RESTRICT_ACCOUNT', 'POLICY_VIOLATION')).toBe('DONE');
        expect(await noticesOf(tx, trip)).toEqual({ restricted: 1, lifted: 0 });
        // levée d'une seule des deux : l'hôte reste restreint, aucun avis de levée
        expect(await step('LIFT_RESTRICTION', 'TS_HOLD')).toBe('DONE');
        expect(await noticesOf(tx, trip)).toEqual({ restricted: 1, lifted: 0 });
        // levée de la dernière : le voyageur est prévenu, une fois
        expect(await step('LIFT_RESTRICTION', 'POLICY_VIOLATION')).toBe('DONE');
        expect(await noticesOf(tx, trip)).toEqual({ restricted: 1, lifted: 1 });
        // nouvelle restriction après la levée : nouvel avis
        expect(await step('RESTRICT_ACCOUNT', 'TS_HOLD')).toBe('DONE');
        expect(await noticesOf(tx, trip)).toEqual({ restricted: 2, lifted: 1 });
      });
    });
  },
);
