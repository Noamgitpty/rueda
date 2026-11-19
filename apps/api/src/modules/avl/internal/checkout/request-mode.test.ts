/**
 * US-223 (ADR-175) — lecture fail-closed de `core.catalog_public_request_terms` (0153) par
 * AVL (devis S05) ; même règle dans CAT : `cat/internal/host-listings/request-mode.test.ts`. Ouvert seulement si la base rend `true` ET
 * un délai entier ≥ 1 (17 §7.2 `booking_request_expiry_hours` ; 19 US-223 DoR 2 : mode fermé,
 * jamais réservable).
 */
import { describe, expect, it } from 'vitest';
import { requestModeOf } from './store.js';

describe('US-223 — mode sur demande lu en base (AVL)', () => {
  it.each([['AVL', requestModeOf]] as const)(
    '%s : ouvert seulement avec un délai entier ≥ 1, toute autre ligne : fermé',
    (_, of) => {
      const closed = { enabled: false, expiryHours: null };
      expect(of({ request_mode_enabled: true, request_expiry_hours: 4 })).toEqual({
        enabled: true,
        expiryHours: 4,
      });
      expect(of({ request_mode_enabled: true, request_expiry_hours: '4' })).toEqual({
        enabled: true,
        expiryHours: 4,
      });
      for (const row of [
        undefined,
        {},
        { request_mode_enabled: false, request_expiry_hours: 4 },
        { request_mode_enabled: true, request_expiry_hours: null },
        { request_mode_enabled: true, request_expiry_hours: 0 },
        { request_mode_enabled: true, request_expiry_hours: 1.5 },
        { request_mode_enabled: 'true', request_expiry_hours: 4 },
        { request_mode_enabled: null, request_expiry_hours: null },
      ]) {
        expect(of(row), JSON.stringify(row)).toEqual(closed);
      }
    },
  );
});
