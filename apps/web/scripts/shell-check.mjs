/**
 * Contrôle visuel de la coquille à 360 px (US-048), par le protocole DevTools de Chrome, sans
 * dépendance : pour chaque écran, langue et mode, mesure le défilement horizontal et les cibles
 * tactiles (< 44 px = échec), puis enregistre une capture pleine page dans docs/design/US-048/.
 *
 * Usage (serveur démarré : `pnpm --filter @rueda/web build && pnpm --filter @rueda/web start`) :
 *   node apps/web/scripts/shell-check.mjs [http://localhost:3000] [chemin de chrome]
 * Sortie non nulle si un critère échoue. Outil local de captures pour la revue design : les mêmes
 * critères tournent en CI dans les parcours Playwright (`apps/web/e2e/`, US-041, job `e2e-web`).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3000';
const chromePath =
  process.argv[3] ??
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : 'google-chrome');
const outDir = resolve(import.meta.dirname, '../../../docs/design/US-048');
const WIDTH = 360;
const MIN_TARGET = 44;

// Locales lues dans la configuration (aucun pays dans le code) : la première de chaque langue.
const config = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../packages/i18n/config/locales.json'), 'utf8'),
);
const tagOf = (language) => config.locales.find((l) => l.language === language).tag;
const [es, en, fr, pt] = ['es', 'en', 'fr', 'pt'].map(tagOf);

const CASES = [
  { file: 'accueil-es-360', path: '/', lang: es, dark: false },
  { file: 'accueil-en-360', path: '/', lang: en, dark: false },
  { file: 'accueil-fr-360', path: '/', lang: fr, dark: false },
  { file: 'accueil-pt-360', path: '/', lang: pt, dark: false },
  { file: 'accueil-sombre-es-360', path: '/', lang: es, dark: true },
  { file: 'langue-ouverte-fr-360', path: '/', lang: fr, dark: false, openLanguage: true },
  { file: 'hors-ligne-es-360', path: '/offline', lang: es, dark: false },
  { file: 'hors-ligne-sombre-pt-360', path: '/offline', lang: pt, dark: true },
  { file: 'bandeau-hors-ligne-en-360', path: '/', lang: en, dark: false, offlineEvent: true },
  // Service worker réel : installé en ligne, puis page ouverte sans réseau → écran « Sin conexión ».
  { file: 'sw-hors-ligne-es-360', path: '/', lang: es, dark: false, serviceWorker: true },
];

const profile = mkdtempSync(join(tmpdir(), 'shell-check-'));
const chrome = spawn(
  chromePath,
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
const wsUrl = await new Promise((ok, ko) => {
  let buf = '';
  chrome.stderr.on('data', (d) => {
    buf += d;
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
    if (m) ok(m[1]);
  });
  setTimeout(() => ko(new Error('Chrome ne répond pas')), 15000);
});

const ws = new WebSocket(wsUrl);
await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));
let id = 0;
const pending = new Map();
const listeners = new Set();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { ok, ko } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) ko(new Error(msg.error.message));
    else ok(msg.result);
  } else for (const l of listeners) l(msg);
});
const send = (method, params = {}, sessionId) =>
  new Promise((ok, ko) => {
    pending.set(++id, { ok, ko });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MEASURE = `(() => {
  const small = [];
  for (const el of document.querySelectorAll('a[href], button, summary, input, select, textarea, [role="button"]')) {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (r.width === 0 || style.visibility === 'hidden') continue;
    if (el.matches('a') && el.closest('p') && style.display === 'inline') continue; // lien dans le texte (WCAG 2.5.8, exception)
    if (r.top < -r.height) continue; // lien d'évitement hors écran
    if (r.width < ${MIN_TARGET} || r.height < ${MIN_TARGET}) small.push((el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  return { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, small, lang: document.documentElement.lang };
})()`;

let failed = false;
mkdirSync(outDir, { recursive: true });
for (const c of CASES) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s('Page.enable');
  await s('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: 780,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await s('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: c.dark ? 'dark' : 'light' }],
  });
  await s('Network.enable');
  await s('Network.setExtraHTTPHeaders', { headers: { 'Accept-Language': c.lang } });
  const loaded = new Promise((ok) => {
    const l = (m) =>
      m.sessionId === sessionId &&
      m.method === 'Page.loadEventFired' &&
      (listeners.delete(l), ok());
    listeners.add(l);
  });
  // Le service worker n'hérite pas des en-têtes de la page : la langue passe par le cookie, comme
  // après un choix explicite (POST /locale).
  if (c.serviceWorker) await s('Network.setCookie', { name: 'locale', value: c.lang, url: base });
  await s('Page.navigate', { url: base + c.path });
  await loaded;
  await sleep(1500); // fin des animations d'entrée (≤ 1 s)
  if (c.openLanguage)
    await s('Runtime.evaluate', { expression: "document.querySelector('details').open = true" });
  if (c.serviceWorker) {
    await s('Runtime.evaluate', {
      expression:
        "navigator.serviceWorker.ready.then(() => new Promise((r) => setTimeout(r, 1500))).then(() => !!navigator.serviceWorker.controller || 'claimed')",
      awaitPromise: true,
    });
    const offline = { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
    await s('Network.emulateNetworkConditions', offline);
    // Le service worker a son propre réseau : le couper aussi.
    const { targetInfos } = await send('Target.getTargets');
    for (const t of targetInfos.filter((t) => t.type === 'service_worker')) {
      const { sessionId: sw } = await send('Target.attachToTarget', {
        targetId: t.targetId,
        flatten: true,
      });
      await send('Network.enable', {}, sw);
      await send('Network.emulateNetworkConditions', offline, sw);
    }
    const offlineLoaded = new Promise((ok) => {
      const l = (m) =>
        m.sessionId === sessionId &&
        m.method === 'Page.loadEventFired' &&
        (listeners.delete(l), ok());
      listeners.add(l);
    });
    await s('Page.navigate', { url: base + '/viajes' });
    await offlineLoaded;
    await sleep(800);
    const { result: h1 } = await s('Runtime.evaluate', {
      expression: "document.querySelector('h1')?.id",
      returnByValue: true,
    });
    if (h1.value !== 'offline-title') {
      failed = true;
      console.log(`ÉCHEC ${c.file} : écran hors ligne absent (h1 = ${String(h1.value)})`);
    }
  }
  if (c.offlineEvent) {
    await s('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await sleep(500);
  }
  await sleep(400);
  const { result } = await s('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
  const m = result.value;
  const overflow = m.scrollWidth > m.clientWidth;
  const ok = !overflow && m.small.length === 0;
  if (!ok) failed = true;
  console.log(
    `${ok ? 'OK  ' : 'ÉCHEC'} ${c.file} (lang=${m.lang}) largeur ${m.scrollWidth}/${m.clientWidth}` +
      (m.small.length ? ` ; cibles < ${MIN_TARGET} px : ${m.small.join(' | ')}` : ''),
  );
  const shot = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(outDir, `${c.file}.png`), Buffer.from(shot.data, 'base64'));
  await send('Target.closeTarget', { targetId });
}
ws.close();
chrome.kill();
process.exit(failed ? 1 : 0);
