/**
 * Tests de contrat d'API (US-041, 19 §1.8) — TESTS SEULEMENT (exclu de la compilation de
 * production : `src/**\/testing/**`). Confronte une réponse HTTP réelle au contrat OpenAPI 3.1
 * `apps/api/openapi/openapi.json` :
 *
 * 1. l'opération (méthode + gabarit de chemin) existe ;
 * 2. le statut est déclaré (pas de `default` : un code non déclaré échoue) ;
 * 3. le type de contenu est déclaré, ou la réponse est vide si aucun contenu n'est déclaré ;
 * 4. le corps JSON valide le schéma (JSON Schema 2020-12, Ajv strict, `additionalProperties`
 *    respecté), dont les codes d'erreur stables (`const` / `enum` de 16 A.8) ;
 * 5. les en-têtes `required: true` sont présents et valident leur schéma.
 *
 * Toute violation lève `ContractViolation` avec la liste des écarts : le test échoue (critère 1).
 * Aucune dépendance au réseau externe : les applications testées écoutent sur 127.0.0.1.
 */
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv/dist/2020.js';

/** Sous-ensemble d'OpenAPI 3.1 lu par le harnais. */
interface Reference {
  readonly $ref: string;
}
interface HeaderObject {
  readonly required?: boolean;
  readonly schema?: Record<string, unknown>;
}
interface MediaTypeObject {
  readonly schema?: Record<string, unknown>;
}
interface ResponseObject {
  readonly description?: string;
  readonly headers?: Readonly<Record<string, HeaderObject | Reference>>;
  readonly content?: Readonly<Record<string, MediaTypeObject>>;
}
interface OperationObject {
  readonly operationId?: string;
  readonly responses?: Readonly<Record<string, ResponseObject | Reference>>;
}
export interface OpenApiDocument {
  readonly openapi: string;
  readonly paths: Readonly<Record<string, Readonly<Record<string, OperationObject>>>>;
  readonly components?: {
    readonly schemas?: Readonly<Record<string, Record<string, unknown>>>;
    readonly responses?: Readonly<Record<string, ResponseObject>>;
    readonly headers?: Readonly<Record<string, HeaderObject>>;
  };
  readonly 'x-rueda-pending'?: readonly string[];
  /**
   * Réponses TRANSVERSES (US-038) : produites par le durcissement HTTP ou la garde anti-abus
   * globale, avant ou autour de toute route (403 défi anti-robot, 413, 429, 500, 503). Une réponse
   * observée est conforme si elle valide la réponse déclarée par l'opération OU la réponse
   * transverse de même statut.
   */
  readonly 'x-rueda-transverse-responses'?: Readonly<Record<string, ResponseObject | Reference>>;
}

/** Réponse observée (forme indépendante de fetch, pour tester le harnais lui-même). */
export interface ObservedResponse {
  readonly method: string;
  /** Chemin réel, sans origine ; la chaîne de requête est ignorée. */
  readonly path: string;
  readonly status: number;
  readonly headers: Headers;
  /** Corps brut (texte) ; '' si vide. */
  readonly body: string;
}

export class ContractViolation extends Error {
  override readonly name = 'ContractViolation';
  readonly problems: readonly string[];
  constructor(where: string, problems: readonly string[]) {
    super(`${where} : réponse non conforme à l'OpenAPI\n - ${problems.join('\n - ')}`);
    this.problems = problems;
  }
}

export const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'] as const;

const SCHEMA_REF = /^#\/components\/schemas\/([A-Za-z0-9_.-]+)$/;
const schemaId = (name: string): string => `urn:rueda:openapi:schema:${name}`;

/** Copie profonde où `#/components/schemas/X` devient l'identifiant absolu du composant. */
function rewriteRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteRefs);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === '$ref' && typeof v === 'string') {
      const m = SCHEMA_REF.exec(v);
      if (m === null) throw new Error(`référence de schéma non gérée : ${v}`);
      out[k] = schemaId(m[1] as string);
    } else out[k] = rewriteRefs(v);
  }
  return out;
}

/** `/brand/assets/{id}` → /^\/brand\/assets\/[^/]+$/ (paramètre = un segment non vide). */
function templateRegex(template: string): RegExp {
  const parts = template
    .split(/(\{[^}]+\})/)
    .map((p) => (/^\{[^}]+\}$/.test(p) ? '[^/]+' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  return new RegExp(`^${parts.join('')}$`);
}

