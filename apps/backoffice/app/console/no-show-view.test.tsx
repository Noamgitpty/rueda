/**
 * US-307 — console : no-show et refus du véhicule (`DECLARE_NO_SHOW`, `REFUSE_AT_PICKUP`) à saisie
 * fermée (catalogue de 0171) ; quatre langues ; rôles OPS_AGENT et ADMIN seulement ; jamais un
 * montant. Attendus tirés de 19 US-307 et de 16 TRP-015 / TRP-007, jamais du code testé.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, createTranslator } from '@rueda/i18n';
import { findForeignStrings } from '@rueda/i18n/testing';
import { describe, expect, it } from 'vitest';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import {
  NoShowConfirm,
  NO_SHOW_CHOICE_LIST,
  NO_SHOW_CHOICES,
  NO_SHOW_REFUSAL_KEYS,
  NoShowPanel,
} from './no-show-view.tsx';
import { ConsoleView } from './view.tsx';
import type { ConsoleHandlers } from './view.tsx';

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

describe('US-307 — panneau no-show et refus du véhicule', () => {
  it.each(LOCALE_CONFIG.locales.map((p) => [p.tag, p] as const))(
    '%s : titre, sept choix fermés, trip, motif et pièces ; une seule langue',
    (_tag, profile) => {
      const messages = CATALOGS[profile.language].messages;
      const out = renderToStaticMarkup(
        <NoShowPanel i18n={createTranslator(profile)} busy={false} onSubmit={() => undefined} />,
      );
      expect(findForeignStrings(out.replace(/<[^>]+>/g, ' '), profile.language)).toEqual([]);
      for (const key of [
        'backoffice.noShow.heading',
        'backoffice.noShow.hint',
        'backoffice.noShow.subject',
        'backoffice.action.DECLARE_NO_SHOW',
        'backoffice.action.REFUSE_AT_PICKUP',
        'backoffice.noShow.evidenceHint',
        'backoffice.noShow.settleNote',
        'backoffice.noShow.next',
      ] as const) {
        expect(out, key).toContain(escape(messages[key] as string));
      }
      for (const c of NO_SHOW_CHOICE_LIST) {
        expect(out, c).toContain(`name="noShowChoice" value="${c}"`);
        expect(out, c).toContain(escape(messages[`backoffice.noShow.choice.${c}`] as string));
      }
      // aucune saisie de montant
      expect(out).not.toMatch(/inputMode="(numeric|decimal)"/);
      expect(out).toContain('name="tripId"');
    },
  );

  it.each(LOCALE_CONFIG.locales.map((p) => [p.tag, p] as const))(
    '%s : confirmation explicite avant l’envoi (trip, choix, conséquence irréversible, corriger)',
    (_tag, profile) => {
      const messages = CATALOGS[profile.language].messages;
      const trip = '7c0f3a52-3f1e-4c1c-9a59-2f5f0f2c6b11';
      const out = renderToStaticMarkup(
        <NoShowConfirm
          i18n={createTranslator(profile)}
          busy={false}
          draft={{
            tripId: trip,
            choice: 'NO_SHOW_HOST',
            reason: 'Motivo suficiente',
            evidence: [],
          }}
          onSend={() => undefined}
          onBack={() => undefined}
        />,
      );
      expect(findForeignStrings(out.replace(/<[^>]+>/g, ' '), profile.language)).toEqual([]);
      for (const key of [
        'backoffice.noShow.confirm.title',
        'backoffice.noShow.confirm.irreversible',
        'backoffice.noShow.confirm.send',
        'backoffice.noShow.confirm.back',
        'backoffice.noShow.choice.NO_SHOW_HOST',
      ] as const) {
        expect(out, key).toContain(escape(messages[key] as string));
      }
      expect(out).toContain(trip);
      // le formulaire initial ne fait que relire : aucun envoi sans confirmation
      const form = renderToStaticMarkup(
        <NoShowPanel i18n={createTranslator(profile)} busy={false} onSubmit={() => undefined} />,
      );
      expect(form).toContain(escape(messages['backoffice.noShow.next'] as string));
      expect(form).not.toContain(escape(messages['backoffice.noShow.confirm.send'] as string));
    },
  );

  it('choix → action et saisie du catalogue de 0171 (jamais un nombre)', () => {
    const inputs = NO_SHOW_CHOICE_LIST.map((c) => NO_SHOW_CHOICES[c]);
    expect(inputs.filter((x) => x.action === 'DECLARE_NO_SHOW').map((x) => x.input)).toEqual([
      { absentParty: 'GUEST' },
      { absentParty: 'HOST' },
      { absentParty: 'NONE' },
    ]);
    expect(
      inputs
        .filter((x) => x.action === 'REFUSE_AT_PICKUP')
        .map((x) => Object.values(x.input)[0])
        .sort(),
    ).toEqual(
      [
        'CLEANLINESS',
        'SAFETY',
        'INVALID_LICENSE',
        'IDENTITY_NOT_VERIFIED',
        'OTHER_DRIVER_SENT',
      ].sort(),
    );
    for (const x of inputs) {
      for (const v of Object.values(x.input)) expect(v).toMatch(/^[A-Za-z][A-Za-z_]{0,31}$/);
    }
  });

  it('« Corriger » garde le brouillon : trip, choix, motif et pièces préremplis', () => {
    const profile = LOCALE_CONFIG.locales[0];
    if (profile === undefined) throw new Error('locale');
    const trip = '7c0f3a52-3f1e-4c1c-9a59-2f5f0f2c6b11';
    const out = renderToStaticMarkup(
      <NoShowPanel
        i18n={createTranslator(profile)}
        busy={false}
        onSubmit={() => undefined}
        kept={{
          tripId: trip,
          choice: 'NO_SHOW_REJECT_REPORT',
          reason: 'el anfitrion estaba en el punto',
          evidence: ['f1', 'f2'],
        }}
      />,
    );
    expect(out).toContain(`name="tripId" value="${trip}"`);
    expect(out).toMatch(/name="noShowChoice" checked="" value="NO_SHOW_REJECT_REPORT"/);
    expect(out.match(/checked=""/g)).toHaveLength(1);
    expect(out).toContain('value="el anfitrion estaba en el punto"');
    expect(out).toContain('value="f1, f2"');
  });

  it('chaque refus des commandes liées a son texte', () => {
    expect(Object.keys(NO_SHOW_REFUSAL_KEYS).sort()).toEqual(
      [
        'CANCELLATION_PENDING',
        'CHECKIN_NOT_OPEN',
        'NOT_FOUND',
        'NO_REPORT_PENDING',
        'NO_SHOW_PARTY_PRESENT',
        'NO_SHOW_REPORT_INVALIDATED',
        'NO_SHOW_PARTY_REQUIRED',
        'NO_SHOW_TOO_EARLY',
        'NO_SHOW_WINDOW_CLOSED',
        'REFUSAL_AFTER_CHECKIN',
        'REFUSAL_REASON_REQUIRED',
        'SELF_FORBIDDEN',
        'TRIP_TRANSITION_FORBIDDEN',
      ].sort(),
    );
    for (const k of Object.values(NO_SHOW_REFUSAL_KEYS)) {
      expect(Object.hasOwn(CATALOGS.es.messages, k), k).toBe(true);
    }
  });

  it('rôles : OPS_AGENT et ADMIN voient le panneau ; SUPPORT et FINANCE non', () => {
    const profile = LOCALE_CONFIG.locales[0];
    if (profile === undefined) throw new Error('locale');
    const handlers = {
      onLogin: () => undefined,
      onReveal: () => undefined,
      onVerify: () => undefined,
      onAction: () => undefined,
      onNoShow: () => undefined,
      onApprove: () => undefined,
      onSignOut: () => undefined,
    } satisfies ConsoleHandlers;
    const render = (role: string) =>
      renderToStaticMarkup(
        <ConsoleView
          i18n={createTranslator(profile)}
          state={{ kind: 'console', roles: [{ role, countries: ['AA'] }], entries: [] }}
          handlers={handlers}
        />,
      );
    for (const role of ['OPS_AGENT', 'ADMIN']) {
      expect(render(role), role).toContain('name="noShowChoice"');
    }
    for (const role of ['SUPPORT_AGENT', 'FINANCE']) {
      expect(render(role), role).not.toContain('name="noShowChoice"');
    }
  });
});
