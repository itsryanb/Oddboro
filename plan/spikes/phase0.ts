// Phase 0 of plan/installed-app-testing.md. Installs a published Oddboro on
// this machine, runs it in isolation and records what works, so each open
// question in the plan gets an answer from a real GitHub runner. A spike: it
// keeps going after a failure and reports everything.
//
//   node plan/spikes/phase0.ts --artifact <installer|AppImage|dmg> \
//     --latest latest.json --out <dir> [--webdriver] [--relaunches 20]
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { connect } from 'node:net';
import { arch, homedir, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    artifact: { type: 'string' },
    latest: { type: 'string' },
    out: { type: 'string' },
    webdriver: { type: 'boolean', default: false },
    relaunches: { type: 'string' }
  }
});
if (!args.artifact || !args.latest || !args.out) {
  console.error('Needs --artifact, --latest and --out');
  process.exit(2);
}

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const LINUX = process.platform === 'linux';
const OUT = args.out;
const VERSION = (
  JSON.parse(readFileSync(args.latest, 'utf8').replace(/^﻿/, '')) as { version: string }
).version;
const RELAUNCHES = Number(args.relaunches ?? (WIN ? 20 : 5));
const PORT = 4590;
const DB_PORT = 54590;
const CDP = 9333;
const BASE = `http://127.0.0.1:${PORT}`;
const HOME = mkdtempSync(join(tmpdir(), 'oddboro-phase0-home-'));
// A release build installs any newer version before its server starts. An
// update address that refuses at once keeps the spike on the version it
// downloaded, even after a newer one ships.
const NO_UPDATES = 'https://127.0.0.1:9/latest.json';

mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (line: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${line}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Result = { step: string; ok: boolean; required: boolean; ms: number; detail: string };
const results: Result[] = [];

function describe(value: unknown): string {
  if (value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.replace(/\s+/g, ' ').slice(0, 400);
}

async function step<T>(
  name: string,
  required: boolean,
  f: () => Promise<T> | T
): Promise<T | undefined> {
  const started = Date.now();
  try {
    const value = await f();
    results.push({
      step: name,
      ok: true,
      required,
      ms: Date.now() - started,
      detail: describe(value)
    });
    log(`ok   ${name}: ${describe(value)}`);
    return value;
  } catch (e) {
    const detail = describe(e instanceof Error ? e.message : e);
    results.push({ step: name, ok: false, required, ms: Date.now() - started, detail });
    log(`FAIL ${name}: ${detail}`);
    return undefined;
  }
}

/** Runs a program and gives back its output, failure or not. */
function sh(cmd: string, argv: string[], timeout = 60_000): { code: number; out: string } {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', timeout });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

function run(cmd: string, argv: string[], timeout = 300_000): string {
  const r = sh(cmd, argv, timeout);
  if (r.code !== 0) throw new Error(`${cmd} ${argv.join(' ')} exited ${r.code}: ${r.out}`);
  return r.out;
}

const ps = (script: string) =>
  execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();

function tcp(port: number): Promise<boolean> {
  return new Promise((done) => {
    const s = connect({ host: '127.0.0.1', port });
    s.setTimeout(500, () => {
      s.destroy();
      done(false);
    });
    s.once('connect', () => {
      s.destroy();
      done(true);
    });
    s.once('error', () => done(false));
  });
}

async function until<T>(what: string, f: () => Promise<T | undefined>, secs: number): Promise<T> {
  const deadline = Date.now() + secs * 1000;
  while (Date.now() < deadline) {
    const value = await f().catch(() => undefined);
    if (value !== undefined) return value;
    await sleep(500);
  }
  throw new Error(`no ${what} within ${secs} s`);
}

async function getJson<T>(path: string, secs = 20): Promise<T> {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(secs * 1000) });
  if (!r.ok) throw new Error(`GET ${path}: ${r.status}`);
  return (await r.json()) as T;
}

async function send(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const r = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  });
  return { status: r.status, text: (await r.text()).slice(0, 160) };
}

