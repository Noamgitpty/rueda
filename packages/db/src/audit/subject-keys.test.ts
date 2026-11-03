/**
 * Clés par sujet (US-009 ; 17 §3.1.3 points 1, 2, 9) et adaptateur FAKE du KMS, sans base : un
 * exécuteur en mémoire tient lieu de `core.audit_subject_key` (le comportement SQL réel est prouvé
 * par les tests L0 sous les rôles de production).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeKeyWrapper } from '../testing/fake-audit-adapters.ts';
import { KeyWrapperRejectedError, KeyWrapperUnavailableError } from './key-wrapper.ts';
import type { SubjectRef } from './envelope.ts';
import { SubjectKeyStore } from './subject-keys.ts';
import type { Queryable } from './subject-keys.ts';

const ALICE: SubjectRef = { type: 'USER', id: '0a0a0a0a-0000-4000-8000-000000000001' };
const BOB: SubjectRef = { type: 'USER', id: '0b0b0b0b-0000-4000-8000-000000000002' };

interface Row {
  wrapped_dek: Buffer | null;
  kms_key_id: string;
  destroyed_at: Date | null;
}

/** Table `subject_key` en mémoire : SELECT par clé, INSERT … ON CONFLICT DO NOTHING. */
function memoryDb(): Queryable & { rows: Map<string, Row>; inserts: number } {
  const rows = new Map<string, Row>();
  const db = {
    rows,
    inserts: 0,
    async query(text: string, params: unknown[]) {
      const key = `${String(params[0])}:${String(params[1])}`;
      if (text.includes('INSERT INTO core.audit_subject_key')) {
        db.inserts++;
        if (!rows.has(key)) {
          rows.set(key, {
            wrapped_dek: params[2] as Buffer,
            kms_key_id: params[3] as string,
            destroyed_at: null,
          });
        }
        return { rows: [] };
      }
      const row = rows.get(key);
      return { rows: row === undefined ? [] : [row] };
    },
  };
  return db as unknown as Queryable & { rows: Map<string, Row>; inserts: number };
}

describe('FakeKeyWrapper (FAKE, tests seulement)', () => {
  it('aller-retour ; liée au sujet ; une autre instance (autre clé maîtresse) ne déroule pas', async () => {
    const kms = new FakeKeyWrapper({});
    const dek = randomBytes(32);
    const wrapped = await kms.wrap(dek, ALICE);
    expect(wrapped.includes(dek)).toBe(false);
    expect(await kms.unwrap(wrapped, kms.keyId, ALICE)).toEqual(dek);
    await expect(kms.unwrap(wrapped, kms.keyId, BOB)).rejects.toBeInstanceOf(
      KeyWrapperRejectedError,
    );
    const other = new FakeKeyWrapper({});
    expect(other.keyId).not.toBe(kms.keyId);
    await expect(other.unwrap(wrapped, kms.keyId, ALICE)).rejects.toBeInstanceOf(
      KeyWrapperRejectedError,
    );
    await expect(other.unwrap(wrapped, other.keyId, ALICE)).rejects.toBeInstanceOf(
      KeyWrapperRejectedError,
    );
  });

  it('panne simulée : KeyWrapperUnavailableError', async () => {
    const kms = new FakeKeyWrapper({});
    kms.setAvailable(false);
    await expect(kms.wrap(randomBytes(32), ALICE)).rejects.toBeInstanceOf(
      KeyWrapperUnavailableError,
    );
  });

  it('refusé en production (C19)', () => {
    expect(() => new FakeKeyWrapper({ NODE_ENV: 'production' })).toThrow(/production/);
  });
});

