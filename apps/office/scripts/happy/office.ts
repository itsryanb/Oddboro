// A throwaway office from this checkout, for the happy path (run.ts) and the
// scripted scenarios (scripted.ts). Nothing it does reaches the owner's own
// office:
// - the office's home, .env, ports, and the HOME its runs see all sit in one
//   temp folder;
// - Claude Code is stand-in.ts, first on the office's PATH;
// - secrets go through the app shell's pipe protocol (ODDBORO_SECRETS=shell),
//   answered here from memory, so the office never opens this computer's
//   secret store.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { Sql } from 'postgres';
import type { RunLine } from './play.ts';

export type Choice = { kind: 'choice'; options: string[] };
export type Task = {
  id: number;
  staffId: string | null;
  title: string;
  steps: { text: string; done: boolean; action?: Choice | { kind: string } }[];
};
export type OfficeState = {
  staff: { id: string; name: string }[];
  desk: { asks: { id: number; title: string; kind?: string }[]; tasks: Task[] };
  working: Record<string, string>;
  inProgress: Record<string, unknown[]>;
};
export type Chat = { history: unknown[]; busy: boolean };
export type Look = { look: unknown; portraitPx: string };

const APP = fileURLToPath(new URL('../..', import.meta.url));
const REPO = fileURLToPath(new URL('../../../..', import.meta.url));
const STAND_IN = new URL('./stand-in.ts', import.meta.url).href;
const MANAGERS = new URL('../../../../packages/ledger/src/managers.ts', import.meta.url).href;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Checks again every 25 ms until `check` gives something, or fails after `ms`. */
export async function until<T>(what: string, check: () => Promise<T | undefined>, ms = 20_000) {
  const end = Date.now() + ms;
  for (;;) {
    const found = await check().catch(() => undefined);
    if (found) return found;
    if (Date.now() > end) throw new Error(`Gave up waiting for ${what} after ${ms / 1000} s`);
    await sleep(25);
  }
}

export function expect(ok: unknown, problem: string) {
  if (!ok) throw new Error(problem);
}

/** Nobody running or waiting for a slot. */
export const settled = (o: OfficeState) =>
  !Object.keys(o.working).length && Object.values(o.inProgress).every((w) => !w.length);

const freePort = () =>
  new Promise<number>((done, fail) => {
    const s = createServer()
      .once('error', fail)
      .listen(0, '127.0.0.1', () => {
        const { port } = s.address() as { port: number };
        s.close(() => done(port));
      });
  });

export type Throwaway = ReturnType<typeof throwaway>;

/** How long a throwaway office waits on a quiet run before it gives up (ODDBORO_RUN_TIMEOUT_MS in staff.ts). */
export const RUN_TIMEOUT_MS = 15_000;

/**
 * One office in a new temp folder. `env` adds to the office's own environment.
 * With `attach`, the office is one already running from that folder, kept open
 * by the run that made it (`npm run happy -- --watch` or `--hold`): its ports
 * are in the folder's office.json, and nothing is made, started, stopped or
 * removed.
 */
