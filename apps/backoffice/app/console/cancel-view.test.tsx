/**
 * Annulation d'un voyage par l'ops (US-215 partie 215b, ADR-151 ; écran O01) : rendu de chaque étape
 * dans chaque locale configurée (une vue = une langue), saisie fermée par demandeur, confirmation
 * avant envoi, état RÉEL de la demande (jamais « C'est fait » avant le règlement), montants
 * affichés tels que l'API les rend (unités mineures et exposant), refus et codes garés expliqués.
 * Textes attendus : catalogue @rueda/i18n (es fait foi), jamais le composant testé.
 */
import { CATALOGS, createTranslator } from '@rueda/i18n';
import { findForeignStrings } from '@rueda/i18n/testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import {
  CANCEL_OUTCOME_KEYS,
  CANCEL_REFUSAL_KEYS,
  CancelPanel,
  draftProblem,
  HOST_SUB_REASONS,
  PLATFORM_REASONS,
} from './cancel-view.tsx';
import type { CancelDraft, CancelHandlers, CancelState, CancellationView } from './cancel-view.tsx';
import { ConsoleView } from './view.tsx';
import type { ConsoleHandlers } from './view.tsx';

const TRIP = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const REQUEST = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';

const noop: CancelHandlers = {
  onCancelInitiator: () => undefined,
  onCancelReview: () => undefined,
  onCancelEdit: () => undefined,
  onCancelConfirm: () => undefined,
  onCancelRead: () => undefined,
  onCancelRestart: () => undefined,
};

const DRAFT: CancelDraft = {
  tripId: TRIP,
  initiator: 'HOST',
  subReason: 'INVALID_LICENSE',
  platformReason: null,
  reason: 'Ref 4242 zz 0001',
  evidence: [],
};

const base: CancellationView = {
  cancellationId: REQUEST,
  tripId: TRIP,
  action: 'CANCEL_TRIP_GUEST',
  requestedReason: 'GUEST_CANCELLED',
  initiator: 'GUEST',
  subReason: null,
  status: 'PENDING',
  outcomeCode: null,
  costBearer: null,
  requestedAt: '2026-11-03T14:00:00.000Z',
  decidedAt: null,
  tripStatus: 'BOOKED',
  settlement: null,
};

// vecteur T03 / TJ02b (critère 1 d'US-215) : 187,44 USD remboursés, HOST −86,25, INSURER −25,50,
// PLATFORM −75,69 ; exposant 2 rendu par l'API
const SETTLED: CancellationView = {
  ...base,
  status: 'SETTLED',
  costBearer: 'GUEST',
  decidedAt: '2026-11-03T14:00:10.000Z',
  tripStatus: 'CANCELLED_BY_GUEST',
  settlement: {
    currency: 'XTA',
    exponent: 2,
    guestRefundMinor: '18744',
    hostPenaltyMinor: '0',
    hostCompensationMinor: '0',
    legs: [
      { leg: 'HOST', variationMinor: '-8625' },
      { leg: 'INSURER', variationMinor: '-2550' },
      { leg: 'PLATFORM', variationMinor: '-7569' },
      { leg: 'TAX_THIRD_PARTY', variationMinor: '0' },
    ],
    refunds: [{ status: 'PENDING', amountMinor: '18744' }],
  },
};

const STATES: readonly CancelState[] = [
  { step: 'form', initiator: null },
  { step: 'form', initiator: 'GUEST' },
  { step: 'form', initiator: 'HOST', draft: DRAFT },
  { step: 'form', initiator: 'PLATFORM', error: 'backoffice.cancel.error.platformReason' },
  { step: 'confirm', draft: DRAFT },
  {
    step: 'state',
    tripId: TRIP,
    view: base,
    notice: { tone: 'success', key: 'backoffice.cancel.sent' },
  },
  { step: 'state', tripId: TRIP, view: base, slow: true },
  { step: 'state', tripId: TRIP, view: SETTLED },
  {
    step: 'state',
    tripId: TRIP,
    view: { ...base, status: 'FIN_REVIEW', outcomeCode: 'OPERATION_SETTLEMENT_FIN_REVIEW' },
  },
  {
    step: 'state',
    tripId: TRIP,
    view: { ...base, status: 'FAILED', outcomeCode: 'RETRY_EXHAUSTED' },
  },
  { step: 'state', tripId: TRIP, view: null },
  { step: 'state', tripId: TRIP, view: 'error' },
  {
    step: 'state',
    tripId: TRIP,
    view: undefined,
    notice: { tone: 'warning', key: 'backoffice.cancel.refused.CANCELLATION_PENDING' },
    offerRead: true,
  },
];

const profileOf = (tag: string) => {
  const profile = LOCALE_CONFIG.locales.find((p) => p.tag === tag);
  if (profile === undefined) throw new Error(tag);
  return profile;
};
const esTag = LOCALE_CONFIG.locales.find((p) => p.language === 'es')?.tag ?? '';
const es = CATALOGS.es.messages;

const html = (state: CancelState, tag = esTag): string =>
  renderToStaticMarkup(
    <CancelPanel i18n={createTranslator(profileOf(tag))} state={state} handlers={noop} />,
  );
