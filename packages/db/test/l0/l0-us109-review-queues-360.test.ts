/**
 * Preuves des files de revue, de la fiche 360°, des notes internes, des dossiers de support, des
 * pièces du staff et des restrictions de compte (US-109, migration 0064 ; fixtures 9990) sous le
 * rôle de production app_api (assertion L0-05 en tête de chaque connexion, withRole), en USD (PA)
 * et en PYG (PY). Chaque test crée ses propres personnes, membres du staff (élévation TOTP réelle),
 * dossiers et éléments de file.
 *
 * Attendus tirés de 19 US-109 (critères d'acceptation), de 16 ADM-005 (fiche 360° : statut KYC
 * sans image, restrictions avec motif, levée motivée, « un hôte restreint : ses annonces fermées à
 * la réservation » ; permissions SUPPORT lecture et notes, OPS restrictions), ADM-029 (files avec
 * délai), ADM-032 (journal d'accès), de 17 §2.3 (OPS / SUPPORT : objets couverts par un dossier
 * ou un élément de file assigné ; ADMIN : tout, journalisé ; FINANCE : aucune table KYC ; C3
 * seulement par `kyc.read_sensitive`), §3.2.13, §7.2 (`kyc_review_sla_business_h` = 4,
 * `listing_review_sla_h` = 24, `review_hold_minutes` = 120), et du pré-mortem du lot 1 (L1-PM-08 :
 * aucun KYC hors de la file ni sans ligne au journal ; L1-PM-33 : restriction de l'hôte), jamais
 * du code testé :
 * - critère 1 : un compte restreint ne réserve pas (ACCOUNT_RESTRICTED) ; levée motivée ⇒ réserve ;
 * - critère 2 : chaque consultation d'un dossier KYC est au journal d'accès ; hors file : refus
 *   journalisé, aucune donnée, aucune ligne d'accès ;
 * - critère 3 : un élément qui dépasse son délai est signalé ;
 * - IDOR : un membre du staff d'un pays ne lit, n'écrit ni ne restreint rien de l'autre pays.
 */
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { setSessionContext, translateDbError } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { ensureParties, placeHoldCommand, registerVehicles } from '../support/concurrency.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import { auditOf, elevate, elevatedStaff, login, stepNow } from '../support/staff.ts';

const ALL = COUNTRIES.map((c) => c.country);
const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const REASON = 'Signalement de sécurité reçu par le support';
const PURPOSE = 'Instruction du dossier assigné';
const byCountry = COUNTRIES.map((c) => [c.country, c.currency, c] as const);
const otherOf = (country: string): string => ALL.find((x) => x !== country) ?? '';

type Staff = Awaited<ReturnType<typeof elevatedStaff>>;

interface Person {
  readonly userId: string;
  readonly hash: Buffer;
  readonly email: string;
}

