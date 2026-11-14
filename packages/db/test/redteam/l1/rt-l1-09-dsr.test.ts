/**
 * US-122 — red team du lot 1, passe n° 2, axe droits des personnes (RT-L1-D01 à D04 ; US-106,
 * US-111, US-036) : demande déposée pour le compte d'un autre, gel de demande abusif, effacement
 * du KYC qui ne reprend pas, retrait du consentement biométrique suivi d'une réservation, accès
 * qui révèle un tiers. Rôles de production seulement (assertion L0-05 par withRole), USD (PA) et
 * PYG (PY). Rapport : docs/team/redteam/L1-passe2.md.
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille trouvée (jamais
 * `skip`). Attendus : 19 US-111 (« délai et traitement sont suivis »), 16 LEG-009 / LEG-010 et
 * VER-004 (retrait du consentement : « effacement chez le fournisseur », « paiement refusé »),
 * 17 §10 (HANDLE_DSR : permission `data.export`, ADMIN), pré-mortem L1-PM-38 à L1-PM-40 (RT-L1-D01
 * à D04), BR-ACC-09. Limite écrite d'avance (17 §3.1.3, NN8, outil US-536) : l'effacement du
 * compte lui-même est une procédure manuelle du lot 5, jamais jouée ici comme une faille.
 */
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../../src/index.ts';
import { withRole, withTestTransaction } from '../../../src/testing/index.ts';
import { placeHoldCommand, registerVehicles } from '../../support/concurrency.ts';
import { person } from '../../support/kyc.ts';
import { auditOf, createStaff, installTestProofKey, login } from '../../support/staff.ts';
import { byCountry, hostOf, ops, otherOf, rolledBack, uuid } from './support.ts';
import type { Tx } from './support.ts';
import { act, bornYearsAgo, first, kycApprovedWithFacts } from './support-host.ts';
import { PURPOSE, supportCase } from './support-p2.ts';

const dsrRows = async (tx: Tx, caseId: string) =>
  (
    await tx.query<{ id: string; kind: string; status: string }>(
      'SELECT * FROM test_fixture.us111_dsr($1)',
      [caseId],
    )
  ).rows;

const OPEN = { kind: 'DELETION', step: 'RECEIVED' };

/** Personne dont l'identité est approuvée (consentement, session, rappel signé) : voyageur vérifié. */
async function verified(tx: Tx, country: string) {
  const p = await person(tx, country);
  await kycApprovedWithFacts(tx, p, country, {
    dateOfBirth: bornYearsAgo(30),
    residenceCountry: country,
  });
  return p;
}

