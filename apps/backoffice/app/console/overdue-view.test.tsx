/**
 * Vue des retards et escalade de non-restitution (US-306, ADR-193 ; écran O01 ; 16 ADM-022,
 * TRP-038 ; 08 BR-RETURN-04 ; OQ-BR-17) : rendu dans chaque locale configurée (une vue = une
 * langue), étape et étape suivante avec son heure, étapes franchies et gabarits produits, une seule
 * étape préparée à la fois, ce que la plateforme fait et ne fait pas dit avant la confirmation,
 * refus de la base expliqués. Textes attendus : catalogue @rueda/i18n (es fait foi), jamais le
 * composant testé.
 */
import { CATALOGS, createTranslator } from '@rueda/i18n';
import { findForeignStrings } from '@rueda/i18n/testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import { ESCALATION_STEPS, OVERDUE_REFUSAL_KEYS, OverduePanel } from './overdue-view.tsx';
import type { OverdueBoardView, OverdueState, OverdueTripView } from './overdue-view.tsx';

const TRIP = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const NEXT_AT = '2026-11-03T16:00:00.000Z';

const DETECTED: OverdueTripView = {
  tripId: TRIP,
  country: 'XA',
  status: 'OVERDUE',
  stage: 'T30M',
  scheduledEnd: '2026-11-03T14:00:00.000Z',
  detectedAt: '2026-11-03T14:30:00.000Z',
  lateMinutes: 31,
  nextStep: 'CONTACT',
  nextStepAt: NEXT_AT,
  paramMissing: false,
  nextTripAtRisk: true,
  escalations: [],
};
const NOTICE: OverdueTripView = {
  ...DETECTED,
  tripId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
  stage: 'T6H',
  lateMinutes: 6 * 60 + 5,
  nextStep: 'POLICE_REPORT',
  nextTripAtRisk: false,
  escalations: [
    { stage: 'T2H', escalatedAt: '2026-11-03T16:01:00.000Z', documents: ['CONTACT_SCRIPT'] },
    {
      stage: 'T6H',
      escalatedAt: '2026-11-03T20:02:00.000Z',
      documents: ['DEMAND_LETTER', 'GPS_REQUEST'],
    },
  ],
};
const DONE: OverdueTripView = {
  ...NOTICE,
  tripId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d',
  stage: 'T24H',
  nextStep: null,
  nextStepAt: null,
};
const MISSING: OverdueTripView = {
  ...DETECTED,
  tripId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5e',
  nextStepAt: null,
  paramMissing: true,
};
const VIEW: OverdueBoardView = {
  countries: ['XA'],
  readAt: '2026-11-03T14:31:00.000Z',
  trips: [DETECTED, NOTICE, DONE, MISSING],
};

const STATES: readonly OverdueState[] = [
  {},
  { view: VIEW },
  { view: { ...VIEW, trips: [] } },
  { view: 'error', notice: { tone: 'warning', key: 'common.auth.forbidden' } },
  ...ESCALATION_STEPS.map((step) => ({ view: VIEW, draft: { tripId: TRIP, step } })),
  {
    view: VIEW,
    draft: { tripId: TRIP, step: 'CONTACT', error: 'backoffice.overdue.reasonTooShort' },
  },
  ...Object.values(OVERDUE_REFUSAL_KEYS).map((key): OverdueState => ({
    view: VIEW,
    notice: { tone: 'warning', key },
  })),
];

const profileOf = (tag: string) => {
  const profile = LOCALE_CONFIG.locales.find((p) => p.tag === tag);
  if (profile === undefined) throw new Error(tag);
  return profile;
};
const esTag = LOCALE_CONFIG.locales.find((p) => p.language === 'es')?.tag ?? '';
const es = CATALOGS.es.messages;
const noop = () => undefined;
const html = (state: OverdueState, tag = esTag): string =>
  renderToStaticMarkup(
    <OverduePanel
      i18n={createTranslator(profileOf(tag))}
      state={state}
      handlers={{
        onOverdueRefresh: noop,
        onOverduePrepare: noop,
        onOverdueCancel: noop,
        onOverdueEscalate: noop,
      }}
    />,
  );
