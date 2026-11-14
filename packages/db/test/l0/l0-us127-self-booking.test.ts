/**
 * US-127 — cumul hôte / voyageur et interdiction de l'auto-réservation (migration 0080, ADR-110 ;
 * fixtures 9978, 9750, 9200, 9984, 9996). Rôles de production seulement (assertion L0-05 par
 * `withRole` / `connectAs`), au Panama (USD) et au Paraguay (PYG). Chaque test crée ses propres
 * personnes, comptes d'hôte et véhicules.
 *
 * Attendus tirés de 19 US-127, de 16 ACC-014 (« elle ne peut jamais réserver un véhicule de son
 * propre compte d'hôte, ni par un compte lié (même appareil, même carte, même pièce) » ; « À la
 * pose du hold : le `org_id` du véhicule est comparé aux comptes d'hôte du guest et des comptes
 * liés → refus si identique » ; « liens légitimes → décision ops tracée » ; « Given un compte lié
 * à l'hôte par la même carte, When il tente la même réservation, Then SELF_BOOKING_FORBIDDEN et un
 * signal ADM-029 »), BKG-012, BKG-014 (2 bis : éligibilité à la conversion), de 17 §2.3
 * (`kyc.decide` : OPS_AGENT et ADMIN, pays de la personne), §2.5 et de 22 OQ-P2P-09 (défaut
 * fail-closed), jamais du code testé :
 * - critère 1 : le titulaire, un co-hôte de l'un de ses comptes (l'autre pays compris) et le
 *   titulaire sur son compte de l'autre pays : SELF_BOOKING_FORBIDDEN, aucun hold ni occupation,
 *   et le même refus que le créneau soit libre ou pris (rien sur l'occupation) ;
 * - critère 2 : un compte lié (même identité vérifiée, même téléphone, lien constaté par l'ops :
 *   même carte, appareil ou permis) : même refus, puis un signalement à l'ops (évaluation
 *   `risk_assessment` REVIEW et file RISK_BOOKING), une seule fois ; jamais pour l'hôte lui-même ;
 * - un constat NOT_LINKED de l'ops (homonyme) rouvre la réservation ; un lien constaté après la
 *   pose ferme la conversion ;
 * - concurrence : comptes liés et voyageurs légitimes en course sur le même créneau ; constat de
 *   l'ops en course avec une pose.
 */
import { randomInt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { commandCallSql, translateDbError } from '../../src/index.ts';
import { connectAs, releaseClient, withRole } from '../../src/testing/index.ts';
import { COUNTRIES, inTx, placeHold, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { Barrier, placeHoldCommand, registerVehicles } from '../support/concurrency.ts';
import { one, person, staff } from '../support/kyc.ts';
import type { Staff } from '../support/kyc.ts';
import { auditOf } from '../support/staff.ts';

const otherOf = (c: CountryCase): CountryCase =>
  COUNTRIES.find((x) => x.country !== c.country) as CountryCase;
const ALL = COUNTRIES.map((x) => x.country);
/** Règle déclarée de 19 US-127 (« règle de risque `risk_rule` pour les comptes liés »), v1. */
const RULE = 'SELF_BOOKING_LINKED_ACCOUNT';

/** Créneaux du test (UTC), loin du préavis : chaque appel décale d'un jour. */
let day = 0;
function slot(): { start: string; end: string } {
  day += 3;
  const start = new Date(Date.UTC(2035, 0, 1, 10) + day * 86_400_000);
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 2 * 86_400_000).toISOString(),
  };
}

/** Code métier d'une pose réelle (commande de production, autocommit) : `OK` ou le code. */
async function pose(
  client: pg.ClientBase,
  guestId: string,
  vehicleId: string,
  orgId: string,
  s: { start: string; end: string },
): Promise<string> {
  try {
    await placeHoldCommand(client, {
      slot: { vehicleId, orgId, start: s.start, end: s.end, bufferHours: 0 },
      guestId,
    });
    return 'OK';
  } catch (error) {
    return translateDbError(error).code;
  }
}

/** Signalement après un refus (commande de production, nouvelle transaction, acteur GUEST). */
async function report(client: pg.ClientBase, guestId: string, vehicleId: string): Promise<void> {
  const { text, values } = commandCallSql(
    { kind: 'GUEST', actorId: guestId },
    'core.booking_cmd_report_self_booking',
    [{ value: vehicleId, type: 'uuid' }],
  );
  await client.query(text, values);
}