describe.each(byCountry)(
  'RT-L1-D04 — demande déposée pour le compte d’un autre : usurpation, session volée (%s)',
  (country, _currency, cc) => {
    it('un voyageur (session sans rôle du staff) ne peut ni ouvrir ni traiter la demande d’un autre : refus, aucune ligne', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const victim = await person(tx, country);
        const attacker = await person(tx, country);
        const caseId = await supportCase(tx, country, victim.userId);
        const r = await act(
          tx,
          { userId: attacker.userId, hash: attacker.token },
          'HANDLE_DSR',
          caseId,
          { input: OPEN },
        );
        expect(r.outcome).not.toBe('DONE');
        expect(await dsrRows(tx, caseId)).toEqual([]);
      });
    });

    it.each(['SUPPORT_AGENT', 'OPS_AGENT', 'FINANCE'] as const)(
      '%s (sans data.export) : HANDLE_DSR refusé (FORBIDDEN), journalisé, aucune demande ouverte',
      async (role) => {
        await rolledBack(async (tx) => {
          const victim = await person(tx, country);
          const caseId = await supportCase(tx, country, victim.userId);
          const who = await ops(tx, role, [country]);
          const r = await act(tx, who, 'HANDLE_DSR', caseId, { input: OPEN });
          expect(r.outcome).toBe('FORBIDDEN');
          expect((await auditOf(tx, who.userId)).at(-1)?.action_code).toBe('STAFF_FORBIDDEN');
          expect(await dsrRows(tx, caseId)).toEqual([]);
        });
      },
    );

    it('ADMIN de l’autre pays : FORBIDDEN même si le contexte annonce tous les pays ; témoin : l’ADMIN du pays ouvre la demande', async () => {
      await rolledBack(async (tx) => {
        const victim = await person(tx, country);
        const caseId = await supportCase(tx, country, victim.userId);
        const foreign = await ops(tx, 'ADMIN', [otherOf(cc).country]);
        for (const scope of [[country], [otherOf(cc).country], [country, otherOf(cc).country]]) {
          const r = await act(tx, foreign, 'HANDLE_DSR', caseId, { input: OPEN, scope });
          expect(r.outcome, `contexte ${scope.join(',')}`).toBe('FORBIDDEN');
        }
        expect(await dsrRows(tx, caseId)).toEqual([]);
        const home = await ops(tx, 'ADMIN', [country]);
        expect((await act(tx, home, 'HANDLE_DSR', caseId, { input: OPEN })).outcome).toBe('DONE');
        expect(await dsrRows(tx, caseId)).toMatchObject([{ kind: 'DELETION', status: 'RECEIVED' }]);
      });
    });

    it('session du staff sans second facteur (session volée, niveau NONE) : MFA_REQUIRED, rien n’est ouvert ni effacé', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const victim = await person(tx, country);
        const caseId = await supportCase(tx, country, victim.userId);
        const admin = await createStaff(tx, 'ADMIN', [country]);
        const hash = await login(tx, admin.userId);
        const r = await act(tx, { userId: admin.userId, hash }, 'HANDLE_DSR', caseId, {
          input: OPEN,
        });
        expect(r.outcome).toBe('MFA_REQUIRED');
        expect(await dsrRows(tx, caseId)).toEqual([]);
      });
    });
  },
);

