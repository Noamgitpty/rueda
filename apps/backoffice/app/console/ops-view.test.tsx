/**
 * Écran O01 de 10b, files de travail (US-109) : rendu dans chaque locale configurée (es-PA, es-PY,
 * en, fr, pt-BR), une vue = une langue (aucune chaîne d'une autre langue) ; ce que chaque état
 * montre : retard signalé dans une file (16 ADM-029), dossier KYC ouvert par la file seulement et
 * consultation annoncée comme journalisée (ADM-032), fiche 360° avec statut KYC sans pièce,
 * restriction active annoncée et comptes d'hôte fermés à la réservation (ADM-005), restriction et
 * levée motivées, aucune saisie de montant ; demande d'ajout au catalogue (US-114, 16 ADM-036) :
 * variantes candidates à rattacher, création sous licence, refus motivé, aucune donnée personnelle.
 * US-106 : dossier KYC complété (état SM-3, motif, permis, scores, aucune image) et formulaire de
 * décision (quatre contrôles cochés jamais pré-cochés, motif, trois décisions de SM-3) seulement
 * pour un dossier en revue ; refus de la commande expliqués. Textes attendus : catalogue
 * @rueda/i18n (es fait foi).
 */
import { CATALOGS, createTranslator } from '@rueda/i18n';
import { findForeignStrings } from '@rueda/i18n/testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import {
  evidenceReasonKey,
  evidenceRefusal,
  KYC_REASON_KEYS,
  KYC_REFUSAL_KEYS,
  KYC_STATUSES,
  kycStatusLabel,
  OpsPanels,
} from './ops-view.tsx';
import type { OpsHandlers, OpsState } from './ops-view.tsx';
import { ConsoleView } from './view.tsx';
import type { ConsoleHandlers } from './view.tsx';

const noop: OpsHandlers = {
  onShowQueue: () => undefined,
  onClaim: () => undefined,
  onOpenKyc: () => undefined,
  onKycDecision: () => undefined,
  onOpenCatalog: () => undefined,
  onResolveCatalog: () => undefined,
  onSearch: () => undefined,
  onOpenProfile: () => undefined,
  onAddNote: () => undefined,
  onRestriction: () => undefined,
  onOpenCase: () => undefined,
  onResolveCase: () => undefined,
  onUpload: () => undefined,
};

const A = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const B = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const AT = '2026-11-11T09:30:00.000Z';

const FULL: OpsState = {
  queues: {
    summary: [
      { queue: 'KYC', open: 3, overdue: 1 },
      { queue: 'LISTING', open: 0, overdue: 0 },
    ],
    selected: 'KYC',
    items: [
      {
        id: A,
        queue: 'KYC',
        subjectType: 'USER_ACCOUNT',
        subjectId: B,
        country: 'AA',
        slaDueAt: AT,
        overdue: true,
        assigned: true,
        assignedToMe: true,
      },
      {
        id: B,
        queue: 'KYC',
        subjectType: 'USER_ACCOUNT',
        subjectId: A,
        country: 'AA',
        slaDueAt: AT,
        overdue: false,
        assigned: false,
        assignedToMe: false,
      },
    ],
  },
  kyc: {
    itemId: A,
    userId: B,
    kycStatus: 'NOT_STARTED',
    verification: null,
    legalFirstName: 'Zzq',
    legalLastName: 'Xxw',
    dateOfBirth: null,
    residenceCountry: null,
  },
  profile: {
    country: 'AA',
    profile: {
      id: B,
      email: 'zzq@example.test',
      emailVerified: true,
      phone: null,
      phoneVerified: false,
      legalFirstName: 'Zzq',
      legalLastName: 'Xxw',
      status: 'ACTIVE',
    },
    kyc: { status: 'NOT_STARTED' },
    restricted: true,
    restrictions: [{ id: A, kind: 'TS_HOLD', active: true, reason: 'Ref 4242 zz', createdAt: AT }],
    notes: [{ id: A, authorRole: 'SUPPORT_AGENT', body: 'Ref 77 zz', createdAt: AT }],
    hostAccounts: [{ orgId: A, country: 'AA', status: 'ACTIVE', bookable: false }],
    trips: [{ id: A, status: 'BOOKED', scheduledStart: AT }],
    cases: [{ id: A, category: 'ACCOUNT', status: 'OPEN', assignedToMe: true }],
  },
  notice: { tone: 'success', key: 'backoffice.evidence.received', values: { id: A } },
};

