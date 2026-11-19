/**
 * Preuves du changement revu d'une valeur de paramètre pays (US-535a, tranche serveur d'US-535 ;
 * migration 0157, fixtures 9929) sous les rôles de PRODUCTION (assertion L0-05 en tête de chaque
 * connexion : connectAs / withRole), au Panama (USD) et au Paraguay (PYG sans décimale). Toute
 * écriture de valeur se fait dans une transaction ANNULÉE : aucune valeur réelle de paramètre n'est
 * changée, aucune borne réelle n'est posée, et les quatre interrupteurs valent false à la fin de
 * chaque preuve.
 *
 * Attendus tirés de 19 US-535 (rubrique « Découpage », critères d'US-535a), de 17 §0.1, §2.3
 * (matrice : `config.param_write` à ADMIN et SUPERADMIN, hors interrupteurs ; RLS-27), §7.1, de 16
 * ADM-014 / TA07 et de DEC-FONDATEUR-15, jamais du code testé :
 * - deux personnes réellement distinctes pour TOUTE clé : le demandeur (même dans une seconde
 *   session, ou avec un acteur forgé dans le contexte) et une personne en conflit avec lui (compte
 *   lié LINKED, dans les deux sens) ⇒ SELF_FORBIDDEN journalisé, la demande reste en attente ;
 * - une seule demande PENDING par clé et par pays (ALREADY_PENDING), échéance 72 h (EXPIRED),
 *   annulation (CANCELLED) ;
 * - toute clé `go_live_switch` (les quatre interrupteurs, toute casse) refusée à la demande et à
 *   l'écriture, y compris par le propriétaire des commandes lui-même (trigger de 0073) ;
 * - valeur hors type, hors bornes, bornes absentes (clé numérique), autre devise ⇒
 *   PARAM_INVALID_VALUE ; clé inconnue ⇒ PARAM_UNKNOWN ; valeur non décidée ⇒ PARAM_UNDECIDED
 *   (N-22) ; `valid_from` passé ⇒ PARAM_RETROACTIVE ; version précédente fermée à `valid_from`,
 *   sans trou ni recouvrement ;
 * - un devis figé garde l'ancienne valeur : `grace_minutes` (16 A.8.1, TA07 : jours facturables
 *   max(1, ceil((fin − début − tolérance) / 24 h))). Trip de 3 j 20 min : tolérance 29 min ⇒ 3 j ;
 *   tolérance 10 min ⇒ 4 j. Montants (oracle `docs/specs/tools/independent_settlement_check.py`,
 *   `rhu` et `alloc_host`, `python -I -X utf8`, trip fee de 08 BR-PRICE-06 à 15 % jusqu'à 6 j,
 *   taxe par ligne ITBMS 7 % / IVA 10 %, part de l'hôte 3/4) :
 *     PA 3 j : P 12 000, F 1 800, taxes 840 + 126, HOST 9 000, total 14 766 ;
 *     PA 4 j : P 16 000, F 2 400, taxes 1 120 + 168, HOST 12 000, total 19 688 ;
 *     PY 3 j : P 1 000 002, F 150 000, taxes 100 000 + 15 000, HOST 750 001, total 1 265 002 ;
 *     PY 4 j : P 1 333 336, F 200 000, taxes 133 334 + 20 000, HOST 1 000 002, total 1 686 670
 *   (les valeurs de 3 j sont celles de l0-us202-quote, T01 / T40, TJ01 / TJ09a) ;
 * - une seule transaction : statut APPLIED, `approved_by`, `decision_ref`, version, événement
 *   `config.param.changed`, audit ; refus journalisés sans écriture de valeur ;
 * - RLS et droits : aucun rôle applicatif n'écrit `config_param_value`, les demandes ou les bornes
 *   (base de production), seul app_api exécute les commandes, un voyageur ou un hôte n'obtient rien.
 * Défauts fail-closed PROPOSÉS (ADR-178) : décision `DEC-FONDATEUR-n` obligatoire, clés JSON
 * refusées, bornes absentes = refus, devise explicite pour une clé liée à la devise.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
import type { CountryCase } from '../support/avl.ts';
import {
  DECISION,
  SWITCHES,
  asStaff,
  freshSession,
  goLive,
  lockAuditChainHead,
  newHash,
  plusMinutes,
} from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import { staff, staffSessionHash } from '../support/rls.ts';
import { auditOf, createStaff, installTestProofKey, login } from '../support/staff.ts';
import { decideLink, staffPerson } from '../redteam/l1/support-p2.ts';

const ALL = COUNTRIES.map((c) => c.country);
const FIRST = ALL[0] as string;
const code = (error: unknown): string => (error as { code?: string }).code ?? 'SANS_CODE';
const MIN = 60_000;
const DAY = 86_400_000;
const REASON = 'Réglage du pays après décision écrite du fondateur (preuve US-535a)';

const REQUEST_SQL = `SELECT outcome, request_id
  FROM core.config_cmd_request_param_change($1, $2, $3, $4, $5::jsonb, $6, $7::timestamptz, $8, $9)`;
const APPROVE_SQL = 'SELECT outcome, request_id FROM core.config_cmd_approve_param_change($1, $2)';
const CANCEL_SQL = 'SELECT outcome, request_id FROM core.config_cmd_cancel_param_change($1, $2)';

/** Clés de la configuration (données du dépôt, jamais une constante de pays dans le test). */
interface ParamDoc {
  readonly key: string;
  readonly type: string;
  readonly currencyBound?: boolean;
  readonly notApplicableIn?: readonly string[];
  readonly scopes?: readonly string[];
  readonly values: Readonly<Record<string, unknown>>;
}
const PARAMS = (
  JSON.parse(
    readFileSync(
      new URL('../../../../apps/api/src/modules/cfg/data/params.json', import.meta.url),
      'utf8',
    ),
  ) as { params: ParamDoc[] }
).params;
const param = (key: string): ParamDoc => {
  const p = PARAMS.find((x) => x.key === key);
  if (!p) throw new Error(`clé ${key} absente de params.json`);
  return p;
};

// clés éprouvées (types de 17 §7.2) : BOOL, ENUM, DURATION (lue par le devis), MONEY (liée à la
// devise), JSON
const BOOL_KEY = 'listing_manual_review_required';
const ENUM_KEY = 'vehicle_default_value_class';
const GRACE = 'grace_minutes';
const MONEY_KEY = 'price_ceiling_daily_minor';
const JSON_KEY = 'trip_fee_schedule';