export function throwaway(opts: {
  label: string;
  say: (text: string) => void;
  env?: Record<string, string>;
  attach?: string;
}) {
  const here = opts.attach;
  const root = here ?? mkdtempSync(join(tmpdir(), `oddboro-${opts.label}-`));
  const officeHome = join(root, 'office');
  const runHome = join(root, 'home');
  const bin = join(root, 'bin');
  const envFile = join(root, 'office.env');
  const logFile = join(root, 'office.log');
  const runsFile = join(root, 'runs.jsonl');
  const notesFile = join(root, 'notes.json');
  const portsFile = join(root, 'office.json');
  if (here && !existsSync(portsFile))
    throw new Error(`${root} holds no throwaway office: it has no office.json.`);
  const ports = here
    ? (JSON.parse(readFileSync(portsFile, 'utf8')) as { port: number; dbPort: number })
    : undefined;
  if (!here) {
    for (const d of [officeHome, runHome, bin]) mkdirSync(d);
    writeFileSync(envFile, '# A throwaway office. Removed when every step passes.\n');
    writeFileSync(logFile, '');
  }
  if (!existsSync(notesFile)) writeFileSync(notesFile, '{}');
  const recent: string[] = [];
  let env: NodeJS.ProcessEnv = ports ? { ODDBORO_DB_PORT: String(ports.dbPort) } : {};
  let child: ReturnType<typeof spawn> | undefined;
  let db: Sql | undefined;

  function log(text: string) {
    appendFileSync(logFile, `${text}\n`);
    // The summary after a failure skips the line the dev server logs per request.
    if (/^\d{3} [A-Z]+ \//.test(text)) return;
    recent.push(text.replace(/\x1b\[[0-9;]*m/g, ''));
    if (recent.length > 40) recent.shift();
  }

  /** Claude Code's stand-in, laid out where the office looks for Claude Code on this system. */
  function installStandIn() {
    // A stand-in that throws is written down in runs.jsonl, so the report can say so.
    const launcher = `#!/usr/bin/env node
import(${JSON.stringify(STAND_IN)}).catch(async (e) => {
  console.error(e);
  const runs = process.env.ODDBORO_HAPPY_RUNS;
  if (runs) {
    const { appendFileSync } = await import('node:fs');
    const crash = String((e && e.stack) || e);
    appendFileSync(runs, JSON.stringify({ odd: '?', script: null, message: '', crash }) + '\\n');
  }
  process.exit(1);
});
`;
    if (process.platform !== 'win32') {
      writeFileSync(join(bin, 'claude'), launcher);
      chmodSync(join(bin, 'claude'), 0o755);
      return;
    }
    // Node will not start a .cmd without a shell, so on Windows the office runs
    // an npm install's own script under its Node instead (`npmCommand` in the
    // ledger's platform.ts). The stand-in is laid out the way npm lays out Claude Code.
    const pkg = join(bin, 'node_modules', '@anthropic-ai', 'claude-code');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({ name: '@anthropic-ai/claude-code', bin: { claude: 'cli.mjs' } })
    );
    writeFileSync(join(pkg, 'cli.mjs'), launcher);
    writeFileSync(
      join(bin, 'claude.cmd'),
      '@node "%~dp0node_modules\\@anthropic-ai\\claude-code\\cli.mjs" %*\r\n'
    );
  }

  /**
   * The owner already uses Claude Code a lot, as Oddboro's owners do: 400
   * projects in ~/.claude/projects. Every run reads rules for each one, and on
   * 0.0.9 an owner like this could not start a run on Windows ("spawn
   * ENAMETOOLONG"), so an empty home would hide that kind of bug.
   */
  function seedClaudeProjects() {
    const projects = join(runHome, '.claude', 'projects');
    for (let i = 1; i <= 400; i++)
      mkdirSync(join(projects, `C--Users-pat-source-repos-project-${String(i).padStart(3, '0')}`), {
        recursive: true
      });
  }

  function officeEnv(port: number, dbPort: number): NodeJS.ProcessEnv {
    const own: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env))
      // The owner's own office settings and keys stay out, and so does Node's
      // test marker, which home.ts reads as "never use a real home".
      if (!/^(ODDBORO_|OFFICE_|ANTHROPIC_|DATABASE_URL$|NODE_TEST_CONTEXT$|NODE_OPTIONS$)/.test(k))
        own[k] = v;
    // Windows spells it Path, and a second PATH beside it would be a coin toss.
    const pathKey = Object.keys(own).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    own[pathKey] = `${bin}${delimiter}${own[pathKey] ?? ''}`;
    return {
      ...own,
      ODDBORO_HOME: officeHome,
      ODDBORO_ENV: envFile,
      ODDBORO_PORT: String(port),
      ODDBORO_DB_PORT: String(dbPort),
      ODDBORO_SECRETS: 'shell',
      ODDBORO_NO_LATEST: '1',
      // The Dev window (src/lib/dev/): a throwaway office is where it belongs.
      ODDBORO_DEV_TOOLS: '1',
      ODDBORO_HAPPY_RUNS: runsFile,
      ODDBORO_HAPPY_NOTES: notesFile,
      ODDBORO_RUN_TIMEOUT_MS: String(RUN_TIMEOUT_MS),
      // Ollama off: a port nothing listens on refuses at once instead of waiting.
      OLLAMA_URL: 'http://127.0.0.1:9',
      HOME: runHome,
      USERPROFILE: runHome,
      ...opts.env
    };
  }

  /**
   * A migrated, empty database to copy in. PGlite takes seconds to make a new
   * one and well under one to open a copy, so one is kept in node_modules/.cache,
   * named for the migrations and PGlite's version, and made again when either
   * changes.
   */
  async function templateDb(): Promise<string> {
    const migrations = join(REPO, 'packages', 'ledger', 'migrations');
    const hash = createHash('sha256');
    for (const f of readdirSync(migrations, { recursive: true }).map(String).sort()) {
      const p = join(migrations, f);
      if (statSync(p).isFile()) hash.update(f).update(readFileSync(p));
    }
    hash.update(
      readFileSync(join(REPO, 'node_modules', '@electric-sql', 'pglite', 'package.json'))
    );
    const cache = join(REPO, 'node_modules', '.cache', 'oddboro-happy');
    const dir = join(cache, `db-${hash.digest('hex').slice(0, 12)}`);
    if (existsSync(dir)) return dir;
    opts.say('  (making the database template, once per migration change)');
    // Made aside and moved in whole, so a run stopped halfway leaves no broken template.
    const making = join(cache, `making-${process.pid}`);
    const code = `const { startLocalDatabase } = await import(${JSON.stringify(new URL('../../../../packages/ledger/src/local-db.ts', import.meta.url).href)});
const stop = await startLocalDatabase();
const { bringUpToDate } = await import(${JSON.stringify(new URL('../../../../packages/ledger/src/upgrade.ts', import.meta.url).href)});
await bringUpToDate();
await stop();
process.exit(0);`;
    const made = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: REPO,
      env: { ...env, ODDBORO_HOME: making, ODDBORO_DB_PORT: String(await freePort()) },
      encoding: 'utf8',
      windowsHide: true
    });
    if (made.status !== 0) throw new Error(`Making the database template failed: ${made.stderr}`);
    for (const old of readdirSync(cache))
      if (old.startsWith('db-')) rmSync(join(cache, old), { recursive: true, force: true });
    renameSync(join(making, 'db'), dir);
    rmSync(making, { recursive: true, force: true });
    return dir;
  }

  function launch() {
    const vite = join(
      dirname(createRequire(join(APP, 'package.json')).resolve('vite/package.json')),
      'bin',
      'vite.js'
    );
    const c = spawn(process.execPath, [vite, 'dev'], {
      cwd: APP,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    const secrets = new Map<string, string>();
    createInterface({ input: c.stdout }).on('line', (text) => {
      if (!text.startsWith('oddboro:secret ')) return log(text);
      const ask = JSON.parse(text.slice('oddboro:secret '.length)) as {
        id: number;
        op: string;
        account?: string;
        value?: string;
      };
      if (ask.op === 'set' && ask.account) secrets.set(ask.account, ask.value ?? '');
      if (ask.op === 'remove' && ask.account) secrets.delete(ask.account);
      c.stdin.write(
        `${JSON.stringify({ id: ask.id, ok: true, secrets: Object.fromEntries(secrets), accounts: [] })}\n`
      );
    });
    createInterface({ input: c.stderr }).on('line', log);
    return c;
  }

  const t = {
    root,
    officeHome,
    logFile,
    runsFile,
    recent,
    log,
    base: ports ? `http://127.0.0.1:${ports.port}` : '',
    /** Whether the office's server is still up; an office attached to is taken as up. */
    up: () => !!here || (!!child && child.exitCode === null),

    /** The folder, the stand-in and the environment. */
    async prepare() {
      if (here) return;
      installStandIn();
      seedClaudeProjects();
      const [port, dbPort] = [await freePort(), await freePort()];
      env = officeEnv(port, dbPort);
      t.base = `http://127.0.0.1:${port}`;
      // For a scripted scenario to attach to while the office stays open.
      writeFileSync(portsFile, JSON.stringify({ port, dbPort }));
    },

    /** Copies the database in, starts the server, and waits until it answers. */
    async start() {
      if (here) return;
      cpSync(await templateDb(), join(officeHome, 'db'), { recursive: true });
      const c = launch();
      child = c;
      const ended = new Promise<never>((_, fail) =>
        c.once('exit', (code) => fail(new Error(`The office stopped with code ${code}`)))
      );
      ended.catch(() => {});
      // Waits only while nothing answers: a server error as it starts is the failure itself.
      const answered = until(
        'the office to answer',
        () => fetch(`${t.base}/api/setup`).then((r) => r),
        120_000
      );
      const res = await Promise.race([answered, ended]);
      if (!res.ok)
        throw new Error(
          `The office answered ${res.status} as it started: ${(await res.text()).slice(0, 400)}`
        );
    },

    async stop() {
      await db?.end({ timeout: 1 }).catch(() => {});
      db = undefined;
      const c = child;
      if (!c || c.exitCode !== null) return;
      const gone = new Promise((done) => c.once('exit', done));
      // Windows has no signal that reaches the server's own children, so the whole tree goes.
      if (process.platform === 'win32')
        spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { windowsHide: true });
      else c.kill('SIGTERM');
      await Promise.race([gone, sleep(5000)]);
      if (c.exitCode === null) c.kill('SIGKILL');
    },

    /** Removes the folder, once the office is down. */
    remove() {
      if (!here) rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    },

    async api<T>(path: string, body?: unknown, method?: string): Promise<T> {
      const verb = method ?? (body === undefined ? 'GET' : 'POST');
      const res = await fetch(t.base + path, {
        method: verb,
        // The office takes actions only from its own page (owner-page.ts).
        headers: { origin: t.base, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${verb} ${path} answered ${res.status}: ${text.slice(0, 300)}`);
      return (res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text) as T;
    },

    /**
     * The office's own database, over its local socket, for what no route
     * shows and for the clock (scripted.ts). Each write fires the same
     * NOTIFY a write from the office would, so its clock looks again.
     */
    async sql(): Promise<Sql> {
      if (db) return db;
      const { default: postgres } = await import('postgres');
      db = postgres(`postgres://postgres:postgres@127.0.0.1:${env.ODDBORO_DB_PORT}/postgres`, {
        max: 1,
        onnotice: () => {}
      });
      return db;
    },

    written(odd: string, name: string) {
      const f = join(officeHome, 'staff', odd, name);
      return existsSync(f) ? readFileSync(f, 'utf8') : undefined;
    },

    /** Every run the stand-in played, in the order each started, with the tools it called. */
    runs(): RunLine[] {
      if (!existsSync(runsFile)) return [];
      const lines = readFileSync(runsFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      const byRun = new Map<string, RunLine>();
      for (const l of lines) {
        const id = String(l.run ?? `crash-${byRun.size}`);
        if (!l.call) byRun.set(id, { ...(l as RunLine), calls: [] });
        else byRun.get(id)?.calls.push(l as unknown as RunLine['calls'][number]);
      }
      return [...byRun.values()];
    },

    /** Values the stand-in's plays read (`PlayContext.notes`), such as a thread's number. */
    note(key: string, value: unknown) {
      const notes = JSON.parse(readFileSync(notesFile, 'utf8')) as Record<string, unknown>;
      writeFileSync(notesFile, JSON.stringify({ ...notes, [key]: value }));
    },

    /** The ready-made managers' looks, read in a process of its own so its database module never loads here. */
    looks(): Promise<Record<string, Look>> {
      const code = `const { MANAGERS, managerPortrait } = await import(${JSON.stringify(MANAGERS)});
process.stdout.write(JSON.stringify(Object.fromEntries(MANAGERS.filter((m) => m.look).map((m) => [m.id, { look: m.look, portraitPx: managerPortrait(m.id) }]))));`;
      return new Promise((done, fail) => {
        const c = spawn(process.execPath, ['--input-type=module', '-e', code], {
          cwd: REPO,
          env,
          windowsHide: true
        });
        let out = '';
        let err = '';
        c.stdout.on('data', (d) => (out += d));
        c.stderr.on('data', (d) => (err += d));
        c.on('exit', (code) =>
          code === 0 ? done(JSON.parse(out)) : fail(new Error(`Reading the looks failed: ${err}`))
        );
      });
    }
  };
  return t;
}
