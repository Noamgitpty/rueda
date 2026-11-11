/**
 * Preuves du compte d'hôte d'une personne physique (US-107, migration 0061 ; fixtures 9980) sous
 * le rôle de production app_api (assertion L0-05 en tête de chaque connexion, withRole), en USD
 * (PA) et en PYG (PY). Chaque test crée ses propres personnes, sessions et membres du staff par
 * les VRAIES commandes (inscription avec consentements, ouverture de session, élévation TOTP).
 *
 * Attendus tirés de 19 US-107 (critères d'acceptation), de 17 §2.3 (« Compte d'hôte » : une
 * personne physique, mono-pays ; deux pays = deux comptes), §3.2.1 (`organization`,
 * `membership`), §10 (`CREATE_HOST_ACCOUNT`, permission `ops.review_listing_host`), de 08
 * BR-ACC-06, de 16 HST-049 / A.8 (`HOST_ENTITY_NOT_ALLOWED`, `HOST_UNDER_AGE`,
 * `HOST_NOT_ACTIVATED`), d'OQ-P2P-01 (21 ans) et de DEC-FONDATEUR-13, jamais du code testé :
 * - critère 1 : une seconde demande de la même personne dans le même pays est refusée ;
 * - critère 2 : une demande au nom d'une personne morale est refusée ;
 * - critère 3 : un compte d'hôte non ACTIVE ne reçoit aucune réservation (HOST_NOT_ACTIVATED) ;
 * - critère 4 : à la reconnexion, la personne porte le rôle P2P_HOST (titulaire) en plus de
 *   GUEST, et le nom affiché est son prénom, jamais une raison sociale ni son nom de famille ;
 * - L1-PM-11 (pré-mortem du lot 1, risque critique n° 1) : RLS stricte entre hôtes, IDOR de
 *   l'hôte A contre l'hôte B dans chaque pays (lecture, contexte forgé, écriture directe, comptes
 *   de session) ;
 * - action de console CREATE_HOST_ACCOUNT : mêmes règles, par le cadre d'US-101 (portée pays,
 *   permission, refus journalisés).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { setSessionContext, translateDbError } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { placeHoldCommand, registerVehicles } from '../support/concurrency.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import { auditOf, elevatedStaff } from '../support/staff.ts';

const ALL = COUNTRIES.map((c) => c.country);
const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const FIRST = 'Ana María';
const LAST = 'Pérez Gómez';
const REASON = 'Demande de la personne reçue par le support';

interface Person {
  readonly userId: string;
  readonly hash: Buffer;
}

/**
 * Personne inscrite par la vraie commande (pays du parcours, ou aucun), compte ACTIVE (e-mail
 * vérifié) sauf demande contraire, et session ouverte. Validé (autocommit).
 */
