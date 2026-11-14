/**
 * US-122 — correctifs de la red team du lot 1 (migration 0093, ADR-122) : preuves de NON-RÉGRESSION
 * qui complètent les attaques rt-l1-01 à rt-l1-07 (jamais modifiées). Rôles de production seulement
 * (assertion L0-05 par withRole), USD (PA) et PYG (PY). Rapport : docs/team/redteam/L1-rls-abus.md,
 * section « Correctifs ».
 *
 * - F-L1-C-01 à C-03 : la garde UNIQUE de séparation des tâches (`core.support_actor_conflict`)
 *   refuse SELF_FORBIDDEN à un membre du staff qui est titulaire, co-hôte, personne vérifiée,
 *   demandeur, titulaire du véhicule contesté, ou compte LIÉ (constat LINKED d'US-127) du sujet, pour
 *   CHAQUE action de console qui porte sur un compte, un véhicule, une annonce, un dossier KYC, une
 *   contestation ou une demande ; témoin : un agent sans lien est servi (la garde n'est pas vide).
 * - F-L1-S-01 : sac de mots et inclusion ; témoin d'innocence : deux personnes de même naissance
 *   dont les noms ne s'incluent pas réservent normalement.
 * - F-L1-V-01 : plafond PROPOSÉ du pays (`plate_claims_open_per_host`, graine 0094).
 *
 * Attendus : 17 §2.3 (« un agent ne décide pas sur son propre dossier », RLS-24), 16 ACC-014,
 * ADM-001 ; 19 US-122 ; jamais le code testé (les valeurs des paramètres sont lues dans les
 * données CFG).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../../src/index.ts';
import { placeHoldCommand, registerVehicles } from '../../support/concurrency.ts';
import { auditOf, installTestProofKey } from '../../support/staff.ts';
import {
  checks,
  elevateAs,
  itemsOf as kycItems,
  person,
  staff as kycStaff,
  toReview,
} from '../../support/kyc.ts';
import {
  ALL,
  byCountry,
  countryRules,
  hostOf,
  ops,
  paramValues,
  plate,
  rolledBack,
  uuid,
  vehicleOf,
} from './support.ts';
import type { CountryCase, Host, Tx } from './support.ts';
import { act, claimItem, first, hostState, itemsOf, readyHost } from './support-host.ts';

const SCREEN = { unList: 'CLEAR', ofacList: 'CLEAR', nationalList: 'CLEAR' };
const PURPOSE = 'Contrôle du dossier pour une décision de l’ops';

const SELF = { outcome: 'REFUSED', detail: 'SELF_FORBIDDEN' };

/** Co-hôte ACTIVE du compte `org` (fixture d'US-011). */
const cohost = (tx: Tx, user: string, org: string) =>
  tx.query(`SELECT test_fixture.iam_insert_membership($1, $2, $3, 'CO_HOST', '{}'::uuid[], $4)`, [
    uuid(),
    user,
    org,
    'ACTIVE',
  ]);

/** Constat LINKED de l'ops (US-127) entre deux comptes, par un agent sans lien avec eux. */
async function link(tx: Tx, a: string, b: string): Promise<void> {
  const decider = await kycStaff(tx, 'OPS_AGENT', ALL, ALL[0] ?? '');
  const r = await first<{ outcome: string; link_id: string | null }>(
    tx,
    'SELECT * FROM core.risk_staff_decide_account_link($1, $2, $3, $4, $5, $6)',
    [decider.hash, uuid(), a, b, 'LINKED', 'SAME_DEVICE'],
  );
  if (r.link_id === null) throw new Error(`lien : ${r.outcome}`);
}

/** Personne (nouveau compte) élevée par TOTP au rôle `role` du pays. */
async function staffPerson(tx: Tx, country: string, role: string) {
  const p = await person(tx, country);
  return elevateAs(tx, p.userId, role, [country]);
}

