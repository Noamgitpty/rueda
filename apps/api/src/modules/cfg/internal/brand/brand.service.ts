/**
 * Services du socle de marque (US-034, ADR-067).
 *
 * `BrandConsoleService` — écritures de la console (appelées par SUP sous `StaffGuard`, avec
 * l'empreinte du jeton de la session élevée, jamais un identifiant d'acteur reçu du client) :
 * actifs, brouillons, publication, retour arrière, blocs de contenu. Chaque écriture contrôle
 * d'abord en TypeScript (format des jetons, polices approuvées, contraste d'US-030, règles du
 * contenu), puis appelle UNE commande de la base, qui relit droits, TOTP et portée et journalise.
 * Une publication ou un retour arrière réussi invalide aussitôt le cache de lecture.
 *
 * `BrandReadService` — API de lecture publique mise en cache : version publiée (jetons, feuille
 * de style prête, actifs), blocs publiés par langue et pays (repli `es` signalé). Cache borné par
 * `readCacheTtlMs` (autres instances) et vidé à la publication (instance qui publie).
 *
 * US-121 (ADR-095) : seuls les blocs du registre `EDITABLE_BLOCKS` (`@rueda/i18n`) sont servis,
 * chacun avec son arbre assaini (`doc`, liste blanche `parseRichText`) ; le site ne reçoit jamais
 * de HTML. `contentGaps` signale au back-office les blocs publiés sans une langue ou hors des
 * règles actuelles.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  paletteDocument,
  themeStyleSheet,
  TOKENS_SCHEMA_VERSION,
  UnknownPaletteError,
} from '@rueda/design-tokens';
import {
  assertBlockKey,
  assertBodies,
  assertBrandName,
  classifyBlockKey,
  assertFontsApproved,
  CONTENT_LOCALES,
  contrastReport,
  themeOf,
} from './checks.js';
import type { ContentLocale, ContrastReport } from './checks.js';
import { EDITABLE_BLOCKS, editableBlock, parseRichText, RichTextError } from '@rueda/i18n';
import type { EditableBlock, EditableBlocks, RichDoc, RichFormat } from '@rueda/i18n';
import { BrandError } from './errors.js';
import type { BrandParams } from './params.js';
import type {
  AssetKind,
  BrandStore,
  PublicAsset,
  PublishedBlock,
  StaffOutcome,
  StaffVersion,
} from './store.js';

/** Port de stockage des fichiers de marque (bucket public BRAND ; FAKE : InMemoryFileStore). */
export interface BrandFileStore {
  put(
    bucket: 'BRAND',
    key: string,
    body: Buffer,
  ): Promise<{ readonly status: 'STORED' | 'CONFLICT' | 'UNAVAILABLE' | 'TIMEOUT' | string }>;
  get(
    bucket: 'BRAND',
    key: string,
  ): Promise<
    | { readonly status: 'FOUND'; readonly body: Buffer }
    | { readonly status: 'NOT_FOUND' | 'UNAVAILABLE' | 'TIMEOUT' | string }
  >;
}

/** Stockage indisponible (production tant qu'US-003 n'a pas livré le stockage objet) : fail-closed. */
export class UnavailableBrandFileStore implements BrandFileStore {
  put(): Promise<{ status: 'UNAVAILABLE' }> {
    return Promise.resolve({ status: 'UNAVAILABLE' });
  }
  get(): Promise<{ status: 'UNAVAILABLE' }> {
    return Promise.resolve({ status: 'UNAVAILABLE' });
  }
}

export interface BrandOptions {
  readonly store: BrandStore;
  readonly files: BrandFileStore;
  readonly params: BrandParams;
  /** Identifiants des nouvelles lignes (UUID v4 par défaut ; injectable pour les tests). */
  readonly newId?: () => string;
  /** Horloge du cache (ms) ; aucune décision métier n'en dépend. */
  readonly nowMs?: () => number;
  /** Registre des blocs éditables (US-121) ; `EDITABLE_BLOCKS` par défaut, injectable en test. */
  readonly blocks?: EditableBlocks;
}

