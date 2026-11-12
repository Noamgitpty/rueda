'use client';
/**
 * Console interne, côté navigateur (US-012) : enchaîne connexion → (enrôlement | code TOTP) →
 * console. L'API reste seule juge (session, MFA, rôles, portée pays, journal) ; ce composant ne
 * fait que choisir l'écran d'après ses réponses. Les textes viennent du catalogue de la locale de
 * la requête (une vue = une langue).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import type { MessageKey } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import { gapsOf, intentFor, messageKeyOf, readsApprovals, request, screenFor } from './api.ts';
import type {
  ActionIntent,
  ApiResult,
  ApprovalsBody,
  AuditBody,
  ContentGapsBody,
  MeBody,
} from './api.ts';
import { ConsoleView, SCREEN_HEADINGS } from './view.tsx';
import type { ConsoleAction, ConsoleState } from './view.tsx';
import {
  EVIDENCE_MAX_BYTES,
  evidenceReasonKey,
  evidenceRefusal,
  HOST_SCREENING_REFUSAL_KEYS,
  KYC_CHECKS,
  KYC_REFUSAL_KEYS,
  SANCTIONS_LISTS,
} from './ops-view.tsx';
import type {
  SanctionsList,
  SanctionsListResult,
  CatalogAdditionView,
  HostDossierView,
  KycDossierView,
  ManualRestriction,
  OpsHandlers,
  OpsState,
  ProfileView,
  Queue,
  QueueItemView,
  QueueSummaryView,
} from './ops-view.tsx';

/** Rôles qui travaillent les files de revue (permissions des files : kyc.decide, ops.review_listing_host). */
const QUEUE_ROLES = new Set(['OPS_AGENT', 'ADMIN']);

interface QueuesBody {
  readonly queues: readonly QueueSummaryView[];
  readonly items: readonly QueueItemView[];
}

