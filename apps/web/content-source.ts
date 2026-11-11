/**
 * Blocs de contenu éditables de la requête (US-121, ADR-095) : textes changés par le fondateur
 * sans déploiement (`content_block`, US-034), lus par `GET /brand/content` de l'API quand
 * `WEB_BRAND_API_URL` est définie (même variable que la marque, `brand-source.ts`).
 *
 * - Liste blanche : seuls les blocs du registre `EDITABLE_BLOCKS` de `@rueda/i18n` sont pris ;
 *   chacun remplace un texte du catalogue livré (`catalogKey`).
 * - Assainissement revérifié ici : l'API envoie un arbre (`doc`) ; il est revalidé par
 *   `isRichDoc` (forme exacte, liens internes seulement, format et longueur du registre). Le
 *   site n'injecte jamais de HTML : `rich-text.tsx` crée des éléments React.
 * - Langue : un bloc n'est pris que s'il est publié **dans la langue de la page** (`fallback`
 *   faux). Sinon le texte du catalogue livré s'affiche, dans la même langue (jamais un bloc vide,
 *   jamais deux langues dans une vue : 10b UX-58, US-014) ; le bloc incomplet est signalé au
 *   back-office (`GET /console/content/gaps`). PROPOSÉ (ADR-095).
 * - Fail-closed : API absente, lente (`CONTENT_FETCH_TIMEOUT_MS`), en erreur ou réponse
 *   invalide ⇒ catalogue seul. Réponse gardée `CONTENT_CACHE_TTL_MS` par (langue, pays).
 */
import { EDITABLE_BLOCKS, editableBlock, isRichDoc } from '@rueda/i18n';
import type { EditableBlocks, MessageKey, RichDoc, Translator } from '@rueda/i18n';
import { brandApiUrl } from './brand-source.ts';

type Env = Readonly<Record<string, string | undefined>>;
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/** Même borne que la marque et que `readCacheTtlSeconds` de l'API (30 s) : PROPOSÉ. */
export const CONTENT_CACHE_TTL_MS = 30_000;
/** Au-delà, la page part avec le catalogue : un rendu n'attend jamais l'API. */
export const CONTENT_FETCH_TIMEOUT_MS = 1_500;
const MAX_BLOCKS = 200;

/** Textes remplacés de la page : texte du catalogue → arbre du bloc publié. */
export type PageContent = ReadonlyMap<MessageKey, RichDoc>;

export const NO_CONTENT: PageContent = new Map();

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Pays de la page : région de l'étiquette de locale (`es-PA` ⇒ `PA`), sinon blocs communs. */
export function countryOf(tag: string): string | null {
  return /^[a-z]{2}-([A-Z]{2})$/.exec(tag)?.[1] ?? null;
}

/**
 * Lit une réponse de `GET /brand/content`. Ne garde que les blocs du registre, publiés dans la
 * langue demandée, dont l'arbre est conforme ; tout le reste est ignoré (catalogue).
 */
export function contentFromResponse(
  body: unknown,
  language: string,
  registry: EditableBlocks = EDITABLE_BLOCKS,
): PageContent {
  if (!isObject(body) || body['locale'] !== language || !Array.isArray(body['blocks'])) {
    return NO_CONTENT;
  }
  const out = new Map<MessageKey, RichDoc>();
  for (const raw of body['blocks'].slice(0, MAX_BLOCKS)) {
    if (!isObject(raw) || typeof raw['key'] !== 'string') continue;
    const spec = editableBlock(raw['key'], registry);
    if (spec === undefined) continue;
    if (raw['locale'] !== language || raw['fallback'] !== false) continue;
    const doc = raw['doc'];
    if (!isRichDoc(doc, spec.format, spec.maxLength)) continue;
    out.set(spec.catalogKey, doc);
  }
  return out;
}

/**
 * Description de la page (métadonnées du layout) : l'accroche de l'accueil, bloc publié dans la
 * langue de la page s'il existe (aperçu de partage cohérent avec la page), sinon le catalogue.
 */
export function pageDescription(i18n: Translator, content: PageContent): string {
  const tagline = content.get('web.home.tagline');
  return tagline?.format === 'plain' ? tagline.text : i18n.t('web.home.tagline');
}

const cache = new Map<string, { at: number; value: PageContent }>();

/** Vide le cache (tests). */
export function resetContentCache(): void {
  cache.clear();
}

/**
 * Blocs publiés pour la langue et le pays de la requête. Ne lève jamais d'erreur à cause de
 * l'API : en cas de doute, aucun bloc (la page affiche le catalogue).
 */
export async function getRequestContent(
  i18n: Translator,
  env: Env = process.env,
  fetcher: Fetcher = fetch,
  nowMs: () => number = Date.now,
): Promise<PageContent> {
  const base = brandApiUrl(env);
  if (base === undefined) return NO_CONTENT;
  const language = i18n.profile.language;
  const country = countryOf(i18n.profile.tag);
  const key = `${base.href} ${language} ${country ?? ''}`;
  const now = nowMs();
  const hit = cache.get(key);
  if (hit !== undefined && now - hit.at < CONTENT_CACHE_TTL_MS) return hit.value;
  let value: PageContent = NO_CONTENT;
  try {
    const url = new URL('brand/content', base.href.endsWith('/') ? base : `${base.href}/`);
    url.searchParams.set('locale', language);
    if (country !== null) url.searchParams.set('country', country);
    const response = await fetcher(url.href, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(CONTENT_FETCH_TIMEOUT_MS),
    });
    if (response.ok) value = contentFromResponse(await response.json(), language);
  } catch {
    value = NO_CONTENT;
  }
  cache.set(key, { at: now, value });
  return value;
}
