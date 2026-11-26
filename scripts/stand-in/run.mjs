// What a stand-in AI tool does in a run: Claude Code, Grok, Codex or Gemini,
// for the office's tests (apps/office/src/lib/server/office-under-test.ts) and
// the installed app's smoke test (apps/desktop/scripts/driver.ts, `stubClaude`).
// Each of those writes a small program named after the tool that answers the
// tool's other commands (its version, its sign-in) and hands a run to `run`.
//
// A run reads its message as the tool does, plays the steps the message's last
// line names (`stepsIn`), in order, and prints each in that tool's own output
// format. Only the last line, since a later prompt can quote an earlier
// message. A run whose steps end nothing ends on the tool's usual reply, which
// carries what the office gave it (`gave` in each tool below). Plain Node, no
// dependencies, since the tool's own Node runs it.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * With this variable set, a stand-in exits 0 before it reads its input, as a
 * tool that fails as it starts does. A variable, not a step: the message comes
 * on stdin, so no step could be read without reading it.
 */
export const EXIT_BEFORE_READING = 'ODDBORO_STAND_IN_EXIT_BEFORE_READING';

/** The named scenarios `Play the scenario <name>.` finds: a file of step lines each. */
export const SCENARIOS = fileURLToPath(new URL('./scenarios/', import.meta.url));

/**
 * The steps a line names, in the order it names them. Each is a sentence:
 *
 * - `Hold until <file> exists.` waits for the file.
 * - `Think aloud: <words>.` streams the words as the reply's text.
 * - `Call <server> <tool> with <json>` calls that tool of the run's own
 *   server, for real, and shows the call as the tool does. It runs to the end
 *   of its line, so it is a scenario file's line.
 * - `Use <n> tokens in and <m> out.` is the usage the reply reports.
 * - `Reply: <words>` ends on a reply of exactly those words, to the line's end.
 * - `Fail now.` says "The stand-in failed as told." on stderr, sends the tool's
 *   failed result and exits 1.
 * - `Exit with an error.` says so on stderr and exits 3, with no result, as a
 *   tool that crashed does.
 * - `Hang.` never ends.
 * - `Start a command and wait.` starts a node process in a group of its own,
 *   writes its pid to command.pid in the run's folder, and never ends. The
 *   command needs its own group: in the tool's, the stop on the run's end would
 *   reach it through that group alone, so a test of the stop that walks the
 *   tree would pass with no walk.
 * - `Leave a sleeper at <file>` starts a `sleep` that outlives the run, in its
 *   process group, and writes its pid there.
 * - `Stay until <file> exists.` keeps the tool running after its reply, as a
 *   tool that takes a moment to exit, until the file is there.
 * - `Replay <file>` ends on that recorded stream, from Grok or Codex.
 * - `Play the scenario <name or file>.` plays a scenario file's steps, a line
 *   at a time: a name is a file in `SCENARIOS`, `<name>.txt`.
 *
 * Claude Code alone takes these, each a shape only its stream has:
 * `Succeed with an error.`, `Succeed with no text.`, `Fail and go on.`,
 * `Send it whole too.`, `Plan used: <share>` and
 * `Refuse the open network.` (or `... and wait.`). Gemini alone takes a line
 * that ends `End in error`.
 */