/** Arbre assaini d'un corps publié, ou `null` s'il ne passe plus la liste blanche du bloc. */
function docOf(body: string, block: EditableBlock): RichDoc | null {
  try {
    return parseRichText(body, block.format, block.maxLength);
  } catch (error) {
    if (error instanceof RichTextError) return null;
    throw error;
  }
}

/** Issue d'une commande refusée par la base pour une raison d'accès (traduite en HTTP par SUP). */
export class BrandAccessError extends Error {
  override readonly name = 'BrandAccessError';
  readonly outcome: StaffOutcome;
  constructor(outcome: StaffOutcome) {
    super(outcome);
    this.outcome = outcome;
  }
}

function access(outcome: string): void {
  if (outcome === 'AUTH_REQUIRED' || outcome === 'MFA_REQUIRED' || outcome === 'FORBIDDEN') {
    throw new BrandAccessError(outcome);
  }
}

// ---- Fichiers : type réel des octets (jamais la seule déclaration du client) -------------------
const MAGIC: ReadonlyArray<readonly [string, (b: Buffer) => boolean]> = [
  ['image/png', (b) => b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))],
  ['image/jpeg', (b) => b.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))],
  [
    'image/webp',
    (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  ],
  ['font/woff2', (b) => b.subarray(0, 4).toString('latin1') === 'wOF2'],
];

export function sniffBrandMime(body: Buffer): string | null {
  return MAGIC.find(([, test]) => test(body))?.[0] ?? null;
}

const KINDS: readonly AssetKind[] = ['LOGO', 'FAVICON', 'PWA_ICON', 'HERO_IMAGE', 'FONT'];

export interface AssetUpload {
  readonly requestId: string;
  readonly kind: string;
  readonly body: Buffer;
  readonly alt: unknown;
  readonly licenseNote: unknown;
}

export interface DraftInput {
  readonly requestId: string;
  readonly brandName: unknown;
  /** Jetons DTCG complets, OU `fromPalette` (copie d'une palette du registre US-028). */
  readonly tokens?: unknown;
  readonly fromPalette?: unknown;
  readonly logoAssetId?: string | null;
  readonly faviconAssetId?: string | null;
  readonly pwaIconAssetId?: string | null;
  readonly copiedFromId?: string | null;
}

export class BrandReadService {
  readonly #store: BrandStore;
  readonly #ttl: number;
  readonly #now: () => number;
  readonly #registry: EditableBlocks;
  #theme: { at: number; value: PublishedTheme | null } | undefined;
  readonly #blocks = new Map<string, { at: number; value: PublishedBlock[] }>();

  constructor(options: BrandOptions) {
    this.#store = options.store;
    this.#ttl = options.params.readCacheTtlMs;
    this.#now = options.nowMs ?? Date.now;
    this.#registry = options.blocks ?? EDITABLE_BLOCKS;
  }

  /** Vide le cache (appelé à chaque publication ou retour arrière de cette instance). */
  invalidate(): void {
    this.#theme = undefined;
    this.#blocks.clear();
  }

