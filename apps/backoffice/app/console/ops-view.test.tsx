/**
 * Écran O01 de 10b, files de travail (US-109) : rendu dans chaque locale configurée (es-PA, es-PY,
 * en, fr, pt-BR), une vue = une langue (aucune chaîne d'une autre langue) ; ce que chaque état
 * montre : retard signalé dans une file (16 ADM-029), dossier KYC ouvert par la file seulement et
 * consultation annoncée comme journalisée (ADM-032), fiche 360° avec statut KYC sans pièce,
 * restriction active annoncée et comptes d'hôte fermés à la réservation (ADM-005), restriction et
 * levée motivées, aucune saisie de montant. Textes attendus : catalogue @rueda/i18n (es fait foi).
 */
import { CATALOGS, createTranslator } from '@rueda/i18n';
import { findForeignStrings } from '@rueda/i18n/testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import { evidenceReasonKey, evidenceRefusal, OpsPanels } from './ops-view.tsx';
import type { OpsHandlers, OpsState } from './ops-view.tsx';
import { ConsoleView } from './view.tsx';
import type { ConsoleHandlers } from './view.tsx';

const noop: OpsHandlers = {
  onShowQueue: () => undefined,
  onClaim: () => undefined,
  onOpenKyc: () => undefined,
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

const STATES: readonly OpsState[] = [
  {},
  FULL,
  { queues: { summary: [], selected: null, items: [], error: true } },
  {
    queues: {
      summary: [{ queue: 'RISK_BOOKING', open: 0, overdue: 0 }],
      selected: 'RISK_BOOKING',
      items: [],
    },
  },
  { notice: { tone: 'warning', key: 'common.ops.caseRequired' } },
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
    const failed = html(STATES[2] as OpsState, tag);
    expect(failed).toContain(es['backoffice.queues.error']);
    expect(failed).not.toContain(es['backoffice.queues.empty']);
    expect(html(STATES[3] as OpsState, tag)).toContain(es['backoffice.queues.empty']);
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
