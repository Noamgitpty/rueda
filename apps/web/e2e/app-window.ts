/**
 * Fenêtre d'application installée (US-041, ADR-074) : Google Chrome lancé avec `--app=<origine>/`
 * ouvre le site dans la fenêtre d'une PWA installée (`display-mode: standalone`), sur un profil
 * persistant jetable (Chrome refuse d'installer depuis un contexte incognito). Le lanceur de
 * Playwright ne respecte pas `--app` pour un contexte persistant (il ouvre `about:blank`) : Chrome
 * est donc lancé ici, puis piloté par `connectOverCDP`, comme `scripts/shell-check.mjs` (US-048).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserType, Page } from '@playwright/test';

/** Chrome installé : `RUEDA_E2E_CHROME`, sinon l'emplacement standard du système. */
export function chromeExecutable(): string {
  const fromEnv = process.env['RUEDA_E2E_CHROME'];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  if (process.platform === 'win32') return 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  return 'google-chrome';
}

export interface AppWindow {
  readonly browser: Browser;
  readonly page: Page;
  close(): Promise<void>;
}

export async function openAppWindow(
  chromium: BrowserType,
  origin: string,
  options: { readonly lang: string },
): Promise<AppWindow> {
  const profile = mkdtempSync(join(tmpdir(), 'rueda-e2e-pwa-'));
  const chrome = spawn(
    chromeExecutable(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-component-extensions-with-background-pages',
      // Site local de test seulement ; le bac à sable non privilégié est interdit par AppArmor sur
      // les runners Ubuntu (même choix que le job `diagrammes`).
      '--no-sandbox',
      `--lang=${options.lang}`,
      `--accept-lang=${options.lang}`,
      `--app=${origin}/`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const cleanup = () => {
    chrome.kill();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  try {
    const wsUrl = await new Promise<string>((ok, ko) => {
      let buffer = '';
      const timer = setTimeout(() => ko(new Error('Chrome ne répond pas')), 15_000);
      chrome.on('error', ko);
      chrome.stderr.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
        if (m !== null) {
          clearTimeout(timer);
          ok(m[1] as string);
        }
      });
    });
    const browser = await chromium.connectOverCDP(wsUrl);
    const context = browser.contexts()[0];
    if (context === undefined) throw new Error('aucun contexte Chrome');
    const deadline = Date.now() + 10_000;
    let page = context.pages().find((p) => p.url().startsWith(origin));
    while (page === undefined && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      page = context.pages().find((p) => p.url().startsWith(origin));
    }
    if (page === undefined) throw new Error('fenêtre d’application absente');
    return {
      browser,
      page,
      close: async () => {
        await browser.close().catch(() => undefined);
        cleanup();
      },
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
