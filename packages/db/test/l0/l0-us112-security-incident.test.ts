/**
 * Preuves du registre des incidents de sécurité et des violations de données (US-112, migrations
 * 0091 et 0092 ; fixture 9958) sous les rôles de PRODUCTION app_api et app_worker (assertion L0-05
 * en tête de chaque connexion : connectAs / withRole), au Panama (USD) et au Paraguay (PYG).
 *
 * Attendus tirés de 19 US-112 (critère 2 : « un incident déclaré est inscrit au registre avec les
 * délais de notification (Ley 81) à respecter »), de 17 §3.2.13 (`security_incident` : nature,
 * données personnelles, échéance de notification de l'autorité, notifications, statuts OPEN,
 * CONTAINED, NOTIFIED, CLOSED, post-mortem), §4.5 (`security.incident.opened` : incident_id,
 * due_at), §6.4 (procédure reliée au registre, alerte au fondateur) et d'OQ-MK-09 (délai PROPOSÉ de
 * 72 h). Les délais sont lus dans les DONNÉES de configuration (params.json), jamais dans le code
 * testé. Défauts fail-closed PROPOSÉS (ADR-121) : délai absent ⇒ échéance immédiate ; données
 * personnelles inconnues ⇒ échéances applicables ; clôture seulement contenue, notifiée et avec
 * post-mortem.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertProductionRole,
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import { asStaff, newHash } from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import { staff, staffSessionHash } from '../support/rls.ts';
import { auditOf, createStaff, login } from '../support/staff.ts';

const ALL = COUNTRIES.map((c) => c.country);
const HOUR_MS = 3_600_000;
const code = (error: unknown): string => (error as { code?: string }).code ?? 'SANS_CODE';

interface ParamData {
  readonly key: string;
  readonly values: Readonly<Record<string, number | boolean>>;
}
const PARAMS = (
  JSON.parse(
    readFileSync(
      new URL('../../../../apps/api/src/modules/cfg/data/params.json', import.meta.url),
      'utf8',
    ),
  ) as { params: ParamData[] }
).params;
/** Délai (heures) du pays, lu dans les données de configuration (OQ-MK-09). */
const hoursOf = (key: string, country: string): number => {
  const v = PARAMS.find((p) => p.key === key)?.values[country];
  if (typeof v !== 'number') throw new Error(`${key} sans valeur pour ${country}`);
  return v;
};
const AUTHORITY = 'security_incident_authority_notice_hours';
const SUBJECTS = 'security_incident_subjects_notice_hours';

const OPEN_SQL = `SELECT outcome, incident_id, authority_due_at, subjects_due_at
  FROM core.security_incident_cmd_open($1, $2, $3, $4, $5, $6, $7, $8)`;
const STEP_SQL = `SELECT outcome, incident_id, status
  FROM core.security_incident_cmd_step($1, $2, $3, $4, $5)`;
const WATCH_SQL = 'SELECT signal, country_code, n FROM core.security_incident_worker_watch($1)';

interface Opened {
  readonly outcome: string;
  readonly incident_id: string | null;
  readonly authority_due_at: Date | null;
  readonly subjects_due_at: Date | null;
}
interface Stepped {
  readonly outcome: string;
  readonly incident_id: string | null;
  readonly status: string | null;
}
interface Incident {
  readonly country_code: string;
  readonly kind: string;
  readonly severity: string;
  readonly personal_data_involved: boolean | null;
  readonly subjects_count_estimate: number | null;
  readonly detected_at: Date;
  readonly reported_by: string;
  readonly authority_notification_due_at: Date;
  readonly subjects_notification_due_at: Date;
  readonly contained_at: Date | null;
  readonly authority_notified_at: Date | null;
  readonly subjects_notified_at: Date | null;
  readonly closed_at: Date | null;
  readonly status: string;
  readonly postmortem_file_id: string | null;
  readonly opened_alerted_at: Date | null;
  readonly authority_overdue_alerted_at: Date | null;
  readonly subjects_overdue_alerted_at: Date | null;
}

