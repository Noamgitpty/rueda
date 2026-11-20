/**
 * Dommages, incidents et décisions dans la console (US-309, ADR-195 ; A09) : rendu dans chaque
 * locale configurée (une vue = une langue), délai et preuves tels que l'API les rend, gabarit de
 * la décision (jambes explicites, lignes exclues comme non refacturables BR-TT-05 / BR-FUEL-03,
 * voies de recours toujours citées, jamais « définitive »), saisie des montants dans la devise
 * convertie en unités mineures selon l'exposant (USD : 2, PYG : 0). Textes attendus : catalogue
 * @rueda/i18n (es fait foi), jamais le composant testé.
 */
import { CATALOGS, createTranslator } from '@rueda/i18n';
import { findForeignStrings } from '@rueda/i18n/testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import { ClaimsPanel, minorOf, recordProblem } from './claim-view.tsx';
import type { ClaimPreviewView, ClaimsState, ClaimView, DecisionDraft } from './claim-view.tsx';

const ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const CLAIM: ClaimView = {
  claimId: ID,
  tripId: ID,
  caseId: ID,
  country: 'XA',
  currency: 'XTA',
  exponent: 2,
  declaredBy: 'HOST',
  kind: 'DAMAGE',
  description: 'EXT_01 · 2035-06-11 09:00',
  status: 'REPORTED',
  reportedAt: '2035-06-11T09:00:00.000Z',
  tripEndAt: '2035-06-10T10:00:00.000Z',
  deadlineAt: '2035-06-11T10:00:00.000Z',
  evidence: { checkinPhotos: true, checkoutPhotos: false },
  guestCapMinor: '50000',
  decision: null,
};
const PREVIEW: ClaimPreviewView = {
  currency: 'XTA',
  exponent: 2,
  outcome: 'GUEST_LIABLE',
  covered: true,
  repairCostMinor: '120000',
  amountMinor: '45350',
  legs: { HOST: '40000', INSURER: '0', TAX_THIRD_PARTY: '350', PLATFORM: '5000' },
  lines: [{ category: 'REPAIR', leg: 'HOST', amountMinor: '40000' }],
  excluded: [
    {
      category: 'RECOVERY_PARKING',
      amountMinor: '1500',
      code: 'NOT_RECHARGEABLE',
      rule: 'BR-TT-05',
    },
    {
      category: 'NOT_ATTRIBUTABLE',
      amountMinor: '800',
      code: 'NOT_RECHARGEABLE',
      rule: 'BR-FUEL-03',
    },
  ],
  hostDeductibleMinor: '25000',
  guestCapMinor: '50000',
  evidence: { checkinPhotos: true, checkoutPhotos: true, guestAgreement: false },
  adminRequired: true,
};
const DRAFT: DecisionDraft = {
  outcome: 'GUEST_LIABLE',
  covered: true,
  repairCostMinor: '120000',
  amountMinor: '45350',
  lines: [
    { category: 'REPAIR', amountMinor: '40000' },
    { category: 'RECOVERY_PARKING', amountMinor: '1500' },
  ],
  hostDeductibleMinor: '25000',
  // texte libre de l'agent : neutre ici (une vue = une langue porte sur les textes du catalogue)
  facts: 'EXT_01 · EXT_02 · 2035-06-10 10:00 · 2035-06-11 09:00',
};
const DECIDED: ClaimView = {
  ...CLAIM,
  status: 'DECIDED',
  decision: {
    decisionId: ID,
    outcome: 'GUEST_LIABLE',
    covered: true,
    repairCostMinor: '120000',
    amountMinor: '45350',
    legs: PREVIEW.legs,
    lines: PREVIEW.lines,
    excluded: PREVIEW.excluded,
    hostDeductibleMinor: '25000',
    evidence: PREVIEW.evidence,
    facts: DRAFT.facts,
    decidedRole: 'ADMIN',
    decidedAt: '2035-06-11T11:00:00.000Z',
    execution: 'DONE',
    executionCode: null,
    insurerDeclaration: 'PENDING',
  },
};

const STATES: readonly ClaimsState[] = [
  { claim: null, preview: null },
  { claim: null, preview: null, notice: { tone: 'warning', key: 'common.claim.deadlinePassed' } },
  { claim: CLAIM, preview: null },
  { claim: CLAIM, preview: { draft: DRAFT, view: PREVIEW } },
  { claim: DECIDED, preview: null, notice: { tone: 'success', key: 'backoffice.claim.decided' } },
];

const profileOf = (tag: string) => {
  const profile = LOCALE_CONFIG.locales.find((p) => p.tag === tag);
  if (profile === undefined) throw new Error(tag);
  return profile;
};
const esTag = LOCALE_CONFIG.locales.find((p) => p.language === 'es')?.tag ?? '';
const es = CATALOGS.es.messages;
const noop = () => undefined;
const text = (state: ClaimsState, tag = esTag): string =>
  renderToStaticMarkup(
    <ClaimsPanel
      i18n={createTranslator(profileOf(tag))}
      state={state}
      handlers={{
        onClaimRecord: noop,
        onClaimRead: noop,
        onDecisionPreview: noop,
        onDecisionIssue: noop,
      }}
    />,
  )
    .replace(/<[^>]+>/g, ' ')
    .replaceAll('&#x27;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');

