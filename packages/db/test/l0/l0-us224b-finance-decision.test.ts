/**
 * US-224 (partie 224b, migration 0123, ADR-147) — décision FINANCE à deux personnes sur l'avance de
 * Kmino (19 US-224, critère 4 et DoR (2) ; BOARD N-119) : `DECIDE_ADVANCE` sur une avance PLANNED
 * (sujet que crée l'instance de remboursement, règle 3 bis) ; le conflit du DEMANDEUR est rejugé à
 * l'approbation (il est devenu co-hôte du compte de l'avance, ou compte lié à son titulaire, depuis
 * sa demande) ; l'approbateur titulaire, co-hôte ou lié est refusé de même ; issue unique
 * `SELF_FORBIDDEN` (403 `STAFF_SELF_FORBIDDEN` côté API, console.controller).
 *
 * Vraies commandes `core.settlement_cmd_request_finance_action` / `..._approve_finance_action`
 * sous app_api (rôle de PRODUCTION, assertion L0-05 : withRole), contexte STAFF posé par la vraie
 * couche, personnes et hôtes créés par les vraies commandes (aides de la red team du lot 1) ;
 * transactions annulées ; PA (USD) et PY (PYG). Attendus : 17 §2.3 (RLS-24, deux personnes
 * distinctes, « un agent ne décide pas sur son propre dossier »), 19 US-224 DoR (2), ADR-124.
 */
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import { installTestProofKey } from '../support/staff.ts';
import { byCountry, hostOf, ops, rolledBack, uuid } from '../redteam/l1/support.ts';
import type { Tx } from '../redteam/l1/support.ts';
import { outcomeOf } from '../redteam/l1/support-host.ts';
import { cohost, decideLink, staffPerson } from '../redteam/l1/support-p2.ts';

const REASON = 'Décision FINANCE motivée pour le test US-224b';
const REQUEST = 'SELECT * FROM core.settlement_cmd_request_finance_action($1, $2, $3, $4, $5)';
const APPROVE = 'SELECT * FROM core.settlement_cmd_approve_finance_action($1, $2)';