function expectStatus(r: { status: number; text: string }, status: number): string {
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status} ${r.text}`);
  return `${r.status} ${r.text}`;
}

/** The headers the office's own page sends with a write. WebKit before macOS 13.3 sends no Sec-Fetch-Site. */
const pageHeaders = (secFetchSite: boolean): Record<string, string> => ({
  origin: BASE,
  'content-type': 'application/json',
  ...(secFetchSite ? { 'sec-fetch-site': 'same-origin' } : {})
});

function logFile(): string {
  if (WIN) return join(process.env.LOCALAPPDATA ?? '', 'Oddboro', 'Logs', 'office.log');
  if (MAC) return join(homedir(), 'Library', 'Logs', 'Oddboro', 'office.log');
  return join(
    process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'),
    'oddboro',
    'office.log'
  );
}

function logTail(lines = 15): string {
  if (!existsSync(logFile())) return '(no office.log)';
  return readFileSync(logFile(), 'utf8').trimEnd().split('\n').slice(-lines).join(' / ');
}

/** The office servers running on this machine: Node with the office's entry point. */
function officeNodes(): number[] {
  if (WIN)
    return ps(
      `@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'office.build.index\\.js' }).ProcessId -join ' '`
    )
      .split(/\s+/)
      .filter(Boolean)
      .map(Number);
  return sh('ps', ['-eo', 'pid=,args='])
    .out.split('\n')
    .filter((l) => l.includes('apps/office/build/index.js'))
    .map((l) => Number(l.trim().split(/\s+/)[0]));
}

/**
 * The shell itself, wherever the bundle put it. Only the program a process
 * runs counts, never its arguments: this script's own `--artifact` names the
 * AppImage.
 */
function shellPids(): number[] {
  if (WIN)
    return sh('tasklist', ['/FI', 'IMAGENAME eq oddboro.exe', '/FO', 'CSV', '/NH'])
      .out.split('\n')
      .map((l) => Number(l.split('","')[1]))
      .filter((pid) => pid > 0);
  return sh('ps', ['-eo', 'pid=,args='])
    .out.split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter(
      ([pid, program]) =>
        Number(pid) !== process.pid &&
        /(\/MacOS\/oddboro|\/usr\/bin\/oddboro|\.AppImage)$/.test(program ?? '')
    )
    .map(([pid]) => Number(pid));
}

/**
 * The Node the shell started last, from its "started node, pid N" line.
 * Listing processes takes seconds on the arm64 Windows runner, too slow to poll.
 */
function lastNodePid(): number | undefined {
  if (!existsSync(logFile())) return undefined;
  const found = [...readFileSync(logFile(), 'utf8').matchAll(/started node, pid (\d+)/g)].pop();
  return found ? Number(found[1]) : undefined;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killAll(): void {
  for (const pid of [...shellPids(), ...officeNodes()]) {
    if (WIN) sh('taskkill', ['/F', '/T', '/PID', String(pid)]);
    else sh('kill', ['-9', String(pid)]);
  }
}

/** Windows: the text of any message box the shell shows. Its dialogs are modal and block. */
function dialogText(pid: number): string {
  if (!WIN) return '';
  try {
    return ps(
      `Add-Type -AssemblyName UIAutomationClient; $r=[Windows.Automation.AutomationElement]::RootElement; ` +
        `$c=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty, ${pid}); ` +
        `@($r.FindAll('Children',$c) | Where-Object { $_.Current.ClassName -eq '#32770' } | ForEach-Object { ` +
        `(@($_.FindAll('Descendants',[Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name } | Where-Object { $_ }) -join ' | ') }) -join ' ;; '`
    );
  } catch {
    return '';
  }
}

// WebView2 joins a browser process already running on the same profile and
// ignores the new arguments, so the spike's runs get a profile of their own.
const WEBVIEW_PROFILE = WIN ? mkdtempSync(join(tmpdir(), 'oddboro-phase0-webview-')) : '';

function appEnv(): Record<string, string> {
  return {
    ODDBORO_PORT: String(PORT),
    ODDBORO_DB_PORT: String(DB_PORT),
    ODDBORO_HOME: HOME,
    ODDBORO_UPDATE_URL: NO_UPDATES,
    ...(WIN
      ? {
          WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP}`,
          WEBVIEW2_USER_DATA_FOLDER: WEBVIEW_PROFILE
        }
      : {})
  };
}