interface Assessment {
  readonly id: string;
  readonly subject_type: string;
  readonly country_code: string;
  readonly org_id: string;
  readonly rules_fired: { code: string; version: number; signal: string }[];
  readonly score: number;
  readonly decision: string;
  readonly explanation: string;
  readonly decided_at: string | null;
}

const assessments = async (client: pg.ClientBase, user: string): Promise<Assessment[]> =>
  (await client.query<Assessment>('SELECT * FROM test_fixture.us127_assessments($1)', [user])).rows;

const queueItems = async (client: pg.ClientBase, subject: string) =>
  (
    await client.query<{
      queue: string;
      subject_type: string;
      country_code: string;
      status: string;
    }>('SELECT * FROM test_fixture.us127_queue_items($1)', [subject])
  ).rows;

const holdsOf = (client: pg.ClientBase, guest: string, vehicle: string) =>
  one<{ holds: number; occupancies: number }>(
    client,
    'SELECT * FROM test_fixture.us127_holds($1, $2)',
    [guest, vehicle],
  );

/** Personne de fixture (compte ACTIVE, sans pays de CGU). */
async function party(client: pg.ClientBase): Promise<string> {
  const id = uuid();
  await client.query('SELECT test_fixture.ensure_party($1, NULL, NULL)', [id]);
  return id;
}

/** Compte d'hôte ACTIVE dans `c` (titulaire de fixture) et un véhicule publié. */
async function hostWithVehicle(
  client: pg.ClientBase,
  c: CountryCase,
): Promise<{ org: string; holder: string; vehicle: string }> {
  const org = uuid();
  const vehicle = uuid();
  const r = await client.query<{ h: string }>('SELECT test_fixture.create_org($1, $2, $3) AS h', [
    org,
    c.country,
    'ACTIVE',
  ]);
  await registerVehicles(client, [vehicle], org, c);
  return { org, holder: r.rows[0]?.h as string, vehicle };
}

/** Compte d'hôte ACTIVE d'un titulaire existant dans `c`, et un véhicule publié. */
async function orgFor(
  client: pg.ClientBase,
  holder: string,
  c: CountryCase,
): Promise<{ org: string; vehicle: string }> {
  const org = uuid();
  const vehicle = uuid();
  await client.query('SELECT test_fixture.us127_create_org_for($1, $2, $3)', [
    org,
    holder,
    c.country,
  ]);
  await registerVehicles(client, [vehicle], org, c);
  return { org, vehicle };
}

const cohost = (client: pg.ClientBase, user: string, org: string, status = 'ACTIVE') =>
  client.query(
    `SELECT test_fixture.iam_insert_membership($1, $2, $3, 'CO_HOST', '{}'::uuid[], $4)`,
    [uuid(), user, org, status],
  );

const verify = (
  client: pg.ClientBase,
  user: string,
  c: CountryCase,
  first: string,
  last: string,
  birth: string,
) =>
  client.query('SELECT test_fixture.us127_verified_identity($1, $2, $3, $4, $5::date)', [
    user,
    c.country,
    first,
    last,
    birth,
  ]);

/**
 * US-103 (fixture 9966) : identité vérifiée dont le permis lu par le fournisseur porte le nom
 * `given surnames` (le nom déclaré du compte est `first last`).
 */
async function verifyWithLicense(
  client: pg.ClientBase,
  user: string,
  c: CountryCase,
  declared: readonly [string, string],
  license: readonly [string, string],
  birth: string,
): Promise<void> {
  const v = await one<{ id: string }>(
    client,
    'SELECT test_fixture.us127_verified_identity($1, $2, $3, $4, $5::date) AS id',
    [user, c.country, declared[0], declared[1], birth],
  );
  await client.query('SELECT test_fixture.us103_license_name($1, $2, $3)', [
    v.id,
    license[0],
    license[1],
  ]);
}

/** Numéro E.164 de test, tiré au hasard (donnée de test, aucun plan national). */
const phone = (): string => `+5${String(randomInt(100_000_000, 999_999_999))}`;

const decideLink = (
  client: pg.ClientBase,
  s: Staff,
  a: string,
  b: string,
  decision: string,
  signal: string,
) =>
  one<{ outcome: string; link_id: string | null }>(
    client,
    'SELECT * FROM core.risk_staff_decide_account_link($1, $2, $3, $4, $5, $6)',
    [s.hash, uuid(), a, b, decision, signal],
  );

