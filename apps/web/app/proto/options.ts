/**
 * Prototype cliquable US-033 : drapeau, écrans, états et paramètres d'URL.
 *
 * Ouvert en développement (`next dev`) ; ailleurs, seulement si `WEB_PROTOTYPE_ENABLED` vaut
 * exactement `true` (préproduction, revue du fondateur). Sinon : 404. Lu à chaque requête côté
 * serveur (jamais `NEXT_PUBLIC_*`) : rien n'est figé au build. Ne jamais le définir en production.
 */
import type { ProtoKey } from './copy/index.ts';

export const PROTOTYPE_FLAG = 'WEB_PROTOTYPE_ENABLED';

type Env = Readonly<Record<string, string | undefined>>;

export function isPrototypeEnabled(env: Env = process.env): boolean {
  return env[PROTOTYPE_FLAG] === 'true' || env['NODE_ENV'] === 'development';
}

export type StateId =
  | 'normal'
  | 'empty'
  | 'loading'
  | 'error'
  | 'offline'
  | 'sheet'
  | 'sheetEmpty'
  | 'request'
  | 'code'
  | 'review'
  | 'verified'
  | 'priceChanged'
  | 'deposit'
  | 'slow'
  | 'late'
  | 'hostNoShow'
  | 'done'
  // Espace hôte, console ops et compte (seconde demande de fusion)
  | 'closed'
  | 'waiting'
  | 'noShow'
  | 'license'
  | 'photos'
  | 'keys'
  | 'refuse'
  | 'fee'
  | 'cancel'
  | 'onHold'
  | 'payoutsOff'
  | 'decided'
  | 'preview'
  | 'sent'
  | 'item'
  | 'noPhoto';

/** Parcours : voyageur (10b §4.2.1, §4.2.4), hôte (§4.2.3, §4.2.9) ou plateforme (O01). */
export type ScreenGroup = 'guest' | 'host' | 'platform';

export interface ScreenSpec {
  readonly id: string;
  readonly group: ScreenGroup;
  readonly title: ProtoKey;
  /** États montrables ; le premier est l'état par défaut. */
  readonly states: readonly StateId[];
}

/** Parcours du voyageur (10b §4.2.1 puis §4.2.4), dans l'ordre de la navigation. */
export const SCREENS: readonly ScreenSpec[] = [
  {
    id: 's01',
    group: 'guest',
    title: 'proto.screen.s01',
    states: ['normal', 'empty', 'loading', 'error', 'offline'],
  },
  {
    id: 's02',
    group: 'guest',
    title: 'proto.screen.s02',
    states: ['normal', 'empty', 'loading', 'error', 'offline', 'sheet', 'sheetEmpty'],
  },
  {
    id: 's03',
    group: 'guest',
    title: 'proto.screen.s03',
    states: ['normal', 'empty', 'loading', 'error', 'request'],
  },
  {
    id: 's15',
    group: 'guest',
    title: 'proto.screen.s15',
    states: ['normal', 'loading', 'code', 'error'],
  },
  {
    id: 's04',
    group: 'guest',
    title: 'proto.screen.s04',
    states: ['normal', 'loading', 'error', 'review', 'verified'],
  },
  {
    id: 's05',
    group: 'guest',
    title: 'proto.screen.s05',
    states: ['normal', 'loading', 'error', 'priceChanged', 'deposit', 'request'],
  },
  {
    id: 's06',
    group: 'guest',
    title: 'proto.screen.s06',
    states: ['normal', 'loading', 'slow', 'error'],
  },
  { id: 's07', group: 'guest', title: 'proto.screen.s07', states: ['normal', 'request', 'error'] },
  {
    id: 's08',
    group: 'guest',
    title: 'proto.screen.s08',
    states: ['normal', 'empty', 'loading', 'error', 'offline'],
  },
  {
    id: 's09',
    group: 'guest',
    title: 'proto.screen.s09',
    states: ['normal', 'loading', 'late', 'hostNoShow', 'offline'],
  },
  {
    id: 's09c',
    group: 'guest',
    title: 'proto.screen.s09c',
    states: ['normal', 'loading', 'error', 'offline', 'done'],
  },
  {
    id: 's17',
    group: 'guest',
    title: 'proto.screen.s17',
    states: ['normal', 'loading', 'offline'],
  },
  {
    id: 's14',
    group: 'guest',
    title: 'proto.screen.s14',
    states: ['normal', 'loading', 'error', 'noPhoto'],
  },
  // Espace hôte : inscription (10b §4.2.3), puis gestion, remise et retour, gains (§4.2.9).
  {
    id: 'a01',
    group: 'host',
    title: 'proto.screen.a01',
    states: ['normal', 'loading', 'error', 'closed'],
  },
  {
    id: 'a07',
    group: 'host',
    title: 'proto.screen.a07',
    states: ['normal', 'loading', 'error', 'waiting'],
  },
  {
    id: 'a10',
    group: 'host',
    title: 'proto.screen.a10',
    states: ['normal', 'empty', 'loading', 'error', 'closed'],
  },
  {
    id: 'a11',
    group: 'host',
    title: 'proto.screen.a11',
    states: ['normal', 'loading', 'error', 'preview'],
  },
  {
    id: 'a13',
    group: 'host',
    title: 'proto.screen.a13',
    states: ['normal', 'empty', 'loading', 'error', 'preview'],
  },
  {
    id: 'a02',
    group: 'host',
    title: 'proto.screen.a02',
    states: ['normal', 'empty', 'loading', 'error', 'closed', 'request', 'noShow'],
  },
  {
    id: 'a05',
    group: 'host',
    title: 'proto.screen.a05',
    states: ['normal', 'empty', 'loading', 'error', 'request', 'cancel'],
  },
  {
    id: 'a06',
    group: 'host',
    title: 'proto.screen.a06',
    states: ['normal', 'empty', 'loading', 'error'],
  },
  {
    id: 'a03',
    group: 'host',
    title: 'proto.screen.a03',
    states: ['normal', 'license', 'photos', 'keys', 'refuse', 'done', 'loading', 'error'],
  },
  {
    id: 'a04',
    group: 'host',
    title: 'proto.screen.a04',
    states: ['normal', 'loading', 'error', 'fee', 'done'],
  },
  {
    id: 'a12',
    group: 'host',
    title: 'proto.screen.a12',
    states: ['normal', 'loading', 'error', 'sent'],
  },
  {
    id: 'a08',
    group: 'host',
    title: 'proto.screen.a08',
    states: ['normal', 'empty', 'loading', 'error', 'onHold', 'payoutsOff'],
  },
  {
    id: 'a09',
    group: 'host',
    title: 'proto.screen.a09',
    states: ['normal', 'loading', 'error', 'decided'],
  },
  // Plateforme : console ops (back-office, 10b §4.1 O01).
  {
    id: 'o01',
    group: 'platform',
    title: 'proto.screen.o01',
    states: ['normal', 'empty', 'loading', 'error', 'item'],
  },
];

