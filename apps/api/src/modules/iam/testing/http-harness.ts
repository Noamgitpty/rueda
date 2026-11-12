/**
 * Application Nest de test des routes /auth — TESTS SEULEMENT. Démarre IamAuthModule sur un port
 * éphémère avec le magasin donné (FAKE ou PostgreSQL) et capture TOUTES les sorties de journal
 * (logger Nest, stdout, stderr) pour vérifier qu'aucun jeton n'y apparaît.
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import type { DynamicModule, INestApplication, LoggerService, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AuthStore } from '../internal/auth-store.js';
import { IamAuthModule } from '../internal/iam-auth.module.js';
import type { PhoneOtpOptions } from '../internal/iam-auth.module.js';
import { Argon2idPasswordHasher } from '../internal/password-hasher.js';
import { DEFAULT_AUTH_POLICY } from '../internal/policy.js';
import type { AuthPolicy } from '../internal/policy.js';
import { RecordingIdentityNotifier } from './recording-notifier.js';

/** Paramètres argon2id réduits : vitesse des tests (la production garde les défauts). */
export const FAST_HASHER = new Argon2idPasswordHasher({
  memoryKiB: 1024,
  passes: 1,
  parallelism: 1,
  saltLength: 16,
  tagLength: 32,
});

export class CapturingLogger implements LoggerService {
  readonly lines: string[] = [];
  #push(level: string, message: unknown, rest: unknown[]) {
    this.lines.push(
      [level, message, ...rest]
        .map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : String(x)))
        .join(' '),
    );
  }
  log(message: unknown, ...rest: unknown[]) {
    this.#push('log', message, rest);
  }
  error(message: unknown, ...rest: unknown[]) {
    this.#push('error', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]) {
    this.#push('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]) {
    this.#push('debug', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]) {
    this.#push('verbose', message, rest);
  }
}

export interface AuthHttpHarness {
  readonly url: string;
  readonly notifier: RecordingIdentityNotifier;
  /** Logger Nest + stdout + stderr pendant la vie de l'application. */
  readonly output: () => string;
  close(): Promise<void>;
}

export async function startAuthApp(
  store: AuthStore,
  options: {
    policy?: AuthPolicy;
    clock?: () => number;
    imports?: Type[];
    /** OTP du téléphone (US-104) ; absent : OTP indisponible. */
    phone?: PhoneOtpOptions;
  } = {},
): Promise<AuthHttpHarness> {
  const notifier = new RecordingIdentityNotifier();
  const logger = new CapturingLogger();
  const captured: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  const tap = (write: typeof out) =>
    ((chunk: unknown, ...rest: unknown[]) => {
      captured.push(String(chunk));
      return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof out;
  process.stdout.write = tap(out);
  process.stderr.write = tap(err);

  @Module({})
  class TestRoot {
    static register(): DynamicModule {
      return {
        module: TestRoot,
        imports: [
          IamAuthModule.register({
            store,
            notifier,
            hasher: FAST_HASHER,
            policy: options.policy ?? DEFAULT_AUTH_POLICY,
            ...(options.clock !== undefined ? { clock: options.clock } : {}),
            ...(options.phone !== undefined ? { phone: options.phone } : {}),
          }),
          // modules consommateurs : ils n'importent PAS IamAuthModule (module global)
          ...(options.imports ?? []),
        ],
      };
    }
  }

  let app: INestApplication;
  try {
    app = await NestFactory.create(TestRoot.register(), { logger });
    await app.listen(0, '127.0.0.1');
  } catch (error) {
    process.stdout.write = out;
    process.stderr.write = err;
    throw error;
  }
  const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  return {
    url,
    notifier,
    output: () => [...logger.lines, ...captured].join('\n'),
    close: async () => {
      try {
        await app.close();
      } finally {
        process.stdout.write = out;
        process.stderr.write = err;
      }
    },
  };
}

/** Requête JSON ; renvoie statut, corps (JSON ou null) et en-têtes Set-Cookie. */
export async function call(
  base: string,
  method: 'GET' | 'POST',
  path: string,
  options: { body?: unknown; cookie?: string; contentType?: string | null } = {},
): Promise<{ status: number; body: unknown; setCookie: string[]; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (options.cookie !== undefined) headers['cookie'] = options.cookie;
  const contentType = options.contentType === undefined ? 'application/json' : options.contentType;
  if (method === 'POST' && contentType !== null) headers['content-type'] = contentType;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(method === 'POST' ? { body: JSON.stringify(options.body ?? {}) } : {}),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text.length > 0 ? (JSON.parse(text) as unknown) : null,
    setCookie: response.headers.getSetCookie(),
    headers: response.headers,
  };
}

/** Valeur du cookie de session dans un en-tête Set-Cookie. */
export function sessionTokenFrom(setCookie: readonly string[]): string | null {
  for (const c of setCookie) {
    const m = /^__Host-session=([^;]*)/.exec(c);
    if (m) return m[1] ?? null;
  }
  return null;
}
