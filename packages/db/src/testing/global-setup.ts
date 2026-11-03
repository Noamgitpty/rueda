/**
 * `globalSetup` Vitest des suites `test:int` et `test:l0` : prépare le banc une fois par série
 * et le supprime à la fin, même si des tests ont échoué (la fonction renvoyée sert de teardown).
 */
import type { TestProject } from 'vitest/node';
import { redactError } from '../secrets.ts';
import { provisionBench } from './bench.ts';
import type { BenchInfo } from './bench.ts';
import { resolveAdminSource } from './source.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    ruedaBench: BenchInfo;
  }
}

const log = (line: string): void => {
  console.log(`[rueda-bench] ${line}`);
};

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const source = await resolveAdminSource();
  log(`source : ${source.label}`);
  let bench;
  try {
    bench = await provisionBench(source, log);
  } catch (error) {
    await source.stop().catch(() => undefined);
    throw redactError(error, [source.admin.password]);
  }
  project.provide('ruedaBench', bench.info);
  log(`bases prêtes : ${bench.info.database}, ${bench.info.productionDatabase}`);

  return async () => {
    try {
      await bench.teardown();
      log('banc supprimé');
    } finally {
      await source.stop();
    }
  };
}
