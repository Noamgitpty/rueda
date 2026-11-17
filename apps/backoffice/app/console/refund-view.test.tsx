/**
 * Remboursements d'un voyage lus par la console (US-224 partie 224d, ADR-154 ; écran O01) : rendu
 * dans chaque locale configurée (une vue = une langue), montants affichés tels que l'API les rend
 * (unités mineures et exposant), parts demandées et ordre envoyé, motifs de blocage et codes des
 * alertes FIN expliqués, refus de lecture expliqué. Textes attendus : catalogue @rueda/i18n (es fait
 * foi), jamais le composant testé. Montants : −TJ02b (08 E7, export des oracles), avancés de la
 * jambe HOST (règle 3 bis : l'ordre porte la part HOST sur PLATFORM).
 */
import { CATALOGS, createTranslator } from '@rueda/i18n';
import { findForeignStrings } from '@rueda/i18n/testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import { alertCodeOf, REFUND_REASON_KEYS, RefundsPanel } from './refund-view.tsx';
import type { RefundsState, StaffRefundView, TripRefundsView } from './refund-view.tsx';

const TRIP = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const INSTANCE = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d';

const BLOCKED: StaffRefundView = {
  instanceId: INSTANCE,
  status: 'PLANNED',
  currency: 'XTA',
  amountMinor: '18744',
  rail: 'NATIVE_PARTIAL',
  attemptNo: 1,
  settlementVersion: 2,
  requestedLegs: { HOST: '8625', INSURER: '2550', TAX_THIRD_PARTY: '0', PLATFORM: '7569' },
  orderLegs: { HOST: '0', INSURER: '2550', TAX_THIRD_PARTY: '0', PLATFORM: '16194' },
  orderStatus: 'PENDING',
  blockedReason: 'PLATFORM_BALANCE_UNKNOWN',
  finAlert: 'BLOCKED:PLATFORM_BALANCE_UNKNOWN',
  advance: { status: 'PLANNED', amountMinor: '8625' },
  plannedAt: '2026-11-03T14:00:00.000Z',
  issuedAt: null,
};
const CONFIRMED: StaffRefundView = {
  ...BLOCKED,
  instanceId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5e',
  status: 'CONFIRMED',
  orderLegs: BLOCKED.requestedLegs,
  orderStatus: 'SUCCEEDED',
  blockedReason: null,
  finAlert: null,
  advance: null,
  issuedAt: '2026-11-03T14:00:10.000Z',
};
const VIEW: TripRefundsView = {
  tripId: TRIP,
  country: 'XA',
  exponent: 2,
  refunds: [
    BLOCKED,
    CONFIRMED,
    {
      ...BLOCKED,
      instanceId: TRIP,
      status: 'FAILED',
      blockedReason: null,
      finAlert: 'SEND:SUPERSEDED_UNSENT',
      advance: null,
    },
  ],
};

const STATES: readonly RefundsState[] = [
  { step: 'form' },
  { step: 'form', error: 'backoffice.refunds.tripInvalid' },
  { step: 'result', tripId: TRIP, view: VIEW },
  { step: 'result', tripId: TRIP, view: { ...VIEW, exponent: null, refunds: [] } },
  {
    step: 'result',
    tripId: TRIP,
    view: 'error',
    notice: { tone: 'warning', key: 'backoffice.refunds.tripInvalid' },
  },
];

const profileOf = (tag: string) => {
  const profile = LOCALE_CONFIG.locales.find((p) => p.tag === tag);
  if (profile === undefined) throw new Error(tag);
  return profile;
};
const esTag = LOCALE_CONFIG.locales.find((p) => p.language === 'es')?.tag ?? '';
const es = CATALOGS.es.messages;
const text = (state: RefundsState, tag = esTag): string =>
  renderToStaticMarkup(
    <RefundsPanel
      i18n={createTranslator(profileOf(tag))}
      state={state}
      handlers={{ onRefundsRead: () => undefined }}
    />,
  )
    .replace(/<[^>]+>/g, ' ')
    .replaceAll('&#x27;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');

describe('remboursements (224d) : une vue = une langue, dans chaque locale', () => {
  it.each(LOCALE_CONFIG.locales.map((p) => [p.tag, p] as const))('%s', (tag, profile) => {
    for (const state of STATES) {
      expect(
        findForeignStrings(text(state, tag), profile.language),
        `${tag} ${state.step}`,
      ).toEqual([]);
    }
  });
});

