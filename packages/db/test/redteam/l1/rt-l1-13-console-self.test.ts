/**
 * US-122 — red team du lot 1, passe n° 2, axe console : entrées hors de la garde
 * `support_actor_conflict` (ADR-122), signalées par les revues de la passe n° 1. Un agent qui est
 * la personne du sujet, son co-hôte ou un compte lié traite-t-il son propre dossier par l'une des
 * entrées que la garde ne couvre pas ? `support_staff_claim_item`, `support_staff_host_dossier`,
 * `support_staff_kyc_dossier`, `risk_staff_decide_account_link`, les actions FINANCE à deux
 * personnes, et l'asymétrie de la garde (USER_ACCOUNT et IDENTITY_VERIFICATION : un co-hôte
 * décide le KYC ou la restriction du titulaire). Rôles de production seulement (assertion L0-05
 * par withRole), USD (PA) et PYG (PY). Rapport : docs/team/redteam/L1-passe2.md.
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille trouvée (jamais
 * `skip`). Attendus : 17 §2.3 (« un agent ne décide pas sur son propre dossier », deux personnes
 * distinctes pour une décision FINANCE, RLS-24), 16 ADM-001 et VER-028 (lecture C2 / C3
 * journalisée, motif), 19 US-101, US-106, US-108, US-127, ADR-122 (la garde se veut unique pour
 * toute la console) ; pré-mortem L1-PM-07, L1-PM-08, L1-PM-30.
 */
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../../src/index.ts';
import { checks, elevateAs, itemsOf as kycItems, toReview } from '../../support/kyc.ts';
import { installTestProofKey } from '../../support/staff.ts';
import { byCountry, hostOf, ops, rolledBack, uuid } from './support.ts';
import type { Tx } from './support.ts';
import { act, claimItem, first, itemsOf, outcomeOf, readyHost } from './support-host.ts';
import { PURPOSE, SELF, cohost, decideLink, staffPerson } from './support-p2.ts';

const hostDossier = (tx: Tx, s: { hash: Buffer }, item: string) =>
  first<{ outcome: string; body: unknown }>(
    tx,
    'SELECT * FROM core.support_staff_host_dossier($1, $2, $3, $4)',
    [s.hash, uuid(), item, PURPOSE],
  );
const kycDossier = (tx: Tx, s: { hash: Buffer }, item: string) =>
  first<{ outcome: string; body: unknown }>(
    tx,
    'SELECT * FROM core.support_staff_kyc_dossier($1, $2, $3, $4)',
    [s.hash, uuid(), item, PURPOSE],
  );
const hostItem = async (tx: Tx, org: string): Promise<string> => {
  const item = (await itemsOf(tx, org)).find((i) => i.queue === 'HOST_VERIFICATION');
  expect(item, 'élément de la file HOST_VERIFICATION').toBeTruthy();
  return item?.id ?? '';
};

