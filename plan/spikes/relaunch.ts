import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exe = join(process.env.LOCALAPPDATA!, 'Oddboro', 'oddboro.exe');
const port = 4594;
const db = 54594;
const home = mkdtempSync(join(tmpdir(), 'oddboro-relaunch-'));
const base = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(2)}s] ${m}`);
const ps = (cmd: string) =>
  execFileSync('powershell', ['-NoProfile', '-Command', cmd]).toString().trim();
const tcp = (p: number) =>
  new Promise<boolean>((r) => {
    const s = connect({ host: '127.0.0.1', port: p });
    s.setTimeout(500, () => {
      s.destroy();
      r(false);
    });
    s.once('connect', () => {
      s.destroy();
      r(true);
    });
    s.once('error', () => r(false));
  });
const owners = (p: number) =>
  ps(
    `@(Get-NetTCPConnection -LocalPort ${p} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $o = $_.OwningProcess; "$($o):$((Get-Process -Id $o -ErrorAction SilentlyContinue).Name)" }) -join ' '`
  );
const launch = () =>
  spawn(exe, [], {
    env: {
      ...process.env,
      ODDBORO_PORT: String(port),
      ODDBORO_DB_PORT: String(db),
      ODDBORO_HOME: home
    },
    stdio: 'ignore'
  });
const up = () =>
  fetch(`${base}/api/update`, { signal: AbortSignal.timeout(1500) }).then(
    (r) => r.ok,
    () => false
  );

let app: ChildProcess = launch();
try {
  for (let i = 0; i < 120 && !(await up()); i++) await sleep(500);
  log('first start answered');
  await (await fetch(`${base}/api/setup`)).json();
  log(`GET /api/setup done; listeners on ${port}: ${owners(port)}; on ${db}: ${owners(db)}`);
  await fetch(`${base}/api/onboarding`, {
    method: 'POST',
    headers: { origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Smoke',
      zone: 'America/Los_Angeles',
      manager: { preset: 'marshall' }
    })
  });
  log('onboarded');
  await sleep(500);
  app.kill();
  for (
    let i = 0;
    i < 20 &&
    (await fetch(`${base}/`, { signal: AbortSignal.timeout(500) }).then(
      () => true,
      () => false
    ));
    i++
  )
    await sleep(250);
  log(
    `shell killed, http down. tcp ${port}: ${await tcp(port)} [${owners(port)}], tcp ${db}: ${await tcp(db)} [${owners(db)}]`
  );

  app = launch();
  log(`relaunched, pid ${app.pid}`);
  for (let i = 0; i < 50; i++) {
    if (await up()) {
      log('second start answered: no stall this time');
      break;
    }
    if (app.exitCode !== null) {
      log(`shell exited ${app.exitCode}`);
      break;
    }
    if (i === 49) {
      log(
        `STALLED 25s. tcp ${port}: ${await tcp(port)} [${owners(port)}], tcp ${db}: ${await tcp(db)} [${owners(db)}]`
      );
      log(
        `shell windows: ${ps(`Add-Type -AssemblyName UIAutomationClient; $r=[Windows.Automation.AutomationElement]::RootElement; $c=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty, ${app.pid}); @($r.FindAll('Children',$c) | ForEach-Object { $_.Current.Name + ' :: ' + (@($_.FindAll('Descendants',[Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name } | Where-Object { $_ }) -join ' | ') }) -join ' ;; '`)}`
      );
    }
    await sleep(500);
  }
} catch (e) {
  log(`FAILED: ${(e as Error).message}`);
} finally {
  app.kill();
  await sleep(1500);
  rmSync(home, { recursive: true, force: true });
}
