/**
 * Empreintes des clés de compteur (US-052, ADR-075) : HMAC-SHA-256 sous une clé de configuration
 * `RUEDA_RATE_LIMIT_KEY` (secret géré, hexadécimal, 32 à 64 octets ; jamais commitée, jamais
 * journalisée ; docs/ops/ENV_VARS.md). Aucun téléphone, e-mail ni IP n'entre en clair dans la base
 * ou la mémoire du limiteur ; sans la clé, une empreinte ne se retrouve pas par dictionnaire.
 *
 * Clé absente : refus de démarrer en production (fail-closed) ; hors production, clé aléatoire
 * propre au processus (compteurs non partagés entre instances, ce qui suffit en développement).
 * Clé mal formée : refus de démarrer partout.
 *
 * Normalisation avant hachage : e-mail en minuscules sans espaces ; numéro E.164 et indicatif pays
 * (US-104) sans espaces ;
 * IPv6 réduite à son préfixe /64 (un client qui change d'adresse dans son /64 garde la même
 * clé) ; IPv4 telle quelle (préfixe `::ffff:` retiré).
 *
 * Rotation sans coupure (US-051, ADR-082 ; docs/ops/SECRET_ROTATION.md) : le temps d'une rotation,
 * `RUEDA_RATE_LIMIT_KEY_PREVIOUS` porte l'ancienne clé. Le garde compte alors chaque événement sous
 * les DEUX empreintes et refuse si l'une dépasse : les instances encore sur l'ancienne clé et les
 * nouvelles partagent le compteur de l'ancienne, aucune limite n'est remise à zéro par la rotation.
 * Retirée après la plus longue fenêtre de comptage (24 h), l'ancienne clé n'a plus aucun effet.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

export const RATE_LIMIT_KEY_MIN_BYTES = 32;
export const RATE_LIMIT_KEY_MAX_BYTES = 64;

export type KeyKind = 'ip' | 'phone' | 'email' | 'account' | 'prefix';

export function parseRateLimitKey(raw: string | undefined, production: boolean): Buffer {
  if (raw === undefined || raw === '') {
    if (production) {
      throw new Error('RUEDA_RATE_LIMIT_KEY absente : démarrage refusé en production (US-052)');
    }
    return randomBytes(RATE_LIMIT_KEY_MIN_BYTES);
  }
  const ok =
    /^[0-9a-fA-F]+$/.test(raw) &&
    raw.length % 2 === 0 &&
    raw.length / 2 >= RATE_LIMIT_KEY_MIN_BYTES &&
    raw.length / 2 <= RATE_LIMIT_KEY_MAX_BYTES;
  if (!ok) {
    throw new Error(
      `RUEDA_RATE_LIMIT_KEY : ${RATE_LIMIT_KEY_MIN_BYTES} à ${RATE_LIMIT_KEY_MAX_BYTES} octets en hexadécimal attendus`,
    );
  }
  return Buffer.from(raw, 'hex');
}

/** Forme canonique d'une adresse IP pour le comptage (IPv6 : préfixe /64). */
export function normalizeIp(ip: string): string {
  const v = ip.trim().toLowerCase();
  if (v.startsWith('::ffff:') && isIPv4(v.slice(7))) return v.slice(7);
  if (isIPv4(v)) return v;
  if (!isIPv6(v)) return v;
  const [head = '', tail = ''] = v.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === '' ? [] : tail.split(':');
  const groups = v.includes('::')
    ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

function normalize(kind: KeyKind, value: string): string {
  switch (kind) {
    case 'ip':
      return normalizeIp(value);
    case 'email':
      return value.trim().toLowerCase();
    case 'phone':
      return value.replace(/\s+/g, '');
    case 'account':
      return value.trim().toLowerCase();
    case 'prefix':
      return value.replace(/\s+/g, '');
  }
}

/**
 * Ancienne clé d'une rotation (`RUEDA_RATE_LIMIT_KEY_PREVIOUS`) : absente ⇒ `null` ; même format
 * que la clé courante (mal formée : refus de démarrer partout) ; égale à la courante ⇒ `null`.
 */
export function parsePreviousRateLimitKey(raw: string | undefined, current: Buffer): Buffer | null {
  if (raw === undefined || raw === '') return null;
  const ok =
    /^[0-9a-fA-F]+$/.test(raw) &&
    raw.length % 2 === 0 &&
    raw.length / 2 >= RATE_LIMIT_KEY_MIN_BYTES &&
    raw.length / 2 <= RATE_LIMIT_KEY_MAX_BYTES;
  if (!ok) {
    throw new Error(
      `RUEDA_RATE_LIMIT_KEY_PREVIOUS : ${RATE_LIMIT_KEY_MIN_BYTES} à ${RATE_LIMIT_KEY_MAX_BYTES} octets en hexadécimal attendus`,
    );
  }
  const previous = Buffer.from(raw, 'hex');
  return previous.equals(current) ? null : previous;
}

function digest(key: Buffer, kind: KeyKind, value: string): Buffer {
  return createHmac('sha256', key)
    .update(`${kind}\u0000${normalize(kind, value)}`, 'utf8')
    .digest();
}

export class RateKeyHasher {
  readonly #keys: readonly Buffer[];

  /** `previous` : ancienne clé, le temps d'une rotation (US-051). */
  constructor(key: Buffer, previous: Buffer | null = null) {
    if (key.length < RATE_LIMIT_KEY_MIN_BYTES) throw new Error('clé de débit trop courte');
    if (previous !== null && previous.length < RATE_LIMIT_KEY_MIN_BYTES) {
      throw new Error('ancienne clé de débit trop courte');
    }
    this.#keys =
      previous === null || previous.equals(key)
        ? [Buffer.from(key)]
        : [Buffer.from(key), Buffer.from(previous)];
  }

  /** Vrai pendant une rotation (deux clés). */
  get rotating(): boolean {
    return this.#keys.length > 1;
  }

  /** Empreinte de 32 octets de (genre, valeur normalisée), sous la clé COURANTE. */
  hash(kind: KeyKind, value: string): Buffer {
    return digest(this.#keys[0] as Buffer, kind, value);
  }

  /** Empreintes sous chaque clé (courante d'abord, puis l'ancienne pendant une rotation). */
  hashes(kind: KeyKind, value: string): Buffer[] {
    return this.#keys.map((k) => digest(k, kind, value));
  }
}
