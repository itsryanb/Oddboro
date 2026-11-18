// A scripted scenario playing in an office the happy path keeps open
// (scripted.ts --office), shown on that run's control bar (hud.ts). Two
// processes, one folder: the scenario writes where it is to scenario.json and
// a report beside it, and run.ts, which draws the bar, writes the bar's Pause,
// Step and Stop to scenario-control.json. Each side watches the other's file,
// so nothing polls.
import { readFileSync, renameSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HudState } from './hud.ts';

export type LiveStatus =
  'running' | 'pausing' | 'paused' | 'known' | 'passed' | 'failed' | 'stopped';

/** Where the scenario is, as the bar shows it. */
export type LiveState = Omit<HudState, 'status'> & {
  status: LiveStatus;
  session: string;
  /** False once the scenario has ended, so the bar's buttons go back to the office. */
  live: boolean;
};

type Command = { session: string; n: number; command: 'pause' | 'run' | 'step' | 'stop' };

const STATE = 'scenario.json';
const CONTROL = 'scenario-control.json';

/** Written whole and moved in, so the other side never reads half a file. */
function put(root: string, name: string, value: unknown) {
  const temp = join(root, `${name}.writing`);
  writeFileSync(temp, JSON.stringify(value));
  renameSync(temp, join(root, name));
}

function read<T>(root: string, name: string): T | undefined {
  try {
    return JSON.parse(readFileSync(join(root, name), 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/** Thrown at the next step after the bar's Stop. */
export class Stopped extends Error {
  constructor() {
    super('Stopped from the bar');
  }
}

/** The scenario's side: tell the bar where it is, and wait at each step while paused. */
export function liveScenario(root: string, session: string) {
  let mode: 'run' | 'pause' | 'step' = 'run';
  let stop = false;
  let seen = read<Command>(root, CONTROL)?.n ?? 0;
  let wake: (() => void) | undefined;
  let last: LiveState | undefined;

  const watcher = watch(root, (_, file) => {
    if (file !== CONTROL) return;
    const c = read<Command>(root, CONTROL);
    if (!c || c.session !== session || c.n <= seen) return;
    seen = c.n;
    if (c.command === 'stop') stop = true;
    else mode = c.command === 'run' ? 'run' : c.command;
    // A pause asked for mid-step lands before the next step.
    if (c.command === 'pause' && last?.status === 'running') show({ ...last, status: 'pausing' });
    wake?.();
  });

  function show(s: Omit<LiveState, 'session' | 'live'> & { live?: boolean }) {
    last = { ...s, session, live: s.live ?? true };
    put(root, STATE, last);
  }

  return {
    show,
    /** Before a step: waits while paused, and lets one step through after Step. */
    async gate(state: Omit<LiveState, 'session' | 'live' | 'status'>) {
      if (stop) throw new Stopped();
      if (mode !== 'run') {
        show({ ...state, status: 'paused' });
        while (mode === 'pause' && !stop) await new Promise<void>((r) => (wake = r));
        if (stop) throw new Stopped();
        if (mode === 'step') mode = 'pause';
      }
      show({ ...state, status: 'running' });
    },
    close: () => watcher.close()
  };
}

/** run.ts's side: each time the scenario's state changes, with the state. */
export function watchScenario(root: string, onState: (s: LiveState) => void) {
  return watch(root, (_, file) => {
    if (file !== STATE) return;
    const s = read<LiveState>(root, STATE);
    if (s) onState(s);
  });
}

let sent = 0;
/** run.ts's side: the bar's button, passed to the scenario playing now. */
export function controlScenario(root: string, session: string, command: Command['command']) {
  const n = Math.max(sent, read<Command>(root, CONTROL)?.n ?? 0) + 1;
  sent = n;
  put(root, CONTROL, { session, n, command });
}

/** The report Copy for Claude Code points at: what the scenario is, and how far it got. */
export function writeScenarioReport(r: {
  root: string;
  file: string;
  name: string;
  title: string;
  bug?: { id: string; open: boolean };
  status: LiveStatus;
  session: string;
  steps: { name: string; ms: number; ok: boolean; error?: string; known?: boolean }[];
  next?: string;
}): { file: string; prompt: string } {
  const out = join(r.root, 'scenario-report.md');
  const lines = [
    `# Scripted scenario: ${r.name}`,
    '',
    `${r.title}.${r.bug ? ` It reproduces ${r.bug.id}${r.bug.open ? ', still open' : ', fixed'}.` : ''}`,
    '',
    `**${r.status}**${r.next ? `, before "${r.next}"` : ''}.`,
    '',
    '## Steps',
    '',
    '| Step | Time | Result |',
    '| ---- | ---- | ------ |',
    ...r.steps.map(
      (s) =>
        `| ${s.name} | ${(s.ms / 1000).toFixed(1)} s | ${s.known ? `known: ${s.error}` : s.ok ? 'ok' : `FAIL: ${s.error}`} |`
    ),
    '',
    '## Where to look',
    '',
    `- The scenario, its plays and its checks: ${r.file}`,
    `- Every run the stand-in played: ${join(r.root, 'runs.jsonl')}. This scenario's runs carry "session":"${r.session}".`,
    `- The office's log: ${join(r.root, 'office.log')}`,
    `- The office's folder: ${join(r.root, 'office')}`,
    ''
  ];
  writeFileSync(out, lines.join('\n'));
  const ask =
    r.status === 'known'
      ? `It fails the way ${r.bug?.id} says. Find the cause in apps/office/src and packages/ledger/src, and propose the smallest fix`
      : r.status === 'failed'
        ? 'A step failed that is not the bug it reproduces. Find out why'
        : r.status === 'paused'
          ? 'It is paused, with the office still up. Look at the office as it is now, and explain what the next step will check'
          : 'Explain what it showed';
  return {
    file: out,
    prompt: `A scripted Oddboro scenario, "${r.name}", ran in the throwaway office in ${r.root}, which stays open. Read ${out}. ${ask}, using the report, runs.jsonl and office.log beside it, and the scenario's file.`
  };
}