export function stepsIn(line) {
  const found = [];
  const at = (re, make) => {
    for (const m of line.matchAll(re)) found.push({ index: m.index, step: make(m) });
  };
  at(/Hold until (\/[^\s"\\]+) exists\./g, (m) => ({ hold: m[1] }));
  at(/Think aloud: ([^.]+)\./g, (m) => ({ say: m[1] }));
  at(/Call ([\w-]+) ([\w-]+)(?: with (\{.*\}))?\s*$/g, (m) => ({
    call: { server: m[1], tool: m[2], input: m[3] ? JSON.parse(m[3]) : {} }
  }));
  at(/Use (\d+) tokens in and (\d+) out\./g, (m) => ({
    usage: { input: Number(m[1]), output: Number(m[2]) }
  }));
  at(/Reply: (.*)$/g, (m) => ({ reply: m[1].trim() }));
  at(/Fail now\./g, () => ({ fail: true }));
  at(/Exit with an error\./g, () => ({ crash: true }));
  at(/\bHang\./g, () => ({ hang: true }));
  at(/Start a command and wait\./g, () => ({ command: true }));
  at(/Leave a sleeper at (\/\S+)/g, (m) => ({ sleeper: m[1] }));
  at(/Stay until (\/\S+) exists/g, (m) => ({ stay: m[1] }));
  at(/Replay (\/[^\r\n]+\.jsonl)\s*$/g, (m) => ({ replay: m[1] }));
  at(/Play the scenario ([^\s]+?)\.(?=\s|$)/g, (m) => ({ play: m[1] }));
  at(/Succeed with an error\./g, () => ({ claude: 'success-error' }));
  at(/Succeed with no text\./g, () => ({ claude: 'success-empty' }));
  at(/Fail and go on\./g, () => ({ claude: 'fail-and-go-on' }));
  at(/Send it whole too\./g, () => ({ claude: 'whole-too' }));
  at(/Plan used: (0\.\d+)/g, (m) => ({ plan: Number(m[1]) }));
  at(/Refuse the open network( and wait)?\./g, (m) => ({ refuse: { wait: !!m[1] } }));
  at(/End in error\s*$/g, () => ({ gemini: 'end-in-error' }));
  return found.sort((a, b) => a.index - b.index).map((f) => f.step);
}

/** The steps of a scenario file, by its name in `SCENARIOS` or its own path. */
export function scenario(nameOrFile) {
  const file = path.isAbsolute(nameOrFile) ? nameOrFile : path.join(SCENARIOS, `${nameOrFile}.txt`);
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#'))
    .flatMap(stepsIn);
}

const lastOf = (text) => text.trimEnd().split('\n').at(-1) ?? '';
const write = (o) => new Promise((r) => process.stdout.write(JSON.stringify(o) + '\n', r));
const forever = () => new Promise(() => setInterval(() => {}, 60_000));

function emptyFolder(p) {
  try {
    return fs.readdirSync(p).length === 0;
  } catch {
    return false;
  }
}

const untilThere = (file) =>
  new Promise((r) => {
    const wait = setInterval(() => fs.existsSync(file) && (clearInterval(wait), r()), 20);
  });

/**
 * One call to a tool of a command server, as an MCP client: the server
 * started with its own variables over the tool's, `initialize`, then
 * `tools/call`. Its reply's text, or why it failed.
 */
async function callTool(server, tool, input) {
  if (!server?.command) throw new Error('the run has no such command server');
  const child = spawn(server.command, server.args ?? [], {
    env: { ...process.env, ...(server.env ?? {}) },
    stdio: ['pipe', 'pipe', 'ignore']
  });
  const waiting = new Map();
  let lines = '';
  const gone = new Promise((_, no) =>
    child.once('exit', (code) =>
      no(new Error(`the server ended (exit ${code}) before it answered`))
    )
  );
  gone.catch(() => {});
  child.stdout.on('data', (d) => {
    lines += d;
    let nl;
    while ((nl = lines.indexOf('\n')) >= 0) {
      const line = lines.slice(0, nl).trim();
      lines = lines.slice(nl + 1);
      if (!line) continue;
      const m = JSON.parse(line);
      waiting.get(m.id)?.(m);
    }
  });
  let id = 0;
  const ask = (method, params) =>
    Promise.race([
      new Promise((r) => {
        waiting.set(++id, r);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      }),
      gone
    ]);
  try {
    await ask('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'oddboro-stand-in', version: '1' }
    });
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
    );
    const answer = await ask('tools/call', { name: tool, arguments: input });
    if (answer.error) throw new Error(answer.error.message);
    const text = (answer.result?.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    if (answer.result?.isError) throw new Error(text);
    return text;
  } finally {
    child.stdin.end();
    child.kill();
  }
}

function startCommand() {
  const command = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], {
    detached: true,
    stdio: 'ignore'
  });
  fs.writeFileSync('command.pid', String(command.pid));
}

function failNow(result) {
  process.stderr.write('The stand-in failed as told.\n', () =>
    process.stdout.write(JSON.stringify(result) + '\n', () => process.exit(1))
  );
}

/**
 * Play `steps` for one run in `tool`'s shape, then the tool's usual reply when
 * no step ended the run. `tool` says how the tool streams: `open()` before its
 * first line, `say`, `calling` and `called` around a call, `reply`, `failed`,
 * `own(step)` for a step only it takes, and `usual()`, its reply when no step
 * says one.
 */