describe.each(COUNTRIES)('US-127 critère 1 — l’hôte lui-même ($country, $currency)', (c) => {
  it('titulaire (ses deux pays) et co-hôte de son compte de l’autre pays : SELF_BOOKING_FORBIDDEN, aucun hold ni occupation, même refus créneau libre ou pris ; aucun signalement', async () => {
    await withRole('app_api', async (client) => {
      const a = await hostWithVehicle(client, c);
      const b = await orgFor(client, a.holder, otherOf(c)); // son compte de l'autre pays
      const otherCohost = await party(client);
      await cohost(client, otherCohost, b.org);
      const invited = await party(client);
      await cohost(client, invited, b.org, 'INVITED');
      const guest = await party(client);
      const witness = await party(client); // co-hôte d'un compte sans rapport
      const unrelated = await hostWithVehicle(client, c);
      await cohost(client, witness, unrelated.org);

      const taken = slot();
      const free = slot();
      // un voyageur légitime occupe `taken`
      expect(await pose(client, guest, a.vehicle, a.org, taken)).toBe('OK');
      // l'hôte : le même refus, créneau pris ou libre (rien sur l'occupation, 19 US-127 critère 1)
      expect(await pose(client, a.holder, a.vehicle, a.org, taken)).toBe('SELF_BOOKING_FORBIDDEN');
      expect(await pose(client, a.holder, a.vehicle, a.org, free)).toBe('SELF_BOOKING_FORBIDDEN');
      // son véhicule de l'autre pays
      expect(await pose(client, a.holder, b.vehicle, b.org, free)).toBe('SELF_BOOKING_FORBIDDEN');
      // co-hôte (actif ou invité) de son compte de l'autre pays, sur le véhicule de ce pays-ci
      expect(await pose(client, otherCohost, a.vehicle, a.org, free)).toBe(
        'SELF_BOOKING_FORBIDDEN',
      );
      expect(await pose(client, invited, a.vehicle, a.org, free)).toBe('SELF_BOOKING_FORBIDDEN');
      for (const who of [a.holder, otherCohost, invited]) {
        expect(await holdsOf(client, who, a.vehicle), who).toEqual({ holds: 0, occupancies: 0 });
      }
      // l'hôte lui-même n'est pas un soupçon : aucun signalement
      await report(client, a.holder, a.vehicle);
      await report(client, otherCohost, a.vehicle);
      expect(await assessments(client, a.holder)).toEqual([]);
      expect(await assessments(client, otherCohost)).toEqual([]);
      // témoin : le co-hôte d'un compte sans rapport réserve
      expect(await pose(client, witness, a.vehicle, a.org, free)).toBe('OK');
    });
  });
});