/** Why DevTools did not connect: the port, what it lists, and the WebView2 processes' debugging flags. */
async function devtoolsDiagnosis(): Promise<string> {
  const list = await fetch(`http://127.0.0.1:${CDP}/json/list`, {
    signal: AbortSignal.timeout(3000)
  }).then(
    (r) => r.text(),
    (e: unknown) => `error: ${e instanceof Error ? e.message : e}`
  );
  const tryPs = (script: string) => {
    try {
      return ps(script) || 'none';
    } catch (e) {
      return String(e);
    }
  };
  // The browser process's own command line shows whether it took the spike's
  // profile folder, and so whether any WEBVIEW2_ variable reached it.
  const browser = tryPs(
    `@(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' } | ForEach-Object { $_.CommandLine }) -join ' ;; '`
  );
  const version = tryPs(
    `@('HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}','HKLM:\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}','HKCU:\\Software\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' | ForEach-Object { (Get-ItemProperty $_ -ErrorAction SilentlyContinue).pv } | Where-Object { $_ }) -join ', '`
  );
  const policies = tryPs(
    `@('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge','HKCU:\\SOFTWARE\\Policies\\Microsoft\\Edge' | Where-Object { Test-Path $_ } | ForEach-Object { Get-ChildItem $_ -Recurse | ForEach-Object { $_.Name + ' = ' + (($_.Property | Select-Object -First 8) -join ',') } }) -join ' ;; '`
  );
  return `port ${CDP} open: ${await tcp(CDP)}; /json/list: ${describe(list)}; WebView2 runtime: ${version}; Edge policies: ${policies}; browser process: ${browser.slice(0, 900)}`;
}

const POLICY_KEY =
  'HKCU\\Software\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments';

const SHELL_LOG = join(OUT, 'shell.log');
let launches = 0;