describe('ADR-122 — aides de la garde : aucun rôle applicatif, propriétaire NOLOGIN', () => {
  it('support_actor_conflict, support_subject_parties, support_org_people, kyc_legal_name_bag(s_match) : SECURITY INVOKER, jamais exécutables par app_api, app_worker ni app_anon', async () => {
    await rolledBack(async (tx) => {
      const { rows } = await tx.query<{
        fn: string;
        owner: string;
        secdef: boolean;
        api: boolean;
        worker: boolean;
        anon: boolean;
      }>(
        `SELECT p.oid::regprocedure::text AS fn, pg_catalog.pg_get_userbyid(p.proowner) AS owner,
                p.prosecdef AS secdef,
                pg_catalog.has_function_privilege('app_api', p.oid, 'EXECUTE') AS api,
                pg_catalog.has_function_privilege('app_worker', p.oid, 'EXECUTE') AS worker,
                pg_catalog.has_function_privilege('app_anon', p.oid, 'EXECUTE') AS anon
           FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'core'
            AND p.proname IN ('support_actor_conflict', 'support_subject_parties',
                              'support_org_people', 'kyc_legal_name_bag', 'kyc_legal_name_bags_match')
          ORDER BY 1`,
      );
      expect(rows.map((r) => r.fn).sort()).toEqual([
        'core.kyc_legal_name_bag(text,text)',
        'core.kyc_legal_name_bags_match(text[],text[])',
        'core.support_actor_conflict(uuid,text,uuid)',
        'core.support_org_people(uuid)',
        'core.support_subject_parties(text,uuid)',
      ]);
      for (const r of rows) {
        expect(r, r.fn).toMatchObject({ secdef: false, api: false, worker: false, anon: false });
      }
      expect(rows.filter((r) => r.fn.startsWith('core.support_')).map((r) => r.owner)).toEqual([
        'iam_staff_owner',
        'iam_staff_owner',
        'iam_staff_owner',
      ]);
      await tx.query('SAVEPOINT x');
      await expect(
        tx.query('SELECT core.support_actor_conflict($1, $2, $3)', [
          uuid(),
          'ORGANIZATION',
          uuid(),
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await tx.query('ROLLBACK TO SAVEPOINT x');
    });
  });
});

describe.each(byCountry)(
  'F-L1-C-01 / C-02 — dossier d’hôte : co-hôte et compte lié refusés, témoin servi (%s)',
  (country) => {
    it('HOST_SANCTIONS_SCREENING : co-hôte membre du compte, compte lié ⇒ SELF_FORBIDDEN, journalisé, aucun effet ; un agent sans lien consigne le filtrage', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const h = await readyHost(tx, country);
        const co = await staffPerson(tx, country, 'OPS_AGENT');
        await cohost(tx, co.userId, h.org);
        const linked = await staffPerson(tx, country, 'OPS_AGENT');
        await link(tx, h.userId, linked.userId);
        for (const [who, s] of [
          ['co-hôte', co],
          ['compte lié', linked],
        ] as const) {
          const r = await act(tx, s, 'HOST_SANCTIONS_SCREENING', h.org, { input: SCREEN });
          expect(r, who).toMatchObject(SELF);
          const audit = (await auditOf(tx, s.userId)).at(-1);
          expect(audit?.action_code, who).toBe('MANUAL_ACTION_REFUSED');
          expect(audit?.after, who).toMatchObject({
            attempted: 'HOST_SANCTIONS_SCREENING',
            domainOutcome: 'SELF_FORBIDDEN',
          });
        }
        expect((await hostState(tx, h))['screening_done']).toBe(false);
        const witness = await ops(tx, 'OPS_AGENT', [country]);
        expect(
          (await act(tx, witness, 'HOST_SANCTIONS_SCREENING', h.org, { input: SCREEN })).outcome,
        ).toBe('DONE');
      });
    });

    it('HOST_VERIFICATION_DECISION : titulaire, co-hôte, compte lié ⇒ SELF_FORBIDDEN, statut inchangé ; un agent sans lien décide', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const h = await readyHost(tx, country, 'CLEAR');
        const self = await elevateAs(tx, h.userId, 'OPS_AGENT', [country]);
        const co = await staffPerson(tx, country, 'OPS_AGENT');
        await cohost(tx, co.userId, h.org);
        const linked = await staffPerson(tx, country, 'OPS_AGENT');
        await link(tx, linked.userId, h.userId);
        const before = await hostState(tx, h);
        for (const [who, s] of [
          ['titulaire', self],
          ['co-hôte', co],
          ['compte lié', linked],
        ] as const) {
          const r = await act(tx, s, 'HOST_VERIFICATION_DECISION', h.org, {
            input: { decision: 'APPROVED' },
          });
          expect(r, who).toMatchObject(SELF);
        }
        expect((await hostState(tx, h))['verification_status']).toBe(before['verification_status']);
        const witness = await ops(tx, 'OPS_AGENT', [country]);
        const ok = await act(tx, witness, 'HOST_VERIFICATION_DECISION', h.org, {
          input: { decision: 'APPROVED' },
        });
        expect(ok.outcome).toBe('DONE');
      });
    });

    it('HOST_SCREENING_REVIEW : ADMIN co-hôte ou compte lié ⇒ SELF_FORBIDDEN, retenue maintenue ; un ADMIN sans lien lève la retenue', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const h = await readyHost(tx, country, 'POTENTIAL_MATCH');
        const co = await staffPerson(tx, country, 'ADMIN');
        await cohost(tx, co.userId, h.org);
        const linked = await staffPerson(tx, country, 'ADMIN');
        await link(tx, h.userId, linked.userId);
        for (const s of [co, linked]) {
          expect(
            await act(tx, s, 'HOST_SCREENING_REVIEW', h.org, { input: { decision: 'CLEARED' } }),
          ).toMatchObject(SELF);
        }
        const held = await first<{ screening_hold: boolean }>(
          tx,
          'SELECT * FROM test_fixture.us123_dossier($1)',
          [h.org],
        );
        expect(held.screening_hold).toBe(true);
        const witness = await ops(tx, 'ADMIN', [country]);
        expect(
          (
            await act(tx, witness, 'HOST_SCREENING_REVIEW', h.org, {
              input: { decision: 'CLEARED' },
            })
          ).outcome,
        ).toBe('DONE');
      });
    });
  },
);

