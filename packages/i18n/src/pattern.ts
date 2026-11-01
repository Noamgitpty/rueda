/** Motif d'un emplacement `{nom}` dans un gabarit de format ou de message. */
export const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export class MissingVariableError extends Error {
  override readonly name = 'MissingVariableError';
}

/** Noms des emplacements d'un gabarit, dans l'ordre, sans doublon. */
export function placeholdersOf(pattern: string): string[] {
  return [...new Set([...pattern.matchAll(PLACEHOLDER)].map((m) => m[1] as string))];
}

/**
 * Remplace chaque `{nom}` par sa valeur. Une variable absente est une erreur : jamais de « {6} »
 * affiché au client (17 §1.4, EV-0014). Les valeurs ne sont pas réinterprétées.
 */
export function fillPattern(pattern: string, values: Readonly<Record<string, string>>): string {
  return pattern.replace(PLACEHOLDER, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new MissingVariableError(`Variable « ${name} » manquante pour « ${pattern} ».`);
    }
    return value;
  });
}
