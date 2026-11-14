/**
 * Marque de la requête (US-048, US-034, ADR-072) : nom, thème compilé et logo de la coquille et du
 * manifeste PWA.
 *
 * - **Version publiée** (`GET /brand` de l'API, US-034) quand `WEB_BRAND_API_URL` est définie :
 *   le document de jetons est **revalidé ici** (format et contraste WCAG 2.2 AA, contrôles
 *   d'US-030), la feuille de style est recompilée localement (on ne réinjecte jamais un CSS reçu)
 *   et la réponse est gardée `BRAND_CACHE_TTL_MS` en mémoire.
 * - **Thème embarqué** sinon, ou si l'API ne répond pas, répond 503 `BRAND_VERSION_UNAVAILABLE`
 *   ou renvoie un document invalide (fail-closed : jamais de page sans thème validé) :
 *   palette de `packages/design-tokens/config/theme.json` (surcharge `THEME_PALETTE`), nom lu dans
 *   le groupe `brand` de cette palette (DEC-MARQUE : aujourd'hui Kmino).
 *
 * Aucune couleur, police ni nom de marque n'est écrit dans le code : tout vient des jetons.
 */
import {
  assertContrast,
  buildTheme,
  getActiveTheme,
  logoProblem,
  paletteDocument,
  resolveSelection,
  themeStyleSheet,
} from '@rueda/design-tokens';
import type { ActiveTheme } from '@rueda/design-tokens';

type Env = Readonly<Record<string, string | undefined>>;

export const BRAND_API_URL_VAR = 'WEB_BRAND_API_URL';
/** Même borne que `readCacheTtlSeconds` de l'API (30 s, US-034) : PROPOSÉ. */
export const BRAND_CACHE_TTL_MS = 30_000;
/** Au-delà, la page part avec le thème embarqué : un rendu ne doit jamais attendre l'API. */
export const BRAND_FETCH_TIMEOUT_MS = 1_500;
const MAX_NAME_LENGTH = 40;
const MAX_LOGO_LENGTH = 20_000;

export interface BrandLogo {
  /** Logo SVG (donnée du thème), à afficher **uniquement** en image (`<img>`), jamais injecté. */
  readonly light?: string | undefined;
  readonly dark?: string | undefined;
}

export interface ShellBrand {
  readonly name: string;
  readonly source: 'published' | 'embedded';
  /** Étiquette de version, pour le cache du service worker et le diagnostic. */
  readonly version: string;
  readonly active: ActiveTheme;
  readonly logo: BrandLogo;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function tokenValue(doc: unknown, ...path: string[]): unknown {
  let node: unknown = doc;
  for (const part of path) node = isObject(node) ? node[part] : undefined;
  return isObject(node) ? node['$value'] : undefined;
}

/** Nom affichable : texte court, sans caractère de contrôle ni balise. */
export function validBrandName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>{}]/.test(name)) return undefined;
  return name;
}

/**
 * Logo lu : le même contrôle par liste blanche que l'enregistrement (`logoProblem`, US-122,
 * ADR-122) ; un logo refusé n'est pas affiché (le nom de la marque reste).
 */
function validLogo(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_LOGO_LENGTH) return undefined;
  return logoProblem(value) === null ? value : undefined;
}

function logoOf(doc: unknown): BrandLogo {
  return {
    light: validLogo(tokenValue(doc, 'brand', 'logo')),
    dark: validLogo(tokenValue(doc, 'brand', 'logoDark')),
  };
}

/** Thème embarqué : palette de la configuration, nom et logo de son groupe `brand`. */
export function embeddedBrand(env: Env = process.env): ShellBrand {
  const selection = resolveSelection(env);
  const active = getActiveTheme(env);
  const doc = paletteDocument(selection.palette);
  const name = validBrandName(tokenValue(doc, 'brand', 'name'));
  if (name === undefined)
    throw new Error(`palette ${selection.palette} : jeton brand.name absent ou invalide`);
  return {
    name,
    source: 'embedded',
    version: `${active.theme.id}@${active.theme.version}`,
    active,
    logo: logoOf(doc),
  };
}

/**
 * Lit une réponse de `GET /brand` (US-034). Rend `undefined` si elle est inexploitable :
 * l'appelant garde alors le thème embarqué.
 */
export function brandFromPublished(body: unknown, env: Env = process.env): ShellBrand | undefined {
  if (!isObject(body)) return undefined;
  const name = validBrandName(body['brandName']);
  const versionNo = body['versionNo'];
  if (name === undefined || !Number.isSafeInteger(versionNo) || !isObject(body['tokens']))
    return undefined;
  try {
    // Revalidation complète : format (fail-closed) puis contraste AA.
    const theme = assertContrast(buildTheme(body['tokens']));
    const { colorScheme } = resolveSelection(env);
    return {
      name,
      source: 'published',
      version: `brand-${String(versionNo)}`,
      active: {
        theme,
        colorScheme,
        css: themeStyleSheet(theme),
        dataTheme: colorScheme === 'auto' ? undefined : colorScheme,
      },
      logo: logoOf(body['tokens']),
    };
  } catch {
    return undefined;
  }
}

/** URL de base de l'API, validée (http ou https, sans identifiants). */
export function brandApiUrl(env: Env = process.env): URL | undefined {
  const raw = env[BRAND_API_URL_VAR];
  if (raw === undefined || raw === '') return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.username !== '' || url.password !== '') return undefined;
    return url;
  } catch {
    return undefined;
  }
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

let cached: { at: number; key: string; value: ShellBrand | undefined } | undefined;

/** Vide le cache (tests). */
export function resetBrandCache(): void {
  cached = undefined;
}

/**
 * Marque de la requête : version publiée si l'API la donne, thème embarqué sinon.
 * Ne lève jamais d'erreur à cause de l'API ; seule une configuration embarquée invalide échoue.
 */
export async function getRequestBrand(
  env: Env = process.env,
  fetcher: Fetcher = fetch,
  nowMs: () => number = Date.now,
): Promise<ShellBrand> {
  const base = brandApiUrl(env);
  if (base === undefined) return embeddedBrand(env);
  const key = base.href;
  const now = nowMs();
  if (cached !== undefined && cached.key === key && now - cached.at < BRAND_CACHE_TTL_MS) {
    return cached.value ?? embeddedBrand(env);
  }
  let value: ShellBrand | undefined;
  try {
    const response = await fetcher(
      new URL('brand', base.href.endsWith('/') ? base : `${base.href}/`).href,
      {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(BRAND_FETCH_TIMEOUT_MS),
      },
    );
    value = response.ok ? brandFromPublished(await response.json(), env) : undefined;
  } catch {
    value = undefined;
  }
  cached = { at: now, key, value };
  return value ?? embeddedBrand(env);
}
