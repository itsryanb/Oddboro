// A stand-in for Claude Code, installed first on a throwaway office's PATH
// (office.ts). It answers `--version` and `auth status` like the real one,
// and plays each run from a list of plays (play.ts): the happy path's story in
// scenario.ts, or a scripted scenario's when the runner notes its file.
// It calls the office's own tool servers from the run's --mcp-config, so a
// file it writes and a task it gives the owner go through the same code a real
// run's would, then streams its reply in Claude Code's stream-json format.
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { MIN_VERSIONS } from '@oddboro/ledger/agents';
import type { Act, Play, PlayContext } from './play.ts';
import { fallbackReply, OWNER, SCRIPTS } from './scenario.ts';

type Server = { command: string; args?: string[]; env?: Record<string, string> };

const args = process.argv.slice(2);
const after = (flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
const line = (o: unknown) => process.stdout.write(`${JSON.stringify(o)}\n`);
const RUNS = process.env.ODDBORO_HAPPY_RUNS;
const note = (o: unknown) => RUNS && appendFileSync(RUNS, `${JSON.stringify(o)}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// These stay above the top-level await below, which runs a run before later lines are reached.
let asksOutcome = false;
const runId = randomUUID().slice(0, 8);
/**
 * What the scripted runner wrote down (`Throwaway.note`), read fresh each run:
 * the scenario playing now, its session, and what its plays need.
 */
const NOTES = process.env.ODDBORO_HAPPY_NOTES;
const notes: Record<string, unknown> =
  NOTES && existsSync(NOTES)
    ? (JSON.parse(readFileSync(NOTES, 'utf8')) as Record<string, unknown>)
    : {};
const session = typeof notes.session === 'string' ? notes.session : undefined;

if (args[0] === '--version') {
  process.stdout.write(`${MIN_VERSIONS.claude} (Claude Code)\n`);
} else if (args[0] === 'auth') {
  // Like a new owner who already uses Claude Code: signed in to their own
  // ~/.claude, while a folder the office made for an account starts signed
  // out until the owner signs it in (`auth login`, the welcome's "Sign in with
  // Claude"), which here succeeds at once.
  const config = process.env.CLAUDE_CONFIG_DIR;
  const mark = config && join(config, 'happy-signed-in');
  if (args[1] === 'login' && mark) {
    mkdirSync(config, { recursive: true });
    writeFileSync(mark, `${OWNER.toLowerCase()}@example.com`);
    process.stdout.write(`Signed in as ${OWNER.toLowerCase()}@example.com\n`);
    process.exit(0);
  }
  const loggedIn =
    !config || resolve(config) === join(homedir(), '.claude') || (!!mark && existsSync(mark));
  process.stdout.write(
    `${JSON.stringify(loggedIn ? { loggedIn, authMethod: 'claude.ai', email: `${OWNER.toLowerCase()}@example.com`, subscriptionType: 'max' } : { loggedIn })}\n`
  );
} else {
  await play();
}

/** The scenario playing now, or with none, the happy path's story. */
async function plays(): Promise<Play[]> {
  if (typeof notes.scenario !== 'string') return SCRIPTS;
  const m = (await import(pathToFileURL(notes.scenario).href)) as { default: { plays: Play[] } };
  return m.default.plays;
}

/** How many runs in this session played `index` before this one, for a play that runs `once`. */
function played(index: number): number {
  if (!RUNS || !existsSync(RUNS)) return 0;
  return readFileSync(RUNS, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { script?: number; session?: string })
    .filter((l) => l.script === index && l.session === session).length;
}

/**
 * The run's message. A chat reads stream-json (`--input-format stream-json`)
 * and keeps stdin open for more turns, so its first line is the message; any
 * other run sends plain text and closes stdin.
 */
async function readMessage(): Promise<string> {
  const streamed = after('--input-format') === 'stream-json';
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk;
    if (streamed && text.includes('\n')) break;
  }
  if (!streamed) return text;
  process.stdin.destroy();
  const turn = JSON.parse(text.slice(0, text.indexOf('\n'))) as {
    message?: { content?: { type: string; text?: string }[] };
  };
  return (turn.message?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
}

async function play() {
  const message = await readMessage();
  // Claude Code takes the system prompt either way, so the stand-in does too.
  const promptFile = after('--append-system-prompt-file');
  const system = promptFile
    ? readFileSync(promptFile, 'utf8')
    : (after('--append-system-prompt') ?? '');
  const odd = /You are (\w+)/.exec(system)?.[1] ?? 'an Odd';
  // A follow-up's message is only its label: what the owner answered is in the
  // "This run" section the office adds to the system prompt (`followThrough`).
  const thisRun = system.split('## This run')[1] ?? '';
  // Claude Code ends with an Outcome line only when the run asks for one, as
  // the office's follow-ups do; a chat reply has none.
  asksOutcome = /Outcome: done/.test(`${system}\n${message}`);
  // A chat in a new session opens with the chat so far: the owner's newest words come last.
  const said =
    message
      .trim()
      .split(/\n\s*\n/)
      .at(-1) ?? '';
  const list = await plays();
  const index = list.findIndex(
    (s, i) => s.odd === odd && s.when.test(`${said}\n${thisRun}`) && (!s.once || !played(i))
  );
  const script = index < 0 ? undefined : list[index];
  // Every run, for a failed step to show what each Odd was given.
  note({
    run: runId,
    session,
    odd,
    script: script ? index : null,
    message,
    thisRun: thisRun.slice(0, 6000),
    args
  });
  if (!script) return finish(fallbackReply(odd), 'done');

  const c: PlayContext = {
    odd,
    message,
    said,
    thisRun,
    system,
    home: process.env.ODDBORO_HOME ?? '',
    notes
  };
  const acts = typeof script.acts === 'function' ? script.acts(c) : script.acts;
  const config = after('--mcp-config');
  const servers: Record<string, Server> = config
    ? (JSON.parse(readFileSync(config, 'utf8')) as { mcpServers: Record<string, Server> })
        .mcpServers
    : {};
  const clients = new Map<string, Client>();
  try {
    for (const act of acts) {
      if ('think' in act) {
        await sleep(act.think);
        continue;
      }
      if ('exit' in act) {
        if (act.stderr) process.stderr.write(`${act.stderr}\n`);
        process.exit(act.exit);
      }
      if ('limit' in act) {
        line({ type: 'result', subtype: 'success', is_error: true, result: act.limit });
        return;
      }
      if ('hang' in act) {
        // A timer keeps the process alive; the office stops it when the run times out.
        await new Promise(() => setInterval(() => {}, 60_000));
        continue;
      }
      if ('usage' in act) {
        line({
          type: 'rate_limit_event',
          rate_limit_info: {
            unifiedWindows: {
              five_hour: {
                utilization: act.usage.fiveHour,
                resetsAt: Math.floor(Date.now() / 1000) + act.usage.resetsInMinutes * 60
              }
            }
          }
        });
        continue;
      }
      const [server, tool, input, must] = callFor(act);
      const r = await call(servers, clients, server, tool, input);
      note({ run: runId, call: tool, input, ok: !r.failed, text: r.text });
      if (r.failed && must) return finish(`${tool} failed: ${r.text}`, 'failed');
    }
  } finally {
    await Promise.all([...clients.values()].map((cl) => cl.close()));
  }
  finish(script.reply ?? `Done, ${OWNER}.`, script.outcome ?? 'done');
}

/** The tool an act calls, and whether a refusal ends the run. */
function callFor(
  act: Extract<Act, { write: string } | { task: unknown } | { call: string } | { read: string }>
): [string, string, Record<string, unknown>, boolean] {
  // Claude Code reads a relative path from the folder the run starts in, as
  // the stand-in does, where the files server would read it from the Odd's own.
  if ('write' in act)
    return ['files', 'write_file', { path: resolve(act.write), content: act.content }, true];
  if ('task' in act) return ['office', 'give_owner_a_task', act.task, true];
  if ('read' in act) return ['files', 'read_file', { path: resolve(act.read) }, false];
  return [act.server ?? 'office', act.call, act.input, false];
}

/** Calls one tool the way Claude Code would, with what it answered. */
async function call(
  servers: Record<string, Server>,
  clients: Map<string, Client>,
  server: string,
  tool: string,
  input: Record<string, unknown>
): Promise<{ failed: boolean; text: string }> {
  const s = servers[server];
  if (!s) return { failed: true, text: `the run has no ${server} server` };
  let client = clients.get(server);
  if (!client) {
    // Loaded only here: most runs (every hello) call no tool, and the SDK is slow to load.
    const [{ Client }, { StdioClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/stdio.js')
    ]);
    client = new Client({ name: 'happy-stand-in', version: '1.0.0' });
    // Claude Code hands a server its own whole environment under the config's;
    // the SDK alone would pass only a few safe names.
    const env = { ...(process.env as Record<string, string>), ...s.env };
    await client.connect(new StdioClientTransport({ command: s.command, args: s.args, env }));
    clients.set(server, client);
  }
  line({
    type: 'stream_event',
    event: { type: 'content_block_start', content_block: { type: 'tool_use', name: tool } }
  });
  const r = (await client.callTool({ name: tool, arguments: input }).catch((e: unknown) => ({
    isError: true,
    content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }]
  }))) as { isError?: boolean; content?: { type: string; text?: string }[] };
  const text = (r.content ?? []).map((c) => c.text ?? '').join(' ');
  return { failed: !!r.isError, text: text || (r.isError ? 'no reason given' : '') };
}

function finish(reply: string, outcome: string) {
  line({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: reply } }
  });
  line({
    type: 'result',
    subtype: 'success',
    result: asksOutcome ? `${reply}\nOutcome: ${outcome}` : reply
  });
}
