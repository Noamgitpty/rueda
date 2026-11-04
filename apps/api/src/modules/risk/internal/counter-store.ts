/**
 * Port des compteurs de débit (US-052, ADR-075) et ses deux adaptateurs :
 *
 * - `PgRateCounterStore` : compteurs PARTAGÉS entre instances, en base (migration 0047), par les
 *   commandes `core.risk_cmd_*` (SECURITY DEFINER, `risk_limit_owner`). Un appel = une
 *   instruction en autocommit (ADR-056), sans contexte `app.*` à poser. Délai borné : au-delà de
 *   `timeoutMs`, l'appel est tenu pour indisponible (la requête SQL elle-même finit ou expire côté
 *   base, le client ne l'attend plus) ;
 * - `MemoryRateCounterStore` : mêmes règles en mémoire du processus. Sert aux tests et de REPLI
 *   DÉGRADÉ des routes peu coûteuses (API, recherche, devis) quand la base ne répond pas ; jamais
 *   pour un envoi coûteux (SMS, e-mail, OTP), refusé dans ce cas (fail-closed, abuse-guard.ts).
 *
 * Une méthode qui ne peut pas répondre LÈVE `CounterUnavailableError` : l'appelant décide.
 */

export interface HitInput {
  readonly scope: string;
  /** Empreinte HMAC de 32 octets (key-hasher.ts). */
  readonly keyHash: Buffer;
  /** Pays de la limite ; `null` : limite globale. */
  readonly country: string | null;
  readonly limit: number;
  readonly windowS: number;
  /** Poids de l'événement (1 ; plus pour un client soupçonné d'être un robot). */
  readonly weight: number;
}

export interface HitResult {
  readonly allowed: boolean;
  readonly hits: number;
  readonly retryAfterS: number;
}

export interface SmsReservation {
  readonly allowed: boolean;
  readonly sentToday: number;
  /** Premier refus du jour pour ce pays : l'appelant publie l'alerte. */
  readonly alert: boolean;
}

export type AbuseKind = 'BOT_SUSPECTED' | 'BOT_CHALLENGED';
export type BotSignal = 'REGULAR_RHYTHM' | 'NO_BROWSER_HEADERS' | 'SIGNUP_BURST';

export interface RateCounterStore {
  hit(input: HitInput): Promise<HitResult>;
  reserveSms(country: string, cap: number, critical: boolean): Promise<SmsReservation>;
  recordAbuse(
    kind: AbuseKind,
    scope: string,
    keyHash: Buffer,
    country: string | null,
    signals: readonly BotSignal[],
  ): Promise<void>;
}

export class CounterUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('compteur de débit indisponible', { cause });
    this.name = 'CounterUnavailableError';
  }
}

/** Accès SQL minimal (compatible avec `pg.Pool` et `pg.ClientBase`). */
export interface RiskSqlExecutor {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

export const HIT_SQL =
  'SELECT allowed, hits, retry_after_s FROM core.risk_cmd_hit($1, $2, $3, $4, $5, $6)';
export const SMS_RESERVE_SQL =
  'SELECT allowed, sent_today, alert FROM core.risk_cmd_sms_reserve($1, $2, $3)';
export const RECORD_ABUSE_SQL = 'SELECT core.risk_cmd_record_abuse($1, $2, $3, $4, $5::text[])';

async function bounded<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CounterUnavailableError('délai dépassé')), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } catch (error) {
    throw error instanceof CounterUnavailableError ? error : new CounterUnavailableError(error);
  } finally {
    clearTimeout(timer);
  }
}

export class PgRateCounterStore implements RateCounterStore {
  readonly #db: RiskSqlExecutor;
  readonly #timeoutMs: number;

  constructor(db: RiskSqlExecutor, timeoutMs = 500) {
    this.#db = db;
    this.#timeoutMs = timeoutMs;
  }

