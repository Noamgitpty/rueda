/**
 * Matrice de capacités fail-closed (17 §2.8) : seule une valeur VALIDATED_* compte ; inconnue,
 * documentée, de mauvais type ⇒ « non » ; capacités bloquantes par variante.
 */
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, CAPABILITY_NAMES, CapabilitySet } from './capabilities.js';
import type { CapabilityRecord, CapabilityStatus } from './capabilities.js';
import { PaymentError } from './errors.js';

const rec = (
  capability: string,
  value: unknown,
  status: CapabilityStatus = 'VALIDATED_SANDBOX',
  method = '*',
  network = '*',
): CapabilityRecord => ({ capability, value, status, method, network });

describe('CapabilitySet', () => {
  it('matrice vide : tout est « non » (booléen false, durée 0, énumération UNKNOWN)', () => {
    const caps = new CapabilitySet([]);
    for (const name of CAPABILITY_NAMES) expect(caps.has(name), name).toBe(false);
    expect(caps.int('MAX_HOLD_HOURS')).toBe(0);
    expect(caps.enumValue('WEBHOOK_SIGNATURE_SCHEME')).toBe('UNKNOWN');
  });

  it.each<CapabilityStatus>(['DOCUMENTED', 'UNKNOWN'])('statut %s ⇒ non utilisé', (status) => {
    const caps = new CapabilitySet([
      rec('SUPPORTS_VOID', true, status),
      rec('MAX_HOLD_HOURS', 168, status),
    ]);
    expect(caps.bool('SUPPORTS_VOID')).toBe(false);
    expect(caps.int('MAX_HOLD_HOURS')).toBe(0);
  });

  it('VALIDATED_SANDBOX et VALIDATED_CONTRACT ⇒ utilisés', () => {
    const caps = new CapabilitySet([
      rec('SUPPORTS_VOID', true, 'VALIDATED_CONTRACT'),
      rec('MAX_HOLD_HOURS', 168),
      rec('CHARGEBACK_NOTIFICATION_CHANNEL', 'WEBHOOK'),
    ]);
    expect(caps.bool('SUPPORTS_VOID')).toBe(true);
    expect(caps.int('MAX_HOLD_HOURS')).toBe(168);
    expect(caps.enumValue('CHARGEBACK_NOTIFICATION_CHANNEL')).toBe('WEBHOOK');
  });

  it('valeur de mauvais type ou hors domaine ⇒ non', () => {
    const caps = new CapabilitySet([
      rec('SUPPORTS_VOID', 'true'),
      rec('SUPPORTS_REFUND', 1),
      rec('MAX_HOLD_HOURS', '168'),
      rec('ROLLBACK_WINDOW_HOURS', -1),
      rec('ORDER_TTL_SECONDS', 1.5),
      rec('WEBHOOK_SIGNATURE_SCHEME', 'hmac sha256'),
    ]);
    expect(caps.bool('SUPPORTS_VOID')).toBe(false);
    expect(caps.bool('SUPPORTS_REFUND')).toBe(false);
    expect(caps.int('MAX_HOLD_HOURS')).toBe(0);
    expect(caps.int('ROLLBACK_WINDOW_HOURS')).toBe(0);
    expect(caps.int('ORDER_TTL_SECONDS')).toBe(0);
    expect(caps.enumValue('WEBHOOK_SIGNATURE_SCHEME')).toBe('UNKNOWN');
  });

  it('précision : (moyen, réseau) puis (moyen, *) puis (*, *)', () => {
    const caps = new CapabilitySet([
      rec('ORDER_TTL_SECONDS', 300, 'VALIDATED_SANDBOX', 'YAPPY'),
      rec('SUPPORTS_PARTIAL_REFUND', false, 'VALIDATED_SANDBOX', 'YAPPY'),
      rec('SUPPORTS_PARTIAL_REFUND', true),
      rec('SUPPORTS_3DS', true, 'VALIDATED_SANDBOX', 'CARD', 'VISA'),
    ]);
    expect(caps.int('ORDER_TTL_SECONDS', 'YAPPY')).toBe(300);
    expect(caps.int('ORDER_TTL_SECONDS', 'CARD')).toBe(0);
    expect(caps.bool('SUPPORTS_PARTIAL_REFUND', 'YAPPY')).toBe(false);
    expect(caps.bool('SUPPORTS_PARTIAL_REFUND', 'CARD')).toBe(true);
    expect(caps.bool('SUPPORTS_3DS', 'CARD', 'VISA')).toBe(true);
    expect(caps.bool('SUPPORTS_3DS', 'CARD', 'AMEX')).toBe(false);
  });

  it('require : UNSUPPORTED_CAPABILITY nommant la capacité', () => {
    const caps = new CapabilitySet([]);
    expect(() => caps.requireCapability('SUPPORTS_MIT')).toThrow(PaymentError);
    try {
      caps.requireCapability('SUPPORTS_MIT');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'UNSUPPORTED_CAPABILITY',
        details: { capability: 'SUPPORTS_MIT' },
      });
    }
  });

  it('capacités bloquantes : liste de 17 §2.8 ; SUPPORTS_MULTI_LEG_SPLIT seulement en variante A', () => {
    const blocking = CAPABILITY_NAMES.filter((n) => CAPABILITIES[n].blocking === true).sort();
    expect(blocking).toEqual(
      [
        'CHARGEBACK_NOTIFICATION_CHANNEL',
        'SUPPORTS_B2C_PAYOUT',
        'SUPPORTS_DELAYED_PAYOUT_RELEASE',
        'SUPPORTS_INDIVIDUAL_SUBMERCHANT',
        'SUPPORTS_LOOKUP_BY_MERCHANT_REF',
        'SUPPORTS_MIT',
        'SUPPORTS_NEGATIVE_BALANCE_RECOVERY',
        'SUPPORTS_PARTIAL_CAPTURE',
        'SUPPORTS_PARTIAL_REFUND',
        'SUPPORTS_PAYOUT_ADJUSTMENT',
        'SUPPORTS_PER_LEG_AMOUNTS',
        'SUPPORTS_REFUND',
        'SUPPORTS_SUBMERCHANT',
        'WEBHOOK_SIGNATURE_SCHEME',
      ].sort(),
    );
    const empty = new CapabilitySet([]);
    expect(empty.missingBlocking('SPLIT_AT_SOURCE')).toContain('SUPPORTS_MULTI_LEG_SPLIT');
    expect(empty.missingBlocking('PLATFORM_MOR')).not.toContain('SUPPORTS_MULTI_LEG_SPLIT');
    const all = new CapabilitySet(
      CAPABILITY_NAMES.map((n) =>
        rec(
          n,
          CAPABILITIES[n].kind === 'bool' ? true : CAPABILITIES[n].kind === 'int' ? 1 : 'WEBHOOK',
        ),
      ),
    );
    expect(all.missingBlocking('SPLIT_AT_SOURCE')).toEqual([]);
  });

  it('SUPPORTS_PLATFORM_LEG_TRANSFER : non bloquante, faux par défaut', () => {
    expect(CAPABILITIES.SUPPORTS_PLATFORM_LEG_TRANSFER.blocking).toBe(false);
    expect(new CapabilitySet([]).bool('SUPPORTS_PLATFORM_LEG_TRANSFER')).toBe(false);
  });
});
