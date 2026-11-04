/**
 * Tableau de sécurité (US-052, critère 4) : abus agrégés par heure, lus par la console interne
 * (SUP) sous la permission `security.read_abuse` (ADMIN, SUPERADMIN ; PROPOSÉ), session élevée par
 * TOTP. La base relit l'acteur depuis l'empreinte du jeton, vérifie la permission sur le pays
 * demandé et journalise les refus (`core.risk_staff_abuse_board`, migration 0047). Aucune
 * empreinte ni donnée personnelle n'est rendue : genre, portée, heure, occurrences, nombre de
 * clients distincts et signaux.
 */
import type { RiskSqlExecutor } from './counter-store.js';

export interface AbuseBoardRow {
  readonly kind: string;
  readonly scope: string;
  readonly country: string | null;
  readonly bucketStart: Date;
  readonly occurrences: number;
  readonly distinctClients: number;
  readonly signals: readonly string[];
  readonly lastAt: Date;
}

export interface AbuseBoardStore {
  /** `country` null : lignes sans pays (permission exigée sur tous les pays déclarés). */
  read(tokenHash: Buffer, country: string | null, hours: number): Promise<AbuseBoardRow[]>;
}

/** Lecture refusée par la base (US-043) : la console répond 401 / 403, jamais un 200 vide. */
export class AbuseBoardAccessError extends Error {
  override readonly name = 'AbuseBoardAccessError';
  readonly outcome: 'AUTH_REQUIRED' | 'MFA_REQUIRED' | 'FORBIDDEN';
  constructor(outcome: 'AUTH_REQUIRED' | 'MFA_REQUIRED' | 'FORBIDDEN') {
    super(outcome);
    this.outcome = outcome;
  }
}

export const ABUSE_BOARD_SQL =
  'SELECT kind, scope, country_code, bucket_start, occurrences::text, distinct_keys::text,' +
  ' signals, last_at FROM core.risk_staff_abuse_board($1, $2, $3)';

export class PgAbuseBoardStore implements AbuseBoardStore {
  readonly #db: RiskSqlExecutor;

  constructor(db: RiskSqlExecutor) {
    this.#db = db;
  }

  async read(tokenHash: Buffer, country: string | null, hours: number): Promise<AbuseBoardRow[]> {
    const { rows } = await this.#db.query<{
      kind: string;
      scope: string;
      country_code: string | null;
      bucket_start: Date;
      occurrences: string;
      distinct_keys: string;
      signals: string[];
      last_at: Date;
    }>(ABUSE_BOARD_SQL, [tokenHash, country, hours]);
    if (rows.length === 0) {
      // refus (journalisé par la lecture) ou tableau vide ? Issue d'accès de 0049 (US-043) :
      // 401 / 403 au lieu d'un 200 vide (16 ADM-001) ; sans pays : tous les pays déclarés.
      const access = await this.#db.query<{ outcome: string }>(
        'SELECT core.iam_staff_read_access($1, $2, $3) AS outcome',
        [tokenHash, 'security.read_abuse', country ?? 'ALL'],
      );
      const outcome = access.rows[0]?.outcome;
      if (outcome !== 'OK') {
        throw new AbuseBoardAccessError(
          outcome === 'AUTH_REQUIRED' || outcome === 'MFA_REQUIRED' ? outcome : 'FORBIDDEN',
        );
      }
    }
    return rows.map((r) => ({
      kind: r.kind,
      scope: r.scope,
      country: r.country_code,
      bucketStart: r.bucket_start,
      occurrences: Number(r.occurrences),
      distinctClients: Number(r.distinct_keys),
      signals: r.signals,
      lastAt: r.last_at,
    }));
  }
}
