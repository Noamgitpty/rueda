/**
 * US-034 — socle de marque côté API, sans base : paramètres, contrôles (format, polices
 * approuvées, contraste d'US-030 réutilisé, règles du contenu), services (le contrôle précède
 * l'appel à la base, le cache est vidé à la publication) et API de lecture publique.
 *
 * Oracles : README de @rueda/design-tokens (US-030) — Lienzo · Azur est refusée, « lien primary sur
 * verre 3,89:1 (clair) » ; Lienzo · Tinta est acceptée. 17 §3.2.13 (clés `legal.*` refusées,
 * Markdown restreint, repli `es` signalé). La base elle-même est prouvée par test:l0 et test:int.
 */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PALETTE_IDS, paletteDocument } from '@rueda/design-tokens';
import { InMemoryFileStore } from '@rueda/fake-adapters/files';
import { afterEach, describe, expect, it } from 'vitest';
import { BrandModule } from './brand.module.js';
import { BrandConsoleService, BrandReadService, sniffBrandMime } from './brand.service.js';
import type { BrandOptions } from './brand.service.js';
import {
  assertBlockKey,
  assertBodies,
  bodyProblem,
  contrastReport,
  themeOf,
  unapprovedFonts,
} from './checks.js';
import type { ContentLocale, ContrastReport } from './checks.js';
import { BrandError } from './errors.js';
import { loadBrandParams, parseBrandParams } from './params.js';
import type {
  BrandStore,
  ContentOutcome,
  PublicAsset,
  PublishedBlock,
  PublishedVersion,
  RegisterAssetInput,
  SaveDraftInput,
  StaffVersion,
  VersionOutcome,
} from './store.js';

const PARAMS = loadBrandParams();
const HASH = Buffer.alloc(32, 1);
let n = 0;
const id = (): string => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

/** Base en mémoire : mêmes issues que les commandes de 0042 (version simplifiée, sans droits). */
class MemoryStore implements BrandStore {
  readonly versions: StaffVersion[] = [];
  readonly calls: string[] = [];
  readonly blocks: Array<PublishedBlock & { status: string }> = [];
  outcome: string | null = null;

