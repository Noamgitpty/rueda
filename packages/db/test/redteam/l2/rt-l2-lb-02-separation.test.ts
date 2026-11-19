/**
 * US-222c — red team du lot 2, ex-porte LB (19 US-222 critère 3) RT-L2-LB04 et rejeu de RLS-24 et
 * RLS-27 : « bordereau de l'assureur émis par une seule personne » (même session, seconde session,
 * second compte, co-hôte, compte lié) et interrupteur de mise en service ouvert par une seule
 * personne, sous le rôle de PRODUCTION app_api (`rolledBack` → `withRole` : assertion L0-05), en
 * USD (PA) et en PYG (PY), transactions ANNULÉES. TESTS SEULEMENT (L2-PM-39).
 *
 * Attendus (jamais le code testé) : 17 §2.3 et RLS-24 (« approbation par A refusée (auto-validation,
 * même dans une autre session), journalisée, aucun effet d'argent ; approbation par B : effet
 * appliqué, `decided_by` ≠ `decision_second_by` ; UPDATE direct refusé (42501) ») ; RLS-27
 * (« auto-approbation refusée ; succès seulement avec demande et approbation de deux personnes
 * distinctes ») ; ADR-122 (garde unique de séparation des tâches : la personne, les personnes de ses
 * comptes d'hôte, un compte lié LINKED) ; pré-mortem du lot 2, RT-L2-LB04 (« second compte, co-hôte,
 * compte lié : refus »), L2-PM-11. Le bordereau est celui de la fixture 9700 / 9947 (DRAFT, période
 * sans mois : la garde d'émission d'US-227 ne s'applique pas, elle est éprouvée par l0-us227).
 *
 * Constats (`it.fails` documentés, docs/team/redteam/L2-rls-lb.md) :
 * - F-L2-LB-01 : l'approbation FINANCE (`settlement_cmd_approve_finance_action`) ne compare que
 *   l'identifiant du demandeur et de l'approbateur ; pour ISSUE_BORDEREAU, le sujet n'a aucune partie
 *   (0119 : `INSURER_BORDEREAU` → `{}`), si bien qu'un second compte de la même personne (lien
 *   LINKED constaté par l'ops) ou le co-hôte du compte d'hôte du demandeur émet le bordereau ;
 * - F-L2-LB-02 : même défaut pour `config_cmd_approve_go_live_switch` (0073 : `requested_by` ≠
 *   approbateur seulement) : l'interrupteur s'ouvre (dans la transaction annulée) par un SUPERADMIN
 *   lié au demandeur.
 * Interrupteur : ouvert seulement dans la transaction annulée, par la procédure à deux personnes
 * (`support/golive.ts` : tête d'audit puis verrou consultatif), relu fermé après l'annulation.
 */
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../../src/index.ts';
import { withRole, withTestTransaction } from '../../../src/testing/index.ts';
import { approveSwitch, goLive, requestSwitch } from '../../support/golive.ts';
import type { StaffActor } from '../../support/golive.ts';
import { auditOf, installTestProofKey } from '../../support/staff.ts';
import { outcomeOf } from '../l1/support-host.ts';
import { cohost, decideLink, staffPerson } from '../l1/support-p2.ts';
import { byCountry, otherOf, rolledBack, uuid } from '../l1/support.ts';
import type { Tx } from '../l1/support.ts';
import { failure, newSessionHash } from './support-l2.ts';

const REASON = 'Bordereau mensuel de l’assureur, contrôle de la red team';
const REQUEST = 'SELECT * FROM core.settlement_cmd_request_finance_action($1, $2, $3, $4, $5)';
const APPROVE = 'SELECT * FROM core.settlement_cmd_approve_finance_action($1, $2)';

interface Who {
  readonly userId: string;
  readonly hash: Buffer;
}

/** Une instruction sous le contexte STAFF que pose l'API ; erreur rendue `ERR:<code>`. */
async function finance(
  tx: Tx,
  who: Who,
  country: string,
  sql: string,
  params: readonly unknown[],
): Promise<string> {
  await setSessionContext(tx, {
    kind: 'STAFF',
    actorId: who.userId,
    countryScope: [country],
    sessionTokenHash: who.hash.toString('hex'),
  });
  return outcomeOf(tx, sql, [who.hash, ...params]);
}

