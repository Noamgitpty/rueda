/**
 * Preuves de la décision KYC de la Bêta par l'ops (US-106, migration 0076 ; fixtures 9984, 9996,
 * 9990, 9960) sous les rôles de production app_api et app_worker (assertion L0-05 en tête de
 * chaque connexion, withRole), au Panama (USD) et au Paraguay (PYG). Chaque test crée ses propres
 * personnes (vraies commandes d'US-105 jusqu'à `MANUAL_REVIEW`) et ses membres du staff (élévation
 * TOTP réelle).
 *
 * Attendus tirés de 19 US-106, de 16 ADM-002 (file KYC, SLA 4 h ouvrées, « SLA dépassé ⇒ alerte »,
 * « décision : motif et auteur au journal »), VER-002 / VER-003 (« score sous le seuil ⇒
 * MANUAL_REVIEW, décision ops motivée et journalisée »), VER-004 (retrait du consentement),
 * VER-006 (« permis provisoire ⇒ refus motivé »), ACC-014 (comptes liés repérés à la revue), de 08
 * BR-VERIF-02 (IDP seul refusé), SM-3 (MANUAL_REVIEW → APPROVED | REJECTED | MORE_INFO_REQUIRED),
 * de 17 §2.3 (`kyc.decide` : OPS_AGENT et ADMIN ; FINANCE et SUPPORT : non), §4.5
 * (`kyc.verification.status_changed` : user_id, from, to, reason_code), §7.2
 * (`kyc_review_sla_business_h` = 4) et de 22 OQ-BR-21 (défaut : IDP et permis non définitifs en
 * revue, jamais approuvés), jamais du code testé :
 * - critère 1 : motif, auteur et contrôles cochés (liveness, pièce, liste des permis, doublons)
 *   journalisés ;
 * - critère 2 : dossier entré à 09:00 un jour ouvré, aucune décision à 13:00 ⇒ alerte ;
 * - jamais une décision qui contredit un retrait du consentement biométrique ;
 * - consultation minimale, journalisée, limitée à l'élément de file pris en charge.
 */
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import {
  checks,
  claim,
  decide,
  elevateAs,
  isoDay,
  itemsOf,
  licence,
  one,
  staff,
  toReview,
  utcOffsetMinutes,
  uuid,
} from '../support/kyc.ts';
import type { Staff } from '../support/kyc.ts';
import { auditOf } from '../support/staff.ts';

const ALL = COUNTRIES.map((c) => c.country);
const byCountry = COUNTRIES.map((c) => [c.country, c.currency] as const);
const otherOf = (country: string): string => ALL.find((x) => x !== country) ?? '';
const PURPOSE = 'Instruction du dossier KYC assigné';
const REASON = 'Contrôles faits dans le portail du fournisseur';
/** 17 §7.2 `kyc_review_sla_business_h` = 4 h (16 ADM-002, M2), en minutes. */
const KYC_SLA_MINUTES = 240;

const fixture = async <T extends pg.QueryResultRow>(c: pg.ClientBase, fn: string, arg: unknown) =>
  (await c.query<T>(`SELECT * FROM test_fixture.${fn}($1)`, [arg])).rows;

const dossier = (c: pg.ClientBase, s: Staff, itemId: string) =>
  one<{ outcome: string; body: Record<string, unknown> | null }>(
    c,
    'SELECT * FROM core.support_staff_kyc_dossier($1, $2, $3, $4)',
    [s.hash, uuid(), itemId, PURPOSE],
  );

const eligibility = (c: pg.ClientBase, token: Buffer, country: string) =>
  one<{ outcome: string }>(c, 'SELECT * FROM core.kyc_driver_eligibility($1, $2, $3)', [
    token,
    new Date(Date.now() + 3 * 86_400_000).toISOString(),
    country,
  ]);

interface VerificationRow {
  readonly id: string;
  readonly status: string;
  readonly decision_reason_code: string | null;
  readonly reviewed_by: string | null;
  readonly approved: boolean;
  readonly attempt: number;
}
const verification = async (c: pg.ClientBase, userId: string): Promise<VerificationRow> =>
  (
    await fixture<VerificationRow & pg.QueryResultRow>(c, 'us106_verification', userId)
  )[0] as VerificationRow;