export class OpenApiContract {
  readonly document: OpenApiDocument;
  readonly #ajv: Ajv2020;
  readonly #validators = new Map<string, ValidateFunction>();
  readonly #routes: Array<{ template: string; regex: RegExp }>;

  constructor(document: OpenApiDocument) {
    if (!/^3\.1\.\d+$/.test(document.openapi)) {
      throw new Error(`OpenAPI 3.1 attendu, lu ${document.openapi}`);
    }
    this.document = document;
    // strict : un mot-clé inconnu ou mal écrit dans le contrat est une erreur, pas un passe-droit.
    this.#ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
    for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
      this.#ajv.addSchema({ ...(rewriteRefs(schema) as object), $id: schemaId(name) });
    }
    // Les gabarits sans paramètre passent avant (`/a/b` avant `/a/{id}`).
    this.#routes = Object.keys(document.paths)
      .sort((a, b) => a.split('{').length - b.split('{').length || a.localeCompare(b))
      .map((template) => ({ template, regex: templateRegex(template) }));
  }

  static fromFile(path: string | URL): OpenApiContract {
    return new OpenApiContract(JSON.parse(readFileSync(path, 'utf8')) as OpenApiDocument);
  }

  /** Opérations déclarées, sous la forme `GET /brand/assets/{id}`. */
  operations(): string[] {
    return Object.entries(this.document.paths).flatMap(([template, item]) =>
      HTTP_METHODS.filter((m) => item[m] !== undefined).map(
        (m) => `${m.toUpperCase()} ${template}`,
      ),
    );
  }

  /** Compile tous les schémas de réponse et d'en-tête (contrôle du contrat lui-même). */
  compileAll(): void {
    for (const [status, r] of Object.entries(this.document['x-rueda-transverse-responses'] ?? {})) {
      if (!/^[1-5]\d\d$/.test(status)) {
        throw new Error(`réponse transverse : statut « ${status} » non explicite`);
      }
      this.#compileResponse(this.#response(r));
    }
    for (const [template, item] of Object.entries(this.document.paths)) {
      for (const method of HTTP_METHODS) {
        const op = item[method];
        if (op === undefined) continue;
        const responses = Object.entries(op.responses ?? {});
        if (responses.length === 0) throw new Error(`${method} ${template} : aucune réponse`);
        for (const [status, r] of responses) {
          if (!/^[1-5]\d\d$/.test(status)) {
            throw new Error(`${method} ${template} : statut « ${status} » non explicite`);
          }
          this.#compileResponse(this.#response(r));
        }
      }
    }
  }

  #compileResponse(response: ResponseObject): void {
    for (const media of Object.values(response.content ?? {})) {
      if (media.schema !== undefined) this.#validator(media.schema);
    }
    for (const h of Object.values(response.headers ?? {})) {
      const header = this.#header(h);
      if (header.schema !== undefined) this.#validator(header.schema);
    }
  }

  #component<T>(ref: string, kind: 'responses' | 'headers'): T {
    const m = new RegExp(`^#/components/${kind}/([A-Za-z0-9_.-]+)$`).exec(ref);
    const found = m === null ? undefined : this.document.components?.[kind]?.[m[1] as string];
    if (found === undefined) throw new Error(`référence introuvable : ${ref}`);
    return found as T;
  }

  #response(r: ResponseObject | Reference): ResponseObject {
    return '$ref' in r ? this.#component<ResponseObject>(r.$ref, 'responses') : r;
  }

  #header(h: HeaderObject | Reference): HeaderObject {
    return '$ref' in h ? this.#component<HeaderObject>(h.$ref, 'headers') : h;
  }

  #validator(schema: Record<string, unknown>): ValidateFunction {
    const key = JSON.stringify(schema);
    let v = this.#validators.get(key);
    if (v === undefined) {
      v = this.#ajv.compile(rewriteRefs(schema) as object);
      this.#validators.set(key, v);
    }
    return v;
  }

  #errors(v: ValidateFunction, data: unknown, where: string): string[] {
    if (v(data)) return [];
    return (v.errors ?? []).map(
      (e) =>
        `${where}${e.instancePath || ''} ${e.message ?? 'invalide'} ${JSON.stringify(e.params)}`,
    );
  }

  /** Gabarit qui correspond au chemin réel, ou `null`. */
  match(path: string): string | null {
    const p = path.split('?')[0] ?? path;
    return this.#routes.find((r) => r.regex.test(p))?.template ?? null;
  }

  /** Liste des écarts (vide si conforme). */
  check(observed: ObservedResponse): string[] {
    const method = observed.method.toLowerCase();
    const template = this.match(observed.path);
    if (template === null) return [`chemin non déclaré : ${observed.path}`];
    const op = this.document.paths[template]?.[method];
    if (op === undefined) return [`méthode non déclarée : ${observed.method} ${template}`];
    const declared = op.responses?.[String(observed.status)];
    const transverse = this.document['x-rueda-transverse-responses']?.[String(observed.status)];
    if (declared === undefined && transverse === undefined) {
      return [
        `statut ${observed.status} non déclaré (déclarés : ${Object.keys(op.responses ?? {}).join(', ')})`,
      ];
    }
    const own =
      declared === undefined ? null : this.#checkResponse(this.#response(declared), observed);
    if (own !== null && (own.length === 0 || transverse === undefined)) return own;
    const other = this.#checkResponse(
      this.#response(transverse as ResponseObject | Reference),
      observed,
    );
    if (other.length === 0 || own === null) return other;
    return [...own, ...other.map((p) => `(réponse transverse) ${p}`)];
  }

  /** Écarts entre une réponse observée et UNE réponse déclarée. */
  #checkResponse(response: ResponseObject, observed: ObservedResponse): string[] {
    const problems: string[] = [];

    for (const [name, h] of Object.entries(response.headers ?? {})) {
      const header = this.#header(h);
      const value =
        name.toLowerCase() === 'set-cookie'
          ? observed.headers.getSetCookie().join('\n') || null
          : observed.headers.get(name);
      if (value === null) {
        if (header.required === true) problems.push(`en-tête requis absent : ${name}`);
        continue;
      }
      if (header.schema !== undefined) {
        problems.push(...this.#errors(this.#validator(header.schema), value, `en-tête ${name}`));
      }
    }

    const media = response.content ?? {};
    const contentType = (observed.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    if (Object.keys(media).length === 0) {
      if (observed.body.length > 0)
        problems.push('corps présent alors qu’aucun contenu n’est déclaré');
      return problems;
    }
    const declaredMedia = media[contentType];
    if (declaredMedia === undefined) {
      problems.push(
        `type de contenu « ${contentType} » non déclaré (déclarés : ${Object.keys(media).join(', ')})`,
      );
      return problems;
    }
    if (contentType === 'application/json' || contentType.endsWith('+json')) {
      let data: unknown;
      try {
        data = JSON.parse(observed.body);
      } catch {
        problems.push('corps JSON illisible');
        return problems;
      }
      if (declaredMedia.schema !== undefined) {
        problems.push(...this.#errors(this.#validator(declaredMedia.schema), data, 'corps'));
      }
    } else if (observed.body.length === 0) {
      problems.push(`corps ${contentType} vide`);
    }
    return problems;
  }

  /**
   * Réponse qui a validé l'observation : celle de l'opération, ou la réponse transverse de même
   * statut (couverture du contrat). À n'appeler que sur une réponse conforme.
   */
  matchedBy(observed: ObservedResponse): 'operation' | 'transverse' {
    const template = this.match(observed.path);
    const op =
      template === null
        ? undefined
        : this.document.paths[template]?.[observed.method.toLowerCase()];
    const declared = op?.responses?.[String(observed.status)];
    if (
      declared !== undefined &&
      this.#checkResponse(this.#response(declared), observed).length === 0
    ) {
      return 'operation';
    }
    return 'transverse';
  }

  /** Opérations et statuts déclarés, `GET /brand 200`, pour les chemins d'un préfixe. */
  declaredStatuses(prefix: string): string[] {
    return Object.entries(this.document.paths)
      .filter(([template]) => template === prefix || template.startsWith(`${prefix}/`))
      .flatMap(([template, item]) =>
        HTTP_METHODS.filter((m) => item[m] !== undefined).flatMap((m) =>
          Object.keys(item[m]?.responses ?? {}).map((s) => `${m.toUpperCase()} ${template} ${s}`),
        ),
      );
  }

  /** Lève `ContractViolation` si la réponse n'est pas conforme. */
  assert(observed: ObservedResponse): void {
    const problems = this.check(observed);
    if (problems.length > 0) {
      throw new ContractViolation(
        `${observed.method} ${observed.path} → ${observed.status}`,
        problems,
      );
    }
  }
}

/** Contrat du dépôt (`apps/api/openapi/openapi.json`). */
export const OPENAPI_PATH = new URL('../../openapi/openapi.json', import.meta.url);

export function repositoryContract(): OpenApiContract {
  return OpenApiContract.fromFile(OPENAPI_PATH);
}

/**
 * Client de test : chaque réponse est confrontée au contrat AVANT d'être rendue au test, et
 * l'opération et le statut sont enregistrés (couverture du contrat par les tests). Une réponse
 * validée par une réponse transverse est comptée dans `coveredTransverse` (`429`, `413`…).
 */
export class ContractClient {
  readonly covered = new Set<string>();
  readonly coveredTransverse = new Set<string>();
  constructor(
    private readonly contract: OpenApiContract,
    private readonly base: string,
    private readonly defaultHeaders: Readonly<Record<string, string>> = {},
  ) {}

  async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options: { body?: unknown; raw?: string; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; headers: Headers; text: string; json: unknown }> {
    const headers: Record<string, string> = { ...this.defaultHeaders, ...(options.headers ?? {}) };
    const write = method !== 'GET';
    if (write && headers['content-type'] === undefined) {
      headers['content-type'] = 'application/json';
    }
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers,
      ...(write ? { body: options.raw ?? JSON.stringify(options.body ?? {}) } : {}),
    });
    const isText = !/^(image|font)\//.test(response.headers.get('content-type') ?? '');
    const text = isText
      ? await response.text()
      : Buffer.from(await response.arrayBuffer()).toString('latin1');
    const observed = {
      method,
      path,
      status: response.status,
      headers: response.headers,
      body: text,
    };
    this.contract.assert(observed);
    if (this.contract.matchedBy(observed) === 'operation') {
      this.covered.add(`${method} ${this.contract.match(path) ?? path} ${response.status}`);
    } else {
      this.coveredTransverse.add(String(response.status));
    }
    let json: unknown = null;
    if (isText && text.length > 0 && /json/.test(response.headers.get('content-type') ?? '')) {
      json = JSON.parse(text) as unknown;
    }
    return { status: response.status, headers: response.headers, text, json };
  }
}

