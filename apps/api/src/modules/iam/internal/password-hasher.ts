/**
 * Hachage des mots de passe : argon2id (17 §3.1.4 C4, §6.6), format PHC
 * `$argon2id$v=19$m=<KiB>,t=<passes>,p=<lanes>$<sel b64>$<empreinte b64>` (base64 standard sans
 * remplissage). Implémentation : `node:crypto` (argon2 natif de Node ≥ 24.7, aucune dépendance).
 *
 * Paramètres par défaut PROPOSÉS (ADR-052) : m = 64 MiB, t = 3, p = 1, sel 16 octets, empreinte
 * 32 octets — au-dessus du minimum OWASP (m = 19 MiB, t = 2, p = 1) et proches de la seconde
 * recommandation de RFC 9106 §4.
 *
 * La vérification relit les paramètres de la chaîne stockée, BORNÉS (une chaîne hostile ne peut
 * pas imposer un calcul démesuré), et compare en temps constant.
 */
import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import type { BinaryLike } from 'node:crypto';

export interface Argon2idParams {
  /** Mémoire en KiB. */
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly saltLength: number;
  readonly tagLength: number;
}

/** Défauts PROPOSÉS (ADR-052). */
export const DEFAULT_ARGON2ID_PARAMS: Argon2idParams = {
  memoryKiB: 65_536,
  passes: 3,
  parallelism: 1,
  saltLength: 16,
  tagLength: 32,
};

/** Bornes acceptées à la vérification d'une chaîne stockée. */
const LIMITS = {
  memoryKiB: { min: 8, max: 262_144 },
  passes: { min: 1, max: 10 },
  parallelism: { min: 1, max: 16 },
  saltLength: { min: 8, max: 64 },
  tagLength: { min: 16, max: 64 },
} as const;

export interface Argon2idInput {
  readonly message: BinaryLike;
  readonly nonce: BinaryLike;
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly tagLength: number;
  readonly secret?: BinaryLike;
  readonly associatedData?: BinaryLike;
}

/** Primitive argon2id (RFC 9106), asynchrone (pool de threads de Node). */
export function deriveArgon2id(input: Argon2idInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: input.message,
        nonce: input.nonce,
        memory: input.memoryKiB,
        passes: input.passes,
        parallelism: input.parallelism,
        tagLength: input.tagLength,
        ...(input.secret !== undefined ? { secret: input.secret } : {}),
        ...(input.associatedData !== undefined ? { associatedData: input.associatedData } : {}),
      },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

const b64 = (bytes: Buffer): string => bytes.toString('base64').replace(/=+$/, '');

const PHC =
  /^\$argon2id\$v=19\$m=(\d{1,7}),t=(\d{1,3}),p=(\d{1,3})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export interface ParsedPhc {
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

/** Analyse une chaîne PHC argon2id ; `null` si elle est mal formée ou hors bornes. */
export function parsePhc(encoded: string): ParsedPhc | null {
  const match = PHC.exec(encoded);
  if (!match) return null;
  const memoryKiB = Number(match[1]);
  const passes = Number(match[2]);
  const parallelism = Number(match[3]);
  const salt = Buffer.from(match[4] as string, 'base64');
  const hash = Buffer.from(match[5] as string, 'base64');
  const within = (v: number, l: { min: number; max: number }) => v >= l.min && v <= l.max;
  if (
    !within(memoryKiB, LIMITS.memoryKiB) ||
    memoryKiB < 8 * parallelism ||
    !within(passes, LIMITS.passes) ||
    !within(parallelism, LIMITS.parallelism) ||
    !within(salt.length, LIMITS.saltLength) ||
    !within(hash.length, LIMITS.tagLength)
  ) {
    return null;
  }
  return { memoryKiB, passes, parallelism, salt, hash };
}

/**
 * Forme canonique d'un mot de passe avant hachage : NFKC (NIST SP 800-63B §5.1.1.2), PROPOSÉ
 * (ADR-052). Ne JAMAIS changer sans migration des hachages.
 */
export const normalizePassword = (password: string): string => password.normalize('NFKC');

export class Argon2idPasswordHasher {
  readonly #params: Argon2idParams;

  constructor(params: Argon2idParams = DEFAULT_ARGON2ID_PARAMS) {
    this.#params = params;
  }

  /** Chaîne PHC à stocker. Le mot de passe n'est jamais conservé. */
  async hash(password: string): Promise<string> {
    const salt = randomBytes(this.#params.saltLength);
    const p = this.#params;
    const tag = await deriveArgon2id({
      message: Buffer.from(normalizePassword(password), 'utf8'),
      nonce: salt,
      memoryKiB: p.memoryKiB,
      passes: p.passes,
      parallelism: p.parallelism,
      tagLength: p.tagLength,
    });
    return `$argon2id$v=19$m=${p.memoryKiB},t=${p.passes},p=${p.parallelism}$${b64(salt)}$${b64(tag)}`;
  }

  /** Vérification en temps constant ; `false` pour toute chaîne mal formée ou hors bornes. */
  async verify(encoded: string, password: string): Promise<boolean> {
    const parsed = parsePhc(encoded);
    if (!parsed) return false;
    const tag = await deriveArgon2id({
      message: Buffer.from(normalizePassword(password), 'utf8'),
      nonce: parsed.salt,
      memoryKiB: parsed.memoryKiB,
      passes: parsed.passes,
      parallelism: parsed.parallelism,
      tagLength: parsed.hash.length,
    });
    return timingSafeEqual(tag, parsed.hash);
  }
}
