'use client';
/**
 * Écran « Apparence / Marque » côté navigateur (US-120) : lit la session (`GET /staff/me`),
 * l'historique des versions et les textes publiés, tient le brouillon en mémoire et appelle les
 * commandes de la console d'US-034 et d'US-121 par le mandataire de même origine `/api/*`.
 *
 * - Réservé au rôle `ADMIN` avec une session élevée par TOTP ; l'API et la base restent seules
 *   juges (droit `brand.edit` / `brand.publish`, portée de tous les pays) et journalisent chaque
 *   publication, retour arrière et refus. Aucun identifiant d'acteur n'est envoyé.
 * - Un `requestId` par intention (double clic, reprise réseau : même identifiant, la base
 *   reconnaît le rejeu).
 * - Aperçu : brouillon compilé ici, rendu dans des cadres portés par un attribut ; rien n'est
 *   publié tant que le fondateur ne clique pas « Publier ».
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SELECTION } from '@rueda/design-tokens';
import type { Mode } from '@rueda/design-tokens';
import { CATALOGS, createTranslator, EDITABLE_BLOCKS, getProfile } from '@rueda/i18n';
import type { EditableBlock } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import { intentFor, request, screenFor } from '../console/api.ts';
import type { ActionIntent, ApiResult, MeBody } from '../console/api.ts';
import {
  bodyIssue,
  checkDraft,
  draftTokens,
  failuresOf,
  initialDraft,
  legalTrigger,
  logoDataUri,
  precheckAsset,
  versionsOf,
} from './brand-logic.ts';
import type { AssetKind, DraftEdits, FontSlot, LogoSlot, VersionView } from './brand-logic.ts';
import { BrandView, CONTENT_LOCALES } from './brand-view.tsx';
import type { BrandScreenState, ContentEditor, ContentLocale, Notice } from './brand-view.tsx';
import type { PreviewWidth } from './preview.tsx';

const PRECHECK_KEYS = {
  empty: 'backoffice.o02.assets.empty',
  tooBig: 'backoffice.o02.assets.tooBig',
  badType: 'backoffice.o02.assets.badType',
} as const;

const REGISTRY = EDITABLE_BLOCKS as Readonly<Record<string, EditableBlock>>;
const FIRST_KEY = Object.keys(REGISTRY)[0] as string;

/** Texte livré du catalogue dans une langue (point de départ si rien n'est publié). */
function catalogText(key: string, locale: ContentLocale): string {
  const block = REGISTRY[key];
  if (block === undefined) return '';
  const message = (CATALOGS[locale].messages as Readonly<Record<string, unknown>>)[
    block.catalogKey
  ];
  return typeof message === 'string' ? message : '';
}

const emptyBodies = (key: string): Record<ContentLocale, string> => ({
  es: catalogText(key, 'es'),
  en: catalogText(key, 'en'),
  fr: catalogText(key, 'fr'),
  pt: catalogText(key, 'pt'),
});

async function base64Of(file: File): Promise<{ bytes: Uint8Array; base64: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return { bytes, base64: btoa(binary) };
}

