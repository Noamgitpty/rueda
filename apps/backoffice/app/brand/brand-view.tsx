/**
 * Écran « Apparence / Marque » (US-120 ; écran O02 de 10b §8 ; DEC-FONDATEUR-07 : le fondateur
 * change le design quand il veut). Composant de PRÉSENTATION pur : aucun appel réseau, aucun
 * état ; la logique est dans `brand-client.tsx` et `brand-logic.ts`. Composants de `@rueda/ui`,
 * mise en page par les jetons (brand.module.css) : aucun style en dur.
 *
 * Sections : historique des versions (publier un brouillon, retour arrière en un clic), nouveau
 * brouillon (point de départ, nom, couleurs, polices, logo) avec contrôle de contraste et aperçu
 * en direct (S01, S03, S05, A02, e-mail ; clair et sombre ; mobile et bureau), images de marque
 * (antivirus côté API) et textes de l'accueil (blocs d'US-121, refus expliqués : N-46).
 * Les boutons ne sont jamais `disabled` (UX-50) : un envoi en cours les met en chargement.
 */
import type { ChangeEvent, FormEvent } from 'react';
import { listPalettes } from '@rueda/design-tokens';
import type { Mode, Theme } from '@rueda/design-tokens';
import { EDITABLE_BLOCKS } from '@rueda/i18n';
import type { MessageKey, MessageValues, Translator } from '@rueda/i18n';
import { Badge, Banner, Button, ButtonLink, ErrorState, TextField } from '@rueda/ui';
import type { BadgeTone } from '@rueda/ui';
import styles from './brand.module.css';
import { ASSET_KINDS, colorValue, EDITABLE_COLORS, fontChoices } from './brand-logic.ts';
import type {
  AssetKind,
  BodyIssue,
  DraftCheck,
  DraftEdits,
  EditableColor,
  FailureView,
  FontSlot,
  LogoSlot,
  VersionView,
} from './brand-logic.ts';
import { BrandPreview } from './preview.tsx';
import type { PreviewWidth } from './preview.tsx';

export const CONTENT_LOCALES = ['es', 'en', 'fr', 'pt'] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];

export interface Notice {
  readonly tone: 'success' | 'danger' | 'warning' | 'info';
  readonly key: MessageKey;
  readonly values?: MessageValues | undefined;
}

/** Refus d'un texte, expliqué (N-46) : mot juridique cité, ou motif par langue (ZWJ compris). */
export type ContentRefusal =
  | { readonly kind: 'legal'; readonly word: string }
  | {
      readonly kind: 'body';
      readonly issues: readonly { readonly locale: ContentLocale; readonly issue: BodyIssue }[];
    };

export interface ContentEditor {
  readonly key: string;
  readonly bodies: Readonly<Record<ContentLocale, string>>;
  readonly refusal?: ContentRefusal | undefined;
}

export interface BrandScreenState {
  readonly access: 'loading' | 'denied' | 'ready';
  readonly versions: readonly VersionView[] | 'error';
  readonly draft: DraftEdits;
  readonly check: DraftCheck;
  readonly tokens: Record<string, unknown> | undefined;
  readonly logo: Readonly<Record<Mode, string | undefined>>;
  readonly preview: { readonly mode: Mode; readonly width: PreviewWidth };
  readonly content: ContentEditor;
  readonly notice?: Notice | undefined;
  /** Paires d'un refus de publication (API) ou à corriger avant publication. */
  readonly refusedPairs?: readonly FailureView[] | undefined;
}

export interface BrandHandlers {
  readonly onBase: (value: string) => void;
  readonly onBrandName: (value: string) => void;
  readonly onColor: (mode: Mode, color: EditableColor, value: string) => void;
  readonly onFont: (slot: FontSlot, family: string) => void;
  readonly onLogoFile: (slot: LogoSlot, file: File | undefined) => void;
  readonly onSaveDraft: () => void;
  readonly onPublish: (versionId: string) => void;
  readonly onRollback: () => void;
  readonly onPreview: (mode: Mode, width: PreviewWidth) => void;
  readonly onAsset: (
    kind: AssetKind,
    file: File | undefined,
    alt: Readonly<Record<ContentLocale, string>>,
    license: string,
  ) => void;
  readonly onContentKey: (key: string) => void;
  readonly onContentBody: (locale: ContentLocale, value: string) => void;
  readonly onContentPublish: () => void;
  readonly onContentRollback: () => void;
}

