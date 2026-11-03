/**
 * Contrôle de la tzdata au démarrage (17 §1.3 « Contrôle de démarrage » ; ADR-019 ; OQ-BR-20 ;
 * EC-33 ; US-013). Les attentes viennent des données (`countries.json`, `timeZoneChecks`), jamais
 * du code : chaque pays configuré a les siennes, et le contrôle couvre son fuseau.
 *
 * Deux sources de tzdata : le runtime Node (`Intl`, ICU embarqué) et PostgreSQL. Le runtime est
 * contrôlé au démarrage de l'API et du travailleur ; PostgreSQL par `checkPostgresTimeZoneData`,
 * avec une fonction de requête fournie par l'appelant (branchée par la story qui connecte l'API à
 * la base ; d'ici là, prouvée par le test d'intégration de `packages/db`).
 */
import { ConfigError } from './errors.js';
import type { CountryConfig } from './model.js';

export interface TimeZoneExpectation {
  readonly country: string;
  readonly timeZone: string;
  readonly instant: string;
  readonly offsetMinutes: number;
}

export function timeZoneExpectations(config: CountryConfig): TimeZoneExpectation[] {
  return [...config.countries.values()].flatMap((entry) =>
    entry.timeZoneChecks.map((check) => ({
      country: entry.code,
      timeZone: entry.timeZone,
      instant: check.instant,
      offsetMinutes: check.offsetMinutes,
    })),
  );
}

const OFFSET = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/;

/** Décalage UTC (minutes, signé) de `timeZone` à `instant`, selon la tzdata du runtime. */
export function runtimeUtcOffsetMinutes(instant: string, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(instant))
    .find((p) => p.type === 'timeZoneName')?.value;
  const match = name === undefined ? null : OFFSET.exec(name);
  if (!match)
    throw new ConfigError(
      'TZDATA_MISMATCH',
      `décalage illisible pour ${timeZone} : ${String(name)}`,
    );
  const [, sign, hours, minutes] = match;
  if (sign === undefined) return 0;
  const total = Number(hours) * 60 + Number(minutes ?? '0');
  return sign === '-' ? -total : total;
}

function report(source: string, failures: string[]): void {
  if (failures.length > 0) {
    throw new ConfigError(
      'TZDATA_MISMATCH',
      `tzdata ${source} non conforme (17 §1.3, ADR-019)`,
      failures,
    );
  }
}

/** Contrôle du runtime ; lève `TZDATA_MISMATCH` en listant chaque écart. */
export function checkRuntimeTimeZoneData(config: CountryConfig): void {
  const failures: string[] = [];
  for (const e of timeZoneExpectations(config)) {
    let actual: number | string;
    try {
      actual = runtimeUtcOffsetMinutes(e.instant, e.timeZone);
    } catch (error) {
      actual = error instanceof Error ? error.message : String(error);
    }
    if (actual !== e.offsetMinutes) {
      failures.push(
        `${e.timeZone} à ${e.instant} : ${String(actual)} au lieu de ${e.offsetMinutes} min`,
      );
    }
  }
  report('du runtime', failures);
}

/**
 * Requête PostgreSQL du décalage, paramètres `$1` = instant, `$2` = fuseau. Calcul côté base :
 * heure locale moins heure UTC du même instant, en minutes.
 */
export const POSTGRES_OFFSET_SQL =
  "SELECT (EXTRACT(EPOCH FROM (($1::timestamptz AT TIME ZONE $2) - ($1::timestamptz AT TIME ZONE 'UTC'))) / 60)::int AS offset_minutes";

export type OffsetQuery = (sql: string, params: [string, string]) => Promise<number>;

/** Contrôle de la tzdata de PostgreSQL, par la fonction de requête de l'appelant. */
export async function checkPostgresTimeZoneData(
  config: CountryConfig,
  query: OffsetQuery,
): Promise<void> {
  const failures: string[] = [];
  for (const e of timeZoneExpectations(config)) {
    const actual = await query(POSTGRES_OFFSET_SQL, [e.instant, e.timeZone]);
    if (actual !== e.offsetMinutes) {
      failures.push(`${e.timeZone} à ${e.instant} : ${actual} au lieu de ${e.offsetMinutes} min`);
    }
  }
  report('de PostgreSQL', failures);
}