  registerAsset(_h: Buffer, i: RegisterAssetInput) {
    this.calls.push('registerAsset');
    return Promise.resolve({
      outcome: this.outcome ?? 'REGISTERED',
      assetId: i.assetId,
      storageKey: `brand/${i.assetId}`,
    });
  }
  saveDraft(_h: Buffer, i: SaveDraftInput): Promise<VersionOutcome> {
    this.calls.push('saveDraft');
    if (this.outcome !== null)
      return Promise.resolve({ outcome: this.outcome, versionId: null, versionNo: null });
    const v: StaffVersion = {
      id: i.versionId,
      versionNo: this.versions.length + 1,
      status: 'DRAFT',
      brandName: i.brandName,
      tokens: i.tokens,
      tokensSchemaVersion: i.tokensSchemaVersion,
      logoAssetId: i.logoAssetId,
      faviconAssetId: i.faviconAssetId,
      pwaIconAssetId: i.pwaIconAssetId,
      contrastCheck: null,
      copiedFromId: i.copiedFromId,
      createdBy: 'u',
      createdAt: new Date(),
      publishedBy: null,
      publishedAt: null,
      archivedAt: null,
    };
    this.versions.push(v);
    return Promise.resolve({ outcome: 'SAVED', versionId: v.id, versionNo: v.versionNo });
  }
  #swap(target: StaffVersion, report: ContrastReport): void {
    const i = this.versions.findIndex((v) => v.status === 'PUBLISHED');
    const old = this.versions[i];
    if (old !== undefined)
      this.versions[i] = { ...old, status: 'ARCHIVED', archivedAt: new Date() };
    const j = this.versions.indexOf(target);
    this.versions[j] = {
      ...target,
      status: 'PUBLISHED',
      contrastCheck: report as unknown as Record<string, unknown>,
      publishedAt: new Date(Date.now() + j),
    };
  }
  publish(
    _h: Buffer,
    _r: string,
    versionId: string,
    report: ContrastReport,
  ): Promise<VersionOutcome> {
    this.calls.push(`publish:${String(report.passed)}`);
    const t = this.versions.find((v) => v.id === versionId);
    if (t === undefined)
      return Promise.resolve({ outcome: 'NOT_FOUND', versionId: null, versionNo: null });
    if (t.status !== 'DRAFT')
      return Promise.resolve({ outcome: 'NOT_DRAFT', versionId, versionNo: t.versionNo });
    if (!report.passed || report.failures.length > 0) {
      return Promise.resolve({
        outcome: 'CONTRAST_INSUFFICIENT',
        versionId,
        versionNo: t.versionNo,
      });
    }
    this.#swap(t, report);
    return Promise.resolve({ outcome: 'PUBLISHED', versionId, versionNo: t.versionNo });
  }
  rollback(_h: Buffer, requestId: string, newId: string, targetId: string, report: ContrastReport) {
    this.calls.push(`rollback:${String(report.passed)}`);
    const t = this.versions.find((v) => v.id === targetId);
    if (t === undefined)
      return Promise.resolve({ outcome: 'NOT_FOUND', versionId: null, versionNo: null });
    if (t.status !== 'ARCHIVED')
      return Promise.resolve({ outcome: 'NOT_ARCHIVED', versionId: t.id, versionNo: t.versionNo });
    if (!report.passed)
      return Promise.resolve({
        outcome: 'CONTRAST_INSUFFICIENT',
        versionId: t.id,
        versionNo: t.versionNo,
      });
    const copy: StaffVersion = {
      ...t,
      id: newId,
      versionNo: this.versions.length + 1,
      status: 'DRAFT',
      copiedFromId: t.id,
    };
    this.versions.push(copy);
    this.#swap(copy, report);
    void requestId;
    return Promise.resolve({ outcome: 'ROLLED_BACK', versionId: newId, versionNo: copy.versionNo });
  }
  staffVersions(_h: Buffer, versionId: string | null, limit: number) {
    this.calls.push('staffVersions');
    return Promise.resolve(
      [...this.versions]
        .filter((v) => versionId === null || v.id === versionId)
        .sort((a, b) => b.versionNo - a.versionNo)
        .slice(0, limit),
    );
  }
  saveContentDraft(): Promise<ContentOutcome> {
    this.calls.push('saveContentDraft');
    return Promise.resolve({ outcome: this.outcome ?? 'SAVED', versionNo: 1 });
  }
  publishContent(): Promise<ContentOutcome> {
    this.calls.push('publishContent');
    return Promise.resolve({ outcome: this.outcome ?? 'PUBLISHED', versionNo: 1 });
  }
  rollbackContent(): Promise<ContentOutcome> {
    this.calls.push('rollbackContent');
    return Promise.resolve({ outcome: this.outcome ?? 'ROLLED_BACK', versionNo: 3 });
  }
  publishedVersion(): Promise<PublishedVersion | null> {
    this.calls.push('publishedVersion');
    const v = this.versions.find((x) => x.status === 'PUBLISHED');
    return Promise.resolve(
      v === undefined
        ? null
        : {
            id: v.id,
            versionNo: v.versionNo,
            brandName: v.brandName,
            tokens: v.tokens,
            tokensSchemaVersion: v.tokensSchemaVersion,
            logoAssetId: v.logoAssetId,
            faviconAssetId: v.faviconAssetId,
            pwaIconAssetId: v.pwaIconAssetId,
            publishedAt: v.publishedAt ?? new Date(),
          },
    );
  }
  publicAssets(): Promise<PublicAsset[]> {
    return Promise.resolve([]);
  }
  publishedBlocks(country: string | null): Promise<PublishedBlock[]> {
    this.calls.push('publishedBlocks');
    return Promise.resolve(
      this.blocks.filter(
        (b) => b.status === 'PUBLISHED' && (b.countryCode === null || b.countryCode === country),
      ),
    );
  }
}

function setup(nowMs = () => 0): {
  store: MemoryStore;
  console: BrandConsoleService;
  read: BrandReadService;
  options: BrandOptions;
} {
  const store = new MemoryStore();
  const options: BrandOptions = {
    store,
    files: new InMemoryFileStore(),
    params: PARAMS,
    newId: id,
    nowMs,
  };
  const read = new BrandReadService(options);
  return { store, console: new BrandConsoleService(options, read), read, options };
}

async function rejection(p: Promise<unknown>): Promise<BrandError> {
  try {
    await p;
  } catch (error) {
    if (error instanceof BrandError) return error;
    throw error;
  }
  throw new Error('aucune erreur');
}