const STATUS: Readonly<Record<VersionView['status'], { key: MessageKey; tone: BadgeTone }>> = {
  DRAFT: { key: 'backoffice.o02.status.DRAFT', tone: 'warning' },
  PUBLISHED: { key: 'backoffice.o02.status.PUBLISHED', tone: 'success' },
  ARCHIVED: { key: 'backoffice.o02.status.ARCHIVED', tone: 'neutral' },
};

const COLOR_KEYS: Readonly<Record<EditableColor, MessageKey>> = {
  primary: 'backoffice.o02.color.primary',
  'on-primary': 'backoffice.o02.color.onPrimary',
  accent: 'backoffice.o02.color.accent',
  'on-accent': 'backoffice.o02.color.onAccent',
  surface: 'backoffice.o02.color.surface',
  'surface-raised': 'backoffice.o02.color.surfaceRaised',
  text: 'backoffice.o02.color.text',
  'text-muted': 'backoffice.o02.color.textMuted',
};

const MODE_KEYS: Readonly<Record<Mode, MessageKey>> = {
  light: 'backoffice.o02.mode.light',
  dark: 'backoffice.o02.mode.dark',
};

const ASSET_KIND_KEYS: Readonly<Record<AssetKind, MessageKey>> = {
  LOGO: 'backoffice.o02.assets.kind.LOGO',
  FAVICON: 'backoffice.o02.assets.kind.FAVICON',
  PWA_ICON: 'backoffice.o02.assets.kind.PWA_ICON',
  HERO_IMAGE: 'backoffice.o02.assets.kind.HERO_IMAGE',
};

const ISSUE_KEYS: Readonly<Record<BodyIssue, MessageKey>> = {
  zwj: 'backoffice.o02.content.zwj',
  blank: 'backoffice.o02.content.blank',
  tooLong: 'backoffice.o02.content.tooLong',
  format: 'backoffice.o02.content.format',
};

/** Langue nommée dans la langue de la vue (« inglés », « anglais »), jamais un code brut. */
function languageName(i18n: Translator, code: string): string {
  return new Intl.DisplayNames([i18n.profile.tag], { type: 'language' }).of(code) ?? code;
}

/** Ratio lisible dans la langue de la vue (« 3,89 » en es, fr, pt ; « 3.89 » en en). */
function ratio(i18n: Translator, x: number): string {
  return new Intl.NumberFormat(i18n.profile.tag, { maximumFractionDigits: 2 }).format(x);
}

