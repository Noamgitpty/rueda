/**
 * Clés de données par sujet : création, déroulement par le KMS et cache mémoire (US-009 ;
 * 17 §3.1.3 points 1, 2 et 9 ; ADR-026 ; ADR-051).
 *
 * - Une DEK par sujet (`core.audit_subject_key`), créée au premier besoin : 32 octets aléatoires,
 *   enveloppés par le port `KeyWrapper`, insérés avec `ON CONFLICT DO NOTHING` puis relus (un
 *   écrivain concurrent gagne, tout le monde utilise SA clé).
 * - Cache en mémoire du processus, jamais sur disque, durée `subject_dek_cache_ttl_s` (PROPOSÉ
 *   300 s, 17 §3.1.3 point 9 ; paramètre CFG à brancher avec US-013) ; une DEK évincée est
 *   remise à zéro.
 * - Fail-closed : KMS injoignable et clé absente du cache ⇒ `WITHHELD` (l'appelant écrit sa ligne
 *   sans la donnée C2) ; clé détruite ⇒ `DESTROYED` (jamais de nouvelle donnée C2 pour un sujet
 *   effacé) ; aucune DEK n'est jamais journalisée.
 */
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { DEK_BYTES, subjectLabel } from './envelope.ts';
import type { SubjectRef } from './envelope.ts';
import { KeyWrapperUnavailableError } from './key-wrapper.ts';
import type { KeyWrapper } from './key-wrapper.ts';

/** Exécuteur SQL minimal (connexion `pg`, transaction ouverte par l'appelant). */
export type Queryable = Pick<pg.ClientBase, 'query'>;

/** `subject_dek_cache_ttl_s` (PROPOSÉ, 17 §3.1.3 point 9), en millisecondes. */
export const DEFAULT_DEK_CACHE_TTL_MS = 300_000;

export type DekResult =
  | { readonly status: 'OK'; readonly dek: Buffer }
  /** KMS injoignable, clé absente du cache : écrire sans la donnée C2 (`c2_withheld`). */
  | { readonly status: 'WITHHELD' }
  /** Sujet effacé (crypto-shredding) : la donnée C2 n'est plus ni lisible ni écrite. */
  | { readonly status: 'DESTROYED' }
  /** Aucune clé pour ce sujet et création non demandée (lecture). */
  | { readonly status: 'ABSENT' };

export interface SubjectKeyStoreOptions {
  readonly cacheTtlMs?: number;
  /** Horloge du cache (tests). Le cache n'a aucun rôle métier : l'horloge de la base n'y sert pas. */
  readonly clock?: () => number;
}

interface CacheEntry {
  readonly dek: Buffer;
  readonly expiresAt: number;
}

interface SubjectKeyRow {
  wrapped_dek: Buffer | null;
  kms_key_id: string;
  destroyed_at: Date | null;
}

const SELECT_KEY = `SELECT wrapped_dek, kms_key_id, destroyed_at
                      FROM core.audit_subject_key
                     WHERE subject_type = $1 AND subject_id = $2`;
const INSERT_KEY = `INSERT INTO core.audit_subject_key (subject_type, subject_id, wrapped_dek, kms_key_id)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (subject_type, subject_id) DO NOTHING`;

export class SubjectKeyStore {
  readonly #wrapper: KeyWrapper;
  readonly #ttlMs: number;
  readonly #clock: () => number;
  readonly #cache = new Map<string, CacheEntry>();

  constructor(wrapper: KeyWrapper, options: SubjectKeyStoreOptions = {}) {
    this.#wrapper = wrapper;
    this.#ttlMs = options.cacheTtlMs ?? DEFAULT_DEK_CACHE_TTL_MS;
    this.#clock = options.clock ?? Date.now;
    if (!(this.#ttlMs >= 0)) throw new RangeError('cacheTtlMs doit être ≥ 0');
  }

  /**
   * DEK du sujet. `create` : en créer une si le sujet n'en a pas (écriture d'une donnée C2).
   * La base est TOUJOURS relue (destruction prise en compte immédiatement par ce processus) ; le
   * cache évite seulement l'appel au KMS.
   */
  async dekFor(db: Queryable, subject: SubjectRef, mode: 'create' | 'read'): Promise<DekResult> {
    let row = await this.#select(db, subject);
    if (row === undefined) {
      if (mode === 'read') return { status: 'ABSENT' };
      const created = await this.#create(db, subject);
      if (created !== 'OK') return { status: created };
      row = await this.#select(db, subject);
      if (row === undefined) throw new Error('clé de sujet introuvable après sa création');
    }
    if (row.destroyed_at !== null || row.wrapped_dek === null) {
      this.#evict(subject);
      return { status: 'DESTROYED' };
    }
    const cached = this.#cached(subject);
    if (cached !== undefined) return { status: 'OK', dek: cached };
    try {
      const dek = await this.#wrapper.unwrap(row.wrapped_dek, row.kms_key_id, subject);
      this.#remember(subject, dek);
      return { status: 'OK', dek };
    } catch (error) {
      if (error instanceof KeyWrapperUnavailableError) return { status: 'WITHHELD' };
      throw error;
    }
  }

  /** Vide le cache et remet les DEK à zéro (arrêt du processus, tests). */
  clear(): void {
    for (const entry of this.#cache.values()) entry.dek.fill(0);
    this.#cache.clear();
  }

  async #select(db: Queryable, subject: SubjectRef): Promise<SubjectKeyRow | undefined> {
    const { rows } = await db.query<SubjectKeyRow>(SELECT_KEY, [subject.type, subject.id]);
    return rows[0];
  }

  async #create(db: Queryable, subject: SubjectRef): Promise<'OK' | 'WITHHELD'> {
    const dek = randomBytes(DEK_BYTES);
    try {
      let wrapped: Buffer;
      try {
        wrapped = await this.#wrapper.wrap(dek, subject);
      } catch (error) {
        if (error instanceof KeyWrapperUnavailableError) return 'WITHHELD';
        throw error;
      }
      await db.query(INSERT_KEY, [subject.type, subject.id, wrapped, this.#wrapper.keyId]);
      return 'OK';
    } finally {
      // la DEK retenue est celle relue en base (un écrivain concurrent a pu gagner)
      dek.fill(0);
    }
  }

  #cached(subject: SubjectRef): Buffer | undefined {
    const key = subjectLabel(subject);
    const entry = this.#cache.get(key);
    if (entry === undefined) return undefined;
    if (this.#clock() >= entry.expiresAt) {
      entry.dek.fill(0);
      this.#cache.delete(key);
      return undefined;
    }
    return Buffer.from(entry.dek);
  }

  #remember(subject: SubjectRef, dek: Buffer): void {
    if (this.#ttlMs === 0) return;
    this.#evict(subject);
    this.#cache.set(subjectLabel(subject), {
      dek: Buffer.from(dek),
      expiresAt: this.#clock() + this.#ttlMs,
    });
  }

  #evict(subject: SubjectRef): void {
    const key = subjectLabel(subject);
    this.#cache.get(key)?.dek.fill(0);
    this.#cache.delete(key);
  }
}
