/**
 * US-041, critère 1 — « Given une réponse d'API non conforme à l'OpenAPI, When le test de contrat
 * tourne, Then il échoue ». Le harnais est éprouvé ici sur des réponses fabriquées (une par sorte
 * d'écart), puis le contrat du dépôt est contrôlé : compilable en mode strict et complet (chaque
 * route déclarée par un contrôleur Nest est décrite ou listée « en attente »).
 */
import { describe, expect, it } from 'vitest';
import { controllerRoutes } from './controller-routes.js';
import { OpenApiContract, repositoryContract } from './openapi-contract.js';
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

  it('chaque route d’un contrôleur est décrite ou en attente ; aucune route fantôme', () => {
    const described = contract.operations();
    const pending = contract.document['x-rueda-pending'] ?? [];
    const routes = controllerRoutes();
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((r) => !described.includes(r) && !pending.includes(r))).toEqual([]);
    expect([...described, ...pending].filter((r) => !routes.includes(r))).toEqual([]);
    expect(described.filter((r) => pending.includes(r))).toEqual([]);
  });
});
