/**
 * US-041, critère 1 — « Given une réponse d'API non conforme à l'OpenAPI, When le test de contrat
 * tourne, Then il échoue ». Le harnais est éprouvé ici sur des réponses fabriquées (une par sorte
 * d'écart), puis le contrat du dépôt est contrôlé : compilable en mode strict et complet (chaque
 * route déclarée par un contrôleur Nest est décrite ou listée « en attente »).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hygienicCode } from '../http-hardening.js';
import { BRAND_MESSAGES } from '../modules/cfg/index.js';
import { LEGAL_MESSAGES } from '../modules/ctr/index.js';
import { AUTH_MESSAGES } from '../modules/iam/index.js';
import { RISK_MESSAGES } from '../modules/risk/index.js';
import { startApiHarness } from './api-harness.js';
import type { ApiHarness } from './api-harness.js';
import { controllerRoutes } from './controller-routes.js';
import {
  CONTRACT_SUITES,
  HTTP_METHODS,
  mappedRoutes,
  OpenApiContract,
  repositoryContract,
} from './openapi-contract.js';
import type { ObservedResponse, OpenApiDocument } from './openapi-contract.js';

const UUID = '00000000-0000-4000-8000-000000000001';

/** Contrat minimal écrit ici (indépendant de celui du dépôt). */
const MINI: OpenApiDocument = {
  openapi: '3.1.0',
  paths: {
    '/things/{id}': {
      get: {
        responses: {
          '200': {
            headers: {
              'Cache-Control': { required: true, schema: { type: 'string', const: 'no-store' } },
            },
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } },
          },
          '404': {
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                  properties: { code: { const: 'NOT_FOUND' } },
                },
              },
            },
          },
        },
      },
    },
    '/things/{id}/archive': { post: { responses: { '204': { description: 'archivé' } } } },
  },
  components: {
    schemas: {
      Thing: {
        type: 'object',
        required: ['id', 'count'],
        additionalProperties: false,
        properties: { id: { type: 'string' }, count: { type: 'integer', minimum: 0 } },
      },
      Error: {
        type: 'object',
        required: ['code'],
        additionalProperties: false,
        properties: { code: { type: 'string' } },
      },
    },
  },
};

