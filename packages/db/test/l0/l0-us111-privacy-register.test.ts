/**
 * Preuves du registre Ley 81, des demandes des personnes et de la pseudonymisation des trips clos
 * (US-111, migrations 0089 et 0090 ; fixtures 9964, 9300, 9996) sous les rôles de production
 * app_api et app_worker (assertion L0-05 en tête de chaque connexion, withRole), au Panama (USD)
 * et au Paraguay (PYG), sous horloge virtuelle pour les échéances.
 *
 * Attendus tirés de 19 US-111 (trois critères), de 16 LEG-009 / LEG-010 (« registre validé → KYC
 * activé », « tâche de purge → pseudonymisation tracée », « dossier en litige → gel de la purge »),
 * de 17 §3.1.3 classe E (pseudonymisation des colonnes C2, lignes comptables conservées), §3.2.13
 * (`data_subject_request` : délai et statuts ; `subprocessor` : inscrit avant la première collecte),
 * §7.2 (`evidence_retention_months` ≥ 15 mois après la dernière opération monétaire,
 * REQ-PAY-DMG-11), de 17 §10 (HANDLE_DSR : permission `data.export`, ADMIN) et d'ADR-118 ; les
 * durées sont lues dans les DONNÉES de configuration (params.json), jamais dans le code testé.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { one, opened, person, staff, uuid } from '../support/kyc.ts';
import type { Staff } from '../support/kyc.ts';
import { auditOf } from '../support/staff.ts';

const byCountry = COUNTRIES.map((c) => [c.country, c.currency, c] as const);
const BLOCKED = 'KYC_PRODUCTION_BLOCKED_NO_REGISTER';
const REASON = 'Demande reçue par e-mail, identité à vérifier';

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
const paramOf = (key: string, country: string): number => {
  const v = PARAMS.find((p) => p.key === key)?.values[country];
  if (typeof v !== 'number') throw new Error(`${key} sans valeur pour ${country}`);
  return v;
};

const worker = async <T>(
  c: pg.ClientBase,
  virtualNow: string,
  fn: (tx: pg.ClientBase) => Promise<T>,
  name = 'privacy_request',
): Promise<T> =>
  withTestTransaction(c, { virtualNow }, async (tx) => {
    await tx.query(
      `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
              pg_catalog.set_config('app.worker_name', $1, true)`,
      [name],
    );
    return fn(tx);
  });

const setNow = (tx: pg.ClientBase, at: string) =>
  tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [at]);

const sweep = async (tx: pg.ClientBase): Promise<number> =>
  (await one<{ n: number }>(tx, 'SELECT core.privacy_worker_retention_sweep($1) AS n', [10000])).n;

const tripOf = (tx: pg.ClientBase, id: string) =>
  one<{
    status: string;
    termination_reason: string | null;
    cancellation_reason: string | null;
    currency: string;
  }>(tx, 'SELECT * FROM test_fixture.us111_trip($1)', [id]);

const logOf = async (tx: pg.ClientBase, id: string) =>
  (await tx.query('SELECT * FROM test_fixture.us111_retention_log($1)', [id])).rows;

/** Trip réservé (fixture d'US-011), du 1er au 4 août 2031 à 10:00 UTC. */
const TRIP_END = '2031-08-04T10:00:00Z';
async function closedTrip(
  tx: pg.ClientBase,
  c: CountryCase,
  status: string,
  termination: string | null,
  cancellation: string | null,
): Promise<string> {
  const id = uuid();
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    id,
    uuid(),
    uuid(),
    uuid(),
    c.country,
    c.currency,
    c.timezone,
    '2031-08-01T10:00:00Z',
    TRIP_END,
  ]);
  await tx.query('SELECT test_fixture.us111_close_trip($1, $2, $3, $4)', [
    id,
    status,
    termination,
    cancellation,
  ]);
  return id;
}

