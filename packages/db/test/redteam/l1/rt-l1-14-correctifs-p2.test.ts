/**
 * US-122 — non-régression des correctifs de la passe n° 2 de la red team du lot 1 (ADR-124,
 * migrations 0097 et 0098, fixture 9951), sur le modèle de rt-l1-08 : issues EXACTES et voies de
 * sortie, que les tests de la red team (écrits avant les correctifs) n'affirment pas (revues qa
 * n° 1 et code n° 1 du 2026-11-14).
 *
 * - F2-D-02 : `core.kyc_cmd_retry_erasure` : demande FAILED de la personne ⇒ RECORDED, de nouveau à
 *   traiter, journalisée KYC_ERASURE_RETRIED ; NOT_FOUND pour la demande d'autrui et pour une
 *   demande non FAILED ;
 * - F2-A03-01 : même personne qu'un hôte déjà approuvé ⇒ l'ops reçoit REFUSED /
 *   HOST_IDENTITY_DUPLICATE ; le travailleur (voie par défaut, revue par exception) laisse le
 *   dossier à l'ops (kept) ; le constat NOT_LINKED de l'ops libère l'approbation, des deux voies ;
 * - F2-U-02 : bornes exactes (la 100e photo et le 20e dépôt passent, le suivant est refusé ; taille
 *   à 10 Mio pile acceptée, un octet de plus refusé) et refus quand le paramètre est absent.
 *
 * Rôles de production seulement (assertion L0-05 par withRole), USD (PA) et PYG (PY). Seuils lus
 * dans les données CFG (graine 0098 générée depuis elles) ; attendus d'ADR-124, jamais du code.
 * Le test de la voie automatique valide ses dossiers (le travailleur tourne dans sa propre
 * transaction, sous app_worker) : ses deux hôtes jumeaux ont une date de naissance propre au pays
 * et à ce fichier, aucune autre preuve ne la partage.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../../src/testing/index.ts';
import { person } from '../../support/kyc.ts';
import { auditOf, installTestProofKey } from '../../support/staff.ts';
import { byCountry, ops, rolledBack, targetOf, uuid } from './support.ts';
import type { Host, Tx } from './support.ts';
import {
  act,
  bornYearsAgo,
  first,
  hostState,
  kycApprovedWithFacts,
  readyHost,
} from './support-host.ts';
import { decideLink } from './support-p2.ts';

const params = (
  JSON.parse(
    readFileSync(
      new URL('../../../../../apps/api/src/modules/cfg/data/params.json', import.meta.url),
      'utf8',
    ),
  ) as { params: { key: string; values?: Record<string, unknown> }[] }
).params;
const paramOf = (key: string, country: string): number =>
  Number(params.find((p) => p.key === key)?.values?.[country]);

// ---------------------------------------------------------------------------------------------
// F2-D-02 — reprise d'un effacement KYC refusé par le fournisseur
// ---------------------------------------------------------------------------------------------
const pending = async (tx: Tx, token: Buffer) =>
  (await tx.query<{ request_id: string }>('SELECT * FROM core.kyc_pending_erasures($1)', [token]))
    .rows;
const retry = (tx: Tx, token: Buffer, request: string) =>
  first<{ outcome: string }>(tx, 'SELECT * FROM core.kyc_cmd_retry_erasure($1, $2)', [
    token,
    request,
  ]);
const record = (tx: Tx, token: Buffer, request: string, outcome: 'DONE' | 'FAILED') =>
  first<{ outcome: string }>(tx, 'SELECT * FROM core.kyc_cmd_record_erasure($1, $2, $3, $4)', [
    token,
    request,
    outcome,
    outcome === 'DONE' ? 'attestation-de-test' : null,
  ]);

describe.each(byCountry)('F2-D-02 — reprise d’un effacement KYC refusé (%s)', (country) => {
  /** Personne vérifiée qui retire son consentement : une demande d'effacement PENDING. */
  async function withdrawn(tx: Tx) {
    const p = await person(tx, country);
    await kycApprovedWithFacts(tx, p, country, {
      dateOfBirth: bornYearsAgo(30, 7),
      residenceCountry: country,
    });
    const w = await first<{ outcome: string }>(
      tx,
      'SELECT * FROM core.kyc_cmd_biometric_consent($1, $2, $3, $4)',
      [p.token, country, 1, false],
    );
    expect(w.outcome).toBe('RECORDED');
    const [req] = await pending(tx, p.token);
    expect(req?.request_id).toBeTruthy();
    return { p, request: req?.request_id ?? '' };
  }

  it('demande FAILED de la personne : RECORDED, de nouveau à traiter, journalisée KYC_ERASURE_RETRIED', async () => {
    await rolledBack(async (tx) => {
      const { p, request } = await withdrawn(tx);
      expect((await record(tx, p.token, request, 'FAILED')).outcome).toBe('RECORDED');
      expect(await pending(tx, p.token)).toEqual([]);
      expect((await retry(tx, p.token, request)).outcome).toBe('RECORDED');
      expect((await pending(tx, p.token)).map((r) => r.request_id)).toEqual([request]);
      expect((await auditOf(tx, p.userId)).at(-1)).toMatchObject({
        action_code: 'KYC_ERASURE_RETRIED',
        subject_type: 'USER_ACCOUNT',
        subject_id: p.userId,
        before: { status: 'FAILED', requestId: request },
        after: { status: 'PENDING', requestId: request },
      });
    });
  });

  it('demande d’autrui, ou demande non FAILED (PENDING, DONE) : NOT_FOUND, rien ne change', async () => {
    await rolledBack(async (tx) => {
      const { p, request } = await withdrawn(tx);
      // PENDING : rien à reprendre
      expect((await retry(tx, p.token, request)).outcome).toBe('NOT_FOUND');
      expect((await record(tx, p.token, request, 'FAILED')).outcome).toBe('RECORDED');
      // demande FAILED d'autrui
      const other = await person(tx, country);
      expect((await retry(tx, other.token, request)).outcome).toBe('NOT_FOUND');
      expect(await pending(tx, p.token)).toEqual([]);
      // DONE : close, jamais rouverte
      const second = await withdrawn(tx);
      expect((await record(tx, second.p.token, second.request, 'DONE')).outcome).toBe('RECORDED');
      expect((await retry(tx, second.p.token, second.request)).outcome).toBe('NOT_FOUND');
      expect(await pending(tx, second.p.token)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// F2-A03-01 — doublon d'identité d'hôte : issue exacte, voie automatique, sortie du faux positif
// ---------------------------------------------------------------------------------------------
describe.each(byCountry)('F2-A03-01 — doublon d’identité d’hôte (%s)', (country, _c, cc) => {
  it('voie de l’ops : REFUSED / HOST_IDENTITY_DUPLICATE, dossier en revue ; constat NOT_LINKED : approuvé', async () => {
    await rolledBack(async (tx) => {
      await installTestProofKey(tx);
      const a = await readyHost(tx, country, 'CLEAR');
      const b = await readyHost(tx, country, 'CLEAR');
      const agent = await ops(tx, 'OPS_AGENT', [country]);
      const approve = (org: string) =>
        act(tx, agent, 'HOST_VERIFICATION_DECISION', org, { input: { decision: 'APPROVED' } });
      expect((await approve(a.org)).outcome).toBe('DONE');
      expect(await approve(b.org)).toMatchObject({
        outcome: 'REFUSED',
        detail: 'HOST_IDENTITY_DUPLICATE',
      });
      expect((await hostState(tx, b))['verification_status']).toBe('IN_REVIEW');
      const link = await decideLink(tx, null, a.userId, b.userId, 'NOT_LINKED', 'SAME_IDENTITY');
      expect(link.outcome).toBe('RECORDED');
      expect((await approve(b.org)).outcome).toBe('DONE');
      expect((await hostState(tx, b))['verification_status']).toBe('APPROVED');
    });
  });

  it('voie automatique (revue par exception) : le jumeau n’est pas approuvé, il est laissé à l’ops ; constat NOT_LINKED : approuvé par le travailleur', async () => {
    const delay = paramOf('host_review_auto_delay_minutes', country);
    const later = new Date(Date.now() + (delay + 5) * 60_000).toISOString();
    const autoReview = (org: string) =>
      withRole('app_worker', (w) =>
        withTestTransaction(w, { commit: true, virtualNow: later }, async (tx) => {
          await tx.query(
            `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                    pg_catalog.set_config('app.worker_name', 'review_sla_watch', true)`,
          );
          const r = await first<Record<string, number>>(
            tx,
            'SELECT * FROM core.kyc_worker_auto_review_hosts($1, $2)',
            [10, org],
          );
          return {
            approved: Number(r['approved']),
            kept: Number(r['kept']),
            skipped: Number(r['skipped']),
            failed: Number(r['failed']),
          };
        }),
      );
    // date de naissance propre à ce test et au pays (dossiers validés : aucune autre preuve ne
    // la partage)
    const birth = bornYearsAgo(30, 9_000 + byCountry.findIndex(([c]) => c === cc.country) * 10);
    await withRole('app_api', async (c) => {
      const twin = async () => {
        const p = await person(c, country);
        await kycApprovedWithFacts(c, p, country, {
          dateOfBirth: birth,
          residenceCountry: country,
        });
        const acc = await first<{ outcome: string; org_id: string }>(
          c,
          'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
          [p.token, country, 'INDIVIDUAL'],
        );
        expect(acc.outcome).toBe('DONE');
        const terms = await first<{ outcome: string }>(
          c,
          'SELECT * FROM core.ctr_cmd_accept_host_terms($1, $2, 1, $3)',
          [p.token, acc.org_id, 'es'],
        );
        expect(terms.outcome).toBe('DONE');
        const s = await first<{ outcome: string; screening_key: string }>(
          c,
          'SELECT * FROM core.kyc_cmd_host_submit($1, $2)',
          [p.token, acc.org_id],
        );
        expect(s.outcome).toBe('SUBMITTED');
        const screened = await first<{ outcome: string }>(
          c,
          'SELECT * FROM core.kyc_cmd_host_record_screening($1, $2, $3, $4, $5, $6::jsonb, $7)',
          [
            p.token,
            acc.org_id,
            'FAKE',
            s.screening_key,
            'CLEAR',
            JSON.stringify({ UN: '2026-11-01', OFAC: '2026-11-10', NATIONAL: 'v42' }),
            null,
          ],
        );
        expect(screened.outcome).toBe('RECORDED');
        return { userId: p.userId, token: p.token, org: acc.org_id };
      };
      const a = await twin();
      const b = await twin();
      expect(await autoReview(a.org)).toEqual({ approved: 1, kept: 0, skipped: 0, failed: 0 });
      // même personne qu'un hôte approuvé : jamais approuvé automatiquement, laissé à l'ops
      expect(await autoReview(b.org)).toEqual({ approved: 0, kept: 1, skipped: 0, failed: 0 });
      expect((await hostState(c, b))['verification_status']).toBe('IN_REVIEW');
      // l'ops constate deux personnes distinctes : le travailleur approuve à la passe suivante
      const link = await withTestTransaction(c, { commit: true }, (tx) =>
        decideLink(tx, null, a.userId, b.userId, 'NOT_LINKED', 'SAME_IDENTITY'),
      );
      expect(link.outcome).toBe('RECORDED');
      expect(await autoReview(b.org)).toEqual({ approved: 1, kept: 0, skipped: 0, failed: 0 });
      expect((await hostState(c, b))['verification_status']).toBe('APPROVED');
    });
  });
});

// ---------------------------------------------------------------------------------------------
// F2-U-02 — plafonds de téléversement : bornes exactes, paramètre absent
// ---------------------------------------------------------------------------------------------
const addPhoto = (tx: Tx, h: Host, listing: string, bytes: number) =>
  first<{ outcome: string }>(
    tx,
    'SELECT * FROM core.catalog_cmd_add_listing_photo($1, $2, $3, $4, $5, $6, $7, $8)',
    [h.hash, h.org, listing, uuid(), uuid(), 'image/jpeg', bytes, randomBytes(32)],
  );
const addDocument = (tx: Tx, h: Host, vehicle: string) =>
  first<{ outcome: string }>(
    tx,
    'SELECT * FROM core.catalog_cmd_add_vehicle_document($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [h.hash, h.org, vehicle, uuid(), 'TITLE', 'application/pdf', 54_321, randomBytes(32), null],
  );
const close = (tx: Tx, key: string, country: string) =>
  tx.query('SELECT test_fixture.us122c_param_close($1, $2)', [key, country]);

describe.each(byCountry)('F2-U-02 — plafonds de téléversement (%s)', (country, _c, cc) => {
  it('galerie : la dernière photo admise passe, la suivante est refusée PHOTO_LIMIT_REACHED', async () => {
    const max = paramOf('upload_gallery_photos_max', country);
    expect(max).toBe(100);
    await rolledBack(async (tx) => {
      const t = await targetOf(tx, cc);
      for (let i = 0; i < max; i += 1) {
        expect((await addPhoto(tx, t.host, t.listing, 100_000)).outcome, `photo ${i + 1}`).toBe(
          'DONE',
        );
      }
      expect((await addPhoto(tx, t.host, t.listing, 100_000)).outcome).toBe('PHOTO_LIMIT_REACHED');
    });
  });

  it('taille déclarée : 10 Mio pile acceptés, un octet de plus PHOTO_FORMAT', async () => {
    const kb = paramOf('upload_photo_max_kb', country);
    expect(kb).toBe(10_240);
    await rolledBack(async (tx) => {
      const t = await targetOf(tx, cc);
      expect((await addPhoto(tx, t.host, t.listing, kb * 1024)).outcome).toBe('DONE');
      expect((await addPhoto(tx, t.host, t.listing, kb * 1024 + 1)).outcome).toBe('PHOTO_FORMAT');
    });
  });

  it('pièces : le dernier dépôt admis de la minute passe, le suivant est refusé DOCUMENT_RATE_LIMITED', async () => {
    const max = paramOf('upload_documents_per_minute', country);
    expect(max).toBe(20);
    await rolledBack(async (tx) => {
      const t = await targetOf(tx, cc);
      await tx.query('SELECT test_fixture.us109_subject_key($1)', [t.host.userId]);
      for (let i = 0; i < max; i += 1) {
        expect((await addDocument(tx, t.host, t.vehicle)).outcome, `pièce ${i + 1}`).toBe('DONE');
      }
      expect((await addDocument(tx, t.host, t.vehicle)).outcome).toBe('DOCUMENT_RATE_LIMITED');
    });
  });

  it('paramètre absent (fail-closed) : galerie PHOTO_LIMIT_REACHED, taille PHOTO_FORMAT, pièces DOCUMENT_RATE_LIMITED', async () => {
    await rolledBack(async (tx) => {
      const t = await targetOf(tx, cc);
      await tx.query('SELECT test_fixture.us109_subject_key($1)', [t.host.userId]);
      // témoin : tout passe avec les paramètres en vigueur
      expect((await addPhoto(tx, t.host, t.listing, 100_000)).outcome).toBe('DONE');
      expect((await addDocument(tx, t.host, t.vehicle)).outcome).toBe('DONE');
      await tx.query('SAVEPOINT absent');
      await close(tx, 'upload_gallery_photos_max', country);
      expect((await addPhoto(tx, t.host, t.listing, 100_000)).outcome).toBe('PHOTO_LIMIT_REACHED');
      await tx.query('ROLLBACK TO SAVEPOINT absent');
      await close(tx, 'upload_photo_max_kb', country);
      expect((await addPhoto(tx, t.host, t.listing, 100_000)).outcome).toBe('PHOTO_FORMAT');
      await close(tx, 'upload_documents_per_minute', country);
      expect((await addDocument(tx, t.host, t.vehicle)).outcome).toBe('DOCUMENT_RATE_LIMITED');
    });
  });
});