interface Declaration {
  readonly id?: string;
  readonly country: string;
  readonly kind?: string;
  readonly severity?: string;
  readonly personalData?: boolean | null;
  readonly subjects?: number | null;
  readonly detectedAt?: Date | null;
}

async function declare(tx: pg.ClientBase, who: StaffActor, d: Declaration): Promise<Opened> {
  await asStaff(tx, who);
  const { rows } = await tx.query<Opened>(OPEN_SQL, [
    who.hash,
    d.id ?? randomUUID(),
    d.country,
    d.kind ?? 'DATA_BREACH',
    d.severity ?? 'HIGH',
    d.personalData === undefined ? null : d.personalData,
    d.subjects === undefined ? 12 : d.subjects,
    d.detectedAt ?? null,
  ]);
  return rows[0] as Opened;
}

async function step(
  tx: pg.ClientBase,
  who: StaffActor,
  incidentId: string,
  name: string,
  fileId: string | null = null,
): Promise<Stepped> {
  await asStaff(tx, who);
  const { rows } = await tx.query<Stepped>(STEP_SQL, [
    who.hash,
    randomUUID(),
    incidentId,
    name,
    fileId,
  ]);
  return rows[0] as Stepped;
}

async function incidentOf(tx: pg.ClientBase, id: string): Promise<Incident> {
  const { rows } = await tx.query<Incident>('SELECT * FROM test_fixture.us112_incident($1)', [id]);
  const r = rows[0];
  if (r === undefined) throw new Error(`incident ${id} absent`);
  return r;
}

async function dbNow(tx: pg.ClientBase): Promise<Date> {
  const { rows } = await tx.query<{ t: Date }>('SELECT platform.now() AS t');
  return rows[0]?.t as Date;
}

/** Pièce du magasin de preuves (fixture 9960) dans le seau donné ; rend son identifiant. */
async function file(tx: pg.ClientBase, bucket: string): Promise<string> {
  const id = randomUUID();
  await tx.query('SELECT test_fixture.us101_insert_file($1, $2)', [id, bucket]);
  return id;
}

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
    for (const [name, role] of [
      ['ops', 'OPS_AGENT'],
      ['admin', 'ADMIN'],
      ['super', 'SUPERADMIN'],
      ['support', 'SUPPORT_AGENT'],
      ['finance', 'FINANCE'],
    ] as const) {
      const id = await staff(tx, role, ALL);
      people[name] = { userId: id, hash: sessionOf(id), scope: ALL };
    }
    for (const c of ALL) {
      const id = await staff(tx, 'ADMIN', [c]);
      people[`admin_${c}`] = { userId: id, hash: sessionOf(id), scope: [c] };
    }
  });
  // ADMIN sans élévation TOTP (session NONE)
  const noMfa = await createStaff(api, 'ADMIN', ALL, { withFactor: false });
  people['noMfa'] = { userId: noMfa.userId, hash: await login(api, noMfa.userId), scope: ALL };
});

afterAll(async () => {
  await releaseClient(api);
});

// L0-05 : la connexion partagée est bien app_api, rôle de production, avant chaque preuve
beforeEach(async () => {
  await assertProductionRole(api, 'app_api');
});

