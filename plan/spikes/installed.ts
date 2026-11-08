import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exe = join(process.env.LOCALAPPDATA!, 'Oddboro', 'oddboro.exe');
const port = 4591;
const cdp = 9333;
const home = mkdtempSync(join(tmpdir(), 'oddboro-spike-'));
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

const app = spawn(exe, [], {
  env: {
    ...process.env,
    ODDBORO_PORT: String(port),
    ODDBORO_DB_PORT: '54591',
    ODDBORO_HOME: home,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdp}`
  },
  stdio: 'ignore',
  detached: false
});
log(`launched shell pid ${app.pid}, home ${home}`);

async function until<T>(what: string, f: () => Promise<T | undefined>, secs = 120): Promise<T> {
  for (let i = 0; i < secs * 2; i++) {
    const v = await f().catch(() => undefined);
    if (v !== undefined) return v;
    if (app.exitCode !== null)
      throw new Error(`shell exited ${app.exitCode} while waiting for ${what}`);
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${what}`);
}

try {
  const status = await until('server', async () => {
    const r = await fetch(`${base}/api/update`, { signal: AbortSignal.timeout(2000) });
    return r.ok ? ((await r.json()) as { current: string }) : undefined;
  });
  log(`server answers; running version: ${status.current}`);

  const noOrigin = await fetch(`${base}/api/pokes/999999`, { method: 'DELETE' });
  log(`DELETE with no Origin (a foreign client): ${noOrigin.status}`);
  const pageLike = await fetch(`${base}/api/pokes/999999`, {
    method: 'DELETE',
    headers: { origin: base, 'content-type': 'application/json' }
  });
  log(`DELETE as the page sends it (Origin + JSON): ${pageLike.status} ${await pageLike.text()}`);
  const old25 = await fetch(`${base}/api/pokes/999999`, {
    method: 'DELETE',
    headers: { origin: base }
  });
  log(
    `DELETE as 0.0.5's page sent it (Origin, no content type): ${old25.status} ${(await old25.text()).slice(0, 80)}`
  );

  const targets = await until(
    'CDP',
    async () => {
      const r = await fetch(`http://127.0.0.1:${cdp}/json/list`, {
        signal: AbortSignal.timeout(2000)
      });
      const list = (await r.json()) as {
        type: string;
        url: string;
        webSocketDebuggerUrl: string;
      }[];
      return list.find((t) => t.type === 'page' && t.url.startsWith(base)) ? list : undefined;
    },
    60
  );
  log(`CDP targets: ${targets.map((t) => `${t.type} ${t.url}`).join(' | ')}`);
  const page = targets.find((t) => t.type === 'page' && t.url.startsWith(base))!;

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const send = (method: string, params: object) =>
    new Promise<any>((resolve) => {
      const my = ++id;
      ws.addEventListener('message', function on(e) {
        const m = JSON.parse(String(e.data));
        if (m.id === my) {
          ws.removeEventListener('message', on);
          resolve(m.result);
        }
      });
      ws.send(JSON.stringify({ id: my, method, params }));
    });
  const evaluate = async (expression: string) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    return r.exceptionDetails
      ? 'THREW ' + JSON.stringify(r.exceptionDetails).slice(0, 200)
      : r.result.value;
  };

  await until(
    'page rendered',
    async () =>
      String(await evaluate('document.body?.innerText ?? ""')).trim().length > 0 ? true : undefined,
    60
  );
  log('page rendered');
  log(
    `page title: ${await evaluate('document.title')}; text: ${String(
      await evaluate('document.body.innerText')
    )
      .replace(/\s+/g, ' ')
      .slice(0, 120)}`
  );
  log(
    `in-page DELETE, as the page's call() sends it: ${await evaluate(
      `fetch('/api/pokes/999999',{method:'DELETE',headers:{'content-type':'application/json'}}).then(async r=>r.status+' '+(await r.text()))`
    )}`
  );
  log(
    `in-page DELETE, as 0.0.5 sent it: ${await evaluate(
      `fetch('/api/pokes/999999',{method:'DELETE'}).then(async r=>r.status+' '+(await r.text()).slice(0,80))`
    )}`
  );
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot?.data) {
    (await import('node:fs')).writeFileSync(
      join(tmpdir(), 'oddboro-installed-shot.png'),
      Buffer.from(shot.data, 'base64')
    );
  }
  log(`screenshot: ${shot?.data ? Math.round((shot.data.length * 0.75) / 1024) + ' kB' : 'none'}`);
  ws.close();
} catch (e) {
  log(`FAILED: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  app.kill();
  await sleep(4000);
  const still = await fetch(`${base}/`, { signal: AbortSignal.timeout(1000) }).then(
    () => true,
    () => false
  );
  log(`after killing the shell, server still answers: ${still}`);
  log(`home has: ${existsSync(join(home, 'version')) ? 'version file' : 'no version file'}`);
  rmSync(home, { recursive: true, force: true });
}
