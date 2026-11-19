/**
 * US-222c — red team du lot 2, RT-L2-S01 : rejeu des suites N-114 (`SAME_IDENTITY`, US-209 / US-127),
 * N-116 (séparation des tâches de la console, US-215c) et N-118 (doublon d'identité d'hôte), sous le
 * rôle de PRODUCTION app_api (`rolledBack` → `withRole` : assertion L0-05), en USD (PA) et en PYG
 * (PY), transactions ANNULÉES. TESTS SEULEMENT (L2-PM-39). N-292 (contrôleur `POST /console/actions`)
 * est rejouée côté HTTP par `apps/api/src/modules/sup/internal/redteam-l2-console-actions.test.ts`.
 *
 * Attendus (jamais le code testé) : 16 ACC-014 (« elle ne peut jamais réserver un véhicule de son
 * propre compte d'hôte, ni par un compte lié (… même pièce) ») et ADR-122 (signal SAME_IDENTITY,
 * garde unique : la personne, les personnes de ses comptes d'hôte, un compte LINKED) ; 08 BR-ACC-06
 * (« une personne, un compte d'hôte ») ; BOARD N-114 (« garder aussi l'égalité de
 * `kyc_legal_name_key` (noms à un mot) »), N-116 (FAIT par US-215c, rejouée ici sur la variante
 * « compte lié » que l0-us215c ne joue pas), N-118 (« compter aussi REVOKED / REJECTED (bannissement
 * contourné) »).
 *
 * Constats (`it.fails` documentés, docs/team/redteam/L2-rls-lb.md) : F-L2-LB-04 (N-114, nom à un
 * seul mot : jumeau non lié, auto-réservation admise) et F-L2-LB-05 (N-118, dossier d'hôte REJETÉ :
 * le même titulaire, sous un second compte, est approuvé). CORRIGÉS par US-222d2 (migration 0155,
 * ADR-177) : chaque `it.fails` est inversé en `it`, attaque et attentes inchangées ; le chemin
 * légitime est prouvé (homonyme réel d'une autre naissance, ou constaté NOT_LINKED par l'ops, non
 * bloqué ; jumeau d'un dossier REJETÉ libéré par le constat NOT_LINKED).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../../src/index.ts';
import { person } from '../../support/kyc.ts';
import { installTestProofKey } from '../../support/staff.ts';
import { placeHoldCommand, registerVehicles } from '../../support/concurrency.ts';
import { act, first, hostState, readyHost } from '../l1/support-host.ts';
import { decideLink, staffPerson } from '../l1/support-p2.ts';
import { byCountry, hostOf, ops, rolledBack } from '../l1/support.ts';
import type { CountryCase, Tx } from '../l1/support.ts';

const uuid = (): string => randomUUID();

// ---------------------------------------------------------------------------------------------
// N-114 — SAME_IDENTITY : nom dont le sac de mots n'a qu'un mot
// ---------------------------------------------------------------------------------------------
let slotDay = 0;
/** Créneau à venir, loin du préavis, propre à chaque appel. */
function slot(): { start: string; end: string } {
  slotDay += 3;
  const start = new Date(Date.UTC(2036, 2, 1, 10) + slotDay * 86_400_000);
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 2 * 86_400_000).toISOString(),
  };
}
/** Date de naissance propre à l'exécution (aucune autre identité vérifiée ne la partage). */
const birthOf = (n: number): string =>
  new Date(Date.UTC(1961, 0, 1) + ((Date.now() / 1000 + n * 7919) % 9000) * 86_400_000)
    .toISOString()
    .slice(0, 10);

const verify = (
  tx: Tx,
  user: string,
  cc: CountryCase,
  given: string,
  last: string,
  birth: string,
) =>
  tx.query('SELECT test_fixture.us127_verified_identity($1, $2, $3, $4, $5::date)', [
    user,
    cc.country,
    given,
    last,
    birth,
  ]);

/** Pose réelle (US-023) dans la transaction annulée ; `OK` ou le code métier (point de sauvegarde). */
async function pose(tx: Tx, guest: string, vehicle: string, org: string): Promise<string> {
  const s = slot();
  await tx.query('SAVEPOINT rt_pose');
  try {
    await placeHoldCommand(tx, {
      slot: { vehicleId: vehicle, orgId: org, start: s.start, end: s.end, bufferHours: 0 },
      guestId: guest,
    });
    await tx.query('RELEASE SAVEPOINT rt_pose');
    return 'OK';
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT rt_pose');
    return translateDbError(error).code;
  }
}

