/**
 * Contraste WCAG 2.x (luminance relative, sRGB) : formule unique du dépôt, partagée par le
 * chargement des palettes (US-030) et, plus tard, par la publication d'un thème (US-034, US-120).
 * Référence : WCAG 2.2, définitions « relative luminance » et « contrast ratio ».
 */

/** Seuils WCAG 2.2 AA : texte (1.4.3) et composants ou graphiques (1.4.11). */
export const AA_TEXT = 4.5;
export const AA_NON_TEXT = 3;

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const HEX = /^#([0-9a-f]{6})$/i;

/** `#RRGGBB` → composantes 0–255. Toute autre écriture est refusée (les jetons sont normalisés). */
export function hexToRgb(hex: string): Rgb {
  const match = HEX.exec(hex);
  if (!match?.[1]) throw new Error(`couleur invalide : ${JSON.stringify(hex)} (attendu #RRGGBB)`);
  const n = Number.parseInt(match[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

const channel = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Rapport de contraste (1 à 21), non arrondi. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Couleur `top` d'opacité `alpha` posée sur `under` (composition « source-over » en sRGB). */
export function blend(top: string, alpha: number, under: string): string {
  const t = hexToRgb(top);
  const u = hexToRgb(under);
  const mix = (x: number, y: number): number => alpha * x + (1 - alpha) * y;
  return rgbToHex({ r: mix(t.r, u.r), g: mix(t.g, u.g), b: mix(t.b, u.b) });
}
