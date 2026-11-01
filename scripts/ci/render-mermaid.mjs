#!/usr/bin/env node
// Rendu `mmdc` des diagrammes Mermaid de la documentation (US-002 ; 08 A31, 17 en-tête).
// Extrait chaque bloc ```mermaid des fichiers Markdown donnés, le rend en SVG avec mmdc,
// et signale chaque bloc qui ne compile pas avec son fichier et sa ligne.
// Usage : node scripts/ci/render-mermaid.mjs --mmdc <chemin de mmdc> [--puppeteer <config.json>] <fichiers.md…>
// Code de sortie : 0 si tous les blocs compilent, 1 sinon, 2 si usage invalide.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Blocs ```mermaid … ``` d'un texte Markdown, avec la ligne (1-based) de la clôture ouvrante.
export function extractMermaid(text) {
  const blocks = [];
  const lines = text.split(/\r?\n/);
  let start = -1;
  let body = [];
  for (let i = 0; i < lines.length; i++) {
    if (start < 0 && /^\s*```mermaid\s*$/.test(lines[i])) {
      start = i + 1;
      body = [];
    } else if (start >= 0 && /^\s*```\s*$/.test(lines[i])) {
      blocks.push({ line: start, source: body.join('\n') });
      start = -1;
    } else if (start >= 0) {
      body.push(lines[i]);
    }
  }
  if (start >= 0) blocks.push({ line: start, source: null }); // clôture manquante
  return blocks;
}

function main(argv) {
  const files = [];
  let mmdc;
  let puppeteer;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mmdc') mmdc = argv[++i];
    else if (argv[i] === '--puppeteer') puppeteer = argv[++i];
    else files.push(argv[i]);
  }
  if (!mmdc || !files.length) {
    console.error('usage : render-mermaid.mjs --mmdc <mmdc> [--puppeteer <json>] <fichiers.md…>');
    return 2;
  }
  const out = mkdtempSync(join(tmpdir(), 'rueda-mermaid-'));
  let total = 0;
  let failed = 0;
  for (const file of files) {
    const blocks = extractMermaid(readFileSync(file, 'utf8'));
    for (const b of blocks) {
      total++;
      const where = `${file}:${b.line}`;
      if (b.source === null) {
        console.log(`ÉCHEC ${where} : bloc mermaid sans clôture`);
        failed++;
        continue;
      }
      const input = join(out, `d${total}.mmd`);
      writeFileSync(input, b.source);
      const args = ['-q', '-i', input, '-o', join(out, `d${total}.svg`)];
      if (puppeteer) args.push('-p', puppeteer);
      const res = spawnSync(mmdc, args, { encoding: 'utf8' });
      if (res.status !== 0) {
        failed++;
        console.log(`ÉCHEC ${where}`);
        const msg = `${res.stderr ?? ''}${res.stdout ?? ''}${res.error?.message ?? ''}`.trim();
        for (const l of msg.split(/\r?\n/).slice(0, 12)) console.log(`    | ${l}`);
      } else {
        console.log(`OK    ${where}`);
      }
    }
  }
  console.log(`RÉSULTAT : ${total - failed}/${total} diagramme(s) rendu(s)`);
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