describe('paramètres de marque (data/brand.json)', () => {
  it('le fichier du dépôt est valide ; les polices de Tinta sont approuvées', () => {
    expect(PARAMS.approvedFonts.map((f) => f.family)).toEqual(
      expect.arrayContaining(['Bricolage Grotesque', 'Manrope']),
    );
    expect(PARAMS.readCacheTtlMs).toBeLessThan(60_000);
  });

  it('toutes les polices des palettes du registre sont approuvées (retour à une ancienne palette)', () => {
    for (const paletteId of PALETTE_IDS) {
      expect(unapprovedFonts(themeOf(paletteDocument(paletteId)), PARAMS), paletteId).toEqual([]);
    }
  });

  it.each([
    [{}],
    [{ version: 1, approvedFonts: 'Inter', readCacheTtlSeconds: 30, assetMaxBytes: 10 }],
    [
      {
        version: 1,
        approvedFonts: [{ family: 'Inter' }],
        readCacheTtlSeconds: 30,
        assetMaxBytes: 10,
      },
    ],
    [{ version: 1, approvedFonts: [], readCacheTtlSeconds: 120, assetMaxBytes: 10 }],
  ])('document mal formé : CONFIG_INVALID (fail-closed)', (raw) => {
    expect(() => parseBrandParams(raw)).toThrow(/CONFIG_INVALID/);
  });
});

describe('contrôles (US-030 réutilisé, polices, contenu)', () => {
  it('Tinta : format, polices et contraste conformes', () => {
    const theme = themeOf(paletteDocument('lienzo-tinta'));
    expect(unapprovedFonts(theme, PARAMS)).toEqual([]);
    expect(contrastReport(theme)).toMatchObject({ passed: true, failures: [] });
  });

  it('Azur : refusée par le contrôle d’US-030 et la paire est nommée (primary / glass, clair, 3,89:1)', () => {
    const report = contrastReport(themeOf(paletteDocument('lienzo-azur')));
    expect(report.passed).toBe(false);
    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mode: 'light', pair: 'primary / glass', ratio: 3.89 }),
      ]),
    );
  });

  it('police hors liste : signalée', () => {
    const doc = paletteDocument('lienzo-tinta');
    ((doc['font'] as Record<string, Record<string, Record<string, unknown>>>)['family'] ?? {})[
      'body'
    ] = {
      $value: ['Comic Neue', 'sans-serif'],
      $type: 'fontFamily',
    };
    expect(unapprovedFonts(themeOf(doc), PARAMS)).toEqual(['Comic Neue']);
  });

  it('jetons mal formés : BRAND_TOKENS_INVALID avec les défauts', () => {
    const e = (() => {
      try {
        themeOf({ meta: {} });
      } catch (error) {
        return error as BrandError;
      }
      return null;
    })();
    expect(e?.code).toBe('BRAND_TOKENS_INVALID');
    expect((e?.details?.['problems'] as string[]).length).toBeGreaterThan(0);
  });

  it('clés : legal.* refusée (CONTENT_KEY_FORBIDDEN), format strict', () => {
    expect(assertBlockKey('home.hero.title')).toBe('home.hero.title');
    expect(() => assertBlockKey('legal.terms')).toThrow(/CONTENT_KEY_FORBIDDEN/);
    for (const bad of ['Home.hero', 'home', 'home..x', 'home.<x>']) {
      expect(() => assertBlockKey(bad), bad).toThrow(/REQUEST_INVALID/);
    }
  });

  it('corps : trois langues exigées (CONTENT_BLOCK_REQUIRED_MISSING), Markdown restreint', () => {
    expect(() => assertBodies({ es: 'Hola', en: 'Hello' })).toThrow(
      /CONTENT_BLOCK_REQUIRED_MISSING.*fr/,
    );
    expect(() => assertBodies({ es: 'Hola', en: 'Hello', fr: 'Salut', de: 'Hallo' })).toThrow(
      /REQUEST_INVALID/,
    );
    expect(
      assertBodies({ es: 'Ver [ayuda](/ayuda)', en: 'See [help](#help)', fr: 'Voir **ici**.' }),
    ).toMatchObject({
      es: 'Ver [ayuda](/ayuda)',
    });
    for (const [body, label] of [
      ['<script>x</script>', 'balise HTML'],
      ['<img src=x onerror=y>', 'balise HTML'],
      ['[x](https://ext.example)', 'URL absolue'],
      ['[x](javascript:alert(1))', 'lien hors du site'],
      ['[x](//ext.example)', 'lien hors du site'],
      ['visite www.example.test', 'URL nue'],
      ['[x][1]', 'lien par référence'],
      ['texte\n[1]: /a', 'définition de lien'],
    ] as const) {
      expect(bodyProblem(body), body).toBe(label);
    }
    expect(bodyProblem('Ratio 3:1 et a < b')).toBeNull();
  });

  it('type réel des octets (signatures PNG, JPEG, WebP, WOFF2) ; SVG inconnu', () => {
    expect(sniffBrandMime(Buffer.from('89504e470d0a1a0a00', 'hex'))).toBe('image/png');
    expect(sniffBrandMime(Buffer.from('ffd8ffe0', 'hex'))).toBe('image/jpeg');
    expect(sniffBrandMime(Buffer.from('RIFF0000WEBPVP8 ', 'latin1'))).toBe('image/webp');
    expect(sniffBrandMime(Buffer.from('wOF2rest', 'latin1'))).toBe('font/woff2');
    expect(sniffBrandMime(Buffer.from('<svg xmlns="x"/>', 'utf8'))).toBeNull();
  });
});