const text = (state: OverdueState, tag = esTag): string =>
  html(state, tag)
    .replace(/<[^>]+>/g, ' ')
    .replaceAll('&#x27;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');

describe('vue des retards (US-306) : une vue = une langue, dans chaque locale', () => {
  it.each(LOCALE_CONFIG.locales.map((p) => [p.tag, p] as const))('%s', (tag, profile) => {
    for (const [n, state] of STATES.entries()) {
      expect(findForeignStrings(text(state, tag), profile.language), `${tag} ${n}`).toEqual([]);
    }
  });
});

describe('vue des retards (US-306) : lecture et escalade', () => {
  it('étape, retard, fin prévue, étape suivante et son heure ; étapes franchies avec leurs gabarits ; trip suivant à risque', () => {
    const t = createTranslator(profileOf(esTag));
    const out = text({ view: VIEW });
    expect(out).toContain(es['backoffice.overdue.heading']);
    expect(out).toContain(es['backoffice.overdue.stage.T30M']);
    expect(out).toContain(es['backoffice.overdue.stage.T6H']);
    expect(out).toContain(es['backoffice.overdue.stage.T24H']);
    expect(out).toContain(t.t('backoffice.overdue.lateMinutes', { m: 31 }));
    expect(out).toContain(t.t('backoffice.overdue.lateHours', { h: 6, m: 5 }));
    expect(out).toContain(es['backoffice.overdue.step.CONTACT']);
    expect(out).toContain(es['backoffice.overdue.step.POLICE_REPORT']);
    expect(out).toContain(
      t.t('backoffice.overdue.from', { at: `${t.dateTime(NEXT_AT, 'UTC')} UTC` }),
    );
    expect(out).toContain(es['backoffice.overdue.nextTripAtRisk']);
    expect(out).toContain(es['backoffice.overdue.document.DEMAND_LETTER']);
    expect(out).toContain(es['backoffice.overdue.document.GPS_REQUEST']);
    expect(out).toContain(es['backoffice.overdue.allDone']);
    expect(out).toContain(es['backoffice.overdue.paramMissing']);
    // T24H franchie : aucune étape à préparer ; heures absentes : aucune non plus
    expect(html({ view: { ...VIEW, trips: [DONE, MISSING] } })).not.toContain(
      String(es['backoffice.overdue.prepare']),
    );
    // aucune confirmation tant qu'aucune étape n'est préparée
    expect(out).not.toContain(String(es['backoffice.overdue.never']));
  });

  it('étape préparée : ce qui est remis à l’hôte et ce que la plateforme ne fait jamais, dits avant la confirmation ; motif trop court expliqué', () => {
    for (const step of ESCALATION_STEPS) {
      const out = text({ view: VIEW, draft: { tripId: TRIP, step } });
      expect(out).toContain(es[`backoffice.overdue.effect.${step}`]);
      expect(out).toContain(es['backoffice.overdue.never']);
      expect(out).toContain(TRIP);
    }
    expect(
      text({
        view: VIEW,
        draft: { tripId: TRIP, step: 'CONTACT', error: 'backoffice.overdue.reasonTooShort' },
      }),
    ).toContain(es['backoffice.overdue.reasonTooShort']);
  });

  it('aucun trip en retard ⇒ dit ; lecture refusée ⇒ expliquée, jamais « rien » ; chaque refus de la base a son explication en quatre langues', () => {
    expect(text({ view: { ...VIEW, trips: [] } })).toContain(es['backoffice.overdue.none']);
    const refused = text(STATES[3] as OverdueState);
    expect(refused).not.toContain(es['backoffice.overdue.none']);
    for (const code of [
      'OVERDUE_STEP_TOO_EARLY',
      'OVERDUE_STEP_OUT_OF_ORDER',
      'TRIP_NOT_OVERDUE',
      'OVERDUE_CASE_MISSING',
      'PARAM_MISSING',
      'SELF_FORBIDDEN',
    ]) {
      const key = OVERDUE_REFUSAL_KEYS[code];
      expect(key, code).toBeDefined();
      for (const lang of ['es', 'en', 'fr', 'pt'] as const) {
        expect(CATALOGS[lang].messages[key!], `${lang} ${code}`).toBeTruthy();
      }
    }
  });
});
