/**
 * Port et adaptateur PostgreSQL du socle de marque (US-034, migration 0042).
 *
 * Écritures : un appel de commande `core.cfg_brand_cmd_*` / `core.cfg_content_cmd_*` (SECURITY
 * DEFINER, EXECUTE au seul app_api) en autocommit : « un appel = une instruction » (ADR-056). La
 * commande relit la session (empreinte du jeton, preuve de possession), le TOTP, la permission et
 * la portée pays, puis agit ou refuse, et écrit l'audit en dernier. Lectures publiques : tables
 * `core.config_brand_*` / `config_content_block` sous la RLS d'app_api (versions et blocs PUBLISHED
 * seulement). Erreurs de la base : seul le SQLSTATE est gardé.
 */
import { BrandAccessError } from './brand.service.js';
import type { ContentLocale, ContrastReport } from './checks.js';

/** Exécuteur SQL minimal (pool `pg` ou client), sans dépendre d'IAM (CFG ne dépend que de BUS). */
export interface SqlExecutor {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

export type StaffOutcome = 'AUTH_REQUIRED' | 'MFA_REQUIRED' | 'FORBIDDEN';

export type AssetKind = 'LOGO' | 'FAVICON' | 'PWA_ICON' | 'HERO_IMAGE' | 'FONT';

export interface RegisterAssetInput {
  readonly requestId: string;
  readonly assetId: string;
  readonly kind: AssetKind;
  readonly mime: string;
  readonly bytes: number;
  readonly sha256: Buffer;
  readonly alt: Readonly<Record<ContentLocale, string>> | null;
  readonly licenseNote: string;
}

export interface SaveDraftInput {
  readonly requestId: string;
  readonly versionId: string;
  readonly brandName: string;
  readonly tokens: Record<string, unknown>;
  readonly tokensSchemaVersion: number;
  readonly logoAssetId: string | null;
  readonly faviconAssetId: string | null;
  readonly pwaIconAssetId: string | null;
  readonly copiedFromId: string | null;
}

export interface VersionOutcome {
  readonly outcome: string;
  readonly versionId: string | null;
  readonly versionNo: number | null;
  /** Retour arrière : version source, relue en base (exacte aussi au rejeu). */
  readonly copiedFromId?: string | null;
}

export interface StaffVersion {
  readonly id: string;
  readonly versionNo: number;
  readonly status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  readonly brandName: string;
  readonly tokens: Record<string, unknown>;
  readonly tokensSchemaVersion: number;
  readonly logoAssetId: string | null;
  readonly faviconAssetId: string | null;
  readonly pwaIconAssetId: string | null;
  readonly contrastCheck: Record<string, unknown> | null;
  readonly copiedFromId: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly publishedBy: string | null;
  readonly publishedAt: Date | null;
  readonly archivedAt: Date | null;
  /** Empreinte SHA-256 (hex) des jetons, calculée par la base (lien du rapport de contraste). */
  readonly tokensSha256: string;
}

export interface PublicAsset {
  readonly id: string;
  readonly kind: AssetKind;
  readonly storageKey: string;
  readonly mime: string;
  readonly bytes: number;
  readonly sha256: Buffer;
  readonly alt: Readonly<Record<ContentLocale, string | null>>;
}

export interface PublishedVersion {
  readonly id: string;
  readonly versionNo: number;
  readonly brandName: string;
  readonly tokens: Record<string, unknown>;
  readonly tokensSchemaVersion: number;
  readonly logoAssetId: string | null;
  readonly faviconAssetId: string | null;
  readonly pwaIconAssetId: string | null;
  readonly publishedAt: Date;
}

export interface PublishedBlock {
  readonly blockKey: string;
  readonly locale: ContentLocale;
  readonly countryCode: string | null;
  readonly versionNo: number;
  readonly bodyMd: string;
  readonly assetId: string | null;
}

export interface ContentOutcome {
  readonly outcome: string;
  readonly versionNo: number | null;
}

export interface BrandStore {
  registerAsset(
    tokenHash: Buffer,
    input: RegisterAssetInput,
  ): Promise<{ outcome: string; assetId: string | null; storageKey: string | null }>;
  saveDraft(tokenHash: Buffer, input: SaveDraftInput): Promise<VersionOutcome>;
  publish(
    tokenHash: Buffer,
    requestId: string,
    versionId: string,
    report: ContrastReport,
  ): Promise<VersionOutcome>;
  rollback(
    tokenHash: Buffer,
    requestId: string,
    newVersionId: string,
    targetId: string,
    report: ContrastReport,
  ): Promise<VersionOutcome>;
  staffVersions(
    tokenHash: Buffer,
    versionId: string | null,
    limit: number,
  ): Promise<StaffVersion[]>;
  saveContentDraft(
    tokenHash: Buffer,
    requestId: string,
    blockKey: string,
    country: string | null,
    /** Vide pour une clé juridique : la base refuse et journalise (KEY_FORBIDDEN, 0062). */
    bodies: Readonly<Partial<Record<ContentLocale, string>>>,
    assetId: string | null,
  ): Promise<ContentOutcome>;
  publishContent(
    tokenHash: Buffer,
    requestId: string,
    blockKey: string,
    country: string | null,
    versionNo: number,
  ): Promise<ContentOutcome>;
  rollbackContent(
    tokenHash: Buffer,
    requestId: string,
    blockKey: string,
    country: string | null,
    targetVersionNo: number | null,
  ): Promise<ContentOutcome>;
  // lectures publiques (RLS d'app_api : PUBLISHED seulement)
  publishedVersion(): Promise<PublishedVersion | null>;
  publicAssets(): Promise<PublicAsset[]>;
  publishedBlocks(country: string | null): Promise<PublishedBlock[]>;
  /** Tous les blocs publiés, communs et de chaque pays (signalement au back-office, US-121). */
  allPublishedBlocks(): Promise<PublishedBlock[]>;
  /**
   * Droit de lecture de la console sur la marque commune (`core.iam_staff_read_access`, 0049) :
   * `OK`, ou `AUTH_REQUIRED` / `MFA_REQUIRED` / `FORBIDDEN` (jamais une liste vide : 401 / 403).
   */
  staffReadAccess(tokenHash: Buffer, permission: 'brand.edit'): Promise<string>;
}

export class BrandStoreError extends Error {
  override readonly name = 'BrandStoreError';
  readonly sqlstate: string | undefined;