describe('BrandConsoleService : le contrôle précède la base', () => {
  it('police hors liste : FONT_NOT_APPROVED, aucune écriture', async () => {
    const { store, console } = setup();
    const doc = paletteDocument('lienzo-tinta');
    ((doc['font'] as Record<string, Record<string, Record<string, unknown>>>)['family'] ?? {})[
      'heading'
    ] = {
      $value: ['Papyrus', 'serif'],
      $type: 'fontFamily',
    };
    const e = await rejection(
      console.saveDraft(HASH, { requestId: id(), brandName: 'Kmino', tokens: doc }),
    );
    expect(e.code).toBe('FONT_NOT_APPROVED');
    expect(e.details).toEqual({ fonts: ['Papyrus'] });
    expect(store.calls).toEqual([]);
  });

  it('publication d’une palette en échec : la base reçoit un rapport « non passé » (refus journalisé), l’API nomme la paire', async () => {
    const { store, console } = setup();
    const draft = await console.saveDraft(HASH, {
      requestId: id(),
      brandName: 'Kmino',
      fromPalette: 'lienzo-azur',
    });
    const e = await rejection(console.publish(HASH, id(), draft.versionId ?? ''));
    expect(e.code).toBe('BRAND_CONTRAST_INSUFFICIENT');
    expect(e.details?.['failures']).toEqual(
      expect.arrayContaining([expect.objectContaining({ pair: 'primary / glass', mode: 'light' })]),
    );
    expect(store.calls).toContain('publish:false');
    expect(store.versions[0]?.status).toBe('DRAFT');
  });

  it('publication conforme, puis retour arrière en un clic vers la précédente ; cache de lecture vidé', async () => {
    const { store, console, read } = setup();
    const a = await console.saveDraft(HASH, {
      requestId: id(),
      brandName: 'Kmino A',
      fromPalette: 'lienzo-tinta',
    });
    await console.publish(HASH, id(), a.versionId ?? '');
    expect((await read.publishedTheme())?.brandName).toBe('Kmino A');
    const b = await console.saveDraft(HASH, {
      requestId: id(),
      brandName: 'Kmino B',
      fromPalette: 'lienzo-grafito',
    });
    await console.publish(HASH, id(), b.versionId ?? '');
    // horloge figée : sans invalidation, le cache rendrait encore A
    expect((await read.publishedTheme())?.brandName).toBe('Kmino B');
    const r = await console.rollback(HASH, id());
    expect(r).toMatchObject({ copiedFromId: a.versionId, duplicate: false });
    const theme = await read.publishedTheme();
    expect(theme).toMatchObject({ brandName: 'Kmino A', versionNo: 3 });
    expect(theme?.css).toContain('--color-primary:');
    expect(store.versions.filter((v) => v.status === 'PUBLISHED')).toHaveLength(1);
  });

  it('palette inconnue : BRAND_TOKENS_INVALID', async () => {
    const { console } = setup();
    const e = await rejection(
      console.saveDraft(HASH, { requestId: id(), brandName: 'K', fromPalette: 'nope' }),
    );
    expect(e.code).toBe('BRAND_TOKENS_INVALID');
  });

  it('contenu : trois langues contrôlées avant la base ; issue de la base traduite', async () => {
    const { store, console } = setup();
    await expect(
      console.saveContentDraft(HASH, id(), 'home.hero.title', null, { es: 'Hola' }),
    ).rejects.toThrow(/CONTENT_BLOCK_REQUIRED_MISSING/);
    expect(store.calls).toEqual([]);
    store.outcome = 'FORBIDDEN';
    await expect(
      console.saveContentDraft(HASH, id(), 'home.hero.title', null, {
        es: 'Hola',
        en: 'Hello',
        fr: 'Salut',
      }),
    ).rejects.toMatchObject({ outcome: 'FORBIDDEN' });
  });

  it('actif : type réel exigé (un SVG déclaré PNG est refusé), dépôt après la ligne en base', async () => {
    const { store, console, options } = setup();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8');
    const alt = { es: 'Logotipo', en: 'Logo', fr: 'Logo' };
    await expect(
      console.registerAsset(HASH, {
        requestId: id(),
        kind: 'LOGO',
        body: svg,
        alt,
        licenseNote: 'propre',
      }),
    ).rejects.toThrow(/BRAND_ASSET_INVALID/);
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(16)]);
    await expect(
      console.registerAsset(HASH, {
        requestId: id(),
        kind: 'LOGO',
        body: png,
        alt: { es: 'Logotipo' },
        licenseNote: 'propre',
      }),
    ).rejects.toThrow(/BRAND_ASSET_INVALID/);
    const r = await console.registerAsset(HASH, {
      requestId: id(),
      kind: 'LOGO',
      body: png,
      alt,
      licenseNote: 'propre',
    });
    expect(store.calls).toEqual(['registerAsset']);
    const got = await options.files.get('BRAND', `brand/${r.assetId}`);
    expect(got).toMatchObject({ status: 'FOUND' });
  });
});