describe('SubjectKeyStore', () => {
  it('crée la clé au premier besoin, puis la réutilise ; une clé par sujet', async () => {
    const db = memoryDb();
    const keys = new SubjectKeyStore(new FakeKeyWrapper({}));
    const a1 = await keys.dekFor(db, ALICE, 'create');
    const a2 = await keys.dekFor(db, ALICE, 'create');
    const b = await keys.dekFor(db, BOB, 'create');
    expect(a1.status).toBe('OK');
    if (a1.status !== 'OK' || a2.status !== 'OK' || b.status !== 'OK') return;
    expect(a1.dek).toEqual(a2.dek);
    expect(a1.dek).not.toEqual(b.dek);
    expect(db.inserts).toBe(2);
    // seule la DEK ENVELOPPÉE est en base
    const stored = db.rows.get(`USER:${ALICE.id}`);
    expect(stored?.wrapped_dek?.includes(a1.dek)).toBe(false);
  });

  it('lecture sans clé : ABSENT, rien n’est créé', async () => {
    const db = memoryDb();
    const keys = new SubjectKeyStore(new FakeKeyWrapper({}));
    expect(await keys.dekFor(db, ALICE, 'read')).toEqual({ status: 'ABSENT' });
    expect(db.inserts).toBe(0);
  });

  it('enveloppe rejetée (clé empoisonnée pour un sujet tiers) : WITHHELD, pas d’exception', async () => {
    const db = memoryDb();
    db.rows.set(`USER:${ALICE.id}`, {
      wrapped_dek: randomBytes(48), // octets quelconques insérés par une session fautive
      kms_key_id: 'fake-kms/000000000000',
      destroyed_at: null,
    });
    const keys = new SubjectKeyStore(new FakeKeyWrapper({}));
    expect(await keys.dekFor(db, ALICE, 'create')).toEqual({ status: 'WITHHELD' });
    expect(await keys.dekFor(db, ALICE, 'read')).toEqual({ status: 'WITHHELD' });
  });

  it('cache : pas de second appel au KMS avant l’échéance ; KMS en panne ⇒ cache utilisé puis WITHHELD', async () => {
    const db = memoryDb();
    const kms = new FakeKeyWrapper({});
    let t = 0;
    const keys = new SubjectKeyStore(kms, { cacheTtlMs: 300_000, clock: () => t });
    await keys.dekFor(db, ALICE, 'create');
    expect(kms.unwrapCalls).toBe(1);
    kms.setAvailable(false);
    t = 299_999;
    expect((await keys.dekFor(db, ALICE, 'create')).status).toBe('OK');
    expect(kms.unwrapCalls).toBe(1);
    t = 300_000;
    expect(await keys.dekFor(db, ALICE, 'create')).toEqual({ status: 'WITHHELD' });
    // nouveau sujet pendant la panne : rien n'est écrit, WITHHELD
    expect(await keys.dekFor(db, BOB, 'create')).toEqual({ status: 'WITHHELD' });
    expect(db.rows.has(`USER:${BOB.id}`)).toBe(false);
  });

  it('clé détruite : DESTROYED même si la DEK est en cache (la base est relue à chaque appel)', async () => {
    const db = memoryDb();
    const keys = new SubjectKeyStore(new FakeKeyWrapper({}));
    await keys.dekFor(db, ALICE, 'create');
    db.rows.set(`USER:${ALICE.id}`, {
      wrapped_dek: null,
      kms_key_id: 'x',
      destroyed_at: new Date(0),
    });
    expect(await keys.dekFor(db, ALICE, 'create')).toEqual({ status: 'DESTROYED' });
    expect(await keys.dekFor(db, ALICE, 'read')).toEqual({ status: 'DESTROYED' });
  });

  it('la DEK rendue est une copie : la remettre à zéro n’abîme pas le cache', async () => {
    const db = memoryDb();
    const keys = new SubjectKeyStore(new FakeKeyWrapper({}));
    const first = await keys.dekFor(db, ALICE, 'create');
    if (first.status !== 'OK') throw new Error('attendu OK');
    const copy = Buffer.from(first.dek);
    first.dek.fill(0);
    const again = await keys.dekFor(db, ALICE, 'read');
    expect(again).toEqual({ status: 'OK', dek: copy });
  });
});