  constructor(sqlstate: string | undefined) {
    super(`marque : échec de la base${sqlstate ? ` (SQLSTATE ${sqlstate})` : ''}`);
    this.sqlstate = sqlstate;
  }
}

async function call<R extends Record<string, unknown>>(
  db: SqlExecutor,
  text: string,
  values: readonly unknown[],
): Promise<R[]> {
  try {
    return (await db.query<R>(text, values)).rows;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    throw new BrandStoreError(typeof code === 'string' ? code : undefined);
  }
}

type VersionRow = {
  outcome: string;
  version_id: string | null;
  version_no: number | null;
  copied_from_id?: string | null;
};
const version = (r: VersionRow | undefined): VersionOutcome => ({
  outcome: r?.outcome ?? 'FORBIDDEN',
  versionId: r?.version_id ?? null,
  versionNo: r?.version_no ?? null,
  copiedFromId: r?.copied_from_id ?? null,
});
type ContentRow = { outcome: string; version_no: number | null };
const contentOutcome = (r: ContentRow | undefined): ContentOutcome => ({
  outcome: r?.outcome ?? 'FORBIDDEN',
  versionNo: r?.version_no ?? null,
});

export class PgBrandStore implements BrandStore {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  async registerAsset(tokenHash: Buffer, i: RegisterAssetInput) {
    const rows = await call<{
      outcome: string;
      asset_id: string | null;
      storage_key: string | null;
    }>(
      this.#db,
      'SELECT * FROM core.cfg_brand_cmd_register_asset($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
      [
        tokenHash,
        i.requestId,
        i.assetId,
        i.kind,
        i.mime,
        i.bytes,
        i.sha256,
        i.alt?.es ?? null,
        i.alt?.en ?? null,
        i.alt?.fr ?? null,
        i.alt?.pt ?? null,
        i.licenseNote,
      ],
    );
    const r = rows[0];
    return {
      outcome: r?.outcome ?? 'FORBIDDEN',
      assetId: r?.asset_id ?? null,
      storageKey: r?.storage_key ?? null,
    };
  }

