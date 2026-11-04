/**
 * Dessin des icônes de l'application (US-048) à partir de la marque : logo SVG du thème posé sur
 * la couleur d'action, ou, sans logo, l'initiale du nom. Rendu en PNG par `next/og` (aucune
 * couleur écrite ici : tout vient de `brand.active.theme.colors`).
 */
import type { ShellBrand } from '../brand-source.ts';
import { PWA_ICONS } from './manifest.ts';
import type { PwaIconName } from './manifest.ts';

/** Part de l'icône occupée par le logo : zone sûre d'une icône `maskable` (80 %). */
const SAFE_ZONE = 0.8;

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Premier graphème du nom et le reste (« K » + « mino »). */
export function splitInitial(name: string): readonly [string, string] {
  const [first] = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name);
  const initial = first?.segment ?? '';
  return [initial, name.slice(initial.length)];
}

/** Initiale du nom, en repli quand la marque n'a pas de logo. */
export function initialOf(name: string): string {
  return splitInitial(name)[0].toLocaleUpperCase();
}

export interface IconSpec {
  readonly size: number;
  /** Fond plein (maskable, Apple) ou logo seul sur fond transparent. */
  readonly fullBleed: boolean;
  readonly background: string;
  readonly foreground: string;
  readonly logoUri: string | undefined;
  readonly logoSize: number;
  readonly initial: string;
}

export function iconSpec(name: PwaIconName, brand: ShellBrand): IconSpec {
  const { size, purpose } = PWA_ICONS[name];
  const fullBleed = purpose !== 'any' || brand.logo.light === undefined;
  const colors = brand.active.theme.colors.light;
  return {
    size,
    fullBleed,
    background: colors.primary,
    foreground: colors['on-primary'],
    logoUri: brand.logo.light === undefined ? undefined : svgDataUri(brand.logo.light),
    logoSize: Math.floor(fullBleed ? size * SAFE_ZONE : size),
    initial: initialOf(brand.name),
  };
}

/** Élément rendu par `ImageResponse` (Satori : styles en objet, valeurs calculées). */
export function IconArt({ spec }: { readonly spec: IconSpec }) {
  const box = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: spec.size,
    height: spec.size,
    ...(spec.fullBleed ? { background: spec.background } : {}),
    color: spec.foreground,
    fontSize: Math.round(spec.size * 0.56),
  };
  return (
    <div style={box}>
      {spec.logoUri !== undefined ? (
        <img src={spec.logoUri} width={spec.logoSize} height={spec.logoSize} alt="" />
      ) : (
        spec.initial
      )}
    </div>
  );
}
