/**
 * Rendu des écrans de la console (US-012), dans chaque locale configurée (es-PA, es-PY, en, fr) :
 * - une vue = une langue (aucune chaîne d'une autre langue, critère US-014) ;
 * - un compte staff sans TOTP ne voit que le refus (aucun formulaire d'action, aucun journal) ;
 * - la console élevée montre les rôles traduits et leurs pays, l'action motivée et le journal ;
 * - l'état inconnu rendu par l'API est un refus (fail-closed).
 * US-101 : catalogue des actions groupé (état, enregistrement seul avec pièces, FINANCE à deux
 * personnes), champ des pièces, demandes FINANCE en attente (FINANCE et ADMIN seulement).
 * Textes attendus : catalogue @rueda/i18n (es fait foi).
 */
import { CATALOGS, createTranslator } from '@rueda/i18n';
import { findForeignStrings } from '@rueda/i18n/testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import { intentFor, messageKeyOf, screenFor } from './api.ts';
import {
  ACTION_GROUPS,
  ConsoleView,
  DSR_KINDS,
  DSR_REFUSAL_KEYS,
  DSR_STEPS,
  evidenceOf,
} from './view.tsx';
import type { ConsoleHandlers, ConsoleState } from './view.tsx';

const noop: ConsoleHandlers = {
  onLogin: () => undefined,
  onReveal: () => undefined,
  onVerify: () => undefined,
  onAction: () => undefined,
  onApprove: () => undefined,
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
  {
    kind: 'console',
    roles: [{ role: 'FINANCE', countries: ['AA'] }],
    entries: [],
    approvals: [
      {
        id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5e',
        action: 'DECIDE_ADVANCE',
        subjectId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5f',
        country: 'AA',
        reason: 'Ref 4242 zz',
        requestedAt: '2026-11-11T09:30:00.000Z',
      },
    ],
  },
  {
    kind: 'console',
    roles: [{ role: 'ADMIN', countries: ['AA'] }],
    entries: [],
    approvals: [],
    approvalsError: true,
  },
];

/** Texte tel que React l'échappe dans le balisage statique (apostrophes, guillemets, chevrons). */
const escape = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

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

describe('revue UX US-012 : annonces, focus, chargement, journal', () => {
  const es = CATALOGS.es.messages;
  const tag = LOCALE_CONFIG.locales.find((p) => p.language === 'es')?.tag ?? '';

  it.each([
    [{ kind: 'login', error: 'common.auth.invalidCredentials' }, 'common.auth.invalidCredentials'],
    [{ kind: 'totp', error: 'common.auth.totpInvalid' }, 'common.auth.totpInvalid'],
    [{ kind: 'enroll', error: 'common.auth.totpLocked' }, 'common.auth.totpLocked'],
  ] as const)('erreur %j : bandeau role="alert" (live assertive)', (state, key) => {
    const out = html(state as ConsoleState, tag);
    expect(out).toMatch(new RegExp(`role="alert"[^]*${String(es[key]).slice(0, 12)}`));
  });

  it('code faux : le champ lui-même est marqué invalide', () => {
    const out = html({ kind: 'totp', error: 'common.auth.totpInvalid' }, tag);
    expect(out).toMatch(/aria-invalid="true"/);
  });

  it('titre de chaque écran focusable (tabIndex -1) pour recevoir le focus à l’arrivée', () => {
    for (const state of STATES) {
      if (state.kind === 'loading') continue;
      expect(html(state, tag), state.kind).toMatch(/<h2 id="[a-z]+-heading"[^>]*tabindex="-1"/i);
    }
  });

  it('envoi en cours : bouton en chargement (aria-busy), jamais désactivé', () => {
    const profile = LOCALE_CONFIG.locales.find((p) => p.tag === tag);
    if (profile === undefined) throw new Error(tag);
    const out = renderToStaticMarkup(
      <ConsoleView
        i18n={createTranslator(profile)}
        state={{ kind: 'login' }}
        handlers={noop}
        busy
      />,
    );
    expect(out).toMatch(/aria-busy="true"/);
    expect(out).not.toMatch(/<button[^>]*disabled/);
  });

  it('lecture du journal en échec : message d’erreur, jamais « aucune activité » ; portée annoncée', () => {
    const out = html(
      {
        kind: 'console',
        roles: [{ role: 'ADMIN', countries: ['AA'] }],
        entries: [],
        journalError: true,
      },
      tag,
    );
    expect(out).toContain(es['backoffice.journal.error']);
    expect(out).not.toContain(es['backoffice.journal.empty']);
    expect(out).toContain(es['backoffice.journal.scope']);
  });

  it('échec réseau : message clair', () => {
    expect(html({ kind: 'login', error: 'backoffice.error.network' }, tag)).toContain(
      es['backoffice.error.network'],
    );
  });
});