interface Outcome {
  readonly outcome: string;
  readonly request_id: string | null;
}

interface Ask {
  readonly id?: string;
  readonly validFrom?: string | null;
  readonly currency?: string | null;
  readonly decision?: string | null;
  readonly reason?: string | null;
  readonly actorId?: string;
}

/** Demande, dans la transaction courante, sous le contexte STAFF de `who` (tête d'audit d'abord). */
async function ask(
  tx: pg.ClientBase,
  who: StaffActor,
  key: string | null,
  country: string | null,
  value: unknown,
  o: Ask = {},
): Promise<Outcome> {
  await lockAuditChainHead(tx);
  await asStaff(tx, who, o.actorId);
  const { rows } = await tx.query<Outcome>(REQUEST_SQL, [
    who.hash,
    o.id ?? randomUUID(),
    key,
    country,
    value === undefined ? null : JSON.stringify(value),
    o.currency ?? null,
    o.validFrom === undefined ? new Date(Date.now() + 60 * MIN).toISOString() : o.validFrom,
    o.reason === undefined ? REASON : o.reason,
    o.decision === undefined ? DECISION : o.decision,
  ]);
  return rows[0] ?? { outcome: '', request_id: null };
}

async function approve(
  tx: pg.ClientBase,
  who: StaffActor,
  id: string,
  actorId?: string,
): Promise<Outcome> {
  await lockAuditChainHead(tx);
  await asStaff(tx, who, actorId);
  const { rows } = await tx.query<Outcome>(APPROVE_SQL, [who.hash, id]);
  return rows[0] ?? { outcome: '', request_id: null };
}

async function cancel(tx: pg.ClientBase, who: StaffActor, id: string): Promise<Outcome> {
  await lockAuditChainHead(tx);
  await asStaff(tx, who);
  const { rows } = await tx.query<Outcome>(CANCEL_SQL, [who.hash, id]);
  return rows[0] ?? { outcome: '', request_id: null };
}

interface Version {
  readonly id: string;
  readonly value: unknown;
  readonly currency: string | null;
  readonly valid_from: Date;
  readonly valid_to: Date | null;
  readonly approved_by: string | null;
  readonly decision_ref: string | null;
  readonly change_reason: string;
}
const versions = async (tx: pg.ClientBase, key: string, country: string): Promise<Version[]> =>
  (await tx.query<Version>('SELECT * FROM test_fixture.us535_versions($1, $2)', [key, country]))
    .rows;

interface RequestRow {
  readonly id: string;
  readonly status: string;
  readonly requested_by: string;
  readonly approved_by: string | null;
}
const requests = async (tx: pg.ClientBase, key: string, country: string): Promise<RequestRow[]> =>
  (await tx.query<RequestRow>('SELECT * FROM test_fixture.us535_requests($1, $2)', [key, country]))
    .rows;

const statusOf = async (tx: pg.ClientBase, key: string, country: string, id: string) =>
  (await requests(tx, key, country)).find((r) => r.id === id)?.status;

/** Valeur en vigueur à `platform.now()` (lecture app_api de 0008 : clé, pays, valeur, dates). */
async function inForce(tx: pg.ClientBase, key: string, country: string): Promise<unknown> {
  const { rows } = await tx.query<{ value: unknown }>(
    `SELECT value FROM core.config_param_value
      WHERE key = $1 AND country_code = $2 AND scope_type = 'COUNTRY'
        AND valid_from <= platform.now() AND (valid_to IS NULL OR valid_to > platform.now())
      ORDER BY valid_from DESC LIMIT 1`,
    [key, country],
  );
  return rows[0]?.value;
}

const bound = (tx: pg.ClientBase, key: string, country: string, min: number, max: number) =>
  tx.query('SELECT test_fixture.us535_set_bound($1, $2, $3, $4)', [key, country, min, max]);

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
      ['adminB', 'ADMIN', ALL],
      ['superB', 'SUPERADMIN', ALL],
      ['superC', 'SUPERADMIN', ALL],
      ['ops', 'OPS_AGENT', ALL],
      ['finance', 'FINANCE', ALL],
    ] as const) {
      const id = await staff(tx, role, scope);
      people[name] = { userId: id, hash: sessionOf(id), scope };
    }
    for (const c of ALL) {
      const id = await staff(tx, 'ADMIN', [c]);
      people[`admin_${c}`] = { userId: id, hash: sessionOf(id), scope: [c] };
    }
    // ADMIN dont le rôle échoit dans une heure (demande rejetée à l'approbation)
    const expiring = await staff(tx, 'ADMIN', ALL, new Date(Date.now() + 3_600_000).toISOString());
    people['adminExpiring'] = { userId: expiring, hash: sessionOf(expiring), scope: ALL };
    // seconde session élevée de l'admin : la MÊME personne, un autre jeton
    const second = newHash();
    await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [
      actor('admin').userId,
      second,
    ]);
    people['adminSecond'] = { ...actor('admin'), hash: second };
  });
  const noMfa = await createStaff(api, 'ADMIN', ALL, { withFactor: false });
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

/** Aucune valeur réelle changée : la valeur en vigueur hors transaction est celle des données. */
async function unchanged(key: string, country: string): Promise<void> {
  const p = param(key);
  if (!(country in p.values)) return;
  expect(await inForce(api, key, country), `${key} ${country}`).toEqual(p.values[country]);
}