/** Titulaire d'un compte d'hôte (vérifié sous `holder`), un véhicule publié, et son « jumeau ». */
async function twins(
  tx: Tx,
  cc: CountryCase,
  holder: { given: string; last: string },
  twin: { given: string; last: string },
  birth: string,
): Promise<{ org: string; vehicle: string; twin: string }> {
  const org = uuid();
  const vehicle = uuid();
  const h = await tx.query<{ h: string }>('SELECT test_fixture.create_org($1, $2, $3) AS h', [
    org,
    cc.country,
    'ACTIVE',
  ]);
  await registerVehicles(tx, [vehicle], org, cc);
  await verify(tx, h.rows[0]!.h, cc, holder.given, holder.last, birth);
  const second = uuid();
  await tx.query('SELECT test_fixture.ensure_party($1, NULL, NULL)', [second]);
  await verify(tx, second, cc, twin.given, twin.last, birth);
  return { org, vehicle, twin: second };
}

/** Noms à un seul mot distinct de deux lettres ou plus (revues de la PR #146, N-114). */
const MONONYMS = [
  {
    label: '« Wei Wei »',
    holder: { given: 'Wei', last: 'Wei' },
    twin: { given: 'WEI', last: 'wei' },
  },
  { label: '« A Li »', holder: { given: 'A', last: 'Li' }, twin: { given: 'A.', last: 'LI' } },
] as const;

describe.each(byCountry)(
  'N-114 rejouée — SAME_IDENTITY, nom à un mot (%s, %s)',
  (country, _c, cc) => {
    it('témoin : jumeau de même naissance au nom de deux mots (« María José Núñez ») ⇒ SELF_BOOKING_FORBIDDEN ; même nom, autre naissance ⇒ OK', async () => {
      await rolledBack(async (tx) => {
        const birth = birthOf(1 + byCountry.findIndex(([c]) => c === country));
        const w = await twins(
          tx,
          cc,
          { given: 'María José', last: 'Núñez' },
          { given: 'MARIA JOSE', last: 'nunez' },
          birth,
        );
        expect(await pose(tx, w.twin, w.vehicle, w.org)).toBe('SELF_BOOKING_FORBIDDEN');
        const stranger = uuid();
        await tx.query('SELECT test_fixture.ensure_party($1, NULL, NULL)', [stranger]);
        await verify(tx, stranger, cc, 'María José', 'Núñez', '1990-04-13');
        expect(await pose(tx, stranger, w.vehicle, w.org)).toBe('OK');
      });
    });

    for (const m of MONONYMS) {
      it(`attaque jouée — ${m.label} : jumeau de même naissance et même nom à un mot pose un hold sur le véhicule de l’hôte ; observation (F-L2-LB-04)`, async () => {
        await rolledBack(async (tx) => {
          const birth = birthOf(11 + byCountry.findIndex(([c]) => c === country));
          const w = await twins(tx, cc, m.holder, m.twin, birth);
          expect(['OK', 'SELF_BOOKING_FORBIDDEN']).toContain(
            await pose(tx, w.twin, w.vehicle, w.org),
          );
        });
      });

      // F-L2-LB-04 (faible, PROPOSÉE ; N-114 ; CORRIGÉ par US-222d2, `it.fails` inversé en `it`) :
      // garder aussi l'égalité de la clé de nom normalisée (`kyc_legal_name_key`, OU avec l'inclusion
      // des sacs) à date de naissance égale. Signal attendu après correction : SELF_BOOKING_FORBIDDEN,
      // aucun hold.
      it(`F-L2-LB-04 — ${m.label} : le jumeau de même naissance est reconnu (SELF_BOOKING_FORBIDDEN)`, async () => {
        await rolledBack(async (tx) => {
          const birth = birthOf(21 + byCountry.findIndex(([c]) => c === country));
          const w = await twins(tx, cc, m.holder, m.twin, birth);
          expect(await pose(tx, w.twin, w.vehicle, w.org)).toBe('SELF_BOOKING_FORBIDDEN');
        });
      });

      it(`chemin légitime (US-222d2) — ${m.label} : homonyme d’une autre naissance ⇒ OK ; homonyme de même naissance constaté NOT_LINKED par l’ops ⇒ OK (jamais bloqué sans revue humaine)`, async () => {
        await rolledBack(async (tx) => {
          const birth = birthOf(31 + byCountry.findIndex(([c]) => c === country));
          // personnes inscrites (CGU du voyageur acceptées : le constat de l'ops lit leur pays)
          const host = await hostOf(tx, country, { first: m.holder.given, last: m.holder.last });
          const vehicle = uuid();
          await registerVehicles(tx, [vehicle], host.org, cc);
          await verify(tx, host.userId, cc, m.holder.given, m.holder.last, birth);
          const twin = await person(tx, country, { first: m.twin.given, last: m.twin.last });
          await verify(tx, twin.userId, cc, m.twin.given, m.twin.last, birth);
          const other = await person(tx, country, { first: m.twin.given, last: m.twin.last });
          await verify(tx, other.userId, cc, m.twin.given, m.twin.last, '1990-04-13');
          expect(await pose(tx, other.userId, vehicle, host.org)).toBe('OK');
          // même naissance : reconnu tant que l'ops n'a rien constaté, puis libéré par NOT_LINKED
          expect(await pose(tx, twin.userId, vehicle, host.org)).toBe('SELF_BOOKING_FORBIDDEN');
          expect(
            (await decideLink(tx, null, twin.userId, host.userId, 'NOT_LINKED', 'SAME_IDENTITY'))
              .outcome,
          ).toBe('RECORDED');
          expect(await pose(tx, twin.userId, vehicle, host.org)).toBe('OK');
        });
      });
    }
  },
);