/** Instant ISO à `months` mois et `minutes` minutes de `base` (calendrier UTC). */
function plus(base: string, months: number, minutes = 0): string {
  const d = new Date(base);
  d.setUTCMonth(d.getUTCMonth() + months);
  return new Date(d.getTime() + minutes * 60_000).toISOString();
}

describe('US-111 critère 1 — KYC de production sans registre validé', () => {
  it('hors production (base de test) : aucune garde, quel que soit le pays', async () => {
    await withRole('app_api', async (c) => {
      for (const { country } of COUNTRIES) {
        expect(
          await one(c, 'SELECT core.privacy_kyc_register_gate($1) AS code', [country]),
        ).toEqual({
          code: null,
        });
      }
      await expect(
        c.query('SELECT core.privacy_kyc_register_gate($1)', ['p1']),
      ).rejects.toMatchObject({ code: '22023' });
    });
  });

  it.each(byCountry)(
    '%s (%s) : production (et environnement inconnu) sans registre validé ⇒ KYC_PRODUCTION_BLOCKED_NO_REGISTER ; registre validé sans fournisseur contractuel ⇒ toujours refusé ; registre et fournisseur ⇒ levée pour ce pays seulement',
    async (country) => {
      const other = COUNTRIES.find((x) => x.country !== country)?.country ?? '';
      await withRole('app_api', async (c) => {
        // '__null__' : environnement non déclaré (fixture 9880), lu comme la production (L1-PM-05)
        for (const env of ['production', '__null__']) {
          await withTestTransaction(c, {}, async (tx) => {
            await tx.query(`SELECT pg_catalog.set_config('app.test_deployment_env', $1, true)`, [
              env,
            ]);
            const gate = async (k: string) =>
              (
                await one<{ code: string | null }>(
                  tx,
                  'SELECT core.privacy_kyc_register_gate($1) AS code',
                  [k],
                )
              ).code;
            expect(await gate(country)).toBe(BLOCKED);
            expect(await gate(other)).toBe(BLOCKED);
            await tx.query('SELECT test_fixture.us111_validate_register($1, false)', [country]);
            expect(await gate(country)).toBe(BLOCKED);
            await tx.query('SELECT test_fixture.us111_validate_register($1, true)', [country]);
            // le registre validé reste un paramètre PAR PAYS : l'autre pays reste fermé
            expect(await gate(country)).toBeNull();
            expect(await gate(other)).toBe(BLOCKED);
          });
        }
      });
    },
  );
});