async function play(steps, tool) {
  let usage;
  let replied = false;
  const later = [];
  let opened = false;
  const open = async () => {
    if (!opened) await tool.open?.();
    opened = true;
  };
  const queue = [...steps];
  while (queue.length && !replied) {
    const s = queue.shift();
    if (s.play) queue.unshift(...scenario(s.play));
    else if (s.hold) await untilThere(s.hold);
    else if (s.say) await open().then(() => tool.say(s.say));
    else if (s.usage) usage = s.usage;
    else if (s.call) {
      await open();
      await tool.calling(s.call);
      let text;
      try {
        text = await callTool(tool.server(s.call.server), s.call.tool, s.call.input);
      } catch (e) {
        process.stderr.write(
          `The stand-in's call to ${s.call.server} ${s.call.tool} failed: ${e.message}\n`,
          () => process.exit(4)
        );
        return forever();
      }
      await tool.called(s.call, text);
    } else if (s.reply !== undefined) {
      await open();
      await tool.reply(s.reply, usage);
      replied = true;
    } else if (s.fail) return failNow(tool.failed('Failed as told.'));
    else if (s.crash)
      return process.stderr.write('The stand-in exited as told.\n', () => process.exit(3));
    else if (s.hang) return forever();
    else if (s.command) {
      startCommand();
      return forever();
    } else if (s.sleeper) {
      const sleeper = spawn('sleep', ['60'], { stdio: 'ignore' });
      fs.writeFileSync(s.sleeper, String(sleeper.pid));
      sleeper.unref();
    } else if (s.stay) later.push(s.stay);
    else if (s.replay) {
      tool.replaying?.();
      process.stdout.write(fs.readFileSync(s.replay, 'utf8'));
      return;
    } else await tool.own?.(s);
  }
  if (!replied) {
    await open();
    await tool.usual(usage);
  }
  for (const file of later) await untilThere(file);
}

/** The message, from stdin, then `go` with it. */
function onStdin(go) {
  let message = '';
  process.stdin.on('data', (d) => (message += d));
  process.stdin.on('end', () => go(message));
}

const after = (args, flag) => args[args.indexOf(flag) + 1];

/** A run's file or inline JSON, as each tool's flags take one. */
const fileOrInline = (v) => JSON.parse(v.startsWith('{') ? v : fs.readFileSync(v, 'utf8'));

/**
 * Claude Code's run, `claude -p` with `--output-format stream-json`. Its
 * message comes on stdin. With --input-format stream-json it starts on its
 * first user line, as Claude Code does, and keeps each user line after it,
 * text only, in "added" (Send now), answering all of them in its one result.
 * Each user line after that result gets a result of its own, "Then: <words>",
 * or a failed one for "Fail now.", as the office closes its stdin, as Claude
 * Code answers words that came too late for its turn; it ends then.
 */
