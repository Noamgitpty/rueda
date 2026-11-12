/**
 * Preuves des interrupteurs de mise en service par pays (US-125, migration 0070 ; RLS-27) sous les
 * rôles de PRODUCTION (assertion L0-05 en tête de chaque connexion : connectAs / withRole), au
 * Panama (USD) et au Paraguay (PYG). Chaque écriture à true se fait dans une transaction ANNULÉE ;
 * à la fin de chaque preuve, les quatre interrupteurs valent false.
 *
 * Attendus tirés de 19 US-125 (critères d'acceptation), de 17 §0.1, §2.3 (commandes à deux
 * personnes, trigger `param_value_go_live_guard`, matrice : ADMIN « demande », SUPERADMIN
 * « demande ou approbation, jamais les deux »), de RLS-27 et de la réserve 5 de la revue sécurité
 * US-056 (l'identité ne vient jamais d'un réglage de session), jamais du code testé :
 * - critère 1 : valeur absente, inconnue ou mal typée ⇒ false ;
 * - critère 2 : toute écriture directe d'une clé gardée, quelle que soit la casse, est refusée
 *   par le trigger (42501, contrainte `param_value_go_live_guard`) ;
 * - critère 3 : même personne (y compris dans une seconde session, ou avec un acteur forgé dans le
 *   contexte) ⇒ refus ; deux personnes distinctes ⇒ la valeur change, journalisée avec la
 *   référence de la décision écrite du fondateur ;
 * - critère 5 (base) : la table des demandes n'est lisible par aucun rôle applicatif ; un hôte ou
 *   un voyageur n'obtient rien des commandes.
 * Défauts fail-closed PROPOSÉS (ADR-101) : référence `DEC-FONDATEUR-n`, échéance de 72 h, demande
 * rejetée si le demandeur a perdu la permission, MFA exigée.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { setSessionContext } from '../../src/index.ts';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import {
  DECISION,
  SWITCHES,
  approveSwitch,
  freshSession,
  goLive,
  newHash,
  plusMinutes,
  requestSwitch,
} from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import { staff, staffSessionHash } from '../support/rls.ts';
import { auditOf, createStaff, login } from '../support/staff.ts';

const ALL = COUNTRIES.map((c) => c.country);
const code = (error: unknown): string => (error as { code?: string }).code ?? 'SANS_CODE';

let api: pg.Client;
const people: Record<string, StaffActor> = {};
const actor = (name: string): StaffActor => {
  const a = people[name];
  if (!a) throw new Error(`acteur ${name}`);
  return a;
};

beforeAll(async () => {
  api = await connectAs('app_api');
  const sessionOf = (id: string): Buffer => Buffer.from(staffSessionHash(id) ?? '', 'hex');
  await withTestTransaction(api, { commit: true }, async (tx) => {
    for (const [name, role, scope] of [
      ['admin', 'ADMIN', ALL],
      ['superB', 'SUPERADMIN', ALL],
      ['superC', 'SUPERADMIN', ALL],
      ['ops', 'OPS_AGENT', ALL],
    ] as const) {
      const id = await staff(tx, role, scope);
      people[name] = { userId: id, hash: sessionOf(id), scope };
    }
    // SUPERADMIN d'un seul pays, pour chaque pays
    for (const c of ALL) {
      const id = await staff(tx, 'SUPERADMIN', [c]);
      people[`super_${c}`] = { userId: id, hash: sessionOf(id), scope: [c] };
    }
    // ADMIN dont le rôle échoit dans une heure (demande rejetée à l'approbation)
    const expiring = await staff(tx, 'ADMIN', ALL, new Date(Date.now() + 3_600_000).toISOString());
    people['adminExpiring'] = { userId: expiring, hash: sessionOf(expiring), scope: ALL };
    // seconde session élevée de superB : la MÊME personne, un autre jeton
    const second = newHash();
    await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [
      actor('superB').userId,
      second,
    ]);
    people['superBSecond'] = { ...actor('superB'), hash: second };
  });
  // SUPERADMIN sans élévation (session NONE) ; personne sans aucun rôle interne
  const noMfa = await createStaff(api, 'SUPERADMIN', ALL, { withFactor: false });
  people['noMfa'] = { userId: noMfa.userId, hash: await login(api, noMfa.userId), scope: ALL };
  const plain = await createStaff(api, null, ALL, { withFactor: false });
  people['plain'] = { userId: plain.userId, hash: await login(api, plain.userId), scope: ALL };
});

afterAll(async () => {
  await releaseClient(api);
});

/** Les quatre interrupteurs valent false pour app_api et app_worker (hors transaction). */
async function allFalse(country: string): Promise<void> {
  const worker = await connectAs('app_worker');
  try {
    for (const client of [api, worker]) {
      for (const k of SWITCHES)
        expect(await goLive(client, k, country), `${k} ${country}`).toBe(false);
    }
  } finally {
    await releaseClient(worker);
  }
}