describe.each(byCountry)(
  'F2-C-01 — dossier d’hôte (support_staff_claim_item, support_staff_host_dossier) : l’agent qui est le titulaire (%s)',
  (country) => {
    it('témoin : un agent sans lien prend l’élément et lit le dossier (GRANTED, journalisé) ; la garde n’est pas vide', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const h = await readyHost(tx, country, 'CLEAR');
        const item = await hostItem(tx, h.org);
        const witness = await ops(tx, 'OPS_AGENT', [country]);
        expect(await claimItem(tx, witness, item)).toBe('CLAIMED');
        expect((await hostDossier(tx, witness, item)).outcome).toBe('GRANTED');
      });
    });

    it('OPS_AGENT titulaire du compte : ne prend pas son propre élément (claim) et ne lit pas son propre dossier (sanctions, pièces)', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const h = await readyHost(tx, country, 'POTENTIAL_MATCH');
        const item = await hostItem(tx, h.org);
        const self = await elevateAs(tx, h.userId, 'OPS_AGENT', [country]);
        const claimed = await claimItem(tx, self, item);
        const read = await hostDossier(tx, self, item);
        expect.soft(claimed, 'prise en charge de son propre élément').not.toBe('CLAIMED');
        expect.soft(read.outcome, 'lecture de son propre dossier').not.toBe('GRANTED');
        expect.soft(read.body ?? null, 'dossier rendu au titulaire').toBeNull();
      });
    });

    it('ADMIN titulaire du compte (aucune prise en charge exigée) : ne lit pas son propre dossier d’hôte', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const h = await readyHost(tx, country, 'POTENTIAL_MATCH');
        const item = await hostItem(tx, h.org);
        const self = await elevateAs(tx, h.userId, 'ADMIN', [country]);
        const read = await hostDossier(tx, self, item);
        expect(read.outcome).not.toBe('GRANTED');
        expect(read.body ?? null).toBeNull();
      });
    });

    it('ADMIN co-hôte du compte : ne lit pas le dossier d’hôte de son titulaire', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const h = await readyHost(tx, country, 'POTENTIAL_MATCH');
        const item = await hostItem(tx, h.org);
        const co = await staffPerson(tx, country, 'ADMIN');
        await cohost(tx, co.userId, h.org);
        const read = await hostDossier(tx, co, item);
        expect(read.outcome).not.toBe('GRANTED');
        expect(read.body ?? null).toBeNull();
      });
    });
  },
);

describe.each(byCountry)(
  'F2-C-02 — dossier KYC (support_staff_claim_item, support_staff_kyc_dossier) : l’agent qui est la personne vérifiée (%s)',
  (country) => {
    it('témoin : un agent sans lien prend l’élément KYC et lit le dossier (GRANTED)', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const p = await toReview(tx, country);
        const item = (await kycItems(tx, p.userId))[0]?.id ?? '';
        const witness = await ops(tx, 'OPS_AGENT', [country]);
        expect(await claimItem(tx, witness, item)).toBe('CLAIMED');
        expect((await kycDossier(tx, witness, item)).outcome).toBe('GRANTED');
      });
    });

    it('OPS_AGENT dont le propre KYC est en revue : ne prend pas son propre élément et ne lit pas son propre dossier (scores, permis)', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const p = await toReview(tx, country);
        const item = (await kycItems(tx, p.userId))[0]?.id ?? '';
        const self = await elevateAs(tx, p.userId, 'OPS_AGENT', [country]);
        const claimed = await claimItem(tx, self, item);
        const read = await kycDossier(tx, self, item);
        expect.soft(claimed, 'prise en charge de son propre élément KYC').not.toBe('CLAIMED');
        expect.soft(read.outcome, 'lecture de son propre dossier KYC').not.toBe('GRANTED');
        expect.soft(read.body ?? null, 'dossier rendu à la personne vérifiée').toBeNull();
      });
    });

    it('compte lié (LINKED) à la personne vérifiée : ne prend pas l’élément KYC et ne lit pas le dossier', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const p = await toReview(tx, country);
        const item = (await kycItems(tx, p.userId))[0]?.id ?? '';
        const linked = await staffPerson(tx, country, 'OPS_AGENT');
        expect(
          (await decideLink(tx, null, p.userId, linked.userId, 'LINKED')).link_id,
        ).toBeTruthy();
        const claimed = await claimItem(tx, linked, item);
        const read = await kycDossier(tx, linked, item);
        expect.soft(claimed, 'prise en charge par un compte lié').not.toBe('CLAIMED');
        expect.soft(read.outcome, 'lecture par un compte lié').not.toBe('GRANTED');
      });
    });
  },
);