describe.each(COUNTRIES)('US-127 critère 2 — comptes liés ($country, $currency)', (c) => {
  it('même identité vérifiée (casse et accents ignorés) : refus, puis UNE évaluation REVIEW et UN élément RISK_BOOKING ; témoins : autre date de naissance, identité non vérifiée', async () => {
    await withRole('app_api', async (client) => {
      const a = await hostWithVehicle(client, c);
      const birth = '1990-04-12';
      await verify(client, a.holder, c, 'María José', 'Núñez Pérez', birth);
      const second = await party(client);
      await verify(client, second, otherOf(c), 'MARIA  JOSE', 'nunez-perez', birth);
      const otherBirth = await party(client);
      await verify(client, otherBirth, c, 'María José', 'Núñez Pérez', '1990-04-13');
      const unverified = await party(client);
      await client.query('SELECT test_fixture.us127_set_names($1, $2, $3)', [
        unverified,
        'María José',
        'Núñez Pérez',
      ]);

      expect(await pose(client, second, a.vehicle, a.org, slot())).toBe('SELF_BOOKING_FORBIDDEN');
      expect(await holdsOf(client, second, a.vehicle)).toEqual({ holds: 0, occupancies: 0 });
      await report(client, second, a.vehicle);
      await report(client, second, a.vehicle); // rejoué : aucune seconde évaluation
      const rows = await assessments(client, second);
      expect(rows).toHaveLength(1);
      const r = rows[0] as Assessment;
      expect(r).toMatchObject({
        subject_type: 'USER',
        country_code: c.country,
        org_id: a.org,
        decision: 'REVIEW',
        explanation: RULE,
        decided_at: null,
      });
      expect(r.rules_fired).toEqual([{ code: RULE, version: 1, signal: 'SAME_IDENTITY' }]);
      expect(await queueItems(client, r.id)).toEqual([
        {
          queue: 'RISK_BOOKING',
          subject_type: 'RISK_ASSESSMENT',
          country_code: c.country,
          status: 'OPEN',
        },
      ]);

      // témoins : même nom, autre date de naissance ; mêmes nom et date mais identité non vérifiée
      expect(await pose(client, otherBirth, a.vehicle, a.org, slot())).toBe('OK');
      expect(await pose(client, unverified, a.vehicle, a.org, slot())).toBe('OK');
      await report(client, otherBirth, a.vehicle);
      expect(await assessments(client, otherBirth)).toEqual([]);
    });
  });

  // US-103 (0088, ADR-117) : la clé de nom est celle du NOM LU SUR LE PERMIS quand le dossier
  // approuvé en a un ; un nom déclaré différent n'échappe plus au signal (ADR-110, risques).
  it('US-103 : même nom lu sur le permis, noms déclarés différents : refus SAME_IDENTITY ; témoin : même nom déclaré, permis d’une autre personne', async () => {
    await withRole('app_api', async (client) => {
      const a = await hostWithVehicle(client, c);
      const birth = '1988-09-03';
      await verifyWithLicense(
        client,
        a.holder,
        c,
        ['María José', 'Núñez Pérez'],
        ['MARIA JOSE', 'NUNEZ PEREZ'],
        birth,
      );
      // second compte : nom déclaré raccourci, même personne d'après le permis
      const second = await party(client);
      await verifyWithLicense(
        client,
        second,
        otherOf(c),
        ['Majo', 'Núñez'],
        ['María José', 'Núñez de Pérez'],
        birth,
      );
      // homonyme déclaré (même nom saisi, même date) dont le permis porte un autre nom
      const namesake = await party(client);
      await verifyWithLicense(
        client,
        namesake,
        c,
        ['María José', 'Núñez Pérez'],
        ['María Josefa', 'Núñez Paredes'],
        birth,
      );

      expect(await pose(client, second, a.vehicle, a.org, slot())).toBe('SELF_BOOKING_FORBIDDEN');
      await report(client, second, a.vehicle);
      expect((await assessments(client, second)).map((x) => x.rules_fired)).toEqual([
        [{ code: RULE, version: 1, signal: 'SAME_IDENTITY' }],
      ]);
      expect(await pose(client, namesake, a.vehicle, a.org, slot())).toBe('OK');
    });
  });

  it('même téléphone (vérifié chez l’hôte, non vérifié chez le voyageur) : refus et signalement SAME_PHONE ; témoin : autre numéro', async () => {
    await withRole('app_api', async (client) => {
      const a = await hostWithVehicle(client, c);
      const n = phone();
      await client.query('SELECT test_fixture.us127_set_phone($1, $2, true)', [a.holder, n]);
      const linked = await party(client);
      await client.query('SELECT test_fixture.us127_set_phone($1, $2, false)', [linked, n]);
      const witness = await party(client);
      await client.query('SELECT test_fixture.us127_set_phone($1, $2, false)', [witness, phone()]);

      expect(await pose(client, linked, a.vehicle, a.org, slot())).toBe('SELF_BOOKING_FORBIDDEN');
      await report(client, linked, a.vehicle);
      const rows = await assessments(client, linked);
      expect(rows.map((x) => x.rules_fired)).toEqual([
        [{ code: RULE, version: 1, signal: 'SAME_PHONE' }],
      ]);
      expect(await pose(client, witness, a.vehicle, a.org, slot())).toBe('OK');
    });
  });

  it('lien constaté par l’ops (même carte), comptes de pays différents : refus et signalement SAME_CARD ; permission dans les DEUX pays, jamais son propre lien, rejoué UNCHANGED, journalisé', async () => {
    await withRole('app_api', async (client) => {
      const holder = await person(client, c.country);
      const a = await orgFor(client, holder.userId, c);
      const guest = await person(client, otherOf(c).country);
      const opsOne = await staff(client, 'OPS_AGENT', [c.country], c.country);
      const opsAll = await staff(client, 'OPS_AGENT', ALL, c.country);

      // permission dans un seul des deux pays : refus journalisé, rien d'écrit
      expect(
        await decideLink(client, opsOne, holder.userId, guest.userId, 'LINKED', 'SAME_CARD'),
      ).toMatchObject({ outcome: 'FORBIDDEN', link_id: null });
      expect(
        (await auditOf(client, opsOne.userId)).find((x) => x.action_code === 'STAFF_FORBIDDEN')
          ?.after,
      ).toMatchObject({ reason: 'PERMISSION', attempted: 'ACCOUNT_LINK_DECISION' });
      expect(
        await client.query('SELECT * FROM test_fixture.us127_link($1, $2)', [
          holder.userId,
          guest.userId,
        ]),
      ).toMatchObject({ rowCount: 0 });
      // jamais un lien qui concerne l'acteur lui-même
      expect(
        await decideLink(client, opsAll, opsAll.userId, guest.userId, 'LINKED', 'SAME_DEVICE'),
      ).toMatchObject({ outcome: 'FORBIDDEN' });

      // avant le constat : réservation possible (aucun signal automatique entre eux)
      expect(await pose(client, guest.userId, a.vehicle, a.org, slot())).toBe('OK');
      const d = await decideLink(
        client,
        opsAll,
        guest.userId,
        holder.userId,
        'LINKED',
        'SAME_CARD',
      );
      expect(d.outcome).toBe('RECORDED');
      expect(
        await decideLink(client, opsAll, holder.userId, guest.userId, 'LINKED', 'SAME_CARD'),
      ).toEqual({ outcome: 'UNCHANGED', link_id: d.link_id });
      const link = await one<{ decision: string; signal: string; decided_by: string }>(
        client,
        'SELECT * FROM test_fixture.us127_link($1, $2)',
        [holder.userId, guest.userId],
      );
      expect(link).toMatchObject({
        decision: 'LINKED',
        signal: 'SAME_CARD',
        decided_by: opsAll.userId,
      });
      const audit = (await auditOf(client, opsAll.userId)).filter(
        (x) => x.action_code === 'ACCOUNT_LINK_DECIDED',
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]?.after).toMatchObject({ decision: 'LINKED', signal: 'SAME_CARD' });

      expect(await pose(client, guest.userId, a.vehicle, a.org, slot())).toBe(
        'SELF_BOOKING_FORBIDDEN',
      );
      await report(client, guest.userId, a.vehicle);
      const rows = await assessments(client, guest.userId);
      expect(rows.map((x) => [x.country_code, x.org_id, x.rules_fired])).toEqual([
        [c.country, a.org, [{ code: RULE, version: 1, signal: 'SAME_CARD' }]],
      ]);
    });
  });

  it('constat NOT_LINKED de l’ops (homonyme) : la même identité vérifiée ne bloque plus ; LINKED la referme', async () => {
    await withRole('app_api', async (client) => {
      const holder = await person(client, c.country);
      const a = await orgFor(client, holder.userId, c);
      const namesake = await person(client, c.country);
      const birth = '1985-11-30';
      await verify(client, holder.userId, c, 'Juan', 'Gómez', birth);
      await verify(client, namesake.userId, c, 'Juan', 'Gomez', birth);
      const ops = await staff(client, 'OPS_AGENT', [c.country], c.country);

      expect(await pose(client, namesake.userId, a.vehicle, a.org, slot())).toBe(
        'SELF_BOOKING_FORBIDDEN',
      );
      expect(
        (
          await decideLink(
            client,
            ops,
            holder.userId,
            namesake.userId,
            'NOT_LINKED',
            'SAME_IDENTITY',
          )
        ).outcome,
      ).toBe('RECORDED');
      expect(await pose(client, namesake.userId, a.vehicle, a.org, slot())).toBe('OK');
      expect(
        (await decideLink(client, ops, holder.userId, namesake.userId, 'LINKED', 'SAME_IDENTITY'))
          .outcome,
      ).toBe('RECORDED');
      expect(
        await one<{ row_version: number }>(
          client,
          'SELECT * FROM test_fixture.us127_link($1, $2)',
          [holder.userId, namesake.userId],
        ),
      ).toMatchObject({ decision: 'LINKED', row_version: 1 });
      expect(await pose(client, namesake.userId, a.vehicle, a.org, slot())).toBe(
        'SELF_BOOKING_FORBIDDEN',
      );
    });
  });
});