describe('remboursements (224d) : lecture', () => {
  it('formulaire seul tant qu’aucun voyage n’est lu ; identifiant invalide expliqué', () => {
    const out = text({ step: 'form' });
    expect(out).toContain(es['backoffice.refunds.heading']);
    expect(out).toContain(es['backoffice.refunds.read']);
    expect(out).not.toContain(es['backoffice.refunds.caption']);
    expect(text({ step: 'form', error: 'backoffice.refunds.tripInvalid' })).toContain(
      es['backoffice.refunds.tripInvalid'],
    );
  });

  it('montants tels que l’API les rend ; parts demandées ≠ ordre envoyé (avance) ; motif de blocage et alertes expliqués ; date d’émission ou « pas encore émis »', () => {
    const t = createTranslator(profileOf(esTag));
    const out = text({ step: 'result', tripId: TRIP, view: VIEW });
    const money = (minor: bigint) => t.money({ amountMinor: minor, currency: 'XTA', exponent: 2 });
    for (const minor of [18744n, 8625n, 2550n, 7569n, 16194n]) expect(out).toContain(money(minor));
    expect(out).toContain(es['backoffice.refunds.status.PLANNED']);
    expect(out).toContain(es['backoffice.refunds.status.CONFIRMED']);
    expect(out).toContain(es['backoffice.refunds.status.FAILED']);
    expect(out).toContain(es['backoffice.refunds.rail.NATIVE_PARTIAL']);
    expect(out).toContain(es['backoffice.refunds.reason.PLATFORM_BALANCE_UNKNOWN']);
    expect(out).toContain(es['backoffice.refunds.reason.SUPERSEDED_UNSENT']);
    expect(out).toContain(es['backoffice.refunds.notIssued']);
    expect(out).toContain(t.t('backoffice.refunds.advance', { amount: money(8625n) }));
    expect(out).toContain(`${t.dateTime('2026-11-03T14:00:10.000Z', 'UTC')} UTC`);
    // un motif de blocage et l'alerte qui le répète : une seule explication
    expect(out.split(es['backoffice.refunds.reason.PLATFORM_BALANCE_UNKNOWN']).length - 1).toBe(1);
  });

  it('aucun remboursement ⇒ dit ; lecture refusée ⇒ expliquée, jamais « rien »', () => {
    expect(text(STATES[3] as RefundsState)).toContain(es['backoffice.refunds.none']);
    const refused = text(STATES[4] as RefundsState);
    expect(refused).toContain(es['backoffice.refunds.tripInvalid']);
    expect(refused).not.toContain(es['backoffice.refunds.none']);
  });

  it('codes des alertes FIN (0127) : chaque code connu a son explication en quatre langues ; code inconnu montré tel quel', () => {
    expect(alertCodeOf('FAILED')).toBe('REFUND_FAILED');
    expect(alertCodeOf('BLOCKED:HOST_ADVANCE_CAP')).toBe('HOST_ADVANCE_CAP');
    expect(alertCodeOf('SEND:NO_TARGET')).toBe('NO_TARGET');
    expect(alertCodeOf('SUBMIT:REFUND_EXCEEDS_COLLECTED')).toBe('REFUND_EXCEEDS_COLLECTED');
    for (const code of [
      'ADVANCE_CAP_UNSET',
      'HOST_ADVANCE_CAP',
      'PLATFORM_BALANCE_UNKNOWN',
      'REFUND_EXCEEDS_COLLECTED',
      'SETTLEMENT_SUPERSEDED',
      'FIN_REVIEW_REQUIRED',
      'SUPERSEDED_UNSENT',
      'NO_TARGET',
      'MISMATCH',
      'REFUND_FAILED',
    ]) {
      const key = REFUND_REASON_KEYS[code];
      expect(key, code).toBeDefined();
      for (const lang of ['es', 'en', 'fr', 'pt'] as const) {
        expect(CATALOGS[lang].messages[key!], `${lang} ${code}`).toBeTruthy();
      }
    }
    const unknown = text({
      step: 'result',
      tripId: TRIP,
      view: { ...VIEW, refunds: [{ ...CONFIRMED, finAlert: 'REPORT:X_CODE' }] },
    });
    expect(unknown).toContain('X_CODE');
  });
});