describe.each(COUNTRIES)('US-535a — changement revu d’un paramètre ($country, $currency)', (c) => {
  const other = COUNTRIES.find((x) => x.country !== c.country) as CountryCase;

  it('critères 1, 2, 3 et 9 : demande PENDING, une seule par clé ; le demandeur (seconde session, acteur forgé) ⇒ SELF_FORBIDDEN, en attente ; ADMIN distinct ⇒ APPLIED, version fermée puis ouverte à valid_from, événement et audit dans la même transaction', async () => {
    const before = param(BOOL_KEY).values[c.country];
    await withTestTransaction(api, {}, async (tx) => {
      const base = (await versions(tx, BOOL_KEY, c.country)).length;
      const validFrom = new Date(Date.now() + 90 * MIN).toISOString();
      const r = await ask(tx, actor('admin'), BOOL_KEY, c.country, !before, { validFrom });
      expect(r.outcome).toBe('REQUESTED');
      const id = r.request_id as string;
      // une seule demande en attente par clé et par pays
      expect((await ask(tx, actor('superB'), BOOL_KEY, c.country, !before)).outcome).toBe(
        'ALREADY_PENDING',
      );
      // le demandeur, sa seconde session, son jeton avec un acteur forgé : toujours lui
      expect((await approve(tx, actor('admin'), id)).outcome).toBe('SELF_FORBIDDEN');
      expect((await approve(tx, actor('adminSecond'), id)).outcome).toBe('SELF_FORBIDDEN');
      expect((await approve(tx, actor('admin'), id, actor('adminB').userId)).outcome).toBe(
        'SELF_FORBIDDEN',
      );
      // sans config.param_write, hors pays, sans TOTP, sans rôle : refus, demande en attente
      expect((await approve(tx, actor('ops'), id)).outcome).toBe('FORBIDDEN');
      expect((await approve(tx, actor('finance'), id)).outcome).toBe('FORBIDDEN');
      expect((await approve(tx, actor(`admin_${other.country}`), id)).outcome).toBe('FORBIDDEN');
      expect((await approve(tx, actor('noMfa'), id)).outcome).toBe('MFA_REQUIRED');
      expect((await approve(tx, actor('plain'), id)).outcome).toBe('MFA_REQUIRED');
      expect(await statusOf(tx, BOOL_KEY, c.country, id)).toBe('PENDING');
      expect(await versions(tx, BOOL_KEY, c.country)).toHaveLength(base);

      // une seconde personne réellement distinte (ADMIN, 17 §2.3) : la nouvelle version s'écrit
      expect((await approve(tx, actor('adminB'), id)).outcome).toBe('APPLIED');
      expect((await approve(tx, actor('adminB'), id)).outcome).toBe('NOT_PENDING');
      const rows = await requests(tx, BOOL_KEY, c.country);
      expect(rows.find((x) => x.id === id)).toMatchObject({
        status: 'APPLIED',
        requested_by: actor('admin').userId,
        approved_by: actor('adminB').userId,
      });
      const vs = await versions(tx, BOOL_KEY, c.country);
      expect(vs).toHaveLength(base + 1);
      const [old, cur] = vs.slice(-2) as [Version, Version];
      // ni trou ni recouvrement : l'ancienne se ferme exactement où la nouvelle s'ouvre
      expect(old.valid_to?.toISOString()).toBe(validFrom);
      expect(cur.valid_from.toISOString()).toBe(validFrom);
      expect(cur).toMatchObject({
        value: !before,
        valid_to: null,
        approved_by: actor('adminB').userId,
        decision_ref: DECISION,
        change_reason: REASON,
        currency: null,
      });
      // pas encore en vigueur : la valeur d'aujourd'hui reste l'ancienne
      expect(await inForce(tx, BOOL_KEY, c.country)).toBe(before);
      // événement config.param.changed (17 §4.5), un seul, de l'approbateur
      const events = (
        await tx.query<{
          actor_user_id: string;
          actor_role: string;
          correlation_id: string;
          payload: Record<string, unknown>;
        }>('SELECT * FROM test_fixture.us125_events($1, $2)', [BOOL_KEY, c.country])
      ).rows.filter((e) => e.correlation_id === id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actor_user_id: actor('adminB').userId,
        actor_role: 'ADMIN',
        payload: expect.objectContaining({ key: BOOL_KEY, scope: 'COUNTRY', country: c.country }),
      });
      // journal : demande, trois refus d'auto-approbation, application avec la décision
      const byA = (await auditOf(tx, actor('admin').userId)).map((a) => a.action_code);
      expect(byA).toContain('PARAM_CHANGE_REQUESTED');
      expect(byA.filter((x) => x === 'PARAM_SELF_APPROVAL_DENIED')).toHaveLength(3);
      const applied = (await auditOf(tx, actor('adminB').userId)).find(
        (a) => a.action_code === 'PARAM_CHANGE_APPLIED',
      );
      expect(applied).toMatchObject({
        actor_role: 'ADMIN',
        subject_type: 'PARAM_CHANGE',
        subject_id: id,
        reason: DECISION,
        before: expect.objectContaining({ value: before }),
        after: expect.objectContaining({
          key: BOOL_KEY,
          country: c.country,
          value: !before,
          decisionRef: DECISION,
          requestedBy: actor('admin').userId,
        }),
      });
      for (const who of ['ops', 'finance', `admin_${other.country}`] as const) {
        expect(
          (await auditOf(tx, actor(who).userId)).map((a) => a.action_code),
          who,
        ).toContain('STAFF_FORBIDDEN');
      }
    });
    await unchanged(BOOL_KEY, c.country);
    await allFalse(c.country);
  });

  it('critère 2 : une personne en conflit avec le demandeur (compte lié LINKED), dans les deux sens ⇒ SELF_FORBIDDEN journalisé, demande en attente ; une personne sans lien ⇒ APPLIED', async () => {
    await withTestTransaction(api, {}, async (tx) => {
      await installTestProofKey(tx);
      const scoped = async (role: string): Promise<StaffActor> => ({
        ...(await staffPerson(tx, c.country, role)),
        scope: [c.country],
      });
      const a = await scoped('ADMIN');
      const b = await scoped('SUPERADMIN');
      const d = await scoped('ADMIN');
      expect((await decideLink(tx, null, a.userId, b.userId, 'LINKED')).outcome).toBe('RECORDED');
      // a demande, b (lié) approuve
      const ra = await ask(tx, a, BOOL_KEY, c.country, true);
      expect(ra.outcome).toBe('REQUESTED');
      expect((await approve(tx, b, ra.request_id as string)).outcome).toBe('SELF_FORBIDDEN');
      // b demande, a (lié) approuve : l'autre sens
      const rb = await ask(tx, b, ENUM_KEY, c.country, 'PREMIUM');
      expect(rb.outcome).toBe('REQUESTED');
      expect((await approve(tx, a, rb.request_id as string)).outcome).toBe('SELF_FORBIDDEN');
      for (const [who, id, key] of [
        [b, ra.request_id, BOOL_KEY],
        [a, rb.request_id, ENUM_KEY],
      ] as const) {
        expect(await statusOf(tx, key, c.country, id as string)).toBe('PENDING');
        const denied = (await auditOf(tx, who.userId)).find(
          (x) => x.action_code === 'PARAM_SELF_APPROVAL_DENIED',
        );
        expect(denied?.after).toMatchObject({ reason: 'REQUESTER_RELATED' });
      }
      // une personne sans lien approuve
      expect((await approve(tx, d, ra.request_id as string)).outcome).toBe('APPLIED');
    });
    await unchanged(BOOL_KEY, c.country);
  });

  it('critère 4 : clé go_live_switch (les quatre interrupteurs, toute casse, blancs) ⇒ FORBIDDEN journalisé sans demande ; écriture directe par le propriétaire des commandes ⇒ trigger param_value_go_live_guard (0073) ou aucune ligne', async () => {
    await withTestTransaction(api, {}, async (tx) => {
      const variants = SWITCHES.flatMap((k) => [k, k.toUpperCase(), ` ${k} `]).concat([
        'Payouts_Enabled',
      ]);
      for (const key of variants) {
        for (const value of [true, false]) {
          const r = await ask(tx, actor('superB'), key, c.country, value);
          expect(r, `${key} ${String(value)}`).toEqual({ outcome: 'FORBIDDEN', request_id: null });
        }
      }
      for (const k of SWITCHES) expect(await requests(tx, k, c.country), k).toEqual([]);
      const refused = (await auditOf(tx, actor('superB').userId)).filter(
        (a) => a.action_code === 'STAFF_FORBIDDEN' && a.after?.['reason'] === 'GO_LIVE_SWITCH',
      );
      expect(refused).toHaveLength(variants.length * 2);
    });
    // preuve structurelle : sous le propriétaire des commandes (fixture 9929), hors des commandes
    const probe = (what: string, key: string, value: unknown) =>
      withTestTransaction(api, {}, async (tx) => {
        await asStaff(tx, actor('superB'));
        return tx
          .query<{ n: number }>(
            'SELECT test_fixture.us535_owner_write($1, $2, $3, $4::jsonb) AS n',
            [what, key, c.country, JSON.stringify(value)],
          )
          .then(
            (r) => ({ n: r.rows[0]?.n ?? null }),
            (e: unknown) => e as { code?: string; constraint?: string },
          );
      });
    for (const k of SWITCHES) {
      for (const key of [k, k.toUpperCase()]) {
        for (const value of [true, false]) {
          expect(await probe('insert', key, value), `${key} ${String(value)}`).toMatchObject({
            code: '42501',
            constraint: 'param_value_go_live_guard',
          });
        }
      }
      // fermeture : les politiques du propriétaire ne voient aucune version d'une clé gardée
      expect(await probe('close', k, null), k).toEqual({ n: 0 });
    }
    // une clé ordinaire sans demande approuvée : refusée par la RLS (WITH CHECK)
    expect(await probe('insert', BOOL_KEY, true)).toMatchObject({ code: '42501' });
    await allFalse(c.country);
  });

  it('critère 5 : type, bornes (absentes ⇒ refus), devise du pays, clé JSON, pays non concerné ⇒ PARAM_INVALID_VALUE / PARAM_NOT_APPLICABLE ; clé inconnue ou en casse mixte ⇒ PARAM_UNKNOWN ; refus journalisés, aucune demande', async () => {
    const money = param(MONEY_KEY).values[c.country] as string;
    const notApplicable = PARAMS.find(
      (p) => p.notApplicableIn?.includes(c.country) && p.scopes?.includes('COUNTRY'),
    );
    await withTestTransaction(api, {}, async (tx) => {
      const who = actor('superB');
      const refused: [string, string, unknown, Ask][] = [
        ['PARAM_UNKNOWN', 'no_such_param', true, {}],
        ['PARAM_UNKNOWN', BOOL_KEY.toUpperCase(), true, {}],
        ['PARAM_INVALID_VALUE', BOOL_KEY, 1, {}],
        ['PARAM_INVALID_VALUE', BOOL_KEY, 'true', {}],
        ['PARAM_INVALID_VALUE', BOOL_KEY, null, {}],
        ['PARAM_INVALID_VALUE', ENUM_KEY, 'GOLD', {}],
        ['PARAM_INVALID_VALUE', ENUM_KEY, 'PREMIUM', { currency: c.currency }],
        // clé numérique sans borne : refus (fail-closed)
        ['PARAM_INVALID_VALUE', GRACE, 10, {}],
        ['PARAM_INVALID_VALUE', MONEY_KEY, money, { currency: c.currency }],
        ['PARAM_INVALID_VALUE', JSON_KEY, param(JSON_KEY).values[c.country], {}],
      ];
      if (notApplicable) refused.push(['PARAM_NOT_APPLICABLE', notApplicable.key, '1', {}]);
      for (const [outcome, key, value, o] of refused) {
        expect(
          (await ask(tx, who, key, c.country, value, o)).outcome,
          `${key} ${String(value)}`,
        ).toBe(outcome);
      }
      // bornes posées (transaction annulée) : hors bornes, hors type, autre devise refusés
      await bound(tx, GRACE, c.country, 0, 120);
      await bound(tx, MONEY_KEY, c.country, 0, Number(money) * 2);
      const outside: [string, unknown, Ask][] = [
        [GRACE, 121, {}],
        [GRACE, -1, {}],
        [GRACE, 10.5, {}],
        [GRACE, '10', {}],
        [MONEY_KEY, String(Number(money) * 2 + 1), { currency: c.currency }],
        [MONEY_KEY, Number(money), { currency: c.currency }],
        [MONEY_KEY, money, { currency: other.currency }],
        [MONEY_KEY, money, { currency: null }],
        [MONEY_KEY, '-1', { currency: c.currency }],
      ];
      for (const [key, value, o] of outside) {
        expect(
          (await ask(tx, who, key, c.country, value, o)).outcome,
          `${key} ${String(value)} ${String(o.currency)}`,
        ).toBe('PARAM_INVALID_VALUE');
      }
      const all = refused.length + outside.length;
      const audit = (await auditOf(tx, who.userId)).filter(
        (a) => a.action_code === 'PARAM_CHANGE_REFUSED',
      );
      expect(audit).toHaveLength(all);
      expect(audit.every((a) => a.after?.['country'] === c.country)).toBe(true);
      for (const key of [BOOL_KEY, ENUM_KEY, GRACE, MONEY_KEY, JSON_KEY]) {
        expect(await requests(tx, key, c.country), key).toEqual([]);
      }
      // dans les bornes, avec la devise du pays : recevables
      expect((await ask(tx, who, GRACE, c.country, 10)).outcome).toBe('REQUESTED');
      const half = String(Math.floor(Number(money) / 2));
      expect(
        (await ask(tx, who, MONEY_KEY, c.country, half, { currency: c.currency })).outcome,
      ).toBe('REQUESTED');
      expect((await ask(tx, who, ENUM_KEY, c.country, 'PREMIUM')).outcome).toBe('REQUESTED');
    });
    for (const key of [GRACE, MONEY_KEY, ENUM_KEY]) await unchanged(key, c.country);
  });

  it('critères 6 et 8 : valid_from passé ou pas postérieur à la dernière version ⇒ PARAM_RETROACTIVE ; valeur non décidée ⇒ PARAM_UNDECIDED ; valid_from égal à maintenant ⇒ en vigueur à l’approbation ; versions successives sans trou ni recouvrement', async () => {
    // horloge virtuelle figée (platform.now() constant dans la transaction) : « maintenant » est le
    // même instant à la demande et à l'approbation
    const virtual = new Date(Math.floor((Date.now() + 5 * MIN) / 1000) * 1000).toISOString();
    await withTestTransaction(api, { virtualNow: virtual }, async (tx) => {
      const who = await freshSession(tx, actor('admin'));
      const second = await freshSession(tx, actor('superC'));
      const base = (await versions(tx, BOOL_KEY, c.country)).length;
      for (const decision of [
        null,
        '',
        'TO_DECIDE',
        'OQ-BR-04',
        'DEC-FONDATEUR-',
        'dec-fondateur-15',
      ]) {
        expect(
          (await ask(tx, who, BOOL_KEY, c.country, true, { decision })).outcome,
          String(decision),
        ).toBe('PARAM_UNDECIDED');
      }
      expect(
        (
          await ask(tx, who, BOOL_KEY, c.country, true, {
            validFrom: new Date(Date.now() - 60 * MIN).toISOString(),
          })
        ).outcome,
      ).toBe('PARAM_RETROACTIVE');
      // valid_from = maintenant (instant de la base) : en vigueur dès l'approbation
      const now = (await tx.query<{ t: Date }>('SELECT platform.now() AS t')).rows[0]?.t as Date;
      expect(now.toISOString()).toBe(virtual);
      const r0 = await ask(tx, who, BOOL_KEY, c.country, true, { validFrom: now.toISOString() });
      expect(r0.outcome).toBe('REQUESTED');
      expect((await approve(tx, second, r0.request_id as string)).outcome).toBe('APPLIED');
      expect(await inForce(tx, BOOL_KEY, c.country)).toBe(true);
      // version programmée à +2 h, puis une demande avant elle ou à la même date : refus
      const at2 = new Date(now.getTime() + 120 * MIN).toISOString();
      const r1 = await ask(tx, who, BOOL_KEY, c.country, false, { validFrom: at2 });
      expect((await approve(tx, second, r1.request_id as string)).outcome).toBe('APPLIED');
      for (const validFrom of [new Date(now.getTime() + 60 * MIN).toISOString(), at2]) {
        expect(
          (await ask(tx, who, BOOL_KEY, c.country, true, { validFrom })).outcome,
          validFrom,
        ).toBe('PARAM_RETROACTIVE');
      }
      // même valeur que la dernière version : sans effet
      const at3 = new Date(now.getTime() + 180 * MIN).toISOString();
      expect((await ask(tx, who, BOOL_KEY, c.country, false, { validFrom: at3 })).outcome).toBe(
        'NO_CHANGE',
      );
      const r2 = await ask(tx, who, BOOL_KEY, c.country, true, { validFrom: at3 });
      expect((await approve(tx, second, r2.request_id as string)).outcome).toBe('APPLIED');
      const vs = (await versions(tx, BOOL_KEY, c.country)).slice(base - 1);
      // chaîne : graine [.., now), r0 [now, +2 h), r1 [+2 h, +3 h), r2 [+3 h, ∞)
      expect(vs.map((v) => [v.value, v.valid_to?.toISOString() ?? null])).toEqual([
        [param(BOOL_KEY).values[c.country], now.toISOString()],
        [true, at2],
        [false, at3],
        [true, null],
      ]);
      for (let i = 1; i < vs.length; i += 1) {
        expect(vs[i]?.valid_from.toISOString()).toBe(vs[i - 1]?.valid_to?.toISOString());
      }
      // approbation après la date d'effet : rétroactive, demande rejetée, aucune version
      const at4 = new Date(now.getTime() + 240 * MIN).toISOString();
      const r3 = await ask(tx, who, BOOL_KEY, c.country, false, { validFrom: at4 });
      expect(r3.outcome).toBe('REQUESTED');
      await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
        plusMinutes(at4, 1),
      ]);
      const approver = await freshSession(tx, actor('superC'));
      expect((await approve(tx, approver, r3.request_id as string)).outcome).toBe(
        'PARAM_RETROACTIVE',
      );
      expect(await statusOf(tx, BOOL_KEY, c.country, r3.request_id as string)).toBe('REJECTED');
      expect(await versions(tx, BOOL_KEY, c.country)).toHaveLength(base + 3);
      const refusals = (await auditOf(tx, who.userId)).filter(
        (a) => a.action_code === 'PARAM_CHANGE_REFUSED',
      );
      expect(refusals.map((a) => a.after?.['outcome'])).toEqual(
        expect.arrayContaining(['PARAM_UNDECIDED', 'PARAM_RETROACTIVE']),
      );
    });
    await unchanged(BOOL_KEY, c.country);
  });

  it('critère 1 : échéance 72 h ⇒ EXPIRED (une demande échue ne bloque pas la suivante) ; annulation par le demandeur ou un SUPERADMIN ; demandeur sans droit ou compte suspendu à l’approbation ⇒ REJECTED', async () => {
    await withTestTransaction(api, {}, async (tx) => {
      const base = (await versions(tx, BOOL_KEY, c.country)).length;
      const far = new Date(Date.now() + 10 * DAY).toISOString();
      const r = await ask(tx, actor('admin'), BOOL_KEY, c.country, true, { validFrom: far });
      expect(r.outcome).toBe('REQUESTED');
      await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
        new Date(Date.now() + 73 * 60 * MIN).toISOString(),
      ]);
      const approver = await freshSession(tx, actor('adminB'));
      expect((await approve(tx, approver, r.request_id as string)).outcome).toBe('EXPIRED');
      const requester = await freshSession(tx, actor('admin'));
      const again = await ask(tx, requester, BOOL_KEY, c.country, true, { validFrom: far });
      expect(again.outcome).toBe('REQUESTED');
      expect(await versions(tx, BOOL_KEY, c.country)).toHaveLength(base);
    });
    await withTestTransaction(api, {}, async (tx) => {
      const base = (await versions(tx, ENUM_KEY, c.country)).length;
      const mine = await ask(tx, actor('admin'), ENUM_KEY, c.country, 'PREMIUM');
      const id = mine.request_id as string;
      expect((await cancel(tx, actor('adminB'), id)).outcome).toBe('FORBIDDEN');
      expect((await cancel(tx, actor('noMfa'), id)).outcome).toBe('MFA_REQUIRED');
      expect((await cancel(tx, actor('admin'), id)).outcome).toBe('CANCELLED');
      expect((await cancel(tx, actor('admin'), id)).outcome).toBe('NOT_PENDING');
      expect((await approve(tx, actor('adminB'), id)).outcome).toBe('NOT_PENDING');
      const theirs = await ask(tx, actor('admin'), ENUM_KEY, c.country, 'PREMIUM');
      expect((await cancel(tx, actor('superB'), theirs.request_id as string)).outcome).toBe(
        'CANCELLED',
      );
      expect((await auditOf(tx, actor('superB').userId)).map((a) => a.action_code)).toContain(
        'PARAM_CHANGE_CANCELLED',
      );
      // compte du demandeur suspendu : rejet
      const s = await ask(tx, actor('admin'), ENUM_KEY, c.country, 'PREMIUM');
      await tx.query(`SELECT test_fixture.iam_set_account_status($1, 'RESTRICTED')`, [
        actor('admin').userId,
      ]);
      expect((await approve(tx, actor('adminB'), s.request_id as string)).outcome).toBe('REJECTED');
      expect(await versions(tx, ENUM_KEY, c.country)).toHaveLength(base);
    });
    await withTestTransaction(api, {}, async (tx) => {
      const base = (await versions(tx, BOOL_KEY, c.country)).length;
      // le rôle du demandeur échoit avant l'approbation : rejet, sans effet
      const r = await ask(tx, actor('adminExpiring'), BOOL_KEY, c.country, true, {
        validFrom: new Date(Date.now() + 5 * DAY).toISOString(),
      });
      expect(r.outcome).toBe('REQUESTED');
      await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
        new Date(Date.now() + 120 * MIN).toISOString(),
      ]);
      const approver = await freshSession(tx, actor('superC'));
      expect((await approve(tx, approver, r.request_id as string)).outcome).toBe('REJECTED');
      expect(await versions(tx, BOOL_KEY, c.country)).toHaveLength(base);
    });
    await unchanged(BOOL_KEY, c.country);
    await unchanged(ENUM_KEY, c.country);
  });

  it('critère 10 : paramètres hostiles — valid_from, clé ou pays nuls, motif trop court ⇒ 22023 ; pays hors de la portée du contexte ou du rôle ⇒ FORBIDDEN ; contexte voyageur ou hôte ⇒ AUTH_REQUIRED', async () => {
    for (const [key, country, o] of [
      [BOOL_KEY, c.country, { validFrom: null }],
      [null, c.country, {}],
      [BOOL_KEY, null, {}],
      [BOOL_KEY, c.country, { reason: 'court' }],
      [BOOL_KEY, c.country, { reason: null }],
    ] as const) {
      const err = await withTestTransaction(api, {}, async (tx) =>
        ask(tx, actor('admin'), key, country, true, o).then(
          () => null,
          (e: unknown) => e,
        ),
      );
      expect(code(err), `${String(key)} ${String(country)} ${JSON.stringify(o)}`).toBe('22023');
    }
    await withTestTransaction(api, {}, async (tx) => {
      // ADMIN de l'autre pays seulement ; ADMIN des deux pays dont le contexte ne porte que l'autre
      expect(
        (await ask(tx, actor(`admin_${other.country}`), BOOL_KEY, c.country, true)).outcome,
      ).toBe('FORBIDDEN');
      const narrowed: StaffActor = { ...actor('admin'), scope: [other.country] };
      expect((await ask(tx, narrowed, BOOL_KEY, c.country, true)).outcome).toBe('FORBIDDEN');
      expect((await ask(tx, actor('ops'), BOOL_KEY, c.country, true)).outcome).toBe('FORBIDDEN');
      expect((await ask(tx, actor('noMfa'), BOOL_KEY, c.country, true)).outcome).toBe(
        'MFA_REQUIRED',
      );
      expect((await ask(tx, actor('admin'), BOOL_KEY, 'ZZ', true)).outcome).toBe('FORBIDDEN');
      const r = await ask(tx, actor('admin'), BOOL_KEY, c.country, true);
      expect(r.outcome).toBe('REQUESTED');
      for (const ctx of [
        { kind: 'GUEST', actorId: actor('adminB').userId },
        { kind: 'HOST', actorId: actor('adminB').userId, orgId: randomUUID() },
      ] as const) {
        await setSessionContext(tx, ctx as Parameters<typeof setSessionContext>[1]);
        const { rows } = await tx.query<{ outcome: string }>(APPROVE_SQL, [
          actor('adminB').hash,
          r.request_id,
        ]);
        expect(rows[0]?.outcome, ctx.kind).toBe('AUTH_REQUIRED');
      }
      // jeton d'une autre session (inconnu) : aucune identité
      await asStaff(tx, { ...actor('adminB'), hash: newHash() });
      const { rows } = await tx.query<{ outcome: string }>(APPROVE_SQL, [newHash(), r.request_id]);
      expect(rows[0]?.outcome).toBe('AUTH_REQUIRED');
      expect(await statusOf(tx, BOOL_KEY, c.country, r.request_id as string)).toBe('PENDING');
    });
    await unchanged(BOOL_KEY, c.country);
  });
});