describe.each(COUNTRIES)('US-127 — conversion et rôles ($country, $currency)', (c) => {
  it('lien constaté ou co-hôte ajouté APRÈS la pose : la conversion n’est plus éligible (SELF_BOOKING)', async () => {
    const api = await connectAs('app_api');
    const worker = await connectAs('app_worker');
    try {
      const holder = await person(api, c.country);
      const a = await orgFor(api, holder.userId, c);
      const linked = await person(api, otherOf(c).country);
      const later = await party(api);
      const witness = await party(api);
      const ops = await staff(api, 'OPS_AGENT', ALL, c.country);
      // holds posés par la fixture (le lien n'existe pas encore)
      const s = slot();
      const holds = await inTx(api, { commit: true }, async (tx) => {
        const out: Record<string, string> = {};
        let k = 0;
        for (const [name, guest] of [
          ['linked', linked.userId],
          ['later', later],
          ['witness', witness],
        ] as const) {
          k += 3;
          const start = new Date(Date.parse(s.start) + k * 86_400_000).toISOString();
          const end = new Date(Date.parse(start) + 86_400_000).toISOString();
          const h = await placeHold(
            tx,
            { vehicleId: a.vehicle, orgId: a.org, start, end, bufferHours: 0 },
            c,
            guest,
          );
          out[name] = h.holdId;
        }
        return out;
      });
      const eligibility = (holdId: string) =>
        inTx(worker, { worker: 'booking_conversion' }, async (tx) => {
          const r = await tx.query<{ r: string }>(
            'SELECT core.booking_conversion_eligibility($1) AS r',
            [holdId],
          );
          return r.rows[0]?.r;
        });
      for (const h of Object.values(holds)) expect(await eligibility(h)).toBe('ELIGIBLE');
      expect(
        (await decideLink(api, ops, linked.userId, holder.userId, 'LINKED', 'SAME_DEVICE')).outcome,
      ).toBe('RECORDED');
      await cohost(api, later, a.org);
      expect(await eligibility(holds.linked as string)).toBe('SELF_BOOKING');
      expect(await eligibility(holds.later as string)).toBe('SELF_BOOKING');
      expect(await eligibility(holds.witness as string)).toBe('ELIGIBLE');
    } finally {
      await releaseClient(api);
      await releaseClient(worker);
    }
  });

  it('rôles : le jugement du lien n’est exécutable par aucun rôle applicatif ; le signalement exige un voyageur et app_api', async () => {
    await withRole('app_api', async (client) => {
      const a = await hostWithVehicle(client, c);
      await expect(
        client.query('SELECT core.risk_self_booking_signal($1, $2)', [a.holder, a.org]),
      ).rejects.toMatchObject({ code: '42501' });
      const { text, values } = commandCallSql(
        { kind: 'HOST', actorId: a.holder, orgId: a.org },
        'core.booking_cmd_report_self_booking',
        [{ value: a.vehicle, type: 'uuid' }],
      );
      await expect(client.query(text, values)).rejects.toMatchObject({ code: '42501' });
    });
    for (const role of ['app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        for (const sql of [
          'SELECT core.risk_self_booking_signal($1, $1)',
          'SELECT core.booking_cmd_report_self_booking($1)',
          `SELECT * FROM core.risk_staff_decide_account_link('\\x00', $1, $1, $1, 'LINKED', 'OTHER')`,
        ]) {
          await expect(client.query(sql, [uuid()]), `${role} ${sql}`).rejects.toMatchObject({
            code: '42501',
          });
        }
      });
    }
  });
});

