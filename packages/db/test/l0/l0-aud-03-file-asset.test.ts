/**
 * US-009 — magasin de preuves : empreinte SHA-256 à la réception et recalcul (17 §1.7, CLM-034,
 * §3.1.3 point 1, §3.2.13 ; ADR-051) ; journal d'accès aux données (ADM-032). Sous les rôles de
 * production (assertion L0-05 en tête).
 *
 * Critère : « Given un fichier téléversé, When on recalcule son SHA-256, Then il égale celui de
 * `file_asset`. » Oracle : SHA-256 des octets envoyés, calculé par node:crypto dans le test.
 */
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  recordDataAccess,
  receiveFile,
  SubjectKeyStore,
  verifyFileAsset,
} from '../../src/audit/index.ts';
import type { Bucket, Classification, SubjectRef } from '../../src/audit/index.ts';
import { FakeKeyWrapper, InMemoryFileStore, withRole } from '../../src/testing/index.ts';
import { attempt, auditTx, uuid } from '../support/audit.ts';
import type { ActorContext } from '../support/audit.ts';

const T0 = '2031-06-01T12:00:00.000Z';
const VERIFIER: ActorContext = { kind: 'WORKER', worker: 'evidence_verifier' };
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

interface Upload {
  readonly id: string;
  readonly bucket: Bucket;
  readonly key: string;
  readonly body: Buffer;
  readonly classification: Classification;
  readonly subject?: SubjectRef;
}

/** Réception d'un fichier par app_api, validée (COMMIT), envoyée en plusieurs morceaux. */
async function upload(
  keys: SubjectKeyStore,
  store: InMemoryFileStore,
  actor: ActorContext,
  u: Upload,
): Promise<void> {
  await withRole('app_api', (client) =>
    auditTx(client, { actor, virtualNow: T0, commit: true }, async (tx) => {
      const parts = [u.body.subarray(0, 7), u.body.subarray(7)];
      await receiveFile(
        tx,
        store,
        keys,
        {
          id: u.id,
          bucket: u.bucket,
          storageKey: u.key,
          mime: 'image/jpeg',
          uploaderUserId: u.subject?.id ?? uuid(),
          source: 'IN_APP_CAMERA',
          deviceCapturedAt: new Date('2031-06-01T11:59:30.000Z'),
          classification: u.classification,
          retentionClass: u.classification === 'C0' ? 'LISTING_PHOTO' : 'CLAIM_EVIDENCE',
          ...(u.subject !== undefined ? { encryptFor: u.subject } : {}),
        },
        parts,
      );
    }),
  );
}