describe('US-535a — RLS et droits (base de production, rôles de production)', () => {
  const TABLES = ['config_param_change_request', 'config_param_bound', 'config_param_value'];

  it('app_api, app_worker et app_anon n’écrivent ni les valeurs, ni les demandes, ni les bornes ; ils ne lisent ni les demandes ni les bornes', async () => {
    for (const role of ['app_api', 'app_worker', 'app_anon'] as const) {
      await withRole(
        role,
        async (client) => {
          const { rows } = await client.query<{
            t: string;
            sel: boolean;
            ins: boolean;
            upd: boolean;
            del: boolean;
            trunc: boolean;
          }>(
            `SELECT t, has_table_privilege('core.' || t, 'SELECT') AS sel,
                    has_table_privilege('core.' || t, 'INSERT') AS ins,
                    has_table_privilege('core.' || t, 'UPDATE') AS upd,
                    has_table_privilege('core.' || t, 'DELETE') AS del,
                    has_table_privilege('core.' || t, 'TRUNCATE') AS trunc
               FROM unnest($1::text[]) AS t ORDER BY 1`,
            [TABLES],
          );
          for (const r of rows) {
            expect(r, `${role} ${r.t}`).toMatchObject({
              ins: false,
              upd: false,
              del: false,
              trunc: false,
            });
            // seule la configuration versionnée est lisible (app_worker ; app_api par colonnes)
            if (r.t !== 'config_param_value' || role === 'app_anon') {
              expect(r.sel, `${role} ${r.t}`).toBe(false);
            }
          }
        },
        { database: 'production' },
      );
    }
  });

  it('écritures directes refusées (42501) sous app_api avec un contexte ADMIN ; lecture des demandes refusée sous app_api et app_worker', async () => {
    const attacks: [string, unknown[]][] = [
      [
        `INSERT INTO core.config_param_change_request (id, key, country_code, value, valid_from,
           reason, decision_ref, requested_by, expires_at, status)
         VALUES ($1, 'listing_manual_review_required', $2, 'true', platform.now() + interval '1 day',
           'écriture directe hostile', 'DEC-FONDATEUR-15', $1, platform.now() + interval '2 days',
           'PENDING')`,
        [randomUUID(), FIRST],
      ],
      [`UPDATE core.config_param_change_request SET status = 'APPLIED'`, []],
      [`DELETE FROM core.config_param_change_request`, []],
      [
        `INSERT INTO core.config_param_bound (key, country_code, min_value, max_value, source_ref)
         VALUES ('grace_minutes', $1, 0, 100000, 'hostile')`,
        [FIRST],
      ],
      [
        `INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
         VALUES ('listing_manual_review_required', $1, 'COUNTRY', 'true', 'hostile')`,
        [FIRST],
      ],
      [
        `UPDATE core.config_param_value SET valid_to = platform.now() + interval '1 day'
          WHERE valid_to IS NULL`,
        [],
      ],
      [`DELETE FROM core.config_param_value WHERE key = 'grace_minutes'`, []],
    ];
    await withRole('app_api', async (client) => {
      for (const [sql, args] of attacks) {
        const err = await withTestTransaction(client, {}, async (tx) => {
          await asStaff(tx, actor('admin'));
          return tx.query(sql, args).then(
            () => null,
            (e: unknown) => e,
          );
        });
        expect(code(err), sql).toBe('42501');
      }
    });
    for (const role of ['app_api', 'app_worker'] as const) {
      await withRole(role, async (client) => {
        for (const t of ['config_param_change_request', 'config_param_bound']) {
          const err = await client.query(`SELECT count(*) FROM core.${t}`).then(
            () => null,
            (e: unknown) => e,
          );
          expect(code(err), `${role} ${t}`).toBe('42501');
        }
      });
    }
  });

  it('seul app_api exécute les commandes (app_worker et app_anon : 42501)', async () => {
    for (const role of ['app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        for (const [sql, params] of [
          [
            REQUEST_SQL,
            [newHash(), randomUUID(), BOOL_KEY, FIRST, 'true', null, new Date(), REASON, DECISION],
          ],
          [APPROVE_SQL, [newHash(), randomUUID()]],
          [CANCEL_SQL, [newHash(), randomUUID()]],
        ] as const) {
          const err = await client.query(sql, [...params]).then(
            () => null,
            (e: unknown) => e,
          );
          expect(code(err), `${role} ${sql}`).toBe('42501');
        }
      });
    }
  });
});

