import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const DESIGN_DIR = fileURLToPath(new URL('../../../docs/design/US-028/', import.meta.url));

/** Fichiers de palettes présents sur disque (lus indépendamment du registre). */
export function paletteFiles(): string[] {
  return readdirSync(DESIGN_DIR)
    .filter((f) => /^tokens-.+\.json$/.test(f))
    .sort();
}

export function readPalette(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(DESIGN_DIR + file, 'utf8')) as Record<string, unknown>;
}

/** Copie de la palette Tinta, lue sur disque. */
export function tinta(): Record<string, unknown> {
  return readPalette('tokens-lienzo-tinta.json');
}

/** Copie de `palette` où la valeur au chemin pointé (`a.b.c`) est remplacée. */
export function patch(
  palette: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const copy = structuredClone(palette);
  const parts = path.split('.');
  let node = copy as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== 'object' || node[part] === null) node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  const last = parts.at(-1) as string;
  if (value === undefined) delete node[last];
  else node[last] = value;
  return copy;
}