function claude(args) {
  const line = write;
  const streamed = args.includes('--input-format');
  let message = '';
  const added = [];
  const late = [];
  let answered = false;
  const settings = () => fileOrInline(after(args, '--settings'));
  const servers = () => fileOrInline(after(args, '--mcp-config')).mcpServers;
  const gave = () => {
    const mcp = { mcpServers: servers() };
    return {
      args,
      envNames: Object.keys(process.env).sort(),
      mcp,
      env: mcp.mcpServers.office?.env,
      // A staff run's settings and system prompt come in files, read while the run goes; the office's own runs pass both inline.
      claudeSettings: settings(),
      system: args.includes('--append-system-prompt-file')
        ? fs.readFileSync(after(args, '--append-system-prompt-file'), 'utf8')
        : after(args, '--append-system-prompt'),
      message,
      added,
      claudeMds: process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS ?? null,
      autoMemory: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY ?? null,
      tmpdir: process.env.CLAUDE_CODE_TMPDIR ?? null,
      git: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('GIT_'))),
      gitTemplate: emptyFolder(process.env.GIT_TEMPLATE_DIR),
      npm: {
        npm_config_cache: process.env.npm_config_cache ?? null,
        npm_config_userconfig: process.env.npm_config_userconfig ?? null
      },
      nodeOptions: process.env.NODE_OPTIONS ?? null,
      apiKey: process.env.ANTHROPIC_API_KEY ?? null,
      configDir: process.env.CLAUDE_CONFIG_DIR ?? null
    };
  };
  const modelUsage = (u) =>
    u ? { modelUsage: { 'claude-test': { inputTokens: u.input, outputTokens: u.output } } } : {};
  /** What Claude Code's stream says for the run's steps. */
  const tool = () => {
    let spoken = '';
    let whole = false;
    let plan;
    /** How the usual reply ends, when a step says. */
    let end;
    return {
      server: (name) => servers()[name],
      say: (words) => {
        spoken += words;
        return line({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: words } }
        });
      },
      calling: async ({ server, tool: name, input }) => {
        const named = `mcp__${server}__${name}`;
        await line({
          type: 'stream_event',
          event: { type: 'content_block_start', content_block: { type: 'tool_use', name: named } }
        });
        await line({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: named, input }] }
        });
      },
      called: (_, text) =>
        line({ type: 'user', message: { content: [{ type: 'tool_result', content: text }] } }),
      reply: async (text, u) => {
        answered = true;
        await line({ type: 'result', subtype: 'success', result: text, ...modelUsage(u) });
      },
      failed: (why) => ({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: [why]
      }),
      own: async (s) => {
        if (s.claude === 'whole-too') whole = true;
        else if (s.claude) end = s.claude;
        else if (s.plan !== undefined) plan = s.plan;
        // In a run whose sandbox opens every host, the words Claude Code's
        // binary refuses that with, and exit 1. Only a staff run carries
        // --settings, so it is read only for this step.
        else if (s.refuse && settings().sandbox?.network?.allowedDomains?.includes('*')) {
          process.stderr.write('Overly broad patterns like "*" are not allowed\n');
          if (s.refuse.wait) await forever();
          process.exit(1);
        }
      },
      /** The usual reply: one tool call, then what the run gave it, or the end a step said. */
      usual: async (u) => {
        answered = true;
        await line({
          type: 'stream_event',
          event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'look' } }
        });
        // Claude Code sends each text block whole as well, after its streamed pieces.
        if (whole && spoken)
          line({ type: 'assistant', message: { content: [{ type: 'text', text: spoken }] } });
        // That share of the five-hour window, as Claude Code's rate_limit_event reports it.
        if (plan !== undefined)
          line({
            type: 'rate_limit_event',
            rate_limit_info: { unifiedWindows: { five_hour: { utilization: plan } } }
          });
        // A failed result that keeps the run going, so words added after it get their own results.
        if (end === 'fail-and-go-on')
          return void (await line({
            type: 'result',
            subtype: 'error_during_execution',
            is_error: true,
            errors: ['Failed first.']
          }));
        if (end === 'success-error')
          return void (await line({
            type: 'result',
            subtype: 'success',
            is_error: true,
            result: 'It went wrong.'
          }));
        if (end === 'success-empty')
          return void (await line({ type: 'result', subtype: 'success' }));
        await line({
          type: 'result',
          subtype: 'success',
          result: JSON.stringify(gave()) + '\nOutcome: done',
          ...modelUsage(u)
        });
      }
    };
  };
  const start = () => play(stepsIn(lastOf(message)), tool());
  const textOf = (content) =>
    content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  if (!streamed) return onStdin((m) => ((message = m), start()));
  let lines = '';
  let started = false;
  process.stdin.on('data', (d) => {
    lines += d;
    let nl;
    while ((nl = lines.indexOf('\n')) >= 0) {
      const text = lines.slice(0, nl);
      lines = lines.slice(nl + 1);
      if (!text.trim()) continue;
      const content = JSON.parse(text).message.content;
      if (started) {
        (answered ? late : added).push(textOf(content));
        continue;
      }
      // A turn with a picture comes back whole, for a test to read its blocks.
      message = content.some((b) => b.type !== 'text') ? text : textOf(content);
      started = true;
      start();
    }
  });
  process.stdin.on('end', () => {
    for (const words of late)
      line(
        words === 'Fail now.'
          ? {
              type: 'result',
              subtype: 'error_during_execution',
              is_error: true,
              errors: ['Failed late.']
            }
          : { type: 'result', subtype: 'success', result: 'Then: ' + words }
      );
  });
}

/**
 * Grok's run, which reads no input: its message comes in the file
 * --prompt-file names, plain text, or content blocks in a .json file (a message
 * with pictures carries no step). It streams in Claude Code's shape and calls
 * every MCP tool through use_tool. A replay's arguments go in replay-args.json
 * in the Grok home.
 */
