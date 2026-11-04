/**
 * US-046 — aucune donnée personnelle dans les journaux, les erreurs, les alertes ni les URL
 * (17 §3.1.4 : C2 « masquage dans les logs », C3 « jamais dans les logs, événements » ; ADR-081).
 *
 * 1. URL : aucun paramètre de chemin ni de requête du contrat (openapi.json, = routes montées,
 *    US-038) ne porte une donnée personnelle ou un secret.
 * 2. Journaux, alertes, erreurs (analyse statique du code de production d'apps/api, compilateur
 *    TypeScript) : aucun appel de journal (`console.*`, `Logger`, `#log`, `log(...)`), d'alerte ni
 *    aucune construction d'erreur ne reçoit un nom de donnée personnelle de l'inventaire
 *    (packages/db/personal-data-inventory.json, colonnes C2 à C4) ni un corps, un en-tête ou un
 *    cookie de requête.
 * 3. Exécution sur l'application réelle (harnais d'US-043) : inscription, connexion, vérification
 *    d'email et erreur interne d'un adaptateur dont l'erreur PostgreSQL porte la donnée dans
 *    `detail` (comme `pg`) : ni les réponses ni le journal ne contiennent la donnée.
 */
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { startApiHarness } from './api-harness.js';
import type { ApiHarness } from './api-harness.js';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

interface Inventory {
  tables: Record<string, { columns: Record<string, string | { class: string }> }>;
}
const inventory = JSON.parse(
  readFileSync(join(REPO, 'packages/db/personal-data-inventory.json'), 'utf8'),
) as Inventory;

const camel = (s: string): string => s.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

/**
 * Noms trop génériques pour une analyse par nom (clé technique, motif libre, variables de gabarit) :
 * leur contenu est couvert par l'inventaire (classe et effacement) et par la revue, pas par ce test.
 */
const GENERIC = new Set(['key', 'reason', 'purpose', 'variables']);

/** Noms interdits : colonnes C2 à C4 de l'inventaire (snake et camel) et contenus bruts de requête. */
const PERSONAL_NAMES = new Set<string>([
  ...Object.values(inventory.tables)
    .flatMap((t) =>
      Object.entries(t.columns)
        .filter(([, e]) => ['C2', 'C3', 'C4'].includes(typeof e === 'string' ? e : e.class))
        .flatMap(([c]) => [c, camel(c), c.replace(/_enc$/, ''), camel(c.replace(/_enc$/, ''))]),
    )
    .filter((n) => !GENERIC.has(n)),
  'email',
  'phone',
  'password',
  'token',
  'firstName',
  'lastName',
  'legalFirstName',
  'legalLastName',
  'dateOfBirth',
  'userAgent',
  'rawBody',
  'body',
  'headers',
  'cookie',
  'cookies',
  'authorization',
]);

function productionFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'testing' || name === 'node_modules') continue;
      out.push(...productionFiles(path));
    } else if (/\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(path);
    }
  }
  return out;
}

const LOG_METHODS = new Set(['log', 'info', 'warn', 'error', 'debug', 'verbose', 'fatal']);