// -------------------------------------------------------------------------------------------------
// Critère 7 : un devis figé garde l'ancienne valeur (grace_minutes, TA07), PA et PY
// -------------------------------------------------------------------------------------------------

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const ORDER = [
  'TRIP_PRICE',
  'PROMO_PLATFORM',
  'PROMO_HOST',
  'TRIP_FEE',
  'PROTECTION',
  'EXTRAS',
  'ENHANCED_ROADSIDE',
  'ADDITIONAL_DRIVER_FEE',
  'YOUNG_DRIVER_FEE',
  'DELIVERY_FEE',
];

/** Montants attendus (oracle, voir l'en-tête), par pays et par nombre de jours facturables. */
interface Amounts {
  readonly price: number;
  readonly fee: number;
  readonly taxPrice: number;
  readonly taxFee: number;
  readonly host: number;
}
const DAILY: Readonly<Record<string, number>> = { PA: 4_000, PY: 333_334 };
const EXPECTED: Readonly<Record<string, Readonly<Record<number, Amounts>>>> = {
  PA: {
    3: { price: 12_000, fee: 1_800, taxPrice: 840, taxFee: 126, host: 9_000 },
    4: { price: 16_000, fee: 2_400, taxPrice: 1_120, taxFee: 168, host: 12_000 },
  },
  PY: {
    3: { price: 1_000_002, fee: 150_000, taxPrice: 100_000, taxFee: 15_000, host: 750_001 },
    4: { price: 1_333_336, fee: 200_000, taxPrice: 133_334, taxFee: 20_000, host: 1_000_002 },
  },
};

