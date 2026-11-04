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
          const response = this.#response(r);
          for (const media of Object.values(response.content ?? {})) {
            if (media.schema !== undefined) this.#validator(media.schema);
          }
          for (const h of Object.values(response.headers ?? {})) {
            const header = this.#header(h);
            if (header.schema !== undefined) this.#validator(header.schema);
          }
        }
      }
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
    if (declared === undefined) {
      return [
        `statut ${observed.status} non déclaré (déclarés : ${Object.keys(op.responses ?? {}).join(', ')})`,
      ];
    }
    const response = this.#response(declared);
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
 * l'opération et le statut sont enregistrés (couverture du contrat par les tests).
 */
export class ContractClient {
  readonly covered = new Set<string>();
  constructor(
    private readonly contract: OpenApiContract,
    private readonly base: string,
  ) {}

  async request(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; headers: Headers; text: string; json: unknown }> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (method === 'POST' && headers['content-type'] === undefined) {
      headers['content-type'] = 'application/json';
    }
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers,
      ...(method === 'POST' ? { body: JSON.stringify(options.body ?? {}) } : {}),
    });
    const isText = !/^(image|font)\//.test(response.headers.get('content-type') ?? '');
    const text = isText
      ? await response.text()
      : Buffer.from(await response.arrayBuffer()).toString('latin1');
    this.contract.assert({
      method,
      path,
      status: response.status,
      headers: response.headers,
      body: text,
    });
    this.covered.add(`${method} ${this.contract.match(path) ?? path} ${response.status}`);
    let json: unknown = null;
    if (isText && text.length > 0 && /json/.test(response.headers.get('content-type') ?? '')) {
      json = JSON.parse(text) as unknown;
    }
    return { status: response.status, headers: response.headers, text, json };
  }
}