  async hit(input: HitInput): Promise<HitResult> {
    const { rows } = await bounded(
      this.#db.query<{ allowed: boolean; hits: number; retry_after_s: number }>(HIT_SQL, [
        input.scope,
        input.keyHash,
        input.country,
        input.limit,
        input.windowS,
        input.weight,
      ]),
      this.#timeoutMs,
    );
    const r = rows[0];
    if (r === undefined) throw new CounterUnavailableError('aucune ligne');
    return { allowed: r.allowed, hits: r.hits, retryAfterS: r.retry_after_s };
  }

  async reserveSms(country: string, cap: number, critical: boolean): Promise<SmsReservation> {
    const { rows } = await bounded(
      this.#db.query<{ allowed: boolean; sent_today: number; alert: boolean }>(SMS_RESERVE_SQL, [
        country,
        cap,
        critical,
      ]),
      this.#timeoutMs,
    );
    const r = rows[0];
    if (r === undefined) throw new CounterUnavailableError('aucune ligne');
    return { allowed: r.allowed, sentToday: r.sent_today, alert: r.alert };
  }

  async recordAbuse(
    kind: AbuseKind,
    scope: string,
    keyHash: Buffer,
    country: string | null,
    signals: readonly BotSignal[],
  ): Promise<void> {
    await bounded(
      this.#db.query(RECORD_ABUSE_SQL, [kind, scope, keyHash, country, [...signals]]),
      this.#timeoutMs,
    );
  }
}

interface Window {
  hits: number;
  end: number;
}

/** Abus journalisé en mémoire (tests). */
export interface MemoryAbuseRecord {
  readonly kind: AbuseKind | 'RATE_LIMITED' | 'SMS_DAILY_CAP_REACHED';
  readonly scope: string;
  readonly keyHash: string;
  readonly country: string | null;
  readonly signals: readonly BotSignal[];
}

/**
 * Même sémantique que la base, à l'horloge `now` (ms) : fenêtre fixe alignée sur l'époque, jour
 * UTC pour le plafond SMS (la base compte, elle, le jour LOCAL du pays). Taille bornée.
 */
export class MemoryRateCounterStore implements RateCounterStore {
  readonly #now: () => number;
  readonly #maxKeys: number;
  readonly #windows = new Map<string, Window>();
  readonly abuse: MemoryAbuseRecord[] = [];

  constructor(now: () => number = Date.now, maxKeys = 100_000) {
    this.#now = now;
    this.#maxKeys = maxKeys;
  }

  async hit(input: HitInput): Promise<HitResult> {
    const now = this.#now();
    const span = input.windowS * 1000;
    const start = Math.floor(now / span) * span;
    const id = `${input.scope}\u0000${input.keyHash.toString('hex')}\u0000${start}`;
    let w = this.#windows.get(id);
    if (w === undefined) {
      this.#evict(now);
      w = { hits: 0, end: start + span };
      this.#windows.set(id, w);
    }
    w.hits += input.weight;
    const allowed = w.hits <= input.limit;
    if (!allowed) {
      this.abuse.push({
        kind: 'RATE_LIMITED',
        scope: input.scope,
        keyHash: input.keyHash.toString('hex'),
        country: input.country,
        signals: [],
      });
    }
    return Promise.resolve({
      allowed,
      hits: w.hits,
      retryAfterS: Math.max(1, Math.ceil((w.end - now) / 1000)),
    });
  }

  async reserveSms(country: string, cap: number, critical: boolean): Promise<SmsReservation> {
    const now = this.#now();
    const day = 86_400_000;
    const start = Math.floor(now / day) * day;
    const id = `sms_country_day\u0000${country}\u0000${start}`;
    const w = this.#windows.get(id) ?? { hits: 0, end: start + day };
    if (!critical && w.hits >= cap) {
      const first = !this.abuse.some((a) => a.kind === 'SMS_DAILY_CAP_REACHED' && a.keyHash === id);
      this.abuse.push({
        kind: 'SMS_DAILY_CAP_REACHED',
        scope: 'sms_country_day',
        keyHash: id,
        country,
        signals: [],
      });
      return Promise.resolve({ allowed: false, sentToday: w.hits, alert: first });
    }
    w.hits += 1;
    this.#windows.set(id, w);
    return Promise.resolve({ allowed: true, sentToday: w.hits, alert: false });
  }

  async recordAbuse(
    kind: AbuseKind,
    scope: string,
    keyHash: Buffer,
    country: string | null,
    signals: readonly BotSignal[],
  ): Promise<void> {
    this.abuse.push({ kind, scope, keyHash: keyHash.toString('hex'), country, signals });
    return Promise.resolve();
  }

  #evict(now: number): void {
    if (this.#windows.size < this.#maxKeys) return;
    for (const [k, w] of this.#windows) if (w.end <= now) this.#windows.delete(k);
    for (const k of this.#windows.keys()) {
      if (this.#windows.size < this.#maxKeys) break;
      this.#windows.delete(k);
    }
  }
}