describe.each(byCountry)(
  'ADR-122 — autres actions de console sur un sujet qui concerne l’agent (%s)',
  (country) => {
    it('KYC_DECISION : un compte lié à la personne vérifiée ⇒ SELF_FORBIDDEN, même avec l’élément pris en charge', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const p = await toReview(tx, country);
        const linked = await staffPerson(tx, country, 'OPS_AGENT');
        await link(tx, p.userId, linked.userId);
        const item = (await kycItems(tx, p.userId))[0];
        await claimItem(tx, linked, item?.id ?? '');
        expect(
          await act(tx, linked, 'KYC_DECISION', p.verificationId, { input: checks('APPROVED') }),
        ).toMatchObject(SELF);
        expect((await kycItems(tx, p.userId))[0]?.decision).not.toBe('APPROVED');
      });
    });

    it('RESTRICT_ACCOUNT / LIFT_RESTRICTION : un ADMIN lié au compte ⇒ SELF_FORBIDDEN ; CREATE_HOST_ACCOUNT sur son propre compte ⇒ SELF_FORBIDDEN', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const target = await person(tx, country);
        const admin = await staffPerson(tx, country, 'ADMIN');
        await link(tx, target.userId, admin.userId);
        for (const action of ['RESTRICT_ACCOUNT', 'LIFT_RESTRICTION']) {
          expect(
            await act(tx, admin, action, target.userId, { input: { kind: 'POLICY_VIOLATION' } }),
            action,
          ).toMatchObject(SELF);
        }
        const agent = await staffPerson(tx, country, 'OPS_AGENT');
        expect(await act(tx, agent, 'CREATE_HOST_ACCOUNT', agent.userId)).toMatchObject(SELF);
      });
    });

    it('HANDLE_DSR : l’ADMIN qui est la personne du dossier ⇒ SELF_FORBIDDEN, aucune demande ouverte ; un autre ADMIN l’ouvre', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const admin = await staffPerson(tx, country, 'ADMIN');
        const caseId = (
          await first<{ id: string }>(tx, 'SELECT test_fixture.us111_support_case($1, $2) AS id', [
            country,
            admin.userId,
          ])
        ).id;
        const input = { kind: 'ACCESS', step: 'RECEIVED' };
        expect(await act(tx, admin, 'HANDLE_DSR', caseId, { input })).toMatchObject(SELF);
        const other = await staffPerson(tx, country, 'ADMIN');
        expect((await act(tx, other, 'HANDLE_DSR', caseId, { input })).outcome).toBe('DONE');
      });
    });
  },
);

