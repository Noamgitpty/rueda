'use client';
/**
 * Console interne, côté navigateur (US-012) : enchaîne connexion → (enrôlement | code TOTP) →
 * console. L'API reste seule juge (session, MFA, rôles, portée pays, journal) ; ce composant ne
 * fait que choisir l'écran d'après ses réponses. Les textes viennent du catalogue de la locale de
 * la requête (une vue = une langue).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import { request, screenFor } from './api.ts';
import type { AuditBody, MeBody } from './api.ts';
import { ConsoleView } from './view.tsx';
import type { ConsoleAction, ConsoleState } from './view.tsx';

export function ConsoleClient({ localeTag }: { readonly localeTag: string }) {
  const i18n = useMemo(() => createTranslator(getProfile(LOCALE_CONFIG, localeTag)), [localeTag]);
  const [state, setState] = useState<ConsoleState>({ kind: 'loading' });
  const [enrollmentCode, setEnrollmentCode] = useState<string | undefined>(undefined);
  const call = useCallback(
    <T,>(method: 'GET' | 'POST', path: string, body?: unknown) =>
      request<T>((input, init) => fetch(input, init), method, path, body),
    [],
  );

  const refresh = useCallback(
    async (notice?: Extract<ConsoleState, { kind: 'console' }>['notice']) => {
      const me = await call<MeBody>('GET', '/staff/me');
      if (!me.ok) {
        setState({ kind: 'login' });
        return;
      }
      const screen = screenFor(me.body.state);
      if (screen === 'console') {
        const audit = await call<AuditBody>('GET', '/staff/audit?limit=50');
        setState({
          kind: 'console',
          roles: me.body.roles,
          entries: audit.ok ? audit.body.entries : [],
          notice,
        });
      } else if (screen === 'totp' || screen === 'enroll') {
        setState({ kind: screen });
      } else if (screen.startsWith('denied:')) {
        setState({
          kind: 'denied',
          reason: screen.slice('denied:'.length) as 'NOT_STAFF' | 'TOTP_NOT_ENROLLED' | 'LOCKED',
        });
      }
    },
    [call],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handlers = {
    onLogin: (email: string, password: string) => {
      void (async () => {
        const r = await call('POST', '/auth/login', { email, password });
        if (r.ok) await refresh();
        else setState({ kind: 'login', error: r.messageKey });
      })();
    },
    onReveal: (code: string) => {
      void (async () => {
        const r = await call<{ secret: string; otpauthUri: string }>('POST', '/staff/mfa/enroll', {
          enrollmentCode: code,
        });
        if (r.ok) {
          setEnrollmentCode(code);
          setState({ kind: 'enroll', secret: r.body });
        } else setState({ kind: 'enroll', error: r.messageKey });
      })();
    },
    onVerify: (code: string) => {
      void (async () => {
        const r = await call('POST', '/staff/mfa/verify', { code, enrollmentCode });
        if (r.ok) {
          setEnrollmentCode(undefined);
          await refresh();
        } else if (state.kind === 'enroll') setState({ ...state, error: r.messageKey });
        else setState({ kind: 'totp', error: r.messageKey });
      })();
    },
    onAction: (action: ConsoleAction, subjectId: string, reason: string) => {
      void (async () => {
        const r = await call('POST', '/console/actions', {
          requestId: crypto.randomUUID(),
          action,
          subjectId: subjectId.trim().toLowerCase(),
          reason,
        });
        await refresh(
          r.ok
            ? { tone: 'success', key: 'common.auth.actionRecorded' }
            : { tone: r.status === 409 ? 'warning' : 'danger', key: r.messageKey },
        );
      })();
    },
    onSignOut: () => {
      void (async () => {
        await call('POST', '/auth/logout');
        setState({ kind: 'login' });
      })();
    },
  };

  return <ConsoleView i18n={i18n} state={state} handlers={handlers} />;
}