function grok(args) {
  // As grok 1.0.46 refuses a value that starts with "- " after its flag (measured).
  if (args.some((a) => a.startsWith('- '))) {
    process.stderr.write("error: unexpected argument '- ' found");
    process.exit(2);
  }
  const line = write;
  const promptPath = after(args, '--prompt-file');
  const promptText = fs.readFileSync(promptPath, 'utf8');
  const blocks = promptPath.endsWith('.json') ? JSON.parse(promptText) : undefined;
  const text = blocks ? '' : promptText;
  const agent = () => fs.readFileSync(after(args, '--agent'), 'utf8');
  const servers = () => Object.assign({}, ...JSON.parse(/^mcpServers: (.*)$/m.exec(agent())[1]));
  const gave = () => {
    const profile = args.includes('--sandbox')
      ? fs
          .readFileSync(process.env.GROK_HOME + '/sandbox.toml', 'utf8')
          .split(/^(?=\[profiles\.)/m)
          .find((b) => b.startsWith('[profiles.' + after(args, '--sandbox') + ']'))
      : undefined;
    const all = servers();
    return {
      args,
      envNames: Object.keys(process.env).sort(),
      grokEnv: Object.fromEntries(
        Object.entries(process.env).filter(([k]) =>
          /^(GROK_|XAI_|ANTHROPIC_API_KEY|TMPDIR|NODE_OPTIONS|GIT_)/.test(k)
        )
      ),
      env: all.office?.env,
      servers: all,
      home: process.env.HOME,
      agentMode: fs.statSync(after(args, '--agent')).mode & 0o777,
      profile,
      // The system prompt is the agent file's body, after its frontmatter.
      system: agent()
        .replace(/^---\n[\s\S]*?\n---\n/, '')
        .replace(/\n$/, ''),
      promptMode: /^prompt_mode: (.*)$/m.exec(agent())?.[1],
      promptFileMode: fs.statSync(promptPath).mode & 0o777,
      message: blocks ? undefined : promptText,
      prompt: blocks
    };
  };
  const useTool = (name, input) =>
    line({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'use_tool', input: { tool_name: name, tool_input: input } }
        ]
      }
    });
  const tool = {
    server: (name) => servers()[name],
    say: (words) =>
      line({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: words } }
      }),
    calling: async ({ server, tool: name, input }) => {
      await line({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'tool_use', name: 'use_tool' }
        }
      });
      await useTool(`${server}__${name}`, input);
    },
    called: (_, text) =>
      line({ type: 'user', message: { content: [{ type: 'tool_result', content: text }] } }),
    reply: (text, u) =>
      line({
        type: 'result',
        subtype: 'success',
        result: text,
        ...(u
          ? { modelUsage: { 'grok-test': { inputTokens: u.input, outputTokens: u.output } } }
          : {})
      }),
    failed: (why) => ({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      errors: [why]
    }),
    replaying: () =>
      fs.writeFileSync(process.env.GROK_HOME + '/replay-args.json', JSON.stringify(args)),
    /** The usual reply: one MCP call the way Grok streams it, and what it was given. */
    usual: async () => {
      await line({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'tool_use', name: 'use_tool' }
        }
      });
      await useTool('office__raise_ask', {});
      await line({
        type: 'result',
        subtype: 'success',
        result: JSON.stringify(gave()) + '\nOutcome: done'
      });
    }
  };
  return play(stepsIn(lastOf(text)), tool);
}

/**
 * Codex's run, `codex exec --json`, which reads its message on stdin. Every
 * launch's arguments go in launches.jsonl in the Codex home, a line each. A
 * thread whose id starts "gone-" has no history on this computer, as after a
 * move to a new Mac (#352): Codex fails the resume in its own words. Its lines
 * are the item shapes exec_events.rs gives.
 */
