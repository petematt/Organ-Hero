#!/usr/bin/env node
// Deterministic headless screenshot helper.
// Usage: node scripts/screenshot.mjs "<query>" <out.png> [width=1920] [height=1080] [waitSelector]
// Example: node scripts/screenshot.mjs "?screen=tipnote" /tmp/tip.png 1920 1080 .tip-note-card
// Builds nothing: run `npm run build` first. Serves dist via `vite preview`.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [query = '?autostart=1', out = '/tmp/shot.png', w = '1920', h = '1080', sel] =
  process.argv.slice(2);
const PORT = 4190 + Math.floor(Math.random() * 500);
const DEBUG = PORT + 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '' };

const vite = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], {
  stdio: 'ignore',
  env,
});
const chrome = spawn(
  'google-chrome',
  ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-proxy-server',
   `--remote-debugging-port=${DEBUG}`, `--window-size=${w},${h}`, 'about:blank'],
  { stdio: 'ignore', env }
);
const cleanup = () => { vite.kill(); chrome.kill(); };

try {
  let targets;
  for (let i = 0; i < 40 && !targets; i++) {
    await sleep(250);
    try { targets = await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json(); } catch {}
  }
  if (!targets) throw new Error('Chrome debug port never came up');
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 1;
  const send = (method, params = {}) =>
    new Promise((res) => {
      const cid = id++;
      const fn = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === cid) { ws.removeEventListener('message', fn); res(m.result); }
      };
      ws.addEventListener('message', fn);
      ws.send(JSON.stringify({ id: cid, method, params }));
    });
  await send('Emulation.setDeviceMetricsOverride', {
    width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 900,
  });
  // Retry navigation until vite preview is up and the app (not a chrome error page) has loaded
  const ev = async (expression) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true }))?.result?.value;
  for (let i = 0; i < 30; i++) {
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${query}` });
    await sleep(500);
    if (await ev('!!document.querySelector("canvas") && !document.title.includes("127.0.0.1")')) break;
  }
  if (sel) {
    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      found = (await send('Runtime.evaluate', { expression: `!!document.querySelector(${JSON.stringify(sel)})`, returnByValue: true })).result.value;
      if (!found) await sleep(250);
    }
    if (!found) throw new Error(`Selector never appeared: ${sel}`);
  }
  await sleep(300);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`saved ${out}`);
  ws.close();
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
