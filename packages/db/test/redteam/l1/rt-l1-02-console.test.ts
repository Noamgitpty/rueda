/**
 * US-122 — red team du lot 1, axe console et `manual_action` (RT-L1-R03, R04, A07, A12 et
 * indiscernabilité des sanctions L1-PM-13 / US-123 / US-108) : élévation de privilège, actions
 * sans motif, agent qui décide sur son propre dossier, lecture C2 / C3 sans journalisation,
 * oracle de sanctions. Rôles de production seulement (assertion L0-05 par withRole), USD (PA) et
 * PYG (PY), staff élevé par TOTP par les VRAIES commandes. Rapport : docs/team/redteam/L1-rls-abus.md.
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille trouvée (jamais
 * `skip`). Attendus : 17 §2.3 (matrice, RLS-24, « un agent ne décide pas sur son propre
 * dossier »), §10 (catalogue des actions, motif obligatoire), 16 ADM-001 (« action interdite =>
 * 403 journalisé »), ADM-032 / VER-028 (lecture journalisée AVANT la donnée, motif), 19 US-101,
 * US-106, US-108, US-118, US-123 ; pré-mortem L1-PM-07, L1-PM-08, L1-PM-13.
 */
import { describe, expect, it } from 'vitest';
import { installTestProofKey, createStaff, login, auditOf } from '../../support/staff.ts';
import {
  checks,
  elevateAs,
  itemsOf as kycItems,
  staff as kycStaff,
  toReview,
} from '../../support/kyc.ts';
import {
  ALL,
  byCountry,
  countryRules,
  createLocation,
  declareAndSubmit,
  hostOf,
  listingOf,
  openSwitchInTx,
  ops,
  otherOf,
  rolledBack,
  uuid,
  vehicleOf,
} from './support.ts';
import type { Tx } from './support.ts';
import {
  accessRows,
  act,
  claimItem,
  first,
  hostState,
  itemsOf,
  listingStatus,
  readyHost,
} from './support-host.ts';

const SCREEN = { unList: 'CLEAR', ofacList: 'CLEAR', nationalList: 'CLEAR' };
const PURPOSE = 'Contrôle du dossier pour une décision de l’ops';

/** Actions de console qui exigent une permission de l'ops (17 §10) : un rôle sans elle est refusé. */
const OPS_ACTIONS = [
  'HOST_VERIFICATION_DECISION',
  'HOST_SANCTIONS_SCREENING',
  'HOST_SCREENING_REVIEW',
  'KYC_DECISION',
  'PUBLISH_LISTING',
  'HANDLE_DSR',
  'CREATE_HOST_ACCOUNT',
] as const;
const FINANCE_ONLY_DENIED = ['RESTRICT_ACCOUNT', 'LIFT_RESTRICTION'] as const;

describe.each(byCountry)(
  'RT-L1-R03 — élévation de privilège : rôle sans permission (%s)',
  (country) => {
    it.each([
      ['SUPPORT_AGENT', OPS_ACTIONS],
      ['FINANCE', [...OPS_ACTIONS, ...FINANCE_ONLY_DENIED]],
    ] as const)(
      '%s : chaque action de l’ops est refusée (FORBIDDEN), tentative journalisée STAFF_FORBIDDEN, aucun effet',
      async (role, actions) => {
        await rolledBack(async (tx) => {
          const who = await ops(tx, role, ALL);
          const host = await readyHost(tx, country);
          const before = await hostState(tx, host);
          for (const action of actions) {
            const r = await act(tx, who, action, host.org, {
              input: { decision: 'APPROVED', ...SCREEN },
            });
            expect(r.outcome, `${role} ${action}`).toBe('FORBIDDEN');
            expect((await auditOf(tx, who.userId)).at(-1)?.action_code, `${role} ${action}`).toBe(
              'STAFF_FORBIDDEN',
            );
          }
          expect(await hostState(tx, host)).toEqual(before);
        });
      },
    );

    it('session sans TOTP (niveau NONE) : MFA_REQUIRED, aucun effet ; identité forgée dans le contexte : jamais un pouvoir d’autrui', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const low = await createStaff(tx, 'OPS_AGENT', ALL);
        const hash = await login(tx, low.userId);
        const host = await readyHost(tx, country);
        const noMfa = await act(
          tx,
          { userId: low.userId, hash },
          'HOST_SANCTIONS_SCREENING',
          host.org,
          {
            input: SCREEN,
          },
        );
        expect(noMfa.outcome).toBe('MFA_REQUIRED');
        // FINANCE (sans permission) forge dans le contexte l'identité d'un ADMIN de tous les pays
        const admin = await ops(tx, 'ADMIN', ALL);
        const finance = await ops(tx, 'FINANCE', ALL);
        const forged = await act(tx, finance, 'HOST_SANCTIONS_SCREENING', host.org, {
          input: SCREEN,
          forgedActor: admin.userId,
        });
        expect(forged.outcome).not.toBe('DONE');
        const state = await hostState(tx, host);
        expect(state['screening_done']).toBe(false);
      });
    });
  },
);