/** Personne inscrite par la vraie commande dans `country`, compte ACTIVE, session ouverte. */
async function person(client: pg.ClientBase, country: string): Promise<Person> {
  const userId = uuid();
  const email = `p109-${userId}@example.test`;
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Lucía', 'Benítez', 'es', $4, $5, 86400,
                                                NULL, $6, $7::jsonb, false) AS ok`,
    [userId, email, phcArgon2id(), uuid(), randomBytes(32), country, DOCS],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await client.query(`SELECT test_fixture.iam_set_account_status($1, 'ACTIVE')`, [userId]);
  const t = newToken();
  const s = await client.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [uuid(), userId, t.hash, SESSION_TTL_S],
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  return { userId, hash: t.hash, email };
}

/**
 * Membre du staff qui est AUSSI une personne inscrite dans `country` (son compte a un pays, donc
 * il peut être le sujet d'une action de console) : rôle, facteur TOTP, session élevée par les
 * vraies commandes (mêmes étapes qu'`elevatedStaff`).
 */
async function staffPerson(
  client: pg.ClientBase,
  country: string,
  role: string,
): Promise<Staff & { readonly email: string }> {
  const p = await person(client, country);
  await client.query(
    `SELECT test_fixture.iam_grant_staff_role($1, $2, $3, $4::text[], NULL, NULL)`,
    [uuid(), p.userId, role, [country]],
  );
  const factorId = uuid();
  const code = randomBytes(9).toString('base64url');
  const codeHash = createHash('sha256').update(code, 'utf8').digest();
  await client.query(
    `SELECT test_fixture.iam_insert_pending_totp($1, $2, 'fake-vault:test-secret', $3, 86400)`,
    [factorId, p.userId, codeHash],
  );
  const hash = await login(client, p.userId);
  const reveal = await client.query<{ outcome: string }>(
    'SELECT outcome FROM core.iam_staff_cmd_enroll_reveal($1, $2)',
    [hash, codeHash],
  );
  if (reveal.rows[0]?.outcome !== 'OK') throw new Error('enrôlement refusé');
  if ((await elevate(client, hash, factorId, stepNow())) !== 'ENROLLED') {
    throw new Error('élévation refusée');
  }
  return { userId: p.userId, factorId, code, codeHash, hash, email: p.email };
}

interface Result {
  readonly outcome: string;
  readonly body: Record<string, unknown> | null;
}

async function call(client: pg.ClientBase, sql: string, values: unknown[]): Promise<Result> {
  const { rows } = await client.query<Result>(sql, values);
  return rows[0] ?? { outcome: '', body: null };
}

const profile = (c: pg.ClientBase, s: Staff, user: string, requestId = uuid()) =>
  call(c, 'SELECT * FROM core.support_staff_profile($1, $2, $3, $4)', [
    s.hash,
    requestId,
    user,
    PURPOSE,
  ]);
const kyc = (c: pg.ClientBase, s: Staff, item: string, requestId = uuid()) =>
  call(c, 'SELECT * FROM core.support_staff_kyc_dossier($1, $2, $3, $4)', [
    s.hash,
    requestId,
    item,
    PURPOSE,
  ]);
const claim = (c: pg.ClientBase, s: Staff, item: string) =>
  call(c, 'SELECT * FROM core.support_staff_claim_item($1, $2, $3)', [s.hash, uuid(), item]);
const queues = (c: pg.ClientBase, s: Staff, queue: string | null) =>
  call(c, 'SELECT * FROM core.support_staff_queues($1, $2, $3)', [s.hash, queue, 200]);
const openCase = (c: pg.ClientBase, s: Staff, requester: string, requestId = uuid()) =>
  call(c, 'SELECT * FROM core.support_staff_open_case($1, $2, $3, $4, $5, $6)', [
    s.hash,
    requestId,
    requester,
    'ACCOUNT',
    'NORMAL',
    'WHATSAPP',
  ]);
const note = (c: pg.ClientBase, s: Staff, user: string, body: string, requestId = uuid()) =>
  call(c, 'SELECT * FROM core.support_staff_add_note($1, $2, $3, $4)', [
    s.hash,
    requestId,
    user,
    body,
  ]);

async function enqueue(
  client: pg.ClientBase,
  queue: string,
  subjectType: string,
  subjectId: string,
  country: string,
): Promise<{ outcome: string; item_id: string | null }> {
  const { rows } = await client.query<{ outcome: string; item_id: string | null }>(
    'SELECT * FROM test_fixture.us109_enqueue($1, $2, $3, $4)',
    [queue, subjectType, subjectId, country],
  );
  return rows[0] ?? { outcome: '', item_id: null };
}

interface AccessRow {
  readonly actor_user_id: string;
  readonly actor_role: string;
  readonly subject_type: string;
  readonly subject_id: string;
  readonly field_or_file: string;
  readonly purpose: string;
  readonly access_kind: string;
  readonly case_ref: string | null;
}

async function accessLog(client: pg.ClientBase, requestId: string): Promise<AccessRow[]> {
  const { rows } = await client.query<AccessRow>(
    'SELECT * FROM test_fixture.us109_access_log($1)',
    [requestId],
  );
  return rows;
}

interface ActOutcome {
  readonly outcome: string;
  readonly action_id: string | null;
  readonly domain_ref: string | null;
  readonly detail: string | null;
}

/** Action de console sous le contexte STAFF de l'API (ADR-062, ADR-092), transaction validée. */
async function act(
  client: pg.ClientBase,
  staff: Staff,
  action: 'RESTRICT_ACCOUNT' | 'LIFT_RESTRICTION',
  subject: string,
  input: Record<string, string>,
  scope: readonly string[],
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
      [staff.hash, uuid(), action, subject, REASON, input, []],
    );
    return rows[0] ?? { outcome: '', action_id: null, domain_ref: null, detail: null };
  });
}

/** Pose réelle d'un hold par `guest` sur un véhicule neuf d'un compte d'hôte ACTIVE (fixture 9002). */
async function tryHold(
  tx: pg.ClientBase,
  c: CountryCase,
  guest: string,
  options: { readonly restrictHolder?: boolean } = {},
): Promise<string> {
  const org = uuid();
  const vehicle = uuid();
  await ensureParties(tx, [], org, c);
  await registerVehicles(tx, [vehicle], org, c);
  if (options.restrictHolder === true) {
    const { rows } = await tx.query<{ h: string }>('SELECT test_fixture.us109_holder_of($1) AS h', [
      org,
    ]);
    await tx.query(`SELECT test_fixture.us109_restrict_directly($1, 'TS_HOLD')`, [rows[0]?.h]);
  }
  const start = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const end = new Date(Date.now() + 5 * 86_400_000).toISOString();
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
}

describe('critère 1 — un compte restreint ne réserve pas (ACCOUNT_RESTRICTED)', () => {
  it.each(byCountry)(
    '%s (%s) : OPS du pays restreint (TS_HOLD, motivé) ⇒ pose refusée ACCOUNT_RESTRICTED ; seconde restriction ⇒ REFUSED ; levée motivée ⇒ la pose passe',
    async (country, _currency, c: CountryCase) => {
      await withRole('app_api', async (client) => {
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const guest = await person(client, country);
        // témoin : avant toute restriction, la pose passe
        await withTestTransaction(client, {}, async (tx) => {
          expect(await tryHold(tx, c, guest.userId)).toBe('OK');
        });
        const r = await act(client, ops, 'RESTRICT_ACCOUNT', guest.userId, { kind: 'TS_HOLD' }, [
          country,
        ]);
        expect(r.outcome).toBe('DONE');
        const { rows: rs } = await client.query<{
          kind: string;
          active: boolean;
          reason: string;
          created_by: string;
        }>('SELECT * FROM test_fixture.us109_restrictions($1)', [guest.userId]);
        expect(rs).toHaveLength(1);
        expect(rs[0]).toMatchObject({
          kind: 'TS_HOLD',
          active: true,
          reason: REASON,
          created_by: ops.userId,
        });
        await withTestTransaction(client, {}, async (tx) => {
          expect(await tryHold(tx, c, guest.userId)).toBe('ACCOUNT_RESTRICTED');
        });
        // une seule restriction active par type
        expect(
          await act(client, ops, 'RESTRICT_ACCOUNT', guest.userId, { kind: 'TS_HOLD' }, [country]),
        ).toMatchObject({ outcome: 'REFUSED', detail: 'RESTRICTION_EXISTS' });
        // un type non déclaré (dette, litige : leurs stories) est refusé avant tout effet
        await expect(
          act(client, ops, 'RESTRICT_ACCOUNT', guest.userId, { kind: 'CHARGEBACK' }, [country]),
        ).rejects.toMatchObject({ code: '22023' });
        // levée motivée (16 ADM-005 « levée d'une restriction → motif obligatoire »)
        expect(
          (await act(client, ops, 'LIFT_RESTRICTION', guest.userId, { kind: 'TS_HOLD' }, [country]))
            .outcome,
        ).toBe('DONE');
        await withTestTransaction(client, {}, async (tx) => {
          expect(await tryHold(tx, c, guest.userId)).toBe('OK');
        });
        expect(
          await act(client, ops, 'LIFT_RESTRICTION', guest.userId, { kind: 'TS_HOLD' }, [country]),
        ).toMatchObject({ outcome: 'REFUSED', detail: 'RESTRICTION_NOT_FOUND' });
        const audit = (await auditOf(client, ops.userId)).map((a) => a.action_code);
        expect(audit.filter((a) => a === 'MANUAL_ACTION_DONE')).toHaveLength(2);
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : SUPPORT (sans ops.restrict_account), FINANCE et OPS de l’autre pays ⇒ FORBIDDEN journalisé, aucune restriction (IDOR entre pays)',
    async (country) => {
      await withRole('app_api', async (client) => {
        const other = otherOf(country);
        const guest = await person(client, country);
        const support = await elevatedStaff(client, 'SUPPORT_AGENT', [country]);
        const finance = await elevatedStaff(client, 'FINANCE', [country]);
        const opsOther = await elevatedStaff(client, 'OPS_AGENT', [other]);
        for (const [s, scope] of [
          [support, [country]],
          [finance, [country]],
          [opsOther, [other]],
        ] as const) {
          expect(
            (await act(client, s, 'RESTRICT_ACCOUNT', guest.userId, { kind: 'TS_HOLD' }, scope))
              .outcome,
          ).toBe('FORBIDDEN');
          expect((await auditOf(client, s.userId)).at(-1)?.action_code).toBe('STAFF_FORBIDDEN');
        }
        const { rows } = await client.query('SELECT * FROM test_fixture.us109_restrictions($1)', [
          guest.userId,
        ]);
        expect(rows).toEqual([]);
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : séparation des fonctions — jamais sur soi-même (pose ni levée) ; un membre du staff seulement par un ADMIN (ADR-097, PROPOSÉ)',
    async (country) => {
      await withRole('app_api', async (client) => {
        const ops = await staffPerson(client, country, 'OPS_AGENT');
        const colleague = await staffPerson(client, country, 'OPS_AGENT');
        const admin = await staffPerson(client, country, 'ADMIN');
        const scope = [country];
        // soi-même : refusé, pour la pose comme pour la levée
        expect(
          await act(client, ops, 'RESTRICT_ACCOUNT', ops.userId, { kind: 'TS_HOLD' }, scope),
        ).toMatchObject({ outcome: 'REFUSED', detail: 'SELF_FORBIDDEN' });
        // un collègue du staff : pas par un OPS
        expect(
          await act(client, ops, 'RESTRICT_ACCOUNT', colleague.userId, { kind: 'TS_HOLD' }, scope),
        ).toMatchObject({ outcome: 'REFUSED', detail: 'STAFF_SUBJECT_ADMIN_ONLY' });
        // par un ADMIN : posée
        expect(
          (
            await act(
              client,
              admin,
              'RESTRICT_ACCOUNT',
              colleague.userId,
              { kind: 'TS_HOLD' },
              scope,
            )
          ).outcome,
        ).toBe('DONE');
        // le collègue restreint ne lève pas sa propre restriction ; un autre OPS non plus
        expect(
          await act(
            client,
            colleague,
            'LIFT_RESTRICTION',
            colleague.userId,
            { kind: 'TS_HOLD' },
            scope,
          ),
        ).toMatchObject({ outcome: 'REFUSED', detail: 'SELF_FORBIDDEN' });
        expect(
          await act(client, ops, 'LIFT_RESTRICTION', colleague.userId, { kind: 'TS_HOLD' }, scope),
        ).toMatchObject({ outcome: 'REFUSED', detail: 'STAFF_SUBJECT_ADMIN_ONLY' });
        const { rows } = await client.query<{ active: boolean }>(
          'SELECT * FROM test_fixture.us109_restrictions($1)',
          [colleague.userId],
        );
        expect(rows.map((r) => r.active)).toEqual([true]);
        // l'ADMIN ne se restreint pas non plus lui-même
        expect(
          await act(client, admin, 'RESTRICT_ACCOUNT', admin.userId, { kind: 'TS_HOLD' }, scope),
        ).toMatchObject({ outcome: 'REFUSED', detail: 'SELF_FORBIDDEN' });
        expect(
          (
            await act(
              client,
              admin,
              'LIFT_RESTRICTION',
              colleague.userId,
              { kind: 'TS_HOLD' },
              scope,
            )
          ).outcome,
        ).toBe('DONE');
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : titulaire restreint ⇒ ses véhicules ne reçoivent aucune réservation (HOST_NOT_ACTIVATED, L1-PM-33)',
    async (country, _currency, c: CountryCase) => {
      await withRole('app_api', async (client) => {
        const guest = await person(client, country);
        await withTestTransaction(client, {}, async (tx) => {
          expect(await tryHold(tx, c, guest.userId, { restrictHolder: true })).toBe(
            'HOST_NOT_ACTIVATED',
          );
        });
      });
    },
  );
});

describe('critère 2 — chaque consultation d’un dossier KYC est au journal d’accès (L1-PM-08)', () => {
  it.each(byCountry)(
    '%s (%s) : OPS qui a pris l’élément KYC ⇒ dossier rendu ET ligne READ_C3 (élément, motif, acteur) ET audit STAFF_DATA_ACCESS ; un autre OPS ⇒ CASE_REQUIRED ; un SUPPORT, un FINANCE, un OPS de l’autre pays ⇒ FORBIDDEN ; tout refus journalisé, aucune ligne d’accès',
    async (country) => {
      await withRole('app_api', async (client) => {
        const other = otherOf(country);
        const p = await person(client, country);
        const item = await enqueue(client, 'KYC', 'USER_ACCOUNT', p.userId, country);
        expect(item.outcome).toBe('CREATED');
        const itemId = item.item_id ?? '';
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const ops2 = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const support = await elevatedStaff(client, 'SUPPORT_AGENT', [country]);
        const finance = await elevatedStaff(client, 'FINANCE', [country]);
        const opsOther = await elevatedStaff(client, 'OPS_AGENT', [other]);
        // non assigné : même l'OPS du pays ne lit rien (hors file)
        const early = uuid();
        expect((await kyc(client, ops, itemId, early)).outcome).toBe('CASE_REQUIRED');
        expect(await accessLog(client, early)).toEqual([]);
        expect((await claim(client, ops, itemId)).outcome).toBe('CLAIMED');
        expect((await claim(client, ops2, itemId)).outcome).toBe('TAKEN');
        const requestId = uuid();
        const granted = await kyc(client, ops, itemId, requestId);
        expect(granted.outcome).toBe('GRANTED');
        expect(granted.body).toMatchObject({
          userId: p.userId,
          country,
          legalFirstName: 'Lucía',
          legalLastName: 'Benítez',
          kycStatus: 'NOT_STARTED',
        });
        const log = await accessLog(client, requestId);
        expect(log).toEqual([
          {
            actor_user_id: ops.userId,
            actor_role: 'OPS_AGENT',
            subject_type: 'USER_ACCOUNT',
            subject_id: p.userId,
            field_or_file: 'kyc_dossier',
            purpose: PURPOSE,
            access_kind: 'READ_C3',
            case_ref: `item:${itemId}`,
          },
        ]);
        const audit = await auditOf(client, ops.userId);
        expect(audit.at(-1)).toMatchObject({
          action_code: 'STAFF_DATA_ACCESS',
          subject_type: 'USER_ACCOUNT',
          subject_id: p.userId,
          request_id: requestId,
        });
        expect(audit.at(-1)?.after).toMatchObject({ country, access_kind: 'READ_C3' });
        for (const [s, expected] of [
          [ops2, 'CASE_REQUIRED'],
          [support, 'FORBIDDEN'],
          [finance, 'FORBIDDEN'],
          [opsOther, 'FORBIDDEN'],
        ] as const) {
          const r = uuid();
          expect((await kyc(client, s, itemId, r)).outcome).toBe(expected);
          expect(await accessLog(client, r)).toEqual([]);
          expect((await auditOf(client, s.userId)).at(-1)?.action_code).toBe('STAFF_FORBIDDEN');
        }
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : ADMIN du pays ⇒ dossier rendu sans assignation, journalisé ; ADMIN de l’autre pays ⇒ FORBIDDEN ; élément d’une autre file (LISTING) ⇒ jamais un dossier KYC (CASE_REQUIRED)',
    async (country) => {
      await withRole('app_api', async (client) => {
        const p = await person(client, country);
        const item = await enqueue(client, 'KYC', 'USER_ACCOUNT', p.userId, country);
        const admin = await elevatedStaff(client, 'ADMIN', [country]);
        const adminOther = await elevatedStaff(client, 'ADMIN', [otherOf(country)]);
        const r = uuid();
        expect((await kyc(client, admin, item.item_id ?? '', r)).outcome).toBe('GRANTED');
        expect(await accessLog(client, r)).toMatchObject([
          { actor_role: 'ADMIN', access_kind: 'READ_C3', case_ref: `item:${item.item_id}` },
        ]);
        expect((await kyc(client, adminOther, item.item_id ?? '')).outcome).toBe('FORBIDDEN');
        const listing = await enqueue(client, 'LISTING', 'USER_ACCOUNT', p.userId, country);
        expect(listing.outcome).toBe('CREATED');
        const viaListing = uuid();
        expect((await kyc(client, admin, listing.item_id ?? '', viaListing)).outcome).toBe(
          'CASE_REQUIRED',
        );
        expect(await accessLog(client, viaListing)).toEqual([]);
      });
    },
  );
});

describe('fiche 360° : couverture par dossier ou élément assigné, journal READ_C2_SUPPORT', () => {
  it.each(byCountry)(
    '%s (%s) : SUPPORT sans dossier ⇒ CASE_REQUIRED journalisé, rien lu ; dossier ouvert pour la personne ⇒ fiche rendue (statut KYC seul, aucun secret) et journalisée ; note interne ajoutée, rejouée, visible sur la fiche',
    async (country) => {
      await withRole('app_api', async (client) => {
        const p = await person(client, country);
        const support = await elevatedStaff(client, 'SUPPORT_AGENT', [country]);
        const before = uuid();
        expect((await profile(client, support, p.userId, before)).outcome).toBe('CASE_REQUIRED');
        expect(await accessLog(client, before)).toEqual([]);
        expect((await note(client, support, p.userId, 'Appel reçu')).outcome).toBe('CASE_REQUIRED');
        const caseId = uuid();
        expect((await openCase(client, support, p.userId, caseId)).outcome).toBe('OPENED');
        expect((await openCase(client, support, p.userId, caseId)).outcome).toBe('DUPLICATE');
        const { rows: cs } = await client.query('SELECT * FROM test_fixture.us109_case($1)', [
          caseId,
        ]);
        expect(cs[0]).toMatchObject({
          requester_user_id: p.userId,
          country_code: country,
          category: 'ACCOUNT',
          status: 'OPEN',
          assignee_id: support.userId,
        });
        const noteId = uuid();
        expect((await note(client, support, p.userId, 'Appel reçu', noteId)).outcome).toBe('ADDED');
        expect((await note(client, support, p.userId, 'Appel reçu', noteId)).outcome).toBe(
          'DUPLICATE',
        );
        const requestId = uuid();
        const r = await profile(client, support, p.userId, requestId);
        expect(r.outcome).toBe('GRANTED');
        const body = r.body as Record<string, unknown>;
        expect(body['profile']).toMatchObject({
          id: p.userId,
          email: p.email,
          legalFirstName: 'Lucía',
          status: 'ACTIVE',
        });
        expect(body['kyc']).toEqual({ status: 'NOT_STARTED' });
        expect(body['notes']).toMatchObject([{ id: noteId, body: 'Appel reçu' }]);
        expect(body['cases']).toMatchObject([{ id: caseId, assignedToMe: true }]);
        // jamais un secret ni une donnée KYC détaillée sur la fiche (16 ADM-005 « sans images »)
        const text = JSON.stringify(body);
        expect(text).not.toContain('argon2');
        expect(text).not.toContain('dateOfBirth');
        expect(await accessLog(client, requestId)).toEqual([
          {
            actor_user_id: support.userId,
            actor_role: 'SUPPORT_AGENT',
            subject_type: 'USER_ACCOUNT',
            subject_id: p.userId,
            field_or_file: 'user_account.profile_360',
            purpose: PURPOSE,
            access_kind: 'READ_C2_SUPPORT',
            case_ref: `case:${caseId}`,
          },
        ]);
        // dossier résolu : la couverture tombe
        expect(
          (
            await call(client, 'SELECT * FROM core.support_staff_set_case_status($1, $2, $3, $4)', [
              support.hash,
              uuid(),
              caseId,
              'RESOLVED',
            ])
          ).outcome,
        ).toBe('UPDATED');
        expect((await profile(client, support, p.userId)).outcome).toBe('CASE_REQUIRED');
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : IDOR — SUPPORT et ADMIN de l’autre pays, FINANCE du pays ⇒ FORBIDDEN, aucune ligne d’accès ; dossier ouvert pour une personne de l’autre pays ⇒ FORBIDDEN ; recherche par e-mail limitée au pays',
    async (country) => {
      await withRole('app_api', async (client) => {
        const other = otherOf(country);
        const p = await person(client, country);
        const supportOther = await elevatedStaff(client, 'SUPPORT_AGENT', [other]);
        const adminOther = await elevatedStaff(client, 'ADMIN', [other]);
        const finance = await elevatedStaff(client, 'FINANCE', [country]);
        for (const s of [supportOther, adminOther, finance]) {
          const r = uuid();
          expect((await profile(client, s, p.userId, r)).outcome).toBe('FORBIDDEN');
          expect(await accessLog(client, r)).toEqual([]);
          expect((await auditOf(client, s.userId)).at(-1)?.action_code).toBe('STAFF_FORBIDDEN');
        }
        expect((await openCase(client, supportOther, p.userId)).outcome).toBe('FORBIDDEN');
        expect((await note(client, adminOther, p.userId, 'Note')).outcome).toBe('FORBIDDEN');
        const find = (s: Staff, email: string) =>
          call(client, 'SELECT * FROM core.support_staff_find_user($1, $2, $3, $4)', [
            s.hash,
            uuid(),
            email,
            PURPOSE,
          ]);
        expect((await find(supportOther, p.email)).outcome).toBe('NOT_FOUND');
        const admin = await elevatedStaff(client, 'ADMIN', [country]);
        expect(await find(admin, p.email.toUpperCase())).toEqual({
          outcome: 'FOUND',
          body: { userId: p.userId, country },
        });
        expect((await find(admin, `absent-${uuid()}@example.test`)).outcome).toBe('NOT_FOUND');
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : OPS couvert par l’élément de file qu’il a pris ; hôte restreint ⇒ ses comptes d’hôte apparaissent fermés à la réservation (16 ADM-005)',
    async (country) => {
      await withRole('app_api', async (client) => {
        const host = await person(client, country);
        const opened = await call(
          client,
          'SELECT outcome, NULL::jsonb AS body FROM core.iam_cmd_open_host_account($1, $2, $3)',
          [host.hash, country, 'INDIVIDUAL'],
        );
        expect(opened.outcome).toBe('DONE');
        const { rows: orgs } = await client.query<{ org_id: string }>(
          'SELECT org_id FROM core.iam_host_accounts($1)',
          [host.hash],
        );
        await client.query('SELECT test_fixture.us109_activate_org($1)', [orgs[0]?.org_id]);
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        expect((await profile(client, ops, host.userId)).outcome).toBe('CASE_REQUIRED');
        const item = await enqueue(
          client,
          'HOST_VERIFICATION',
          'ORGANIZATION',
          orgs[0]?.org_id ?? '',
          country,
        );
        expect((await claim(client, ops, item.item_id ?? '')).outcome).toBe('CLAIMED');
        const open = await profile(client, ops, host.userId);
        expect(open.outcome).toBe('GRANTED');
        expect(open.body?.['hostAccounts']).toMatchObject([
          { orgId: orgs[0]?.org_id, status: 'ACTIVE', bookable: true },
        ]);
        expect(
          (
            await act(client, ops, 'RESTRICT_ACCOUNT', host.userId, { kind: 'POLICY_VIOLATION' }, [
              country,
            ])
          ).outcome,
        ).toBe('DONE');
        const closed = await profile(client, ops, host.userId);
        expect(closed.body).toMatchObject({ restricted: true });
        expect(closed.body?.['hostAccounts']).toMatchObject([{ bookable: false }]);
        expect(closed.body?.['restrictions']).toMatchObject([
          { kind: 'POLICY_VIOLATION', active: true, reason: REASON },
        ]);
      });
    },
  );
});

describe('critère 3 — un élément qui dépasse son délai est signalé (16 ADM-029, 17 §7.2)', () => {
  it.each(byCountry)(
    '%s (%s) : échéance posée par la base (KYC 4 h, LISTING 24 h, RISK_BOOKING 120 min) ; élément reculé au-delà de son délai ⇒ overdue dans la file et au résumé ; file non déclarée ⇒ QUEUE_UNKNOWN ; un seul élément vivant par sujet',
    async (country) => {
      await withRole('app_api', async (client) => {
        const p = await person(client, country);
        const k = await enqueue(client, 'KYC', 'USER_ACCOUNT', p.userId, country);
        const l = await enqueue(client, 'LISTING', 'LISTING', uuid(), country);
        const b = await enqueue(client, 'RISK_BOOKING', 'TRIP', uuid(), country);
        const item = async (id: string | null) =>
          (
            await client.query<{ sla_minutes: number; overdue: boolean; status: string }>(
              'SELECT * FROM test_fixture.us109_item($1)',
              [id],
            )
          ).rows[0];
        expect(await item(k.item_id)).toMatchObject({
          sla_minutes: 240,
          overdue: false,
          status: 'OPEN',
        });
        expect(await item(l.item_id)).toMatchObject({ sla_minutes: 1440, overdue: false });
        expect(await item(b.item_id)).toMatchObject({ sla_minutes: 120, overdue: false });
        expect(await enqueue(client, 'KYC', 'USER_ACCOUNT', p.userId, country)).toEqual({
          outcome: 'EXISTS',
          item_id: k.item_id,
        });
        expect((await enqueue(client, 'OVERDUE', 'TRIP', uuid(), country)).outcome).toBe(
          'QUEUE_UNKNOWN',
        );
        // pays recoupé avec celui de la personne (revue sécurité US-109, n° 3)
        expect(
          (await enqueue(client, 'LISTING', 'USER_ACCOUNT', p.userId, otherOf(country))).outcome,
        ).toBe('COUNTRY_MISMATCH');
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const fresh = await queues(client, ops, 'KYC');
        expect(fresh.outcome).toBe('OK');
        const mine = (r: Result) =>
          ((r.body?.['items'] ?? []) as { id: string; overdue: boolean }[]).find(
            (i) => i.id === k.item_id,
          );
        expect(mine(fresh)).toMatchObject({ overdue: false, country, assigned: false });
        // 5 h plus tôt : l'échéance (création + 4 h) est passée d'une heure
        await client.query('SELECT test_fixture.us109_backdate_item($1, $2)', [k.item_id, 300]);
        expect(await item(k.item_id)).toMatchObject({ sla_minutes: 240, overdue: true });
        const late = await queues(client, ops, 'KYC');
        expect(mine(late)).toMatchObject({ overdue: true });
        const summary = (late.body?.['queues'] ?? []) as { queue: string; overdue: number }[];
        expect(summary.find((q) => q.queue === 'KYC')?.overdue).toBeGreaterThanOrEqual(1);
        // les éléments en retard viennent en tête de la file
        expect(((late.body?.['items'] ?? []) as { overdue: boolean }[])[0]?.overdue).toBe(true);
        // IDOR : l'OPS de l'autre pays ne voit pas l'élément
        const opsOther = await elevatedStaff(client, 'OPS_AGENT', [otherOf(country)]);
        expect(mine(await queues(client, opsOther, 'KYC'))).toBeUndefined();
        // SUPPORT : aucune file permise ⇒ refus journalisé
        const support = await elevatedStaff(client, 'SUPPORT_AGENT', [country]);
        expect((await queues(client, support, null)).outcome).toBe('FORBIDDEN');
        expect((await auditOf(client, support.userId)).at(-1)?.action_code).toBe('STAFF_FORBIDDEN');
      });
    },
  );
});

describe('sonde productrice : mise en file et clôture avec le seul droit EXECUTE', () => {
  it.each(byCountry)(
    '%s (%s) : la commande d’une story productrice (propriétaire NOLOGIN, EXECUTE seul) met en file puis clôt (DONE, décision et date posées par la base) ; un élément clos sort de la file ; une seconde clôture rend NOT_OPEN',
    async (country) => {
      await withRole('app_api', async (client) => {
        const p = await person(client, country);
        const k = await enqueue(client, 'KYC', 'USER_ACCOUNT', p.userId, country);
        expect(k.outcome).toBe('CREATED');
        const close = async (status: string, decision: string) =>
          (
            await client.query<{ outcome: string }>(
              'SELECT outcome FROM test_fixture.us109_close($1, $2, $3)',
              [k.item_id, status, decision],
            )
          ).rows[0]?.outcome;
        expect(await close('DONE', 'APPROVED')).toBe('CLOSED');
        expect(await close('DONE', 'APPROVED')).toBe('NOT_OPEN');
        const { rows } = await client.query<{ status: string }>(
          'SELECT * FROM test_fixture.us109_item($1)',
          [k.item_id],
        );
        expect(rows[0]?.status).toBe('DONE');
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const items = ((await queues(client, ops, 'KYC')).body?.['items'] ?? []) as {
          id: string;
        }[];
        expect(items.map((i) => i.id)).not.toContain(k.item_id);
        // une décision qui n'est pas un mot, ou un état non terminal : 22023
        await expect(close('OPEN', 'APPROVED')).rejects.toMatchObject({ code: '22023' });
        // un élément neuf peut de nouveau être mis en file pour ce sujet
        expect((await enqueue(client, 'KYC', 'USER_ACCOUNT', p.userId, country)).outcome).toBe(
          'CREATED',
        );
      });
    },
  );
});

describe('pièces du staff : seau PRIVATE_EVIDENCE, C2 chiffré par la clé de la personne', () => {
  it.each(byCountry)(
    '%s (%s) : OPS du pays, clé de la personne présente ⇒ RECORDED (ligne file_asset conforme), rejeu ⇒ DUPLICATE ; sans clé ⇒ UNAVAILABLE ; FINANCE ou OPS de l’autre pays ⇒ FORBIDDEN ; SVG ou HTML ⇒ 22023',
    async (country) => {
      await withRole('app_api', async (client) => {
        const p = await person(client, country);
        const ops = await elevatedStaff(client, 'OPS_AGENT', [country]);
        const sha = createHash('sha256').update('pièce de test', 'utf8').digest();
        const record = (s: Staff, id: string, mime = 'application/pdf') =>
          call(client, 'SELECT * FROM core.support_staff_record_evidence($1, $2, $3, $4, $5, $6)', [
            s.hash,
            id,
            p.userId,
            mime,
            2048,
            sha,
          ]);
        expect((await record(ops, uuid())).outcome).toBe('UNAVAILABLE');
        await client.query('SELECT test_fixture.us109_subject_key($1)', [p.userId]);
        const fileId = uuid();
        expect(await record(ops, fileId)).toEqual({
          outcome: 'RECORDED',
          body: { fileId, storageKey: `staff-evidence/${fileId}` },
        });
        expect((await record(ops, fileId)).outcome).toBe('DUPLICATE');
        const { rows } = await client.query('SELECT * FROM test_fixture.us109_file($1)', [fileId]);
        expect(rows[0]).toMatchObject({
          bucket: 'PRIVATE_EVIDENCE',
          mime: 'application/pdf',
          bytes: '2048',
          uploader_user_id: ops.userId,
          source: 'STAFF_UPLOAD',
          classification: 'C2',
          enc_subject_type: 'USER',
          enc_subject_id: p.userId,
        });
        const finance = await elevatedStaff(client, 'FINANCE', [country]);
        const opsOther = await elevatedStaff(client, 'OPS_AGENT', [otherOf(country)]);
        expect((await record(finance, uuid())).outcome).toBe('FORBIDDEN');
        expect((await record(opsOther, uuid())).outcome).toBe('FORBIDDEN');
        // le droit est jugé AVANT toute analyse : même verdict, refus journalisé, rien d'écrit
        const permitted = (s: Staff) =>
          call(client, 'SELECT * FROM core.support_staff_evidence_permitted($1, $2, $3)', [
            s.hash,
            uuid(),
            p.userId,
          ]);
        expect(await permitted(ops)).toEqual({ outcome: 'PERMITTED', body: { country } });
        for (const s of [finance, opsOther]) {
          expect((await permitted(s)).outcome).toBe('FORBIDDEN');
          expect((await auditOf(client, s.userId)).at(-1)?.action_code).toBe('STAFF_FORBIDDEN');
        }
        for (const mime of ['image/svg+xml', 'text/html']) {
          await expect(record(ops, uuid(), mime)).rejects.toMatchObject({ code: '22023' });
        }
      });
    },
  );
});

describe('aucun accès direct aux tables ni aux commandes hors app_api', () => {
  it('app_api ne lit ni n’écrit les tables nouvelles (42501) ; app_worker et app_anon n’exécutent aucune commande de la console ; le gestionnaire de restriction n’est exécutable par aucun rôle applicatif', async () => {
    await withRole('app_api', async (client) => {
      for (const t of [
        'core.support_review_queue',
        'core.support_review_queue_item',
        'core.support_internal_note',
      ]) {
        await expect(client.query(`SELECT 1 FROM ${t} LIMIT 1`)).rejects.toMatchObject({
          code: '42501',
        });
      }
      await expect(
        client.query(
          `SELECT * FROM core.iam_manual_action_restriction('\\x00'::bytea, $1, 'RESTRICT_ACCOUNT', $1, '{"kind":"TS_HOLD"}'::jsonb, 'motif assez long', $1, 'ADMIN')`,
          [uuid()],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        client.query(
          `SELECT * FROM core.support_enqueue_review('KYC', 'USER_ACCOUNT', $1, $2, NULL)`,
          [uuid(), ALL[0]],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        client.query(`SELECT * FROM core.support_close_review_item($1, 'DONE', 'APPROVED', NULL)`, [
          uuid(),
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    });
    for (const role of ['app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        await expect(
          client.query('SELECT * FROM core.support_staff_queues($1, NULL, 10)', [Buffer.alloc(32)]),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          client.query('SELECT * FROM core.support_staff_profile($1, $2, $2, $3)', [
            Buffer.alloc(32),
            uuid(),
            PURPOSE,
          ]),
        ).rejects.toMatchObject({ code: '42501' });
      });
    }
  });

  it('sans session élevée : AUTH_REQUIRED (session inconnue), MFA_REQUIRED (session non élevée), rien n’est lu', async () => {
    await withRole('app_api', async (client) => {
      const country = ALL[0] ?? '';
      const p = await person(client, country);
      expect(
        (
          await call(client, 'SELECT * FROM core.support_staff_profile($1, $2, $3, $4)', [
            randomBytes(32),
            uuid(),
            p.userId,
            PURPOSE,
          ])
        ).outcome,
      ).toBe('AUTH_REQUIRED');
      // la personne elle-même (session NONE, sans rôle interne) n'obtient rien
      const r = uuid();
      expect(
        (
          await call(client, 'SELECT * FROM core.support_staff_profile($1, $2, $3, $4)', [
            p.hash,
            r,
            p.userId,
            PURPOSE,
          ])
        ).outcome,
      ).toBe('MFA_REQUIRED');
      expect(await accessLog(client, r)).toEqual([]);
    });
  });
});
