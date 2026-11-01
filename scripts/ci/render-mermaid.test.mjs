// Tests de l'extraction des blocs Mermaid (node --test scripts/ci/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMermaid } from './render-mermaid.mjs';

test('blocs mermaid extraits avec leur ligne, autres blocs ignorés', () => {
  const md = [
    '# Titre',
    '```mermaid',
    'flowchart LR',
    '  A --> B',
    '```',
    '```ts',
    'const x = 1;',
    '```',
    '  ```mermaid',
    'erDiagram',
    '  ```',
  ].join('\n');
  assert.deepEqual(extractMermaid(md), [
    { line: 2, source: 'flowchart LR\n  A --> B' },
    { line: 9, source: 'erDiagram' },
  ]);
});

test('bloc sans clôture signalé', () => {
  assert.deepEqual(extractMermaid('```mermaid\nflowchart LR\n'), [{ line: 1, source: null }]);
});