describe('BrandReadService : cache borné et repli es signalé', () => {
  it('cache : relu après la durée ; vidé à la publication', async () => {
    let now = 0;
    const { store, read } = setup(() => now);
    expect(await read.publishedTheme()).toBeNull();
    expect(await read.publishedTheme()).toBeNull();
    expect(store.calls.filter((c) => c === 'publishedVersion')).toHaveLength(1);
    now = PARAMS.readCacheTtlMs;
    await read.publishedTheme();
    expect(store.calls.filter((c) => c === 'publishedVersion')).toHaveLength(2);
  });

  it('le bloc du pays prime sur le bloc commun ; langue absente => es, fallback signalé', async () => {
    const { store, read } = setup();
    const block = (
      key: string,
      locale: ContentLocale,
      countryCode: string | null,
      body: string,
    ) => ({
      blockKey: key,
      locale,
      countryCode,
      versionNo: 1,
      bodyMd: body,
      assetId: null,
      status: 'PUBLISHED',
    });
    // pays tirés d'aucune constante : un code quelconque de deux lettres suffit au service
    store.blocks.push(
      block('home.a', 'fr', null, 'commun fr'),
      block('home.a', 'fr', 'XX', 'pays fr'),
      block('home.b', 'es', null, 'solo es'),
    );
    const out = await read.publishedContent('fr', 'XX');
    expect(out).toEqual([
      expect.objectContaining({ key: 'home.a', bodyMd: 'pays fr', fallback: false, country: 'XX' }),
      expect.objectContaining({ key: 'home.b', bodyMd: 'solo es', fallback: true, locale: 'es' }),
    ]);
  });
});

describe('API de lecture publique (HTTP)', () => {
  const apps: INestApplication[] = [];
  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
  });

  async function app(
    options: BrandOptions,
  ): Promise<{ url: string; console: BrandConsoleService }> {
    const nest = await NestFactory.create(BrandModule.register(options), { logger: false });
    await nest.listen(0, '127.0.0.1');
    apps.push(nest);
    return {
      url: (await nest.getUrl()).replace('[::1]', '127.0.0.1'),
      console: nest.get(BrandConsoleService),
    };
  }

  it('aucune version : 503 BRAND_VERSION_UNAVAILABLE ; publiée : 200 + ETag, 304 si inchangée', async () => {
    const { options } = setup();
    const { url, console } = await app(options);
    const none = await fetch(`${url}/brand`);
    expect(none.status).toBe(503);
    expect(await none.json()).toMatchObject({ code: 'BRAND_VERSION_UNAVAILABLE' });
    const d = await console.saveDraft(HASH, {
      requestId: id(),
      brandName: 'Kmino',
      fromPalette: 'lienzo-tinta',
    });
    await console.publish(HASH, id(), d.versionId ?? '');
    const ok = await fetch(`${url}/brand`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toMatch(/^public, max-age=\d+$/);
    const etag = ok.headers.get('etag') ?? '';
    expect(await ok.json()).toMatchObject({ brandName: 'Kmino', versionNo: 1 });
    const same = await fetch(`${url}/brand`, { headers: { 'if-none-match': etag } });
    expect(same.status).toBe(304);
    const bad = await fetch(`${url}/brand/content?locale=de`);
    expect(bad.status).toBe(400);
    const content = await fetch(`${url}/brand/content?locale=fr`);
    expect(await content.json()).toEqual({ locale: 'fr', country: null, blocks: [] });
    expect((await fetch(`${url}/brand/assets/${id()}`)).status).toBe(404);
  });
});