const res = (
  over: Partial<ObservedResponse> & { json?: unknown; h?: Record<string, string> },
): ObservedResponse => ({
  method: over.method ?? 'GET',
  path: over.path ?? `/things/${UUID}`,
  status: over.status ?? 200,
  headers: new Headers(
    over.h ?? { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  ),
  body: over.body ?? (over.json === undefined ? '' : JSON.stringify(over.json)),
});

describe('harnais de contrat : une réponse non conforme fait échouer le test', () => {
  const contract = new OpenApiContract(MINI);

  it('réponse conforme : aucun écart', () => {
    expect(contract.check(res({ json: { id: 'a', count: 1 } }))).toEqual([]);
    expect(() => contract.assert(res({ json: { id: 'a', count: 0 } }))).not.toThrow();
    expect(
      contract.check(res({ method: 'POST', path: `/things/${UUID}/archive`, status: 204, h: {} })),
    ).toEqual([]);
  });

  it.each([
    ['champ requis absent', res({ json: { id: 'a' } }), /required/],
    ['type faux', res({ json: { id: 'a', count: '1' } }), /must be integer/],
    [
      'propriété non déclarée',
      res({ json: { id: 'a', count: 1, secret: 'x' } }),
      /additional properties/,
    ],
    ['valeur hors bornes', res({ json: { id: 'a', count: -1 } }), /must be >= 0/],
    [
      'statut non déclaré',
      res({ status: 500, json: { id: 'a', count: 1 } }),
      /statut 500 non déclaré/,
    ],
    ['chemin non déclaré', res({ path: '/autre', json: {} }), /chemin non déclaré/],
    ['méthode non déclarée', res({ method: 'POST', json: {} }), /méthode non déclarée/],
    [
      'type de contenu non déclaré',
      res({
        body: '<html></html>',
        h: { 'content-type': 'text/html', 'cache-control': 'no-store' },
      }),
      /type de contenu « text\/html »/,
    ],
    [
      'en-tête requis absent',
      res({ json: { id: 'a', count: 1 }, h: { 'content-type': 'application/json' } }),
      /en-tête requis absent : Cache-Control/,
    ],
    [
      'en-tête non conforme',
      res({
        json: { id: 'a', count: 1 },
        h: { 'content-type': 'application/json', 'cache-control': 'public' },
      }),
      /en-tête Cache-Control/,
    ],
    [
      'code d’erreur instable',
      res({ status: 404, json: { code: 'MISSING' } }),
      /must be equal to constant/,
    ],
    ['JSON illisible', res({ body: '{"id":' }), /JSON illisible/],
    [
      'corps sur une réponse sans contenu',
      res({ method: 'POST', path: `/things/${UUID}/archive`, status: 204, body: 'ok', h: {} }),
      /aucun contenu/,
    ],
  ])('%s', (_name, observed, pattern) => {
    const problems = contract.check(observed);
    expect(problems.join('\n')).toMatch(pattern);
    expect(() => contract.assert(observed)).toThrow(/non conforme à l'OpenAPI/);
  });

  it('un mot-clé de schéma inconnu (faute de frappe) est refusé : mode strict', () => {
    const typo: OpenApiDocument = {
      openapi: '3.1.0',
      paths: {
        '/x': {
          get: {
            responses: {
              '200': {
                content: { 'application/json': { schema: { type: 'object', requird: ['a'] } } },
              },
            },
          },
        },
      },
    };
    expect(() => new OpenApiContract(typo).compileAll()).toThrow(/unknown keyword/);
  });

  it('OpenAPI 3.0 ou statut « default » refusés : le contrat doit être explicite', () => {
    expect(() => new OpenApiContract({ ...MINI, openapi: '3.0.3' })).toThrow(/3\.1/);
    const loose: OpenApiDocument = {
      openapi: '3.1.0',
      paths: { '/x': { get: { responses: { default: {} } } } },
    };
    expect(() => new OpenApiContract(loose).compileAll()).toThrow(/non explicite/);
  });
});

// ---- Contrat du dépôt -------------------------------------------------------------------------

describe('contrat du dépôt (apps/api/openapi/openapi.json)', () => {
  const contract = repositoryContract();

  it('compile en mode strict : chaque schéma de réponse et d’en-tête, chaque référence', () => {
    expect(() => contract.compileAll()).not.toThrow();
  });

  it('operationId uniques', () => {
    const ids = Object.values(contract.document.paths).flatMap((item) =>
      Object.values(item).map((op) => op.operationId),
    );
    expect(ids.every((id) => typeof id === 'string')).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('chaque route d’un contrôleur est décrite ; aucune route fantôme ; plus rien en attente (US-038)', () => {
    const described = contract.operations();
    const routes = controllerRoutes();
    expect(routes.length).toBeGreaterThan(0);
    expect(contract.document['x-rueda-pending'] ?? []).toEqual([]);
    expect(routes.filter((r) => !described.includes(r))).toEqual([]);
    expect(described.filter((r) => !routes.includes(r))).toEqual([]);
  });
});

// ---- Contrat vérifié contre le code (US-038, ADR-079) ------------------------------------------

/**
 * Statuts surchargés dans le code (`new XHttpError(code, valeurs, statut)`), liste fermée : le test
 * « surcharges » relit les sources et échoue sur toute surcharge absente d'ici.
 */
const STATUS_OVERRIDES: ReadonlyArray<readonly [string, number]> = [
  ['REQUEST_INVALID', 415], // assertJsonWrite (iam/internal/csrf.guard.ts), parade CSRF
];

/** Codes stables des catalogues du code, avec leur statut HTTP. */
const CATALOG: ReadonlyMap<string, ReadonlySet<number>> = (() => {
  const m = new Map<string, Set<number>>();
  const add = (code: string, status: number) => m.set(code, (m.get(code) ?? new Set()).add(status));
  for (const catalog of [AUTH_MESSAGES, BRAND_MESSAGES, LEGAL_MESSAGES, RISK_MESSAGES] as const) {
    for (const [code, { status }] of Object.entries(catalog)) add(code, status);
  }
  for (const status of [400, 404, 413, 415, 500]) add(hygienicCode(status), status);
  for (const [code, status] of STATUS_OVERRIDES) add(code, status);
  return m;
})();

/** Codes d'erreur déclarés par une réponse (`properties.code.const` / `enum`). */
function declaredCodes(response: unknown): string[] {
  const content = (response as { content?: Record<string, { schema?: unknown }> }).content ?? {};
  return Object.values(content).flatMap((media) => {
    const code = (media.schema as { properties?: { code?: { const?: string; enum?: string[] } } })
      ?.properties?.code;
    return code?.const !== undefined ? [code.const] : (code?.enum ?? []);
  });
}

describe('contrat vérifié contre le code', () => {
  const contract = repositoryContract();
  const doc = contract.document;
  const resolve = (r: unknown): unknown => {
    const ref = (r as { $ref?: string }).$ref;
    return ref === undefined ? r : doc.components?.responses?.[ref.split('/').pop() as string];
  };
  let harness: ApiHarness;
  beforeAll(async () => {
    harness = await startApiHarness();
  });
  afterAll(async () => {
    await harness.close();
  });

  it('routes MONTÉES par Nest (ApiModule réel) = opérations du contrat = lecture des décorateurs', () => {
    const mapped = mappedRoutes(harness.logs);
    expect(mapped.length).toBeGreaterThan(0);
    expect(mapped).toEqual([...contract.operations()].sort());
    expect(mapped).toEqual(controllerRoutes());
  });

  it('chaque code d’erreur déclaré existe dans un catalogue du code, au même statut HTTP', () => {
    const problems: string[] = [];
    const check = (where: string, status: string, response: unknown) => {
      for (const code of declaredCodes(resolve(response))) {
        const statuses = CATALOG.get(code);
        if (statuses === undefined)
          problems.push(`${where} ${status} : code inconnu du code ${code}`);
        else if (!statuses.has(Number(status)))
          problems.push(
            `${where} ${status} : ${code} vaut ${[...statuses].join('/')} dans le code`,
          );
      }
    };
    for (const [template, item] of Object.entries(doc.paths)) {
      for (const method of HTTP_METHODS) {
        for (const [status, r] of Object.entries(item[method]?.responses ?? {})) {
          check(`${method.toUpperCase()} ${template}`, status, r);
        }
      }
    }
    for (const [status, r] of Object.entries(doc['x-rueda-transverse-responses'] ?? {})) {
      check('transverse', status, r);
    }
    expect(problems).toEqual([]);
  });

  it('surcharges de statut : la liste fermée couvre toutes celles du code', () => {
    const root = new URL('../', import.meta.url);
    const found: string[] = [];
    for (const file of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
      const posix = file.replaceAll('\\', '/');
      if (!posix.endsWith('.ts') || /\.test\.ts$|(^|\/)testing\//.test(posix)) continue;
      const source = readFileSync(new URL(posix, root), 'utf8');
      for (const m of source.matchAll(/HttpError\(\s*'([A-Z0-9_]+)'\s*,[^;]*?,\s*(\d{3})\s*\)/g)) {
        found.push(`${m[1] as string} ${m[2] as string}`);
      }
    }
    expect(found.length).toBeGreaterThan(0);
    const allowed = STATUS_OVERRIDES.map(([c, s]) => `${c} ${s}`);
    expect(found.filter((f) => !allowed.includes(f))).toEqual([]);
  });

  it('chaque opération a une suite de contrat qui contrôle la couverture de ses statuts', () => {
    const prefixes = Object.keys(CONTRACT_SUITES).filter((p) => p.startsWith('/'));
    const orphans = contract
      .operations()
      .filter((op) => !prefixes.some((p) => op.split(' ')[1]?.startsWith(`${p}`)));
    expect(orphans).toEqual([]);
    for (const [prefix, file] of Object.entries(CONTRACT_SUITES)) {
      const path = new URL(`../${file}`, import.meta.url);
      expect(existsSync(path), file).toBe(true);
      const source = readFileSync(path, 'utf8');
      const marker =
        prefix === 'transverse'
          ? 'chaque réponse transverse est observée'
          : `chaque statut déclaré pour ${prefix} est exercé`;
      expect(source, file).toContain(marker);
    }
  });
});