describe.each(byCountry)('RT-L1-R05 — portée pays du staff (%s)', (country, _c, cc) => {
  it('OPS d’un pays sur un dossier d’hôte de l’autre pays : FORBIDDEN, même si le contexte annonce tous les pays ; témoin : son propre pays aboutit', async () => {
    await rolledBack(async (tx) => {
      const agent = await ops(tx, 'OPS_AGENT', [country]);
      const foreign = await readyHost(tx, otherOf(cc).country);
      const mine = await readyHost(tx, country);
      for (const scope of [ALL, [country]]) {
        const r = await act(tx, agent, 'HOST_SANCTIONS_SCREENING', foreign.org, {
          input: SCREEN,
          scope,
        });
        expect(r.outcome, `contexte ${scope.join(',')}`).toBe('FORBIDDEN');
      }
      expect((await hostState(tx, foreign))['screening_done']).toBe(false);
      // témoin : le même agent, dans son pays, est servi (la garde n'est pas vide)
      const ok = await act(tx, agent, 'HOST_SANCTIONS_SCREENING', mine.org, { input: SCREEN });
      expect(ok.outcome).toBe('DONE');
    });
  });
});

describe.each(byCountry)(
  'RT-L1-A07 — séparation des tâches : un agent ne décide pas sur son propre dossier (%s)',
  (country, _c, cc) => {
    it('KYC_DECISION : l’agent qui est la personne vérifiée ne peut pas s’approuver (SELF_FORBIDDEN)', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const p = await toReview(tx, country);
        const self = await elevateAs(tx, p.userId, 'OPS_AGENT', [country]);
        const item = (await kycItems(tx, p.userId))[0];
        expect(item, 'élément de la file KYC').toBeDefined();
        await claimItem(tx, self, item?.id ?? '');
        const r = await act(tx, self, 'KYC_DECISION', p.verificationId, {
          input: checks('APPROVED'),
        });
        expect(r.outcome).not.toBe('DONE');
        expect((await kycItems(tx, p.userId))[0]?.decision).not.toBe('APPROVED');
      });
    });

    it('HOST_VERIFICATION_DECISION : le titulaire du compte, membre de l’ops, ne peut pas approuver son propre dossier d’hôte', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const h = await readyHost(tx, country, 'CLEAR');
        const self = await elevateAs(tx, h.userId, 'OPS_AGENT', [country]);
        const before = await hostState(tx, h);
        const r = await act(tx, self, 'HOST_VERIFICATION_DECISION', h.org, {
          input: { decision: 'APPROVED' },
        });
        expect(r.outcome, 'décision sur son propre dossier').not.toBe('DONE');
        const after = await hostState(tx, h);
        expect(after['verification_status']).toBe(before['verification_status']);
        expect(after['org_status']).not.toBe('ACTIVE');
      });
    });

    it('HOST_SCREENING_REVIEW : le titulaire ADMIN ne peut pas lever (CLEARED) sa propre correspondance de sanctions', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const h = await readyHost(tx, country, 'POTENTIAL_MATCH');
        const admin = await elevateAs(tx, h.userId, 'ADMIN', [country]);
        const r = await act(tx, admin, 'HOST_SCREENING_REVIEW', h.org, {
          input: { decision: 'CLEARED' },
        });
        expect(r.outcome, 'levée de sa propre retenue').not.toBe('DONE');
        const dossier = await first<{ status: string; screening_hold: boolean }>(
          tx,
          'SELECT * FROM test_fixture.us123_dossier($1)',
          [h.org],
        );
        expect(dossier.screening_hold).toBe(true);
        expect(dossier.status).not.toBe('APPROVED');
      });
    });

    it('HOST_SANCTIONS_SCREENING : le titulaire ne peut pas consigner son propre filtrage', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const h = await readyHost(tx, country);
        const self = await elevateAs(tx, h.userId, 'OPS_AGENT', [country]);
        const r = await act(tx, self, 'HOST_SANCTIONS_SCREENING', h.org, { input: SCREEN });
        expect(r.outcome).not.toBe('DONE');
        expect((await hostState(tx, h))['screening_done']).toBe(false);
      });
    });

    it('RESTRICT_ACCOUNT : l’agent ne peut pas poser (ni lever) une restriction sur son propre compte', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const p = await hostOf(tx, country);
        const self = await elevateAs(tx, p.userId, 'OPS_AGENT', [country]);
        const r = await act(tx, self, 'RESTRICT_ACCOUNT', p.userId, {
          input: { kind: 'POLICY_VIOLATION' },
        });
        expect(r.outcome).not.toBe('DONE');
      });
    });

    it('revue de l’annonce : le titulaire, membre de l’ops, ne peut pas publier sa propre annonce (LISTING / support_staff_decide_listing)', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        await countryRules(tx, country, true);
        await openSwitchInTx(tx, 'p2p_private_hosts_enabled', country);
        await openSwitchInTx(tx, 'insurer_contract_active', country);
        const h = await hostOf(tx, country);
        const v = await vehicleOf(tx, h, cc);
        expect(v.id).toBeTruthy();
        expect((await declareAndSubmit(tx, h, v.id ?? '')).submitted).toBe('ELIGIBLE');
        const listing = await listingOf(tx, h, cc, v.id ?? '', 6);
        const submitted = await first<{ outcome: string }>(
          tx,
          'SELECT * FROM core.catalog_cmd_submit_listing($1, $2, $3)',
          [h.hash, h.org, listing],
        );
        expect(submitted.outcome).toBe('PENDING_REVIEW');
        const item = (await itemsOf(tx, listing))[0];
        expect(item?.queue).toBe('LISTING');
        const self = await elevateAs(tx, h.userId, 'OPS_AGENT', [country]);
        await claimItem(tx, self, item?.id ?? '');
        const decision = await first<{ outcome: string }>(
          tx,
          'SELECT * FROM core.support_staff_decide_listing($1, $2, $3, $4, $5)',
          [self.hash, uuid(), item?.id ?? '', 'APPROVE', null],
        );
        expect(decision.outcome, 'approbation de sa propre annonce').not.toBe('DECIDED');
        expect(await listingStatus(tx, listing)).not.toBe('LISTED');
      });
    });
  },
);

