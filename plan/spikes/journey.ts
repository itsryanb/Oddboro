import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exe = join(process.env.LOCALAPPDATA!, 'Oddboro', 'oddboro.exe');
const port = 4592;
const home = mkdtempSync(join(tmpdir(), 'oddboro-journey-'));
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const page = { origin: base, 'content-type': 'application/json' };

function launch(): ChildProcess {
  return spawn(exe, [], {
    env: {
      ...process.env,
      ODDBORO_PORT: String(port),
      ODDBORO_DB_PORT: '54592',
      ODDBORO_HOME: home
    },
    stdio: 'ignore'
  });
}
async function ready(app: ChildProcess) {
  for (let i = 0; i < 240; i++) {
    const ok = await fetch(`${base}/api/update`, { signal: AbortSignal.timeout(2000) }).then(
      (r) => r.ok,
      () => false
    );
    if (ok) return;
    if (app.exitCode !== null) throw new Error(`shell exited ${app.exitCode}`);
    await sleep(500);
  }
  throw new Error('never answered');
}
async function quit(app: ChildProcess) {
  app.kill();
  for (let i = 0; i < 40; i++) {
    if (
      !(await fetch(`${base}/`, { signal: AbortSignal.timeout(500) }).then(
        () => true,
        () => false
      ))
    )
      return;
    await sleep(250);
  }
  throw new Error('server still up 10s after the shell went');
}

let app = launch();
try {
  await ready(app);
  log('first start answered');
  const setup = (await (await fetch(`${base}/api/setup`)).json()) as {
    checks?: { id: string; state: string; found: string }[];
  } & Record<string, unknown>;
  log(`GET /api/setup keys: ${Object.keys(setup).join(', ')}`);
  for (const c of setup.checks ?? []) log(`  check ${c.id}: ${c.state} (${c.found})`);
  const onboard = await fetch(`${base}/api/onboarding`, {
    method: 'POST',
    headers: page,
    body: JSON.stringify({
      name: 'Smoke',
      zone: 'America/Los_Angeles',
      manager: { preset: 'marshall' }
    })
  });
  log(`POST /api/onboarding: ${onboard.status} ${(await onboard.text()).slice(0, 160)}`);
  await quit(app);
  log('quit cleanly');

  app = launch();
  await ready(app);
  log('second start answered');
  const after = (await (await fetch(`${base}/api/setup`)).json()) as Record<string, unknown>;
  log(`after restart: ${JSON.stringify(after).slice(0, 300)}`);
} catch (e) {
  log(`FAILED: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await quit(app).catch((e) => log(String(e)));
  rmSync(home, { recursive: true, force: true });
}
