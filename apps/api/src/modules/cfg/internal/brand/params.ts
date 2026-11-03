/**
 * Paramètres du socle de marque (US-034, ADR-067) : liste des polices approuvées, durée du cache
 * de l'API de lecture, taille maximale d'un actif. Source : `../../data/brand.json` (versionnée,
 * PROPOSÉE). Validation fail-closed : un document mal formé lève `CONFIG_INVALID` au démarrage ;
 * une liste vide refuse toute police nommée (aucun repli permissif).
 */
import brand from '../../data/brand.json' with { type: 'json' };
import { ConfigError } from '../errors.js';

export interface ApprovedFont {
  readonly family: string;
  readonly license: string;
}

export interface BrandParams {
  readonly approvedFonts: readonly ApprovedFont[];
  /** Durée maximale de cache de l'API de lecture entre instances (ms). */
  readonly readCacheTtlMs: number;
  readonly assetMaxBytes: number;
}

const FAMILY = /^[A-Za-z0-9 -]{1,60}$/;

export function parseBrandParams(raw: unknown): BrandParams {
  const problems: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r['version'] !== 1) problems.push('version : 1 attendu');
  const fonts: ApprovedFont[] = [];
  if (!Array.isArray(r['approvedFonts'])) {
    problems.push('approvedFonts : tableau attendu');
  } else {
    for (const [i, f] of (r['approvedFonts'] as unknown[]).entries()) {
      const o = (f ?? {}) as Record<string, unknown>;
      if (typeof o['family'] !== 'string' || !FAMILY.test(o['family'])) {
        problems.push(`approvedFonts[${i}].family : nom de famille invalide`);
      } else if (typeof o['license'] !== 'string' || o['license'].trim().length < 3) {
        problems.push(`approvedFonts[${i}].license : licence à documenter`);
      } else if (fonts.some((x) => x.family === o['family'])) {
        problems.push(`approvedFonts[${i}].family : doublon`);
      } else {
        fonts.push({ family: o['family'], license: o['license'] });
      }
    }
  }
  const ttl = r['readCacheTtlSeconds'];
  if (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl < 0 || ttl > 60) {
    problems.push('readCacheTtlSeconds : entier de 0 à 60 (16 DSN-003 : moins d’une minute)');
  }
  const max = r['assetMaxBytes'];
  if (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > 10_485_760) {
    problems.push('assetMaxBytes : entier de 1 à 10 485 760');
  }
  if (problems.length > 0) {
    throw new ConfigError('CONFIG_INVALID', 'paramètres de marque invalides', problems);
  }
  return {
    approvedFonts: fonts,
    readCacheTtlMs: (ttl as number) * 1000,
    assetMaxBytes: max as number,
  };
}

/** Paramètres du dépôt, validés. */
export function loadBrandParams(): BrandParams {
  return parseBrandParams(brand);
}
