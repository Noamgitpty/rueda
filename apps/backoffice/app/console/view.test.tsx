/**
 * Rendu des écrans de la console (US-012), dans chaque locale configurée (es-PA, es-PY, en, fr) :
 * - une vue = une langue (aucune chaîne d'une autre langue, critère US-014) ;
 * - un compte staff sans TOTP ne voit que le refus (aucun formulaire d'action, aucun journal) ;
 * - la console élevée montre les rôles traduits et leurs pays, l'action motivée et le journal ;
 * - l'état inconnu rendu par l'API est un refus (fail-closed).
 * Textes attendus : catalogue @rueda/i18n (es fait foi).
 */
import { CATALOGS, createTranslator } from '@rueda/i18n';
import { findForeignStrings } from '@rueda/i18n/testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import { messageKeyOf, screenFor } from './api.ts';
import { ConsoleView } from './view.tsx';
import type { ConsoleHandlers, ConsoleState } from './view.tsx';

const noop: ConsoleHandlers = {
  onLogin: () => undefined,
  onReveal: () => undefined,
  onVerify: () => undefined,
  onAction: () => undefined,
  onSignOut: () => undefined,
};

/** Clé d'exemple affichée (valeur de test, sans rapport avec un secret réel). */
const SAMPLE_KEY = 'AB'.repeat(16);

const STATES: readonly ConsoleState[] = [
  { kind: 'login' },
  { kind: 'login', error: 'common.auth.invalidCredentials' },
  { kind: 'totp', error: 'common.auth.totpInvalid' },
  { kind: 'enroll' },
  {
    kind: 'enroll',
    secret: { secret: SAMPLE_KEY, otpauthUri: 'otpauth://totp/x' },
  },
  { kind: 'denied', reason: 'TOTP_NOT_ENROLLED' },
  { kind: 'denied', reason: 'NOT_STAFF' },
  { kind: 'denied', reason: 'LOCKED' },
  {
    kind: 'console',
    roles: [
      { role: 'OPS_AGENT', countries: ['AA'] },
      { role: 'ADMIN', countries: ['AA', 'BB'] },
    ],
    entries: [
      {
        id: '42',
        at: '2026-11-03T14:05:00.000Z',
        actorRole: 'FINANCE',
        actionCode: 'STAFF_FORBIDDEN',
        subjectType: 'TRIP',
        subjectId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      },
    ],
    notice: { tone: 'danger', key: 'common.auth.forbidden' },
  },
  { kind: 'console', roles: [{ role: 'FINANCE', countries: ['AA'] }], entries: [] },
];

const html = (state: ConsoleState, tag: string): string => {
  const profile = LOCALE_CONFIG.locales.find((p) => p.tag === tag);
  if (profile === undefined) throw new Error(tag);
  return renderToStaticMarkup(
    <ConsoleView i18n={createTranslator(profile)} state={state} handlers={noop} />,
  );
};

describe('console : une vue = une langue, dans chaque locale', () => {
  it.each(LOCALE_CONFIG.locales.map((p) => [p.tag, p] as const))('%s', (tag, profile) => {
    for (const state of STATES) {
      // texte rendu seulement (les classes et identifiants ne sont pas du texte affiché)
      const out = html(state, tag).replace(/<[^>]+>/g, ' ');
      expect(findForeignStrings(out, profile.language), `${tag} ${state.kind}`).toEqual([]);
    }
  });
});

describe('console : ce que chaque état montre', () => {
  const es = CATALOGS.es.messages;
  const tag = LOCALE_CONFIG.locales.find((p) => p.language === 'es')?.tag ?? '';

  it('staff sans TOTP : refus seulement, ni formulaire d’action ni journal', () => {
    const out = html({ kind: 'denied', reason: 'TOTP_NOT_ENROLLED' }, tag);
    expect(out).toContain(es['backoffice.denied.noTotp']);
    expect(out).not.toContain(es['backoffice.action.heading']);
    expect(out).not.toContain(es['backoffice.journal.caption']);
    expect(out).not.toContain('<input');
  });

  it('console élevée : rôles traduits avec leurs pays, trois actions, motif exigé, journal', () => {
    const out = html(STATES[8] as ConsoleState, tag);
    expect(out).toContain(es['backoffice.role.OPS_AGENT']);
    expect(out).toContain(es['backoffice.role.ADMIN']);
    expect(out).toContain('AA, BB');
    for (const key of [
      'backoffice.action.RECORD_CLAIM',
      'backoffice.action.CANCEL_TRIP_PLATFORM',
      'backoffice.action.DECLARE_NO_SHOW',
    ] as const) {
      expect(out).toContain(es[key]);
    }
    expect(out).toMatch(/name="reason"[^>]*minLength="10"|minLength="10"[^>]*name="reason"/i);
    expect(out).toContain('STAFF_FORBIDDEN');
    expect(out).toContain(es['common.auth.forbidden']);
  });

  it('code TOTP : saisie numérique, remplissage automatique du code à usage unique', () => {
    const out = html({ kind: 'totp' }, tag).toLowerCase();
    expect(out).toContain('inputmode="numeric"');
    expect(out).toContain('autocomplete="one-time-code"');
  });

  it('journal vide : état vide explicite', () => {
    expect(html(STATES[9] as ConsoleState, tag)).toContain(es['backoffice.journal.empty']);
  });
});

describe('choix de l’écran d’après GET /staff/me', () => {
  it.each([
    ['ELEVATED', 'console'],
    ['MFA_REQUIRED', 'totp'],
    ['ENROLLMENT_REQUIRED', 'enroll'],
    ['LOCKED', 'denied:LOCKED'],
    ['NOT_STAFF', 'denied:NOT_STAFF'],
    ['TOTP_NOT_ENROLLED', 'denied:TOTP_NOT_ENROLLED'],
    ['INCONNU', 'denied:TOTP_NOT_ENROLLED'],
  ])('%s => %s', (state, screen) => {
    expect(screenFor(state)).toBe(screen);
  });

  it('clé de message de l’API : connue => elle-même ; inconnue => clé neutre', () => {
    expect(messageKeyOf('common.auth.forbidden')).toBe('common.auth.forbidden');
    expect(messageKeyOf('nimporte.quoi')).toBe('common.auth.requestInvalid');
    expect(messageKeyOf(42)).toBe('common.auth.requestInvalid');
  });
});