export function screenOf(id: string): ScreenSpec | undefined {
  return SCREENS.find((s) => s.id === id);
}

export type ProtoTheme = 'auto' | 'light' | 'dark';

export interface ProtoOptions {
  readonly locale: string | undefined;
  readonly theme: ProtoTheme;
  readonly market: string | undefined;
  readonly state: StateId;
  /** Choix propre à l'écran (tri, plan de protection, situation) : rendu côté serveur, sans JS. */
  readonly sel: string | undefined;
  /** Mode capture : barre d'outils masquée (captures 360 px de docs/design/US-033). */
  readonly capture: boolean;
}

type Params = Readonly<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

const SAFE = /^[A-Za-z0-9_-]{1,32}$/u;

/** Paramètres d'URL ; toute valeur inconnue est ignorée (valeur par défaut). */
export function parseProtoOptions(
  params: Params,
  locales: readonly string[],
  screen?: ScreenSpec,
): ProtoOptions {
  const lang = one(params['lang']);
  const theme = one(params['theme']);
  const state = one(params['state']);
  const market = one(params['market']);
  const sel = one(params['sel']);
  const states = screen?.states ?? ['normal'];
  return {
    locale: lang !== undefined && locales.includes(lang) ? lang : undefined,
    theme: theme === 'light' || theme === 'dark' ? theme : 'auto',
    market: market !== undefined && SAFE.test(market) ? market : undefined,
    state: states.find((s) => s === state) ?? states[0] ?? 'normal',
    sel: sel !== undefined && SAFE.test(sel) ? sel : undefined,
    capture: one(params['capture']) === '1',
  };
}

export const PROTO_BASE = '/proto';

/** Lien vers un écran du prototype en gardant langue, thème, marché et mode capture. */
export function protoHref(
  options: ProtoOptions,
  screen: string | null,
  change: {
    readonly state?: StateId;
    readonly sel?: string | undefined;
    readonly locale?: string;
    readonly theme?: ProtoTheme;
    readonly market?: string;
  } = {},
): string {
  const query = new URLSearchParams();
  const locale = change.locale ?? options.locale;
  const theme = change.theme ?? options.theme;
  const market = change.market ?? options.market;
  if (locale) query.set('lang', locale);
  if (theme !== 'auto') query.set('theme', theme);
  if (market) query.set('market', market);
  if (change.state && change.state !== 'normal') query.set('state', change.state);
  if (change.sel) query.set('sel', change.sel);
  if (options.capture) query.set('capture', '1');
  const path = screen ? `${PROTO_BASE}/${screen}` : PROTO_BASE;
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

/** Champs cachés d'un formulaire GET qui doit garder le contexte du prototype. */
export function hiddenContext(options: ProtoOptions): ReadonlyArray<readonly [string, string]> {
  const out: Array<readonly [string, string]> = [];
  if (options.locale) out.push(['lang', options.locale]);
  if (options.theme !== 'auto') out.push(['theme', options.theme]);
  if (options.market) out.push(['market', options.market]);
  if (options.capture) out.push(['capture', '1']);
  return out;
}
