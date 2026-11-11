/**
 * test:int — adaptateurs PostgreSQL de la console (US-101) sur la base jetable du banc de
 * @rueda/db, sous app_api (assertion L0-05 par connectAs) : `PgManualActionStore` et
 * `PgFinanceApprovalStore`, avec les VRAIES commandes (0036, 0059) et la forme d'appel de
 * production (une instruction, contexte STAFF posé par la CTE ; lecture en transaction courte).
 * Sessions élevées ouvertes par la fixture 9650, bordereaux posés par la fixture 9700.
 * Pour chaque pays déclaré (USD et PYG) :
 * - une demande ISSUE_BORDEREAU par la console n'est qu'une demande (REQUESTED, aucune émission) ;
 * - elle apparaît dans les demandes en attente du FINANCE du pays, jamais d'un OPS ;
 * - le demandeur ne peut pas l'approuver (SELF_APPROVAL) ; une seconde personne l'approuve ;
 * - un sujet introuvable est refusé (FORBIDDEN) avant toute règle de pièces.
 * Attendus : 19 US-101 critère 3, 17 §2.3 (RLS-24) ; jamais tirés du code testé.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { connectAs, releaseClient } from '@rueda/db/testing';
// types du contexte fourni par le globalSetup du banc (inject('ruedaBench'))
import type {} from '@rueda/db/testing/global-setup';
import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgFinanceApprovalStore } from './finance-approval-store.js';
import type { SqlClient, SqlPool } from './finance-approval-store.js';
import { PgManualActionStore } from './manual-action-store.js';
import type { StaffActor } from './staff-context.js';

const PHC =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
const REASON = 'Bordereau mensuel de l’assureur partenaire';

let client: pg.Client;

// Une connexion par test : connectAs fait l'assertion L0-05 de CHAQUE test.
beforeEach(async () => {
  client = await connectAs('app_api');
});

afterEach(async () => {
  await releaseClient(client);
});

/** Pool d'une seule connexion (celle du test) : la transaction de lecture y est ouverte et close. */
const poolOf = (c: pg.Client): SqlPool => ({
  query: (text, values) => c.query(text, values as unknown[]),
  connect: () =>
    Promise.resolve({
      query: (text: string, values?: readonly unknown[]) => c.query(text, values as unknown[]),
      release: () => undefined,
    } as SqlClient),
});

const sha = (t: string): Buffer => createHash('sha256').update(t, 'utf8').digest();

/** Membre du staff ACTIVE, rôle sur `countries`, session ÉLEVÉE (fixture 9650). */
async function staff(role: string, countries: readonly string[]): Promise<StaffActor> {
  const userId = randomUUID();
  await client.query(
    `SELECT core.iam_cmd_register($1, $2, $3, 'Int', 'Test', 'es', $4, $5, 86400, NULL)`,
    [userId, `int-${userId}@example.test`, PHC, randomUUID(), randomBytes(32)],
  );
  await client.query(`SELECT test_fixture.iam_set_account_status($1, 'ACTIVE')`, [userId]);
  await client.query(
    `SELECT test_fixture.iam_grant_staff_role($1, $2, $3, $4::text[], NULL, NULL)`,
    [randomUUID(), userId, role, countries],
  );
  const tokenHash = sha(randomBytes(32).toString('base64url'));
  await client.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [userId, tokenHash]);
  return { userId, tokenHash, countries };
}

async function declaredCountries(): Promise<{ code: string; currency: string }[]> {
  const { rows } = await client.query<{ code: string; currency: string }>(
    'SELECT code::text AS code, currency::text AS currency FROM core.config_country ORDER BY code',
  );
  return rows;
}

describe('adaptateurs PostgreSQL de la console (US-101, app_api)', () => {
  it('ISSUE_BORDEREAU par la console : demande seule, listée pour FINANCE du pays, auto-approbation refusée, seconde personne : émis', async () => {
    const countries = await declaredCountries();
    expect(countries.length).toBeGreaterThanOrEqual(2);
    const actions = new PgManualActionStore(client);
    const finance = new PgFinanceApprovalStore(poolOf(client));
    for (const { code, currency } of countries) {
      const a = await staff('FINANCE', [code]);
      const b = await staff('FINANCE', [code]);
      const ops = await staff('OPS_AGENT', [code]);
      const bordereau = randomUUID();
      // total en unités mineures de la devise du pays (aucun montant n'est saisi par l'agent)
      await client.query('SELECT test_fixture.us062_insert_bordereau($1, $2, $3, $4::bigint)', [
        bordereau,
        code,
        currency,
        '42000',
      ]);
      const requestId = randomUUID();
      const r = await actions.record(a, {
        requestId,
        actionCode: 'ISSUE_BORDEREAU',
        subjectId: bordereau,
        reason: REASON,
        input: null,
        evidence: [],
      });
      expect(r, code).toEqual({
        outcome: 'REQUESTED',
        actionId: requestId,
        domainRef: requestId,
        detail: null,
      });
      const { rows: issued } = await client.query<{ status: string }>(
        'SELECT status FROM test_fixture.us062_bordereau_row($1)',
        [bordereau],
      );
      expect(issued, code).toEqual([{ status: 'DRAFT' }]);

      const listed = await finance.pending(a, 200);
      expect(
        listed.find((p) => p.id === requestId),
        code,
      ).toMatchObject({
        action: 'ISSUE_BORDEREAU',
        subjectId: bordereau,
        country: code,
        reason: REASON,
      });
      expect(await finance.pending(ops, 200), code).toEqual([]);

      expect(await finance.approve(a, requestId), code).toBe('SELF_APPROVAL');
      expect(await finance.approve(ops, requestId), code).toBe('FORBIDDEN');
      expect(await finance.approve(b, requestId), code).toBe('APPROVED');
      const { rows: after } = await client.query<{ status: string }>(
        'SELECT status FROM test_fixture.us062_bordereau_row($1)',
        [bordereau],
      );
      expect(after, code).toEqual([{ status: 'ISSUED' }]);
      expect(await finance.approve(b, requestId), code).toBe('NOT_PENDING');
    }
  });

  it('sujet introuvable : FORBIDDEN, sans oracle d’existence, avant toute règle de pièces', async () => {
    const [first] = await declaredCountries();
    const admin = await staff('ADMIN', [first?.code ?? '']);
    const actions = new PgManualActionStore(client);
    await expect(
      actions.record(admin, {
        requestId: randomUUID(),
        actionCode: 'RECORD_CLAIM',
        subjectId: randomUUID(),
        reason: REASON,
        input: null,
        evidence: [],
      }),
    ).resolves.toMatchObject({ outcome: 'FORBIDDEN' });
  });
});
