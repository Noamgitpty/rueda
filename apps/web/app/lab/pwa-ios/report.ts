/**
 * Format des résultats du laboratoire : un JSON lisible, copiable et joint à la grille de
 * docs/qa/US-026-protocole-pwa-ios.md. Logique pure, testée en unitaire.
 */
export const REPORT_SCHEMA = 'rueda.lab.pwa-ios/1';

export const LAB_TEST_IDS = [
  'environment',
  'camera-live',
  'file-input',
  'storage-persist',
  'storage-marker',
  'offline-queue',
  'geolocation',
  'service-worker',
  'background-sync',
  'install',
] as const;

export type LabTestId = (typeof LAB_TEST_IDS)[number];

/** pass : critère tenu ; fail : critère en échec ; warn : à risque ; info : relevé sans verdict. */
export type LabStatus = 'pass' | 'fail' | 'warn' | 'info';

export interface LabResult {
  readonly test: LabTestId;
  readonly status: LabStatus;
  readonly at: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface LabReport {
  readonly schema: typeof REPORT_SCHEMA;
  readonly generatedAt: string;
  readonly userAgent: string;
  readonly iosVersionFromUserAgent: string | null;
  readonly summary: Readonly<Record<LabTestId, LabStatus | 'not-run'>>;
  readonly results: readonly LabResult[];
}

/**
 * Version d'iOS lue dans l'agent utilisateur (« iPhone OS 17_4 » → « 17.4 »). Indicative
 * seulement : Safari peut figer cette valeur ; le protocole demande la version lue dans Réglages.
 */
export function parseIosVersion(userAgent: string): string | null {
  const match = /(?:iPhone|iPad|iPod)[^)]*?OS (\d+)[_.](\d+)(?:[_.](\d+))?/.exec(userAgent);
  if (match === null) return null;
  return [match[1], match[2], match[3]].filter((p) => p !== undefined).join('.');
}

export function buildReport(input: {
  readonly results: Readonly<Partial<Record<LabTestId, LabResult>>>;
  readonly userAgent: string;
  readonly now: Date;
}): LabReport {
  const summary = {} as Record<LabTestId, LabStatus | 'not-run'>;
  const results: LabResult[] = [];
  for (const id of LAB_TEST_IDS) {
    const result = input.results[id];
    summary[id] = result?.status ?? 'not-run';
    if (result !== undefined) results.push(result);
  }
  return {
    schema: REPORT_SCHEMA,
    generatedAt: input.now.toISOString(),
    userAgent: input.userAgent,
    iosVersionFromUserAgent: parseIosVersion(input.userAgent),
    summary,
    results,
  };
}

export function toPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Âge en jours d'un témoin de stockage écrit plus tôt (test de purge). */
export function markerAgeDays(writtenAtIso: string, now: Date): number {
  const written = Date.parse(writtenAtIso);
  if (Number.isNaN(written)) throw new RangeError(`date invalide : ${writtenAtIso}`);
  return Math.floor(((now.getTime() - written) / 86_400_000) * 10) / 10;
}

/** Durée sans visite après laquelle Safari peut effacer le stockage d'un site (7 jours) + 1. */
export const PURGE_TEST_MIN_DAYS = 8;

/**
 * Verdict du test de purge. Le témoin est écrit au même instant à plusieurs endroits (`places`) :
 * - aucun témoin : `warn` (purgé, ou jamais écrit : comparer avec la date notée au jour 0) ;
 * - une partie seulement : `fail` (purge partielle, certain) ;
 * - tous, depuis au moins `minDays` jours : `pass` ; tous mais trop récents : `info` (trop tôt).
 */
export function purgeVerdict(input: {
  readonly found: readonly { readonly where: string; readonly ageDays: number }[];
  readonly places: readonly string[];
  readonly minDays: number;
}): LabStatus {
  if (input.found.length === 0) return 'warn';
  const missing = input.places.filter((w) => !input.found.some((f) => f.where === w));
  if (missing.length > 0) return 'fail';
  return input.found.every((f) => f.ageDays >= input.minDays) ? 'pass' : 'info';
}
