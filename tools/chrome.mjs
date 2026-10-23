// Pilotage de Chrome pour le test de bout en bout : profil temporaire, mode headless,
// extension chargée par la commande DevTools Extensions.loadUnpacked (Chrome ≥ 126),
// et interception des requêtes (Fetch) pour servir des pages et des réponses simulées.
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Client CDP minimal sur le « pipe » de débogage (messages JSON séparés par \0). */
function connect(proc) {
  const decoder = new TextDecoder();
  let buffer = '';
  let id = 0;
  const pending = new Map();
  const listeners = [];
  proc.stdio[4].on('data', (chunk) => {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (msg.id && pending.has(msg.id)) {
        const { ok, ko } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) ko(new Error(msg.error.message)); else ok(msg.result);
      } else {
        for (const fn of listeners) fn(msg);
      }
    }
  });
  return {
    send: (method, params = {}, sessionId) => new Promise((ok, ko) => {
      const msgId = ++id;
      pending.set(msgId, { ok, ko });
      proc.stdio[3].write(`${JSON.stringify({ id: msgId, method, params, sessionId })}\0`);
    }),
    on: (fn) => listeners.push(fn),
  };
}

/**
 * Lance Chrome avec une copie de l'extension.
 * `patch(dir)` permet de modifier la copie (ex. Shadow DOM ouvert pour lire le panneau).
 */
export async function launch({ chromePath = process.env.CHROME_PATH, width = 1400, height = 950, patch } = {}) {
  if (!chromePath) throw new Error('Définissez CHROME_PATH (par ex. /Applications/Google Chrome.app/Contents/MacOS/Google Chrome).');
  const work = join(tmpdir(), `loyer-juste-chrome-${Date.now()}`);
  const ext = join(work, 'extension');
  cpSync(fileURLToPath(new URL('../extension', import.meta.url)), ext, { recursive: true });
  patch?.(ext);

  // User-Agent sans « HeadlessChrome », aligné sur la version réelle du navigateur.
  const major = (execFileSync(chromePath, ['--version'], { encoding: 'utf8' }).match(/(\d+)\.\d+\.\d+\.\d+/) || [])[1] || '140';
  const ua = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  const proc = spawn(chromePath, [
    '--headless', '--no-sandbox', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    `--user-data-dir=${join(work, 'profile')}`, '--no-first-run', '--no-default-browser-check',
    `--window-size=${width},${height}`, `--user-agent=${ua}`, '--lang=fr-FR', '--hide-scrollbars', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const cdp = connect(proc);

  const { product } = await cdp.send('Browser.getVersion');
  const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: ext });

  /**
   * Intercepte les requêtes d'une cible : `respond(url)` renvoie { status, type, body } ou null (requête refusée).
   */
  async function intercept(sessionId, respond) {
    cdp.on(async (msg) => {
      if (msg.sessionId !== sessionId || msg.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = msg.params;
      const res = await respond(request.url);
      if (!res) {
        await cdp.send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' }, sessionId).catch(() => {});
        return;
      }
      const body = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
      await cdp.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: res.status || 200,
        responseHeaders: [{ name: 'Content-Type', value: res.type || 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
        body: body.toString('base64'),
      }, sessionId).catch(() => {});
    });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'http*' }] }, sessionId);
  }

  async function openPage(url, { scale = 1, colorScheme, w = width, h = height, respond } = {}) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    if (respond) await intercept(sessionId, respond);
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: false }, sessionId);
    if (colorScheme) await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: colorScheme }] }, sessionId);
    await cdp.send('Page.navigate', { url }, sessionId);
    return sessionId;
  }

  async function evaluate(sessionId, expression) {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  }

  async function screenshot(sessionId, file, clip) {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }, sessionId);
    writeFileSync(file, Buffer.from(data, 'base64'));
  }

  async function click(sessionId, x, y) {
    for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sessionId);
  }

  async function close() {
    proc.kill();
    await sleep(500);
    rmSync(work, { recursive: true, force: true });
  }

  return { cdp, product, extId, openPage, intercept, evaluate, screenshot, click, close };
}