describe.each(COUNTRIES)('US-125 — interrupteurs de mise en service ($country, $currency)', (c) => {
  const other = ALL.find((x) => x !== c.country) as string;

  it('critère 1 : clé absente, inconnue, casse différente, pays inconnu ou NULL ⇒ false (fail-closed)', async () => {
    await withRole('app_api', async (client) => {
      for (const [key, country] of [
        ['payouts_enabled', c.country],
        ['PAYOUTS_ENABLED', c.country],
        ['payouts_enabled', c.country.toLowerCase()],
        ['payouts_enabled', 'ZZ'],
        ['no_such_switch', c.country],
        ['self_booking_forbidden', c.country],
        [null, null],
      ] as const) {
        const { rows } = await client.query<{ on: boolean }>(
          'SELECT core.config_go_live($1, $2) AS "on"',
          [key, country],
        );
        expect(rows[0]?.on, `${String(key)} ${String(country)}`).toBe(false);
      }
    });
  });

  it('critère 2 : INSERT, UPDATE multi-lignes, DELETE directs d’une clé gardée (toute casse) sous app_worker, avec ou sans contexte ⇒ trigger param_value_go_live_guard (42501) ; app_api ADMIN / SUPERADMIN sans droit d’écriture', async () => {
    const insert = (key: string, value: string): [string, unknown[]] => [
      `INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
       VALUES ($1, $2, 'COUNTRY', $3::jsonb, 'US-125 : écriture directe')`,
      [key, c.country, value],
    ];
    const attacks: [string, string, unknown[]][] = [
      ['INSERT true', ...insert('payouts_enabled', 'true')],
      ['INSERT false (même à false : procédure seulement)', ...insert('payouts_enabled', 'false')],
      ['INSERT clé en majuscules', ...insert('PAYOUTS_ENABLED', 'true')],
      ['INSERT clé en casse mixte', ...insert('Payouts_Enabled', 'false')],
      ['INSERT clé entourée de blancs', ...insert(' payouts_enabled ', 'true')],
      [
        'INSERT avec go_live_request_id forgé',
        `INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason,
                                              go_live_request_id, approved_by, decision_ref)
         VALUES ('payouts_enabled', $1, 'COUNTRY', 'true', 'forgé', $2, $3, $4)`,
        [c.country, randomUUID(), randomUUID(), DECISION],
      ],
      [
        'UPDATE multi-lignes (fermeture des quatre interrupteurs)',
        `UPDATE core.config_param_value SET valid_to = platform.now() + interval '1 day'
          WHERE key = ANY ($1::text[]) AND country_code = $2 AND valid_to IS NULL`,
        [[...SWITCHES], c.country],
      ],
      [
        'UPDATE de la valeur',
        `UPDATE core.config_param_value SET value = 'true' WHERE key = 'payouts_enabled'`,
        [],
      ],
      [
        'DELETE',
        `DELETE FROM core.config_param_value WHERE key = 'insurer_contract_active' AND country_code = $1`,
        [c.country],
      ],
    ];
    await withRole('app_worker', async (worker) => {
      for (const [label, sql, args] of attacks) {
        for (const ctx of ['sans contexte', 'travailleur nommé'] as const) {
          const err = await withTestTransaction(worker, {}, async (tx) => {
            if (ctx === 'travailleur nommé') {
              await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
            }
            try {
              await tx.query(sql, args);
              return null;
            } catch (error) {
              return error as { code?: string; constraint?: string };
            }
          });
          expect(err, `${label} — ${ctx}`).toMatchObject({
            code: '42501',
            constraint: 'param_value_go_live_guard',
          });
        }
      }
    });
    // app_api (ADMIN, SUPERADMIN de la portée) : aucun droit d'écriture sur la table
    await withRole('app_api', async (client) => {
      for (const who of [actor('admin'), actor('superB')]) {
        for (const [label, sql, args] of attacks) {
          const err = await withTestTransaction(client, {}, async (tx) => {
            await setSessionContext(tx, {
              kind: 'STAFF',
              actorId: who.userId,
              countryScope: who.scope,
              sessionTokenHash: who.hash.toString('hex'),
            });
            try {
              await tx.query(sql, args);
              return null;
            } catch (error) {
              return error;
            }
          });
          expect(code(err), `${label} — app_api`).toBe('42501');
        }
      }
    });
    await allFalse(c.country);
  });

  it('critère 3 : un acteur seul, la même personne deux fois (seconde session, acteur forgé) ⇒ refus journalisé ; ADMIN ne fait que demander ; deux personnes distinctes ⇒ valeur changée, journalisée avec la décision', async () => {
    await withTestTransaction(api, {}, async (tx) => {
      // un acteur seul : demande puis approbation par le même SUPERADMIN
      const own = await requestSwitch(tx, actor('superB'), 'payouts_enabled', c.country, true);
      expect(own.outcome).toBe('REQUESTED');
      const id = own.request_id as string;
      expect((await approveSwitch(tx, actor('superB'), id)).outcome).toBe('SELF_APPROVAL');
      // la même personne dans une seconde session
      expect((await approveSwitch(tx, actor('superBSecond'), id)).outcome).toBe('SELF_APPROVAL');
      // le jeton de superB avec l'identifiant de superC forgé dans le contexte : toujours superB
      expect((await approveSwitch(tx, actor('superB'), id, actor('superC').userId)).outcome).toBe(
        'SELF_APPROVAL',
      );
      expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(false);
      // une seconde demande sur la même clé : la première est encore en attente
      expect(
        (await requestSwitch(tx, actor('superC'), 'payouts_enabled', c.country, true)).outcome,
      ).toBe('ALREADY_PENDING');
      // l'ADMIN ne peut pas approuver ; OPS, SUPERADMIN d'un autre pays, staff sans TOTP, personne
      // sans rôle interne : refus, la demande reste en attente
      expect((await approveSwitch(tx, actor('admin'), id)).outcome).toBe('FORBIDDEN');
      expect((await approveSwitch(tx, actor('ops'), id)).outcome).toBe('FORBIDDEN');
      expect((await approveSwitch(tx, actor(`super_${other}`), id)).outcome).toBe('FORBIDDEN');
      expect((await approveSwitch(tx, actor('noMfa'), id)).outcome).toBe('MFA_REQUIRED');
      expect((await approveSwitch(tx, actor('plain'), id)).outcome).toBe('MFA_REQUIRED');
      expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(false);

      // deux personnes distinctes : superB a demandé, superC approuve
      expect((await approveSwitch(tx, actor('superC'), id)).outcome).toBe('APPLIED');
      expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(true);
      // un seul effet : la demande n'est plus en attente
      expect((await approveSwitch(tx, actor('superC'), id)).outcome).toBe('NOT_PENDING');
      // l'autre pays et les autres clés ne bougent pas
      expect(await goLive(tx, 'payouts_enabled', other)).toBe(false);
      for (const k of SWITCHES.filter((s) => s !== 'payouts_enabled')) {
        expect(await goLive(tx, k, c.country), k).toBe(false);
      }
      // version écrite avec la référence de la décision écrite du fondateur
      const { rows } = await tx.query<{ decision_ref: string; value: boolean }>(
        `SELECT decision_ref, value FROM core.config_param_value
          WHERE key = 'payouts_enabled' AND country_code = $1 AND valid_from <= platform.now()
          ORDER BY valid_from DESC LIMIT 1`,
        [c.country],
      );
      expect(rows[0]).toEqual({ decision_ref: DECISION, value: true });
      // journal : demande, refus d'auto-approbation, application (avec la décision et le demandeur)
      const byB = await auditOf(tx, actor('superB').userId);
      expect(byB.map((a) => a.action_code)).toEqual(
        expect.arrayContaining(['GO_LIVE_SWITCH_REQUESTED', 'GO_LIVE_SELF_APPROVAL_DENIED']),
      );
      expect(byB.filter((a) => a.action_code === 'GO_LIVE_SELF_APPROVAL_DENIED')).toHaveLength(3);
      const applied = (await auditOf(tx, actor('superC').userId)).find(
        (a) => a.action_code === 'GO_LIVE_SWITCH_APPLIED',
      );
      expect(applied).toMatchObject({
        actor_role: 'SUPERADMIN',
        subject_type: 'GO_LIVE_SWITCH',
        subject_id: id,
        reason: DECISION,
        before: { value: false },
        after: expect.objectContaining({
          key: 'payouts_enabled',
          country: c.country,
          value: true,
          decisionRef: DECISION,
          requestedBy: actor('superB').userId,
        }),
      });
      for (const who of ['admin', 'ops', `super_${other}`] as const) {
        expect(
          (await auditOf(tx, actor(who).userId)).map((a) => a.action_code),
          who,
        ).toContain('STAFF_FORBIDDEN');
      }
    });
    // transaction annulée : rien n'est resté
    await allFalse(c.country);
  });

  it('critère 3 : ADMIN demande, SUPERADMIN approuve ; refermer passe par la même procédure ; demande à false comprise', async () => {
    await withTestTransaction(api, {}, async (tx) => {
      const open = await requestSwitch(
        tx,
        actor('admin'),
        'insurer_contract_active',
        c.country,
        true,
      );
      expect(open.outcome).toBe('REQUESTED');
      expect((await approveSwitch(tx, actor('superB'), open.request_id as string)).outcome).toBe(
        'APPLIED',
      );
      expect(await goLive(tx, 'insurer_contract_active', c.country)).toBe(true);
      const close = await requestSwitch(
        tx,
        actor('superB'),
        'insurer_contract_active',
        c.country,
        false,
      );
      expect(close.outcome).toBe('REQUESTED');
      // la personne qui a ouvert ne peut pas refermer seule
      expect((await approveSwitch(tx, actor('superB'), close.request_id as string)).outcome).toBe(
        'SELF_APPROVAL',
      );
      expect((await approveSwitch(tx, actor('superC'), close.request_id as string)).outcome).toBe(
        'APPLIED',
      );
      expect(await goLive(tx, 'insurer_contract_active', c.country)).toBe(false);
    });
    await allFalse(c.country);
  });

  it('défauts PROPOSÉS : référence de décision mal formée, clé non gardée, pays inconnu ⇒ 22023 ; demande échue ⇒ EXPIRED ; demandeur sans droit à l’approbation ⇒ REJECTED ; hors portée ⇒ FORBIDDEN', async () => {
    const bad: [string, string, string][] = [
      ['payouts_enabled', c.country, 'décision orale'],
      ['payouts_enabled', c.country, 'DEC-FONDATEUR-'],
      ['self_booking_forbidden', c.country, DECISION],
      ['PAYOUTS_ENABLED', c.country, DECISION],
      ['payouts_enabled', 'ZZ', DECISION],
    ];
    for (const [key, country, decision] of bad) {
      const err = await withTestTransaction(api, {}, async (tx) =>
        requestSwitch(tx, actor('superB'), key, country, true, { decision }).then(
          () => null,
          (e: unknown) => e,
        ),
      );
      expect(code(err), `${key} ${country} ${decision}`).toBe('22023');
    }
    await withTestTransaction(api, {}, async (tx) => {
      // SUPERADMIN d'un autre pays : ne demande pas ici
      expect(
        (await requestSwitch(tx, actor(`super_${other}`), 'payouts_enabled', c.country, true))
          .outcome,
      ).toBe('FORBIDDEN');
      expect(
        (await requestSwitch(tx, actor('ops'), 'payouts_enabled', c.country, true)).outcome,
      ).toBe('FORBIDDEN');
      expect(
        (await requestSwitch(tx, actor('noMfa'), 'payouts_enabled', c.country, true)).outcome,
      ).toBe('MFA_REQUIRED');
      // échéance : une demande approuvée 73 h plus tard est EXPIRED, sans effet
      const r = await requestSwitch(tx, actor('admin'), 'funds_holding_enabled', c.country, true);
      expect(r.outcome).toBe('REQUESTED');
      const later = plusMinutes(new Date().toISOString(), 73 * 60);
      await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [later]);
      const approver = await freshSession(tx, actor('superC'));
      expect((await approveSwitch(tx, approver, r.request_id as string)).outcome).toBe('EXPIRED');
      expect(await goLive(tx, 'funds_holding_enabled', c.country)).toBe(false);
      // une demande échue ne bloque pas la suivante
      const requester = await freshSession(tx, actor('admin'));
      expect(
        (await requestSwitch(tx, requester, 'funds_holding_enabled', c.country, true)).outcome,
      ).toBe('REQUESTED');
    });
    await withTestTransaction(api, {}, async (tx) => {
      // le rôle du demandeur échoit avant l'approbation : demande rejetée, sans effet
      const r = await requestSwitch(
        tx,
        actor('adminExpiring'),
        'p2p_private_hosts_enabled',
        c.country,
        true,
      );
      expect(r.outcome).toBe('REQUESTED');
      await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
        plusMinutes(new Date().toISOString(), 120),
      ]);
      const approver = await freshSession(tx, actor('superC'));
      expect((await approveSwitch(tx, approver, r.request_id as string)).outcome).toBe('REJECTED');
      expect(await goLive(tx, 'p2p_private_hosts_enabled', c.country)).toBe(false);
    });
    await allFalse(c.country);
  });

  it('critère 5 (base) : la table des demandes n’est lisible par aucun rôle applicatif ; un voyageur ou un hôte n’obtient rien des commandes ; app_worker et app_anon sans EXECUTE', async () => {
    for (const role of ['app_api', 'app_worker'] as const) {
      await withRole(role, async (client) => {
        const err = await client
          .query('SELECT count(*) FROM core.config_go_live_switch_request')
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(code(err), role).toBe('42501');
      });
    }
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, {}, async (tx) => {
        const r = await requestSwitch(tx, actor('superB'), 'payouts_enabled', c.country, true);
        const id = r.request_id as string;
        // contexte voyageur ou hôte, avec le jeton d'une vraie session : aucune identité de staff
        for (const ctx of [
          { kind: 'GUEST', actorId: actor('plain').userId },
          {
            kind: 'HOST',
            actorId: actor('plain').userId,
            orgId: randomUUID(),
          },
        ] as const) {
          await setSessionContext(tx, ctx as Parameters<typeof setSessionContext>[1]);
          const { rows } = await tx.query<{ outcome: string }>(
            'SELECT outcome FROM core.config_cmd_approve_go_live_switch($1, $2)',
            [actor('plain').hash, id],
          );
          expect(rows[0]?.outcome, ctx.kind).toBe('AUTH_REQUIRED');
        }
        expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(false);
      });
    });
    for (const role of ['app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        for (const sql of [
          `SELECT * FROM core.config_cmd_request_go_live_switch($1, gen_random_uuid(), 'payouts_enabled', $2, true, $3)`,
          `SELECT * FROM core.config_cmd_approve_go_live_switch($1, gen_random_uuid())`,
        ]) {
          const params = sql.includes('request')
            ? [actor('superB').hash, c.country, DECISION]
            : [actor('superB').hash];
          const err = await client.query(sql, params).then(
            () => null,
            (e: unknown) => e,
          );
          expect(code(err), `${role} ${sql}`).toBe('42501');
        }
      });
    }
  });
});