export function BrandClient({ localeTag }: { readonly localeTag: string }) {
  const i18n = useMemo(() => createTranslator(getProfile(LOCALE_CONFIG, localeTag)), [localeTag]);
  const [access, setAccess] = useState<BrandScreenState['access']>('loading');
  const [versions, setVersions] = useState<readonly VersionView[] | 'error'>([]);
  const [draft, setDraft] = useState<DraftEdits>(() => initialDraft([], DEFAULT_SELECTION.palette));
  const [preview, setPreview] = useState<{ mode: Mode; width: PreviewWidth }>({
    mode: 'light',
    width: 'mobile',
  });
  const [content, setContent] = useState<ContentEditor>({
    key: FIRST_KEY,
    bodies: emptyBodies(FIRST_KEY),
  });
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  const [refusedPairs, setRefusedPairs] = useState<BrandScreenState['refusedPairs']>(undefined);
  const [busy, setBusy] = useState(false);
  const intent = useRef<ActionIntent | null>(null);
  const publishIntent = useRef<ActionIntent | null>(null);

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

  /** `requestId` stable pour une même intention (action et contenu identiques). */
  const requestIdFor = (parts: readonly unknown[]): string => {
    intent.current = intentFor(intent.current, parts, () => crypto.randomUUID());
    return intent.current.requestId;
  };

  const loadVersions = useCallback(async (): Promise<readonly VersionView[] | 'error'> => {
    const r = await call<unknown>('GET', '/console/brand/versions?limit=20');
    const list = r.ok ? versionsOf(r.body) : null;
    const value = list ?? 'error';
    setVersions(value);
    return value;
  }, [call]);

  const loadContent = useCallback(
    async (key: string) => {
      const bodies = emptyBodies(key);
      for (const locale of CONTENT_LOCALES) {
        const r = await call<{ blocks?: unknown }>('GET', `/brand/content?locale=${locale}`);
        const blocks = r.ok && Array.isArray(r.body.blocks) ? (r.body.blocks as unknown[]) : [];
        const found = blocks.find(
          (b): b is { bodyMd: string } =>
            typeof b === 'object' &&
            b !== null &&
            (b as { key?: unknown }).key === key &&
            (b as { country?: unknown }).country === null &&
            (b as { fallback?: unknown }).fallback === false &&
            typeof (b as { bodyMd?: unknown }).bodyMd === 'string',
        );
        if (found !== undefined) bodies[locale] = found.bodyMd;
      }
      setContent({ key, bodies });
    },
    [call],
  );

  useEffect(() => {
    void (async () => {
      const me = await call<MeBody>('GET', '/staff/me');
      const admin =
        me.ok &&
        screenFor(me.body.state) === 'console' &&
        me.body.roles.some((r) => r.role === 'ADMIN');
      if (!admin) {
        setAccess('denied');
        return;
      }
      const list = await loadVersions();
      setDraft(initialDraft(list === 'error' ? [] : list, DEFAULT_SELECTION.palette));
      setAccess('ready');
      await loadContent(FIRST_KEY);
    })();
  }, [call, loadContent, loadVersions]);

  useEffect(() => {
    if (access !== 'loading') document.getElementById('o02-heading')?.focus();
  }, [access]);

  const known = versions === 'error' ? [] : versions;
  const tokens = useMemo(() => draftTokens(draft, known), [draft, known]);
  const check = useMemo(() => checkDraft(draft, tokens), [draft, tokens]);
  const logo = useMemo(
    () => ({ light: logoDataUri(tokens, 'logo'), dark: logoDataUri(tokens, 'logoDark') }),
    [tokens],
  );

  const once = (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    void fn().finally(() => setBusy(false));
  };

  const fail = (r: { messageKey: Notice['key'] }) =>
    setNotice({ tone: 'danger', key: r.messageKey });

  const handlers = {
    onBase: (value: string) => {
      const [kind, ...rest] = value.split(':');
      const id = rest.join(':');
      if ((kind !== 'palette' && kind !== 'version') || id === '') return;
      const chosen = known.find((v) => v.id === id);
      setDraft((d) => ({
        ...d,
        base: { kind, id },
        brandName: chosen?.brandName ?? d.brandName,
        colors: { light: {}, dark: {} },
        fonts: {},
        logos: {},
      }));
    },
    onBrandName: (value: string) => setDraft((d) => ({ ...d, brandName: value })),
    onColor: (mode: Mode, color: string, value: string) =>
      setDraft((d) => ({
        ...d,
        colors: { ...d.colors, [mode]: { ...d.colors[mode], [color]: value.trim() } },
      })),
    onFont: (slot: FontSlot, family: string) =>
      setDraft((d) => {
        const fonts = { ...d.fonts };
        if (family === '') delete fonts[slot];
        else fonts[slot] = family;
        return { ...d, fonts };
      }),
    onLogoFile: (slot: LogoSlot, file: File | undefined) => {
      if (file === undefined) return;
      void file
        .text()
        .then((svg) => setDraft((d) => ({ ...d, logos: { ...d.logos, [slot]: svg } })));
    },
    onSaveDraft: () => {
      if (tokens === undefined || check.formatProblems.length > 0 || check.logoInvalid) {
        setNotice({ tone: 'danger', key: 'backoffice.o02.draft.invalid' });
        return;
      }
      const body = {
        brandName: draft.brandName.trim(),
        tokens,
        ...(draft.logoAssetId !== undefined ? { logoAssetId: draft.logoAssetId } : {}),
        ...(draft.faviconAssetId !== undefined ? { faviconAssetId: draft.faviconAssetId } : {}),
        ...(draft.pwaIconAssetId !== undefined ? { pwaIconAssetId: draft.pwaIconAssetId } : {}),
        ...(draft.base.kind === 'version' ? { copiedFromId: draft.base.id } : {}),
      };
      const requestId = requestIdFor(['draft', body]);
      once(async () => {
        const r = await call<{ versionNo: number }>('POST', '/console/brand/drafts', {
          requestId,
          ...body,
        });
        setRefusedPairs(undefined);
        if (!r.ok) return fail(r);
        await loadVersions();
        setNotice({
          tone: 'success',
          key: 'backoffice.o02.draft.saved',
          values: { no: r.body.versionNo },
        });
      });
    },
    onPublish: (versionId: string) => {
      const requestId = requestIdFor(['publish', versionId]);
      once(async () => {
        const r = await call<{ versionNo: number }>(
          'POST',
          `/console/brand/versions/${encodeURIComponent(versionId)}/publish`,
          { requestId },
        );
        if (!r.ok) {
          // contraste insuffisant : la paire en cause est montrée (critère 2), rien n'est publié
          setRefusedPairs(
            r.code === 'BRAND_CONTRAST_INSUFFICIENT' ? failuresOf(r.details) : undefined,
          );
          return fail(r);
        }
        setRefusedPairs(undefined);
        await loadVersions();
        setNotice({
          tone: 'success',
          key: 'backoffice.o02.publish.done',
          values: { no: r.body.versionNo },
        });
      });
    },
    onRollback: () => {
      const published = known.find((v) => v.status === 'PUBLISHED');
      const requestId = requestIdFor(['rollback', published?.id ?? null]);
      once(async () => {
        const r = await call<{ versionNo?: number }>('POST', '/console/brand/rollback', {
          requestId,
        });
        if (!r.ok) {
          setRefusedPairs(
            r.code === 'BRAND_CONTRAST_INSUFFICIENT' ? failuresOf(r.details) : undefined,
          );
          return fail(r);
        }
        setRefusedPairs(undefined);
        await loadVersions();
        setNotice({
          tone: 'success',
          key: 'backoffice.o02.rollback.done',
          values: { no: r.body.versionNo ?? '' },
        });
      });
    },
    onPreview: (mode: Mode, width: PreviewWidth) => setPreview({ mode, width }),
    onAsset: (
      kind: AssetKind,
      file: File | undefined,
      alt: Readonly<Record<ContentLocale, string>>,
      license: string,
    ) => {
      if (file === undefined) {
        setNotice({ tone: 'danger', key: 'backoffice.o02.assets.empty' });
        return;
      }
      once(async () => {
        const { bytes, base64 } = await base64Of(file);
        const pre = precheckAsset(bytes);
        if (pre !== 'ok') {
          setNotice({ tone: 'danger', key: PRECHECK_KEYS[pre], values: { max: 64 } });
          return;
        }
        const requestId = requestIdFor([
          'asset',
          kind,
          base64.length,
          base64.slice(0, 64),
          alt,
          license,
        ]);
        const r = await call<{ assetId: string }>('POST', '/console/brand/assets', {
          requestId,
          kind,
          contentBase64: base64,
          alt,
          licenseNote: license,
        });
        if (!r.ok) return fail(r);
        const id = r.body.assetId;
        setDraft((d) =>
          kind === 'LOGO'
            ? { ...d, logoAssetId: id }
            : kind === 'FAVICON'
              ? { ...d, faviconAssetId: id }
              : kind === 'PWA_ICON'
                ? { ...d, pwaIconAssetId: id }
                : d,
        );
        setNotice({ tone: 'success', key: 'backoffice.o02.assets.done' });
      });
    },
    onContentKey: (key: string) => {
      if (REGISTRY[key] === undefined) return;
      setContent({ key, bodies: emptyBodies(key) });
      void loadContent(key);
    },
    onContentBody: (locale: ContentLocale, value: string) =>
      setContent((c) => ({ ...c, bodies: { ...c.bodies, [locale]: value }, refusal: undefined })),
    onContentPublish: () => {
      const word = legalTrigger(content.key);
      if (word !== null) {
        setContent((c) => ({ ...c, refusal: { kind: 'legal', word } }));
        return;
      }
      const block = REGISTRY[content.key];
      if (block === undefined) return;
      const issues = CONTENT_LOCALES.flatMap((locale) => {
        const issue = bodyIssue(content.bodies[locale], block);
        return issue === null ? [] : [{ locale, issue }];
      });
      if (issues.length > 0) {
        setContent((c) => ({ ...c, refusal: { kind: 'body', issues } }));
        return;
      }
      const requestId = requestIdFor(['content', content.key, content.bodies]);
      once(async () => {
        const d = await call<{ versionNo: number }>('POST', '/console/content/drafts', {
          requestId,
          key: content.key,
          bodies: content.bodies,
        });
        if (!d.ok) {
          if (d.code === 'CONTENT_KEY_FORBIDDEN') {
            setContent((c) => ({
              ...c,
              refusal: { kind: 'legal', word: legalTrigger(c.key) ?? c.key },
            }));
          }
          return fail(d);
        }
        publishIntent.current = intentFor(
          publishIntent.current,
          ['content-publish', content.key, d.body.versionNo],
          () => crypto.randomUUID(),
        );
        const p = await call<{ versionNo: number }>('POST', '/console/content/publish', {
          requestId: publishIntent.current.requestId,
          key: content.key,
          versionNo: d.body.versionNo,
        });
        if (!p.ok) return fail(p);
        setNotice({
          tone: 'success',
          key: 'backoffice.o02.content.published',
          values: { no: p.body.versionNo },
        });
      });
    },
    onContentRollback: () => {
      const requestId = requestIdFor(['content-rollback', content.key]);
      once(async () => {
        const r = await call('POST', '/console/content/rollback', { requestId, key: content.key });
        if (!r.ok) return fail(r);
        await loadContent(content.key);
        setNotice({ tone: 'success', key: 'backoffice.o02.content.rolledBack' });
      });
    },
  };

  const state: BrandScreenState = {
    access,
    versions,
    draft,
    check,
    tokens,
    logo,
    preview,
    content,
    notice,
    refusedPairs,
  };
  return <BrandView i18n={i18n} state={state} handlers={handlers} busy={busy} />;
}