describe.each(byCountry)(
  'N-119 — décision FINANCE à deux personnes sur l’avance de Kmino (%s)',
  (country, _currency, cc) => {
    const finance = async (
      tx: Tx,
      who: { userId: string; hash: Buffer },
      sql: string,
      params: readonly unknown[],
    ): Promise<string> => {
      await setSessionContext(tx, {
        kind: 'STAFF',
        actorId: who.userId,
        countryScope: [country],
        sessionTokenHash: who.hash.toString('hex'),
      });
      return outcomeOf(tx, sql, [who.hash, ...params]);
    };

    /** Avance PLANNED (fixture 9955, comme la crée l'instance) sur un trip du compte `org`. */
    async function plannedAdvance(tx: Tx, org: string): Promise<string> {
      const trip = uuid();
      const advance = uuid();
      await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
        trip,
        uuid(),
        org,
        uuid(),
        cc.country,
        cc.currency,
        cc.timezone,
        new Date(Date.now() + 5 * 86_400_000).toISOString(),
        new Date(Date.now() + 8 * 86_400_000).toISOString(),
      ]);
      await tx.query('SELECT test_fixture.us224b_insert_planned_advance($1, $2, $3::bigint)', [
        advance,
        trip,
        '7500',
      ]);
      return advance;
    }

    const advanceRow = async (tx: Tx, id: string) =>
      (
        await tx.query<{
          status: string;
          decided_by: string | null;
          decision_second_by: string | null;
        }>(
          'SELECT status, decided_by, decision_second_by FROM test_fixture.us062_advance_row($1)',
          [id],
        )
      ).rows[0];
    const approvalRow = async (tx: Tx, id: string) =>
      (
        await tx.query<{ status: string; requested_by: string; approved_by: string | null }>(
          'SELECT status, requested_by, approved_by FROM test_fixture.us062_approval_row($1)',
          [id],
        )
      ).rows[0];

    it('avance PLANNED : le demandeur n’approuve pas sa propre demande (SELF_APPROVAL) ; une seconde personne FINANCE l’approuve ; la décision recopie les deux personnes, l’avance reste PLANNED (aucun fonds)', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const owner = await hostOf(tx, country);
        const advance = await plannedAdvance(tx, owner.org);
        const a = await ops(tx, 'FINANCE', [country]);
        const b = await ops(tx, 'FINANCE', [country]);
        const approval = uuid();
        expect(await finance(tx, a, REQUEST, [approval, 'DECIDE_ADVANCE', advance, REASON])).toBe(
          'REQUESTED',
        );
        expect(await finance(tx, a, APPROVE, [approval])).toBe('SELF_APPROVAL');
        expect(await advanceRow(tx, advance)).toEqual({
          status: 'PLANNED',
          decided_by: null,
          decision_second_by: null,
        });
        expect(await finance(tx, b, APPROVE, [approval])).toBe('APPROVED');
        expect(await advanceRow(tx, advance)).toEqual({
          status: 'PLANNED',
          decided_by: a.userId,
          decision_second_by: b.userId,
        });
        expect(await approvalRow(tx, approval)).toEqual({
          status: 'APPROVED',
          requested_by: a.userId,
          approved_by: b.userId,
        });
      });
    });

    it.each(['co-hôte du compte de l’avance', 'compte lié au titulaire'] as const)(
      'N-119 : le demandeur devenu %s après sa demande ⇒ l’approbation par une autre personne est refusée (SELF_FORBIDDEN), la demande REJECTED, aucune décision',
      async (link) => {
        await rolledBack(async (tx) => {
          await installTestProofKey(tx);
          const owner = await hostOf(tx, country);
          const advance = await plannedAdvance(tx, owner.org);
          const requester = await staffPerson(tx, country, 'FINANCE');
          const approver = await ops(tx, 'FINANCE', [country]);
          const approval = uuid();
          expect(
            await finance(tx, requester, REQUEST, [approval, 'DECIDE_ADVANCE', advance, REASON]),
          ).toBe('REQUESTED');
          if (link === 'co-hôte du compte de l’avance') {
            await cohost(tx, requester.userId, owner.org);
          } else {
            expect(
              (await decideLink(tx, null, requester.userId, owner.userId, 'LINKED')).outcome,
            ).toBe('RECORDED');
          }
          expect(await finance(tx, approver, APPROVE, [approval])).toBe('SELF_FORBIDDEN');
          expect(await approvalRow(tx, approval)).toMatchObject({
            status: 'REJECTED',
            approved_by: null,
          });
          expect(await advanceRow(tx, advance)).toEqual({
            status: 'PLANNED',
            decided_by: null,
            decision_second_by: null,
          });
          // une nouvelle demande par une personne sans lien reste possible (aucune demande en attente)
          const clean = await ops(tx, 'FINANCE', [country]);
          expect(
            await finance(tx, clean, REQUEST, [uuid(), 'DECIDE_ADVANCE', advance, REASON]),
          ).toBe('REQUESTED');
        });
      },
    );

    it.each(['co-hôte du compte de l’avance', 'compte lié au titulaire'] as const)(
      'l’approbateur %s ⇒ SELF_FORBIDDEN, la demande reste en attente, aucune décision',
      async (link) => {
        await rolledBack(async (tx) => {
          await installTestProofKey(tx);
          const owner = await hostOf(tx, country);
          const advance = await plannedAdvance(tx, owner.org);
          const requester = await ops(tx, 'FINANCE', [country]);
          const approver = await staffPerson(tx, country, 'FINANCE');
          if (link === 'co-hôte du compte de l’avance') {
            await cohost(tx, approver.userId, owner.org);
          } else {
            expect(
              (await decideLink(tx, null, approver.userId, owner.userId, 'LINKED')).outcome,
            ).toBe('RECORDED');
          }
          const approval = uuid();
          expect(
            await finance(tx, requester, REQUEST, [approval, 'DECIDE_ADVANCE', advance, REASON]),
          ).toBe('REQUESTED');
          expect(await finance(tx, approver, APPROVE, [approval])).toBe('SELF_FORBIDDEN');
          expect(await approvalRow(tx, approval)).toMatchObject({ status: 'PENDING' });
          expect(await advanceRow(tx, advance)).toMatchObject({ decided_by: null });
        });
      },
    );
  },
);