/** Personne en revue dont l'élément KYC est pris en charge par un OPS_AGENT du pays. */
async function claimed(
  c: pg.ClientBase,
  country: string,
  options: Parameters<typeof toReview>[2] = {},
) {
  const r = await toReview(c, country, options);
  const [item] = await itemsOf(c, r.userId);
  if (item === undefined) throw new Error('aucun élément KYC');
  const ops = await staff(c, 'OPS_AGENT', [country], country);
  expect((await claim(c, ops, item.id)).outcome).toBe('CLAIMED');
  return { r, item, ops };
}

/** Rien n'a bougé : dossier en revue sans auteur, élément pris en charge, aucun événement de plus. */
async function untouched(
  c: pg.ClientBase,
  userId: string,
  verificationId: string,
  events: number,
): Promise<void> {
  expect(await verification(c, userId)).toMatchObject({
    status: 'MANUAL_REVIEW',
    reviewed_by: null,
    approved: false,
  });
  expect(await itemsOf(c, userId)).toMatchObject([{ status: 'IN_REVIEW', decision: null }]);
  expect(await fixture(c, 'us105_events', verificationId)).toHaveLength(events);
  expect(await fixture(c, 'us105_documents', userId)).toMatchObject([{ status: 'IN_REVIEW' }]);
}

