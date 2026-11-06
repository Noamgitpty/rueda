/**
 * US-049 (constat F-RLS-03 de la red team RLS, parade compensatoire ; 17 §2.3 « Limite de la
 * RLS », RLS-18 : « requêtes paramétrées seules, aucun SQL dynamique côté application, règle de
 * lint ») : dans le code exécuté sous un rôle applicatif, une requête construite à partir de
 * données fait échouer `pnpm lint` ; un texte fixe et des paramètres liés passent. Le lint tourne
 * avec la **vraie** configuration racine (eslint.config.mjs), comme le ferait `pnpm lint`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './paths.ts';

const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: join(repoRoot, 'eslint.config.mjs'),
  ignore: false,
});

/** Lignes signalées par `rueda/no-dynamic-sql` pour `code`, linté comme s'il était à `path`. */
async function flagged(code: string, path = 'apps/api/src/modules/x/internal/store.ts') {
  const [result] = await eslint.lintText(code, { filePath: join(repoRoot, path) });
  if (!result) throw new Error('aucun résultat');
  return result.messages
    .filter((m) => m.ruleId === 'rueda/no-dynamic-sql')
    .map((m) => {
      expect(m.message).toContain('SQL dynamique interdit');
      return m.line;
    });
}

const HEADER = [
  'interface Db { query(text: unknown, values?: unknown[]): Promise<unknown> }',
  'declare const db: Db;',
  'declare const id: string;',
].join('\n');

describe('rueda/no-dynamic-sql (configuration réelle)', () => {
  it.each([
    ['gabarit interpolé', 'export const f = () => db.query(`SELECT * FROM t WHERE id = ${id}`);'],
    ['concaténation', "export const f = () => db.query('SELECT * FROM t WHERE id = ' + id);"],
    ['appel de fonction', "export const f = () => db.query(['SELECT 1', id].join(' '));"],
    [
      'constante locale construite',
      'export const f = () => { const q = `SELECT ${id}`; return db.query(q); };',
    ],
    ['objet { text } interpolé', 'export const f = () => db.query({ text: `SELECT ${id}` });'],
    [
      'branche dynamique',
      "export const f = (b: boolean) => db.query(b ? 'SELECT 1' : 'SELECT ' + id);",
    ],
    ['assertion de type', 'export const f = () => db.query(`SELECT ${id}` as string);'],
    // revues de la PR n° 92 (code 4, sécurité 5) : formes d'appel contournantes
    ['accès calculé', "export const f = () => db['query'](`SELECT ${id}`);"],
    ['query.call', 'export const f = () => db.query.call(db, `SELECT ${id}`);'],
    ['query.apply', 'export const f = () => db.query.apply(db, [`SELECT ${id}`]);'],
    ['alias const', 'export const f = () => { const q = db.query; return q(`SELECT ${id}`); };'],
    [
      'alias bind',
      'export const f = () => { const q = db.query.bind(db); return q(`SELECT ${id}`); };',
    ],
    [
      'alias par déstructuration',
      'export const f = () => { const { query } = db; return query(`SELECT ${id}`); };',
    ],
    [
      'étiquette de gabarit inconnue',
      'declare const raw: (s: TemplateStringsArray, ...v: unknown[]) => string;\nexport const f = () => db.query(raw`SELECT ${id}`);',
    ],
  ])('refusé : %s', async (_name, line) => {
    // la ligne fautive est la dernière (certains cas déclarent une étiquette avant)
    expect(await flagged(`${HEADER}\n${line}\n`)).toEqual([3 + line.split('\n').length]);
  });

  it.each([
    ['chaîne littérale', "export const f = () => db.query('SELECT $1::uuid', [id]);"],
    ['gabarit sans interpolation', 'export const f = () => db.query(`SELECT 1`);'],
    ['constante du module', "const Q = 'SELECT ' + 'x'; export const f = () => db.query(Q);"],
    [
      'constante locale fixe',
      "export const f = () => { const q = 'SELECT $1'; return db.query(q, [id]); };",
    ],
    [
      'objet { text, values }',
      "export const f = () => db.query({ text: 'SELECT $1', values: [id] });",
    ],
    ['enrobage (paramètre non suivi)', 'export const run = (text: string) => db.query(text);'],
    [
      'étiquette inconnue sans interpolation',
      'declare const raw: (s: TemplateStringsArray) => string;\nexport const f = () => db.query(raw`SELECT 1`);',
    ],
    ['accès calculé fixe', "export const f = () => db['query']('SELECT $1', [id]);"],
    [
      'alias appelé avec un texte fixe',
      "export const f = () => { const q = db.query; return q('SELECT 1'); };",
    ],
    [
      'gabarit étiqueté',
      'declare const sql: (s: TemplateStringsArray, ...v: unknown[]) => string;\nexport const f = () => db.query(sql`SELECT ${id}`);',
    ],
  ])('permis : %s', async (_name, line) => {
    expect(await flagged(`${HEADER}\n${line}\n`)).toEqual([]);
  });

  it('exceptions déclarées : exactement une, dans l’export des données personnelles (contrôle mécanique)', () => {
    // toute directive qui coupe la règle (par son nom, ou sans liste de règles) dans le code
    // applicatif ; une exception de plus fait échouer ce test (revue sécurité US-049, constat 5)
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.next') continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(e.name)) {
          readFileSync(p, 'utf8')
            .split('\n')
            .forEach((l, i) => {
              const m = /(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?(.*)$/.exec(l);
              if (m === null) return;
              const rest = (m[1] ?? '').split('--')[0]?.replace('*/', '').trim() ?? '';
              if (rest === '' || rest.includes('no-dynamic-sql')) {
                found.push(`${relative(repoRoot, p).split(sep).join('/')}:${i + 1}`);
              }
            });
        }
      }
    };
    for (const root of ['apps', 'packages']) {
      for (const pkg of readdirSync(join(repoRoot, root), { withFileTypes: true })) {
        const src = join(repoRoot, root, pkg.name, 'src');
        if (pkg.isDirectory() && existsSync(src)) walk(src);
      }
    }
    expect(found.map((f) => f.replace(/:\d+$/, ''))).toEqual(['packages/db/src/privacy/export.ts']);
  });

  it('les outils d’administration et les tests ne sont pas concernés', async () => {
    const code = `${HEADER}\nexport const f = () => db.query(\`SELECT \${id}\`);\n`;
    expect(await flagged(code, 'packages/db/src/bootstrap.ts')).toEqual([]);
    expect(await flagged(code, 'packages/db/test/l0/x.test.ts')).toEqual([]);
    expect(await flagged(code, 'apps/api/src/modules/x/internal/store.test.ts')).toEqual([]);
    // un paquet applicatif l'est
    expect(await flagged(code, 'packages/db/src/audit/x.ts')).toEqual([4]);
  });
});
