/**
 * US-706 — lecture de la vue des frais annexes (`core.claim_incidental_view`) par l'adaptateur :
 * un plafond du pays illisible n'est pas affiché et ne fait jamais échouer toute la vue (revue qa
 * delta 2) ; une vue illisible par ailleurs reste une erreur (fail-closed). Devise de test XTS.
 */
import { describe, expect, it } from 'vitest';
import { IncidentalStoreError, parseIncidentalView } from './store.js';

const VIEW = {
  outcome: 'OK',
  viewerRole: 'HOST',
  tripId: '0190f5a2-7c3e-7d4b-8a1f-3c5e9b2d4a6f',
  currency: 'XTS',
  timezone: 'Etc/UTC',
  endedAt: '2097-03-10T08:00:00.000Z',
  hostDeadlineAt: '2097-03-13T08:00:00.000Z',
  canSubmit: true,
  feeTypes: ['FUEL', 'CLEANING', 'SMOKING'],
  caps: { FUEL: null, CLEANING: '15000', SMOKING: '15000' },
  invoices: [],
  photos: [],
};

describe('parseIncidentalView — plafonds (US-706)', () => {
  it('plafonds lisibles rendus tels quels ; voyageur : null', () => {
    expect(parseIncidentalView(VIEW, 2)?.caps).toEqual(VIEW.caps);
    expect(parseIncidentalView({ ...VIEW, viewerRole: 'GUEST', caps: null }, 2)?.caps).toBeNull();
  });

  it('plafond mal formé (décimal, nombre, texte) ⇒ non affiché pour ce type, la vue reste lisible', () => {
    const caps = { FUEL: '45.00', CLEANING: 15000, SMOKING: 'abc' };
    expect(parseIncidentalView({ ...VIEW, caps }, 2)?.caps).toEqual({
      FUEL: null,
      CLEANING: null,
      SMOKING: null,
    });
    expect(parseIncidentalView({ ...VIEW, caps: 'x' }, 2)?.caps).toBeNull();
  });

  it('vue illisible ailleurs ⇒ erreur (jamais un état partiel)', () => {
    expect(() => parseIncidentalView({ ...VIEW, currency: 'xts' }, 2)).toThrow(
      IncidentalStoreError,
    );
  });
});
