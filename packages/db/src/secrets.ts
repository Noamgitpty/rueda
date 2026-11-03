/**
 * Masquage des secrets dans les messages (CLAUDE.md « Interdits » ; ADR-043).
 *
 * Les mots de passe ne sont jamais placés dans une URL de connexion : le harnais passe des
 * objets de configuration. Ces fonctions protègent quand même toute sortie (erreurs, journaux)
 * contre une fuite accidentelle.
 */

export const MASK = '***';

/** Remplace le mot de passe éventuel d'une URL `postgres://user:motdepasse@hôte/…` par `***`. */
export function maskConnectionString(text: string): string {
  return text.replace(
    /\b(postgres(?:ql)?:\/\/[^:/?#@\s]*):([^@/?#\s]*)@/gi,
    (_match, prefix: string) => `${prefix}:${MASK}@`,
  );
}

/** Remplace chaque occurrence des secrets donnés, puis masque les URL de connexion. */
export function redactSecrets(text: string, secrets: Iterable<string>): string {
  let out = text;
  // Les plus longs d'abord : un secret qui en contient un autre est masqué en entier.
  const sorted = [...secrets].filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
  for (const secret of sorted) out = out.split(secret).join(MASK);
  return maskConnectionString(out);
}

/**
 * Copie d'une erreur dont le message et la pile sont expurgés. Le code PostgreSQL (`code`)
 * est conservé ; les autres champs (`detail`, `where`…) sont expurgés aussi.
 */
export function redactError(error: unknown, secrets: Iterable<string>): Error {
  const list = [...secrets];
  const source = error instanceof Error ? error : new Error(String(error));
  const copy = new Error(redactSecrets(source.message, list));
  copy.name = source.name;
  copy.stack = redactSecrets(source.stack ?? copy.message, list);
  const extra = source as unknown as Record<string, unknown>;
  for (const key of ['code', 'detail', 'hint', 'where', 'routine', 'severity']) {
    const value = extra[key];
    if (typeof value === 'string') {
      (copy as unknown as Record<string, unknown>)[key] = redactSecrets(value, list);
    }
  }
  return copy;
}