/** Octets d'un fichier en base64 (pièce du staff, US-109). */
async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function ConsoleClient({ localeTag }: { readonly localeTag: string }) {
  const i18n = useMemo(() => createTranslator(getProfile(LOCALE_CONFIG, localeTag)), [localeTag]);
  const [state, setState] = useState<ConsoleState>({ kind: 'loading' });
  const [enrollmentCode, setEnrollmentCode] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // un requestId par intention d'action (double clic, reprise réseau : même identifiant)
  const intent = useRef<ActionIntent | null>(null);
  // files de revue et fiche 360° (US-109) ; le motif de la dernière fiche ouverte sert aux relectures
  const [ops, setOps] = useState<OpsState>({});
  const purposeRef = useRef<string>('');
  // échec réseau (API injoignable, hors ligne) : rendu comme une erreur lisible, jamais muet
  const call = useCallback(
    <T,>(method: 'GET' | 'POST', path: string, body?: unknown) =>
      request<T>((input, init) => fetch(input, init), method, path, body).catch(
        (): ApiResult<T> => ({
          ok: false,
          status: 0,
          code: 'NETWORK',
          messageKey: 'backoffice.error.network',
        }),
      ),
    [],
  );

  const refresh = useCallback(
    async (notice?: Extract<ConsoleState, { kind: 'console' }>['notice']) => {
      const me = await call<MeBody>('GET', '/staff/me');
      if (!me.ok) {
        setState({ kind: 'login', error: me.status === 0 ? me.messageKey : undefined });
        return;
      }
      const screen = screenFor(me.body.state);
      if (screen === 'console') {
        if (me.body.roles.some((r) => QUEUE_ROLES.has(r.role))) {
          const q = await call<QueuesBody>('GET', '/console/queues');
          setOps((prev) => ({
            ...prev,
            queues: q.ok
              ? { summary: q.body.queues, selected: null, items: [], error: false }
              : { summary: [], selected: null, items: [], error: true },
          }));
        }
        const audit = await call<AuditBody>('GET', '/staff/audit?limit=50');
        // blocs de contenu à revoir (US-121) : réservé à brand.edit ; un refus n'affiche rien
        const gaps = await call<ContentGapsBody>('GET', '/console/content/gaps');
        // demandes FINANCE à approuver (US-101) : FINANCE et ADMIN seulement
        const approvals = readsApprovals(me.body.roles)
          ? await call<ApprovalsBody>('GET', '/console/finance/approvals?limit=50')
          : null;
        setState({
          kind: 'console',
          roles: me.body.roles,
          entries: audit.ok ? audit.body.entries : [],
          journalError: !audit.ok,
          contentGaps: gapsOf(gaps),
          approvals: approvals?.ok === true ? approvals.body.approvals : [],
          approvalsError: approvals !== null && !approvals.ok,
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

  // focus sur le titre de chaque nouvel écran (clavier, lecteur d'écran : revue UX US-012)
  useEffect(() => {
    const id = SCREEN_HEADINGS[state.kind];
    if (id !== null) document.getElementById(id)?.focus();
  }, [state.kind]);

  /** Un seul envoi à la fois (un double clic compterait deux tentatives au verrou de 5). */
  const once = (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    void fn().finally(() => setBusy(false));
  };

  const handlers = {
    onLogin: (email: string, password: string) => {
      once(async () => {
        const r = await call('POST', '/auth/login', { email, password });
        if (r.ok) await refresh();
        else setState({ kind: 'login', error: r.messageKey });
      });
    },
    onReveal: (code: string) => {
      once(async () => {
        const r = await call<{ secret: string; otpauthUri: string }>('POST', '/staff/mfa/enroll', {
          enrollmentCode: code,
        });
        if (r.ok) {
          setEnrollmentCode(code);
          setState({ kind: 'enroll', secret: r.body });
        } else setState({ kind: 'enroll', error: r.messageKey });
      });
    },
    onVerify: (code: string) => {
      once(async () => {
        const r = await call('POST', '/staff/mfa/verify', { code, enrollmentCode });
        if (r.ok) {
          setEnrollmentCode(undefined);
          await refresh();
        } else if (state.kind === 'enroll') setState({ ...state, error: r.messageKey });
        else setState({ kind: 'totp', error: r.messageKey });
      });
    },
    onAction: (
      action: ConsoleAction,
      subjectId: string,
      reason: string,
      evidence: readonly string[],
    ) => {
      const subject = subjectId.trim().toLowerCase();
      intent.current = intentFor(intent.current, [action, subject, reason.trim(), evidence], () =>
        crypto.randomUUID(),
      );
      const { requestId } = intent.current;
      once(async () => {
        // jamais de montant : aucune saisie libre n'est envoyée (US-101, 17 §10 NN3)
        const r = await call<{ messageKey?: unknown }>('POST', '/console/actions', {
          requestId,
          action,
          subjectId: subject,
          reason,
          ...(evidence.length > 0 ? { evidence } : {}),
        });
        await refresh(
          r.ok
            ? { tone: 'success', key: messageKeyOf(r.body.messageKey) }
            : { tone: r.status === 409 ? 'warning' : 'danger', key: r.messageKey },
        );
      });
    },
    // US-108 : filtrage manuel des sanctions depuis le formulaire de la console (même action que le
    // dossier ouvert par la file) ; un requestId par intention
    onHostScreening: (
      orgId: string,
      results: Readonly<Record<SanctionsList, SanctionsListResult>>,
      reason: string,
      evidence: readonly string[],
    ) => {
      const subject = orgId.trim().toLowerCase();
      intent.current = intentFor(
        intent.current,
        [
          'HOST_SANCTIONS_SCREENING',
          subject,
          ...SANCTIONS_LISTS.map((l) => results[l]),
          reason.trim(),
          evidence,
        ],
        () => crypto.randomUUID(),
      );
      const { requestId } = intent.current;
      once(async () => {
        const r = await call<{ messageKey?: unknown }>('POST', '/console/actions', {
          requestId,
          action: 'HOST_SANCTIONS_SCREENING',
          subjectId: subject,
          reason,
          input: { ...results },
          ...(evidence.length > 0 ? { evidence } : {}),
        });
        const why = r.ok ? undefined : r.values?.['reason'];
        const refusal =
          !r.ok && r.code === 'STAFF_ACTION_REFUSED' && typeof why === 'string'
            ? HOST_SCREENING_REFUSAL_KEYS[why]
            : undefined;
        await refresh(
          r.ok
            ? { tone: 'success', key: 'backoffice.host.recorded' }
            : refusal !== undefined
              ? { tone: 'warning', key: refusal }
              : { tone: r.status === 409 ? 'warning' : 'danger', key: r.messageKey },
        );
      });
    },
    onApprove: (approvalId: string) => {
      once(async () => {
        const r = await call('POST', `/console/finance/approvals/${approvalId}/approve`, {});
        await refresh(
          r.ok
            ? { tone: 'success', key: 'common.auth.actionDone' }
            : { tone: r.status === 409 ? 'warning' : 'danger', key: r.messageKey },
        );
      });
    },
    onSignOut: () => {
      void (async () => {
        await call('POST', '/auth/logout');
        setState({ kind: 'login' });
      })();
    },
  };

  const notice = (
    r: { readonly status: number; readonly messageKey?: MessageKey },
    values?: Readonly<Record<string, string>>,
  ) =>
    setOps((prev) => ({
      ...prev,
      notice: {
        tone: r.status === 409 || r.status === 503 ? 'warning' : 'danger',
        key: r.messageKey ?? 'common.auth.requestInvalid',
        values,
      },
    }));
  /** Limite des pièces, en Kio, pour les messages de refus. */
  const maxKib = { max: String(EVIDENCE_MAX_BYTES / 1024) };

  const showQueue = async (queue: Queue) => {
    const r = await call<QueuesBody>('GET', `/console/queues?queue=${queue}&limit=100`);
    if (r.ok) {
      setOps((prev) => ({
        ...prev,
        queues: { summary: r.body.queues, selected: queue, items: r.body.items, error: false },
      }));
    } else notice(r);
  };

  const openProfile = async (userId: string, purpose: string) => {
    purposeRef.current = purpose;
    const r = await call<ProfileView>('POST', `/console/users/${userId}/profile`, {
      requestId: crypto.randomUUID(),
      purpose,
    });
    if (r.ok) setOps((prev) => ({ ...prev, profile: r.body }));
    else {
      setOps((prev) => ({ ...prev, profile: undefined }));
      notice(r);
    }
  };

  /** Après un geste sur la fiche : relecture (journalisée) de la fiche, puis bandeau. */
  const after = async (
    userId: string,
    r: ApiResult<unknown>,
    success: MessageKey,
    values?: Readonly<Record<string, string>>,
  ) => {
    if (r.ok) {
      await openProfile(userId, purposeRef.current);
      setOps((prev) => ({ ...prev, notice: { tone: 'success', key: success, values } }));
    } else notice(r);
  };

  const opsHandlers: OpsHandlers = {
    onShowQueue: (queue) => once(() => showQueue(queue)),
    onClaim: (itemId) =>
      once(async () => {
        const r = await call('POST', `/console/queues/items/${itemId}/claim`, {
          requestId: crypto.randomUUID(),
        });
        if (!r.ok) notice(r);
        const selected = ops.queues?.selected;
        if (selected !== undefined && selected !== null) await showQueue(selected);
      }),
    onOpenKyc: (itemId, purpose) =>
      once(async () => {
        const r = await call<KycDossierView>('POST', `/console/queues/items/${itemId}/kyc`, {
          requestId: crypto.randomUUID(),
          purpose,
        });
        if (r.ok) setOps((prev) => ({ ...prev, kyc: r.body, notice: undefined }));
        else {
          setOps((prev) => ({ ...prev, kyc: undefined }));
          notice(r);
        }
      }),
    // décision KYC (US-106) : action de console KYC_DECISION, un requestId par intention ; la base
    // juge (élément pris en charge, contrôles cohérents, consentement, permis) ; un refus motivé
    // est expliqué dans la langue de la vue
    onKycDecision: (verificationId, decision, checks, reason) => {
      intent.current = intentFor(
        intent.current,
        [
          'KYC_DECISION',
          verificationId,
          decision,
          ...KYC_CHECKS.map((c) => checks[c]),
          reason.trim(),
        ],
        () => crypto.randomUUID(),
      );
      const { requestId } = intent.current;
      once(async () => {
        const r = await call<{ messageKey?: unknown }>('POST', '/console/actions', {
          requestId,
          action: 'KYC_DECISION',
          subjectId: verificationId,
          reason,
          input: { decision, ...checks },
        });
        if (r.ok) {
          setOps((prev) => ({
            ...prev,
            kyc: undefined,
            notice: { tone: 'success', key: 'backoffice.kyc.decided' },
          }));
          const selected = ops.queues?.selected;
          if (selected !== undefined && selected !== null) await showQueue(selected);
          return;
        }
        const why = r.values?.['reason'];
        const key =
          r.code === 'STAFF_ACTION_REFUSED' && typeof why === 'string'
            ? KYC_REFUSAL_KEYS[why]
            : undefined;
        notice(key !== undefined ? { status: r.status, messageKey: key } : r);
      });
    },
    // dossier de l'hôte signalé (US-108) : lecture journalisée par la base avant la réponse
    onOpenHost: (itemId, purpose) =>
      once(async () => {
        const r = await call<HostDossierView>(
          'POST',
          `/console/queues/items/${itemId}/host-verification`,
          { requestId: crypto.randomUUID(), purpose },
        );
        if (r.ok) setOps((prev) => ({ ...prev, host: r.body, notice: undefined }));
        else {
          setOps((prev) => ({ ...prev, host: undefined }));
          notice(r);
        }
      }),
    // filtrage manuel des sanctions (US-108) : action HOST_SANCTIONS_SCREENING, un requestId par
    // intention ; la base juge (dossier soumis, non filtré, auteur distinct du titulaire)
    onHostScreening: (orgId, results, reason) => {
      intent.current = intentFor(
        intent.current,
        [
          'HOST_SANCTIONS_SCREENING',
          orgId,
          ...SANCTIONS_LISTS.map((l) => results[l]),
          reason.trim(),
        ],
        () => crypto.randomUUID(),
      );
      const { requestId } = intent.current;
      once(async () => {
        const r = await call<{ messageKey?: unknown }>('POST', '/console/actions', {
          requestId,
          action: 'HOST_SANCTIONS_SCREENING',
          subjectId: orgId,
          reason,
          input: { ...results },
        });
        if (r.ok) {
          setOps((prev) => ({
            ...prev,
            host: undefined,
            notice: { tone: 'success', key: 'backoffice.host.recorded' },
          }));
          const selected = ops.queues?.selected;
          if (selected !== undefined && selected !== null) await showQueue(selected);
          return;
        }
        const why = r.values?.['reason'];
        const key =
          r.code === 'STAFF_ACTION_REFUSED' && typeof why === 'string'
            ? HOST_SCREENING_REFUSAL_KEYS[why]
            : undefined;
        notice(key !== undefined ? { status: r.status, messageKey: key } : r);
      });
    },
    onOpenCatalog: (itemId) =>
      once(async () => {
        const r = await call<CatalogAdditionView>(
          'POST',
          `/console/queues/items/${itemId}/catalog-addition`,
          { requestId: crypto.randomUUID() },
        );
        if (r.ok) setOps((prev) => ({ ...prev, catalog: r.body, notice: undefined }));
        else {
          setOps((prev) => ({ ...prev, catalog: undefined }));
          notice(r);
        }
      }),
    onResolveCatalog: (itemId, resolution) =>
      once(async () => {
        const r = await call<{ status: 'APPROVED' | 'MERGED' | 'REJECTED' }>(
          'POST',
          `/console/queues/items/${itemId}/catalog-addition/resolve`,
          { requestId: crypto.randomUUID(), ...resolution },
        );
        if (r.ok) {
          setOps((prev) => ({
            ...prev,
            catalog: undefined,
            notice: { tone: 'success', key: `backoffice.catalog.done.${r.body.status}` },
          }));
          const selected = ops.queues?.selected;
          if (selected !== undefined && selected !== null) await showQueue(selected);
        } else notice(r);
      }),
    onSearch: (email, purpose) =>
      once(async () => {
        const r = await call<{ userId: string }>('POST', '/console/users/search', {
          requestId: crypto.randomUUID(),
          email,
          purpose,
        });
        if (r.ok) await openProfile(r.body.userId, purpose);
        else notice(r);
      }),
    onOpenProfile: (userId, purpose) => once(() => openProfile(userId, purpose)),
    onAddNote: (userId, body) =>
      once(async () => {
        const r = await call('POST', `/console/users/${userId}/notes`, {
          requestId: crypto.randomUUID(),
          body,
        });
        await after(userId, r, 'backoffice.profile.noteAdded');
      }),
    onRestriction: (action, userId, kind: ManualRestriction, reason) => {
      intent.current = intentFor(intent.current, [action, userId, kind, reason.trim()], () =>
        crypto.randomUUID(),
      );
      const { requestId } = intent.current;
      once(async () => {
        const r = await call<{ messageKey?: unknown }>('POST', '/console/actions', {
          requestId,
          action,
          subjectId: userId,
          reason,
          input: { kind },
        });
        await after(userId, r, r.ok ? messageKeyOf(r.body.messageKey) : 'common.auth.actionDone');
      });
    },
    onOpenCase: (userId, category, channel) =>
      once(async () => {
        const r = await call('POST', '/console/cases', {
          requestId: crypto.randomUUID(),
          requesterUserId: userId,
          category,
          channel,
        });
        await after(userId, r, 'backoffice.case.opened');
      }),
    onResolveCase: (caseId) =>
      once(async () => {
        const r = await call('POST', `/console/cases/${caseId}/status`, {
          requestId: crypto.randomUUID(),
          status: 'RESOLVED',
        });
        const userId = ops.profile?.profile.id;
        if (userId !== undefined) await after(userId, r, 'common.auth.actionDone');
        else if (!r.ok) notice(r);
      }),
    onUpload: (userId, file) =>
      once(async () => {
        if (file === null) {
          notice({ status: 400, messageKey: 'common.evidence.badType' });
          return;
        }
        // contrôle avant l'envoi : rien n'est lu ni envoyé au-delà de la limite (revue UX US-109)
        const refusal = evidenceRefusal(file);
        if (refusal !== null) {
          notice({ status: 422, messageKey: refusal }, maxKib);
          return;
        }
        const r = await call<{ fileId: string }>('POST', '/console/evidence', {
          requestId: crypto.randomUUID(),
          subjectUserId: userId,
          mime: file.type,
          contentBase64: await base64Of(file),
        });
        if (r.ok) {
          setOps((prev) => ({
            ...prev,
            notice: {
              tone: 'success',
              key: 'backoffice.evidence.received',
              values: { id: r.body.fileId },
            },
          }));
        } else if (r.code === 'EVIDENCE_REJECTED') {
          notice({ status: 422, messageKey: evidenceReasonKey(r.values?.['reason']) }, maxKib);
        } else notice(r);
      }),
  };

  return (
    <ConsoleView
      i18n={i18n}
      state={state}
      handlers={handlers}
      busy={busy}
      ops={{ state: ops, handlers: opsHandlers }}
    />
  );
}