  async saveDraft(tokenHash: Buffer, i: SaveDraftInput): Promise<VersionOutcome> {
    const rows = await call<VersionRow>(
      this.#db,
      'SELECT * FROM core.cfg_brand_cmd_save_draft($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [
        tokenHash,
        i.requestId,
        i.versionId,
        i.brandName,
        i.tokens,
        i.tokensSchemaVersion,
        i.logoAssetId,
        i.faviconAssetId,
        i.pwaIconAssetId,
        i.copiedFromId,
      ],
    );
    return version(rows[0]);
  }

  async publish(tokenHash: Buffer, requestId: string, versionId: string, report: ContrastReport) {
    const rows = await call<VersionRow>(
      this.#db,
      'SELECT * FROM core.cfg_brand_cmd_publish($1, $2, $3, $4)',
      [tokenHash, requestId, versionId, report],
    );
    return version(rows[0]);
  }

  async rollback(
    tokenHash: Buffer,
    requestId: string,
    newVersionId: string,
    targetId: string,
    report: ContrastReport,
  ) {
    const rows = await call<VersionRow>(
      this.#db,
      'SELECT * FROM core.cfg_brand_cmd_rollback($1, $2, $3, $4, $5)',
      [tokenHash, requestId, newVersionId, targetId, report],
    );
    return version(rows[0]);
  }