/** Texte affiché seulement, entités de React décodées. */
const text = (state: CancelState, tag = esTag): string =>
  html(state, tag)
    .replace(/<[^>]+>/g, ' ')
    .replaceAll('&#x27;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');

describe('annulation (215b) : une vue = une langue, dans chaque locale', () => {
  it.each(LOCALE_CONFIG.locales.map((p) => [p.tag, p] as const))('%s', (tag, profile) => {
    for (const state of STATES) {
      expect(
        findForeignStrings(text(state, tag), profile.language),
        `${tag} ${state.step}`,
      ).toEqual([]);
    }
  });
});

describe('annulation (215b) : étapes', () => {
  it('formulaire : trois demandeurs, aucun champ avant le choix ; lecture de l’état toujours offerte', () => {
    const out = text({ step: 'form', initiator: null });
    for (const key of [
      'backoffice.action.CANCEL_TRIP_GUEST',
      'backoffice.action.CANCEL_TRIP_HOST',
      'backoffice.action.CANCEL_TRIP_PLATFORM',
      'backoffice.cancel.whoHint',
      'backoffice.cancel.readHeading',
    ] as const) {
      expect(out).toContain(es[key]);
    }
    expect(html({ step: 'form', initiator: null })).not.toContain('name="reason"');
  });

  it('hôte : sous-motifs de la liste fermée du catalogue (0124), « sans faute du voyageur » par défaut ; aucun champ de montant', () => {
    const out = html({ step: 'form', initiator: 'HOST' });
    expect(out).toContain('name="subReason"');
    for (const s of HOST_SUB_REASONS) expect(out).toContain(`value="${s}"`);
    expect(out).not.toContain('name="platformReason"');
    expect(out).not.toMatch(/name="amount/i);
    expect(text({ step: 'form', initiator: 'HOST' })).toContain(es['backoffice.cancel.subHint']);
  });

  it('plateforme : motif exigé, sans présélection, liste fermée (0124)', () => {
    const out = html({ step: 'form', initiator: 'PLATFORM' });
    expect(out).toMatch(/<select[^>]*name="platformReason"[^>]*required/);
    for (const r of PLATFORM_REASONS) expect(out).toContain(`value="${r}"`);
    expect(out).toMatch(/<option value="" disabled="" selected="">/);
  });

  it('confirmation : récapitulatif, avertissement irréversible, et pièce manquante signalée pour « à cause du voyageur »', () => {
    const out = text({ step: 'confirm', draft: DRAFT });
    expect(out).toContain(TRIP);
    expect(out).toContain(es['backoffice.cancel.sub.INVALID_LICENSE']);
    expect(out).toContain(es['backoffice.cancel.confirmIntro']);
    expect(out).toContain(es['backoffice.cancel.noEvidenceWarning']);
    expect(out).toContain(es['backoffice.cancel.confirm']);
    expect(text({ step: 'confirm', draft: { ...DRAFT, evidence: [REQUEST] } })).not.toContain(
      es['backoffice.cancel.noEvidenceWarning'],
    );
  });

  it('demande enregistrée puis en attente : jamais « C’est fait »', () => {
    const out = text(STATES[5] as CancelState);
    expect(out).toContain(es['backoffice.cancel.sent']);
    expect(out).toContain(es['backoffice.cancel.state.PENDING']);
    expect(out).not.toContain(es['common.auth.actionDone']);
    expect(text(STATES[6] as CancelState)).toContain(es['backoffice.cancel.slow']);
  });

  it('réglée : porteur du coût, issue, remboursement et variation par partie formatés (exposant de la devise rendu par l’API)', () => {
    const t = createTranslator(profileOf(esTag));
    const out = text({ step: 'state', tripId: TRIP, view: SETTLED });
    expect(out).toContain(es['backoffice.cancel.state.SETTLED']);
    expect(out).toContain(es['backoffice.cancel.bearer.GUEST']);
    expect(out).toContain(es['backoffice.cancel.trip.CANCELLED_BY_GUEST']);
    for (const minor of [18744n, -8625n, -2550n, -7569n]) {
      expect(out).toContain(t.money({ amountMinor: minor, currency: 'XTA', exponent: 2 }));
    }
    expect(out).toContain(es['backoffice.cancel.refund.PENDING']);
    // aucune pénalité ni compensation nulle affichée
    expect(out).not.toContain(es['backoffice.cancel.penalty']);
  });

  it('devise sans décimale (exposant 0) : montant rendu tel quel', () => {
    const t = createTranslator(profileOf(esTag));
    const pyg: CancellationView = {
      ...SETTLED,
      settlement: {
        ...(SETTLED.settlement as NonNullable<CancellationView['settlement']>),
        currency: 'XTB',
        exponent: 0,
        guestRefundMinor: '1250000',
        hostPenaltyMinor: '50000',
        legs: [{ leg: 'HOST', variationMinor: '-600000' }],
        refunds: [],
      },
    };
    const out = text({ step: 'state', tripId: TRIP, view: pyg });
    expect(out).toContain(t.money({ amountMinor: 1250000n, currency: 'XTB', exponent: 0 }));
    expect(out).toContain(es['backoffice.cancel.penalty']);
    expect(out).toContain(t.money({ amountMinor: 50000n, currency: 'XTB', exponent: 0 }));
  });

  it('revue FINANCE et échec : état réel, raison lisible, suite à donner, le voyage n’est pas annulé', () => {
    const fin = text(STATES[8] as CancelState);
    expect(fin).toContain(es['backoffice.cancel.state.FIN_REVIEW']);
    expect(fin).toContain(es['backoffice.cancel.state.FIN_REVIEWBody']);
    expect(fin).toContain(es['backoffice.cancel.outcome.OPERATION_SETTLEMENT_FIN_REVIEW']);
    const failed = text(STATES[9] as CancelState);
    expect(failed).toContain(es['backoffice.cancel.state.FAILED']);
    expect(failed).toContain(es['backoffice.cancel.state.FAILEDBody']);
    expect(failed).toContain(es['backoffice.cancel.outcome.RETRY_EXHAUSTED']);
    // code inconnu : le code lui-même, jamais un texte inventé
    expect(
      text({
        step: 'state',
        tripId: TRIP,
        view: { ...base, status: 'FAILED', outcomeCode: 'X_NEW' },
      }),
    ).toContain('X_NEW');
  });

  it('aucune demande, lecture impossible, demande déjà en cours : chacun expliqué', () => {
    expect(text(STATES[10] as CancelState)).toContain(es['backoffice.cancel.none']);
    expect(text(STATES[11] as CancelState)).toContain(es['backoffice.cancel.readError']);
    const pending = text(STATES[12] as CancelState);
    expect(pending).toContain(es['backoffice.cancel.refused.CANCELLATION_PENDING']);
    expect(pending).toContain(es['backoffice.cancel.readLive']);
  });

  it('chaque refus de la commande et chaque code garé de 215a a son texte dans les quatre langues', () => {
    for (const key of [
      ...Object.values(CANCEL_REFUSAL_KEYS),
      ...Object.values(CANCEL_OUTCOME_KEYS),
    ]) {
      for (const lang of ['es', 'en', 'fr', 'pt'] as const) {
        expect(CATALOGS[lang].messages[key], `${lang} ${key}`).toBeTruthy();
      }
    }
    expect(Object.keys(CANCEL_REFUSAL_KEYS).sort()).toEqual(
      [
        'CANCEL_REASON_REQUIRED',
        'TRIP_TRANSITION_FORBIDDEN',
        'CANCELLATION_PENDING',
        'SELF_FORBIDDEN',
        'NOT_FOUND',
      ].sort(),
    );
    // US-224f (ADR-166) : trois codes ajoutés (REFUND_RAIL_UNAVAILABLE, REFUND_RAIL_NOT_NATIVE,
    // REFUND_EXCEEDS_TENDER), chacun contrôlé ci-dessus dans les quatre langues
    expect(Object.keys(CANCEL_OUTCOME_KEYS)).toHaveLength(16);
  });
});

describe('annulation (215b) : contrôles avant la confirmation', () => {
  it.each([
    [{ ...DRAFT, tripId: 'abc' }, 'backoffice.cancel.error.trip'],
    [{ ...DRAFT, reason: 'court' }, 'backoffice.cancel.error.reason'],
    [{ ...DRAFT, reason: 'x'.repeat(1001) }, 'backoffice.cancel.error.reason'],
    [
      { ...DRAFT, initiator: 'PLATFORM', subReason: null, platformReason: null },
      'backoffice.cancel.error.platformReason',
    ],
    [DRAFT, null],
    [{ ...DRAFT, initiator: 'GUEST', subReason: null }, null],
  ] as const)('%j ⇒ %s', (draft, problem) => {
    expect(draftProblem(draft as CancelDraft)).toBe(problem);
  });
});

describe('console : le panneau d’annulation est réservé aux rôles qui ont ops.platform_cancel', () => {
  const handlers: ConsoleHandlers = {
    onLogin: () => undefined,
    onReveal: () => undefined,
    onVerify: () => undefined,
    onAction: () => undefined,
    onApprove: () => undefined,
    onSignOut: () => undefined,
  };
  const render = (role: string) =>
    renderToStaticMarkup(
      <ConsoleView
        i18n={createTranslator(profileOf(esTag))}
        state={{ kind: 'console', roles: [{ role, countries: ['AA'] }], entries: [] }}
        handlers={handlers}
        cancel={{ state: { step: 'form', initiator: null }, handlers: noop }}
      />,
    );
  it.each([
    ['OPS_AGENT', true],
    ['ADMIN', true],
    ['FINANCE', false],
    ['SUPPORT_AGENT', false],
  ] as const)('%s ⇒ %s', (role, shown) => {
    expect(render(role).includes('id="cancel-heading"')).toBe(shown);
  });
  it('les trois annulations ne sont plus dans le formulaire générique (saisie fermée exigée)', () => {
    expect(render('OPS_AGENT')).not.toMatch(/name="action" value="CANCEL_TRIP_/);
  });
});