/**
 * Suites de contrat (US-038) : chaque préfixe de chemin du contrat a UNE suite qui exerce tous
 * ses statuts déclarés (`expectFullCoverage`). `openapi-contract.test.ts` vérifie que chaque
 * opération a sa suite et que chaque suite appelle bien le contrôle de couverture.
 */
export const CONTRACT_SUITES: Readonly<Record<string, string>> = {
  '/auth': 'modules/iam/testing/auth.contract.test.ts',
  '/host': 'modules/iam/testing/host.contract.test.ts',
  // lieux, véhicules et annonces de l'hôte (US-115) ; fiche publique d'une annonce
  '/host/accounts/{orgId}': 'modules/cat/testing/host-listings.contract.test.ts',
  '/listings': 'modules/cat/testing/host-listings.contract.test.ts',
  '/phone': 'modules/iam/testing/phone.contract.test.ts',
  // vérification d'identité et rappels du fournisseur d'identité (US-105)
  '/identity': 'modules/kyc/testing/identity.contract.test.ts',
  '/kyc/webhooks': 'modules/kyc/testing/identity.contract.test.ts',
  '/brand': 'modules/cfg/internal/brand/brand.contract.test.ts',
  '/legal': 'modules/ctr/testing/legal.contract.test.ts',
  '/staff': 'testing/contract/staff.contract.test.ts',
  '/console': 'testing/contract/console.contract.test.ts',
  '/webhooks': 'testing/contract/webhooks.contract.test.ts',
  transverse: 'testing/contract/transverse.contract.test.ts',
};

/** Statuts déclarés pour `prefix` et jamais observés par la suite (liste vide attendue). */
export function missingCoverage(
  contract: OpenApiContract,
  prefix: string,
  covered: Iterable<string>,
): string[] {
  const seen = new Set(covered);
  return contract.declaredStatuses(prefix).filter((d) => !seen.has(d));
}

/** Routes réellement montées par Nest (journal « Mapped {/x/:id, GET} route »), format du contrat. */
export function mappedRoutes(logs: readonly string[]): string[] {
  const routes = new Set<string>();
  for (const line of logs) {
    const m = /Mapped \{([^,}]+), (GET|POST|PUT|PATCH|DELETE)\} route/.exec(line);
    if (m === null) continue;
    routes.add(`${m[2] as string} ${(m[1] as string).replace(/:([A-Za-z]+)/g, '{$1}')}`);
  }
  return [...routes].sort();
}
