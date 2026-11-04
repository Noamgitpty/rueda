/**
 * Configuration du travailleur (US-003, ADR-078) : variables propres au processus `worker.ts`
 * (docs/ops/ENV_VARS.md). Fonctions pures, testées sans base.
 */
const DEFAULT_POOL_MAX = 5;

/** Nom de marque des messages (donnée de thème, DEC-MARQUE) : obligatoire, jamais une constante. */
export function parseBrandName(value: string | undefined): string {
  const v = value?.trim() ?? '';
  if (v === '' || v.length > 60 || /\p{Cc}/u.test(v)) {
    throw new Error('RUEDA_BRAND_NAME absente ou invalide (1 à 60 caractères, sans contrôle)');
  }
  return v;
}

/** Taille du pool : 2 connexions au moins (un balayeur tient son bail pendant ses réparations). */
export function parsePoolMax(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_POOL_MAX;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2 || n > 50) {
    throw new Error('RUEDA_WORKER_POOL_MAX : entier de 2 à 50 attendu');
  }
  return n;
}