describe.each(byCountry)(
  'F2-C-03 — constat de comptes liés (risk_staff_decide_account_link) : l’agent qu’un constat concerne (%s)',
  (country) => {
    it('témoin : un agent sans lien enregistre puis inverse un constat entre deux comptes', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const a = await staffPerson(tx, country, 'OPS_AGENT');
        const b = await staffPerson(tx, country, 'OPS_AGENT');
        const witness = await staffPerson(tx, country, 'OPS_AGENT');
        expect((await decideLink(tx, witness, a.userId, b.userId, 'LINKED')).outcome).toBe(
          'RECORDED',
        );
        expect((await decideLink(tx, witness, a.userId, b.userId, 'NOT_LINKED')).outcome).toBe(
          'RECORDED',
        );
      });
    });

    it('l’agent décide pour lui-même (il est l’un des deux comptes) : FORBIDDEN, constat inchangé (garde SELF existante)', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const agent = await staffPerson(tx, country, 'OPS_AGENT');
        const other = await hostOf(tx, country);
        expect(
          (await decideLink(tx, agent, agent.userId, other.userId, 'NOT_LINKED')).outcome,
        ).toBe('FORBIDDEN');
      });
    });

    it('l’agent est lui-même lié (LINKED) à l’un des deux comptes : il ne lève pas (NOT_LINKED) le lien de son propre second compte avec un tiers', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const agent = await staffPerson(tx, country, 'OPS_AGENT');
        const alias = await hostOf(tx, country);
        const third = await hostOf(tx, country);
        // l'ops a constaté que le second compte est la même personne que l'agent
        expect(
          (await decideLink(tx, null, agent.userId, alias.userId, 'LINKED')).link_id,
        ).toBeTruthy();
        // et que ce second compte est lié à un tiers
        expect(
          (await decideLink(tx, null, alias.userId, third.userId, 'LINKED')).link_id,
        ).toBeTruthy();
        const r = await decideLink(tx, agent, alias.userId, third.userId, 'NOT_LINKED', 'OTHER');
        expect(r.outcome, 'levée du lien de son propre second compte').not.toBe('RECORDED');
      });
    });

    it('l’agent est co-hôte du compte d’un titulaire : il ne lève pas le lien (NOT_LINKED) entre ce titulaire et un voyageur', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const owner = await hostOf(tx, country);
        const guest = await hostOf(tx, country);
        const agent = await staffPerson(tx, country, 'OPS_AGENT');
        await cohost(tx, agent.userId, owner.org);
        expect(
          (await decideLink(tx, null, owner.userId, guest.userId, 'LINKED')).link_id,
        ).toBeTruthy();
        const r = await decideLink(tx, agent, owner.userId, guest.userId, 'NOT_LINKED', 'OTHER');
        expect(r.outcome, 'levée par le co-hôte du titulaire').not.toBe('RECORDED');
      });
    });
  },
);