/** Dossier en revue (US-106) : motif du fournisseur, permis, scores [C3], consentement retiré. */
const IN_REVIEW: OpsState = {
  kyc: {
    itemId: A,
    userId: B,
    kycStatus: 'MANUAL_REVIEW',
    verification: {
      id: A,
      status: 'MANUAL_REVIEW',
      reasonCode: 'LICENSE_PROVISIONAL',
      attempt: 1,
      country: 'AA',
      consentCurrent: false,
      document: {
        type: 'IDP',
        issuingCountry: 'ZZ',
        expiresOn: '2031-01-31',
        licenseClass: 'B',
        permanent: false,
        status: 'IN_REVIEW',
      },
      liveness: { result: 'REVIEW', livenessScore: 0.4211, faceMatchScore: 0.8875, erased: false },
    },
    legalFirstName: 'Zzq',
    legalLastName: 'Xxw',
    dateOfBirth: null,
    residenceCountry: null,
  },
};
const DECIDED: OpsState = {
  kyc: {
    ...(IN_REVIEW.kyc as NonNullable<OpsState['kyc']>),
    kycStatus: 'REJECTED',
    verification: {
      ...(IN_REVIEW.kyc?.verification as NonNullable<NonNullable<OpsState['kyc']>['verification']>),
      status: 'REJECTED',
      reasonCode: 'LIVENESS_FAILED',
      consentCurrent: true,
      document: null,
      liveness: { result: 'REVIEW', livenessScore: null, faceMatchScore: null, erased: true },
    },
  },
};

const CATALOG: OpsState = {
  queues: {
    summary: [{ queue: 'CATALOG_ADDITION', open: 1, overdue: 0 }],
    selected: 'CATALOG_ADDITION',
    items: [
      {
        id: A,
        queue: 'CATALOG_ADDITION',
        subjectType: 'CATALOG_ADDITION_REQUEST',
        subjectId: B,
        country: 'AA',
        slaDueAt: AT,
        overdue: false,
        assigned: true,
        assignedToMe: true,
      },
    ],
  },
  catalog: {
    itemId: A,
    requestId: B,
    country: 'AA',
    makeText: 'Zzqmake',
    modelText: 'Xxw 2',
    year: 2021,
    trimText: null,
    vinMasked: 'ABCDEFGHJKL******',
    transmission: 'MANUAL',
    seats: 5,
    fuelType: 'GASOLINE',
    slaDueAt: AT,
    candidates: [
      {
        variantId: B,
        make: 'Zzqmake',
        model: 'Xxw 7',
        yearFrom: 2020,
        yearTo: null,
        trim: null,
        transmission: 'CVT',
        fuelType: 'GASOLINE',
        drive: 'FWD',
        seats: 5,
        modelMatch: false,
      },
    ],
  },
};

const STATES: readonly OpsState[] = [
  {},
  FULL,
  IN_REVIEW,
  DECIDED,
  { queues: { summary: [], selected: null, items: [], error: true } },
  {
    queues: {
      summary: [{ queue: 'RISK_BOOKING', open: 0, overdue: 0 }],
      selected: 'RISK_BOOKING',
      items: [],
    },
  },
  { notice: { tone: 'warning', key: 'common.ops.caseRequired' } },
  CATALOG,
];

const translatorOf = (tag: string) => {
  const profile = LOCALE_CONFIG.locales.find((p) => p.tag === tag);
  if (profile === undefined) throw new Error(tag);
  return createTranslator(profile);
};

const html = (state: OpsState, tag: string, showProfile = true): string =>
  renderToStaticMarkup(
    <OpsPanels i18n={translatorOf(tag)} state={state} handlers={noop} showProfile={showProfile} />,
  );

describe('O01 : une vue = une langue, dans chaque locale', () => {
  it.each(LOCALE_CONFIG.locales.map((p) => [p.tag, p] as const))('%s', (tag, profile) => {
    for (const state of STATES) {
      const out = html(state, tag).replace(/<[^>]+>/g, ' ');
      expect(findForeignStrings(out, profile.language)).toEqual([]);
    }
  });
});

