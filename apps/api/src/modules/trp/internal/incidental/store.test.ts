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

describe('parseIncidentalView — pièces décrites (ADR-202, F-L3-FRA-02)', () => {
  const invoice = (evidence: unknown[]) => ({
    id: '0190f5a2-7c3e-7d4b-8a1f-3c5e9b2d4a70',
    feeType: 'CLEANING',
    amountMinor: '4500',
    status: 'AWAITING_GUEST',
    notifiedAt: '2097-03-10T10:00:00.000Z',
    responseDueAt: '2097-03-13T10:00:00.000Z',
    windowOpen: true,
    description: 'Sable sur la banquette arrière',
    evidenceCount: evidence.length,
    evidence,
    disputeReason: null,
    decision: null,
    decisionRationale: null,
    chargeStatus: null,
  });
  const file = {
    kind: 'HOST_FILE',
    takenBy: 'HOST',
    mime: 'image/jpeg',
    receivedAt: '2097-03-10T09:00:00.000Z',
  };

  it('fichier de l’hôte : type et heure serveur de dépôt lus tels quels', () => {
    const v = parseIncidentalView({ ...VIEW, invoices: [invoice([file])] }, 2);
    expect(v?.invoices[0]?.evidence).toEqual([
      {
        kind: 'HOST_FILE',
        takenBy: 'HOST',
        mime: 'image/jpeg',
        receivedAt: new Date(file.receivedAt),
      },
    ]);
  });

  it('type de fichier, auteur ou heure inattendus ⇒ erreur (jamais un état partiel)', () => {
    for (const bad of [
      { ...file, mime: 'application/pdf' },
      { ...file, takenBy: 'GUEST' },
      { ...file, receivedAt: 'hier' },
    ]) {
      expect(() => parseIncidentalView({ ...VIEW, invoices: [invoice([bad])] }, 2)).toThrow(
        IncidentalStoreError,
      );
    }
  });
});