  async staffVersions(tokenHash: Buffer, versionId: string | null, limit: number) {
    const rows = await call<{
      id: string;
      version_no: number;
      status: StaffVersion['status'];
      brand_name: string;
      tokens: Record<string, unknown>;
      tokens_schema_version: number;
      logo_asset_id: string | null;
      favicon_asset_id: string | null;
      pwa_icon_asset_id: string | null;
      contrast_check: Record<string, unknown> | null;
      copied_from_id: string | null;
      created_by: string;
      created_at: Date;
      published_by: string | null;
      published_at: Date | null;
      archived_at: Date | null;
      tokens_sha256: string;
    }>(this.#db, 'SELECT * FROM core.cfg_brand_staff_versions($1, $2, $3)', [
      tokenHash,
      versionId,
      limit,
    ]);
    if (rows.length === 0) {
      // refus (journalisé par la lecture) ou vraie absence ? Issue d'accès de 0049 (US-043) :
      // 401 / 403 au lieu d'une liste vide (16 ADM-001). Marque commune : tous les pays.
      const access = await call<{ outcome: string }>(
        this.#db,
        'SELECT core.iam_staff_read_access($1, $2, $3) AS outcome',
        [tokenHash, 'brand.edit', 'ALL'],
      );
      const outcome = access[0]?.outcome;
      if (outcome === 'AUTH_REQUIRED' || outcome === 'MFA_REQUIRED' || outcome === 'FORBIDDEN') {
        throw new BrandAccessError(outcome);
      }
      if (outcome !== 'OK') throw new BrandAccessError('FORBIDDEN');
    }
    return rows.map((r) => ({
      id: r.id,
      versionNo: r.version_no,
      status: r.status,
      brandName: r.brand_name,
      tokens: r.tokens,
      tokensSchemaVersion: r.tokens_schema_version,
      logoAssetId: r.logo_asset_id,
      faviconAssetId: r.favicon_asset_id,
      pwaIconAssetId: r.pwa_icon_asset_id,
      contrastCheck: r.contrast_check,
      copiedFromId: r.copied_from_id,
      createdBy: r.created_by,
      createdAt: r.created_at,
      publishedBy: r.published_by,
      publishedAt: r.published_at,
      archivedAt: r.archived_at,
      tokensSha256: r.tokens_sha256,
    }));
  }

  async saveContentDraft(
    tokenHash: Buffer,
    requestId: string,
    blockKey: string,
    country: string | null,
    bodies: Readonly<Partial<Record<ContentLocale, string>>>,
    assetId: string | null,
  ) {
    const rows = await call<ContentRow>(
      this.#db,
      'SELECT * FROM core.cfg_content_cmd_save_draft($1, $2, $3, $4, $5, $6)',
      [tokenHash, requestId, blockKey, country, bodies, assetId],
    );
    return contentOutcome(rows[0]);
  }

  async publishContent(
    tokenHash: Buffer,
    requestId: string,
    blockKey: string,
    country: string | null,
    versionNo: number,
  ) {
    const rows = await call<ContentRow>(
      this.#db,
      'SELECT * FROM core.cfg_content_cmd_publish($1, $2, $3, $4, $5)',
      [tokenHash, requestId, blockKey, country, versionNo],
    );
    return contentOutcome(rows[0]);
  }

  async rollbackContent(
    tokenHash: Buffer,
    requestId: string,
    blockKey: string,
    country: string | null,
    targetVersionNo: number | null,
  ) {
    const rows = await call<ContentRow>(
      this.#db,
      'SELECT * FROM core.cfg_content_cmd_rollback($1, $2, $3, $4, $5)',
      [tokenHash, requestId, blockKey, country, targetVersionNo],
    );
    return contentOutcome(rows[0]);
  }

  async publishedVersion(): Promise<PublishedVersion | null> {
    const rows = await call<{
      id: string;
      version_no: number;
      brand_name: string;
      tokens: Record<string, unknown>;
      tokens_schema_version: number;
      logo_asset_id: string | null;
      favicon_asset_id: string | null;
      pwa_icon_asset_id: string | null;
      published_at: Date;
    }>(
      this.#db,
      `SELECT id, version_no, brand_name, tokens, tokens_schema_version, logo_asset_id,
              favicon_asset_id, pwa_icon_asset_id, published_at
         FROM core.config_brand_version WHERE status = 'PUBLISHED'`,
      [],
    );
    const r = rows[0];
    if (r === undefined) return null;
    return {
      id: r.id,
      versionNo: r.version_no,
      brandName: r.brand_name,
      tokens: r.tokens,
      tokensSchemaVersion: r.tokens_schema_version,
      logoAssetId: r.logo_asset_id,
      faviconAssetId: r.favicon_asset_id,
      pwaIconAssetId: r.pwa_icon_asset_id,
      publishedAt: r.published_at,
    };
  }

  async publicAssets(): Promise<PublicAsset[]> {
    const rows = await call<{
      id: string;
      kind: AssetKind;
      storage_key: string;
      mime: string;
      bytes: string;
      sha256: Buffer;
      alt_text_es: string | null;
      alt_text_en: string | null;
      alt_text_fr: string | null;
      alt_text_pt: string | null;
    }>(
      this.#db,
      `SELECT id, kind, storage_key, mime, bytes, sha256, alt_text_es, alt_text_en, alt_text_fr,
              alt_text_pt
         FROM core.config_brand_asset`,
      [],
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      storageKey: r.storage_key,
      mime: r.mime,
      bytes: Number(r.bytes),
      sha256: r.sha256,
      alt: { es: r.alt_text_es, en: r.alt_text_en, fr: r.alt_text_fr, pt: r.alt_text_pt },
    }));
  }

  async staffReadAccess(tokenHash: Buffer, permission: 'brand.edit'): Promise<string> {
    const rows = await call<{ outcome: string }>(
      this.#db,
      'SELECT core.iam_staff_read_access($1, $2, $3) AS outcome',
      [tokenHash, permission, 'ALL'],
    );
    return rows[0]?.outcome ?? 'FORBIDDEN';
  }

  async publishedBlocks(country: string | null): Promise<PublishedBlock[]> {
    return this.#blocks(country, false);
  }

  async allPublishedBlocks(): Promise<PublishedBlock[]> {
    return this.#blocks(null, true);
  }

  async #blocks(country: string | null, all: boolean): Promise<PublishedBlock[]> {
    const rows = await call<{
      block_key: string;
      locale: ContentLocale;
      country_code: string | null;
      version_no: number;
      body_md: string;
      asset_id: string | null;
    }>(
      this.#db,
      `SELECT block_key, locale, country_code::text AS country_code, version_no, body_md, asset_id
         FROM core.config_content_block
        WHERE status = 'PUBLISHED' AND ($2 OR country_code IS NULL OR country_code = $1)
        ORDER BY block_key, country_code NULLS FIRST, locale`,
      [country, all],
    );
    return rows.map((r) => ({
      blockKey: r.block_key,
      locale: r.locale,
      countryCode: r.country_code,
      versionNo: r.version_no,
      bodyMd: r.body_md,
      assetId: r.asset_id,
    }));
  }
}
