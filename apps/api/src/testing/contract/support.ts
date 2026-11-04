/**
 * Suites de contrat sur l'application RÉELLE (US-038) — TESTS SEULEMENT. Chaque suite démarre
 * `ApiModule` par le harnais d'US-043 (gardes globaux, durcissement HTTP, ordre de main.ts), en
 * ne remplaçant que des adaptateurs, puis confronte chaque réponse à `apps/api/openapi/openapi.json`
 * par `ContractClient`. Données fictives ; aucun réseau externe (127.0.0.1).
 */
import { createHash } from 'node:crypto';
import { BROWSER_HEADERS, startApiHarness } from '../api-harness.js';
import type { ApiHarness, ApiHarnessOverrides, HarnessActor } from '../api-harness.js';
import { CountryConfigService } from '../../modules/cfg/index.js';
import { ContractClient, repositoryContract } from '../openapi-contract.js';

export const contract = repositoryContract();

/** Pays déclarés par la configuration CFG (jamais en constante, ADR-024). */
export const COUNTRIES: readonly string[] = [...new CountryConfigService().config.countries.keys()];
export const FIRST_COUNTRY = COUNTRIES[0] as string;

export interface ContractApp {
  readonly h: ApiHarness;
  readonly api: ContractClient;
  /** En-tête cookie d'un acteur du harnais. */
  cookie(actor: HarnessActor): Record<string, string>;
  /** Empreinte SHA-256 (hex) du jeton de session d'un acteur, telle que la base la reçoit. */
  hash(actor: HarnessActor): string;
}

const opened: ApiHarness[] = [];

export async function startContractApp(overrides: ApiHarnessOverrides = {}): Promise<ContractApp> {
  const h = await startApiHarness(overrides);
  opened.push(h);
  return {
    h,
    api: new ContractClient(contract, `http://127.0.0.1:${h.port}`, BROWSER_HEADERS),
    cookie: (actor) => ({ cookie: `__Host-session=${h.sessions[actor].token}` }),
    hash: (actor) => createHash('sha256').update(h.sessions[actor].token, 'utf8').digest('hex'),
  };
}

/** Ferme toutes les applications ouvertes (à appeler en `afterAll`). */
export async function closeContractApps(): Promise<void> {
  for (const h of opened.splice(0)) await h.close();
}

/** Réunit la couverture de plusieurs clients. */
export function coverageOf(...apps: readonly ContractApp[]): Set<string> {
  return new Set(apps.flatMap((a) => [...a.api.covered]));
}

/** Corps texte : écriture refusée (415) avant tout appel, parade CSRF. */
export function textBody(headers: Record<string, string> = {}): {
  headers: Record<string, string>;
  raw: string;
} {
  return { headers: { ...headers, 'content-type': 'text/plain' }, raw: 'x' };
}

export const REASON = 'Motif de test suffisamment long';
export const ID = '00000000-0000-4000-8000-0000000000a1';