describe('O01 : ce que chaque état montre', () => {
  const es = CATALOGS.es.messages;
  const tag = LOCALE_CONFIG.locales.find((p) => p.language === 'es')?.tag ?? '';

  it('file : élément en retard signalé, élément à temps distingué, prise en charge et dossier KYC de l’élément pris', () => {
    const out = html(FULL, tag);
    expect(out).toContain(es['backoffice.queues.heading']);
    expect(out).toContain(es['backoffice.queues.overdue']);
    expect(out).toContain(es['backoffice.queues.onTime']);
    expect(out).toContain(`value="claim:${B}"`);
    expect(out).toContain(`value="kyc:${A}"`);
    // l'élément non pris n'ouvre aucun dossier KYC (hors file : L1-PM-08)
    expect(out).not.toContain(`value="kyc:${B}"`);
    // le motif de consultation est exigé et borné
    expect(out).toMatch(/name="purpose"[^>]*minLength="10"|minLength="10"[^>]*name="purpose"/i);
  });

  it.each(LOCALE_CONFIG.locales.map((p) => [p.tag] as const))(
    '%s : la file affichée est annoncée (aria-current) et signalée par un texte, pas seulement une couleur',
    (locale) => {
      const out = html(FULL, locale);
      const t = translatorOf(locale);
      expect(out).toMatch(
        /aria-current="true"[^>]*value="show:KYC"|value="show:KYC"[^>]*aria-current="true"/,
      );
      expect(out).not.toMatch(
        /value="show:LISTING"[^>]*aria-current|aria-current[^>]*value="show:LISTING"/,
      );
      expect(out).toContain(t.t('backoffice.queues.current'));
    },
  );

  it('pièce : refus avant l’envoi au-delà de 64 Kio ou hors des types admis ; cause du refus de l’API traduite', () => {
    expect(evidenceRefusal({ size: 64 * 1024, type: 'application/pdf' })).toBeNull();
    expect(evidenceRefusal({ size: 64 * 1024 + 1, type: 'application/pdf' })).toBe(
      'common.evidence.tooLarge',
    );
    expect(evidenceRefusal({ size: 0, type: 'image/png' })).toBe('common.evidence.tooLarge');
    expect(evidenceRefusal({ size: 10, type: 'image/svg+xml' })).toBe('common.evidence.badType');
    // HEIC sans type donné par le navigateur : l'API lit le type réel
    expect(evidenceRefusal({ size: 10, type: '' })).toBeNull();
    expect(evidenceReasonKey('SIZE')).toBe('common.evidence.tooLarge');
    expect(evidenceReasonKey('TYPE')).toBe('common.evidence.badType');
    expect(evidenceReasonKey('SCAN')).toBe('common.evidence.scanRefused');
    expect(evidenceReasonKey(undefined)).toBe('common.evidence.rejected');
    for (const p of LOCALE_CONFIG.locales) {
      const t = translatorOf(p.tag);
      expect(t.t('common.evidence.tooLarge', { max: '64' })).toContain('64');
    }
  });

  it('dossier KYC : consultation annoncée comme journalisée, aucune image', () => {
    const out = html(FULL, tag);
    expect(out).toContain(es['backoffice.kyc.heading']);
    expect(out).toContain(es['backoffice.kyc.logged']);
    expect(out).not.toContain('<img');
  });

  it('fiche 360° : statut KYC sans pièce, restriction active annoncée, compte d’hôte fermé à la réservation, notes, dossiers, restriction et levée motivées, aucun montant', () => {
    const out = html(FULL, tag);
    for (const key of [
      'backoffice.profile.heading',
      'backoffice.kyc.NOT_STARTED',
      'backoffice.profile.restricted',
      'backoffice.restriction.TS_HOLD',
      'backoffice.profile.closed',
      'backoffice.profile.notes',
      'backoffice.case.resolve',
      'backoffice.action.RESTRICT_ACCOUNT',
      'backoffice.action.LIFT_RESTRICTION',
      'backoffice.evidence.heading',
    ] as const) {
      expect(out, key).toContain(es[key]);
    }
    expect(out).toContain('Ref 77 zz');
    expect(out).toContain('value="RESTRICT_ACCOUNT:TS_HOLD"');
    expect(out).toContain('value="LIFT_RESTRICTION:POLICY_VIOLATION"');
    expect(out).toMatch(/name="reason"[^>]*minLength="10"|minLength="10"[^>]*name="reason"/i);
    expect(out).not.toMatch(/name="(amount|amountMinor|montant)"/i);
    expect(out).not.toContain('<img');
  });

  it('lecture des files en échec : message d’erreur, jamais « aucun élément » ; file vide : état vide', () => {
    const failed = html(STATES[4] as OpsState, tag);
    expect(failed).toContain(es['backoffice.queues.error']);
    expect(failed).not.toContain(es['backoffice.queues.empty']);
    expect(html(STATES[5] as OpsState, tag)).toContain(es['backoffice.queues.empty']);
  });

  it('dossier KYC en revue (US-106) : état, motif, permis, scores et consentement ; quatre contrôles jamais pré-cochés, motif borné, trois décisions ; aucune image ni montant', () => {
    const out = html(IN_REVIEW, tag);
    for (const key of [
      'backoffice.kyc.MANUAL_REVIEW',
      'backoffice.kyc.reason.LICENSE_PROVISIONAL',
      'backoffice.kyc.doc.IDP',
      'backoffice.kyc.consentMissing',
      'backoffice.kyc.decisionHeading',
      'backoffice.kyc.check.livenessCheck',
      'backoffice.kyc.check.idDocumentCheck',
      'backoffice.kyc.check.licenseListCheck',
      'backoffice.kyc.check.duplicateCheck',
      'backoffice.kyc.decide.APPROVED',
      'backoffice.kyc.decide.REJECTED',
      'backoffice.kyc.decide.MORE_INFO_REQUIRED',
    ] as const) {
      expect(out, key).toContain(es[key]);
    }
    // scores en pourcentage entier
    expect(out).toContain('42');
    expect(out).toContain('89');
    for (const check of [
      'livenessCheck',
      'idDocumentCheck',
      'licenseListCheck',
      'duplicateCheck',
    ]) {
      expect(out).toContain(`name="${check}" value="PASSED"`);
      expect(out).toContain(`name="${check}" value="FAILED"`);
    }
    expect(out).not.toMatch(/checked/);
    for (const d of ['APPROVED', 'REJECTED', 'MORE_INFO_REQUIRED']) {
      expect(out).toContain(`value="${d}"`);
    }
    expect(out).toMatch(/name="reason"[^>]*minLength="10"|minLength="10"[^>]*name="reason"/i);
    expect(out).not.toMatch(/name="(amount|amountMinor|montant)"/i);
    expect(out).not.toContain('<img');
  });

  it('dossier décidé ou scores effacés (US-106) : aucun formulaire de décision, scores annoncés absents', () => {
    const out = html(DECIDED, tag);
    expect(out).toContain(es['backoffice.kyc.REJECTED']);
    expect(out).toContain(es['backoffice.kyc.reason.LIVENESS_FAILED']);
    expect(out).toContain(es['backoffice.kyc.noScores']);
    expect(out).toContain(es['backoffice.kyc.noDocument']);
    expect(out).not.toContain(es['backoffice.kyc.decisionHeading']);
    expect(out).not.toContain('name="livenessCheck"');
  });

  it('états SM-3, motifs et refus de la décision : un libellé dans chaque langue (US-106)', () => {
    for (const p of LOCALE_CONFIG.locales) {
      const t = translatorOf(p.tag);
      for (const status of KYC_STATUSES) expect(kycStatusLabel(t, status)).not.toBe(status);
      expect(kycStatusLabel(t, 'UNKNOWN_STATE')).toBe('UNKNOWN_STATE');
    }
    // motifs de 0072 (fournisseur, permis) et de 0076 (décision de l'ops), refus de 0076
    expect(Object.keys(KYC_REASON_KEYS).sort()).toEqual(
      [
        'PROVIDER_REVIEW',
        'PROVIDER_DECLINED',
        'DOCUMENT_MISSING',
        'DOCUMENT_NOT_LICENSE',
        'LICENSE_PROVISIONAL',
        'LICENSE_EXPIRED',
        'CONSENT_WITHDRAWN',
        'LIVENESS_FAILED',
        'ID_DOCUMENT_REFUSED',
        'LICENSE_NOT_ACCEPTED',
        'DUPLICATE_ACCOUNT',
        'MORE_INFO_REQUESTED',
      ].sort(),
    );
    expect(Object.keys(KYC_REFUSAL_KEYS).sort()).toEqual(
      [
        'CHECKS_REQUIRED',
        'CHECKS_INCONSISTENT',
        'ITEM_NOT_CLAIMED',
        'NOT_IN_REVIEW',
        'NOT_FOUND',
        'SELF_FORBIDDEN',
        'CONSENT_WITHDRAWN',
        'LICENSE_NOT_ACCEPTED',
        'PRODUCTION_BLOCKED',
      ].sort(),
    );
  });

  it('file d’ajout au catalogue : demande ouverte de l’élément pris, variante candidate à rattacher, création sous licence, refus par motif ; aucune plaque, VIN sans numéro de série', () => {
    const out = html(CATALOG, tag);
    expect(out).toContain(`value="catalog:${A}"`);
    for (const key of [
      'backoffice.catalog.heading',
      'backoffice.catalog.requested',
      'backoffice.catalog.candidates',
      'backoffice.catalog.merge',
      'backoffice.catalog.approveHeading',
      'backoffice.catalog.licenseNote',
      'backoffice.catalog.approve',
      'backoffice.catalog.rejectHeading',
      'backoffice.catalog.reject.UNKNOWN_MODEL',
      'common.vehicle.gearbox.cvt',
    ] as const) {
      expect(out, key).toContain(es[key]);
    }
    expect(out).toContain(`value="${B}"`);
    for (const reason of ['INSUFFICIENT_DETAILS', 'UNKNOWN_MODEL', 'NOT_ELIGIBLE']) {
      expect(out).toContain(`value="${reason}"`);
    }
    expect(out).toMatch(
      /name="licenseNote"[^>]*minLength="10"|minLength="10"[^>]*name="licenseNote"/i,
    );
    expect(out).toContain('ABCDEFGHJKL******');
    // aucune présélection de la carrosserie ni de la traction ; refus confirmé
    expect(out).toMatch(
      /<select[^>]*name="bodyType"[^>]*>\s*<option value="" disabled="" selected="">/,
    );
    expect(out).toMatch(
      /<select[^>]*name="drive"[^>]*>\s*<option value="" disabled="" selected="">/,
    );
    expect(out).toMatch(/<input[^>]*required=""[^>]*name="confirmReject"/);
    expect(out).toContain(es['backoffice.catalog.rejectConfirm']);
    expect(out).toContain(es['backoffice.catalog.ongoing']);
    expect(out).not.toMatch(/name="(amount|amountMinor|plate)"/i);
    // un élément pris d'une autre file n'ouvre pas de demande d'ajout
    expect(html(FULL, tag)).not.toContain('value="catalog:');
  });

  it('rôle sans lecture de fiche (FINANCE) : aucun panneau de fiche 360°', () => {
    expect(html({}, tag, false)).not.toContain(es['backoffice.profile.heading']);
  });

  it('console élevée : panneaux O01 rendus dans la console pour un OPS, pas pour un FINANCE', () => {
    const consoleNoop = {
      onLogin: () => undefined,
      onReveal: () => undefined,
      onVerify: () => undefined,
      onAction: () => undefined,
      onApprove: () => undefined,
      onSignOut: () => undefined,
    } satisfies ConsoleHandlers;
    const render = (role: string) =>
      renderToStaticMarkup(
        <ConsoleView
          i18n={translatorOf(tag)}
          state={{ kind: 'console', roles: [{ role, countries: ['AA'] }], entries: [] }}
          handlers={consoleNoop}
          ops={{ state: {}, handlers: noop }}
        />,
      );
    expect(render('OPS_AGENT')).toContain(es['backoffice.profile.heading']);
    expect(render('FINANCE')).not.toContain(es['backoffice.profile.heading']);
  });
});