describe.each(COUNTRIES)(
  'US-112 — registre des incidents de sécurité ($country, $currency)',
  (c) => {
    const other = ALL.find((x) => x !== c.country) as string;

    it('critère 2 : un incident déclaré est inscrit au registre avec les échéances de notification du pays (détection + délai), événement et audit ; rejouer la même demande ⇒ DUPLICATE', async () => {
      await withTestTransaction(api, {}, async (tx) => {
        const now = await dbNow(tx);
        const detectedAt = new Date(now.getTime() - 5 * HOUR_MS);
        const id = randomUUID();
        const r = await declare(tx, actor('ops'), {
          id,
          country: c.country,
          personalData: true,
          subjects: 40,
          detectedAt,
        });
        const authorityDue = detectedAt.getTime() + hoursOf(AUTHORITY, c.country) * HOUR_MS;
        const subjectsDue = detectedAt.getTime() + hoursOf(SUBJECTS, c.country) * HOUR_MS;
        expect(r.outcome).toBe('OPENED');
        expect(r.incident_id).toBe(id);
        expect(r.authority_due_at?.getTime()).toBe(authorityDue);
        expect(r.subjects_due_at?.getTime()).toBe(subjectsDue);

        const row = await incidentOf(tx, id);
        expect(row).toMatchObject({
          country_code: c.country,
          kind: 'DATA_BREACH',
          severity: 'HIGH',
          personal_data_involved: true,
          subjects_count_estimate: 40,
          reported_by: actor('ops').userId,
          status: 'OPEN',
          contained_at: null,
          authority_notified_at: null,
          subjects_notified_at: null,
          closed_at: null,
          opened_alerted_at: null,
        });
        expect(row.detected_at.getTime()).toBe(detectedAt.getTime());
        expect(row.authority_notification_due_at.getTime()).toBe(authorityDue);
        expect(row.subjects_notification_due_at.getTime()).toBe(subjectsDue);

        // 17 §4.5 : security.incident.opened (incident_id, due_at), acteur du staff, aucune C2
        const { rows: events } = await tx.query<{
          type: string;
          aggregate_type: string;
          country_code: string;
          actor_user_id: string;
          actor_role: string;
          payload: Record<string, unknown>;
        }>('SELECT * FROM test_fixture.us112_events($1)', [id]);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          type: 'security.incident.opened',
          aggregate_type: 'security_incident',
          country_code: c.country,
          actor_user_id: actor('ops').userId,
          actor_role: 'OPS_AGENT',
        });
        expect(events[0]?.payload['incident_id']).toBe(id);
        expect(new Date(String(events[0]?.payload['due_at'])).getTime()).toBe(authorityDue);

        const audit = (await auditOf(tx, actor('ops').userId)).filter(
          (a) => a.action_code === 'SECURITY_INCIDENT_OPENED' && a.subject_id === id,
        );
        expect(audit).toHaveLength(1);
        expect(audit[0]?.after).toMatchObject({ country: c.country, kind: 'DATA_BREACH' });

        // idempotence : même demande ⇒ DUPLICATE, mêmes échéances, rien de plus
        const again = await declare(tx, actor('ops'), {
          id,
          country: c.country,
          personalData: true,
          subjects: 40,
          detectedAt,
        });
        expect(again.outcome).toBe('DUPLICATE');
        expect(again.authority_due_at?.getTime()).toBe(authorityDue);
        expect(
          (await tx.query('SELECT * FROM test_fixture.us112_events($1)', [id])).rows,
        ).toHaveLength(1);
        // même identifiant pour une autre déclaration : refusé
        await tx.query('SAVEPOINT reuse');
        await expect(
          declare(tx, actor('ops'), { id, country: c.country, kind: 'CREDENTIAL_LEAK' }),
        ).rejects.toMatchObject({ code: '22023' });
        await tx.query('ROLLBACK TO SAVEPOINT reuse');
      });
    });

    it('détection antérieure à l’échéance déjà passée : inscrite quand même, échéance dans le passé (jamais repoussée à la déclaration)', async () => {
      await withTestTransaction(api, {}, async (tx) => {
        const now = await dbNow(tx);
        const detectedAt = new Date(now.getTime() - 100 * HOUR_MS);
        const r = await declare(tx, actor('admin'), { country: c.country, detectedAt });
        expect(r.outcome).toBe('OPENED');
        expect(r.authority_due_at?.getTime()).toBe(
          detectedAt.getTime() + hoursOf(AUTHORITY, c.country) * HOUR_MS,
        );
        expect((r.authority_due_at as Date).getTime()).toBeLessThan(now.getTime());
      });
    });

    it('fail-closed : délai du pays absent (avant sa mise en vigueur) ⇒ échéances immédiates ; détection absente ⇒ instant de la base', async () => {
      // les délais de 0091 entrent en vigueur à la migration : à un instant antérieur, aucun délai
      await withTestTransaction(api, { virtualNow: '2026-11-10T12:00:00Z' }, async (tx) => {
        const r = await declare(tx, actor('admin'), { country: c.country });
        expect(r.outcome).toBe('OPENED');
        const at = new Date('2026-11-10T12:00:00Z').getTime();
        expect(r.authority_due_at?.getTime()).toBe(at);
        expect(r.subjects_due_at?.getTime()).toBe(at);
        const row = await incidentOf(tx, r.incident_id as string);
        expect(row.detected_at.getTime()).toBe(at);
        const audit = (await auditOf(tx, actor('admin').userId)).filter(
          (a) => a.action_code === 'SECURITY_INCIDENT_OPENED' && a.subject_id === r.incident_id,
        );
        expect(audit[0]?.after).toMatchObject({ noticeHoursKnown: false });
      });
    });

    it('accès : sans session ⇒ AUTH_REQUIRED ; sans TOTP ⇒ MFA_REQUIRED ; SUPPORT, FINANCE ou ADMIN d’un autre pays ⇒ FORBIDDEN (journalisé) ; rien d’inscrit', async () => {
      await withTestTransaction(api, {}, async (tx) => {
        const ghost: StaffActor = { userId: randomUUID(), hash: newHash(), scope: ALL };
        for (const [who, expected] of [
          [ghost, 'AUTH_REQUIRED'],
          [actor('noMfa'), 'MFA_REQUIRED'],
          [actor('support'), 'FORBIDDEN'],
          [actor('finance'), 'FORBIDDEN'],
          [actor(`admin_${other}`), 'FORBIDDEN'],
        ] as const) {
          const id = randomUUID();
          const r = await declare(tx, who, { id, country: c.country });
          expect(r, expected).toMatchObject({ outcome: expected, incident_id: null });
          const { rows } = await tx.query('SELECT * FROM test_fixture.us112_incident($1)', [id]);
          expect(rows).toHaveLength(0);
        }
        const denied = (await auditOf(tx, actor('support').userId)).filter(
          (a) => a.action_code === 'STAFF_FORBIDDEN' && a.subject_type === 'SECURITY_INCIDENT',
        );
        expect(denied.length).toBeGreaterThanOrEqual(1);
        // ADMIN du pays : autorisé
        expect(
          (await declare(tx, actor(`admin_${c.country}`), { country: c.country })).outcome,
        ).toBe('OPENED');
      });
    });

    it('entrée invalide (pays inconnu, nature, gravité, estimation négative, détection future) ⇒ 22023, rien d’inscrit', async () => {
      await withRole('app_api', async (client) => {
        const now = await dbNow(client);
        for (const d of [
          { country: 'ZZ' },
          { country: c.country.toLowerCase() },
          { country: c.country, kind: 'PHISHING' },
          { country: c.country, severity: 'P1' },
          { country: c.country, subjects: -1 },
          { country: c.country, detectedAt: new Date(now.getTime() + HOUR_MS) },
        ]) {
          await withTestTransaction(client, {}, async (tx) => {
            await expect(declare(tx, actor('admin'), d), JSON.stringify(d)).rejects.toMatchObject({
              code: '22023',
            });
          });
        }
      });
    });

    it('étapes : confinement, notifications, clôture avec post-mortem ; refus NOT_CONTAINED, NOTIFICATION_PENDING, QUALIFICATION_LOCKED, POSTMORTEM_REQUIRED ; OPS ne notifie ni ne clôt ; une ligne close ne bouge plus', async () => {
      await withTestTransaction(api, {}, async (tx) => {
        const { incident_id: id } = await declare(tx, actor('ops'), { country: c.country });
        const incident = id as string;
        expect(
          await step(tx, actor('admin'), incident, 'CLOSE', await file(tx, 'PRIVATE_EVIDENCE')),
        ).toMatchObject({ outcome: 'NOT_CONTAINED', status: 'OPEN' });
        expect(await step(tx, actor('ops'), incident, 'CONTAIN')).toMatchObject({
          outcome: 'DONE',
          status: 'CONTAINED',
        });
        expect((await step(tx, actor('ops'), incident, 'CONTAIN')).outcome).toBe('ALREADY_DONE');
        // OPS_AGENT : déclarer et contenir seulement (responsable des données : ADMIN, SUPERADMIN)
        for (const s of ['NOTIFY_AUTHORITY', 'NO_PERSONAL_DATA', 'CLOSE']) {
          expect((await step(tx, actor('ops'), incident, s)).outcome, s).toBe('FORBIDDEN');
        }
        expect(
          (await step(tx, actor(`admin_${other}`), incident, 'NOTIFY_AUTHORITY')).outcome,
        ).toBe('FORBIDDEN');
        // données personnelles inconnues = touchées : la clôture exige les deux notifications
        expect(
          (await step(tx, actor('admin'), incident, 'CLOSE', await file(tx, 'PRIVATE_EVIDENCE')))
            .outcome,
        ).toBe('NOTIFICATION_PENDING');
        expect(await step(tx, actor('admin'), incident, 'NOTIFY_AUTHORITY')).toMatchObject({
          outcome: 'DONE',
          status: 'CONTAINED',
        });
        // une notification faite atteste des données touchées : qualification « sans » refusée
        expect((await step(tx, actor('admin'), incident, 'NO_PERSONAL_DATA')).outcome).toBe(
          'QUALIFICATION_LOCKED',
        );
        expect(await step(tx, actor('super'), incident, 'NOTIFY_SUBJECTS')).toMatchObject({
          outcome: 'DONE',
          status: 'NOTIFIED',
        });
        expect((await step(tx, actor('super'), incident, 'NOTIFY_SUBJECTS')).outcome).toBe(
          'ALREADY_DONE',
        );
        // post-mortem : absent, inconnu ou hors des seaux de preuves ⇒ refus
        for (const f of [null, randomUUID(), await file(tx, 'KYC')]) {
          expect((await step(tx, actor('admin'), incident, 'CLOSE', f)).outcome, String(f)).toBe(
            'POSTMORTEM_REQUIRED',
          );
        }
        const postmortem = await file(tx, 'PRIVATE_EVIDENCE');
        expect(await step(tx, actor('admin'), incident, 'CLOSE', postmortem)).toMatchObject({
          outcome: 'DONE',
          status: 'CLOSED',
        });
        const row = await incidentOf(tx, incident);
        expect(row).toMatchObject({ status: 'CLOSED', postmortem_file_id: postmortem });
        expect(row.contained_at).not.toBeNull();
        expect(row.authority_notified_at).not.toBeNull();
        expect(row.subjects_notified_at).not.toBeNull();
        expect(row.closed_at).not.toBeNull();
        expect((await step(tx, actor('admin'), incident, 'NOTIFY_AUTHORITY')).outcome).toBe(
          'INCIDENT_CLOSED',
        );
        const steps = (await auditOf(tx, actor('admin').userId)).filter(
          (a) => a.action_code === 'SECURITY_INCIDENT_STEP' && a.subject_id === incident,
        );
        expect(steps.map((a) => a.after?.['step'])).toEqual(['NOTIFY_AUTHORITY', 'CLOSE']);
        // étape inconnue ou pièce hors clôture : 22023
        await tx.query('SAVEPOINT bad');
        await expect(step(tx, actor('admin'), incident, 'REOPEN')).rejects.toMatchObject({
          code: '22023',
        });
        await tx.query('ROLLBACK TO SAVEPOINT bad');
      });
    });

    it('sans donnée personnelle (qualifié) : clôture sans notification ; incident introuvable ⇒ FORBIDDEN', async () => {
      await withTestTransaction(api, {}, async (tx) => {
        const { incident_id: id } = await declare(tx, actor('admin'), {
          country: c.country,
          kind: 'AVAILABILITY',
          severity: 'MEDIUM',
          subjects: null,
        });
        const incident = id as string;
        expect((await step(tx, actor('admin'), incident, 'NO_PERSONAL_DATA')).outcome).toBe('DONE');
        expect((await step(tx, actor('admin'), incident, 'NO_PERSONAL_DATA')).outcome).toBe(
          'ALREADY_DONE',
        );
        expect((await step(tx, actor('ops'), incident, 'CONTAIN')).outcome).toBe('DONE');
        expect(
          await step(tx, actor('admin'), incident, 'CLOSE', await file(tx, 'DOCUMENTS')),
        ).toMatchObject({ outcome: 'DONE', status: 'CLOSED' });
        const row = await incidentOf(tx, incident);
        expect(row).toMatchObject({
          personal_data_involved: false,
          authority_notified_at: null,
          subjects_notified_at: null,
        });
        expect((await step(tx, actor('admin'), randomUUID(), 'CONTAIN')).outcome).toBe('FORBIDDEN');
      });
    });

    it('travailleur security_incident_watch : déclaration signalée une fois ; échéance dépassée sans notification signalée une fois (autorité, personnes) ; rien pour un incident sans donnée personnelle', async () => {
      // incidents VALIDÉS (le travailleur lit sous sa propre connexion) ; ses marques restent dans des
      // transactions annulées : chaque preuve ne lit que ses propres incidents
      const ids = await withTestTransaction(api, { commit: true }, async (tx) => {
        const now = await dbNow(tx);
        const late = await declare(tx, actor('admin'), {
          country: c.country,
          detectedAt: new Date(now.getTime() - (hoursOf(AUTHORITY, c.country) - 1) * HOUR_MS),
        });
        const none = await declare(tx, actor('admin'), {
          country: c.country,
          personalData: false,
          detectedAt: new Date(now.getTime() - 200 * HOUR_MS),
        });
        return { late: late.incident_id as string, none: none.incident_id as string, now };
      });
      const worker = await connectAs('app_worker');
      try {
        const watch = async (tx: pg.ClientBase) => {
          await tx.query(
            `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                  pg_catalog.set_config('app.worker_name', 'security_incident_watch', true)`,
          );
          const { rows } = await tx.query<{ signal: string; country_code: string; n: number }>(
            WATCH_SQL,
            [10000],
          );
          return rows;
        };
        const later = new Date(ids.now.getTime() + 2 * HOUR_MS).toISOString();
        await withTestTransaction(worker, { virtualNow: later }, async (tx) => {
          const first = await watch(tx);
          const signals = first.filter((r) => r.country_code === c.country).map((r) => r.signal);
          expect(signals).toEqual(
            expect.arrayContaining(['AUTHORITY_OVERDUE', 'OPENED', 'SUBJECTS_OVERDUE']),
          );
          const late = await incidentOf(tx, ids.late);
          expect(late.opened_alerted_at).not.toBeNull();
          expect(late.authority_overdue_alerted_at).not.toBeNull();
          expect(late.subjects_overdue_alerted_at).not.toBeNull();
          const none = await incidentOf(tx, ids.none);
          expect(none.opened_alerted_at).not.toBeNull();
          expect(none.authority_overdue_alerted_at).toBeNull();
          expect(none.subjects_overdue_alerted_at).toBeNull();
          // une fois : la passe suivante ne signale plus ces incidents
          await watch(tx);
          const again = await incidentOf(tx, ids.late);
          expect(again.authority_overdue_alerted_at?.getTime()).toBe(
            late.authority_overdue_alerted_at?.getTime(),
          );
        });
        // avant l'échéance : déclaration signalée, aucun retard
        await withTestTransaction(worker, {}, async (tx) => {
          await watch(tx);
          const late = await incidentOf(tx, ids.late);
          expect(late.opened_alerted_at).not.toBeNull();
          expect(late.authority_overdue_alerted_at).toBeNull();
          expect(late.subjects_overdue_alerted_at).toBeNull();
        });
        // autre nom de travailleur, ou lot invalide : refus
        await withTestTransaction(worker, {}, async (tx) => {
          await tx.query(
            `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                  pg_catalog.set_config('app.worker_name', 'ops_monitor', true)`,
          );
          await expect(tx.query(WATCH_SQL, [10])).rejects.toMatchObject({ code: '42501' });
        });
        await withTestTransaction(worker, {}, async (tx) => {
          await expect(watch(tx).then(() => tx.query(WATCH_SQL, [0]))).rejects.toMatchObject({
            code: '22023',
          });
        });
      } finally {
        await releaseClient(worker);
      }
    });
  },
);