describe.each(byCountry)(
  'RT-L1-R04 — lecture C2 / C3 : journalisée, motivée, ciblée (%s)',
  (country, _c, cc) => {
    it('dossier KYC : refusé sans prise en charge, sans motif, au mauvais rôle, au mauvais pays (aucune donnée, aucune ligne de journal) ; permis : exactement une ligne', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const p = await toReview(tx, country);
        const item = (await kycItems(tx, p.userId))[0]?.id ?? '';
        const owner = await kycStaff(tx, 'OPS_AGENT', [country], country);
        const peer = await kycStaff(tx, 'OPS_AGENT', [country], country);
        const foreign = await kycStaff(tx, 'OPS_AGENT', [otherOf(cc).country], otherOf(cc).country);
        const support = await kycStaff(tx, 'SUPPORT_AGENT', ALL, country);
        const read = (s: { hash: Buffer }, purpose = PURPOSE) =>
          first<{ outcome: string; body: unknown }>(
            tx,
            'SELECT * FROM core.support_staff_kyc_dossier($1, $2, $3, $4)',
            [s.hash, uuid(), item, purpose],
          );
        const rows = async (s: { userId: string }) => (await accessRows(tx, s.userId)).length;

        // élément non pris en charge : refus
        const n0 = await rows(owner);
        const unclaimed = await read(owner);
        expect(unclaimed.outcome).not.toBe('GRANTED');
        expect(unclaimed.body ?? null).toBeNull();
        expect(await rows(owner)).toBe(n0);

        await claimItem(tx, owner, item);
        // motif absent ou trop court : refus, rien n'est lu ni journalisé
        for (const purpose of ['', 'court']) {
          const r = await read(owner, purpose);
          expect(r.outcome, `motif « ${purpose} »`).not.toBe('GRANTED');
          expect(r.body ?? null).toBeNull();
        }
        expect(await rows(owner)).toBe(n0);
        // autres rôles, autre agent du pays, agent de l'autre pays : refus, aucune ligne
        for (const [name, s] of [
          ['pair non assigné', peer],
          ['agent de l’autre pays', foreign],
          ['support', support],
        ] as const) {
          const r = await read(s);
          expect(r.outcome, name).not.toBe('GRANTED');
          expect(r.body ?? null, name).toBeNull();
          expect(await rows(s), name).toBe(0);
        }
        // lecture permise : le corps est rendu ET une ligne de journal existe (motif, sujet, type)
        const ok = await read(owner);
        expect(ok.outcome).toBe('GRANTED');
        expect(ok.body).not.toBeNull();
        const after = await accessRows(tx, owner.userId);
        expect(after.length).toBe(n0 + 1);
        const logged = after.find((r) => r.purpose === PURPOSE);
        expect(logged, 'ligne du journal d’accès').toBeDefined();
        expect(logged?.access_kind).toMatch(/^READ_C[23]/);
      });
    });
  },
);