/** Bordereau DRAFT du pays (fixture), demandé par `requester` ; rend bordereau et demande. */
async function requested(
  tx: Tx,
  country: string,
  currency: string,
  requester: Who,
): Promise<{ bordereau: string; approval: string }> {
  const bordereau = uuid();
  await tx.query('SELECT test_fixture.us062_insert_bordereau($1, $2, $3, $4::bigint)', [
    bordereau,
    country,
    currency,
    '100',
  ]);
  const approval = uuid();
  expect(
    await finance(tx, requester, country, REQUEST, [
      approval,
      'ISSUE_BORDEREAU',
      bordereau,
      REASON,
    ]),
  ).toBe('REQUESTED');
  return { bordereau, approval };
}

const bordereauRow = async (tx: Tx, id: string) =>
  (
    await tx.query<{
      status: string;
      issued_by: string | null;
      second_validated_by: string | null;
    }>('SELECT status, issued_by, second_validated_by FROM test_fixture.us062_bordereau_row($1)', [
      id,
    ])
  ).rows[0];

/** Compte d'hôte ACTIVE dont `holder` est titulaire (fixture d'US-127). */
async function orgOf(tx: Tx, holder: string, country: string): Promise<string> {
  const org = uuid();
  await tx.query('SELECT test_fixture.us127_create_org_for($1, $2, $3)', [org, holder, country]);
  return org;
}

/** Les deux variantes de F-L2-LB-01 : l'approbateur est la même personne, ou un associé. */
const VARIANTS = {
  'second compte de la même personne (lien LINKED constaté par l’ops)': async (
    tx: Tx,
    a: Who,
    b: Who,
    country: string,
  ) => {
    expect(country).not.toBe('');
    expect((await decideLink(tx, null, a.userId, b.userId, 'LINKED')).outcome).toBe('RECORDED');
  },
  'co-hôte du compte d’hôte du demandeur': async (tx: Tx, a: Who, b: Who, country: string) => {
    await cohost(tx, b.userId, await orgOf(tx, a.userId, country));
  },
} as const;

describe.each(byCountry)(
  'RT-L2-LB04 — bordereau de l’assureur (%s, %s)',
  (country, currency, cc) => {
    it('RLS-24 rejoué : A demande puis approuve dans la même session et dans une seconde session ⇒ SELF_APPROVAL journalisé ; FINANCE d’un autre pays et OPS_AGENT ⇒ FORBIDDEN ; UPDATE direct du bordereau et de la demande ⇒ 42501 ; B approuve ⇒ ISSUED, émis par A, validé par B', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const a = await staffPerson(tx, country, 'FINANCE');
        const b = await staffPerson(tx, country, 'FINANCE');
        const foreign = await staffPerson(tx, otherOf(cc).country, 'FINANCE');
        const opsAgent = await staffPerson(tx, country, 'OPS_AGENT');
        const r = await requested(tx, country, currency, a);
        expect(await finance(tx, a, country, APPROVE, [r.approval])).toBe('SELF_APPROVAL');
        const second = { userId: a.userId, hash: await newSessionHash(tx, a.userId) };
        expect(await finance(tx, second, country, APPROVE, [r.approval])).toBe('SELF_APPROVAL');
        const audit = (await auditOf(tx, a.userId)).map((x) => x.action_code);
        expect(audit.filter((x) => x === 'FINANCE_SELF_APPROVAL_DENIED')).toHaveLength(2);
        expect(await finance(tx, foreign, country, APPROVE, [r.approval])).toBe('FORBIDDEN');
        expect(await finance(tx, opsAgent, country, APPROVE, [r.approval])).toBe('FORBIDDEN');
        // écritures directes sous le contexte FINANCE de A : refusées, rien ne change
        await setSessionContext(tx, {
          kind: 'STAFF',
          actorId: a.userId,
          countryScope: [country],
          sessionTokenHash: a.hash.toString('hex'),
        });
        for (const [sql, params] of [
          [
            `UPDATE core.settlement_insurer_bordereau
              SET status = 'ISSUED', issued_by = $2, second_validated_by = $2 WHERE id = $1`,
            [r.bordereau, a.userId],
          ],
          [
            `UPDATE core.settlement_finance_approval SET status = 'APPROVED', approved_by = $2
            WHERE id = $1`,
            [r.approval, a.userId],
          ],
        ] as const) {
          expect(await failure(tx, sql, params), sql).toMatchObject({ code: '42501' });
        }
        expect(await bordereauRow(tx, r.bordereau)).toMatchObject({ status: 'DRAFT' });
        // témoin : une seconde personne sans lien émet le bordereau
        expect(await finance(tx, b, country, APPROVE, [r.approval])).toBe('APPROVED');
        expect(await bordereauRow(tx, r.bordereau)).toEqual({
          status: 'ISSUED',
          issued_by: a.userId,
          second_validated_by: b.userId,
        });
      });
    });

    for (const [label, relate] of Object.entries(VARIANTS)) {
      it(`attaque jouée — ${label} : A demande ISSUE_BORDEREAU, B approuve ; observation (F-L2-LB-01)`, async () => {
        await rolledBack(async (tx) => {
          await installTestProofKey(tx);
          const a = await staffPerson(tx, country, 'FINANCE');
          const b = await staffPerson(tx, country, 'FINANCE');
          await relate(tx, a, b, country);
          const r = await requested(tx, country, currency, a);
          // l'attaque a eu lieu : l'approbation est jugée (issue notée au rapport : APPROVED)
          expect(['APPROVED', 'SELF_FORBIDDEN']).toContain(
            await finance(tx, b, country, APPROVE, [r.approval]),
          );
        });
      });

      // F-L2-LB-01 (élevée, PROPOSÉE) : l'approbateur d'une décision FINANCE ne doit être ni le
      // demandeur, ni une personne de ses comptes d'hôte, ni un compte lié (garde ADR-122 appliquée au
      // DEMANDEUR : `support_actor_conflict(approbateur, 'USER_ACCOUNT', demandeur)`). Signal attendu
      // après correction : SELF_FORBIDDEN, bordereau resté DRAFT, sans émetteur.
      it.fails(
        `F-L2-LB-01 — ${label} : l’approbation est refusée (SELF_FORBIDDEN), le bordereau reste DRAFT`,
        async () => {
          await rolledBack(async (tx) => {
            await installTestProofKey(tx);
            const a = await staffPerson(tx, country, 'FINANCE');
            const b = await staffPerson(tx, country, 'FINANCE');
            await relate(tx, a, b, country);
            const r = await requested(tx, country, currency, a);
            expect(await finance(tx, b, country, APPROVE, [r.approval])).toBe('SELF_FORBIDDEN');
            expect(await bordereauRow(tx, r.bordereau)).toEqual({
              status: 'DRAFT',
              issued_by: null,
              second_validated_by: null,
            });
          });
        },
      );
    }
  },
);

