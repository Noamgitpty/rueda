import { describe, expect, it } from 'vitest';
import {
  FAKE_MALWARE_MARKER,
  FakeUploadScanner,
  InMemoryFileStore,
  sniffMime,
} from '../src/files/index.ts';
import { clock } from './support.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PDF = Buffer.from('%PDF-1.7\n...', 'latin1');
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.alloc(4),
  Buffer.from('WEBPVP8 ', 'latin1'),
]);

describe('InMemoryFileStore (port FileStore d’AUD)', () => {
  it('réussite : dépôt puis lecture ; octets copiés (pas de partage de mémoire)', async () => {
    const store = new InMemoryFileStore();
    const body = Buffer.from('preuve');
    expect(await store.put('PRIVATE_EVIDENCE', 'k', body)).toEqual({ status: 'STORED' });
    body[0] = 0;
    const got = await store.get('PRIVATE_EVIDENCE', 'k');
    expect(got.status === 'FOUND' && got.body.toString()).toBe('preuve');
  });

  it('création seule : un second dépôt sous la même clé ⇒ CONFLICT, le premier objet est intact', async () => {
    const store = new InMemoryFileStore();
    await store.put('PRIVATE_EVIDENCE', 'k', Buffer.from('preuve'));
    expect(await store.put('PRIVATE_EVIDENCE', 'k', Buffer.from('autre'))).toEqual({
      status: 'CONFLICT',
    });
    expect(store.raw('PRIVATE_EVIDENCE', 'k')?.toString()).toBe('preuve');
    // même clé dans un autre bucket : autre objet
    expect(await store.put('KYC', 'k', Buffer.from('x'))).toEqual({ status: 'STORED' });
  });

  it('échec : panne, refus, délai dépassé avant dépôt ⇒ rien n’est déposé', async () => {
    const store = new InMemoryFileStore();
    store.script.script(
      'put',
      { kind: 'UNAVAILABLE' },
      { kind: 'REFUSE', reason: 'QUOTA' },
      { kind: 'TIMEOUT_BEFORE' },
    );
    expect(await store.put('DOCUMENTS', 'k', Buffer.from('a'))).toEqual({ status: 'UNAVAILABLE' });
    expect(await store.put('DOCUMENTS', 'k', Buffer.from('a'))).toEqual({ status: 'UNAVAILABLE' });
    expect(await store.put('DOCUMENTS', 'k', Buffer.from('a'))).toEqual({ status: 'TIMEOUT' });
    expect(store.raw('DOCUMENTS', 'k')).toBeUndefined();
  });

  it('issue inconnue : TIMEOUT_AFTER dépose l’objet ; un nouveau dépôt rencontre alors CONFLICT', async () => {
    const store = new InMemoryFileStore();
    store.script.script('put', { kind: 'TIMEOUT_AFTER' });
    expect(await store.put('DOCUMENTS', 'k', Buffer.from('a'))).toEqual({ status: 'TIMEOUT' });
    expect(store.raw('DOCUMENTS', 'k')?.toString()).toBe('a');
    expect(await store.put('DOCUMENTS', 'k', Buffer.from('a'))).toEqual({ status: 'CONFLICT' });
  });

  it('doublon : la requête part deux fois, l’appelant reçoit CONFLICT alors que son objet est en place', async () => {
    const store = new InMemoryFileStore();
    store.script.script('put', { kind: 'DUPLICATE' });
    expect(await store.put('DOCUMENTS', 'k', Buffer.from('a'))).toEqual({ status: 'CONFLICT' });
    expect(store.raw('DOCUMENTS', 'k')?.toString()).toBe('a');
  });

  it('lecture : absent, perdu, en panne, en retard ; altération', async () => {
    const c = clock();
    const store = new InMemoryFileStore({ clock: c });
    expect(await store.get('KYC', 'absent')).toEqual({ status: 'NOT_FOUND' });
    await store.put('KYC', 'k', Buffer.from('abc'));
    store.script.script(
      'get',
      { kind: 'UNAVAILABLE' },
      { kind: 'TIMEOUT_AFTER' },
      { kind: 'DELAY', ms: 2_000 },
    );
    expect(await store.get('KYC', 'k')).toEqual({ status: 'UNAVAILABLE' });
    expect(await store.get('KYC', 'k')).toEqual({ status: 'TIMEOUT' });
    expect((await store.get('KYC', 'k')).status).toBe('FOUND');
    expect(c.now().toISOString()).toBe('2026-11-03T12:00:02.000Z');
    store.corrupt('KYC', 'k');
    const got = await store.get('KYC', 'k');
    expect(got.status === 'FOUND' && got.body.toString()).not.toBe('abc');
    store.lose('KYC', 'k');
    expect(await store.get('KYC', 'k')).toEqual({ status: 'NOT_FOUND' });
  });
});