describe('US-111 — registre des sous-traitants, des traitements et des règles de rétention', () => {
  it('sous-traitants du brief tous inscrits, aucun contractuel ; traitements et règles cohérents ; lectures interdites aux rôles applicatifs', async () => {
    await withRole('app_api', async (c) => {
      const reg = (
        await one<{
          r: {
            subprocessors: { code: string; service: string; mode: string; contract_ref: null }[];
            activities: {
              code: string;
              legal_basis: string;
              sensitive: boolean;
              recipients: string[];
              subprocessors: string[];
              retention_rules: string[];
              collected_in_beta: boolean;
            }[];
            rules: { code: string; param_key: string; action: string }[];
          };
        }>(c, 'SELECT test_fixture.us111_register() AS r', [])
      ).r;
      // KYC, SMS, e-mail, antivirus ClamAV auto-hébergé (DEC-FONDATEUR-20), hébergeur (US-003), PSP
      expect(reg.subprocessors.map((s) => [s.service, s.mode]).sort()).toEqual(
        [
          ['ANTIVIRUS', 'SELF_HOSTED'],
          ['EMAIL', 'SIMULATED'],
          ['HOSTING', 'PLANNED'],
          ['KYC', 'SIMULATED'],
          ['PSP', 'SIMULATED'],
          ['SMS', 'SIMULATED'],
        ].sort(),
      );
      expect(reg.subprocessors.every((s) => s.contract_ref === null)).toBe(true);
      const codes = new Set(reg.subprocessors.map((s) => s.code));
      const rules = new Set(reg.rules.map((r) => r.code));
      for (const a of reg.activities) {
        for (const s of a.subprocessors) expect(codes.has(s), `${a.code} ${s}`).toBe(true);
        for (const r of a.retention_rules) expect(rules.has(r), `${a.code} ${r}`).toBe(true);
        // donnée sensible (biométrie) : consentement exprès (VER-004, OQ-MK-09)
        if (a.sensitive) expect(a.legal_basis).toBe('CONSENT');
      }
      expect(reg.activities.find((a) => a.code === 'IDENTITY_BIOMETRICS')?.sensitive).toBe(true);
      // UXQ-11 : coordonnées bancaires jamais visibles de l'hôte, non collectées en Bêta
      expect(reg.activities.find((a) => a.code === 'REFUND_BANK_TRANSFER')).toMatchObject({
        collected_in_beta: false,
      });
      expect(
        reg.activities.find((a) => a.code === 'REFUND_BANK_TRANSFER')?.recipients,
      ).not.toContain('HOST');
      // trips clos : durée = evidence_retention_months (17 §7.2, ≥ 15 mois), pseudonymisation
      expect(reg.rules.find((r) => r.code === 'TRIP_CLOSED')).toMatchObject({
        param_key: 'evidence_retention_months',
        action: 'PSEUDONYMISATION',
      });
      expect(reg.rules.find((r) => r.code === 'VEHICLE_ATTESTATION')).toMatchObject({
        param_key: 'privacy_vehicle_attestation_retention_months',
        action: 'KEEP',
      });
      for (const t of [
        'audit_subprocessor',
        'audit_processing_activity',
        'audit_retention_rule',
        'audit_data_subject_request',
        'audit_retention_log',
      ]) {
        await expect(c.query(`SELECT 1 FROM core.${t} LIMIT 1`), t).rejects.toMatchObject({
          code: '42501',
        });
      }
    });
    await withRole('app_worker', async (c) => {
      await expect(c.query('SELECT 1 FROM core.audit_retention_log LIMIT 1')).rejects.toMatchObject(
        { code: '42501' },
      );
    });
  });
});