describe.each(byCountry)('RLS-27 rejoué — interrupteur à deux personnes (%s, %s)', (country) => {
  const KEY = 'p2p_private_hosts_enabled';
  const actor = (w: Who): StaffActor => ({ userId: w.userId, hash: w.hash, scope: [country] });

  /** Demande par un ADMIN, approbation par un SUPERADMIN (lié ou non), dans la transaction annulée. */
  const play = (linked: boolean) =>
    rolledBack(async (tx) => {
      await installTestProofKey(tx);
      const a = await staffPerson(tx, country, 'ADMIN');
      const b = await staffPerson(tx, country, 'SUPERADMIN');
      if (linked) {
        expect((await decideLink(tx, null, a.userId, b.userId, 'LINKED')).outcome).toBe('RECORDED');
      }
      const r = await requestSwitch(tx, actor(a), KEY, country, true);
      expect(r.outcome).toBe('REQUESTED');
      const approved = await approveSwitch(tx, actor(b), r.request_id ?? '');
      return { outcome: approved.outcome, open: await goLive(tx, KEY, country) };
    });

  /** Après l'annulation : l'interrupteur est fermé pour tout lecteur. */
  const closedAfter = async () => {
    const open = await withRole('app_api', (client) =>
      withTestTransaction(client, {}, (tx) => goLive(tx, KEY, country)),
    );
    expect(open).toBe(false);
  };

  it('témoin : deux personnes sans lien ⇒ APPLIED dans la transaction annulée, fermé après ; attaque jouée : SUPERADMIN lié (LINKED) au demandeur ; observation (F-L2-LB-02)', async () => {
    expect(await play(false)).toEqual({ outcome: 'APPLIED', open: true });
    await closedAfter();
    const linked = await play(true);
    expect(['APPLIED', 'SELF_FORBIDDEN', 'SELF_APPROVAL', 'FORBIDDEN']).toContain(linked.outcome);
    await closedAfter();
  });

  // F-L2-LB-02 (élevée, PROPOSÉE) : la décision écrite du fondateur passe par deux personnes
  // DISTINCTES (DEC-FONDATEUR-15, RLS-27) ; un compte lié au demandeur est la même personne (ADR-122).
  // Signal attendu après correction : approbation refusée (issue autre que APPLIED), interrupteur
  // resté fermé dans la transaction même.
  it.fails(
    'F-L2-LB-02 — SUPERADMIN lié (LINKED) au demandeur : l’approbation est refusée, l’interrupteur reste fermé',
    async () => {
      const linked = await play(true);
      await closedAfter();
      expect(linked.outcome).not.toBe('APPLIED');
      expect(linked.open).toBe(false);
    },
  );
});