describe.each(COUNTRIES)('US-127 — concurrence ($country, $currency)', (c) => {
  it('course sur un même créneau : hôte, co-hôte de l’autre pays et comptes liés tous refusés ; un seul voyageur légitime gagne ; aucun interblocage', async () => {
    const LEGIT = 6;
    const setup = await withRole('app_api', async (client) => {
      const a = await hostWithVehicle(client, c);
      const b = await orgFor(client, a.holder, otherOf(c));
      const otherCohost = await party(client);
      await cohost(client, otherCohost, b.org);
      const birth = '1979-02-28';
      await verify(client, a.holder, c, 'Rosa', 'Benítez', birth);
      const sameIdentity = await party(client);
      await verify(client, sameIdentity, c, 'rosa', 'BENITEZ', birth);
      const n = phone();
      await client.query('SELECT test_fixture.us127_set_phone($1, $2, true)', [a.holder, n]);
      const samePhone = await party(client);
      await client.query('SELECT test_fixture.us127_set_phone($1, $2, false)', [samePhone, n]);
      const legit: string[] = [];
      for (let i = 0; i < LEGIT; i++) legit.push(await party(client));
      return { a, forbidden: [a.holder, otherCohost, sameIdentity, samePhone], legit };
    });
    const s = slot();
    const everyone = [...setup.forbidden, ...setup.legit];
    const observer = await connectAs('app_api');
    const posers = await Promise.all(everyone.map(() => connectAs('app_api')));
    try {
      const barrier = await Barrier.open(observer);
      const runs = posers.map(async (client, i) => {
        await barrier.wait(client);
        return pose(client, everyone[i] as string, setup.a.vehicle, setup.a.org, s);
      });
      try {
        await barrier.waitForWaiters(posers.length);
      } finally {
        await barrier.release();
      }
      const outcomes = await Promise.all(runs);
      const forbidden = outcomes.slice(0, setup.forbidden.length);
      const legit = outcomes.slice(setup.forbidden.length);
      expect(forbidden).toEqual(setup.forbidden.map(() => 'SELF_BOOKING_FORBIDDEN'));
      expect(legit.filter((o) => o === 'OK')).toHaveLength(1);
      expect(legit.filter((o) => o === 'VEHICLE_UNAVAILABLE')).toHaveLength(LEGIT - 1);
      // un seul hold (et une seule occupation HOLD) posé, celui du gagnant légitime
      let legitHolds = 0;
      for (const who of setup.legit) {
        const h = await holdsOf(observer, who, setup.a.vehicle);
        expect(h.holds, who).toBe(h.occupancies);
        legitHolds += h.holds;
      }
      expect(legitHolds).toBe(1);
      for (const who of setup.forbidden) {
        expect(await holdsOf(observer, who, setup.a.vehicle)).toEqual({
          holds: 0,
          occupancies: 0,
        });
      }
    } finally {
      await releaseClient(observer);
      for (const p of posers) await releaseClient(p);
    }
  });

  it('constat de l’ops en course avec la pose du compte lié : jamais un hold convertible (refus à la pose, ou SELF_BOOKING à la conversion)', async () => {
    const api = await connectAs('app_api');
    const ops = await connectAs('app_api');
    const worker = await connectAs('app_worker');
    const observer = await connectAs('app_api');
    try {
      const holder = await person(api, c.country);
      const a = await orgFor(api, holder.userId, c);
      const guest = await person(api, c.country);
      const agent = await staff(ops, 'OPS_AGENT', [c.country], c.country);
      const s = slot();
      const barrier = await Barrier.open(observer);
      const poseRun = (async () => {
        await barrier.wait(api);
        return pose(api, guest.userId, a.vehicle, a.org, s);
      })();
      const linkRun = (async () => {
        await barrier.wait(ops);
        return decideLink(ops, agent, guest.userId, holder.userId, 'LINKED', 'SAME_DEVICE');
      })();
      try {
        await barrier.waitForWaiters(2);
      } finally {
        await barrier.release();
      }
      const [posed, linked] = await Promise.all([poseRun, linkRun]);
      expect(linked.outcome).toBe('RECORDED');
      if (posed === 'OK') {
        // le constat est arrivé après la pose : la conversion est fermée
        expect(await holdsOf(observer, guest.userId, a.vehicle)).toMatchObject({ holds: 1 });
        const hold = await one<{ id: string }>(
          observer,
          'SELECT test_fixture.us127_any_hold($1, $2) AS id',
          [guest.userId, a.vehicle],
        );
        const r = await inTx(worker, { worker: 'booking_conversion' }, async (tx) =>
          tx.query<{ r: string }>('SELECT core.booking_conversion_eligibility($1) AS r', [hold.id]),
        );
        expect(r.rows[0]?.r).toBe('SELF_BOOKING');
      } else {
        expect(posed).toBe('SELF_BOOKING_FORBIDDEN');
      }
      // après la course, toute nouvelle pose est refusée
      expect(await pose(api, guest.userId, a.vehicle, a.org, slot())).toBe(
        'SELF_BOOKING_FORBIDDEN',
      );
    } finally {
      for (const cl of [api, ops, worker, observer]) await releaseClient(cl);
    }
  });
});