describe('US-112 — registre en ajout seul, inaccessible aux rôles applicatifs', () => {
  it('garde : suppression, TRUNCATE, échéance ou détection réécrite, fait daté effacé, ligne close modifiée ⇒ 42501 (même sous migrator)', async () => {
    const country = ALL[0] as string;
    for (const what of ['delete', 'truncate', 'move_due', 'move_detected']) {
      await withTestTransaction(api, {}, async (tx) => {
        const { incident_id: id } = await declare(tx, actor('admin'), { country });
        await expect(
          tx.query('SELECT test_fixture.us112_tamper($1, $2)', [what, id]),
          what,
        ).rejects.toMatchObject({ code: '42501' });
      });
    }
    await withTestTransaction(api, {}, async (tx) => {
      const { incident_id: id } = await declare(tx, actor('admin'), { country });
      const incident = id as string;
      // une ligne ouverte se touche (contrôle positif de la fixture)
      await tx.query('SELECT test_fixture.us112_tamper($1, $2)', ['touch', incident]);
      await step(tx, actor('admin'), incident, 'NOTIFY_AUTHORITY');
      await tx.query('SAVEPOINT erase');
      await expect(
        tx.query('SELECT test_fixture.us112_tamper($1, $2)', ['erase_notice', incident]),
      ).rejects.toMatchObject({ code: '42501' });
      await tx.query('ROLLBACK TO SAVEPOINT erase');
      await step(tx, actor('admin'), incident, 'NOTIFY_SUBJECTS');
      await step(tx, actor('ops'), incident, 'CONTAIN');
      await step(tx, actor('admin'), incident, 'CLOSE', await file(tx, 'PRIVATE_EVIDENCE'));
      await expect(
        tx.query('SELECT test_fixture.us112_tamper($1, $2)', ['touch', incident]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('app_api, app_worker, app_anon : aucune lecture ni écriture de la table ; commandes réservées (app_api) et travailleur réservé (app_worker)', async () => {
    for (const role of ['app_api', 'app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        for (const sql of [
          'SELECT count(*) FROM core.audit_security_incident',
          `UPDATE core.audit_security_incident SET status = 'CLOSED'`,
          'DELETE FROM core.audit_security_incident',
        ]) {
          // transaction annulée à la main : app_anon n'exécute pas platform.now() (aide de test)
          await client.query('BEGIN');
          const error = await client.query(sql).then(
            () => null,
            (e: unknown) => e,
          );
          await client.query('ROLLBACK');
          expect(code(error), `${role} ${sql}`).toBe('42501');
        }
        const execute = async (fn: string): Promise<boolean> => {
          // lu sous app_api : app_anon n'a pas l'usage du schéma core (le nom ne s'y résout pas)
          const { rows } = await api.query<{ has: boolean }>(
            `SELECT pg_catalog.has_function_privilege($1, $2::regprocedure, 'EXECUTE') AS has`,
            [role, fn],
          );
          return rows[0]?.has === true;
        };
        expect(
          await execute(
            'core.security_incident_cmd_open(bytea,uuid,text,text,text,boolean,integer,timestamptz)',
          ),
        ).toBe(role === 'app_api');
        expect(await execute('core.security_incident_cmd_step(bytea,uuid,uuid,text,uuid)')).toBe(
          role === 'app_api',
        );
        expect(await execute('core.security_incident_worker_watch(integer)')).toBe(
          role === 'app_worker',
        );
      });
    }
  });
});