function codex(args) {
  const home = process.env.CODEX_HOME;
  fs.appendFileSync(home + '/launches.jsonl', JSON.stringify(args) + '\n');
  const resumed = args.includes('resume') ? after(args, 'resume') : '';
  if (resumed.startsWith('gone-')) {
    process.stderr.write(
      'Error: thread/resume: thread/resume failed: no rollout found for thread id ' +
        resumed +
        ' (code -32600)\n'
    );
    process.exit(1);
  }
  const line = write;
  const item = (type, o) => line({ type, item: o });
  // The office writes each -c value, and each line of the run's settings file
  // (-p), with JSON strings, so an inline table is JSON once its " = " is ": ".
  const set = {};
  const take = (k, v) => (set[k] = JSON.parse(v.startsWith('{') ? v.replaceAll('" = ', '": ') : v));
  args.forEach((a, i) => {
    if (args[i - 1] === '-c') take(a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1));
    if (args[i - 1] === '-p')
      for (const l of fs.readFileSync(home + '/' + a + '.config.toml', 'utf8').split('\n'))
        if (l) take(l.slice(0, l.indexOf(' = ')), l.slice(l.indexOf(' = ') + 3));
  });
  let calls = 0;
  const usage = (u) => ({ input_tokens: u?.input ?? 0, output_tokens: u?.output ?? 0 });
  return onStdin((message) => {
    const gave = () => ({
      args,
      envNames: Object.keys(process.env).sort(),
      codexEnv: Object.fromEntries(
        Object.entries(process.env).filter(([k]) =>
          /^(CODEX_|OPENAI_|ANTHROPIC_API_KEY|TMPDIR|NODE_OPTIONS|GIT_)/.test(k)
        )
      ),
      git: set['shell_environment_policy.set'],
      gitTemplate: emptyFolder(set['shell_environment_policy.set']?.GIT_TEMPLATE_DIR),
      env: set.mcp_servers.office?.env,
      servers: set.mcp_servers,
      // Whether each picture was there as the run read it (an office run's).
      pictures: args.filter((a) => a.startsWith('--image=')).map((a) => fs.existsSync(a.slice(8))),
      // None on Windows, where the run has Codex's read-only mode instead.
      permissions: set.permissions?.[set.default_permissions],
      system: set.developer_instructions,
      message,
      temp: fs.existsSync(process.env.TMPDIR)
    });
    const tool = {
      open: async () => {
        await line({ type: 'thread.started', thread_id: '019a0000-0000-7000-8000-00000000c0de' });
        await line({ type: 'turn.started' });
      },
      server: (name) => set.mcp_servers[name],
      say: (words) =>
        item('item.completed', { id: `say_${calls++}`, type: 'agent_message', text: words }),
      calling: ({ server, tool: name }) =>
        item('item.started', {
          id: `call_${calls}`,
          type: 'mcp_tool_call',
          server,
          tool: name,
          status: 'in_progress'
        }),
      called: ({ server, tool: name }) =>
        item('item.completed', {
          id: `call_${calls++}`,
          type: 'mcp_tool_call',
          server,
          tool: name,
          status: 'completed'
        }),
      reply: async (text, u) => {
        await item('item.completed', { id: 'reply', type: 'agent_message', text });
        await line({ type: 'turn.completed', usage: usage(u) });
      },
      failed: (why) => ({ type: 'turn.failed', error: { message: why } }),
      /** The usual reply: a shell command, an MCP call, a file change, two messages and the turn's tokens. */
      usual: async (u) => {
        await item('item.started', {
          id: 'item_0',
          type: 'command_execution',
          command: 'ls',
          status: 'in_progress'
        });
        await item('item.completed', {
          id: 'item_0',
          type: 'command_execution',
          command: 'ls',
          exit_code: 0,
          status: 'completed'
        });
        await item('item.started', {
          id: 'item_1',
          type: 'mcp_tool_call',
          server: 'office',
          tool: 'raise_ask',
          status: 'in_progress'
        });
        await item('item.completed', {
          id: 'item_1',
          type: 'mcp_tool_call',
          server: 'office',
          tool: 'raise_ask',
          status: 'completed'
        });
        await item('item.completed', {
          id: 'item_2',
          type: 'file_change',
          changes: [{ path: 'notes.md', kind: 'add' }],
          status: 'completed'
        });
        await item('item.completed', { id: 'item_3', type: 'agent_message', text: 'Looking.' });
        await item('item.completed', {
          id: 'item_4',
          type: 'agent_message',
          text: JSON.stringify(gave()) + '\nOutcome: done'
        });
        await line({
          type: 'turn.completed',
          usage: u
            ? usage(u)
            : {
                input_tokens: 1000,
                cached_input_tokens: 600,
                cache_write_input_tokens: 100,
                output_tokens: 50,
                reasoning_output_tokens: 20
              }
        });
      }
    };
    return play(stepsIn(lastOf(message)), tool);
  });
}

/**
 * Gemini's run, `gemini -o stream-json`, which reads its message on stdin.
 * Like Gemini, it runs a message that starts with "/" as a command of its own,
 * and fails it. Each launch adds a dot to launches.log in the Gemini home.
 */