describe.each(byCountry)('RT-L1-A07 — rejeu et abus de la même clé de requête (%s)', (country) => {
  it('même request_id sur deux dossiers : le second sujet n’est pas touché ; sans motif : refus et aucun effet', async () => {
    await rolledBack(async (tx) => {
      const agent = await ops(tx, 'OPS_AGENT', [country]);
      const a = await readyHost(tx, country);
      const b = await readyHost(tx, country);
      const requestId = uuid();
      const first1 = await act(tx, agent, 'HOST_SANCTIONS_SCREENING', a.org, {
        input: SCREEN,
        requestId,
      });
      expect(first1.outcome).toBe('DONE');
      const replay = await act(tx, agent, 'HOST_SANCTIONS_SCREENING', b.org, {
        input: SCREEN,
        requestId,
      });
      expect(replay.outcome).not.toBe('DONE');
      expect((await hostState(tx, b))['screening_done'], 'second dossier filtré par rejeu').toBe(
        false,
      );
      // motif absent, vide ou trop court : jamais d'effet
      for (const reason of ['', ' ', 'x']) {
        const r = await act(tx, agent, 'HOST_SANCTIONS_SCREENING', b.org, {
          input: SCREEN,
          reason,
        });
        expect(r.outcome, `motif « ${reason} »`).not.toBe('DONE');
      }
      expect((await hostState(tx, b))['screening_done']).toBe(false);
    });
  });
});

/** Réponses visibles de l'hôte, sans identifiant propre à l'appel. */
async function visible(tx: Tx, h: Awaited<ReturnType<typeof readyHost>>, country: string) {
  const state = await hostState(tx, h);
  const accounts = (
    await tx.query<Record<string, unknown>>('SELECT * FROM core.iam_host_accounts($1)', [h.token])
  ).rows.map((r) => ({ ...r, org_id: '<org>' }));
  const terms = (
    await tx.query<Record<string, unknown>>(`SELECT * FROM core.ctr_host_terms($1, $2, 'es')`, [
      h.token,
      h.org,
    ])
  ).rows.map((r) => ({
    outcome: r['outcome'],
    version: r['version'],
    required: r['required_version'],
    accepted: r['accepted_version'],
    reaccept: r['reaccept_required'],
    draft: r['is_draft'],
  }));
  const location = await createLocation(tx, { hash: h.token, org: h.org }, 'Barrio Norte');
  const host = {
    userId: h.userId,
    hash: h.token,
    org: h.org,
    location: location.id ?? uuid(),
    country,
  };
  return { state, accounts, terms, location: location.outcome, host };
}

describe.each(byCountry)(
  'RT-L1-D — indiscernabilité des sanctions : aucun oracle pour l’hôte (%s)',
  (country, _c, cc) => {
    it('hôte retenu (POTENTIAL_MATCH) et hôte propre (CLEAR) : mêmes états, comptes, CGU, véhicule, annonce et soumission', async () => {
      await rolledBack(async (tx) => {
        const probe = async (screening: 'CLEAR' | 'POTENTIAL_MATCH') => {
          const h = await readyHost(tx, country, screening);
          const v = await visible(tx, h, country);
          const veh = await vehicleOf(tx, v.host, cc);
          const decl = veh.id ? await declareAndSubmit(tx, v.host, veh.id) : null;
          const created = veh.id
            ? await first<{ outcome: string; listing_id: string | null }>(
                tx,
                `SELECT * FROM core.catalog_cmd_create_listing($1, $2, $3, $4, 'UNLIMITED', NULL, NULL, NULL)`,
                [h.token, h.org, veh.id, 40 * cc.priceStepMinor],
              )
            : null;
          const submit = created?.listing_id
            ? await first<{ outcome: string }>(
                tx,
                'SELECT * FROM core.catalog_cmd_submit_listing($1, $2, $3)',
                [h.token, h.org, created.listing_id],
              )
            : null;
          const resubmit = await first<{
            outcome: string;
            status: string | null;
            missing: string[] | null;
          }>(tx, 'SELECT * FROM core.kyc_cmd_host_submit($1, $2)', [h.token, h.org]);
          const again = await hostState(tx, h);
          return {
            state: v.state,
            accounts: v.accounts,
            terms: v.terms,
            location: v.location,
            vehicle: veh.outcome,
            decl,
            listing: created?.outcome,
            submitListing: submit?.outcome,
            resubmit: {
              outcome: resubmit.outcome,
              status: resubmit.status,
              missing: resubmit.missing,
            },
            again,
          };
        };
        const clean = await probe('CLEAR');
        const flagged = await probe('POTENTIAL_MATCH');
        expect(flagged).toEqual(clean);
      });
    });
  },
);