describe('US-106 — mise en file et décision APPROVED (critère 1)', () => {
  it.each(byCountry)(
    '%s (%s) : MANUAL_REVIEW ⇒ un élément KYC (pays de la personne, 4 h) ; dossier minimal journalisé ; APPROVED ⇒ motif, auteur et contrôles au journal, élément clos, événement, paiement éligible',
    async (country) => {
      await withRole('app_api', async (c) => {
        const r = await toReview(c, country);
        expect(await verification(c, r.userId)).toMatchObject({
          id: r.verificationId,
          status: 'MANUAL_REVIEW',
          decision_reason_code: 'PROVIDER_REVIEW',
        });
        const items = await itemsOf(c, r.userId);
        expect(items).toEqual([
          {
            id: expect.any(String) as string,
            status: 'OPEN',
            decision: null,
            assignee_id: null,
            country_code: country,
            sla_minutes: KYC_SLA_MINUTES,
            breached: false,
          },
        ]);
        const item = items[0]?.id ?? '';
        const ops = await staff(c, 'OPS_AGENT', [country], country);
        expect((await claim(c, ops, item)).outcome).toBe('CLAIMED');

        // consultation minimale (17 §1.5 point 3, 16 VER-002 / VER-003 : scores seulement)
        const d = await dossier(c, ops, item);
        expect(d.outcome).toBe('GRANTED');
        expect(d.body).toMatchObject({
          kycStatus: 'MANUAL_REVIEW',
          verification: {
            id: r.verificationId,
            status: 'MANUAL_REVIEW',
            reasonCode: 'PROVIDER_REVIEW',
            attempt: 1,
            country,
            consentCurrent: true,
            document: {
              type: 'DRIVER_LICENSE',
              issuingCountry: country,
              expiresOn: isoDay(400),
              licenseClass: 'B',
              permanent: true,
              status: 'IN_REVIEW',
            },
            liveness: {
              result: 'REVIEW',
              livenessScore: 0.4211,
              faceMatchScore: 0.8875,
              erased: false,
            },
          },
        });
        // aucune image, aucune référence chez le fournisseur (session, document)
        expect(JSON.stringify(d.body)).not.toMatch(/fk_idv_|"doc_|https:|selfie|image|file/i);
        expect((await auditOf(c, ops.userId)).at(-1)).toMatchObject({
          action_code: 'STAFF_DATA_ACCESS',
          after: { access_kind: 'READ_C3', field_or_file: 'kyc_dossier' },
        });

        const eventsBefore = (await fixture(c, 'us105_events', r.verificationId)).length;
        const input = checks('APPROVED');
        const res = await decide(c, ops, r.verificationId, input, REASON);
        expect(res).toMatchObject({ outcome: 'DONE', domain_ref: r.verificationId, detail: null });

        expect(await verification(c, r.userId)).toMatchObject({
          status: 'APPROVED',
          decision_reason_code: null,
          reviewed_by: ops.userId,
          approved: true,
          attempt: 1,
        });
        expect(await fixture(c, 'us105_documents', r.userId)).toMatchObject([
          { doc_type: 'DRIVER_LICENSE', status: 'ACCEPTED' },
        ]);
        expect(await itemsOf(c, r.userId)).toMatchObject([
          { id: item, status: 'DONE', decision: 'APPROVED', assignee_id: ops.userId },
        ]);
        const events = await fixture<{
          actor_role: string;
          actor_user_id: string;
          country_code: string;
          payload: Record<string, unknown>;
        }>(c, 'us105_events', r.verificationId);
        expect(events).toHaveLength(eventsBefore + 1);
        expect(events.at(-1)).toMatchObject({
          type: 'kyc.verification.status_changed',
          actor_role: 'OPS_AGENT',
          actor_user_id: ops.userId,
          country_code: country,
          payload: { user_id: r.userId, from: 'MANUAL_REVIEW', to: 'APPROVED', reason_code: null },
        });
        // journal : la ligne manual_action porte le motif, l'auteur et les contrôles cochés
        expect(await fixture(c, 'us101_manual_action', res.action_id)).toEqual([
          {
            action_code: 'KYC_DECISION',
            mode: 'DOMAIN_COMMAND',
            country_code: country,
            actor_role: 'OPS_AGENT',
            outcome: 'DONE',
            domain_ref: r.verificationId,
            input,
            evidence_file_ids: [],
            emitted_event_ids: [expect.any(String) as string],
            audit_log_id: expect.any(String) as string,
          },
        ]);
        expect((await auditOf(c, ops.userId)).at(-1)).toMatchObject({
          action_code: 'MANUAL_ACTION_DONE',
          subject_type: 'IDENTITY_VERIFICATION',
          subject_id: r.verificationId,
          reason: REASON,
          after: { action: 'KYC_DECISION', outcome: 'DONE', country },
        });
        // seules des personnes vérifiées réservent : le paiement devient éligible
        expect((await eligibility(c, r.token, country)).outcome).toBe('ELIGIBLE');
        // rejeu de la décision : DUPLICATE, rien de plus
        expect(
          (await decide(c, ops, r.verificationId, input, REASON, res.action_id ?? '')).outcome,
        ).toBe('DUPLICATE');
        expect(await fixture(c, 'us105_events', r.verificationId)).toHaveLength(eventsBefore + 1);
      });
    },
  );
});

describe('US-106 — REJECTED et MORE_INFO_REQUIRED (SM-3)', () => {
  it.each(byCountry)(
    '%s (%s) : REJECTED ⇒ motif = premier contrôle en échec, paiement refusé ; MORE_INFO_REQUIRED ⇒ nouvelle session admise',
    async (country) => {
      await withRole('app_api', async (c) => {
        const a = await claimed(c, country);
        expect(
          (await decide(c, a.ops, a.r.verificationId, checks('REJECTED', ['livenessCheck'])))
            .outcome,
        ).toBe('DONE');
        expect(await verification(c, a.r.userId)).toMatchObject({
          status: 'REJECTED',
          decision_reason_code: 'LIVENESS_FAILED',
          reviewed_by: a.ops.userId,
          approved: false,
        });
        expect(await itemsOf(c, a.r.userId)).toMatchObject([
          { status: 'DONE', decision: 'REJECTED' },
        ]);
        expect(
          (
            await fixture<{ payload: Record<string, unknown> }>(
              c,
              'us105_events',
              a.r.verificationId,
            )
          ).at(-1)?.payload,
        ).toEqual({
          user_id: a.r.userId,
          from: 'MANUAL_REVIEW',
          to: 'REJECTED',
          reason_code: 'LIVENESS_FAILED',
        });
        expect((await eligibility(c, a.r.token, country)).outcome).toBe('KYC_NOT_APPROVED');
        expect(await fixture(c, 'us105_documents', a.r.userId)).toMatchObject([
          { status: 'IN_REVIEW' },
        ]);

        // ordre des catégories : liveness, pièce, liste des permis, doublons
        const b = await claimed(c, country);
        expect(
          (
            await decide(
              c,
              b.ops,
              b.r.verificationId,
              checks('REJECTED', ['duplicateCheck', 'licenseListCheck']),
            )
          ).outcome,
        ).toBe('DONE');
        expect((await verification(c, b.r.userId)).decision_reason_code).toBe(
          'LICENSE_NOT_ACCEPTED',
        );
        const dup = await claimed(c, country);
        await decide(c, dup.ops, dup.r.verificationId, checks('REJECTED', ['duplicateCheck']));
        expect((await verification(c, dup.r.userId)).decision_reason_code).toBe(
          'DUPLICATE_ACCOUNT',
        );

        const m = await claimed(c, country);
        expect(
          (
            await decide(
              c,
              m.ops,
              m.r.verificationId,
              checks('MORE_INFO_REQUIRED', ['idDocumentCheck']),
            )
          ).outcome,
        ).toBe('DONE');
        expect(await verification(c, m.r.userId)).toMatchObject({
          status: 'MORE_INFO_REQUIRED',
          decision_reason_code: 'ID_DOCUMENT_REFUSED',
        });
        expect(await itemsOf(c, m.r.userId)).toMatchObject([
          { status: 'DONE', decision: 'MORE_INFO_REQUIRED' },
        ]);
        // la personne relance une session (tentative suivante, 16 VER-005)
        expect(
          await one(c, 'SELECT outcome, attempt FROM core.kyc_cmd_open_verification($1, $2, $3)', [
            m.r.token,
            country,
            'FAKE',
          ]),
        ).toEqual({ outcome: 'READY', attempt: 2 });
        expect((await eligibility(c, m.r.token, country)).outcome).toBe('KYC_NOT_APPROVED');
      });
    },
  );
});

describe('US-106 — refus de la commande : rien n’est écrit', () => {
  it.each(byCountry)(
    '%s (%s) : contrôle manquant, contrôles incohérents, élément non pris en charge ou pris par un autre ⇒ REFUSED journalisé ; saisie hors énumération ou motif court ⇒ 22023 ; FINANCE, SUPPORT, autre pays ⇒ FORBIDDEN',
    async (country) => {
      await withRole('app_api', async (c) => {
        const { r, ops } = await claimed(c, country);
        const events = (await fixture(c, 'us105_events', r.verificationId)).length;
        const partial = checks('APPROVED') as Record<string, string>;
        delete partial['duplicateCheck'];
        const cases: [Record<string, string>, string][] = [
          [partial, 'CHECKS_REQUIRED'],
          [{ decision: 'REJECTED' }, 'CHECKS_REQUIRED'],
          [checks('APPROVED', ['idDocumentCheck']), 'CHECKS_INCONSISTENT'],
          [checks('REJECTED'), 'CHECKS_INCONSISTENT'],
        ];
        for (const [input, detail] of cases) {
          expect(await decide(c, ops, r.verificationId, input), detail).toMatchObject({
            outcome: 'REFUSED',
            detail,
          });
          expect((await auditOf(c, ops.userId)).at(-1), detail).toMatchObject({
            action_code: 'MANUAL_ACTION_REFUSED',
            after: { attempted: 'KYC_DECISION', domainOutcome: detail },
          });
          await untouched(c, r.userId, r.verificationId, events);
        }
        // un autre OPS du pays : l'élément n'est pas à lui (verrou de la file, US-109)
        const other = await staff(c, 'OPS_AGENT', [country], country);
        expect(await decide(c, other, r.verificationId, checks('APPROVED'))).toMatchObject({
          outcome: 'REFUSED',
          detail: 'ITEM_NOT_CLAIMED',
        });
        // saisie hors énumération fermée, motif trop court : 22023, rien n'est écrit
        for (const input of [
          { ...checks('APPROVED'), decision: 'BANNED' },
          { ...checks('APPROVED'), livenessCheck: 'YES' },
          { ...checks('APPROVED'), scoreOverride: 'PASSED' },
        ]) {
          await expect(decide(c, ops, r.verificationId, input)).rejects.toMatchObject({
            code: '22023',
          });
        }
        await expect(
          decide(c, ops, r.verificationId, checks('APPROVED'), 'court'),
        ).rejects.toMatchObject({ code: '22023' });
        // 17 §2.3 : kyc.decide = OPS_AGENT et ADMIN de la portée ; FINANCE, SUPPORT : non
        for (const [role, scope] of [
          ['FINANCE', [country]],
          ['SUPPORT_AGENT', [country]],
          ['OPS_AGENT', [otherOf(country)]],
        ] as const) {
          const s = await staff(c, role, scope, country);
          expect((await decide(c, s, r.verificationId, checks('APPROVED'))).outcome, role).toBe(
            'FORBIDDEN',
          );
        }
        await untouched(c, r.userId, r.verificationId, events);

        // élément encore ouvert, pris par personne : refus
        const open = await toReview(c, country);
        const opsB = await staff(c, 'OPS_AGENT', [country], country);
        expect(await decide(c, opsB, open.verificationId, checks('APPROVED'))).toMatchObject({
          outcome: 'REFUSED',
          detail: 'ITEM_NOT_CLAIMED',
        });
        expect(await itemsOf(c, open.userId)).toMatchObject([{ status: 'OPEN', decision: null }]);
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : jamais sa propre vérification (SELF_FORBIDDEN), même avec l’élément pris en charge',
    async (country) => {
      await withRole('app_api', async (c) => {
        const r = await toReview(c, country);
        const me = await elevateAs(c, r.userId, 'OPS_AGENT', [country]);
        const [item] = await itemsOf(c, r.userId);
        expect((await claim(c, me, item?.id ?? '')).outcome).toBe('CLAIMED');
        expect(await decide(c, me, r.verificationId, checks('APPROVED'))).toMatchObject({
          outcome: 'REFUSED',
          detail: 'SELF_FORBIDDEN',
        });
        expect((await verification(c, r.userId)).status).toBe('MANUAL_REVIEW');
      });
    },
  );
});

describe('US-106 — OQ-BR-21 (défaut PROPOSÉ) : liste des permis provisoire', () => {
  it.each(byCountry)(
    '%s (%s) : IDP seul ou permis provisoire ⇒ en revue, jamais APPROVED (LICENSE_NOT_ACCEPTED) ; refus motivé admis',
    async (country) => {
      await withRole('app_api', async (c) => {
        for (const [document, reason] of [
          [licence(country, isoDay(400), { kind: 'IDP' }), 'DOCUMENT_NOT_LICENSE'],
          [licence(country, isoDay(400), { isPermanent: false }), 'LICENSE_PROVISIONAL'],
        ] as const) {
          const { r, item, ops } = await claimed(c, country, { decision: 'APPROVED', document });
          expect((await verification(c, r.userId)).decision_reason_code).toBe(reason);
          const events = (await fixture(c, 'us105_events', r.verificationId)).length;
          expect(await decide(c, ops, r.verificationId, checks('APPROVED'))).toMatchObject({
            outcome: 'REFUSED',
            detail: 'LICENSE_NOT_ACCEPTED',
          });
          await untouched(c, r.userId, r.verificationId, events);
          expect((await dossier(c, ops, item.id)).body).toMatchObject({
            verification: {
              document: { type: document['kind'], permanent: document['isPermanent'] },
            },
          });
          // refus motivé (16 VER-006) : catégorie « permis non accepté »
          expect(
            (await decide(c, ops, r.verificationId, checks('REJECTED', ['licenseListCheck'])))
              .outcome,
          ).toBe('DONE');
          expect(await verification(c, r.userId)).toMatchObject({
            status: 'REJECTED',
            decision_reason_code: 'LICENSE_NOT_ACCEPTED',
          });
        }
      });
    },
  );
});

describe('US-106 — retrait du consentement biométrique (VER-004)', () => {
  it.each(byCountry)(
    '%s (%s) : retrait ⇒ RECHECK, élément KYC annulé, décision refusée (NOT_IN_REVIEW), dossier fermé',
    async (country) => {
      await withRole('app_api', async (c) => {
        const { r, item, ops } = await claimed(c, country);
        expect(
          await one(c, 'SELECT * FROM core.kyc_cmd_biometric_consent($1, $2, $3, $4)', [
            r.token,
            country,
            null,
            false,
          ]),
        ).toEqual({ outcome: 'RECORDED', version: 1 });
        expect((await verification(c, r.userId)).status).toBe('RECHECK');
        expect(await itemsOf(c, r.userId)).toMatchObject([
          { id: item.id, status: 'CANCELLED', decision: 'RECHECK' },
        ]);
        const events = (await fixture(c, 'us105_events', r.verificationId)).length;
        for (const decision of ['APPROVED', 'REJECTED', 'MORE_INFO_REQUIRED']) {
          const input = checks(decision, decision === 'REJECTED' ? ['livenessCheck'] : []);
          expect(await decide(c, ops, r.verificationId, input), decision).toMatchObject({
            outcome: 'REFUSED',
            detail: 'NOT_IN_REVIEW',
          });
        }
        expect((await verification(c, r.userId)).status).toBe('RECHECK');
        expect(await fixture(c, 'us105_events', r.verificationId)).toHaveLength(events);
        expect((await dossier(c, ops, item.id)).outcome).toBe('CASE_REQUIRED');
      });
    },
  );

  it('nouvelle version du consentement non acceptée ⇒ APPROVED refusé (CONSENT_WITHDRAWN) ; transaction annulée', async () => {
    await withRole('app_api', async (c) => {
      const country = COUNTRIES[1].country;
      const { r, ops } = await claimed(c, country);
      await withTestTransaction(c, {}, async () => {
        await c.query('SELECT test_fixture.us105_publish_biometric_next()');
        expect(await decide(c, ops, r.verificationId, checks('APPROVED'))).toMatchObject({
          outcome: 'REFUSED',
          detail: 'CONSENT_WITHDRAWN',
        });
        expect((await verification(c, r.userId)).status).toBe('MANUAL_REVIEW');
      });
    });
  });
});

describe('US-106 — fiche 360° et lectures du staff', () => {
  it.each(byCountry)(
    '%s (%s) : la fiche 360° montre le statut SM-3, jamais une pièce ni un score',
    async (country) => {
      await withRole('app_api', async (c) => {
        const r = await toReview(c, country);
        const admin = await staff(c, 'ADMIN', [country], country);
        const p = await one<{ outcome: string; body: Record<string, unknown> }>(
          c,
          'SELECT * FROM core.support_staff_profile($1, $2, $3, $4)',
          [admin.hash, uuid(), r.userId, PURPOSE],
        );
        expect(p.outcome).toBe('GRANTED');
        expect(p.body['kyc']).toEqual({ status: 'MANUAL_REVIEW' });
        expect(JSON.stringify(p.body)).not.toMatch(/score|liveness|DRIVER_LICENSE|expiresOn/i);
      });
    },
  );

  it('les fonctions KYC du staff et du travailleur ne sont pas exécutables par app_api (42501)', async () => {
    await withRole('app_api', async (c) => {
      const id = uuid();
      for (const sql of [
        'SELECT core.kyc_staff_dossier($1)',
        'SELECT core.kyc_staff_status($1)',
        'SELECT core.kyc_country_of_verification($1)',
        "SELECT * FROM core.kyc_manual_action_decision(NULL, $1, 'KYC_DECISION', $1, '{}'::jsonb, 'x', $1, 'ADMIN')",
        'SELECT * FROM core.kyc_worker_enqueue_reviews(1) WHERE $1::uuid IS NOT NULL',
        'SELECT * FROM core.support_worker_review_sla(1) WHERE $1::uuid IS NOT NULL',
      ]) {
        await expect(c.query(sql, [id]), sql).rejects.toMatchObject({ code: '42501' });
      }
    });
  });
});

/** Prochain lundi (au moins une semaine après aujourd'hui) à `hour` h, heure locale du pays. */
function mondayAt(country: string, hour: number): Date {
  const off = utcOffsetMinutes(country);
  let local = new Date(Date.now() + 7 * 86_400_000 + off * 60_000);
  while (local.getUTCDay() !== 1) local = new Date(local.getTime() + 86_400_000);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, 0, 0) -
      off * 60_000,
  );
}

const asWorker = async (w: pg.ClientBase): Promise<void> => {
  await w.query(
    `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
            pg_catalog.set_config('app.worker_name', 'review_sla_watch', true)`,
  );
};

describe('US-106 — alerte de délai et remise en file (critère 2, travailleur review_sla_watch)', () => {
  it.each(byCountry)(
    '%s (%s) : dossier entré à 09:00 un jour ouvré ; 12:59:59 sans alerte ; 13:00 ⇒ alerte (une seule, événement support.review_queue.sla_breached)',
    async (country) => {
      const t0 = mondayAt(country, 9);
      const at = (minutes: number, seconds = 0) =>
        new Date(t0.getTime() + minutes * 60_000 + seconds * 1000).toISOString();
      const r = await withRole('app_api', (c) =>
        withTestTransaction(c, { commit: true, virtualNow: t0.toISOString() }, () =>
          toReview(c, country, { sessionExpiresAt: at(30) }),
        ),
      );
      await withRole('app_worker', async (w) => {
        const [item] = await itemsOf(w, r.userId);
        expect(item).toMatchObject({
          status: 'OPEN',
          sla_minutes: KYC_SLA_MINUTES,
          breached: false,
        });
        const id = item?.id ?? '';
        // 12:59:59 locale : encore dans le délai
        await withTestTransaction(w, { virtualNow: at(KYC_SLA_MINUTES, -1) }, async () => {
          await asWorker(w);
          await w.query('SELECT * FROM core.support_worker_review_sla(10000)');
          expect(await itemsOf(w, r.userId)).toMatchObject([{ id, breached: false }]);
          expect(await fixture(w, 'us106_item_events', id)).toEqual([]);
        });
        // 13:00 locale : alerte, une seule fois
        await withTestTransaction(w, { virtualNow: at(KYC_SLA_MINUTES) }, async () => {
          await asWorker(w);
          const { rows } = await w.query<{ queue: string; country_code: string; breached: number }>(
            'SELECT * FROM core.support_worker_review_sla(10000)',
          );
          expect(
            rows.find((x) => x.queue === 'KYC' && x.country_code === country)?.breached,
          ).toBeGreaterThanOrEqual(1);
          expect(await itemsOf(w, r.userId)).toMatchObject([{ id, breached: true }]);
          const events = await fixture(w, 'us106_item_events', id);
          expect(events).toEqual([
            {
              type: 'support.review_queue.sla_breached',
              country_code: country,
              actor_role: 'SYSTEM',
              actor_user_id: null,
              payload: {
                item_id: id,
                queue: 'KYC',
                severity: 'P2',
                sla_due_at: expect.any(String) as string,
              },
            },
          ]);
          expect(
            Date.parse(String((events[0]?.['payload'] as Record<string, unknown>)['sla_due_at'])),
          ).toBe(Date.parse(at(KYC_SLA_MINUTES)));
          await w.query('SELECT * FROM core.support_worker_review_sla(10000)');
          expect(await fixture(w, 'us106_item_events', id)).toHaveLength(1);
        });
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : dossier en revue sans élément vivant ⇒ remis en file par le travailleur ; réservé à review_sla_watch',
    async (country) => {
      const r = await withRole('app_api', async (c) => {
        const x = await toReview(c, country);
        const [item] = await itemsOf(c, x.userId);
        // sonde productrice de 9990 : élément annulé sans changer le dossier
        expect(
          await one(c, 'SELECT outcome FROM test_fixture.us109_close($1, $2, $3)', [
            item?.id,
            'CANCELLED',
            'TEST_ORPHAN',
          ]),
        ).toEqual({ outcome: 'CLOSED' });
        return x;
      });
      await withRole('app_worker', async (w) => {
        await withTestTransaction(w, {}, async () => {
          await asWorker(w);
          const k = await one<{ enqueued: number; unqueued: number }>(
            w,
            'SELECT * FROM core.kyc_worker_enqueue_reviews(10000)',
            [],
          );
          expect(k.enqueued).toBeGreaterThanOrEqual(1);
          expect(await itemsOf(w, r.userId)).toMatchObject([
            { status: 'CANCELLED' },
            { status: 'OPEN', country_code: country, sla_minutes: KYC_SLA_MINUTES },
          ]);
        });
        await withTestTransaction(w, {}, async () => {
          await w.query(
            `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                    pg_catalog.set_config('app.worker_name', 'kyc_score_pruner', true)`,
          );
          await expect(
            w.query('SELECT * FROM core.kyc_worker_enqueue_reviews(10)'),
          ).rejects.toMatchObject({ code: '42501' });
        });
        await withTestTransaction(w, {}, async () => {
          await expect(
            w.query('SELECT * FROM core.support_worker_review_sla(10)'),
          ).rejects.toMatchObject({ code: '42501' });
        });
      });
    },
  );
});