describe.each(byCountry)(
  'F2-C-04 — actions FINANCE (settlement_cmd_request_finance_action, settlement_cmd_approve_finance_action) : le titulaire de l’avance (%s)',
  (country, _currency, cc) => {
    const REASON = 'Décision FINANCE motivée pour le test';
    /** Un appel = une instruction sous le contexte STAFF que pose l'API ; l'erreur éventuelle devient `ERR:<code>`. */
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
    const REQUEST = 'SELECT * FROM core.settlement_cmd_request_finance_action($1, $2, $3, $4, $5)';
    const APPROVE = 'SELECT * FROM core.settlement_cmd_approve_finance_action($1, $2)';

    /** Avance de la plateforme sur un trip du compte d'hôte de `org` (créance au titre d'une jambe libérée). */
    async function advanceOf(tx: Tx, org: string): Promise<string> {
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
      await tx.query('SELECT test_fixture.us062_insert_advance($1, $2, $3, $4::bigint)', [
        advance,
        trip,
        'RELEASED_LEG',
        '10000',
      ]);
      return advance;
    }

    it('témoin : un FINANCE sans lien demande DECIDE_ADVANCE, un second FINANCE l’approuve (deux personnes)', async () => {
      await rolledBack(async (tx) => {
        const owner = await hostOf(tx, country);
        const advance = await advanceOf(tx, owner.org);
        const a = await ops(tx, 'FINANCE', [country]);
        const b = await ops(tx, 'FINANCE', [country]);
        const approval = uuid();
        expect(await finance(tx, a, REQUEST, [approval, 'DECIDE_ADVANCE', advance, REASON])).toBe(
          'REQUESTED',
        );
        expect(await finance(tx, b, APPROVE, [approval])).toBe('APPROVED');
      });
    });

    it.each(['DECIDE_ADVANCE', 'WRITE_OFF_RECEIVABLE'] as const)(
      '%s : le titulaire du compte d’hôte, membre de FINANCE, ne demande pas la décision sur sa propre avance',
      async (action) => {
        await rolledBack(async (tx) => {
          await installTestProofKey(tx);
          const owner = await hostOf(tx, country);
          const advance = await advanceOf(tx, owner.org);
          const self = await elevateAs(tx, owner.userId, 'FINANCE', [country]);
          const r = await finance(tx, self, REQUEST, [uuid(), action, advance, REASON]);
          expect(r, `${action} demandée sur sa propre avance`).not.toBe('REQUESTED');
        });
      },
    );

    it('le titulaire du compte d’hôte, membre de FINANCE, n’approuve pas la décision qu’un collègue a demandée sur sa propre avance', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const owner = await hostOf(tx, country);
        const advance = await advanceOf(tx, owner.org);
        const colleague = await ops(tx, 'FINANCE', [country]);
        const self = await elevateAs(tx, owner.userId, 'FINANCE', [country]);
        const approval = uuid();
        expect(
          await finance(tx, colleague, REQUEST, [approval, 'DECIDE_ADVANCE', advance, REASON]),
        ).toBe('REQUESTED');
        const r = await finance(tx, self, APPROVE, [approval]);
        expect(r, 'approbation de la décision sur sa propre avance').not.toBe('APPROVED');
      });
    });

    it('le co-hôte du compte, membre de FINANCE, ne demande pas non plus la décision sur l’avance du compte', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const owner = await hostOf(tx, country);
        const advance = await advanceOf(tx, owner.org);
        const co = await staffPerson(tx, country, 'FINANCE');
        await cohost(tx, co.userId, owner.org);
        const r = await finance(tx, co, REQUEST, [uuid(), 'DECIDE_ADVANCE', advance, REASON]);
        expect(r, 'demande par un co-hôte du compte').not.toBe('REQUESTED');
      });
    });
  },
);

describe.each(byCountry)(
  'F2-C-05 — asymétrie de la garde (USER_ACCOUNT, IDENTITY_VERIFICATION) : l’agent co-hôte du titulaire (%s)',
  (country) => {
    /** Personne dont le KYC est en revue, titulaire d'un compte d'hôte ; `agent` en est le co-hôte. */
    async function holderWithCohost(tx: Tx, role: string) {
      const p = await toReview(tx, country);
      const acc = await first<{ outcome: string; org_id: string | null }>(
        tx,
        'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
        [p.token, country, 'INDIVIDUAL'],
      );
      expect(acc.outcome).toBe('DONE');
      const agent = await staffPerson(tx, country, role);
      await cohost(tx, agent.userId, acc.org_id ?? '');
      return { p, agent };
    }

    it('KYC_DECISION : l’agent co-hôte du titulaire ne décide pas le KYC du titulaire (comme pour son dossier d’hôte)', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const { p, agent } = await holderWithCohost(tx, 'OPS_AGENT');
        const item = (await kycItems(tx, p.userId))[0]?.id ?? '';
        await claimItem(tx, agent, item);
        const r = await act(tx, agent, 'KYC_DECISION', p.verificationId, {
          input: checks('APPROVED'),
        });
        expect(r).toMatchObject(SELF);
        expect((await kycItems(tx, p.userId))[0]?.decision).not.toBe('APPROVED');
      });
    });

    it('RESTRICT_ACCOUNT puis LIFT_RESTRICTION : l’ADMIN co-hôte du titulaire ne pose ni ne lève une restriction sur le compte du titulaire', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const { p, agent } = await holderWithCohost(tx, 'ADMIN');
        for (const action of ['RESTRICT_ACCOUNT', 'LIFT_RESTRICTION']) {
          expect(
            await act(tx, agent, action, p.userId, { input: { kind: 'POLICY_VIOLATION' } }),
            action,
          ).toMatchObject(SELF);
        }
      });
    });
  },
);
