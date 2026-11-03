/**
 * Polices nommées d'un thème (US-034) : familles non génériques de tous les jetons `fontFamily`,
 * en clair et en sombre. Sert au contrôle « police hors de la liste approuvée »
 * (`FONT_NOT_APPROVED`) à l'enregistrement et à la publication d'une version de marque. Les
 * familles génériques (`system-ui`, `sans-serif`…) sont des replis du navigateur, jamais des
 * polices à approuver : `buildTheme` les écrit sans guillemets, les familles nommées entre
 * guillemets (et `FONT_NAME` interdit le guillemet dans un nom).
 */
import type { Theme } from './build.ts';

export function themeFontFamilies(theme: Theme): string[] {
  const named = new Set<string>();
  for (const token of theme.tokens) {
    if (token.type !== 'fontFamily') continue;
    for (const css of [token.light, token.dark]) {
      for (const m of css.matchAll(/"([^"]+)"/g)) if (m[1] !== undefined) named.add(m[1]);
    }
  }
  return [...named].sort();
}
