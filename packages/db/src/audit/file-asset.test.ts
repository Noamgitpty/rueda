/**
 * Empreinte à la réception (US-009 ; 17 §1.7, CLM-034). Oracle : vecteurs de FIPS 180-2
 * (« abc », chaîne vide) ; pas le code testé.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryFileStore } from '../testing/fake-audit-adapters.ts';
import { FileAssetError, sha256Stream } from './file-asset.ts';

async function* chunks(...parts: string[]): AsyncIterable<Uint8Array> {
  for (const p of parts) yield Buffer.from(p, 'utf8');
}

describe('sha256Stream', () => {
  it('vecteurs FIPS 180-2, en un ou plusieurs morceaux', async () => {
    const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect((await sha256Stream(chunks('abc'))).sha256.toString('hex')).toBe(abc);
    expect((await sha256Stream(chunks('a', 'b', 'c'))).sha256.toString('hex')).toBe(abc);
    const empty = await sha256Stream(chunks());
    expect(empty.sha256.toString('hex')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(empty.bytes).toBe(0);
  });

  it('taille comptée ; au-delà de maxBytes : refus', async () => {
    expect((await sha256Stream(chunks('ab', 'cd'))).bytes).toBe(4);
    await expect(sha256Stream(chunks('ab', 'cd'), 3)).rejects.toBeInstanceOf(FileAssetError);
  });
});

describe('InMemoryFileStore (FAKE)', () => {
  it('copie à l’entrée et à la sortie ; altération simulée ; refusé en production', async () => {
    const store = new InMemoryFileStore({});
    const body = Buffer.from('preuve');
    await store.put('PRIVATE_EVIDENCE', 'k', body);
    body[0] = 0;
    expect((await store.get('PRIVATE_EVIDENCE', 'k')).toString()).toBe('preuve');
    store.corrupt('PRIVATE_EVIDENCE', 'k');
    expect((await store.get('PRIVATE_EVIDENCE', 'k')).toString()).not.toBe('preuve');
    expect(() => new InMemoryFileStore({ NODE_ENV: 'production' })).toThrow(/production/);
  });
});