/** The shell's own output goes to shell.log: the AppImage's launcher prints its errors there. */
function launch(exe: string): ChildProcess {
  appendFileSync(SHELL_LOG, `--- launch ${++launches}\n`);
  const fd = openSync(SHELL_LOG, 'a');
  const app = spawn(exe, [], { env: { ...process.env, ...appEnv() }, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  return app;
}

function shellTail(lines = 8): string {
  return readFileSync(SHELL_LOG, 'utf8').trimEnd().split('\n').slice(-lines).join(' / ');
}

/** Mac and Linux: a picture of the whole screen. Windows takes the page's own through DevTools. */
function screenshot(name: string): string {
  const file = join(OUT, name);
  if (MAC) run('screencapture', ['-x', file]);
  else if (LINUX) run('import', ['-window', 'root', file]);
  else throw new Error('Windows uses DevTools');
  return `${readFileSync(file).length} bytes`;
}

/**
 * Waits for the office to answer. A dialog, or the shell quitting, fails it.
 * Windows looks for a dialog only after 30 s, then every 15 s: one look takes
 * seconds on the arm64 runner and would blur a normal start's time.
 */
async function ready(app: ChildProcess, secs = 120): Promise<number> {
  const started = Date.now();
  let lookForDialog = 30_000;
  while (Date.now() - started < secs * 1000) {
    const answered = await fetch(`${BASE}/api/update`, { signal: AbortSignal.timeout(2000) }).then(
      (r) => r.ok,
      () => false
    );
    if (answered) return Date.now() - started;
    // On Linux the AppImage's launcher may hand off and exit 0, so only a failing exit counts there.
    if (app.exitCode !== null && (!LINUX || app.exitCode !== 0))
      throw new Error(
        `the shell exited ${app.exitCode} before the office answered. Shell: ${shellTail()}. Log: ${logTail()}`
      );
    if (WIN && Date.now() - started > lookForDialog) {
      lookForDialog += 15_000;
      const text = dialogText(app.pid ?? 0);
      if (text) throw new Error(`the shell shows a dialog: ${text}`);
    }
    await sleep(500);
  }
  const text = WIN ? dialogText(app.pid ?? 0) : '';
  throw new Error(
    `no answer within ${secs} s${text ? `; dialog: ${text}` : ''}. Shell: ${shellTail()}. Log: ${logTail()}`
  );
}

async function allGone(): Promise<boolean> {
  const node = lastNodePid();
  return !(await tcp(PORT)) && !(await tcp(DB_PORT)) && !(node && alive(node));
}

/**
 * Mac and Linux: SIGTERM, which takes the shell's normal quit. Windows has no
 * signal a script can send, so a kill, which closes Node's stdin.
 */
async function quit(app: ChildProcess): Promise<string> {
  const started = Date.now();
  if (WIN) app.kill();
  else app.kill('SIGTERM');
  const gone = () =>
    until('quit', async () => ((await allGone()) ? true : undefined), 15).then(
      () => true,
      () => false
    );
  if (await gone()) return `gone in ${Date.now() - started} ms`;
  if (!WIN) {
    const shells = shellPids();
    for (const pid of shells) sh('kill', ['-TERM', String(pid)]);
    if (await gone())
      return `the signal did not reach the shell; a SIGTERM to the shell itself (${shells.join(', ')}) quit it in ${Date.now() - started} ms`;
  }
  const node = lastNodePid();
  const left = `port ${PORT}: ${await tcp(PORT)}, port ${DB_PORT}: ${await tcp(DB_PORT)}, Node ${node ?? '?'} running: ${node ? alive(node) : '?'}`;
  killAll();
  throw new Error(`still running after the quit (${left}); killed`);
}

type Page = {
  evaluate(expression: string): Promise<unknown>;
  screenshot(): Promise<Buffer>;
  close(): void;
};

/** The office page in the real WebView2 window, over its DevTools port. */
async function devtoolsPage(): Promise<Page> {
  const target = await until(
    'DevTools page target',
    async () => {
      const r = await fetch(`http://127.0.0.1:${CDP}/json/list`, {
        signal: AbortSignal.timeout(2000)
      });
      const list = (await r.json()) as {
        type: string;
        url: string;
        webSocketDebuggerUrl: string;
      }[];
      return list.find((t) => t.type === 'page' && t.url.startsWith(BASE));
    },
    60
  );
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = fail;
  });
  let next = 0;
  const waiting = new Map<number, (m: { result?: Record<string, unknown> }) => void>();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as { id?: number; result?: Record<string, unknown> };
    if (m.id !== undefined) waiting.get(m.id)?.(m);
  };
  const call = (method: string, params: object) =>
    new Promise<{ result?: Record<string, unknown> }>((resolve) => {
      const id = ++next;
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  return {
    async evaluate(expression) {
      const m = await call('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
      });
      if (m.result?.exceptionDetails) throw new Error(describe(m.result.exceptionDetails));
      return (m.result?.result as { value?: unknown } | undefined)?.value;
    },
    async screenshot() {
      const m = await call('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(String(m.result?.data ?? ''), 'base64');
    },
    close: () => ws.close()
  };
}

/** Linux: drives the real window through tauri-driver and WebKitWebDriver, and records what it attaches to. */
async function webdriverProbe(appimage: string): Promise<string> {
  const driver = spawn('tauri-driver', ['--port', '4444'], {
    env: { ...process.env, ...appEnv() },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let driverLog = '';
  driver.stdout?.on('data', (d) => (driverLog += d));
  driver.stderr?.on('data', (d) => (driverLog += d));
  const wd = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:4444${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120_000)
    });
    return ((await r.json()) as { value: unknown }).value;
  };
  const seen: string[] = [];
  let session = '';
  try {
    await until('tauri-driver', async () => ((await wd('GET', '/status')) ? true : undefined), 30);
    const created = (await wd('POST', '/session', {
      capabilities: { alwaysMatch: { 'tauri:options': { application: appimage } } }
    })) as { sessionId?: string; message?: string };
    if (!created.sessionId) throw new Error(`no session: ${describe(created)}`);
    session = created.sessionId;
    let last = '';
    let onOffice = 0;
    // The session starts on the loading window, which closes once the office
    // answers. The office window then shows up as a new handle to switch to.
    for (let i = 0; i < 60 && onOffice < 3; i++) {
      const url = describe(await wd('GET', `/session/${session}/url`));
      const handles = (await wd('GET', `/session/${session}/window/handles`)) as string[];
      const now = `url ${url}, handles ${describe(handles)}`;
      if (now !== last) seen.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${now}`);
      last = now;
      if (url.includes('no such window') && Array.isArray(handles) && handles.length) {
        const handle = handles[handles.length - 1];
        const switched = describe(await wd('POST', `/session/${session}/window`, { handle }));
        seen.push(`switched to ${handle}: ${switched || 'ok'}`);
      }
      onOffice = url.includes(BASE) ? onOffice + 1 : 0;
      await sleep(1000);
    }
    let inPage = 'not tried: never reached the office page';
    if (onOffice >= 3)
      inPage = describe(
        await wd('POST', `/session/${session}/execute/async`, {
          script:
            "const done = arguments[arguments.length - 1]; fetch('/api/pokes/999999', { method: 'DELETE', headers: { 'content-type': 'application/json' } }).then((r) => done(r.status), (e) => done(String(e)))",
          args: []
        })
      );
    const shot = await wd('GET', `/session/${session}/screenshot`);
    if (typeof shot === 'string' && shot.length > 100)
      writeFileSync(join(OUT, 'webdriver.png'), Buffer.from(shot, 'base64'));
    return `seen: ${seen.join(' ; ')}. In-page DELETE: ${inPage}`;
  } catch (e) {
    throw new Error(
      `${e instanceof Error ? e.message : e}. Seen: ${seen.join(' ; ') || 'nothing'}`
    );
  } finally {
    if (session) await wd('DELETE', `/session/${session}`).catch(() => undefined);
    driver.kill();
    await sleep(2000);
    killAll();
    writeFileSync(join(OUT, 'tauri-driver.log'), driverLog);
  }
}

// --- The run ---

log(
  `Oddboro ${VERSION} on ${process.platform} ${arch()} ${release()}, image ${process.env.ImageOS ?? '?'} ${process.env.ImageVersion ?? ''}`
);
let exe = '';
let installDir = '';

if (MAC)
  await step('Keychain state before the first start', false, () =>
    [
      `list: ${sh('security', ['list-keychains']).out}`,
      `default: ${sh('security', ['default-keychain']).out}`,
      `login: ${sh('security', ['show-keychain-info', join(homedir(), 'Library/Keychains/login.keychain-db')]).out}`
    ].join(' / ')
  );

await step('install', true, async () => {
  if (WIN) {
    run(args.artifact!, ['/S']);
    installDir = join(process.env.LOCALAPPDATA ?? '', 'Oddboro');
    exe = join(installDir, 'oddboro.exe');
  } else if (MAC) {
    // /Applications, as an owner would. The first run copied it under
    // /var/folders, and /var is a symlink, which the app refuses.
    const mount = mkdtempSync(join(tmpdir(), 'oddboro-dmg-'));
    run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, args.artifact!]);
    installDir = '/Applications/Oddboro.app';
    sh('rm', ['-rf', installDir]);
    run('ditto', [join(mount, 'Oddboro.app'), installDir]);
    sh('hdiutil', ['detach', mount]);
    const name = run('plutil', [
      '-extract',
      'CFBundleExecutable',
      'raw',
      '-o',
      '-',
      join(installDir, 'Contents', 'Info.plist')
    ]);
    exe = join(installDir, 'Contents', 'MacOS', name);
  } else {
    chmodSync(args.artifact!, 0o755);
    exe = args.artifact!;
  }
  if (!existsSync(exe)) throw new Error(`${exe} is not there`);
  return exe;
});
if (!exe) {
  finish();
}

if (WIN) {
  await step('uninstall entry names the version', true, () => {
    const got = ps(
      `(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Where-Object DisplayName -eq 'Oddboro').DisplayVersion`
    );
    if (got !== VERSION) throw new Error(`DisplayVersion ${got || 'missing'}, not ${VERSION}`);
    return got;
  });
  await step('Start menu shortcut (notifications need it)', false, () => {
    const lnk = join(
      process.env.APPDATA ?? '',
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Oddboro.lnk'
    );
    if (!existsSync(lnk)) throw new Error(`${lnk} is missing`);
    return lnk;
  });
  await step('the silent install leaves the app closed', false, async () => {
    await sleep(5000);
    const running = shellPids();
    if (running.length) {
      killAll();
      sh('taskkill', ['/F', '/IM', 'msedgewebview2.exe']);
      await sleep(3000);
      throw new Error(`it opened Oddboro (${running.join(', ')}); closed it and its WebView2`);
    }
    return 'nothing running';
  });
  await step('file version of oddboro.exe', true, () => {
    const got = ps(`(Get-Item -LiteralPath '${exe}').VersionInfo.ProductVersion`);
    if (got !== VERSION && got !== `${VERSION}.0`) throw new Error(`${got}, not ${VERSION}`);
    return got;
  });
}

if (MAC) {
  await step('Info.plist names the version', true, () => {
    const got = run('plutil', [
      '-extract',
      'CFBundleShortVersionString',
      'raw',
      '-o',
      '-',
      join(installDir, 'Contents', 'Info.plist')
    ]);
    if (got !== VERSION) throw new Error(`${got}, not ${VERSION}`);
    return got;
  });
  await step('codesign --verify --deep --strict', false, () =>
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', installDir])
  );
  await step("Gatekeeper's verdict (spctl)", false, () =>
    run('spctl', ['--assess', '--type', 'execute', '-vv', installDir])
  );
  await step('notarization ticket stapled', false, () =>
    run('xcrun', ['stapler', 'validate', installDir])
  );
}

let app = launch(exe);
const firstStart = await step('first start answers', true, () =>
  ready(app).then((ms) => `${ms} ms`)
);

if (firstStart) {
  await step('reports the version it is', true, async () => {
    const { current } = await getJson<{ current: string }>('/api/update');
    if (current !== VERSION) throw new Error(`${current}, not ${VERSION}`);
    return current;
  });
  await step('a write with no Origin is refused', true, async () =>
    expectStatus(await send('DELETE', '/api/pokes/999999', {}), 403)
  );
  await step('a page-shaped write with Sec-Fetch-Site reaches its route', true, async () =>
    expectStatus(await send('DELETE', '/api/pokes/999999', pageHeaders(true)), 404)
  );
  await step('a page-shaped write with Origin only reaches its route', true, async () =>
    expectStatus(await send('DELETE', '/api/pokes/999999', pageHeaders(false)), 404)
  );
  await step("0.0.5's request shape, for the record (#25)", false, async () => {
    const r = await send('DELETE', '/api/pokes/999999', { origin: BASE });
    return `${r.status} ${r.text}`;
  });
  await step('setup checks, with the database ok', true, async () => {
    // The checks start programs (claude --version and others): over 20 s on the arm64 Windows runner.
    const { checks } = await getJson<{ checks: { id: string; state: string; found: string }[] }>(
      '/api/setup',
      90
    );
    const summary = checks.map((c) => `${c.id}: ${c.state} (${c.found})`).join('; ');
    if (checks.find((c) => c.id === 'database')?.state !== 'ok') throw new Error(summary);
    return summary;
  });
  await step('onboarding with a ready-made manager', true, async () =>
    expectStatus(
      await send('POST', '/api/onboarding', pageHeaders(true), {
        name: 'Phase Zero',
        zone: 'America/Los_Angeles',
        manager: { preset: 'marshall' }
      }),
      200
    )
  );

  if (WIN) {
    let page: Page | undefined;
    await step('the real page renders (DevTools)', true, async () => {
      page = await devtoolsPage().catch(async (e: unknown) => {
        throw new Error(`${e instanceof Error ? e.message : e}. ${await devtoolsDiagnosis()}`);
      });
      await until(
        'page text',
        async () =>
          String(await page!.evaluate('document.body?.innerText ?? ""')).trim() ? true : undefined,
        60
      );
      return await page.evaluate('document.title');
    });
    if (page) {
      await step('an in-page DELETE, as call() sends it, reaches its route', true, async () => {
        const status = await page!.evaluate(
          "fetch('/api/pokes/999999', { method: 'DELETE', headers: { 'content-type': 'application/json' } }).then((r) => r.status)"
        );
        if (status !== 404) throw new Error(`got ${status}`);
        return status;
      });
      await step('screenshot of the real page', false, async () => {
        const png = await page!.screenshot();
        writeFileSync(join(OUT, 'page.png'), png);
        return `${png.length} bytes`;
      });
      page.close();
    }
  }
  if (MAC) {
    await sleep(3000);
    await step('screenshot (screencapture)', false, () => screenshot('screen.png'));
    await step('window list (System Events, needs Accessibility)', false, () =>
      run(
        'osascript',
        [
          '-e',
          `tell application "System Events" to get name of every window of (first process whose unix id is ${app.pid})`
        ],
        20_000
      )
    );
  }
  if (LINUX) {
    await sleep(3000);
    await step('screenshot (Xvfb)', false, () => screenshot('screen.png'));
    await step('window names (xdotool)', false, () =>
      run('xdotool', ['search', '--name', 'Oddboro', 'getwindowname', '%@'], 20_000)
    );
  }

  await step('quits with Node and both ports gone', true, () => quit(app));

  await step(`relaunches ${RELAUNCHES} times right after a quit`, true, async () => {
    const starts: number[] = [];
    for (let i = 1; i <= RELAUNCHES; i++) {
      app = launch(exe);
      try {
        starts.push(await ready(app));
        if (i === 1) {
          const setup = await getJson<{ welcomed?: boolean }>('/api/setup', 90);
          if (!setup.welcomed) throw new Error('it forgot the onboarding');
        }
        await quit(app);
      } catch (e) {
        killAll();
        throw new Error(
          `launch ${i}: ${e instanceof Error ? e.message : e}. Starts so far (ms): ${starts.join(', ')}`
        );
      }
    }
    return `starts (ms): ${starts.join(', ')}`;
  });
} else {
  if (!WIN)
    await step('screenshot of the failed start', false, () => screenshot('failed-start.png'));
  killAll();
}

// The second run found the WebView2 browser on the runners started without the
// debugging flag from the environment. WebView2 also reads its arguments from
// a registry key per program, so try that.
if (WIN && installDir && firstStart && !results.some((r) => r.step.includes('DevTools') && r.ok))
  await step('DevTools through the WebView2 registry key', false, async () => {
    run('reg', [
      'add',
      POLICY_KEY,
      '/v',
      'oddboro.exe',
      '/t',
      'REG_SZ',
      '/d',
      `--remote-debugging-port=${CDP}`,
      '/f'
    ]);
    const viaKey = launch(exe);
    try {
      await ready(viaKey);
      const page = await devtoolsPage().catch(async (e: unknown) => {
        throw new Error(`${e instanceof Error ? e.message : e}. ${await devtoolsDiagnosis()}`);
      });
      await until(
        'page text',
        async () =>
          String(await page.evaluate('document.body?.innerText ?? ""')).trim() ? true : undefined,
        60
      );
      const title = await page.evaluate('document.title');
      const status = await page.evaluate(
        "fetch('/api/pokes/999999', { method: 'DELETE', headers: { 'content-type': 'application/json' } }).then((r) => r.status)"
      );
      writeFileSync(join(OUT, 'page.png'), await page.screenshot());
      page.close();
      return `connected: title "${title}", in-page DELETE ${status}, page.png saved`;
    } finally {
      await quit(viaKey).catch(() => killAll());
      sh('reg', ['delete', POLICY_KEY, '/f']);
    }
  });

if (WIN && installDir)
  await step('uninstalls silently', false, async () => {
    sh(join(installDir, 'uninstall.exe'), ['/S']);
    await until('the app removed', async () => (!existsSync(exe) ? true : undefined), 90);
    const entries = () =>
      ps(
        `@(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Where-Object DisplayName -eq 'Oddboro').Count`
      );
    const left = await until(
      'the uninstall entry removed',
      async () => (entries() === '0' ? '0' : undefined),
      60
    ).catch(() => entries());
    return `oddboro.exe removed; uninstall entries left: ${left}; the office's home ${existsSync(HOME) ? 'kept' : 'removed'}`;
  });

// Finding from the first run: started from a folder reached through a symlink
// (/var is one), the app did not start. This shows what the owner would see.
if (MAC && installDir)
  await step('a copy reached through a symlink (/var/folders)', false, async () => {
    const apps = mkdtempSync(join(tmpdir(), 'oddboro-symlinked-'));
    run('ditto', [installDir, join(apps, 'Oddboro.app')]);
    const linked = launch(exe.replace(installDir, join(apps, 'Oddboro.app')));
    const outcome = await ready(linked, 30).then(
      (ms) => `started in ${ms} ms: no symlink problem`,
      (e: unknown) => `did not start: ${e instanceof Error ? e.message : e}`
    );
    await sleep(2000);
    const shot = screenshot('symlinked-start.png');
    const dialog = sh(
      'osascript',
      [
        '-e',
        `tell application "System Events" to get value of every static text of every window of (first process whose unix id is ${linked.pid})`
      ],
      20_000
    ).out;
    killAll();
    return `${outcome}. On screen: ${dialog || 'no text found'}. Screenshot symlinked-start.png (${shot})`;
  });

if (LINUX && args.webdriver)
  await step('WebDriver: what it attaches to', false, () => webdriverProbe(exe));

finish();

function finish(): never {
  if (existsSync(logFile())) copyFileSync(logFile(), join(OUT, 'office.log'));
  const failed = results.filter((r) => r.required && !r.ok);
  const env = `${process.platform} ${arch()} ${release()}, image ${process.env.ImageOS ?? '?'} ${process.env.ImageVersion ?? ''}`;
  writeFileSync(
    join(OUT, 'results.json'),
    JSON.stringify({ version: VERSION, env, results }, null, 2) + '\n'
  );
  const cell = (s: string) => s.replace(/\|/g, '\\|');
  const summary = [
    `### Oddboro ${VERSION}: ${failed.length ? `${failed.length} required step(s) failed` : 'every required step passed'}`,
    '',
    env,
    '',
    '| Step | Result | Time | Detail |',
    '| --- | --- | --- | --- |',
    ...results.map(
      (r) =>
        `| ${cell(r.step)} | ${r.ok ? 'ok' : r.required ? '**FAIL**' : 'no'} | ${r.ms} ms | ${cell(r.detail)} |`
    ),
    ''
  ].join('\n');
  writeFileSync(join(OUT, 'summary.md'), summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  // One annotation with every result: GitHub's API serves a public repo's
  // annotations to anyone, while its logs and artifacts need a login.
  if (process.env.GITHUB_ACTIONS) {
    const escape = (t: string) =>
      t.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    const lines = results.map(
      (r) =>
        `${r.ok ? 'ok' : r.required ? 'FAIL' : 'no'} | ${r.step} | ${r.ms} ms | ${r.detail.slice(0, 300)}`
    );
    console.log(`::notice title=Phase 0 results::${escape([env, ...lines].join('\n'))}`);
  }
  log(failed.length ? `${failed.length} required step(s) failed` : 'every required step passed');
  process.exit(failed.length ? 1 : 0);
}