describe('US-009 — magasin de preuves (17 §1.7, CLM-034)', () => {
  const keys = new SubjectKeyStore(new FakeKeyWrapper());
  const store = new InMemoryFileStore();
  const guest: SubjectRef = { type: 'USER', id: uuid() };
  const publicPhoto: Upload = {
    id: uuid(),
    bucket: 'PUBLIC_LISTING',
    key: `listings/${uuid()}.jpg`,
    body: randomBytes(4096),
    classification: 'C0',
  };
  const evidence: Upload = {
    id: uuid(),
    bucket: 'PRIVATE_EVIDENCE',
    key: `claims/${uuid()}.jpg`,
    body: Buffer.concat([Buffer.from('EXIF-nom-du-guest:'), randomBytes(2048)]),
    classification: 'C3',
    subject: guest,
  };

  it('SHA-256 recalculé = file_asset.sha256 = empreinte des octets envoyés (clair et chiffré par sujet)', async () => {
    await upload(keys, store, { kind: 'HOST' }, publicPhoto);
    await upload(keys, store, { kind: 'GUEST' }, evidence);
    await withRole('app_worker', (client) =>
      auditTx(client, { actor: VERIFIER }, async (tx) => {
        for (const u of [publicPhoto, evidence]) {
          const { rows } = await tx.query<{
            sha256: Buffer;
            bytes: string;
            received: string;
            enc_subject_id: string | null;
          }>(
            `SELECT sha256, bytes::text AS bytes,
                    to_char(server_received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS received,
                    enc_subject_id::text AS enc_subject_id
               FROM core.audit_file_asset WHERE id = $1`,
            [u.id],
          );
          const row = rows[0];
          expect(row?.sha256.toString('hex'), u.bucket).toBe(sha(u.body));
          expect(row?.bytes).toBe(String(u.body.length));
          expect(row?.received).toBe(T0); // heure serveur = platform.now()
          expect(row?.enc_subject_id ?? null).toBe(u.subject?.id ?? null);
          const verdict = await verifyFileAsset(tx, store, keys, u.id);
          expect(verdict).toMatchObject({ status: 'MATCH' });
          if (verdict.status === 'MATCH') expect(verdict.sha256.toString('hex')).toBe(sha(u.body));
        }
        // la preuve C3 est stockée chiffrée : ni le clair ni son empreinte en clair
        const raw = store.raw(evidence.bucket, evidence.key);
        expect(raw?.equals(evidence.body)).toBe(false);
        expect(raw?.includes(Buffer.from('EXIF-nom-du-guest'))).toBe(false);
        expect(sha(raw as Buffer)).not.toBe(sha(evidence.body));
        // la photo publique (C0) est stockée telle quelle
        expect(store.raw(publicPhoto.bucket, publicPhoto.key)?.equals(publicPhoto.body)).toBe(true);
      }),
    );
  });

  it('collision de storage_key : refusée (23505) avant le dépôt ; la preuve existante garde ses octets', async () => {
    const first: Upload = { ...publicPhoto, id: uuid(), key: `listings/${uuid()}.jpg` };
    await upload(keys, store, { kind: 'HOST' }, first);
    const second: Upload = { ...first, id: uuid(), body: randomBytes(4096) };
    await expect(upload(keys, store, { kind: 'HOST' }, second)).rejects.toMatchObject({
      code: '23505',
      constraint: 'file_asset_storage_unique',
    });
    expect(store.raw(first.bucket, first.key)?.equals(first.body)).toBe(true);
    await withRole('app_worker', (client) =>
      auditTx(client, { actor: VERIFIER }, async (tx) => {
        expect((await verifyFileAsset(tx, store, keys, first.id)).status).toBe('MATCH');
      }),
    );
  });

  it('objet altéré dans le stockage : empreinte différente (C0) ou déchiffrement refusé (C3)', async () => {
    const photo: Upload = { ...publicPhoto, id: uuid(), key: `listings/${uuid()}.jpg` };
    const proof: Upload = { ...evidence, id: uuid(), key: `claims/${uuid()}.jpg` };
    await upload(keys, store, { kind: 'HOST' }, photo);
    await upload(keys, store, { kind: 'GUEST' }, proof);
    store.corrupt(photo.bucket, photo.key, 100);
    store.corrupt(proof.bucket, proof.key, 100);
    await withRole('app_worker', (client) =>
      auditTx(client, { actor: VERIFIER }, async (tx) => {
        const altered = await verifyFileAsset(tx, store, keys, photo.id);
        expect(altered.status).toBe('MISMATCH');
        if (altered.status === 'MISMATCH')
          expect(altered.expected.toString('hex')).toBe(sha(photo.body));
        expect(await verifyFileAsset(tx, store, keys, proof.id)).toEqual({
          status: 'UNREADABLE',
          reason: 'DECRYPT_FAILED',
        });
        expect(await verifyFileAsset(tx, store, keys, uuid())).toEqual({ status: 'UNKNOWN_FILE' });
      }),
    );
  });

  it('clé du sujet détruite : la preuve chiffrée devient illisible (crypto-shredding des fichiers)', async () => {
    const owner: SubjectRef = { type: 'USER', id: uuid() };
    const proof: Upload = { ...evidence, id: uuid(), key: `claims/${uuid()}.jpg`, subject: owner };
    await upload(keys, store, { kind: 'GUEST' }, proof);
    await withRole('app_worker', (client) =>
      auditTx(client, { actor: VERIFIER }, async (tx) => {
        expect((await verifyFileAsset(tx, store, keys, proof.id)).status).toBe('MATCH');
        await tx.query(`SELECT test_fixture.destroy_subject_key('USER', $1, $2, 'effacement')`, [
          owner.id,
          uuid(),
        ]);
        expect(await verifyFileAsset(tx, store, keys, proof.id)).toEqual({
          status: 'UNREADABLE',
          reason: 'KEY_DESTROYED',
        });
      }),
    );
  });

  it('la base refuse : C2 / C3 sans clé de sujet, C0 chiffré dans un bucket public, heure fournie par le client', async () => {
    await withRole('app_api', (client) =>
      auditTx(client, { actor: { kind: 'GUEST' } }, async (tx) => {
        const insert = `INSERT INTO core.audit_file_asset
            (id, bucket, storage_key, mime, bytes, sha256, source, classification, retention_class,
             enc_subject_type, enc_subject_id)
          VALUES ($1, $2, $3, 'image/jpeg', 1, $4, 'IN_APP_CAMERA', $5, 'CLAIM_EVIDENCE', $6, $7)`;
        const digest = createHash('sha256').update('x').digest();
        expect(
          await attempt(tx, insert, [
            uuid(),
            'PRIVATE_EVIDENCE',
            `k/${uuid()}`,
            digest,
            'C3',
            null,
            null,
          ]),
        ).toMatchObject({ code: '23514', constraint: 'file_asset_personal_encrypted' });
        expect(
          await attempt(tx, insert, [uuid(), 'DOCUMENTS', `k/${uuid()}`, digest, 'C2', null, null]),
        ).toMatchObject({ code: '23514', constraint: 'file_asset_personal_encrypted' });
        expect(
          await attempt(tx, insert, [
            uuid(),
            'PUBLIC_LISTING',
            `k/${uuid()}`,
            digest,
            'C3',
            'USER',
            uuid(),
          ]),
        ).toMatchObject({ code: '23514' });
        expect(
          await attempt(tx, insert, [
            uuid(),
            'PRIVATE_EVIDENCE',
            `k/${uuid()}`,
            Buffer.alloc(16),
            'C1',
            null,
            null,
          ]),
        ).toMatchObject({ code: '23514', constraint: 'file_asset_sha256_size' });
        expect(
          await attempt(
            tx,
            `INSERT INTO core.audit_file_asset
                (id, bucket, storage_key, mime, bytes, sha256, source, classification, retention_class,
                 server_received_at)
              VALUES ($1, 'PRIVATE_EVIDENCE', $2, 'image/jpeg', 1, $3, 'IN_APP_CAMERA', 'C1', 'X1', '2000-01-01')`,
            [uuid(), `k/${uuid()}`, digest],
          ),
        ).toMatchObject({ code: '42501' });
      }),
    );
  });

  it('empreinte, taille et emplacement figés : UPDATE et DELETE refusés aux rôles applicatifs (42501)', async () => {
    for (const role of ['app_api', 'app_worker'] as const) {
      await withRole(role, (client) =>
        auditTx(
          client,
          { actor: role === 'app_api' ? { kind: 'STAFF' } : VERIFIER },
          async (tx) => {
            for (const sql of [
              `UPDATE core.audit_file_asset SET sha256 = sha256 WHERE id = $1`,
              `UPDATE core.audit_file_asset SET legal_hold_until = NULL WHERE id = $1`,
              `DELETE FROM core.audit_file_asset WHERE id = $1`,
            ]) {
              expect(await attempt(tx, sql, [publicPhoto.id]), `${role} : ${sql}`).toMatchObject({
                code: '42501',
              });
            }
          },
        ),
      );
    }
  });

  it('lecture des métadonnées : evidence_verifier seulement (contexte absent ou autre travailleur : 0 ligne)', async () => {
    await withRole('app_worker', async (client) => {
      for (const actor of [
        { kind: 'NONE' },
        { kind: 'WORKER', worker: 'hold_expiry' },
      ] satisfies ActorContext[]) {
        await auditTx(client, { actor }, async (tx) => {
          const { rows } = await tx.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM core.audit_file_asset',
          );
          expect(rows[0]?.n, actor.kind).toBe(0);
        });
      }
    });
    await withRole('app_api', (client) =>
      auditTx(client, { actor: { kind: 'STAFF' } }, async (tx) => {
        expect(await attempt(tx, 'SELECT 1 FROM core.audit_file_asset LIMIT 1')).toMatchObject({
          code: '42501',
        });
      }),
    );
  });
});