describe('US-101 : catalogue des actions, pièces, demandes FINANCE', () => {
  const es = CATALOGS.es.messages;
  const tag = LOCALE_CONFIG.locales.find((p) => p.language === 'es')?.tag ?? '';

  it('les trois groupes de 19 US-101, chaque action du catalogue, le champ des pièces et la note « aucun montant »', () => {
    const out = html(STATES[8] as ConsoleState, tag);
    for (const key of [
      'backoffice.action.groupState',
      'backoffice.action.groupRecord',
      'backoffice.action.groupFinance',
      'backoffice.action.evidence',
      'backoffice.action.amountNote',
    ] as const) {
      expect(out, key).toContain(es[key]);
    }
    for (const a of [...ACTION_GROUPS.state, ...ACTION_GROUPS.record, ...ACTION_GROUPS.finance]) {
      expect(out, a).toContain(`value="${a}"`);
    }
    // US-107 : création d'un compte d'hôte par l'ops, libellée dans la langue de la vue
    expect(out).toContain('value="CREATE_HOST_ACCOUNT"');
    expect(out).toContain(es['backoffice.action.CREATE_HOST_ACCOUNT']);
    expect(out).toContain('name="evidence"');
    // aucun champ de montant dans le formulaire d'action
    expect(out).not.toMatch(/name="(amount|amountMinor|montant)"/i);
  });

  it('FINANCE : demandes en attente avec un bouton « Aprobar » par demande', () => {
    const out = html(STATES[10] as ConsoleState, tag);
    expect(out).toContain(es['backoffice.approvals.caption']);
    expect(out).toContain(es['backoffice.action.DECIDE_ADVANCE']);
    expect(out).toContain('value="0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5e"');
    expect(out).toContain(es['backoffice.approvals.hint']);
  });

  it('OPS : aucun panneau de demandes FINANCE ; ADMIN en échec de lecture : message d’erreur', () => {
    const ops: ConsoleState = {
      kind: 'console',
      roles: [{ role: 'OPS_AGENT', countries: ['AA'] }],
      entries: [],
    };
    expect(html(ops, tag)).not.toContain(es['backoffice.approvals.caption']);
    const out = html(STATES[11] as ConsoleState, tag);
    expect(out).toContain(es['backoffice.approvals.error']);
    expect(out).not.toContain(es['backoffice.approvals.empty']);
  });

  it('pièces : virgules, espaces et retours à la ligne ; doublons retirés ; minuscules', () => {
    expect(evidenceOf(` A1, b2${'\n'}A1 ;c3  `)).toEqual(['a1', 'b2', 'c3']);
    expect(evidenceOf('')).toEqual([]);
  });
});

// US-111 (19 US-111 « demande saisie (HANDLE_DSR) : délai et traitement suivis ») : formulaire
// propre, saisie fermée (type, étape), réservé aux rôles qui ont data.export (17 §2.3)
describe('US-111 : demande de personne (HANDLE_DSR), dans chaque locale', () => {
  const withDsr: ConsoleHandlers = { ...noop, onDataRequest: () => undefined };
  const admin: ConsoleState = {
    kind: 'console',
    roles: [{ role: 'ADMIN', countries: ['AA'] }],
    entries: [],
  };
  const render = (state: ConsoleState, tag: string): string => {
    const profile = LOCALE_CONFIG.locales.find((p) => p.tag === tag);
    if (profile === undefined) throw new Error(tag);
    return renderToStaticMarkup(
      <ConsoleView i18n={createTranslator(profile)} state={state} handlers={withDsr} />,
    );
  };

  it.each(LOCALE_CONFIG.locales.map((p) => [p.tag, p] as const))(
    '%s : titre, cinq types, six étapes, dossier, motif et pièces ; une seule langue',
    (tag, profile) => {
      const messages = CATALOGS[profile.language].messages;
      const out = render(admin, tag);
      expect(findForeignStrings(out.replace(/<[^>]+>/g, ' '), profile.language)).toEqual([]);
      for (const key of [
        'backoffice.action.HANDLE_DSR',
        'backoffice.dsr.hint',
        'backoffice.dsr.subject',
        'backoffice.dsr.kind',
        'backoffice.dsr.step',
        'backoffice.dsr.record',
      ] as const) {
        expect(out, key).toContain(escape(messages[key] as string));
      }
      for (const k of DSR_KINDS) expect(out, k).toContain(`name="dsrKind" value="${k}"`);
      for (const st of DSR_STEPS) expect(out, st).toContain(`name="dsrStep" value="${st}"`);
      expect(out).toContain('name="caseId"');
      // HANDLE_DSR n'est plus une action sans saisie du formulaire générique
      expect(out).not.toContain('value="HANDLE_DSR"');
    },
  );

  it('sans data.export (OPS, SUPPORT, FINANCE) : aucun formulaire de demande', () => {
    const tag = LOCALE_CONFIG.locales[0]?.tag ?? '';
    for (const role of ['OPS_AGENT', 'SUPPORT_AGENT', 'FINANCE']) {
      const out = render(
        { kind: 'console', roles: [{ role, countries: ['AA'] }], entries: [] },
        tag,
      );
      expect(out, role).not.toContain('name="dsrKind"');
    }
  });

  it('chaque refus de la commande liée a son texte', () => {
    expect(Object.keys(DSR_REFUSAL_KEYS).sort()).toEqual(
      [
        'DSR_ALREADY_OPEN',
        'DSR_DELAY_UNKNOWN',
        'DSR_INPUT_REQUIRED',
        'DSR_KIND_MISMATCH',
        'DSR_NOT_OPEN',
        'DSR_TRANSITION_INVALID',
      ].sort(),
    );
  });
});

describe('US-101 (revue) : un requestId par intention, pas par clic', () => {
  it('même intention (double clic, reprise réseau) : même identifiant ; intention différente : identifiant neuf', () => {
    let n = 0;
    const id = () => `id-${(n += 1)}`;
    const first = intentFor(null, ['RECORD_CLAIM', 'a', 'motif', ['p']], id);
    expect(first.requestId).toBe('id-1');
    expect(intentFor(first, ['RECORD_CLAIM', 'a', 'motif', ['p']], id)).toBe(first);
    expect(intentFor(first, ['RECORD_CLAIM', 'b', 'motif', ['p']], id).requestId).toBe('id-2');
    expect(intentFor(first, ['RECORD_CLAIM', 'a', 'motif', []], id).requestId).toBe('id-3');
  });
});