describe('US-111 critère 2 — trip clos sans litige : pseudonymisation et purge journalisée', () => {
  it.each(byCountry)(
    '%s (%s) : avant l’échéance rien ; à l’échéance motifs remplacés par un marqueur, une ligne au journal, devise et statut conservés ; jamais deux fois ; litige jamais ; opération monétaire plus tardive : échéance repoussée',
    async (country, currency, c) => {
      const months = paramOf('evidence_retention_months', country);
      // 17 §7.2, REQ-PAY-DMG-11 : au moins 15 mois après la dernière opération monétaire
      expect(months).toBeGreaterThanOrEqual(15);
      await withRole('app_worker', async (w) => {
        const closedAt = plus(TRIP_END, 0, 60);
        await worker(w, closedAt, async (tx) => {
          const done = await closedTrip(tx, c, 'COMPLETED', null, null);
          const cancelled = await closedTrip(
            tx,
            c,
            'CANCELLED_BY_GUEST',
            null,
            'GUEST_CHANGED_PLANS',
          );
          const disputed = await closedTrip(tx, c, 'IN_DISPUTE', null, 'GUEST_CHANGED_PLANS');
          const paidLate = await closedTrip(tx, c, 'CANCELLED_BY_HOST', null, 'HOST_UNAVAILABLE');
          // opération de loyer mise à jour quatre mois après la fin du trip
          const lateOp = plus(TRIP_END, 4);
          await setNow(tx, lateOp);
          await tx.query('SELECT test_fixture.rls_insert_trip_operation($1, $2, $3)', [
            uuid(),
            paidLate,
            c.rentMinor,
          ]);

          // une minute avant l'échéance (dernière date du trip + durée du pays) : rien
          await setNow(tx, plus(closedAt, months, -1));
          await sweep(tx);
          for (const id of [done, cancelled, disputed, paidLate]) {
            expect(await logOf(tx, id), id).toEqual([]);
          }
          expect(await tripOf(tx, cancelled)).toMatchObject({
            cancellation_reason: 'GUEST_CHANGED_PLANS',
          });

          // à l'échéance : pseudonymisés et journalisés une fois
          const due = plus(closedAt, months);
          await setNow(tx, plus(closedAt, months, 1));
          expect(await sweep(tx)).toBeGreaterThanOrEqual(2);
          expect(await tripOf(tx, cancelled)).toEqual({
            status: 'CANCELLED_BY_GUEST',
            termination_reason: null,
            cancellation_reason: 'PSEUDONYMISED',
            guest_user_id: expect.any(String) as string,
            currency,
          });
          expect(await logOf(tx, cancelled)).toEqual([
            {
              rule_code: 'TRIP_CLOSED',
              subject_type: 'TRIP',
              country_code: country,
              action: 'PSEUDONYMISATION',
              columns: ['cancellation_reason'],
              due_at: new Date(due),
              at: new Date(plus(closedAt, months, 1)),
            },
          ]);
          // rien à remplacer : le trip est quand même traité, une fois
          expect(await logOf(tx, done)).toMatchObject([{ columns: [] }]);
          // litige : gel de la purge (16 LEG-009, parcours alternatif)
          expect(await logOf(tx, disputed)).toEqual([]);
          expect(await tripOf(tx, disputed)).toMatchObject({
            cancellation_reason: 'GUEST_CHANGED_PLANS',
          });
          // dernière opération monétaire plus tardive : pas encore
          expect(await logOf(tx, paidLate)).toEqual([]);

          // seconde passe : aucune nouvelle ligne
          await sweep(tx);
          expect(await logOf(tx, cancelled)).toHaveLength(1);

          // à l'échéance de l'opération tardive : traité
          await setNow(tx, plus(lateOp, months, 1));
          await sweep(tx);
          expect(await logOf(tx, paidLate)).toMatchObject([
            { columns: ['cancellation_reason'], due_at: new Date(plus(lateOp, months)) },
          ]);
          // journal en ajout seul
          expect(
            await one(tx, 'SELECT test_fixture.us111_tamper_log($1, $2) AS r', [
              cancelled,
              'UPDATE',
            ]),
          ).toEqual({ r: '42501' });
          expect(
            await one(tx, 'SELECT test_fixture.us111_tamper_log($1, $2) AS r', [
              cancelled,
              'DELETE',
            ]),
          ).toEqual({ r: '42501' });
        });
      });
    },
  );

  it('réservé au travailleur privacy_request ; app_api sans droit ; lot borné', async () => {
    await withRole('app_worker', async (w) => {
      await worker(
        w,
        '2033-01-01T00:00:00Z',
        async (tx) => {
          await expect(sweep(tx)).rejects.toMatchObject({ code: '42501' });
        },
        'trip_lifecycle',
      );
      await worker(w, '2033-01-01T00:00:00Z', async (tx) => {
        await expect(
          tx.query('SELECT core.privacy_worker_retention_sweep($1)', [0]),
        ).rejects.toMatchObject({ code: '22023' });
      });
    });
    await withRole('app_api', async (c) => {
      await expect(
        c.query('SELECT core.privacy_worker_retention_sweep($1)', [10]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});

const handle = (
  c: pg.ClientBase,
  s: Staff,
  caseId: string,
  input: Record<string, string>,
  requestId = uuid(),
) =>
  one<{
    outcome: string;
    action_id: string | null;
    domain_ref: string | null;
    detail: string | null;
  }>(
    c,
    'SELECT * FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, $6::jsonb, $7::uuid[])',
    [s.hash, requestId, 'HANDLE_DSR', caseId, REASON, JSON.stringify(input), []],
  );

interface DsrRow {
  readonly id: string;
  readonly user_id: string | null;
  readonly country_code: string;
  readonly kind: string;
  readonly status: string;
  readonly received_at: Date;
  readonly due_at: Date;
  readonly identity_verified_at: Date | null;
  readonly closed_at: Date | null;
  readonly handled_by: string;
  readonly overdue_alerted_at: Date | null;
}
const dsrOf = async (c: pg.ClientBase, caseId: string): Promise<DsrRow[]> =>
  (await c.query<DsrRow>('SELECT * FROM test_fixture.us111_dsr($1)', [caseId])).rows;

describe('US-111 critère 3 — demande de personne saisie par HANDLE_DSR : délai et traitement suivis', () => {
  it.each(byCountry)(
    '%s (%s) : RECEIVED ⇒ demande et échéance (privacy_dsr_response_days) ; étapes jusqu’à DONE journalisées ; transitions et saisies invalides refusées sans écriture ; retard signalé une fois',
    async (country) => {
      const days = paramOf('privacy_dsr_response_days', country);
      const dsrId = await withRole('app_api', async (c) => {
        const requester = await person(c, country);
        const admin = await staff(c, 'ADMIN', [country], country);
        const caseId = (
          await one<{ id: string }>(c, 'SELECT test_fixture.us111_support_case($1, $2) AS id', [
            country,
            requester.userId,
          ])
        ).id;

        // étape sans demande ouverte, saisie incomplète : refus métier, rien d'écrit
        expect(await handle(c, admin, caseId, { step: 'IN_PROGRESS' })).toMatchObject({
          outcome: 'REFUSED',
          detail: 'DSR_NOT_OPEN',
        });
        expect(await handle(c, admin, caseId, { step: 'RECEIVED' })).toMatchObject({
          outcome: 'REFUSED',
          detail: 'DSR_INPUT_REQUIRED',
        });
        expect(await handle(c, admin, caseId, { kind: 'ACCESS' })).toMatchObject({
          outcome: 'REFUSED',
          detail: 'DSR_INPUT_REQUIRED',
        });
        // valeur hors énumération fermée : refusée par le cadre (22023)
        await expect(
          handle(c, admin, caseId, { kind: 'ERASE_EVERYTHING', step: 'RECEIVED' }),
        ).rejects.toMatchObject({ code: '22023' });
        expect(await dsrOf(c, caseId)).toEqual([]);

        // un OPS_AGENT n'a pas data.export (17 §2.3) : refusé et journalisé
        const ops = await staff(c, 'OPS_AGENT', [country], country);
        expect((await handle(c, ops, caseId, { kind: 'ACCESS', step: 'RECEIVED' })).outcome).toBe(
          'FORBIDDEN',
        );

        const received = await handle(c, admin, caseId, { kind: 'DELETION', step: 'RECEIVED' });
        expect(received).toMatchObject({ outcome: 'DONE', domain_ref: expect.any(String) });
        const [dsr] = await dsrOf(c, caseId);
        expect(dsr).toMatchObject({
          id: received.domain_ref,
          user_id: requester.userId,
          country_code: country,
          kind: 'DELETION',
          status: 'RECEIVED',
          identity_verified_at: null,
          closed_at: null,
          handled_by: admin.userId,
          overdue_alerted_at: null,
        });
        expect((dsr?.due_at.getTime() ?? 0) - (dsr?.received_at.getTime() ?? 0)).toBe(
          days * 86_400_000,
        );
        expect((await auditOf(c, admin.userId)).at(-1)).toMatchObject({
          action_code: 'MANUAL_ACTION_DONE',
          subject_type: 'SUPPORT_CASE',
          subject_id: caseId,
          after: { action: 'HANDLE_DSR', mode: 'DOMAIN_COMMAND', country, outcome: 'DONE' },
        });

        // une demande par dossier ; type constant ; machine d'états fermée
        expect(await handle(c, admin, caseId, { kind: 'ACCESS', step: 'RECEIVED' })).toMatchObject({
          outcome: 'REFUSED',
          detail: 'DSR_ALREADY_OPEN',
        });
        expect(await handle(c, admin, caseId, { kind: 'ACCESS', step: 'VERIFYING' })).toMatchObject(
          { outcome: 'REFUSED', detail: 'DSR_KIND_MISMATCH' },
        );
        expect(await handle(c, admin, caseId, { step: 'DONE' })).toMatchObject({
          outcome: 'REFUSED',
          detail: 'DSR_TRANSITION_INVALID',
        });
        expect((await dsrOf(c, caseId))[0]?.status).toBe('RECEIVED');

        expect((await handle(c, admin, caseId, { step: 'VERIFYING' })).outcome).toBe('DONE');
        expect((await handle(c, admin, caseId, { step: 'IN_PROGRESS' })).outcome).toBe('DONE');
        expect((await dsrOf(c, caseId))[0]).toMatchObject({
          status: 'IN_PROGRESS',
          identity_verified_at: expect.any(Date),
          closed_at: null,
        });
        return { caseId, dsrId: dsr?.id ?? '', due: dsr?.due_at ?? new Date(0), admin };
      });

      // retard : signalé UNE fois, compté dans le pays de la demande
      await withRole('app_worker', async (w) => {
        const late = new Date(dsrId.due.getTime() + 60_000).toISOString();
        await worker(w, late, async (tx) => {
          const first = (
            await tx.query<{ country_code: string; overdue: number }>(
              'SELECT * FROM core.privacy_worker_dsr_overdue($1)',
              [10000],
            )
          ).rows;
          expect(first.find((r) => r.country_code === country)?.overdue).toBeGreaterThanOrEqual(1);
          expect((await dsrOf(tx, dsrId.caseId))[0]?.overdue_alerted_at).toEqual(new Date(late));
          const second = (
            await tx.query<{ country_code: string; overdue: number }>(
              'SELECT * FROM core.privacy_worker_dsr_overdue($1)',
              [10000],
            )
          ).rows;
          expect(second).toEqual([]);
        });
        // avant l'échéance : rien
        await worker(w, new Date(dsrId.due.getTime() - 60_000).toISOString(), async (tx) => {
          await tx.query('SELECT * FROM core.privacy_worker_dsr_overdue($1)', [10000]);
          expect((await dsrOf(tx, dsrId.caseId))[0]?.overdue_alerted_at).toBeNull();
        });
      });

      // clôture : DONE puis plus rien ne bouge
      await withRole('app_api', async (c) => {
        expect((await handle(c, dsrId.admin, dsrId.caseId, { step: 'DONE' })).outcome).toBe('DONE');
        expect((await dsrOf(c, dsrId.caseId))[0]).toMatchObject({
          status: 'DONE',
          closed_at: expect.any(Date),
        });
        expect(await handle(c, dsrId.admin, dsrId.caseId, { step: 'REJECTED' })).toMatchObject({
          outcome: 'REFUSED',
          detail: 'DSR_TRANSITION_INVALID',
        });
      });
    },
  );
});

describe('US-111 — reprise des demandes d’effacement KYC en attente ou en échec (US-105, US-106)', () => {
  it.each(byCountry)(
    '%s (%s) : PENDING au-delà du délai et FAILED comptés ; PENDING récent non compté',
    async (country) => {
      const p = await withRole('app_api', (c) => opened(c, country));
      await withRole('app_worker', async (w) => {
        await worker(w, new Date().toISOString(), async (tx) => {
          const count = async () =>
            (
              await one<{ n: number }>(
                tx,
                'SELECT core.privacy_worker_stale_kyc_erasures($1) AS n',
                [60],
              )
            ).n;
          const before = await count();
          const old = new Date(Date.now() - 2 * 3_600_000).toISOString();
          await tx.query('SELECT test_fixture.us111_set_erasure($1, $2, $3)', [
            p.userId,
            'PENDING',
            old,
          ]);
          await tx.query('SELECT test_fixture.us111_set_erasure($1, $2, $3)', [
            p.userId,
            'FAILED',
            old,
          ]);
          await tx.query('SELECT test_fixture.us111_set_erasure($1, $2, $3)', [
            p.userId,
            'PENDING',
            new Date().toISOString(),
          ]);
          expect(await count()).toBe(before + 2);
        });
      });
    },
  );
});