describe('US-009 — journal d’accès aux données (ADM-032)', () => {
  it('lecture C3 journalisée par le support ; le journal est en ajout seul', async () => {
    await withRole('app_api', (client) =>
      auditTx(client, { actor: { kind: 'STAFF' }, virtualNow: T0 }, async (tx) => {
        await recordDataAccess(tx, {
          id: uuid(),
          actorUserId: uuid(),
          actorRole: 'SUPPORT_AGENT',
          subjectType: 'USER',
          subjectId: uuid(),
          fieldOrFile: 'identity_document.number_enc',
          purpose: 'vérification du dossier de sinistre',
          accessKind: 'READ_C3',
          caseRef: 'CASE-2031-0042',
        });
        for (const sql of [
          `UPDATE core.audit_data_access_log SET purpose = 'x'`,
          `DELETE FROM core.audit_data_access_log`,
          `TRUNCATE core.audit_data_access_log`,
          `SELECT 1 FROM core.audit_data_access_log`,
        ]) {
          expect(await attempt(tx, sql), sql).toMatchObject({ code: '42501' });
        }
        // l'instant est celui de la base, jamais fourni par le client
        expect(
          await attempt(
            tx,
            `INSERT INTO core.audit_data_access_log
                (id, at, actor_role, subject_type, subject_id, field_or_file, purpose, access_kind)
              VALUES ($1, '2000-01-01', 'SUPPORT_AGENT', 'USER', $1, 'x', 'y', 'READ_C3')`,
            [uuid()],
          ),
        ).toMatchObject({ code: '42501' });
        expect(
          await attempt(
            tx,
            `INSERT INTO core.audit_data_access_log
                (id, actor_role, subject_type, subject_id, field_or_file, purpose, access_kind)
              VALUES ($1, 'SUPPORT_AGENT', 'USER', $1, 'x', 'y', 'READ_EVERYTHING')`,
            [uuid()],
          ),
        ).toMatchObject({ code: '23514', constraint: 'data_access_log_access_kind_valid' });
      }),
    );
    // sans contexte : refus (fail-closed)
    await withRole('app_worker', (client) =>
      auditTx(client, { actor: { kind: 'NONE' } }, async (tx) => {
        expect(
          await attempt(
            tx,
            `INSERT INTO core.audit_data_access_log
                (id, actor_role, subject_type, subject_id, field_or_file, purpose, access_kind)
              VALUES ($1, 'WORKER', 'USER', $1, 'x', 'y', 'BULK_EXPORT')`,
            [uuid()],
          ),
        ).toMatchObject({ code: '42501' });
      }),
    );
  });
});
