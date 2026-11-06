/**
 * US-049 — red team « concurrence », C19 : « aucun FAKE dans l'image de production » (17 §6.5 point 2,
 * ADR-032, ADR-078 ; 19 US-049 critère 4). Contrôles STATIQUES et exécutés sans Docker : ce que
 * l'image contient dérive de ce que `pnpm --filter @rueda/api build` compile et de ce que le
 * Dockerfile copie (docker/prod/Dockerfile, étapes `build` puis `runtime`).
 *
 * Attaques jouées :
 * - le FAKE (adaptateur, PSP simulé, montage de test) est-il dans la fermeture de compilation de
 *   l'API ou dans le JavaScript émis ?
 * - une dépendance de production d'un paquet de l'espace de travail tire-t-elle `@rueda/fake-adapters` ?
 * - le code de production lit-il une variable d'environnement qui active un FAKE, un contournement
 *   ou un mode de test ? expose-t-il une route de test ?
 * - le Dockerfile pose-t-il `RUEDA_ENV`, copie-t-il des paquets de test, installe-t-il autre chose
 *   que `--prod` pour l'image finale ?
 * La construction réelle de l'image et `scripts/deploy/image-checks.sh` ne sont pas rejouables ici
 * (pas de Docker) : ils tournent dans le job CI « déploiement local ».
 *
 * Chaque test affirme que l'attaque est BLOQUÉE ; rouge = faille.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../../../../', import.meta.url));
const API = join(ROOT, 'apps', 'api');
const SRC = join(API, 'src');
const LONG = 240_000;

const posix = (p: string): string => p.split(sep).join('/');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Fichiers source du code livré : ni tests, ni `testing/`, ni aides de test. */
const productionSources = (): string[] =>
  walk(SRC).filter((f) => {
    const p = posix(relative(SRC, f));
    return (
      p.endsWith('.ts') &&
      !/\.(test|int\.test|test-support)\.ts$/.test(p) &&
      !/(^|\/)testing\//.test(p)
    );
  });

