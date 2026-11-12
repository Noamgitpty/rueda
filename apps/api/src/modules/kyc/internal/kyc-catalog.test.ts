/**
 * Les messages visibles de la vérification d'identité passent par @rueda/i18n : chaque clé
 * renvoyée par l'API existe en es, en, fr et pt, sans emplacement (US-105).
 */
import { CATALOG_LANGUAGES, CATALOGS, placeholdersOf } from '@rueda/i18n';
import type { MessageKey } from '@rueda/i18n';
import { describe, expect, it } from 'vitest';
import { KYC_MESSAGES } from './errors.js';

describe('catalogue des messages de la vérification d’identité', () => {
  const keys = Object.values(KYC_MESSAGES).map((m) => m.messageKey);

  it('chaque clé existe dans chaque langue de catalogue (es, en, fr, pt), sans emplacement', () => {
    for (const language of CATALOG_LANGUAGES) {
      const messages = CATALOGS[language].messages as Readonly<Record<string, unknown>>;
      for (const key of keys) {
        expect(messages[key], `${language}:${key}`).toBeTypeOf('string');
        expect(placeholdersOf(messages[key] as string), `${language}:${key}`).toEqual([]);
      }
    }
  });

  it('les codes de 16 VER-001 / VER-002 ont leur statut', () => {
    expect(KYC_MESSAGES.KYC_BIOMETRIC_CONSENT_MISSING.status).toBe(403);
    expect(KYC_MESSAGES.KYC_LICENSE_EXPIRED.status).toBe(403);
    expect(KYC_MESSAGES.KYC_PROVIDER_UNAVAILABLE.status).toBe(503);
    expect(KYC_MESSAGES.KYC_SESSION_FAILED.status).toBe(502);
    const keyOf = (k: keyof typeof KYC_MESSAGES): MessageKey => KYC_MESSAGES[k].messageKey;
    expect(keyOf('KYC_LICENSE_EXPIRED')).toBe('common.kyc.licenseExpired');
  });
});
