/**
 * US-036 — adaptateurs locaux et export de portabilité, sans base (la sémantique SQL et
 * l'aller-retour complet sous les rôles de production sont prouvés par l'exercice de
 * portabilité, test/portability/, job CI « reprise »). Oracles : node:crypto (SHA-256, RSA,
 * AES-GCM) et les octets écrits par le test, jamais le code testé.
 */
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { SubjectRef } from '../audit/envelope.ts';
import { KeyWrapperRejectedError } from '../audit/key-wrapper.ts';
import type { Queryable } from '../audit/subject-keys.ts';
import { EscrowError, EscrowOpener, EscrowSealer } from './escrow.ts';
import { exportFiles, importFiles, parseManifest } from './files.ts';
import { FsFileStore, objectPath } from './fs-file-store.ts';
import { exportSubjectKeys, importSubjectKeys, parseKeys, serializeKeys } from './keys.ts';
import {
  LOCAL_WRAPPED_BYTES,
  LocalAdapterForbiddenError,
  LocalKeyWrapper,
} from './local-key-wrapper.ts';
import { fileStoreFromEnv, keyWrapperFromEnv, main, parseCommand } from './main.ts';

const TEST_ENV = { RUEDA_ENV: 'test' } as const;
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'rueda-us036-'));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const user = (): SubjectRef => ({ type: 'USER', id: randomUUID() });
const rsa = (bits: number) =>
  generateKeyPairSync('rsa', {
    modulusLength: bits,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const escrowPair = rsa(3072);
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

describe('LocalKeyWrapper (adaptateur local du port KeyWrapper)', () => {
  const master = randomBytes(32);
  const kw = new LocalKeyWrapper(master, TEST_ENV);

  it('aller-retour ; enveloppe de 61 octets, liée au sujet et à la clé maîtresse', async () => {
    const dek = randomBytes(32);
    const s = user();
    const wrapped = await kw.wrap(dek, s);
    expect(wrapped.length).toBe(LOCAL_WRAPPED_BYTES);
    expect(wrapped.includes(dek)).toBe(false);
    expect((await kw.unwrap(wrapped, kw.keyId, s)).equals(dek)).toBe(true);
    await expect(kw.unwrap(wrapped, kw.keyId, user())).rejects.toBeInstanceOf(
      KeyWrapperRejectedError,
    );
    const other = new LocalKeyWrapper(randomBytes(32), TEST_ENV);
    expect(other.keyId).not.toBe(kw.keyId);
    await expect(other.unwrap(wrapped, kw.keyId, s)).rejects.toBeInstanceOf(
      KeyWrapperRejectedError,
    );
    const altered = Buffer.from(wrapped);
    altered[40] = (altered[40] ?? 0) ^ 1;
    await expect(kw.unwrap(altered, kw.keyId, s)).rejects.toBeInstanceOf(KeyWrapperRejectedError);
  });

  it('identifiant public stable, qui ne contient pas la clé ; fichier hexadécimal ou brut', () => {
    expect(new LocalKeyWrapper(master, TEST_ENV).keyId).toBe(kw.keyId);
    expect(kw.keyId).toMatch(/^local-aes256gcm:[0-9a-f]{16}$/);
    expect(kw.keyId).not.toContain(master.toString('hex').slice(0, 16));
    const d = tmp();
    writeFileSync(join(d, 'hex'), `${master.toString('hex')}\n`, { mode: 0o600 });
    writeFileSync(join(d, 'raw'), master, { mode: 0o600 });
    expect(LocalKeyWrapper.fromFile(join(d, 'hex'), TEST_ENV).keyId).toBe(kw.keyId);
    expect(LocalKeyWrapper.fromFile(join(d, 'raw'), TEST_ENV).keyId).toBe(kw.keyId);
    expect(() => new LocalKeyWrapper(randomBytes(16), TEST_ENV)).toThrow(/32 octets/);
  });

  it('refusé en production, et si RUEDA_ENV est absente ou inconnue (fail-closed)', () => {
    for (const env of [{ RUEDA_ENV: 'production' }, {}, { RUEDA_ENV: 'Production' }]) {
      expect(() => new LocalKeyWrapper(master, env)).toThrow(LocalAdapterForbiddenError);
    }
    for (const env of ['development', 'test', 'preproduction']) {
      expect(new LocalKeyWrapper(master, { RUEDA_ENV: env }).keyId).toBe(kw.keyId);
    }
  });
});

describe('séquestre RSA-OAEP du fondateur', () => {
  it('chiffré avec la clé publique, ouvert avec la privée ; lié au sujet', () => {
    const sealer = new EscrowSealer(escrowPair.publicKey);
    const opener = new EscrowOpener(escrowPair.privateKey);
    expect(sealer.fingerprint).toBe(opener.fingerprint);
    const dek = randomBytes(32);
    const s = user();
    const sealed = sealer.seal(dek, s);
    expect(sealed.includes(dek)).toBe(false);
    expect(opener.open(sealed, s).equals(dek)).toBe(true);
    expect(() => opener.open(sealed, user())).toThrow(EscrowError);
    const stranger = new EscrowOpener(rsa(3072).privateKey);
    expect(() => stranger.open(sealed, s)).toThrow(EscrowError);
  });

  it('clé trop courte, illisible ou d’un autre type : refus', () => {
    expect(() => new EscrowSealer(rsa(2048).publicKey)).toThrow(/3072 bits/);
    expect(() => new EscrowSealer('pas une clé')).toThrow(EscrowError);
    const ec = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    expect(() => new EscrowSealer(ec.publicKey)).toThrow(/RSA/);
    expect(() => new EscrowOpener(ec.privateKey)).toThrow(/RSA/);
  });
});

describe('FsFileStore (adaptateur système de fichiers du port FileStore)', () => {
  it('création seule : CONFLICT sans écraser ; NOT_FOUND ; octets relus à l’identique', async () => {
    const store = new FsFileStore(tmp());
    const body = randomBytes(1000);
    expect(await store.put('PRIVATE_EVIDENCE', 'claims/a.jpg', body)).toEqual({ status: 'STORED' });
    expect(await store.put('PRIVATE_EVIDENCE', 'claims/a.jpg', randomBytes(10))).toEqual({
      status: 'CONFLICT',
    });
    const got = await store.get('PRIVATE_EVIDENCE', 'claims/a.jpg');
    expect(got.status === 'FOUND' && got.body.equals(body)).toBe(true);
    expect(await store.get('PRIVATE_EVIDENCE', 'claims/b.jpg')).toEqual({ status: 'NOT_FOUND' });
    // aucun fichier temporaire laissé
    expect(readdirSync(join(store.root, 'PRIVATE_EVIDENCE', 'claims'))).toEqual(['a.jpg']);
  });

  it('aucun objet hors de la racine : clés ../, absolues, segments vides, bucket inconnu', async () => {
    const root = tmp();
    for (const key of ['../x', 'a/../../x', '/etc/passwd', 'a//b', 'a/./b', 'a\\b', '']) {
      expect(objectPath(root, 'KYC', key), key).toBeNull();
    }
    expect(objectPath(root, 'ELSEWHERE', 'a')).toBeNull();
    const store = new FsFileStore(root);
    expect(await store.put('KYC', '../evil', Buffer.from('x'))).toEqual({ status: 'UNAVAILABLE' });
    expect(await store.get('KYC', '../evil')).toEqual({ status: 'NOT_FOUND' });
  });
});

/** Double de `core.audit_subject_key` (rôle d'administration) : lignes en mémoire. */
class FakeAdmin implements Queryable {
  readonly rows: Record<string, unknown>[] = [];
  readonly statements: string[] = [];
  query = (async (sql: string, params?: unknown[]) => {
    this.statements.push(sql.trim().split(/\s+/)[0] ?? '');
    if (/FROM core\.audit_subject_key\s+ORDER BY/.test(sql)) return { rows: this.rows };
    if (/count\(\*\)/.test(sql)) return { rows: [{ n: String(this.rows.length) }] };
    if (/^\s*INSERT INTO core\.audit_subject_key/.test(sql)) {
      const p = params ?? [];
      this.rows.push({
        subject_type: p[0],
        subject_id: p[1],
        wrapped_dek: p[2],
        kms_key_id: p[3],
        created_at: p[4],
        destroyed_at: p[5],
        destroy_request_id: p[6],
      });
      return { rows: [] };
    }
    if (/FROM core\.audit_file_asset/.test(sql)) return { rows: this.files };
    return { rows: [] };
  }) as unknown as Queryable['query'];
  files: { bucket: string; storage_key: string }[] = [];
}

describe('export et import des clés de sujet (séquestre)', () => {
  async function sourceWithKeys(kw: LocalKeyWrapper) {
    const admin = new FakeAdmin();
    const deks = new Map<string, Buffer>();
    for (let i = 0; i < 3; i += 1) {
      const s = user();
      const dek = randomBytes(32);
      deks.set(s.id, dek);
      admin.rows.push({
        subject_type: s.type,
        subject_id: s.id,
        wrapped_dek: await kw.wrap(dek, s),
        kms_key_id: kw.keyId,
        created_at: '2071-01-01 00:00:00.123456+00',
        destroyed_at: null,
        destroy_request_id: null,
      });
    }
    admin.rows.push({
      subject_type: 'ORG',
      subject_id: randomUUID(),
      wrapped_dek: null,
      kms_key_id: kw.keyId,
      created_at: '2071-01-02 00:00:00+00',
      destroyed_at: '2071-01-03 00:00:00+00',
      destroy_request_id: randomUUID(),
    });
    return { admin, deks };
  }

  it('aller-retour : chaque DEK vivante ré-enveloppée par la nouvelle clé ; détruite reste détruite ; aucune DEK en clair dans l’export', async () => {
    const source = new LocalKeyWrapper(randomBytes(32), TEST_ENV);
    const target = new LocalKeyWrapper(randomBytes(32), TEST_ENV);
    const { admin, deks } = await sourceWithKeys(source);
    const { header, keys } = await exportSubjectKeys(
      admin,
      source,
      new EscrowSealer(escrowPair.publicKey),
    );
    expect(header).toMatchObject({ count: 4, live: 3 });
    const text = serializeKeys(header, keys);
    for (const dek of deks.values()) {
      for (const form of [dek.toString('hex'), dek.toString('base64'), dek.toString('latin1')]) {
        expect(text.includes(form)).toBe(false);
      }
    }
    const dest = new FakeAdmin();
    const r = await importSubjectKeys(
      dest,
      new EscrowOpener(escrowPair.privateKey),
      target,
      parseKeys(text),
    );
    expect(r).toEqual({ imported: 4, live: 3 });
    for (const row of dest.rows) {
      const s: SubjectRef = {
        type: row['subject_type'] as 'USER',
        id: row['subject_id'] as string,
      };
      if (row['destroyed_at'] === null) {
        expect(row['kms_key_id']).toBe(target.keyId);
        const dek = await target.unwrap(row['wrapped_dek'] as Buffer, target.keyId, s);
        expect(dek.equals(deks.get(s.id) as Buffer)).toBe(true);
        await expect(
          source.unwrap(row['wrapped_dek'] as Buffer, source.keyId, s),
        ).rejects.toBeInstanceOf(KeyWrapperRejectedError);
        expect(row['created_at']).toBe('2071-01-01 00:00:00.123456+00');
      } else {
        expect(row['wrapped_dek']).toBeNull();
        expect(row['destroy_request_id']).toMatch(/^[0-9a-f-]{36}$/);
      }
    }
    expect(dest.statements).toContain('COMMIT');
  });

  it('fail-closed : DEK illisible par la source ⇒ export refusé ; autre séquestre ou cible non vide ⇒ import refusé', async () => {
    const source = new LocalKeyWrapper(randomBytes(32), TEST_ENV);
    const { admin } = await sourceWithKeys(source);
    const wrong = new LocalKeyWrapper(randomBytes(32), TEST_ENV);
    await expect(
      exportSubjectKeys(admin, wrong, new EscrowSealer(escrowPair.publicKey)),
    ).rejects.toThrow(/export refusé/);
    expect(admin.statements).toContain('ROLLBACK');
    const ok = await exportSubjectKeys(admin, source, new EscrowSealer(escrowPair.publicKey));
    await expect(
      importSubjectKeys(new FakeAdmin(), new EscrowOpener(rsa(3072).privateKey), source, ok),
    ).rejects.toThrow(/séquestre différente/);
    const busy = new FakeAdmin();
    busy.rows.push({});
    await expect(
      importSubjectKeys(busy, new EscrowOpener(escrowPair.privateKey), source, ok),
    ).rejects.toThrow(/déjà des clés/);
    expect(busy.statements).toContain('ROLLBACK');
  });

  it('export relu : format, compte et cohérence vérifiés', async () => {
    const source = new LocalKeyWrapper(randomBytes(32), TEST_ENV);
    const { admin } = await sourceWithKeys(source);
    const { header, keys } = await exportSubjectKeys(
      admin,
      source,
      new EscrowSealer(escrowPair.publicKey),
    );
    expect(() => parseKeys('')).toThrow(/vide/);
    expect(() => parseKeys(serializeKeys({ ...header, format: 'x' as never }, keys))).toThrow(
      /format/,
    );
    expect(() => parseKeys(serializeKeys(header, keys.slice(1)))).toThrow(/incomplet/);
    const tampered = keys.map((k, i) => (i === 0 ? { ...k, escrowDek: null } : k));
    expect(() => parseKeys(serializeKeys(header, tampered))).toThrow(/séquestre/);
  });
});

describe('export et import des fichiers du registre file_asset', () => {
  it('octets copiés à l’identique, manifeste vérifié ; altération ou absence ⇒ refus', async () => {
    const source = new FsFileStore(tmp());
    const objects = [
      { bucket: 'PRIVATE_EVIDENCE', storage_key: `claims/${randomUUID()}.bin` },
      { bucket: 'PUBLIC_LISTING', storage_key: `listings/${randomUUID()}.jpg` },
    ] as const;
    const bodies = new Map<string, Buffer>();
    for (const o of objects) {
      const b = randomBytes(500);
      bodies.set(o.storage_key, b);
      await source.put(o.bucket, o.storage_key, b);
    }
    const admin = new FakeAdmin();
    admin.files = objects.map((o) => ({ ...o }));
    const exportRoot = tmp();
    const exported = new FsFileStore(exportRoot);
    const manifest = await exportFiles(admin, source, exported);
    expect(manifest.count).toBe(2);
    for (const e of manifest.entries) expect(e.sha256).toBe(sha(bodies.get(e.key) as Buffer));
    const target = new FsFileStore(tmp());
    const again = parseManifest(JSON.stringify(manifest));
    expect(await importFiles(again, exported, target)).toEqual({ imported: 2 });
    // reprise après interruption : idempotente
    expect(await importFiles(again, exported, target)).toEqual({ imported: 2 });
    for (const o of objects) {
      const got = await target.get(o.bucket, o.storage_key);
      expect(got.status === 'FOUND' && got.body.equals(bodies.get(o.storage_key) as Buffer)).toBe(
        true,
      );
    }
    // objet altéré dans l'export
    const first = manifest.entries[0];
    if (first === undefined) throw new Error('manifeste vide');
    const path = objectPath(exportRoot, first.bucket, first.key) as string;
    const bytes = readFileSync(path);
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    writeFileSync(path, bytes);
    await expect(importFiles(manifest, exported, new FsFileStore(tmp()))).rejects.toThrow(/altéré/);
    // objet du registre absent de la source
    admin.files = [{ bucket: 'KYC', storage_key: 'missing/x.bin' }];
    await expect(exportFiles(admin, source, new FsFileStore(tmp()))).rejects.toThrow(/illisible/);
  });
});

describe('outil : commandes, adaptateurs et secrets', () => {
  it('commande inconnue ; adaptateur inconnu ou absent ⇒ refus (aucun deviné)', async () => {
    expect(parseCommand('export-keys')).toBe('export-keys');
    expect(() => parseCommand('drop')).toThrow(/commande attendue/);
    expect(() => keyWrapperFromEnv({ ...TEST_ENV, RUEDA_KEY_WRAPPER: 'aws-kms' })).toThrow(/Q-007/);
    expect(() => keyWrapperFromEnv(TEST_ENV)).toThrow(/absente/);
    expect(() => fileStoreFromEnv({ RUEDA_FILE_STORE: 's3' })).toThrow(/Q-007/);
    expect(() =>
      keyWrapperFromEnv({
        RUEDA_ENV: 'production',
        RUEDA_KEY_WRAPPER: 'local',
        RUEDA_LOCAL_MASTER_KEY_FILE: 'x',
      }),
    ).toThrow(LocalAdapterForbiddenError);
  });

  it('message d’échec expurgé du mot de passe d’administration', async () => {
    const password = `pw-${randomBytes(16).toString('hex')}`;
    const err = await main(['import-keys'], {
      RUEDA_DB_ADMIN_PASSWORD: password,
      RUEDA_ESCROW_PRIVATE_KEY_FILE: join(tmp(), password),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toContain(password);
    expect(String((err as Error).stack)).not.toContain(password);
  });
});