/** Véhicule soumis à la revue de l'ops (pièce TITLE exigée par le pays), élément de file. */
async function vehicleInReview(tx: Tx, h: Host, cc: CountryCase): Promise<string> {
  await countryRules(tx, cc.country, false);
  await tx.query('SELECT test_fixture.us124_param_version($1, $2, $3::jsonb)', [
    'elig_doc_title',
    cc.country,
    'true',
  ]);
  const v = await vehicleOf(tx, h, cc);
  const id = v.id ?? '';
  const dec = await first<{ outcome: string }>(
    tx,
    'SELECT * FROM core.catalog_cmd_declare_vehicle($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [h.hash, h.org, id, 'HOST', false, 42_000, true, true, null],
  );
  expect(dec.outcome).toBe('DONE');
  const doc = await first<{ outcome: string }>(
    tx,
    'SELECT * FROM core.catalog_cmd_add_vehicle_document($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [h.hash, h.org, id, uuid(), 'TITLE', 'application/pdf', 54_321, randomBytes(32), null],
  );
  expect(doc.outcome).toBe('DONE');
  const sub = await first<{ outcome: string; item_id: string | null }>(
    tx,
    'SELECT * FROM core.catalog_cmd_submit_vehicle_eligibility($1, $2, $3)',
    [h.hash, h.org, id],
  );
  expect(sub.outcome).toBe('DONE');
  return sub.item_id ?? '';
}

const vehicleDossier = (tx: Tx, s: { hash: Buffer }, item: string) =>
  first<{ outcome: string; body: unknown }>(
    tx,
    'SELECT * FROM core.support_staff_vehicle_eligibility($1, $2, $3, $4)',
    [s.hash, uuid(), item, PURPOSE],
  );

describe.each(byCountry)(
  'F-L1-C-03 — files LISTING et CATALOG_ADDITION : la garde commune refuse l’agent concerné (%s)',
  (country, _c, cc) => {
    it('éligibilité du véhicule : titulaire (OPS, élément pris) et co-hôte (ADMIN) ⇒ SELF_FORBIDDEN (dossier et décision), journalisé STAFF_FORBIDDEN « SELF » ; un agent sans lien lit le dossier', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const h = await hostOf(tx, country);
        await tx.query('SELECT test_fixture.us109_subject_key($1)', [h.userId]);
        const item = await vehicleInReview(tx, h, cc);
        // l'agent titulaire prend l'élément ; le co-hôte est ADMIN (aucune prise en charge exigée)
        const self = await elevateAs(tx, h.userId, 'OPS_AGENT', [country]);
        await claimItem(tx, self, item);
        const co = await staffPerson(tx, country, 'ADMIN');
        await cohost(tx, co.userId, h.org);
        for (const s of [self, co]) {
          expect((await vehicleDossier(tx, s, item)).outcome).toBe('SELF_FORBIDDEN');
          const decided = await first<{ outcome: string }>(
            tx,
            'SELECT * FROM core.support_staff_decide_vehicle_eligibility($1, $2, $3, $4::jsonb, $5::jsonb)',
            [s.hash, uuid(), item, JSON.stringify({ TITLE_HOLDER: 'PASS' }), '[]'],
          );
          expect(decided.outcome).toBe('SELF_FORBIDDEN');
          expect((await auditOf(tx, s.userId)).at(-1)).toMatchObject({
            action_code: 'STAFF_FORBIDDEN',
            after: { reason: 'SELF' },
          });
        }
        const witness = await ops(tx, 'ADMIN', [country]);
        expect((await vehicleDossier(tx, witness, item)).outcome).toBe('GRANTED');
      });
    });

    it('contestation de plaque : le demandeur ET le titulaire du véhicule contesté ⇒ SELF_FORBIDDEN (lecture et décision) ; un ADMIN sans lien lit la contestation', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const owner = await hostOf(tx, country);
        const claimant = await hostOf(tx, country);
        await tx.query('SELECT test_fixture.us109_subject_key($1)', [claimant.userId]);
        const p = plate();
        expect((await vehicleOf(tx, owner, cc, { plate: p })).outcome).toBe('DONE');
        const opened = await first<{ outcome: string; claim_id: string }>(
          tx,
          'SELECT * FROM core.catalog_cmd_open_vehicle_claim($1, $2, $3, NULL, $4, $5, $6, $7)',
          [claimant.hash, claimant.org, p, uuid(), 'application/pdf', 4096, randomBytes(32)],
        );
        expect(opened.outcome).toBe('DONE');
        const item = (await itemsOf(tx, opened.claim_id))[0]?.id ?? '';
        for (const [who, user] of [
          ['demandeur', claimant.userId],
          ['titulaire du véhicule contesté', owner.userId],
        ] as const) {
          const s = await elevateAs(tx, user, 'ADMIN', [country]);
          const read = await first<{ outcome: string }>(
            tx,
            'SELECT * FROM core.support_staff_vehicle_claim($1, $2, $3, $4)',
            [s.hash, uuid(), item, PURPOSE],
          );
          expect(read.outcome, who).toBe('SELF_FORBIDDEN');
          const decided = await first<{ outcome: string }>(
            tx,
            'SELECT * FROM core.support_staff_decide_vehicle_claim($1, $2, $3, $4, $5, $6::jsonb, $7)',
            [s.hash, uuid(), item, 'DISMISS', 'TITLE_UNREADABLE', null, null],
          );
          expect(decided.outcome, who).toBe('SELF_FORBIDDEN');
        }
        const witness = await ops(tx, 'ADMIN', [country]);
        const read = await first<{ outcome: string }>(
          tx,
          'SELECT * FROM core.support_staff_vehicle_claim($1, $2, $3, $4)',
          [witness.hash, uuid(), item, PURPOSE],
        );
        expect(read.outcome).toBe('GRANTED');
      });
    });

    it('demande d’ajout au catalogue : le demandeur ⇒ SELF_FORBIDDEN (lecture et décision), demande toujours OPEN ; un agent sans lien la lit', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const h = await hostOf(tx, country);
        const v = await vehicleOf(tx, h, cc, { offCatalog: true, make: 'Chery', model: 'Tiggo 2' });
        expect(v.outcome).toBe('DONE');
        const [request] = (
          await tx.query<{ id: string; status: string; review_item_id: string }>(
            'SELECT * FROM test_fixture.us114_requests($1)',
            [v.id],
          )
        ).rows;
        const item = request?.review_item_id ?? '';
        const self = await elevateAs(tx, h.userId, 'OPS_AGENT', [country]);
        await claimItem(tx, self, item);
        const read = await first<{ outcome: string }>(
          tx,
          'SELECT * FROM core.support_staff_catalog_addition($1, $2, $3)',
          [self.hash, uuid(), item],
        );
        expect(read.outcome).toBe('SELF_FORBIDDEN');
        const resolved = await first<{ outcome: string }>(
          tx,
          'SELECT * FROM core.support_staff_resolve_catalog_addition($1, $2, $3, $4, $5, $6::jsonb, $7)',
          [self.hash, uuid(), item, 'REJECT', null, null, 'UNKNOWN_MODEL'],
        );
        expect(resolved.outcome).toBe('SELF_FORBIDDEN');
        const after = (
          await tx.query<{ status: string }>('SELECT * FROM test_fixture.us114_requests($1)', [
            v.id,
          ])
        ).rows[0];
        expect(after?.status).toBe('OPEN');
        const witness = await ops(tx, 'ADMIN', [country]);
        expect(
          (
            await first<{ outcome: string }>(
              tx,
              'SELECT * FROM core.support_staff_catalog_addition($1, $2, $3)',
              [witness.hash, uuid(), item],
            )
          ).outcome,
        ).toBe('GRANTED');
      });
    });
  },
);