describe('FakeUploadScanner (port UploadScanner d’AUD)', () => {
  it('détection du type réel par signature d’octets', () => {
    expect([PNG, JPEG, PDF, WEBP].map(sniffMime)).toEqual([
      'image/png',
      'image/jpeg',
      'application/pdf',
      'image/webp',
    ]);
    expect(sniffMime(Buffer.from('texte'))).toBeNull();
  });

  it('réussite : fichier sain du type déclaré ⇒ CLEAN ; doublon de requête ⇒ même verdict', async () => {
    const scanner = new FakeUploadScanner();
    scanner.script.script('scan', { kind: 'DUPLICATE' });
    const a = await scanner.scan({ declaredMime: 'image/jpeg', body: JPEG });
    const b = await scanner.scan({ declaredMime: 'IMAGE/JPEG', body: JPEG });
    expect(a).toEqual({
      status: 'SCANNED',
      report: { verdict: 'CLEAN', detectedMime: 'image/jpeg', threat: null },
    });
    expect(b).toEqual(a);
  });

  it('refus : type déclaré mensonger, type inconnu, contenu malveillant, menace scriptée', async () => {
    const scanner = new FakeUploadScanner();
    expect(await scanner.scan({ declaredMime: 'image/jpeg', body: PDF })).toMatchObject({
      report: { verdict: 'MIME_MISMATCH', detectedMime: 'application/pdf' },
    });
    expect(
      await scanner.scan({ declaredMime: 'text/plain', body: Buffer.from('bonjour') }),
    ).toMatchObject({ report: { verdict: 'UNSUPPORTED_TYPE' } });
    const infected = Buffer.concat([PNG, Buffer.from(FAKE_MALWARE_MARKER, 'latin1')]);
    expect(await scanner.scan({ declaredMime: 'image/png', body: infected })).toMatchObject({
      report: { verdict: 'INFECTED', threat: FAKE_MALWARE_MARKER },
    });
    scanner.script.script('scan', { kind: 'REFUSE', reason: 'Fake.Trojan' });
    expect(await scanner.scan({ declaredMime: 'image/png', body: PNG })).toMatchObject({
      report: { verdict: 'INFECTED', threat: 'Fake.Trojan' },
    });
  });

  it('échec et délai : panne, délai dépassé, réponse lente', async () => {
    const c = clock();
    const scanner = new FakeUploadScanner({ clock: c });
    scanner.script.script(
      'scan',
      { kind: 'UNAVAILABLE' },
      { kind: 'TIMEOUT_BEFORE' },
      { kind: 'DELAY', ms: 30_000 },
    );
    expect(await scanner.scan({ declaredMime: 'image/png', body: PNG })).toEqual({
      status: 'UNAVAILABLE',
    });
    expect(await scanner.scan({ declaredMime: 'image/png', body: PNG })).toEqual({
      status: 'TIMEOUT',
    });
    expect((await scanner.scan({ declaredMime: 'image/png', body: PNG })).status).toBe('SCANNED');
    expect(c.now().toISOString()).toBe('2026-11-03T12:00:30.000Z');
  });
});