async function person(
  client: pg.ClientBase,
  country: string | null,
  options: { readonly status?: 'ACTIVE' | 'PENDING_EMAIL' | 'RESTRICTED' } = {},
): Promise<Person> {
  const userId = uuid();
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, $4, $5, 'es', $6, $7, 86400, NULL, $8,
                                                $9::jsonb, false) AS ok`,
    [
      userId,
      `host-${userId}@example.test`,
      phcArgon2id(),
      FIRST,
      LAST,
      uuid(),
      randomBytes(32),
      country,
      DOCS,
    ],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  const status = options.status ?? 'ACTIVE';
  if (status !== 'PENDING_EMAIL') {
    await client.query('SELECT test_fixture.iam_set_account_status($1, $2)', [userId, status]);
  }
  return { userId, hash: await session(client, userId) };
}

/** Nouvelle session (reconnexion) par la vraie commande ; rend l'empreinte du jeton. */
async function session(client: pg.ClientBase, userId: string): Promise<Buffer> {
  const t = newToken();
  const { rows } = await client.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [uuid(), userId, t.hash, SESSION_TTL_S],
  );
  if (!rows[0]?.expires_at) throw new Error('session refusée');
  return t.hash;
}

interface Opened {
  readonly outcome: string;
  readonly org_id: string | null;
}

async function open(
  client: pg.ClientBase,
  hash: Buffer,
  country: string,
  kind = 'INDIVIDUAL',
): Promise<Opened> {
  const { rows } = await client.query<Opened>(
    'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
    [hash, country, kind],
  );
  return rows[0] ?? { outcome: '', org_id: null };
}

interface HostAccountRow {
  readonly org_id: string;
  readonly country_code: string;
  readonly role: string;
  readonly org_status: string;
  readonly display_name: string;
}

async function accounts(client: pg.ClientBase, hash: Buffer): Promise<HostAccountRow[]> {
  const { rows } = await client.query<HostAccountRow>('SELECT * FROM core.iam_host_accounts($1)', [
    hash,
  ]);
  return rows;
}

interface HostRow {
  readonly org_id: string;
  readonly kind: string;
  readonly country_code: string;
  readonly display_name: string | null;
  readonly tax_id: string | null;
  readonly org_status: string;
  readonly plan_code: string | null;
  readonly legal_entity_id: string | null;
  readonly org_created_by: string | null;
  readonly member_user: string | null;
  readonly member_role: string | null;
  readonly member_status: string | null;
  readonly members: string;
}

async function hostRows(client: pg.ClientBase, userId: string): Promise<HostRow[]> {
  const { rows } = await client.query<HostRow>('SELECT * FROM test_fixture.us107_host_rows($1)', [
    userId,
  ]);
  return rows;
}

const byCountry = COUNTRIES.map((c) => [c.country, c.currency, c] as const);

describe('critère 4 — ouverture en libre-service : titulaire P2P_HOST, nom affiché = prénom', () => {
  it.each(byCountry)(
    '%s (%s) : compte ONBOARDING d’une personne physique, titulaire ACTIVE, prénom seul, aucun numéro fiscal ; rôle P2P_HOST à la reconnexion ; audit HOST_ACCOUNT_OPENED',
    async (country) => {
      await withRole('app_api', async (client) => {
        const p = await person(client, country);
        // avant : aucun compte d'hôte (la personne n'est que voyageur)
        expect(await accounts(client, p.hash)).toEqual([]);
        const r = await open(client, p.hash, country);
        expect(r.outcome).toBe('DONE');
        const rows = await hostRows(client, p.userId);
        expect(rows).toEqual([
          {
            org_id: r.org_id,
            kind: 'P2P_HOST_INDIVIDUAL',
            country_code: country,
            display_name: FIRST,
            tax_id: null,
            org_status: 'ONBOARDING',
            plan_code: null,
            legal_entity_id: null,
            org_created_by: p.userId,
            member_user: p.userId,
            member_role: 'P2P_HOST',
            member_status: 'ACTIVE',
            members: '1',
          },
        ]);
        // le nom affiché ne contient jamais le nom de famille (minimisation, 19 US-107)
        expect(rows[0]?.display_name).not.toContain('Pérez');
        // reconnexion : nouvelle session, le rôle P2P_HOST est porté (en plus de GUEST, implicite
        // pour tout compte : 17 §2.3, une personne cumule voyageur et hôte)
        const again = await session(client, p.userId);
        expect(await accounts(client, again)).toEqual([
          {
            org_id: r.org_id,
            country_code: country,
            role: 'P2P_HOST',
            org_status: 'ONBOARDING',
            display_name: FIRST,
          },
        ]);
        const audit = (await auditOf(client, p.userId)).filter(
          (a) => a.action_code === 'HOST_ACCOUNT_OPENED',
        );
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({
          actor_role: 'GUEST',
          subject_type: 'ORGANIZATION',
          subject_id: r.org_id,
        });
        expect(audit[0]?.after).toMatchObject({
          country,
          source: 'SELF_SERVICE',
          status: 'ONBOARDING',
        });
        // jamais une donnée C2 dans le journal : ni prénom ni nom
        expect(JSON.stringify(audit[0])).not.toMatch(/Ana|Pérez/);
      });
    },
  );

  it('une même personne dans les deux pays : deux comptes d’hôte distincts, un par pays (17 §2.3)', async () => {
    await withRole('app_api', async (client) => {
      const p = await person(client, COUNTRIES[0].country);
      for (const c of COUNTRIES)
        expect((await open(client, p.hash, c.country)).outcome).toBe('DONE');
      const rows = await accounts(client, p.hash);
      expect(rows.map((r) => r.country_code)).toEqual([...ALL].sort());
      expect(new Set(rows.map((r) => r.org_id)).size).toBe(COUNTRIES.length);
    });
  });
});

describe('critère 1 — une personne, un compte d’hôte (par pays)', () => {
  it.each(byCountry)(
    '%s (%s) : seconde demande => HOST_ACCOUNT_EXISTS, aucun second compte ; deux demandes concurrentes => un seul compte',
    async (country) => {
      await withRole('app_api', async (client) => {
        const p = await person(client, country);
        expect((await open(client, p.hash, country)).outcome).toBe('DONE');
        expect(await open(client, p.hash, country)).toEqual({
          outcome: 'HOST_ACCOUNT_EXISTS',
          org_id: null,
        });
        expect(await hostRows(client, p.userId)).toHaveLength(1);
      });
      // concurrence : deux connexions, la même personne, le même pays
      await withRole('app_api', async (a) => {
        await withRole('app_api', async (b) => {
          const p = await person(a, country);
          const [x, y] = await Promise.all([open(a, p.hash, country), open(b, p.hash, country)]);
          expect([x.outcome, y.outcome].sort()).toEqual(['DONE', 'HOST_ACCOUNT_EXISTS']);
          expect(await hostRows(a, p.userId)).toHaveLength(1);
        });
      });
    },
  );
});

describe('critère 2 — particuliers seulement (DEC-FONDATEUR-13, BR-ACC-06)', () => {
  it.each(byCountry)(
    '%s (%s) : demande au nom d’une personne morale => HOST_ENTITY_NOT_ALLOWED, rien n’est écrit ; type absent ou inconnu : même refus',
    async (country) => {
      await withRole('app_api', async (client) => {
        const p = await person(client, country);
        for (const kind of ['LEGAL_ENTITY', 'COMPANY', '', 'individual']) {
          expect((await open(client, p.hash, country, kind)).outcome, kind).toBe(
            'HOST_ENTITY_NOT_ALLOWED',
          );
        }
        const { rows } = await client.query<Opened>(
          'SELECT * FROM core.iam_cmd_open_host_account($1, $2, NULL)',
          [p.hash, country],
        );
        expect(rows[0]?.outcome).toBe('HOST_ENTITY_NOT_ALLOWED');
        expect(await hostRows(client, p.userId)).toEqual([]);
      });
    },
  );

  it('la base refuse toute organisation qui ne serait pas celle d’une personne physique (contrainte de 0010)', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ def: string }>(
        `SELECT pg_catalog.pg_get_constraintdef(c.oid) AS def FROM pg_catalog.pg_constraint c
          WHERE c.conname = 'organization_kind_valid'`,
      );
      expect(rows[0]?.def).toBe("CHECK ((kind = 'P2P_HOST_INDIVIDUAL'::text))");
    });
  });
});

describe('éligibilité : session, compte vérifié, pays, âge (OQ-P2P-01)', () => {
  it.each(byCountry)(
    '%s (%s) : session invalide => AUTH_REQUIRED ; compte non vérifié ou restreint => HOST_ACCOUNT_NOT_ELIGIBLE ; pays inconnu => COUNTRY_UNKNOWN',
    async (country) => {
      await withRole('app_api', async (client) => {
        expect((await open(client, randomBytes(32), country)).outcome).toBe('AUTH_REQUIRED');
        for (const status of ['PENDING_EMAIL', 'RESTRICTED'] as const) {
          const p = await person(client, country, { status });
          expect((await open(client, p.hash, country)).outcome, status).toBe(
            'HOST_ACCOUNT_NOT_ELIGIBLE',
          );
          expect(await hostRows(client, p.userId)).toEqual([]);
        }
        const p = await person(client, country);
        for (const bad of ['ZZ', 'pa', 'PAN', '']) {
          expect((await open(client, p.hash, bad)).outcome, bad).toBe('COUNTRY_UNKNOWN');
        }
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : 20 ans révolus => HOST_UNDER_AGE ; 21 ans ce jour => DONE (host_min_age_years = 21)',
    async (country, _currency, c: CountryCase) => {
      await withRole('app_api', async (client) => {
        // « aujourd'hui » au fuseau du pays, lu de la base (platform.now(), 17 §1.3)
        const { rows } = await client.query<{ today: string }>(
          `SELECT ((platform.now() AT TIME ZONE $1)::date)::text AS today`,
          [c.timezone],
        );
        const today = rows[0]?.today ?? '';
        const yearsAgo = (n: number, dayShift = 0): string => {
          const d = new Date(`${today}T00:00:00Z`);
          d.setUTCFullYear(d.getUTCFullYear() - n);
          d.setUTCDate(d.getUTCDate() + dayShift);
          return d.toISOString().slice(0, 10);
        };
        const young = await person(client, country);
        // 21 ans demain : encore 20 ans
        await client.query('SELECT test_fixture.us107_set_birth_date($1, $2)', [
          young.userId,
          yearsAgo(21, 1),
        ]);
        expect((await open(client, young.hash, country)).outcome).toBe('HOST_UNDER_AGE');
        expect(await hostRows(client, young.userId)).toEqual([]);
        const adult = await person(client, country);
        await client.query('SELECT test_fixture.us107_set_birth_date($1, $2)', [
          adult.userId,
          yearsAgo(21),
        ]);
        expect((await open(client, adult.hash, country)).outcome).toBe('DONE');
      });
    },
  );
});

describe('critère 3 — compte d’hôte non ACTIVE : aucune réservation (HOST_NOT_ACTIVATED)', () => {
  it.each(byCountry)(
    '%s (%s) : véhicule d’un compte ONBOARDING => la pose réelle est refusée, aucun hold',
    async (country, _currency, c: CountryCase) => {
      await withRole('app_api', async (client) => {
        const host = await person(client, country);
        const r = await open(client, host.hash, country);
        expect(r.outcome).toBe('DONE');
        const guest = await person(client, country);
        const vehicle = uuid();
        await withTestTransaction(client, {}, async (tx) => {
          await registerVehicles(tx, [vehicle], r.org_id ?? '', c);
          const start = new Date(Date.now() + 3 * 86_400_000).toISOString();
          const end = new Date(Date.now() + 5 * 86_400_000).toISOString();
          let code = 'OK';
          try {
            await placeHoldCommand(tx, {
              slot: { vehicleId: vehicle, orgId: r.org_id ?? '', start, end, bufferHours: 0 },
              guestId: guest.userId,
            });
          } catch (error) {
            code = translateDbError(error).code;
          }
          expect(code).toBe('HOST_NOT_ACTIVATED');
        });
      });
    },
  );
});

describe('L1-PM-11 — RLS stricte entre hôtes : IDOR de l’hôte A contre l’hôte B', () => {
  it.each(byCountry)(
    '%s (%s) : A ne lit que son compte et son appartenance ; org_id de B forgé => 0 ligne ; aucune écriture directe ; ses comptes de session ne rendent jamais ceux de B',
    async (country) => {
      await withRole('app_api', async (client) => {
        const a = await person(client, country);
        const b = await person(client, country);
        const orgA = (await open(client, a.hash, country)).org_id ?? '';
        const orgB = (await open(client, b.hash, country)).org_id ?? '';
        expect(orgA).not.toBe(orgB);
        const read = async (actorId: string, orgId: string) =>
          withTestTransaction(client, {}, async (tx) => {
            await setSessionContext(tx, { kind: 'HOST', actorId, orgId });
            const orgs = await tx.query<{ id: string }>('SELECT id FROM core.iam_organization');
            const members = await tx.query<{ org_id: string; user_id: string }>(
              'SELECT org_id, user_id FROM core.iam_membership',
            );
            return {
              orgs: orgs.rows.map((r) => r.id),
              members: members.rows.map((r) => `${r.org_id}:${r.user_id}`),
            };
          });
        expect(await read(a.userId, orgA)).toEqual({
          orgs: [orgA],
          members: [`${orgA}:${a.userId}`],
        });
        expect(await read(b.userId, orgB)).toEqual({
          orgs: [orgB],
          members: [`${orgB}:${b.userId}`],
        });
        // contexte forgé : A pose l'org_id de B (et inversement) => rien
        expect(await read(a.userId, orgB)).toEqual({ orgs: [], members: [] });
        expect(await read(b.userId, orgA)).toEqual({ orgs: [], members: [] });
        // voyageur (sans contexte d'hôte) et session sans contexte : rien
        for (const ctx of [{ kind: 'GUEST', actorId: a.userId }] as const) {
          await withTestTransaction(client, {}, async (tx) => {
            await setSessionContext(tx, ctx);
            expect((await tx.query('SELECT id FROM core.iam_organization')).rows).toEqual([]);
            expect((await tx.query('SELECT id FROM core.iam_membership')).rows).toEqual([]);
          });
        }
        await withTestTransaction(client, {}, async (tx) => {
          expect((await tx.query('SELECT id FROM core.iam_organization')).rows).toEqual([]);
        });
        // écriture directe : refusée (42501), même sur son propre compte
        for (const sql of [
          `UPDATE core.iam_organization SET status = 'ACTIVE' WHERE id = $1`,
          `UPDATE core.iam_organization SET display_name = 'Empresa SA' WHERE id = $1`,
          `DELETE FROM core.iam_membership WHERE org_id = $1`,
        ]) {
          for (const target of [orgA, orgB]) {
            await withTestTransaction(client, {}, async (tx) => {
              await setSessionContext(tx, { kind: 'HOST', actorId: a.userId, orgId: orgA });
              await expect(tx.query(sql, [target]), sql).rejects.toMatchObject({ code: '42501' });
            });
          }
        }
        await withTestTransaction(client, {}, async (tx) => {
          await setSessionContext(tx, { kind: 'HOST', actorId: a.userId, orgId: orgA });
          await expect(
            tx.query(
              `INSERT INTO core.iam_membership (id, user_id, org_id, role, status)
               VALUES ($1, $2, $3, 'CO_HOST', 'ACTIVE')`,
              [uuid(), a.userId, orgB],
            ),
          ).rejects.toMatchObject({ code: '42501' });
        });
        // comptes de session : chacun les siens seulement
        expect((await accounts(client, a.hash)).map((r) => r.org_id)).toEqual([orgA]);
        expect((await accounts(client, b.hash)).map((r) => r.org_id)).toEqual([orgB]);
        // la commande de domaine et le gestionnaire de console ne sont pas exécutables par app_api
        for (const sql of [
          `SELECT * FROM core.iam_host_open_account($1, $2, 'INDIVIDUAL', $1, 'GUEST', 'SELF_SERVICE', NULL, NULL)`,
          `SELECT * FROM core.iam_manual_action_create_host_account('\\x00'::bytea, $1, 'CREATE_HOST_ACCOUNT', $1, '{}'::jsonb, 'motif assez long', $1, $2)`,
        ]) {
          await withTestTransaction(client, {}, async (tx) => {
            await expect(tx.query(sql, [b.userId, country]), sql).rejects.toMatchObject({
              code: '42501',
            });
          });
        }
      });
    },
  );

  it('même personne dans les deux pays : le contexte de son compte du premier pays ne lit rien de son compte du second (RLS-2, mono-pays)', async () => {
    await withRole('app_api', async (client) => {
      const p = await person(client, COUNTRIES[0].country);
      const orgs = [];
      for (const c of COUNTRIES) orgs.push((await open(client, p.hash, c.country)).org_id ?? '');
      for (const [i, org] of orgs.entries()) {
        await withTestTransaction(client, {}, async (tx) => {
          await setSessionContext(tx, { kind: 'HOST', actorId: p.userId, orgId: org });
          const { rows } = await tx.query<{ id: string; country_code: string }>(
            'SELECT id, country_code FROM core.iam_organization',
          );
          expect(rows).toEqual([{ id: org, country_code: COUNTRIES[i]?.country }]);
        });
      }
    });
  });

  it('app_worker et app_anon : aucune commande du compte d’hôte (42501)', async () => {
    for (const role of ['app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        for (const sql of [
          `SELECT * FROM core.iam_cmd_open_host_account('\\x00'::bytea, 'PA', 'INDIVIDUAL')`,
          `SELECT * FROM core.iam_host_accounts('\\x00'::bytea)`,
        ]) {
          await expect(client.query(sql), `${role} ${sql}`).rejects.toMatchObject({
            code: '42501',
          });
        }
      });
    }
  });
});

interface ActOutcome {
  readonly outcome: string;
  readonly action_id: string | null;
  readonly domain_ref: string | null;
  readonly detail: string | null;
}

/** Action de console sous le contexte STAFF de l'API (ADR-062, ADR-092), transaction validée. */
async function act(
  client: pg.ClientBase,
  staff: { readonly userId: string; readonly hash: Buffer },
  subject: string,
  scope: readonly string[] = ALL,
  requestId: string = uuid(),
): Promise<ActOutcome> {
  return withTestTransaction(client, { commit: true }, async (tx) => {
    await setSessionContext(tx, {
      kind: 'STAFF',
      actorId: staff.userId,
      countryScope: scope,
      sessionTokenHash: staff.hash.toString('hex'),
    });
    const { rows } = await tx.query<ActOutcome>(
      'SELECT * FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, $6::jsonb, $7::uuid[])',
      [staff.hash, requestId, 'CREATE_HOST_ACCOUNT', subject, REASON, {}, []],
    );
    return rows[0] ?? { outcome: '', action_id: null, domain_ref: null, detail: null };
  });
}

describe('action de console CREATE_HOST_ACCOUNT (cadre d’US-101, 17 §10)', () => {
  it.each(byCountry)(
    '%s (%s) : OPS du pays => DONE, compte ONBOARDING créé par l’OPS, manual_action et audit ; rejeu => DUPLICATE ; seconde demande => REFUSED HOST_ACCOUNT_EXISTS',
    async (country) => {
      await withRole('app_api', async (client) => {
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const p = await person(client, country);
        const requestId = uuid();
        const r = await act(client, ops, p.userId, [country], requestId);
        expect(r.outcome).toBe('DONE');
        const rows = await hostRows(client, p.userId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          org_id: r.domain_ref,
          kind: 'P2P_HOST_INDIVIDUAL',
          country_code: country,
          display_name: FIRST,
          tax_id: null,
          org_status: 'ONBOARDING',
          org_created_by: ops.userId,
          member_user: p.userId,
          member_role: 'P2P_HOST',
          member_status: 'ACTIVE',
        });
        const { rows: ma } = await client.query<{
          action_code: string;
          country_code: string;
          outcome: string;
          domain_ref: string;
        }>('SELECT * FROM test_fixture.us101_manual_action($1)', [requestId]);
        expect(ma[0]).toMatchObject({
          action_code: 'CREATE_HOST_ACCOUNT',
          country_code: country,
          outcome: 'DONE',
          domain_ref: r.domain_ref,
        });
        const audit = await auditOf(client, ops.userId);
        expect(audit.map((a) => a.action_code)).toEqual(
          expect.arrayContaining(['HOST_ACCOUNT_OPENED', 'MANUAL_ACTION_DONE']),
        );
        expect(audit.find((a) => a.action_code === 'HOST_ACCOUNT_OPENED')?.after).toMatchObject({
          country,
          source: 'CONSOLE',
        });
        // la personne porte le rôle d'hôte à sa reconnexion, comme en libre-service
        expect((await accounts(client, await session(client, p.userId))).length).toBe(1);
        // rejeu du même identifiant : DUPLICATE, aucun second compte
        expect((await act(client, ops, p.userId, [country], requestId)).outcome).toBe('DUPLICATE');
        const second = await act(client, ops, p.userId, [country]);
        expect(second).toMatchObject({ outcome: 'REFUSED', detail: 'HOST_ACCOUNT_EXISTS' });
        expect(await hostRows(client, p.userId)).toHaveLength(1);
        expect((await auditOf(client, ops.userId)).at(-1)?.action_code).toBe(
          'MANUAL_ACTION_REFUSED',
        );
        // la personne qui ouvre ensuite en libre-service dans ce pays : refusée
        expect((await open(client, p.hash, country)).outcome).toBe('HOST_ACCOUNT_EXISTS');
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : OPS d’un autre pays, FINANCE ou personne sans pays déclaré => FORBIDDEN journalisé, aucun compte ; compte non vérifié => REFUSED HOST_ACCOUNT_NOT_ELIGIBLE',
    async (country) => {
      await withRole('app_api', async (client) => {
        const other = ALL.find((x) => x !== country) ?? '';
        const opsOther = await elevatedStaff(client, 'OPS_AGENT', [other]);
        const finance = await elevatedStaff(client, 'FINANCE', [country]);
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const p = await person(client, country);
        expect((await act(client, opsOther, p.userId, [other])).outcome).toBe('FORBIDDEN');
        expect((await auditOf(client, opsOther.userId)).at(-1)?.action_code).toBe(
          'STAFF_FORBIDDEN',
        );
        expect((await act(client, finance, p.userId, [country])).outcome).toBe('FORBIDDEN');
        expect(await hostRows(client, p.userId)).toEqual([]);
        // sans pays déclaré à l'inscription : le résolveur ne rend rien, refus (fail-closed)
        const nowhere = await person(client, null);
        expect((await act(client, ops, nowhere.userId, [country])).outcome).toBe('FORBIDDEN');
        expect(await hostRows(client, nowhere.userId)).toEqual([]);
        const pending = await person(client, country, { status: 'PENDING_EMAIL' });
        expect(await act(client, ops, pending.userId, [country])).toMatchObject({
          outcome: 'REFUSED',
          detail: 'HOST_ACCOUNT_NOT_ELIGIBLE',
        });
        expect(await hostRows(client, pending.userId)).toEqual([]);
      });
    },
  );
});