describe('US-049 red team concurrence — C19 (FAKE hors de l’image de production)', () => {
  it(
    'RT-CONC-60 : le code compilé pour l’image ne contient ni fichier de test, ni FAKE, ni montage de test — ni dans la liste des fichiers compilés, ni dans le JavaScript émis',
    () => {
      const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
      const out = mkdtempSync(join(tmpdir(), 'rueda-c19-'));
      try {
        const listed = execFileSync(
          process.execPath,
          [tsc, '-p', 'tsconfig.build.json', '--outDir', out, '--listEmittedFiles'],
          { cwd: API, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
        );
        const emitted = walk(out).filter((f) => f.endsWith('.js'));
        expect(emitted.length, 'rien n’a été émis : le contrôle serait aveugle').toBeGreaterThan(
          50,
        );
        const names = emitted.map((f) => posix(relative(out, f)));
        expect(
          names.filter((n) => /(^|\/)testing\//.test(n)),
          'répertoire testing/ émis',
        ).toEqual([]);
        expect(
          names.filter((n) => /\.test\.|test-support|fake/i.test(n)),
          'fichier de test ou FAKE émis',
        ).toEqual([]);
        expect(listed).not.toMatch(/fake-adapters/);
        const FORBIDDEN =
          /@rueda\/fake-adapters|assertFakeAllowed|FakePsp\b|FakePaymentProvider|fakeStack|FAKE_WEBHOOK_SECRET|fake-signature|test_fixture/;
        const offenders = emitted
          .filter((f) => FORBIDDEN.test(readFileSync(f, 'utf8')))
          .map((f) => posix(relative(out, f)));
        expect(offenders, 'JavaScript émis qui référence le FAKE ou une aide de test').toEqual([]);
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    },
    LONG,
  );

  it('RT-CONC-61 : @rueda/fake-adapters n’est une dépendance de production d’aucun paquet de l’espace de travail ; aucun autre paquet de FAKE ne l’est', () => {
    const manifests = [...walk(join(ROOT, 'apps')), ...walk(join(ROOT, 'packages'))]
      .filter((f) => f.endsWith(`${sep}package.json`))
      .concat([join(ROOT, 'package.json')]);
    expect(manifests.length).toBeGreaterThan(5);
    const prodFields = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;
    const offenders: string[] = [];
    for (const file of manifests) {
      const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<
        string,
        Record<string, string> | undefined
      >;
      for (const field of prodFields) {
        for (const name of Object.keys(manifest[field] ?? {})) {
          if (/fake|mock|stub|testcontainers|vitest/i.test(name)) {
            offenders.push(`${posix(relative(ROOT, file))} ${field}: ${name}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
    // et le paquet reste bien déclaré en développement chez son utilisateur (sinon le contrôle est vide)
    const api = JSON.parse(readFileSync(join(API, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(api.devDependencies['@rueda/fake-adapters']).toBeDefined();
  });

  it('RT-CONC-62 : aucune variable d’environnement lue par le code de production ne peut activer un FAKE, un contournement ou un mode de test', () => {
    const names = new Set<string>();
    const readers = [
      /\benv\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]/g,
      /\bprocess\.env\.([A-Za-z0-9_]+)/g,
      /\bprocess\.env\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]/g,
    ];
    for (const file of productionSources()) {
      const text = readFileSync(file, 'utf8');
      for (const re of readers) for (const m of text.matchAll(re)) names.add(m[1] as string);
    }
    // la découverte doit voir au moins la variable d'environnement de référence
    expect([...names]).toContain('RUEDA_ENV');
    const DANGEROUS =
      /FAKE|MOCK|STUB|SANDBOX|BYPASS|SKIP|DISABLE|INSECURE|UNSAFE|DEBUG|TEST|ADAPTER|OVERRIDE|VIRTUAL|SIMULAT|DEV_|_DEV\b/i;
    const dangerous = [...names].filter((n) => DANGEROUS.test(n));
    expect(dangerous, `variables lues : ${[...names].sort().join(', ')}`).toEqual([]);
  });

  it('RT-CONC-63 : le code de production n’expose aucune route de test, de debug, de remise à zéro ou de FAKE', () => {
    const routes: string[] = [];
    for (const file of productionSources()) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(
        /@(Controller|Get|Post|Put|Patch|Delete|All)\(\s*(['"`])([^'"`]*)\2/g,
      )) {
        routes.push(`${m[1]} ${m[3]} (${posix(relative(SRC, file))})`);
      }
    }
    expect(routes.length, 'aucune route trouvée : le contrôle serait aveugle').toBeGreaterThan(5);
    const suspicious = routes.filter((r) =>
      /(^|[/ '"`])(test|tests|debug|dev|fake|mock|seed|reset|truncate|simulate|sandbox|__[a-z]+)([/\s:'"`)]|$)/i.test(
        r.replace(/\(.*\)$/, ''),
      ),
    );
    expect(suspicious, `routes : ${routes.join(' | ')}`).toEqual([]);
  });

  it('RT-CONC-64 : le Dockerfile de production ne pose pas RUEDA_ENV, n’installe que --prod pour l’image finale, ne copie ni FAKE ni test, ne tourne pas en root', () => {
    const text = readFileSync(join(ROOT, 'docker', 'prod', 'Dockerfile'), 'utf8');
    const lines = text
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    expect(lines).not.toMatch(/RUEDA_ENV/);
    expect(lines).not.toMatch(/(^|\n)\s*(ENV|ARG)\s+[A-Z_]*(FAKE|MOCK|TEST|BYPASS)[A-Z_]*/i);
    const copies = [...lines.matchAll(/(^|\n)\s*COPY\s+[^\n]*/g)].map((m) => m[0]);
    expect(copies.length).toBeGreaterThan(10);
    expect(
      copies.filter((l) =>
        /fake-adapters|test-migrations|dev-overlay|\.env|\.git\b|\.claude/i.test(l),
      ),
    ).toEqual([]);
    // chaque COPY vers l'image finale vient de l'étape de build, jamais du contexte brut
    const runtime = lines.slice(lines.indexOf('AS runtime'));
    const rawCopies = [...runtime.matchAll(/(^|\n)\s*COPY\s+(?!--from=build)[^\n]*/g)].map((m) =>
      m[0].trim(),
    );
    expect(rawCopies, 'COPY du contexte brut dans l’image finale').toEqual([]);
    // la seconde installation (celle qui reste dans l'image) est --prod
    const installs = [...lines.matchAll(/pnpm install[^\n&]*(\\\n[^\n&]*)*/g)].map((m) => m[0]);
    expect(installs.length).toBeGreaterThanOrEqual(2);
    expect(installs[installs.length - 1]).toMatch(/--prod\b/);
    expect(runtime).toMatch(/\nUSER node\b/);
    // le nettoyage final retire testing/, test et les fichiers de test
    expect(runtime).toMatch(/-name testing/);
    expect(runtime).toMatch(/\*\.test\.ts/);
  });
});