describe.each(byCountry)(
  'F-L1-V-01 — plafond des contestations ouvertes (paramètre du pays, PROPOSÉ) (%s)',
  (country, _c, cc) => {
    it('au-delà du plafond du pays : CLAIM_LIMIT_REACHED, jugé aussi avant l’antivirus ; paramètre absent ⇒ refus (fail-closed)', async () => {
      const max = Number(paramValues('plate_claims_open_per_host')[country]);
      expect(Number.isInteger(max) && max > 0, 'plafond lu dans les données CFG').toBe(true);
      await rolledBack(async (tx) => {
        const victim = await hostOf(tx, country);
        const attacker = await hostOf(tx, country);
        await tx.query('SELECT test_fixture.us109_subject_key($1)', [attacker.userId]);
        const plates: string[] = [];
        for (let i = 0; i <= max; i += 1) {
          const p = plate();
          plates.push(p);
          expect((await vehicleOf(tx, victim, cc, { plate: p })).outcome).toBe('DONE');
        }
        const outcomes: string[] = [];
        for (const p of plates) {
          const r = await first<{ outcome: string }>(
            tx,
            'SELECT * FROM core.catalog_cmd_open_vehicle_claim($1, $2, $3, NULL, $4, $5, $6, $7)',
            [attacker.hash, attacker.org, p, uuid(), 'application/pdf', 4096, randomBytes(32)],
          );
          outcomes.push(r.outcome);
        }
        expect(outcomes).toEqual([...Array<string>(max).fill('DONE'), 'CLAIM_LIMIT_REACHED']);
        const permitted = await first<{ outcome: string }>(
          tx,
          'SELECT * FROM core.catalog_vehicle_claim_permitted($1, $2, $3, NULL)',
          [attacker.hash, attacker.org, plates.at(-1)],
        );
        expect(permitted.outcome).toBe('CLAIM_LIMIT_REACHED');
        // fail-closed : paramètre ABSENT du pays (version fermée dans la transaction annulée ; une
        // valeur mal formée ne peut pas être écrite, la garde de type la refuse) ⇒ aucune
        // contestation. Témoin : avant la fermeture, un compte neuf peut contester.
        const fresh = await hostOf(tx, country);
        const permittedOf = async () =>
          (
            await first<{ outcome: string }>(
              tx,
              'SELECT * FROM core.catalog_vehicle_claim_permitted($1, $2, $3, NULL)',
              [fresh.hash, fresh.org, plates[0]],
            )
          ).outcome;
        expect(await permittedOf()).toBe('OK');
        const closed = await first<{ n: number }>(
          tx,
          'SELECT test_fixture.us122_param_close($1, $2) AS n',
          ['plate_claims_open_per_host', country],
        );
        expect(closed.n).toBeGreaterThan(0);
        expect(await permittedOf()).toBe('CLAIM_LIMIT_REACHED');
      });
    });
  },
);