function formatDate(i18n: Translator, iso: string): string {
  return new Intl.DateTimeFormat(i18n.profile.tag, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

const prevent =
  (fn: (event: FormEvent<HTMLFormElement>) => void) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    fn(event);
  };

const fieldOf = (event: FormEvent<HTMLFormElement>, name: string): string => {
  const v = new FormData(event.currentTarget).get(name);
  return typeof v === 'string' ? v : '';
};

const fileOf = (event: FormEvent<HTMLFormElement>, name: string): File | undefined => {
  const v = new FormData(event.currentTarget).get(name);
  return v instanceof File && v.size > 0 ? v : undefined;
};

function Pairs({
  i18n,
  pairs,
}: {
  readonly i18n: Translator;
  readonly pairs: readonly FailureView[];
}) {
  return (
    <ul className={styles['list']}>
      {pairs.map((f) => (
        <li key={`${f.mode}:${f.pair}`} className={styles['code']}>
          {i18n.t('backoffice.o02.contrast.pair', {
            pair: f.pair,
            mode: MODE_KEYS[f.mode as Mode] ? i18n.t(MODE_KEYS[f.mode as Mode]) : f.mode,
            ratio: ratio(i18n, f.ratio),
            min: ratio(i18n, f.min),
          })}
        </li>
      ))}
    </ul>
  );
}

function History({
  i18n,
  versions,
  handlers,
  busy,
}: {
  readonly i18n: Translator;
  readonly versions: readonly VersionView[] | 'error';
  readonly handlers: BrandHandlers;
  readonly busy: boolean;
}) {
  return (
    <section className={styles['panel']} aria-labelledby="o02-history">
      <h3 id="o02-history" className={styles['subheading']}>
        {i18n.t('backoffice.o02.history.title')}
      </h3>
      {versions === 'error' ? (
        <ErrorState i18n={i18n} message={i18n.t('backoffice.o02.loadError')} headingLevel={4} />
      ) : (
        <>
          {!versions.some((v) => v.status === 'PUBLISHED') && (
            <Banner tone="info">{i18n.t('backoffice.o02.noVersion')}</Banner>
          )}
          <ul className={styles['list']}>
            {versions.map((v) => (
              <li key={v.id} className={styles['version']}>
                <span className={styles['label']}>
                  {i18n.t('backoffice.o02.history.version', { no: v.versionNo, name: v.brandName })}
                </span>
                <Badge tone={STATUS[v.status].tone}>{i18n.t(STATUS[v.status].key)}</Badge>
                <span className={styles['muted']}>
                  {formatDate(i18n, v.publishedAt ?? v.createdAt)}
                </span>
                {v.status === 'DRAFT' && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={() => handlers.onPublish(v.id)}
                  >
                    {i18n.t('backoffice.o02.history.publish', { no: v.versionNo })}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className={styles['group']}>
            <Button type="button" variant="secondary" loading={busy} onClick={handlers.onRollback}>
              {i18n.t('backoffice.o02.rollback.action')}
            </Button>
            <p className={styles['muted']}>{i18n.t('backoffice.o02.rollback.hint')}</p>
          </div>
        </>
      )}
    </section>
  );
}

function DraftForm({
  i18n,
  state,
  handlers,
  busy,
}: {
  readonly i18n: Translator;
  readonly state: BrandScreenState;
  readonly handlers: BrandHandlers;
  readonly busy: boolean;
}) {
  const { draft, check } = state;
  const versions = state.versions === 'error' ? [] : state.versions;
  const base = `${draft.base.kind}:${draft.base.id}`;
  const theme: Theme | undefined = check.theme;
  const fonts = fontChoices();
  return (
    <section className={styles['panel']} aria-labelledby="o02-draft">
      <h3 id="o02-draft" className={styles['subheading']}>
        {i18n.t('backoffice.o02.draft.title')}
      </h3>
      <form className={styles['form']} onSubmit={prevent(() => handlers.onSaveDraft())}>
        <div className={styles['group']}>
          <label className={styles['label']} htmlFor="o02-base">
            {i18n.t('backoffice.o02.draft.base')}
          </label>
          <select
            id="o02-base"
            className={styles['select']}
            value={base}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => handlers.onBase(e.target.value)}
          >
            {versions.map((v) => (
              <option key={v.id} value={`version:${v.id}`}>
                {i18n.t('backoffice.o02.draft.fromVersion', { no: v.versionNo, name: v.brandName })}
              </option>
            ))}
            {listPalettes().map((p) => (
              <option key={p.id} value={`palette:${p.id}`}>
                {i18n.t(
                  p.accepted
                    ? 'backoffice.o02.draft.fromPalette'
                    : 'backoffice.o02.draft.fromPaletteFailing',
                  { palette: p.id },
                )}
              </option>
            ))}
          </select>
        </div>

        <TextField
          i18n={i18n}
          id="o02-name"
          name="brandName"
          maxLength={40}
          autoComplete="off"
          value={draft.brandName}
          onChange={(e) => handlers.onBrandName(e.target.value)}
          label={i18n.t('backoffice.o02.draft.brandName')}
        />

        {(['light', 'dark'] as const).map((mode) => (
          <fieldset key={mode} className={styles['fieldset']}>
            <legend>
              {i18n.t('backoffice.o02.draft.colors', { mode: i18n.t(MODE_KEYS[mode]) })}
            </legend>
            {EDITABLE_COLORS.map((color) => (
              <TextField
                key={color}
                i18n={i18n}
                id={`o02-color-${mode}-${color}`}
                autoComplete="off"
                spellCheck={false}
                maxLength={7}
                value={colorValue(draft, theme, mode, color)}
                onChange={(e) => handlers.onColor(mode, color, e.target.value)}
                label={i18n.t(COLOR_KEYS[color])}
                hint={i18n.t('backoffice.o02.color.hint')}
                error={
                  check.invalidColors.includes(`${mode}:${color}`)
                    ? i18n.t('backoffice.o02.color.invalid')
                    : undefined
                }
              />
            ))}
          </fieldset>
        ))}

        {(['heading', 'body'] as const).map((slot) => (
          <div key={slot} className={styles['group']}>
            <label className={styles['label']} htmlFor={`o02-font-${slot}`}>
              {i18n.t(
                slot === 'heading' ? 'backoffice.o02.font.heading' : 'backoffice.o02.font.body',
              )}
            </label>
            <select
              id={`o02-font-${slot}`}
              className={styles['select']}
              value={draft.fonts[slot] ?? ''}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                handlers.onFont(slot, e.target.value)
              }
            >
              <option value="">{i18n.t('backoffice.o02.font.keep')}</option>
              {fonts.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        ))}
        <p className={styles['muted']}>{i18n.t('backoffice.o02.font.hint')}</p>

        {(['logo', 'logoDark'] as const).map((slot) => (
          <div key={slot} className={styles['group']}>
            <label className={styles['label']} htmlFor={`o02-${slot}`}>
              {i18n.t(slot === 'logo' ? 'backoffice.o02.logo.light' : 'backoffice.o02.logo.dark')}
            </label>
            <input
              id={`o02-${slot}`}
              type="file"
              accept="image/svg+xml,.svg"
              className={styles['file']}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                handlers.onLogoFile(slot, e.target.files?.[0])
              }
            />
          </div>
        ))}
        <p className={styles['muted']}>{i18n.t('backoffice.o02.logo.hint')}</p>
        {check.logoInvalid && (
          <Banner tone="danger">{i18n.t('backoffice.o02.logo.invalid')}</Banner>
        )}

        {check.formatProblems.length > 0 ? (
          <Banner tone="danger">{i18n.t('backoffice.o02.draft.invalid')}</Banner>
        ) : check.failures.length > 0 ? (
          <Banner
            tone="warning"
            title={i18n.t('backoffice.o02.contrast.failing', { count: check.failures.length })}
          >
            <Pairs i18n={i18n} pairs={check.failures} />
          </Banner>
        ) : (
          <Banner tone="success">{i18n.t('backoffice.o02.contrast.ok')}</Banner>
        )}

        <div className={styles['actions']}>
          <Button type="submit" loading={busy}>
            {i18n.t('backoffice.o02.draft.save')}
          </Button>
        </div>
      </form>

      <section className={styles['previewPanel']} aria-labelledby="o02-preview">
        <h4 id="o02-preview" className={styles['label']}>
          {i18n.t('backoffice.o02.preview.title')}
        </h4>
        <p className={styles['muted']}>{i18n.t('backoffice.o02.preview.hint')}</p>
        <div
          className={styles['actions']}
          role="group"
          aria-label={i18n.t('backoffice.o02.preview.options')}
        >
          {(['light', 'dark'] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={state.preview.mode === mode ? 'primary' : 'quiet'}
              aria-pressed={state.preview.mode === mode}
              onClick={() => handlers.onPreview(mode, state.preview.width)}
            >
              {i18n.t(
                mode === 'light' ? 'backoffice.o02.preview.light' : 'backoffice.o02.preview.dark',
              )}
            </Button>
          ))}
          {(['mobile', 'desktop'] as const).map((width) => (
            <Button
              key={width}
              type="button"
              size="sm"
              variant={state.preview.width === width ? 'primary' : 'quiet'}
              aria-pressed={state.preview.width === width}
              onClick={() => handlers.onPreview(state.preview.mode, width)}
            >
              {i18n.t(
                width === 'mobile'
                  ? 'backoffice.o02.preview.mobile'
                  : 'backoffice.o02.preview.desktop',
              )}
            </Button>
          ))}
        </div>
        <BrandPreview
          i18n={i18n}
          theme={theme}
          brandName={draft.brandName}
          logo={state.logo}
          mode={state.preview.mode}
          width={state.preview.width}
        />
      </section>
    </section>
  );
}

function Assets({
  i18n,
  handlers,
  busy,
}: {
  readonly i18n: Translator;
  readonly handlers: BrandHandlers;
  readonly busy: boolean;
}) {
  return (
    <section className={styles['panel']} aria-labelledby="o02-assets">
      <h3 id="o02-assets" className={styles['subheading']}>
        {i18n.t('backoffice.o02.assets.title')}
      </h3>
      <p className={styles['muted']}>{i18n.t('backoffice.o02.assets.hint')}</p>
      <form
        className={styles['form']}
        onSubmit={prevent((e) => {
          const kind = fieldOf(e, 'kind') as AssetKind;
          if (!(ASSET_KINDS as readonly string[]).includes(kind)) return;
          handlers.onAsset(
            kind,
            fileOf(e, 'file'),
            {
              es: fieldOf(e, 'alt-es'),
              en: fieldOf(e, 'alt-en'),
              fr: fieldOf(e, 'alt-fr'),
              pt: fieldOf(e, 'alt-pt'),
            },
            fieldOf(e, 'license'),
          );
        })}
      >
        <div className={styles['group']}>
          <label className={styles['label']} htmlFor="o02-asset-kind">
            {i18n.t('backoffice.o02.assets.kind')}
          </label>
          <select id="o02-asset-kind" name="kind" className={styles['select']} defaultValue="LOGO">
            {ASSET_KINDS.map((k) => (
              <option key={k} value={k}>
                {i18n.t(ASSET_KIND_KEYS[k])}
              </option>
            ))}
          </select>
        </div>
        <div className={styles['group']}>
          <label className={styles['label']} htmlFor="o02-asset-file">
            {i18n.t('backoffice.o02.assets.file')}
          </label>
          <input
            id="o02-asset-file"
            name="file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required
            className={styles['file']}
          />
        </div>
        {CONTENT_LOCALES.map((l) => (
          <TextField
            key={l}
            i18n={i18n}
            id={`o02-asset-alt-${l}`}
            name={`alt-${l}`}
            maxLength={300}
            lang={l}
            label={i18n.t('backoffice.o02.assets.alt', { language: languageName(i18n, l) })}
          />
        ))}
        <TextField
          i18n={i18n}
          id="o02-asset-license"
          name="license"
          minLength={3}
          maxLength={1000}
          label={i18n.t('backoffice.o02.assets.license')}
        />
        <div className={styles['actions']}>
          <Button type="submit" variant="secondary" loading={busy}>
            {i18n.t('backoffice.o02.assets.upload')}
          </Button>
        </div>
      </form>
    </section>
  );
}

function Content({
  i18n,
  editor,
  handlers,
  busy,
}: {
  readonly i18n: Translator;
  readonly editor: ContentEditor;
  readonly handlers: BrandHandlers;
  readonly busy: boolean;
}) {
  const block = (
    EDITABLE_BLOCKS as Readonly<
      Record<string, (typeof EDITABLE_BLOCKS)[keyof typeof EDITABLE_BLOCKS]>
    >
  )[editor.key];
  const hint =
    block === undefined
      ? undefined
      : i18n.t(
          block.format === 'plain'
            ? 'backoffice.o02.content.hintPlain'
            : 'backoffice.o02.content.hintRich',
          { max: block.maxLength },
        );
  const refusal = editor.refusal;
  return (
    <section className={styles['panel']} aria-labelledby="o02-content">
      <h3 id="o02-content" className={styles['subheading']}>
        {i18n.t('backoffice.o02.content.title')}
      </h3>
      <form className={styles['form']} onSubmit={prevent(() => handlers.onContentPublish())}>
        <div className={styles['group']}>
          <label className={styles['label']} htmlFor="o02-content-key">
            {i18n.t('backoffice.o02.content.key')}
          </label>
          <select
            id="o02-content-key"
            className={styles['select']}
            value={editor.key}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => handlers.onContentKey(e.target.value)}
          >
            {Object.keys(EDITABLE_BLOCKS).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        {CONTENT_LOCALES.map((l) => (
          <div key={l} className={styles['group']}>
            <label className={styles['label']} htmlFor={`o02-content-${l}`}>
              {i18n.t('backoffice.o02.content.body', { language: languageName(i18n, l) })}
            </label>
            <textarea
              id={`o02-content-${l}`}
              lang={l}
              className={styles['textarea']}
              rows={block?.format === 'rich' ? 6 : 2}
              value={editor.bodies[l]}
              aria-describedby="o02-content-hint"
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                handlers.onContentBody(l, e.target.value)
              }
            />
          </div>
        ))}
        {hint !== undefined && (
          <p id="o02-content-hint" className={styles['muted']}>
            {hint}
          </p>
        )}
        {refusal?.kind === 'legal' && (
          <Banner tone="danger" live="polite">
            {i18n.t('backoffice.o02.content.legal', { word: refusal.word })}
          </Banner>
        )}
        {refusal?.kind === 'body' && (
          <Banner tone="danger" live="polite" title={i18n.t('backoffice.o02.content.refused')}>
            <ul className={styles['list']}>
              {refusal.issues.map(({ locale, issue }) => (
                <li key={locale}>
                  {i18n.t(ISSUE_KEYS[issue], {
                    language: languageName(i18n, locale),
                    max: block?.maxLength ?? 0,
                  })}
                </li>
              ))}
            </ul>
          </Banner>
        )}
        <div className={styles['actions']}>
          <Button type="submit" loading={busy}>
            {i18n.t('backoffice.o02.content.publish')}
          </Button>
          <Button type="button" variant="quiet" loading={busy} onClick={handlers.onContentRollback}>
            {i18n.t('backoffice.o02.content.rollback')}
          </Button>
        </div>
      </form>
    </section>
  );
}

export function BrandView({
  i18n,
  state,
  handlers,
  busy = false,
}: {
  readonly i18n: Translator;
  readonly state: BrandScreenState;
  readonly handlers: BrandHandlers;
  readonly busy?: boolean;
}) {
  if (state.access === 'loading') {
    return <p className={styles['muted']}>{i18n.t('common.ui.loading')}</p>;
  }
  if (state.access === 'denied') {
    return (
      <section className={styles['panel']} aria-labelledby="o02-heading">
        <h2 id="o02-heading" className={styles['heading']} tabIndex={-1}>
          {i18n.t('backoffice.o02.title')}
        </h2>
        <Banner tone="warning">{i18n.t('backoffice.o02.denied')}</Banner>
        <ButtonLink href="/" variant="secondary">
          {i18n.t('backoffice.o02.back')}
        </ButtonLink>
      </section>
    );
  }
  return (
    <div className={styles['stack']}>
      <section className={styles['panel']} aria-labelledby="o02-heading">
        <h2 id="o02-heading" className={styles['heading']} tabIndex={-1}>
          {i18n.t('backoffice.o02.title')}
        </h2>
        <p className={styles['muted']}>{i18n.t('backoffice.o02.intro')}</p>
        <ButtonLink href="/" variant="quiet">
          {i18n.t('backoffice.o02.back')}
        </ButtonLink>
      </section>

      {state.notice !== undefined && (
        <Banner tone={state.notice.tone} live="polite">
          {i18n.t(state.notice.key, state.notice.values)}
        </Banner>
      )}
      {state.refusedPairs !== undefined && state.refusedPairs.length > 0 && (
        <Banner tone="danger" live="polite" title={i18n.t('backoffice.o02.publish.refused')}>
          <Pairs i18n={i18n} pairs={state.refusedPairs} />
        </Banner>
      )}

      <History i18n={i18n} versions={state.versions} handlers={handlers} busy={busy} />
      <DraftForm i18n={i18n} state={state} handlers={handlers} busy={busy} />
      <Assets i18n={i18n} handlers={handlers} busy={busy} />
      <Content i18n={i18n} editor={state.content} handlers={handlers} busy={busy} />
    </div>
  );
}