/** L'appel est-il un journal, une alerte, ou la construction d'une erreur ? */
function sinkKind(node: ts.Node): string | undefined {
  if (ts.isNewExpression(node)) {
    const name = node.expression.getText();
    return /Error$|Exception$/.test(name) ? `new ${name}` : undefined;
  }
  if (!ts.isCallExpression(node)) return undefined;
  let callee: ts.Expression = node.expression;
  while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
  const text = callee.getText();
  if (ts.isPropertyAccessExpression(callee)) {
    const method = callee.name.getText();
    const target = callee.expression.getText();
    if (LOG_METHODS.has(method) && /console|log|logger|LOG/i.test(target)) return text;
    if (/^#?(log|alert|deadLetter)$/.test(method)) return text;
  }
  if (/(^|\.|#)(log|defaultLog|alert)$|\?\? ?defaultLog$/.test(text)) return text;
  return undefined;
}

/** Noms (identifiants, propriétés, clés) utilisés dans les arguments d'un appel. */
function namesIn(node: ts.Node): Array<{ name: string; at: ts.Node }> {
  const out: Array<{ name: string; at: ts.Node }> = [];
  const visit = (n: ts.Node): void => {
    // `a.b.c` : seul le dernier nom désigne la valeur (`headers.masked` est un compte, pas un en-tête)
    if (ts.isPropertyAccessExpression(n)) {
      out.push({ name: n.name.text, at: n.name });
      if (!ts.isIdentifier(n.expression) && !ts.isPropertyAccessExpression(n.expression)) {
        visit(n.expression);
      }
      return;
    }
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) out.push({ name: n.text, at: n });
    else if (ts.isStringLiteral(n) && ts.isPropertyAssignment(n.parent) && n.parent.name === n) {
      out.push({ name: n.text, at: n });
    }
    ts.forEachChild(n, visit);
  };
  const args = ts.isCallExpression(node) || ts.isNewExpression(node) ? (node.arguments ?? []) : [];
  for (const a of args) visit(a);
  return out;
}

export function scanPersonalDataSinks(files: readonly string[]): string[] {
  const findings: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (n: ts.Node): void => {
      const kind = sinkKind(n);
      if (kind !== undefined) {
        for (const { name, at } of namesIn(n)) {
          if (PERSONAL_NAMES.has(name)) {
            const { line } = source.getLineAndCharacterOfPosition(at.getStart());
            findings.push(
              `${relative(REPO, file).replace(/\\/g, '/')}:${line + 1} ${kind} ← ${name}`,
            );
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(source);
  }
  return findings;
}

describe('US-046 — aucune donnée personnelle dans les URL', () => {
  it('aucun paramètre de chemin ni de requête du contrat ne porte une donnée personnelle', () => {
    const spec = JSON.parse(readFileSync(join(SRC, '../openapi/openapi.json'), 'utf8')) as {
      paths: Record<string, Record<string, { parameters?: Array<{ name: string; in: string }> }>>;
    };
    const params: string[] = [];
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const m of /\{([^}]+)\}/g[Symbol.matchAll](path)) params.push(`path:${m[1]}`);
      for (const op of Object.values(ops)) {
        for (const p of op.parameters ?? [])
          if (p.in === 'query' || p.in === 'path') params.push(`${p.in}:${p.name}`);
      }
    }
    expect(params.length).toBeGreaterThan(5);
    const bad = params.filter((p) => {
      const name = p.split(':')[1] ?? '';
      return (
        PERSONAL_NAMES.has(name) ||
        /email|phone|name|birth|password|token|secret|ip$|address/i.test(name)
      );
    });
    expect(bad).toEqual([]);
  });
});

describe('US-046 — aucune donnée personnelle dans les journaux, alertes et erreurs (analyse statique)', () => {
  it('le code de production d’apps/api ne journalise ni n’alerte ni ne lève de donnée personnelle', () => {
    const files = productionFiles(SRC);
    expect(files.length).toBeGreaterThan(50);
    expect(scanPersonalDataSinks(files)).toEqual([]);
  });

  it('l’analyse détecte une fuite (journal, alerte, erreur) sur un exemple fautif', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const sample = join(dir, '__personal_leak_sample.ts');
    const code = [
      'export function f(user: { email: string }, phoneE164: string, log: (x: unknown) => void) {',
      "  console.warn('inscription', { email: user.email });",
      '  log({ event: "x", phoneE164 });',
      '  throw new Error(`refus pour ${user.email}`);',
      '}',
    ].join('\n');
    const findings = (() => {
      writeFileSync(sample, code);
      try {
        return scanPersonalDataSinks([sample]);
      } finally {
        rmSync(sample, { force: true });
      }
    })();
    expect(findings.map((f) => f.replace(/^.*__personal_leak_sample\.ts:/, ''))).toEqual([
      '2 console.warn ← email',
      '2 console.warn ← email',
      '3 log ← phoneE164',
      '4 new Error ← email',
    ]);
  });
});

describe('US-046 — aucune donnée personnelle dans les réponses ni le journal (application réelle)', () => {
  const harnesses: ApiHarness[] = [];
  afterAll(async () => {
    for (const h of harnesses) await h.close();
    vi.restoreAllMocks();
  });

  const PII = {
    email: 'lucia.fernandez.us046@example.test',
    password: 'Contraseña-muy-secreta-46',
    first: 'Lucía-US046',
    last: 'Fernández-US046',
    token: 'verif-token-us046-0123456789abcdef',
  };

  it('inscription, connexion, vérification et erreur interne d’un adaptateur : rien ne fuit', async () => {
    const consoleLines: string[] = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        consoleLines.push(args.map(String).join(' '));
      });
    }
    // erreur telle que la rend `pg` : message générique, donnée dans `detail` (jamais journalisé)
    const pgLike = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'user_account_email_unique',
      detail: `Key (email)=(${PII.email}) already exists.`,
    });
    const app = await startApiHarness();
    harnesses.push(app);
    const failing = await startApiHarness({
      iam: {
        store: {
          resolveSession: () => Promise.resolve(null),
          registerAccount: () => Promise.reject(pgLike),
          findCredentials: () => Promise.reject(pgLike),
          verifyEmail: () => Promise.reject(pgLike),
        } as never,
      },
    });
    harnesses.push(failing);
    const headers = { 'content-type': 'application/json' };
    const replies: string[] = [];
    for (const target of [app, failing]) {
      replies.push(
        (
          await target.call('POST', '/auth/signup', {
            headers,
            body: JSON.stringify({
              email: PII.email,
              password: PII.password,
              legalFirstName: PII.first,
              legalLastName: PII.last,
              locale: 'es',
              termsAccepted: true,
            }),
          })
        ).text,
      );
      replies.push(
        (
          await target.call('POST', '/auth/login', {
            headers,
            body: JSON.stringify({ email: PII.email, password: PII.password }),
          })
        ).text,
      );
      replies.push(
        (
          await target.call('POST', '/auth/verify-email', {
            headers,
            body: JSON.stringify({ token: PII.token }),
          })
        ).text,
      );
    }
    const everything = [...replies, ...app.logs, ...failing.logs, ...consoleLines].join('\n');
    // l'erreur interne a bien été journalisée (sinon la preuve serait vide)
    expect(failing.logs.join('\n')).toContain('duplicate key value');
    for (const value of Object.values(PII)) expect(everything).not.toContain(value);
  });
});