// ---------------------------------------------------------------------------------------------
// F-L1-S-01 : témoins d'innocence du sac de mots (monde de test copié sur l0-us127)
// ---------------------------------------------------------------------------------------------
let day = 0;
function slot(): { start: string; end: string } {
  day += 3;
  const start = new Date(Date.UTC(2039, 0, 1, 10) + day * 86_400_000);
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 2 * 86_400_000).toISOString(),
  };
}

async function pose(tx: Tx, guestId: string, vehicleId: string, orgId: string): Promise<string> {
  const s = slot();
  await tx.query('SAVEPOINT pose');
  try {
    await placeHoldCommand(tx, {
      slot: { vehicleId, orgId, start: s.start, end: s.end, bufferHours: 0 },
      guestId,
    });
    await tx.query('RELEASE SAVEPOINT pose');
    return 'OK';
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT pose');
    return translateDbError(error).code;
  }
}

async function party(tx: Tx): Promise<string> {
  const id = uuid();
  await tx.query('SELECT test_fixture.ensure_party($1, NULL, NULL)', [id]);
  return id;
}

async function verified(
  tx: Tx,
  user: string,
  c: CountryCase,
  license: readonly [string, string],
  birth: string,
): Promise<void> {
  const v = await first<{ id: string }>(
    tx,
    'SELECT test_fixture.us127_verified_identity($1, $2, $3, $4, $5::date) AS id',
    [user, c.country, license[0], license[1], birth],
  );
  await tx.query('SELECT test_fixture.us103_license_name($1, $2, $3)', [
    v.id,
    license[0],
    license[1],
  ]);
}

describe.each(byCountry)(
  'F-L1-S-01 — sac de mots : pas de faux positif dangereux (%s)',
  (_country, _cur, c) => {
    const birth = '1987-05-21';
    it.each([
      ['noms qui se recoupent sans s’inclure', ['MARIA FERNANDA', 'NUNEZ GOMEZ']],
      ['un seul mot commun', ['MARIA', 'SOTO']],
      ['même prénom composé, autres noms', ['MARIA JOSE', 'BENITEZ ROJAS']],
    ] as const)(
      'même date de naissance, %s : le voyageur réserve (aucun lien)',
      async (_why, license) => {
        await rolledBack(async (tx) => {
          const org = uuid();
          const vehicle = uuid();
          const holder = (
            await first<{ h: string }>(tx, 'SELECT test_fixture.create_org($1, $2, $3) AS h', [
              org,
              c.country,
              'ACTIVE',
            ])
          ).h;
          await registerVehicles(tx, [vehicle], org, c);
          await verified(tx, holder, c, ['MARIA JOSE', 'NUNEZ PEREZ'], birth);
          const guest = await party(tx);
          await verified(tx, guest, c, license, birth);
          expect(await pose(tx, guest, vehicle, org)).toBe('OK');
        });
      },
    );
  },
);