describe('sinistres (US-309) : une vue = une langue, dans chaque locale', () => {
  it.each(LOCALE_CONFIG.locales.map((p) => [p.tag, p] as const))('%s', (tag, profile) => {
    for (const [n, state] of STATES.entries()) {
      expect(findForeignStrings(text(state, tag), profile.language), `${tag} ${n}`).toEqual([]);
    }
  });
});

describe('sinistres (US-309) : déclaration, preuves, gabarit', () => {
  it('sans déclaration : formulaire d’enregistrement et ouverture ; refus de l’API expliqué', () => {
    const out = text(STATES[0] as ClaimsState);
    expect(out).toContain(es['backoffice.claim.recordHeading']);
    expect(out).toContain(es['backoffice.claim.deadlineNote']);
    expect(out).toContain(es['backoffice.claim.readHeading']);
    expect(text(STATES[1] as ClaimsState)).toContain(es['common.claim.deadlinePassed']);
  });

  it('déclaration : délai et preuves tels que l’API les rend (retour manquant signalé), franchise acceptée', () => {
    const t = createTranslator(profileOf(esTag));
    const out = text(STATES[2] as ClaimsState);
    expect(out).toContain(es['backoffice.claim.evidence.checkin']);
    expect(out).toContain(es['backoffice.claim.evidence.checkoutMissing']);
    expect(out).toContain(t.money({ amountMinor: 50000n, currency: 'XTA', exponent: 2 }));
    expect(out).toContain(`${t.dateTime('2035-06-11T10:00:00.000Z', 'UTC')} UTC`);
    expect(out).toContain(es['backoffice.claim.decisionHeading']);
    expect(out).not.toContain(es['backoffice.claim.templateHeading']);
  });

  it('aperçu : jambes explicites, parking et frais non imputable exclus, recours cité, ADMIN annoncé ; jamais « definitiva »', () => {
    const t = createTranslator(profileOf(esTag));
    const out = text(STATES[3] as ClaimsState);
    const money = (minor: bigint) => t.money({ amountMinor: minor, currency: 'XTA', exponent: 2 });
    for (const minor of [45350n, 40000n, 350n, 5000n]) expect(out).toContain(money(minor));
    expect(out).toContain(es['backoffice.claim.excluded.parking']);
    expect(out).toContain(es['backoffice.claim.excluded.notAttributable']);
    expect(out).toContain(es['backoffice.claim.template.recourse']);
    expect(out).toContain(es['backoffice.claim.adminNote']);
    expect(out).toContain(es['backoffice.claim.rule.GUEST_LIABLE']);
    for (const lang of ['es', 'en', 'fr', 'pt'] as const) {
      const all = Object.entries(CATALOGS[lang].messages)
        .filter(([k]) => k.startsWith('backoffice.claim.'))
        .map(([, v]) => String(v))
        .join(' ');
      // la seule mention de la finalité est le refus de la base (« nunca es definitiva »)
      expect(all.toLowerCase(), lang).not.toMatch(/inapelable|sin apelaci|sans appel|sem recurso/);
    }
  });

  it('décision enregistrée : résumé, exécution par Kmino, déclaration à l’assureur, recours', () => {
    const out = text(STATES[4] as ClaimsState);
    expect(out).toContain(es['backoffice.claim.decidedHeading']);
    expect(out).toContain(es['backoffice.claim.execution.DONE']);
    expect(out).toContain(es['backoffice.claim.insurer.PENDING']);
    expect(out).toContain(es['backoffice.claim.template.recourse']);
    expect(out).not.toContain(es['backoffice.claim.decisionHeading']);
  });

  it('montants saisis dans la devise ⇒ unités mineures selon l’exposant (exposant 2 puis 0), jamais un flottant', () => {
    expect(minorOf('450', 2)).toBe('45000');
    expect(minorOf('450.5', 2)).toBe('45050');
    expect(minorOf('450,50', 2)).toBe('45050');
    expect(minorOf('', 2)).toBe('0');
    expect(minorOf('0.001', 2)).toBeNull();
    expect(minorOf('-1', 2)).toBeNull();
    expect(minorOf('1e3', 2)).toBeNull();
    expect(minorOf('3500000', 0)).toBe('3500000');
    expect(minorOf('3500000.5', 0)).toBeNull();
    expect(minorOf('0.1', 2)).toBe('10');
  });

  it('saisie de la déclaration vérifiée avant l’envoi (la base reste juge)', () => {
    const ok = {
      tripId: ID,
      caseId: ID,
      declaredBy: 'HOST',
      kind: 'DAMAGE',
      description: 'Rayure au retour',
    } as const;
    expect(recordProblem(ok)).toBeNull();
    expect(recordProblem({ ...ok, tripId: 'x' })).toBe('backoffice.claim.error.trip');
    expect(recordProblem({ ...ok, caseId: 'x' })).toBe('backoffice.claim.error.case');
    expect(recordProblem({ ...ok, declaredBy: null })).toBe('backoffice.claim.error.who');
    expect(recordProblem({ ...ok, description: 'court' })).toBe(
      'backoffice.claim.error.description',
    );
  });
});
