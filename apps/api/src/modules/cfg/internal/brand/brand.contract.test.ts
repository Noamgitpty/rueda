/**
 * US-041 — tests de contrat de la lecture publique du socle de marque (US-034) : chaque réponse
 * HTTP réelle (Nest sur 127.0.0.1, sans base) est confrontée à `apps/api/openapi/openapi.json`
 * par `ContractClient`, qui échoue au premier écart. Données fictives, une par pays configuré
 * (graines PA / PY lues dans les données CFG, jamais écrites en constantes).
 */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { paletteDocument } from '@rueda/design-tokens';
import { InMemoryFileStore } from '@rueda/fake-adapters/files';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countryCases } from '../../../../../test/support/countries.js';
import { ContractClient, repositoryContract } from '../../../../testing/openapi-contract.js';
import { BrandModule } from './brand.module.js';
import { loadBrandParams } from './params.js';
import type { BrandStore, PublicAsset, PublishedBlock, PublishedVersion } from './store.js';

const VERSION_ID = '00000000-0000-4000-8000-0000000000a1';
const LOGO_ID = '00000000-0000-4000-8000-0000000000b1';
const MISSING_FILE_ID = '00000000-0000-4000-8000-0000000000b2';
const UNKNOWN_ID = '00000000-0000-4000-8000-0000000000c9';
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(24, 7)]);
const ALT = { es: 'Logotipo', en: 'Logo', fr: 'Logo', pt: null } as const;

/** Lectures publiques seulement ; toute écriture est hors du périmètre de ce contrat. */
class ReadOnlyStore implements BrandStore {
  constructor(private readonly published: PublishedVersion | null) {}
  #refuse(): never {
    throw new Error('écriture hors du contrat de lecture');
  }
  registerAsset = () => this.#refuse();
  saveDraft = () => this.#refuse();
  publish = () => this.#refuse();
  rollback = () => this.#refuse();
  staffVersions = () => this.#refuse();
  saveContentDraft = () => this.#refuse();
  publishContent = () => this.#refuse();
  rollbackContent = () => this.#refuse();
  publishedVersion(): Promise<PublishedVersion | null> {
    return Promise.resolve(this.published);
  }
  publicAssets(): Promise<PublicAsset[]> {
    const asset = (id: string): PublicAsset => ({
      id,
      kind: 'LOGO',
      storageKey: `brand/${id}`,
      mime: 'image/png',
      bytes: PNG.length,
      sha256: Buffer.alloc(32, 0xab),
      alt: ALT,
    });
    return Promise.resolve([asset(LOGO_ID), asset(MISSING_FILE_ID)]);
  }
  publishedBlocks(country: string | null): Promise<PublishedBlock[]> {
    const block = (locale: 'es' | 'en', c: string | null, bodyMd: string): PublishedBlock => ({
      blockKey: 'home.hero',
      locale,
      countryCode: c,
      versionNo: 2,
      bodyMd,
      assetId: null,
    });
    return Promise.resolve([
      block('es', null, 'Texto **común**'),
      block('en', null, 'Shared text'),
      ...(country === null ? [] : [block('es', country, `Texto de ${country}`)]),
    ]);
  }
}

describe('contrat HTTP — /brand (lecture publique)', () => {
  const contract = repositoryContract();
  const apps: INestApplication[] = [];
  let published: ContractClient;
  let empty: ContractClient;

  async function start(store: BrandStore): Promise<ContractClient> {
    const files = new InMemoryFileStore();
    await files.put('BRAND', `brand/${LOGO_ID}`, PNG);
    const nest = await NestFactory.create(
      BrandModule.register({ store, files, params: loadBrandParams(), nowMs: () => 0 }),
      { logger: false },
    );
    await nest.listen(0, '127.0.0.1');
    apps.push(nest);
    return new ContractClient(contract, (await nest.getUrl()).replace('[::1]', '127.0.0.1'));
  }

  beforeAll(async () => {
    published = await start(
      new ReadOnlyStore({
        id: VERSION_ID,
        versionNo: 3,
        brandName: 'Kmino',
        tokens: paletteDocument('lienzo-tinta') as unknown as Record<string, unknown>,
        tokensSchemaVersion: 1,
        logoAssetId: LOGO_ID,
        faviconAssetId: null,
        pwaIconAssetId: null,
        publishedAt: new Date(Date.UTC(2026, 10, 3, 12)),
      }),
    );
    empty = await start(new ReadOnlyStore(null));
  });
  afterAll(async () => {
    for (const app of apps.splice(0)) await app.close();
  });

  it('GET /brand : 200 (version, actifs, ETag), 304 si inchangée, 503 sans version publiée', async () => {
    const ok = await published.request('GET', '/brand');
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({
      versionNo: 3,
      assets: { logo: { id: LOGO_ID }, favicon: null },
    });
    const same = await published.request('GET', '/brand', {
      headers: { 'if-none-match': ok.headers.get('etag') ?? '' },
    });
    expect(same.status).toBe(304);
    expect((await empty.request('GET', '/brand')).status).toBe(503);
  });

  it.each(countryCases().map((c) => c.country))(
    'GET /brand/content (pays %s) : 200 dans les quatre langues, repli es signalé',
    async (country) => {
      for (const locale of ['es', 'en', 'fr', 'pt']) {
        const r = await published.request(
          'GET',
          `/brand/content?locale=${locale}&country=${country}`,
        );
        expect(r.status).toBe(200);
        const blocks = (r.json as { blocks: Array<{ fallback: boolean; country: string | null }> })
          .blocks;
        expect(blocks).toHaveLength(1);
        // blocs publiés en es (pays et commun) et en (commun) : fr et pt retombent sur es du pays
        expect(blocks[0]?.fallback).toBe(locale === 'fr' || locale === 'pt');
        expect(blocks[0]?.country).toBe(locale === 'en' ? null : country);
      }
    },
  );

  it('GET /brand/content : 400 REQUEST_INVALID (langue absente, inconnue, pays mal formé)', async () => {
    for (const query of ['', '?locale=de', '?locale=es&country=x1', '?locale=es&country=XYZ']) {
      const r = await published.request('GET', `/brand/content${query}`);
      expect(r.status).toBe(400);
    }
  });

  it('GET /brand/assets/{id} : 200 octets PNG, 400, 404, 503 (stockage sans l’objet)', async () => {
    const ok = await published.request('GET', `/brand/assets/${LOGO_ID}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect((await published.request('GET', '/brand/assets/pas-un-uuid')).status).toBe(400);
    expect((await published.request('GET', `/brand/assets/${UNKNOWN_ID}`)).status).toBe(404);
    expect((await published.request('GET', `/brand/assets/${MISSING_FILE_ID}`)).status).toBe(503);
  });

  it('couverture : chaque statut déclaré pour /brand est exercé', () => {
    const covered = new Set([...published.covered, ...empty.covered]);
    const declared = Object.entries(contract.document.paths)
      .filter(([template]) => template.startsWith('/brand'))
      .flatMap(([template, item]) =>
        Object.keys(item['get']?.responses ?? {}).map((s) => `GET ${template} ${s}`),
      );
    expect(declared.filter((d) => !covered.has(d))).toEqual([]);
  });
});