const sha = (prefix: string, text: string): string =>
  createHash('sha256')
    .update(prefix + text, 'utf8')
    .digest('hex');

interface Docs {
  readonly inputs: string;
  readonly inputsHash: string;
  readonly outputs: string;
  readonly outputsHash: string;
}

/** Documents canoniques d'un devis (forme de frozen.ts, comme l0-us202-quote). */
function quoteDocs(
  c: CountryCase,
  groups: ReadonlyMap<string, string>,
  days: number,
  startMs: number,
  endMs: number,
  quotedAtMs: number,
): Docs {
  const a = EXPECTED[c.country]?.[days];
  if (!a) throw new Error(`vecteur ${c.country} ${String(days)} j`);
  const amounts: Record<string, number> = { TRIP_PRICE: a.price, TRIP_FEE: a.fee };
  const taxes: Record<string, number> = { TRIP_PRICE: a.taxPrice, TRIP_FEE: a.taxFee };
  const lines = ORDER.filter((t) => (amounts[t] ?? 0) !== 0).map((t) => ({
    type: t,
    amount: String(amounts[t]),
    taxGroup: groups.get(t) ?? null,
    tax: String(taxes[t] ?? 0),
  }));
  const subtotal = a.price + a.fee;
  const tax = a.taxPrice + a.taxFee;
  const total = subtotal + tax;
  const outputs = {
    engineVersion: 'prc.quote/2',
    currency: c.currency,
    billableDays: days,
    lines,
    taxGroups: [],
    subtotal: String(subtotal),
    taxTotal: String(tax),
    taxThirdParty: '0',
    total: String(total),
    legs: {
      HOST: String(a.host),
      INSURER: '0',
      TAX_THIRD_PARTY: '0',
      PLATFORM: String(total - a.host),
    },
    hostSharePct: '3/4',
  };
  const inputs = JSON.stringify({
    request: {
      startAtMs: startMs,
      endAtMs: endMs,
      quotedAtMs,
      rateType: 'REFUNDABLE',
      dailyRate: String(DAILY[c.country]),
      lines: {},
    },
    params: { currency: { code: c.currency } },
  });
  const out = JSON.stringify(outputs);
  return {
    inputs,
    inputsHash: sha('rueda.quote.inputs/1\n', inputs),
    outputs: out,
    outputsHash: sha('rueda.quote.outputs/1\n', out),
  };
}