  #fresh(at: number): boolean {
    return this.#now() - at < this.#ttl;
  }

  /** Version publiée, ou `null` (le client garde alors son thème embarqué : BRAND_VERSION_UNAVAILABLE). */
  async publishedTheme(): Promise<PublishedTheme | null> {
    if (this.#theme !== undefined && this.#fresh(this.#theme.at)) return this.#theme.value;
    const version = await this.#store.publishedVersion();
    let value: PublishedTheme | null = null;
    if (version !== null) {
      const assets = new Map((await this.#store.publicAssets()).map((a) => [a.id, a]));
      // format revalidé (fail-closed) ; le contraste l'a été à la publication
      const theme = themeOf(version.tokens);
      const pick = (id: string | null): PublicAssetView | null => {
        const a = id === null ? undefined : assets.get(id);
        return a === undefined ? null : assetView(a);
      };
      value = {
        versionId: version.id,
        versionNo: version.versionNo,
        brandName: version.brandName,
        tokensSchemaVersion: version.tokensSchemaVersion,
        tokens: version.tokens,
        css: themeStyleSheet(theme),
        publishedAt: version.publishedAt.toISOString(),
        assets: {
          logo: pick(version.logoAssetId),
          favicon: pick(version.faviconAssetId),
          pwaIcon: pick(version.pwaIconAssetId),
        },
      };
    }
    this.#theme = { at: this.#now(), value };
    return value;
  }

  /**
   * Blocs publiés pour une langue et un pays : le bloc du pays prime sur le bloc commun ; une
   * langue absente retombe sur `es`, signalée (`fallback: true`, 17 §3.2.13). US-121 : blocs du
   * registre seulement ; un corps qui ne passe plus la liste blanche est ignoré (candidat
   * suivant), jamais servi.
   */
  async publishedContent(locale: ContentLocale, country: string | null): Promise<ContentView[]> {
    const cacheKey = country ?? '';
    let entry = this.#blocks.get(cacheKey);
    if (entry === undefined || !this.#fresh(entry.at)) {
      entry = { at: this.#now(), value: await this.#store.publishedBlocks(country) };
      this.#blocks.set(cacheKey, entry);
    }
    const byKey = new Map<string, PublishedBlock[]>();
    for (const b of entry.value) byKey.set(b.blockKey, [...(byKey.get(b.blockKey) ?? []), b]);
    const out: ContentView[] = [];
    for (const [key, blocks] of [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const spec = editableBlock(key, this.#registry);
      if (spec === undefined) continue;
      const find = (loc: ContentLocale, c: string | null): PublishedBlock | undefined =>
        blocks.find((b) => b.locale === loc && b.countryCode === c);
      const candidates = [
        country !== null ? find(locale, country) : undefined,
        find(locale, null),
        country !== null ? find('es', country) : undefined,
        find('es', null),
      ];
      for (const chosen of candidates) {
        if (chosen === undefined) continue;
        const doc = docOf(chosen.bodyMd, spec);
        if (doc === null) continue;
        out.push({
          key,
          locale: chosen.locale,
          country: chosen.countryCode,
          versionNo: chosen.versionNo,
          bodyMd: chosen.bodyMd,
          assetId: chosen.assetId,
          format: spec.format,
          doc,
          fallback: chosen.locale !== locale,
        });
        break;
      }
    }
    return out;
  }

  /**
   * Signalement au back-office (US-121 ; 17 §3.2.13 « locale manquante ⇒ repli, signalé ») :
   * pour chaque bloc publié (clé, pays), les langues absentes et celles dont le corps ne passe
   * plus la liste blanche ; une clé hors du registre est signalée (elle n'est jamais servie).
   * Sans cache : lecture de la console, rare.
   */
  async contentGaps(): Promise<ContentGap[]> {
    const groups = new Map<string, PublishedBlock[]>();
    for (const b of await this.#store.allPublishedBlocks()) {
      const k = `${b.blockKey} ${b.countryCode ?? ''}`;
      groups.set(k, [...(groups.get(k) ?? []), b]);
    }
    const out: ContentGap[] = [];
    for (const blocks of groups.values()) {
      const first = blocks[0];
      if (first === undefined) continue;
      const spec = editableBlock(first.blockKey, this.#registry);
      const missing = CONTENT_LOCALES.filter((l) => !blocks.some((b) => b.locale === l));
      const invalid =
        spec === undefined
          ? []
          : CONTENT_LOCALES.filter((l) => {
              const b = blocks.find((x) => x.locale === l);
              return b !== undefined && docOf(b.bodyMd, spec) === null;
            });
      if (spec !== undefined && missing.length === 0 && invalid.length === 0) continue;
      out.push({
        key: first.blockKey,
        country: first.countryCode,
        versionNo: Math.max(...blocks.map((b) => b.versionNo)),
        editable: spec !== undefined,
        missing,
        invalid,
      });
    }
    return out.sort(
      (a, b) => a.key.localeCompare(b.key) || (a.country ?? '').localeCompare(b.country ?? ''),
    );
  }

  /** Actif publié (référencé par la version ou un bloc publiés), ou `null`. */
  async publicAsset(id: string): Promise<PublicAsset | null> {
    return (await this.#store.publicAssets()).find((a) => a.id === id) ?? null;
  }
}

export interface PublicAssetView {
  readonly id: string;
  readonly kind: AssetKind;
  readonly mime: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly path: string;
  readonly alt: Readonly<Record<ContentLocale, string | null>>;
}

function assetView(a: PublicAsset): PublicAssetView {
  return {
    id: a.id,
    kind: a.kind,
    mime: a.mime,
    bytes: a.bytes,
    sha256: a.sha256.toString('hex'),
    path: `/brand/assets/${a.id}`,
    alt: a.alt,
  };
}

export interface PublishedTheme {
  readonly versionId: string;
  readonly versionNo: number;
  readonly brandName: string;
  readonly tokensSchemaVersion: number;
  readonly tokens: Record<string, unknown>;
  /** Feuille de style prête (`themeStyleSheet` d'US-030) : valeurs validées, injectables. */
  readonly css: string;
  readonly publishedAt: string;
  readonly assets: {
    readonly logo: PublicAssetView | null;
    readonly favicon: PublicAssetView | null;
    readonly pwaIcon: PublicAssetView | null;
  };
}

export interface ContentView {
  readonly key: string;
  readonly locale: ContentLocale;
  readonly country: string | null;
  readonly versionNo: number;
  readonly bodyMd: string;
  readonly assetId: string | null;
  /** Format du bloc au registre (US-121). */
  readonly format: RichFormat;
  /** Arbre assaini (liste blanche) : seule forme que le site affiche ; jamais de HTML. */
  readonly doc: RichDoc;
  /** Vrai si la langue demandée manquait et que la version `es` est servie (signalé). */
  readonly fallback: boolean;
}

/** Bloc publié à revoir (US-121), pour le back-office. */
export interface ContentGap {
  readonly key: string;
  readonly country: string | null;
  readonly versionNo: number;
  /** Faux : clé hors du registre (jamais servie au site). */
  readonly editable: boolean;
  /** Langues sans texte publié : le site affiche le catalogue livré dans ces langues. */
  readonly missing: readonly ContentLocale[];
  /** Langues dont le corps ne passe plus la liste blanche du bloc : jamais servies. */
  readonly invalid: readonly ContentLocale[];
}

export class BrandConsoleService {
  readonly #store: BrandStore;
  readonly #files: BrandFileStore;
  readonly #params: BrandParams;
  readonly #read: BrandReadService;
  readonly #newId: () => string;
  readonly #registry: EditableBlocks;

  constructor(options: BrandOptions, read: BrandReadService) {
    this.#store = options.store;
    this.#files = options.files;
    this.#params = options.params;
    this.#read = read;
    this.#newId = options.newId ?? randomUUID;
    this.#registry = options.blocks ?? EDITABLE_BLOCKS;
  }

  /** Actif de marque : type réel contrôlé, ligne en base AVANT le dépôt (création seule). */
  async registerAsset(tokenHash: Buffer, upload: AssetUpload) {
    const kind = upload.kind as AssetKind;
    if (!KINDS.includes(kind)) throw new BrandError('REQUEST_INVALID');
    if (upload.body.length === 0 || upload.body.length > this.#params.assetMaxBytes) {
      throw new BrandError('BRAND_ASSET_INVALID', {
        reason: 'SIZE',
        max: this.#params.assetMaxBytes,
      });
    }
    const mime = sniffBrandMime(upload.body);
    const allowed =
      kind === 'FONT' ? mime === 'font/woff2' : mime !== null && mime !== 'font/woff2';
    if (mime === null || !allowed) throw new BrandError('BRAND_ASSET_INVALID', { reason: 'TYPE' });
    let alt: Record<ContentLocale, string> | null = null;
    if (kind !== 'FONT') {
      const a = (upload.alt ?? {}) as Record<string, unknown>;
      const missing = CONTENT_LOCALES.filter(
        (l) =>
          typeof a[l] !== 'string' ||
          (a[l] as string).trim().length === 0 ||
          (a[l] as string).length > 300,
      );
      if (missing.length > 0)
        throw new BrandError('BRAND_ASSET_INVALID', { reason: 'ALT_TEXT', locales: missing });
      alt = {
        es: (a['es'] as string).trim(),
        en: (a['en'] as string).trim(),
        fr: (a['fr'] as string).trim(),
        pt: (a['pt'] as string).trim(),
      };
    }
    if (
      typeof upload.licenseNote !== 'string' ||
      upload.licenseNote.trim().length < 3 ||
      upload.licenseNote.length > 1000
    ) {
      throw new BrandError('BRAND_ASSET_INVALID', { reason: 'LICENSE' });
    }
    const sha256 = createHash('sha256').update(upload.body).digest();
    const r = await this.#store.registerAsset(tokenHash, {
      requestId: upload.requestId,
      assetId: this.#newId(),
      kind,
      mime,
      bytes: upload.body.length,
      sha256,
      alt,
      licenseNote: upload.licenseNote.trim(),
    });
    access(r.outcome);
    if (r.assetId === null || r.storageKey === null) throw new BrandError('BRAND_ASSET_INVALID');
    const put = await this.#files.put('BRAND', r.storageKey, upload.body);
    // CONFLICT : objet déjà déposé sous cette clé (rejeu de la même requête) ; rien n'est écrasé
    if (put.status !== 'STORED' && put.status !== 'CONFLICT') {
      throw new BrandError('BRAND_ASSET_UNAVAILABLE', { assetId: r.assetId });
    }
    return {
      assetId: r.assetId,
      duplicate: r.outcome === 'DUPLICATE',
      sha256: sha256.toString('hex'),
    };
  }

  /** Brouillon : jetons validés (format, polices approuvées) ; le contraste se juge à la publication. */
  async saveDraft(tokenHash: Buffer, input: DraftInput) {
    const brandName = assertBrandName(input.brandName);
    let tokens: unknown = input.tokens;
    if (input.fromPalette !== undefined) {
      if (input.tokens !== undefined || typeof input.fromPalette !== 'string') {
        throw new BrandError('REQUEST_INVALID');
      }
      try {
        tokens = paletteDocument(input.fromPalette);
      } catch (error) {
        if (error instanceof UnknownPaletteError)
          throw new BrandError('BRAND_TOKENS_INVALID', { problems: [error.message] });
        throw error;
      }
    }
    if (tokens === null || typeof tokens !== 'object' || Array.isArray(tokens)) {
      throw new BrandError('BRAND_TOKENS_INVALID', { problems: ['jetons : objet DTCG attendu'] });
    }
    if (Buffer.byteLength(JSON.stringify(tokens), 'utf8') > 131_072) {
      throw new BrandError('BRAND_TOKENS_INVALID', { problems: ['jetons : 128 Kio au plus'] });
    }
    const theme = themeOf(tokens);
    assertFontsApproved(theme, this.#params);
    const r = await this.#store.saveDraft(tokenHash, {
      requestId: input.requestId,
      versionId: this.#newId(),
      brandName,
      tokens: tokens as Record<string, unknown>,
      tokensSchemaVersion: TOKENS_SCHEMA_VERSION,
      logoAssetId: input.logoAssetId ?? null,
      faviconAssetId: input.faviconAssetId ?? null,
      pwaIconAssetId: input.pwaIconAssetId ?? null,
      copiedFromId: input.copiedFromId ?? null,
    });
    access(r.outcome);
    return { versionId: r.versionId, versionNo: r.versionNo, duplicate: r.outcome === 'DUPLICATE' };
  }

  /** Une version (brouillons compris) ou l'historique, pour la console. */
  async versions(
    tokenHash: Buffer,
    versionId: string | null = null,
    limit = 20,
  ): Promise<StaffVersion[]> {
    return this.#store.staffVersions(tokenHash, versionId, limit);
  }

  /** Contrôles d'US-030 et polices sur une version relue en base (immuable). */
  #report(version: StaffVersion): ContrastReport {
    const theme = themeOf(version.tokens);
    assertFontsApproved(theme, this.#params);
    return contrastReport(theme, version.tokensSha256);
  }

  async #readable(tokenHash: Buffer, versionId: string): Promise<StaffVersion> {
    const found = await this.#store.staffVersions(tokenHash, versionId, 1);
    const v = found[0];
    if (v === undefined) {
      // aucune ligne : version inconnue OU accès refusé (le refus est journalisé par la base) ;
      // la commande d'écriture tranche ensuite (FORBIDDEN / NOT_FOUND)
      return Promise.reject(new BrandError('BRAND_VERSION_NOT_FOUND'));
    }
    return v;
  }

  /**
   * Publication : contraste d'US-030 recalculé sur les jetons du brouillon ; paire en échec =>
   * la base journalise le refus et rien ne change, l'API répond BRAND_CONTRAST_INSUFFICIENT avec
   * chaque paire en cause.
   */
  async publish(tokenHash: Buffer, requestId: string, versionId: string) {
    let report: ContrastReport;
    try {
      report = this.#report(await this.#readable(tokenHash, versionId));
    } catch (error) {
      if (error instanceof BrandError && error.code === 'BRAND_VERSION_NOT_FOUND') {
        // laisser la base décider (et journaliser) : FORBIDDEN, MFA_REQUIRED, NOT_FOUND
        const r = await this.#store.publish(tokenHash, requestId, versionId, REFUSED);
        access(r.outcome);
      }
      throw error;
    }
    const r = await this.#store.publish(tokenHash, requestId, versionId, report);
    access(r.outcome);
    switch (r.outcome) {
      case 'PUBLISHED':
        this.#read.invalidate();
        return { versionId: r.versionId, versionNo: r.versionNo };
      case 'CONTRAST_INSUFFICIENT':
        throw new BrandError('BRAND_CONTRAST_INSUFFICIENT', { failures: report.failures });
      case 'NOT_DRAFT':
        throw new BrandError('VERSION_CONFLICT', { versionNo: r.versionNo });
      default:
        throw new BrandError('BRAND_VERSION_NOT_FOUND');
    }
  }

  /**
   * Retour arrière en un clic : par défaut vers la version publiée avant l'actuelle (la plus
   * récemment archivée) ; nouvelle version copiée puis publiée, journalisée. La cible repasse le
   * contrôle d'US-030 actuel.
   */
  async rollback(tokenHash: Buffer, requestId: string, targetId: string | null = null) {
    let target: StaffVersion | undefined;
    if (targetId === null) {
      const history = await this.#store.staffVersions(tokenHash, null, 100);
      target = history
        .filter((v) => v.status === 'ARCHIVED' && v.publishedAt !== null)
        .sort(
          (a, b) =>
            (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) ||
            b.versionNo - a.versionNo,
        )[0];
    } else {
      target = (await this.#store.staffVersions(tokenHash, targetId, 1))[0];
    }
    // aucune cible lisible : la commande décide et journalise (accès refusé) ou rien à restaurer
    const report = target === undefined ? REFUSED : this.#report(target);
    const r = await this.#store.rollback(
      tokenHash,
      requestId,
      this.#newId(),
      target?.id ?? targetId ?? this.#newId(),
      report,
    );
    access(r.outcome);
    switch (r.outcome) {
      case 'ROLLED_BACK':
        this.#read.invalidate();
        return {
          versionId: r.versionId,
          versionNo: r.versionNo,
          copiedFromId: r.copiedFromId ?? null,
          duplicate: false,
        };
      case 'DUPLICATE':
        return {
          versionId: r.versionId,
          versionNo: r.versionNo,
          copiedFromId: r.copiedFromId ?? null,
          duplicate: true,
        };
      case 'CONTRAST_INSUFFICIENT':
        throw new BrandError('BRAND_CONTRAST_INSUFFICIENT', { failures: report.failures });
      case 'NOT_ARCHIVED':
        throw new BrandError('VERSION_CONFLICT', { versionNo: r.versionNo });
      default:
        throw new BrandError('BRAND_VERSION_NOT_FOUND');
    }
  }

  /**
   * Blocs publiés à revoir (US-121) : langue absente, corps hors des règles, clé hors du
   * registre. Même droit que l'historique de la marque : `brand.edit` sur tous les pays, relu
   * en base (refus rendu en 401 / 403, jamais une liste vide).
   */
  async contentGaps(tokenHash: Buffer): Promise<ContentGap[]> {
    const outcome = await this.#store.staffReadAccess(tokenHash, 'brand.edit');
    access(outcome);
    if (outcome !== 'OK') throw new BrandAccessError('FORBIDDEN');
    return this.#read.contentGaps();
  }

  async saveContentDraft(
    tokenHash: Buffer,
    requestId: string,
    blockKey: unknown,
    country: string | null,
    bodies: unknown,
    assetId: string | null = null,
  ) {
    const cls = classifyBlockKey(blockKey, this.#registry);
    if (cls.kind === 'legal') {
      // texte juridique : la base relit les droits, refuse et JOURNALISE la tentative (0062) ;
      // aucun corps n'est transmis
      const refused = await this.#store.saveContentDraft(
        tokenHash,
        requestId,
        cls.key,
        country,
        {},
        null,
      );
      access(refused.outcome);
      throw new BrandError('CONTENT_KEY_FORBIDDEN', { key: cls.key });
    }
    if (cls.kind === 'unknown') throw new BrandError('CONTENT_KEY_NOT_EDITABLE', { key: cls.key });
    const key = cls.key;
    const valid = assertBodies(bodies, cls.block);
    const r = await this.#store.saveContentDraft(
      tokenHash,
      requestId,
      key,
      country,
      valid,
      assetId,
    );
    access(r.outcome);
    if (r.outcome === 'LOCALE_MISSING') throw new BrandError('CONTENT_BLOCK_REQUIRED_MISSING');
    return { versionNo: r.versionNo, duplicate: r.outcome === 'DUPLICATE' };
  }

  async publishContent(
    tokenHash: Buffer,
    requestId: string,
    blockKey: unknown,
    country: string | null,
    versionNo: number,
  ) {
    const key = assertBlockKey(blockKey);
    const r = await this.#store.publishContent(tokenHash, requestId, key, country, versionNo);
    access(r.outcome);
    if (r.outcome === 'PUBLISHED') {
      this.#read.invalidate();
      return { versionNo: r.versionNo };
    }
    if (r.outcome === 'NOT_DRAFT') throw new BrandError('VERSION_CONFLICT', { versionNo });
    throw new BrandError('CONTENT_BLOCK_NOT_FOUND');
  }

  async rollbackContent(
    tokenHash: Buffer,
    requestId: string,
    blockKey: unknown,
    country: string | null,
    targetVersionNo: number | null = null,
  ) {
    const key = assertBlockKey(blockKey);
    const r = await this.#store.rollbackContent(
      tokenHash,
      requestId,
      key,
      country,
      targetVersionNo,
    );
    access(r.outcome);
    if (r.outcome === 'ROLLED_BACK' || r.outcome === 'DUPLICATE') {
      if (r.outcome === 'ROLLED_BACK') this.#read.invalidate();
      return { versionNo: r.versionNo, duplicate: r.outcome === 'DUPLICATE' };
    }
    throw new BrandError('CONTENT_BLOCK_NOT_FOUND');
  }
}

/** Rapport « non vérifié » : la base refuse toute publication avec (jamais une publication). */
const REFUSED: ContrastReport = {
  checker: 'unverified',
  tokensSchemaVersion: TOKENS_SCHEMA_VERSION,
  tokensSha256: '',
  passed: false,
  failures: [],
};
