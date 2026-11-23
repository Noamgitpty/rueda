/**
 * US-706 — lecture défensive de la vue des frais annexes et liens des écrans (16 CLM-021 ; 10b A04,
 * S12). Toute forme inattendue de l'API ⇒ `null` (l'écran dit l'erreur, jamais un état deviné) ;
 * aucun lien ne reprend une adresse reçue. Données fictives.
 */
import { describe, expect, it } from 'vitest';
import {
  doneOf,
  incidentalFailureKey,
  incidentalHref,
  incidentalOffered,
  tripIncidentalOf,
} from './trip-incidental.ts';

const TRIP = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const INV = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const FILE = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d';
const ORG = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5e';

const VIEW = {
  tripId: TRIP,
  viewerRole: 'GUEST',
  currency: 'XTS',
  currencyExponent: 2,
  timezone: 'Etc/UTC',
  endedAt: '2097-03-10T08:00:00.000Z',
  hostDeadlineAt: '2097-03-13T08:00:00.000Z',
  canSubmit: false,
  caps: null,
  feeTypes: ['FUEL', 'CLEANING', 'SMOKING'],
  invoices: [
    {
      id: INV,
      feeType: 'CLEANING',
      amountMinor: '4500',
      status: 'AWAITING_GUEST',
      notifiedAt: '2097-03-10T10:00:00.000Z',
      responseDueAt: '2097-03-13T10:00:00.000Z',
      windowOpen: true,
      description: 'Sable sur la banquette arrière',
      evidenceCount: 1,
      evidence: [
        {
          kind: 'CHECKOUT',
          slotCode: 'INT_01',
          slotGroup: 'INTERIOR',
          takenBy: 'HOST',
          receivedAt: '2097-03-10T08:00:00.000Z',
        },
      ],
      disputeReason: null,
      decision: null,
      decisionRationale: null,
      chargeStatus: null,
    },
  ],
  photos: [
    { fileId: FILE, kind: 'CHECKOUT', slotCode: 'INT_01', slotGroup: 'INTERIOR', takenBy: 'HOST' },
  ],
};

describe('vue des frais annexes (US-706)', () => {
  it('lit la vue de l’API telle quelle', () => {
    expect(tripIncidentalOf({ status: 200, json: VIEW, headers: {} } as never)).toEqual(VIEW);
  });

  it('plafond illisible ⇒ non affiché, la vue reste lisible (aide du montant seulement)', () => {
    const json = { ...VIEW, caps: { FUEL: '45.00', CLEANING: '15000', SMOKING: 7 } };
    expect(tripIncidentalOf({ status: 200, json, headers: {} } as never)?.caps).toEqual({
      FUEL: null,
      CLEANING: '15000',
      SMOKING: null,
    });
    expect(
      tripIncidentalOf({ status: 200, json: { ...VIEW, caps: 'x' }, headers: {} } as never)?.caps,
    ).toBeNull();
  });

  it('forme inattendue ⇒ null (jamais un état partiel)', () => {
    const bad = [
      { ...VIEW, viewerRole: 'COHOST' },
      { ...VIEW, currencyExponent: 2.5 },
      { ...VIEW, feeTypes: ['MILEAGE'] },
      { ...VIEW, invoices: [{ ...VIEW.invoices[0], amountMinor: '45.00' }] },
      { ...VIEW, invoices: [{ ...VIEW.invoices[0], status: 'PAID' }] },
      { ...VIEW, invoices: [{ ...VIEW.invoices[0], responseDueAt: '2097-03-13' }] },
      { ...VIEW, photos: [{ ...VIEW.photos[0], slotCode: 'ROOF' }] },
      { ...VIEW, endedAt: 'hier' },
      { ...VIEW, invoices: [{ ...VIEW.invoices[0], evidence: [{ kind: 'ROOF' }] }] },
    ];
    for (const json of bad) {
      expect(tripIncidentalOf({ status: 200, json, headers: {} } as never)).toBeNull();
    }
    expect(tripIncidentalOf({ status: 404, json: VIEW, headers: {} } as never)).toBeNull();
    expect(tripIncidentalOf({ status: 'unavailable' })).toBeNull();
  });

  it('liens reconstruits : compte d’hôte vérifié, résultat d’action fermé', () => {
    expect(incidentalHref('GUEST', TRIP, null)).toBe(`/trips/${TRIP}/incidental-fees`);
    expect(incidentalHref('HOST', TRIP, ORG, 'submitted')).toBe(
      `/host/trips/${TRIP}/incidental-fees?org=${ORG}&done=submitted`,
    );
    expect(incidentalHref('HOST', TRIP, 'https://evil.test')).toBe(
      `/host/trips/${TRIP}/incidental-fees`,
    );
    expect(doneOf('accepted')).toBe('accepted');
    expect(doneOf('<script>')).toBeNull();
    expect(incidentalOffered('COMPLETED')).toBe(true);
    expect(incidentalOffered('IN_PROGRESS')).toBe(false);
    expect(incidentalFailureKey({ status: 'unavailable' })).toBe('common.incidental.unavailable');
    expect(
      incidentalFailureKey({
        status: 422,
        json: { code: 'CLAIM_EVIDENCE_MISSING', messageKey: 'common.incidental.evidenceMissing' },
        headers: {},
      } as never),
    ).toBe('common.incidental.evidenceMissing');
  });
});