async function guest(client: pg.ClientBase, country: string): Promise<Buffer> {
  const id = randomUUID();
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400, NULL,
                                                $6, $7::jsonb, false) AS ok`,
    [id, `guest-${id}@example.test`, phcArgon2id(), randomUUID(), randomBytes(32), country, DOCS],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await client.query('SELECT test_fixture.iam_set_account_status($1, $2)', [id, 'ACTIVE']);
  const t = newToken();
  const s = await client.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [randomUUID(), id, t.hash, SESSION_TTL_S],
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  return t.hash;
}

async function taxGroups(client: pg.ClientBase, country: string): Promise<Map<string, string>> {
  const { rows } = await client.query<{ line_type: string; rate_group: string | null }>(
    `SELECT DISTINCT ON (line_type) line_type, rate_group FROM core.pricing_tax_line_config
      WHERE country_code = $1 ORDER BY line_type, version DESC`,
    [country],
  );
  return new Map(
    rows.filter((r) => r.rate_group !== null).map((r) => [r.line_type, r.rate_group as string]),
  );
}

async function freeze(
  tx: pg.ClientBase,
  hash: Buffer,
  listingId: string,
  d: Docs,
): Promise<{ outcome: string; quote_id: string | null }> {
  const { rows } = await tx.query<{ outcome: string; quote_id: string | null }>(
    'SELECT * FROM core.pricing_cmd_freeze_quote($1, $2, $3, $4, $5, $6)',
    [hash, listingId, d.inputs, d.inputsHash, d.outputs, d.outputsHash],
  );
  return rows[0] ?? { outcome: '', quote_id: null };
}

describe.each(COUNTRIES)(
  'US-535a — devis figé sous l’ancienne valeur ($country, $currency)',
  (c) => {
    it('critère 7 : grace_minutes 29 ⇒ 10 min : le devis figé garde 3 jours et ses montants ; après l’entrée en vigueur, le même trip vaut 4 jours (TA07)', async () => {
      // instant virtuel à venir (minute pleine), trip neuf jours plus tard : 3 j 20 min
      const now = Math.floor((Date.now() + 10 * DAY) / MIN) * MIN;
      const start = now + 9 * DAY;
      const end = start + 3 * DAY + 20 * MIN;
      const nowIso = new Date(now).toISOString();
      await withRole('app_api', async (client) => {
        await withTestTransaction(client, { virtualNow: nowIso }, async (tx) => {
          const g = await guest(tx, c.country);
          const { rows } = await tx.query<{ listing_id: string }>(
            'SELECT * FROM test_fixture.us202_listed_listing($1, $2)',
            [c.country, DAILY[c.country]],
          );
          const listing = rows[0]?.listing_id as string;
          const groups = await taxGroups(tx, c.country);
          expect(await inForce(tx, GRACE, c.country)).toBe(29);
          // devis figé sous l'ancienne valeur : 3 jours facturables
          const q = await freeze(tx, g, listing, quoteDocs(c, groups, 3, start, end, now));
          expect(q.outcome).toBe('DONE');
          const frozen = (
            await tx.query('SELECT * FROM test_fixture.us202_quote_row($1)', [q.quote_id])
          ).rows[0] as Record<string, unknown>;
          const a3 = EXPECTED[c.country]?.[3] as Amounts;
          expect(frozen['billable_days']).toBe(3);
          expect(String(frozen['total_minor'])).toBe(
            String(a3.price + a3.fee + a3.taxPrice + a3.taxFee),
          );

          // nouvelle valeur 10 min (borne posée dans la transaction annulée), effet à +1 h
          await bound(tx, GRACE, c.country, 0, 120);
          const requester = await freshSession(tx, actor('admin'));
          const approver = await freshSession(tx, actor('superB'));
          const validFrom = new Date(now + 60 * MIN).toISOString();
          const r = await ask(tx, requester, GRACE, c.country, 10, { validFrom });
          expect(r.outcome).toBe('REQUESTED');
          expect((await approve(tx, approver, r.request_id as string)).outcome).toBe('APPLIED');
          expect(await inForce(tx, GRACE, c.country)).toBe(29);

          // entrée en vigueur
          await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
            new Date(now + 120 * MIN).toISOString(),
          ]);
          expect(await inForce(tx, GRACE, c.country)).toBe(10);
          // le devis figé n'a pas bougé
          const after = (
            await tx.query('SELECT * FROM test_fixture.us202_quote_row($1)', [q.quote_id])
          ).rows[0] as Record<string, unknown>;
          expect(after).toEqual(frozen);
          // un nouveau devis du même trip compte 4 jours : les documents à 3 jours ne collent plus
          const later = now + 120 * MIN;
          expect(
            (await freeze(tx, g, listing, quoteDocs(c, groups, 3, start, end, later))).outcome,
          ).toBe('QUOTE_MISMATCH');
          const q4 = await freeze(tx, g, listing, quoteDocs(c, groups, 4, start, end, later));
          expect(q4.outcome).toBe('DONE');
          const row4 = (
            await tx.query('SELECT * FROM test_fixture.us202_quote_row($1)', [q4.quote_id])
          ).rows[0] as Record<string, unknown>;
          const a4 = EXPECTED[c.country]?.[4] as Amounts;
          expect(row4['billable_days']).toBe(4);
          expect(String(row4['total_minor'])).toBe(
            String(a4.price + a4.fee + a4.taxPrice + a4.taxFee),
          );
          expect(String(row4['leg_host_minor'])).toBe(String(a4.host));
        });
      });
      await unchanged(GRACE, c.country);
    });
  },
);