function gemini(args) {
  fs.appendFileSync(process.env.GEMINI_CLI_HOME + '/launches.log', '.');
  const line = write;
  let calls = 0;
  // Gemini counts cached tokens inside input_tokens, and what is left as `input`.
  const stats = (u) => ({
    models: u
      ? {
          'gemini-test': {
            total_tokens: u.input + u.output,
            input_tokens: u.input,
            output_tokens: u.output,
            cached: 0,
            input: u.input
          }
        }
      : {}
  });
  return onStdin((message) => {
    const settingsPath = process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
    const settings = () => JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const gave = () => {
      const run = path.dirname(settingsPath);
      return {
        args,
        envNames: Object.keys(process.env).sort(),
        geminiEnv: Object.fromEntries(
          Object.entries(process.env).filter(([k]) =>
            /^(GEMINI_|GOOGLE_|ANTHROPIC_API_KEY|NODE_OPTIONS|GIT_)/.test(k)
          )
        ),
        env: settings().mcpServers.office.env,
        settings: settings(),
        settingsMode: fs.statSync(settingsPath).mode & 0o777,
        runMode: fs.statSync(run).mode & 0o777,
        policy: fs.readFileSync(path.join(run, 'policy.toml'), 'utf8'),
        system: fs.readFileSync(process.env.GEMINI_SYSTEM_MD, 'utf8'),
        message
      };
    };
    const error = (why) => ({
      type: 'result',
      status: 'error',
      error: { type: 'Error', message: why }
    });
    let spent = false;
    const tool = {
      open: () =>
        line({
          type: 'init',
          session_id: '0a0a0a0a-0000-4000-8000-00000000ce01',
          model: 'gemini-test'
        }),
      server: (name) => settings().mcpServers[name],
      say: (words) => line({ type: 'message', role: 'assistant', content: words, delta: true }),
      calling: ({ server, tool: name, input }) =>
        line({
          type: 'tool_use',
          tool_name: `mcp_${server}_${name}`,
          tool_id: `c${calls}`,
          parameters: input
        }),
      called: (_, text) =>
        line({ type: 'tool_result', tool_id: `c${calls++}`, status: 'success', output: text }),
      reply: async (text, u) => {
        await line({ type: 'message', role: 'assistant', content: text, delta: true });
        await line({ type: 'result', status: 'success', stats: stats(u) });
      },
      failed: error,
      own: (s) => void (spent ||= !!s.gemini),
      /**
       * The usual reply: an echo of the message, a reply in pieces, a file tool
       * and an MCP call, the reply's last message in two pieces and the
       * result's tokens. A line that ends "End in error" gets a failed result instead.
       */
      usual: async (u) => {
        if (message.startsWith('/')) return void (await line(error('Ran a slash command.')));
        if (spent) return void (await line(error('Quota used up.')));
        await line({ type: 'message', role: 'user', content: message });
        await line({ type: 'message', role: 'assistant', content: 'Look', delta: true });
        await line({ type: 'message', role: 'assistant', content: 'ing.', delta: true });
        await line({
          type: 'tool_use',
          tool_name: 'read_file',
          tool_id: 't1',
          parameters: { file_path: 'x' }
        });
        await line({ type: 'tool_result', tool_id: 't1', status: 'success', output: '' });
        await line({
          type: 'tool_use',
          tool_name: 'mcp_office_raise_ask',
          tool_id: 't2',
          parameters: {}
        });
        await line({ type: 'tool_result', tool_id: 't2', status: 'success', output: '' });
        const reply = JSON.stringify(gave()) + '\nOutcome: done';
        await line({
          type: 'message',
          role: 'assistant',
          content: reply.slice(0, 20),
          delta: true
        });
        await line({ type: 'message', role: 'assistant', content: reply.slice(20), delta: true });
        await line({
          type: 'result',
          status: 'success',
          stats: u
            ? stats(u)
            : {
                models: {
                  'gemini-test': {
                    total_tokens: 1050,
                    input_tokens: 1000,
                    output_tokens: 50,
                    cached: 600,
                    input: 400
                  }
                }
              }
        });
      }
    };
    return play(stepsIn(lastOf(message)), tool);
  });
}

const TOOLS = { claude, grok, codex, gemini };

/** One run of `tool`, from the arguments it was started with. */
export function run(tool, args = process.argv.slice(2)) {
  if (process.env[EXIT_BEFORE_READING]) process.exit(0);
  return TOOLS[tool](args);
}