describe.each(byCountry)(
  'RT-L1-D01 — demande d’effacement : gel et conservation (%s)',
  (country, _currency, cc) => {
    it('F2-D-01 : une demande suspendue (BLOCKED_LEGAL_HOLD) passée son échéance reste signalée en retard (un gel sans fin ne rend pas la demande invisible)', async () => {
      await withRole('app_worker', async (w) => {
        await withTestTransaction(w, { virtualNow: '2033-03-01T10:00:00Z' }, async (tx) => {
          await tx.query(
            `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                    pg_catalog.set_config('app.worker_name', 'privacy_request', true)`,
          );
          const guest = uuid();
          const trip = uuid();
          await tx.query(
            `SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              trip,
              guest,
              uuid(),
              uuid(),
              cc.country,
              cc.currency,
              cc.timezone,
              '2033-02-20T10:00:00Z',
              '2033-02-25T10:00:00Z',
            ],
          );
          await tx.query('SELECT test_fixture.us111_legal_hold($1, $2)', [
            trip,
            'BLOCKED_LEGAL_HOLD',
          ]);
          const [before] = (
            await tx.query<{ status: string; due_at: Date; overdue_alerted_at: Date | null }>(
              'SELECT * FROM test_fixture.us122b_dsr_of_user($1)',
              [guest],
            )
          ).rows;
          expect(before).toMatchObject({ status: 'BLOCKED_LEGAL_HOLD', overdue_alerted_at: null });
          // trente jours après l'échéance : la demande est en retard, quelle que soit la raison du gel
          await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
            new Date((before?.due_at.getTime() ?? 0) + 30 * 86_400_000).toISOString(),
          ]);
          await tx.query('SELECT * FROM core.privacy_worker_dsr_overdue($1)', [10000]);
          const [after] = (
            await tx.query<{ overdue_alerted_at: Date | null }>(
              'SELECT * FROM test_fixture.us122b_dsr_of_user($1)',
              [guest],
            )
          ).rows;
          expect(after?.overdue_alerted_at, 'retard signalé malgré le gel').not.toBeNull();
        });
      });
    });

    it('L-L1-D-01 (limite écrite : NN8, outil US-536) : une demande DELETION close DONE n’a effacé ni pseudonymisé le compte', async () => {
      await rolledBack(async (tx) => {
        const requester = await person(tx, country);
        const caseId = await supportCase(tx, country, requester.userId);
        const admin = await ops(tx, 'ADMIN', [country]);
        for (const input of [OPEN, { step: 'IN_PROGRESS' }, { step: 'DONE' }]) {
          expect((await act(tx, admin, 'HANDLE_DSR', caseId, { input })).outcome).toBe('DONE');
        }
        expect(await dsrRows(tx, caseId)).toMatchObject([{ kind: 'DELETION', status: 'DONE' }]);
        const u = await first<{ pseudonymized_at: Date | null; legal_first_name: string }>(
          tx,
          'SELECT * FROM test_fixture.us122b_user($1)',
          [requester.userId],
        );
        // limite assumée : la procédure d'effacement est manuelle et tracée ailleurs (lot 5)
        expect(u.pseudonymized_at).toBeNull();
        expect(u.legal_first_name).toBe('Ana');
      });
    });
  },
);

describe.each(byCountry)(
  'RT-L1-D02 — retrait du consentement biométrique (%s)',
  (country, _currency, cc) => {
    const withdrawn = async (tx: Tx) => {
      const p = await verified(tx, country);
      const w = await first<{ outcome: string }>(
        tx,
        'SELECT * FROM core.kyc_cmd_biometric_consent($1, $2, $3, $4)',
        [p.token, country, 1, false],
      );
      expect(w.outcome).toBe('RECORDED');
      return p;
    };
    const pending = async (tx: Tx, token: Buffer) =>
      (
        await tx.query<{ request_id: string; provider: string; session_ref: string }>(
          'SELECT * FROM core.kyc_pending_erasures($1)',
          [token],
        )
      ).rows;

    it('témoin : le retrait pose une demande d’effacement au fournisseur ; un autre compte ne la voit pas et ne peut ni la clore ni la faire échouer', async () => {
      await rolledBack(async (tx) => {
        const a = await withdrawn(tx);
        const b = await person(tx, country);
        const [req] = await pending(tx, a.token);
        expect(req?.provider).toBeTruthy();
        expect(await pending(tx, b.token)).toEqual([]);
        for (const outcome of ['DONE', 'FAILED']) {
          const r = await first<{ outcome: string }>(
            tx,
            'SELECT * FROM core.kyc_cmd_record_erasure($1, $2, $3, $4)',
            [b.token, req?.request_id, outcome, outcome === 'DONE' ? 'attestation-forgee' : null],
          );
          expect(r.outcome, outcome).toBe('NOT_FOUND');
        }
        expect(await pending(tx, a.token)).toHaveLength(1);
      });
    });

    it('F2-D-02 : une demande d’effacement refusée par le fournisseur (FAILED) est reprise (elle redevient à traiter), jamais abandonnée', async () => {
      await rolledBack(async (tx) => {
        const a = await withdrawn(tx);
        const [req] = await pending(tx, a.token);
        expect(req).toBeTruthy();
        const failed = await first<{ outcome: string }>(
          tx,
          'SELECT * FROM core.kyc_cmd_record_erasure($1, $2, $3, $4)',
          [a.token, req?.request_id, 'FAILED', null],
        );
        expect(failed.outcome).toBe('RECORDED');
        // la personne retire de nouveau son consentement : aucune session à effacer de plus
        await tx.query('SELECT * FROM core.kyc_cmd_biometric_consent($1, $2, $3, $4)', [
          a.token,
          country,
          1,
          false,
        ]);
        expect(await pending(tx, a.token), 'demande à rejouer auprès du fournisseur').toHaveLength(
          1,
        );
      });
    });

    it('F2-D-03 (suite attendue d’US-209) : après le retrait du consentement biométrique, la pose d’un hold est refusée', async () => {
      await rolledBack(async (tx) => {
        const org = uuid();
        const vehicle = uuid();
        await tx.query('SELECT test_fixture.create_org($1, $2, $3)', [org, country, 'ACTIVE']);
        await registerVehicles(tx, [vehicle], org, cc);
        const pose = async (guest: string, day: number): Promise<string> => {
          const start = new Date(Date.now() + day * 86_400_000).toISOString();
          const end = new Date(Date.now() + (day + 2) * 86_400_000).toISOString();
          await tx.query('SAVEPOINT pose');
          try {
            await placeHoldCommand(tx, {
              slot: { vehicleId: vehicle, orgId: org, start, end, bufferHours: 0 },
              guestId: guest,
            });
            await tx.query('RELEASE SAVEPOINT pose');
            return 'OK';
          } catch (error) {
            await tx.query('ROLLBACK TO SAVEPOINT pose');
            return translateDbError(error).code;
          }
        };
        const kept = await verified(tx, country);
        const gone = await verified(tx, country);
        const w = await first<{ outcome: string }>(
          tx,
          'SELECT * FROM core.kyc_cmd_biometric_consent($1, $2, $3, $4)',
          [gone.token, country, 1, false],
        );
        expect(w.outcome).toBe('RECORDED');
        // témoin : l'identité approuvée et consentante réserve
        expect(await pose(kept.userId, 3)).toBe('OK');
        // attaque : l'identité dont le consentement est retiré (KYC en RECHECK) ne réserve pas
        expect(await pose(gone.userId, 8), 'pose après retrait du consentement').not.toBe('OK');
      });
    });
  },
);

describe.each(byCountry)(
  'RT-L1-D03 — accès : la fiche remise à la personne ne révèle aucun tiers (%s)',
  (country, _currency, cc) => {
    it('fiche 360° d’un hôte dont un trip cite un voyageur : l’identité du voyageur n’y figure pas ; témoin : la fiche est servie et porte le compte de l’hôte', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const host = await hostOf(tx, country, { first: 'Hortensia', last: 'Ferreira' });
        const guest = await person(tx, country, { first: 'Gaspar', last: 'Quispe' });
        await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
          uuid(),
          guest.userId,
          host.org,
          uuid(),
          cc.country,
          cc.currency,
          cc.timezone,
          new Date(Date.now() + 5 * 86_400_000).toISOString(),
          new Date(Date.now() + 8 * 86_400_000).toISOString(),
        ]);
        const admin = await ops(tx, 'ADMIN', [country]);
        const r = await first<{ outcome: string; body: unknown }>(
          tx,
          'SELECT * FROM core.support_staff_profile($1, $2, $3, $4)',
          [admin.hash, uuid(), host.userId, PURPOSE],
        );
        expect(r.outcome).toBe('GRANTED');
        const text = JSON.stringify(r.body);
        expect(text).toContain(host.org);
        for (const secret of [guest.userId, 'Gaspar', 'Quispe']) {
          expect(text, `donnée du voyageur « ${secret} »`).not.toContain(secret);
        }
      });
    });

    it('fiche d’une personne : les notes internes écrites sur un autre compte ne figurent jamais dans la sienne', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const me = await person(tx, country);
        const other = await person(tx, country);
        const admin = await ops(tx, 'ADMIN', [country]);
        const note = await first<{ outcome: string }>(
          tx,
          'SELECT * FROM core.support_staff_add_note($1, $2, $3, $4)',
          [admin.hash, uuid(), other.userId, 'Note interne sur un autre compte, secret-d-un-tiers'],
        );
        expect(note.outcome).toBe('ADDED');
        const r = await first<{ outcome: string; body: unknown }>(
          tx,
          'SELECT * FROM core.support_staff_profile($1, $2, $3, $4)',
          [admin.hash, uuid(), me.userId, PURPOSE],
        );
        expect(r.outcome).toBe('GRANTED');
        expect(JSON.stringify(r.body)).not.toContain('secret-d-un-tiers');
        expect(JSON.stringify(r.body)).not.toContain(other.userId);
      });
    });
  },
);
