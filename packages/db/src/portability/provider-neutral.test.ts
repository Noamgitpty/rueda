/**
 * US-036 critère 1 — aucun service propriétaire d'un fournisseur cloud sans port, ni constante
 * liée à un fournisseur, dans le CODE de la plateforme (`apps/`, `packages/`, `package.json` racine) ; ADR-120.
 *
 * Un service de l'hébergeur (stockage objet, clés, secrets, files, courriel…) ne s'utilise que
 * derrière un port documenté (docs/ops/PORTABILITY.md), et son adaptateur arrive avec le choix de
 * l'hébergeur (Q-007). Ce test balaie les fichiers suivis par git et échoue sur :
 *   1. un SDK de fournisseur importé ou déclaré dans un `package.json` ;
 *   2. une constante de fournisseur : nom d'hôte de service, ARN, code de région.
 * L'IaC (`infra/`), l'image (`docker/`), les scripts de déploiement (`scripts/deploy/`) et la
 * documentation ne sont PAS balayés : ce sont, par construction, les adaptateurs de l'hébergeur,
 * inventoriés dans PORTABILITY.md. Un ajout légitime (adaptateur réel, lot C) passe par une
 * exception écrite ici, sous revue d'architecture.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const SELF = 'packages/db/src/portability/provider-neutral.test.ts';

/** Préfixes de paquets de fournisseurs cloud (SDK et services gérés propriétaires). */
const PROVIDER_PACKAGES = [
  '@aws-sdk/',
  'aws-sdk',
  '@aws-crypto/',
  '@google-cloud/',
  'googleapis',
  'firebase',
  'firebase-admin',
  '@azure/',
  '@vercel/blob',
  '@vercel/kv',
  '@vercel/postgres',
  '@cloudflare/',
  '@supabase/',
  '@planetscale/',
  '@neondatabase/',
];

/** Constantes de fournisseur : hôtes de service, ARN, régions. */
const PROVIDER_CONSTANTS: readonly RegExp[] = [
  /amazonaws\.com/,
  /\barn:aws[a-z-]*:/,
  /\b(?:us|eu|sa|ap|ca|me|af|il|mx)-(?:east|west|south|north|central|northeast|southeast|northwest|southwest)-\d\b/,
  /\.r2\.cloudflarestorage\.com/,
  /storage\.googleapis\.com/,
  /\.blob\.core\.windows\.net/,
  /\.vault\.azure\.net/,
];

const CODE = /\.(?:[cm]?[jt]sx?)$/;

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z', '--', 'apps', 'packages', 'package.json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter((f) => f !== '' && f !== SELF && !f.includes('node_modules/'));
}

const isProviderPackage = (name: string): boolean =>
  PROVIDER_PACKAGES.some((p) => (p.endsWith('/') ? name.startsWith(p) : name === p));

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;

/** Fautes d'un fichier de code : imports de SDK et constantes de fournisseur. */
function codeFindings(file: string, text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(IMPORT)) {
    const spec = m[1] ?? '';
    if (isProviderPackage(spec)) found.push(`${file} : SDK de fournisseur importé (${spec})`);
  }
  text.split('\n').forEach((line, i) => {
    for (const re of PROVIDER_CONSTANTS) {
      if (re.test(line)) found.push(`${file}:${i + 1} : constante de fournisseur (${re.source})`);
    }
  });
  return found;
}

/** Fautes d'un `package.json` : dépendance d'un SDK de fournisseur. */
function manifestFindings(file: string, text: string): string[] {
  const pkg = JSON.parse(text) as Record<string, unknown>;
  const found: string[] = [];
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    const deps = pkg[field];
    if (typeof deps !== 'object' || deps === null) continue;
    for (const name of Object.keys(deps)) {
      if (isProviderPackage(name)) found.push(`${file} : dépendance de fournisseur (${name})`);
    }
  }
  return found;
}

describe('US-036 — code neutre vis-à-vis du fournisseur cloud', () => {
  it('le contrôle détecte un SDK, une dépendance, un hôte, un ARN, une région (témoins)', () => {
    expect(codeFindings('a.ts', "import { S3Client } from '@aws-sdk/client-s3';")).toHaveLength(1);
    expect(codeFindings('a.ts', "const k = require('@google-cloud/kms');")).toHaveLength(1);
    expect(codeFindings('a.ts', "await import('@azure/keyvault-secrets');")).toHaveLength(1);
    expect(codeFindings('a.ts', "const h = 'kms.us-east-1.amazonaws.com';")).toHaveLength(2);
    expect(codeFindings('a.ts', "const a = 'arn:aws:kms:x:1:key/y';")).toHaveLength(1);
    expect(codeFindings('a.ts', "const r = 'sa-east-1';")).toHaveLength(1);
    expect(
      manifestFindings('p.json', JSON.stringify({ dependencies: { '@aws-sdk/client-kms': '1' } })),
    ).toHaveLength(1);
    // faux positifs évités : noms voisins, ports internes
    expect(
      codeFindings('a.ts', "import pg from 'pg'; const CASES = []; // KMS, S3 : ports"),
    ).toEqual([]);
    expect(manifestFindings('p.json', JSON.stringify({ dependencies: { pg: '8' } }))).toEqual([]);
  });

  it('apps/ et packages/ : aucun SDK de fournisseur, aucune constante de fournisseur', () => {
    const files = trackedFiles();
    expect(files.length).toBeGreaterThan(100); // fail-closed : un balayage vide est un échec
    const findings: string[] = [];
    for (const file of files) {
      const base = file.split('/').pop() ?? '';
      if (base === 'package.json') {
        findings.push(...manifestFindings(file, readFileSync(join(ROOT, file), 'utf8')));
      } else if (CODE.test(file)) {
        findings.push(...codeFindings(file, readFileSync(join(ROOT, file), 'utf8')));
      }
    }
    expect(findings).toEqual([]);
  });
});
