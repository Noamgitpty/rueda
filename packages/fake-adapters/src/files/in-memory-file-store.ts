/**
 * FAKE du port `FileStore` (module AUD ; port défini dans `@rueda/db/audit`, US-009 ; 17 §5
 * « Stockage objet » ; US-020). Déplacé de `@rueda/db/testing` (revue d'architecture US-009,
 * constat 2) ; garde centrale `assertFakeAllowed` (revue sécurité US-009, constat 11).
 *
 * Contrat du port : **création seule** (`put` sur une clé existante ⇒ `CONFLICT`, l'objet existant
 * reste intact) ; les échecs sont des valeurs (`UNAVAILABLE`, `TIMEOUT`, `NOT_FOUND`), si bien que
 * ce paquet n'importe rien de `@rueda/db` (pas de cycle de paquets, ADR-058).
 *
 * Cas difficiles (scénarios `put` / `get`) : panne, délai, issue inconnue (`TIMEOUT_AFTER` : l'objet
 * est déposé mais l'appelant voit `TIMEOUT`), et **doublon** sur `put` (`DUPLICATE` : la requête
 * part deux fois, la seconde rencontre l'objet de la première et l'appelant reçoit `CONFLICT`
 * alors que SON objet est en place : il ne doit pas en conclure à une collision d'autrui).
 * `REFUSE` vaut `UNAVAILABLE` (droits ou quota refusés par le service).
 */
import { assertFakeAllowed } from '../guard.ts';
import type { EnvironmentVariables } from '../guard.ts';
import { FakeClock } from '../core/clock.ts';
import { Script } from '../core/script.ts';

export type FilePutResult =
  | { readonly status: 'STORED' }
  | { readonly status: 'CONFLICT' }
  | { readonly status: 'UNAVAILABLE' }
  | { readonly status: 'TIMEOUT' };

export type FileGetResult =
  | { readonly status: 'FOUND'; readonly body: Buffer }
  | { readonly status: 'NOT_FOUND' }
  | { readonly status: 'UNAVAILABLE' }
  | { readonly status: 'TIMEOUT' };

export interface InMemoryFileStoreOptions {
  /** Horloge des délais simulés (défaut : instant fixe, le stockage n'en dépend pas autrement). */
  readonly clock?: FakeClock;
  readonly env?: EnvironmentVariables;
}

const EPOCH = '2000-01-01T00:00:00Z';

export class InMemoryFileStore {
  readonly script = new Script<'put' | 'get'>();
  readonly clock: FakeClock;
  readonly #objects = new Map<string, Buffer>();

  constructor(options: InMemoryFileStoreOptions = {}) {
    assertFakeAllowed('InMemoryFileStore', options.env);
    this.clock = options.clock ?? new FakeClock(EPOCH);
  }

  async put(bucket: string, key: string, body: Buffer): Promise<FilePutResult> {
    const step = this.script.next('put');
    if (step.kind === 'UNAVAILABLE' || step.kind === 'REFUSE') return { status: 'UNAVAILABLE' };
    if (step.kind === 'TIMEOUT_BEFORE') return { status: 'TIMEOUT' };
    if (step.kind === 'DELAY') await this.clock.sleep(step.ms);
    const at = `${bucket}/${key}`;
    if (this.#objects.has(at)) return { status: 'CONFLICT' };
    this.#objects.set(at, Buffer.from(body));
    if (step.kind === 'TIMEOUT_AFTER') return { status: 'TIMEOUT' };
    if (step.kind === 'DUPLICATE') return { status: 'CONFLICT' };
    return { status: 'STORED' };
  }

  async get(bucket: string, key: string): Promise<FileGetResult> {
    const step = this.script.next('get');
    if (step.kind === 'UNAVAILABLE' || step.kind === 'REFUSE') return { status: 'UNAVAILABLE' };
    if (step.kind === 'TIMEOUT_BEFORE' || step.kind === 'TIMEOUT_AFTER')
      return { status: 'TIMEOUT' };
    if (step.kind === 'DELAY') await this.clock.sleep(step.ms);
    const body = this.#objects.get(`${bucket}/${key}`);
    return body === undefined
      ? { status: 'NOT_FOUND' }
      : { status: 'FOUND', body: Buffer.from(body) };
  }

  // --- Pilotage par le test -------------------------------------------------------------------

  /** Octets tels que stockés (preuve que le clair n'y figure pas). */
  raw(bucket: string, key: string): Buffer | undefined {
    const body = this.#objects.get(`${bucket}/${key}`);
    return body === undefined ? undefined : Buffer.from(body);
  }

  /** Inverse un octet de l'objet stocké (altération). */
  corrupt(bucket: string, key: string, offset = 0): void {
    const body = this.#objects.get(`${bucket}/${key}`);
    if (body === undefined || body.length === 0) throw new Error('objet absent ou vide');
    const at = Math.min(offset, body.length - 1);
    body[at] = (body[at] ?? 0) ^ 0xff;
  }

  /** Perte d'un objet (suppression hors application). */
  lose(bucket: string, key: string): void {
    this.#objects.delete(`${bucket}/${key}`);
  }
}