// ---------------------------------------------------------------------------------------------
// N-116 — séparation des tâches de la console : variante « compte lié » (LINKED)
// ---------------------------------------------------------------------------------------------
const PURPOSE = 'Instruction du dossier assigné à l’agent';
const FIELD = 'identity_document.number_enc';
interface Who {
  readonly userId: string;
  readonly hash: Buffer;
}
interface Result {
  readonly outcome: string;
  readonly body: Record<string, unknown> | null;
}
const profile = (tx: Tx, s: Who, user: string) =>
  first<Result>(tx, 'SELECT * FROM core.support_staff_profile($1, $2, $3, $4)', [
    s.hash,
    uuid(),
    user,
    PURPOSE,
  ]);
const note = (tx: Tx, s: Who, user: string) =>
  first<Result>(tx, 'SELECT * FROM core.support_staff_add_note($1, $2, $3, $4)', [
    s.hash,
    uuid(),
    user,
    `Note de la red team ${uuid()}`,
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
const dataAccess = (tx: Tx, s: Who, caseId: string, subject: string) =>
  first<{ outcome: string }>(
    tx,
    'SELECT * FROM core.iam_staff_cmd_data_access($1, $2, $3, $4, $5, $6, $7, $8)',
    [s.hash, uuid(), caseId, 'USER', subject, FIELD, 'READ_C3', PURPOSE],
  );
const caseOf = async (tx: Tx, s: Who, requester: string): Promise<string> => {
  const r = await openCase(tx, s, requester);
  expect(r.outcome).toBe('OPENED');
  return String(r.body?.['caseId'] ?? '');
};

describe.each(byCountry)('N-116 rejouée — compte lié (LINKED) au sujet (%s, %s)', (country) => {
  it('un ADMIN lié (LINKED) à la personne : ni fiche 360°, ni note, ni dossier, ni état du dossier, ni lecture C3 (SELF_FORBIDDEN) ; témoin : un ADMIN sans lien est servi', async () => {
    await rolledBack(async (tx) => {
      await installTestProofKey(tx);
      const subject = await person(tx, country);
      const stranger = await person(tx, country);
      const agent = await staffPerson(tx, country, 'ADMIN');
      const witness = await ops(tx, 'ADMIN', [country]);
      expect((await decideLink(tx, null, agent.userId, subject.userId, 'LINKED')).outcome).toBe(
        'RECORDED',
      );
      const theirCase = await caseOf(tx, witness, subject.userId);
      const ownCase = await caseOf(tx, agent, stranger.userId);
      expect((await profile(tx, agent, subject.userId)).outcome).toBe('SELF_FORBIDDEN');
      expect((await note(tx, agent, subject.userId)).outcome).toBe('SELF_FORBIDDEN');
      expect((await openCase(tx, agent, subject.userId)).outcome).toBe('SELF_FORBIDDEN');
      expect((await caseStatus(tx, agent, theirCase, 'CLOSED')).outcome).toBe('SELF_FORBIDDEN');
      expect((await dataAccess(tx, agent, ownCase, subject.userId)).outcome).toBe('SELF_FORBIDDEN');
      // témoins : la garde ne refuse pas tout
      expect((await profile(tx, witness, subject.userId)).outcome).toBe('GRANTED');
      expect((await note(tx, witness, subject.userId)).outcome).toBe('ADDED');
      expect((await dataAccess(tx, agent, ownCase, stranger.userId)).outcome).toBe('GRANTED');
    });
  });
});

// ---------------------------------------------------------------------------------------------
// N-118 — doublon d'identité d'hôte : dossier REJETÉ (bannissement contourné)
// ---------------------------------------------------------------------------------------------
describe.each(byCountry)('N-118 rejouée — doublon d’identité d’hôte (%s, %s)', (country) => {
  const decision = (tx: Tx, agent: Who, org: string, d: 'APPROVED' | 'REJECTED') =>
    act(tx, agent, 'HOST_VERIFICATION_DECISION', org, { input: { decision: d } });

  it('témoin : le jumeau d’un hôte APPROUVÉ n’est pas approuvé (HOST_IDENTITY_DUPLICATE) ; attaque jouée : dossier du premier REJETÉ, le jumeau est décidé ; observation (F-L2-LB-05)', async () => {
    await rolledBack(async (tx) => {
      await installTestProofKey(tx);
      const agent = await ops(tx, 'OPS_AGENT', [country]);
      const a = await readyHost(tx, country, 'CLEAR');
      const b = await readyHost(tx, country, 'CLEAR');
      expect((await decision(tx, agent, a.org, 'APPROVED')).outcome).toBe('DONE');
      expect(await decision(tx, agent, b.org, 'APPROVED')).toMatchObject({
        outcome: 'REFUSED',
        detail: 'HOST_IDENTITY_DUPLICATE',
      });
    });
    await rolledBack(async (tx) => {
      await installTestProofKey(tx);
      const agent = await ops(tx, 'OPS_AGENT', [country]);
      const a = await readyHost(tx, country, 'CLEAR');
      const b = await readyHost(tx, country, 'CLEAR');
      expect((await decision(tx, agent, a.org, 'REJECTED')).outcome).toBe('DONE');
      expect(['DONE', 'REFUSED']).toContain((await decision(tx, agent, b.org, 'APPROVED')).outcome);
    });
  });

  // F-L2-LB-05 (moyenne, PROPOSÉE ; N-118 ; CORRIGÉ par US-222d2, `it.fails` inversé en `it`) : un
  // dossier d'hôte REJETÉ (ou REVOKED) du même titulaire compte comme un doublon : le second dossier
  // part en revue de l'ops (constat de comptes liés). Signal attendu après correction : REFUSED /
  // HOST_IDENTITY_DUPLICATE, second dossier IN_REVIEW.
  it('F-L2-LB-05 — dossier du premier REJETÉ : le jumeau n’est pas approuvé (HOST_IDENTITY_DUPLICATE), il reste en revue', async () => {
    await rolledBack(async (tx) => {
      await installTestProofKey(tx);
      const agent = await ops(tx, 'OPS_AGENT', [country]);
      const a = await readyHost(tx, country, 'CLEAR');
      const b = await readyHost(tx, country, 'CLEAR');
      expect((await decision(tx, agent, a.org, 'REJECTED')).outcome).toBe('DONE');
      expect(await decision(tx, agent, b.org, 'APPROVED')).toMatchObject({
        outcome: 'REFUSED',
        detail: 'HOST_IDENTITY_DUPLICATE',
      });
      expect((await hostState(tx, b))['verification_status']).toBe('IN_REVIEW');
    });
  });

  it('chemin légitime (US-222d2) — dossier du premier REJETÉ, puis constat NOT_LINKED de l’ops entre les deux titulaires (deux personnes) : le second dossier est approuvé', async () => {
    await rolledBack(async (tx) => {
      await installTestProofKey(tx);
      const agent = await ops(tx, 'OPS_AGENT', [country]);
      const a = await readyHost(tx, country, 'CLEAR');
      const b = await readyHost(tx, country, 'CLEAR');
      expect((await decision(tx, agent, a.org, 'REJECTED')).outcome).toBe('DONE');
      expect(await decision(tx, agent, b.org, 'APPROVED')).toMatchObject({
        detail: 'HOST_IDENTITY_DUPLICATE',
      });
      expect(
        (await decideLink(tx, null, a.userId, b.userId, 'NOT_LINKED', 'SAME_IDENTITY')).outcome,
      ).toBe('RECORDED');
      expect((await decision(tx, agent, b.org, 'APPROVED')).outcome).toBe('DONE');
    });
  });
});
