// report.md in a happy path's folder: everything Claude Code (or a person)
// needs to say why a run failed, stalled or was slow, without rerunning it.
// run.ts writes it again at every pause, failure and finish, so it always
// says where the run is now. The prompt the control bar copies points here.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCRIPTS } from './scenario.ts';

export type StepTime = { name: string; ms: number; ok: boolean; error?: string };

export type Where = {
  status: 'running' | 'paused' | 'passed' | 'failed' | 'stopped';
  /** The step it is in, or failed or stopped in. */
  step?: string;
  /** The page action it is paused before, or was about to do. */
  action?: string;
};

export type ReportInput = {
  root: string;
  officeHome: string;
  base: string;
  officeUp: boolean;
  steps: StepTime[];
  stepNames: string[];
  where: Where;
  recent: string[];
  seconds: number;
};

type OfficeNow = {
  staff: { id: string; name: string; role?: string }[];
  desk: { asks: { id: number; title: string }[]; tasks: { id: number; title: string }[] };
  working: Record<string, string>;
  inProgress: Record<string, unknown[]>;
};

/** Writes report.md and returns its path. */
export async function writeReport(r: ReportInput): Promise<string> {
  const file = join(r.root, 'report.md');
  const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const office = r.officeUp
    ? await fetch(`${r.base}/api/office`)
        .then((res) => (res.ok ? (res.json() as Promise<OfficeNow>) : undefined))
        .catch(() => undefined)
    : undefined;
  const runs = readRuns(join(r.root, 'runs.jsonl'));
  const slowest = [...r.steps].sort((a, b) => b.ms - a.ms)[0];

  const lines = [
    '# Happy path report',
    '',
    `**${headline(r)}** after ${r.seconds.toFixed(1)} s.`,
    ...(r.where.action ? ['', `Next page action: ${r.where.action}`] : []),
    '',
    '## Steps',
    '',
    '| Step | Time | Result |',
    '| ---- | ---- | ------ |',
    ...r.stepNames.map((name) => {
      const done = r.steps.find((x) => x.name === name);
      if (done) return `| ${name} | ${s(done.ms)} | ${done.ok ? 'ok' : `FAILED: ${done.error}`} |`;
      return `| ${name} | | ${name === r.where.step ? `${r.where.status} here` : 'not reached'} |`;
    }),
    ...(slowest ? ['', `Slowest step: ${slowest.name}, ${s(slowest.ms)}.`] : []),
    '',
    '## The office now',
    '',
    ...(office
      ? [
          `It is still running at ${r.base}.`,
          '',
          ...office.staff.map((o) => {
            const doing = o.id in office.working ? `working on: ${office.working[o.id]}` : 'free';
            const queued = office.inProgress[o.id]?.length ?? 0;
            return `- ${o.name} (${o.id}): ${doing}${queued ? `, ${queued} piece(s) of work in progress` : ''}`;
          }),
          '',
          `Desk: ${office.desk.tasks.length} task(s), ${office.desk.asks.length} ask(s).`,
          ...office.desk.tasks.map((t) => `- task #${t.id}: ${t.title}`),
          ...office.desk.asks.map((a) => `- ask #${a.id}: ${a.title}`)
        ]
      : ['The office is not running, so this part is what the files say.']),
    '',
    "## Each Odd's runs, in order",
    '',
    'What the Claude Code stand-in was given, and which line of `SCRIPTS` in scenario.ts answered. "None" means the stand-in gave its plain hello, so a run the story expected to do work did nothing.',
    '',
    ...(runs.length
      ? runs.map((x, i) =>
          x.crash
            ? `${i + 1}. The stand-in crashed before it could answer:\n\n   \`\`\`\n   ${x.crash.split('\n').slice(0, 4).join('\n   ')}\n   \`\`\``
            : `${i + 1}. ${x.odd}: ${x.script === null ? 'None' : `SCRIPTS[${x.script}] (${SCRIPTS[x.script]?.when})`}. Message: "${x.message.split('\n')[0].slice(0, 120)}"`
        )
      : ['No run reached the stand-in.']),
    '',
    "## The Odds' files",
    '',
    ...oddFiles(join(r.officeHome, 'staff')),
    '',
    "## The office's last lines",
    '',
    '```',
    ...(r.recent.slice(-30).length ? r.recent.slice(-30) : ['(nothing)']),
    '```',
    '',
    '## Where to look next',
    '',
    `- The whole log: ${join(r.root, 'office.log')}`,
    `- Every run's full message and arguments: ${join(r.root, 'runs.jsonl')}`,
    ...(existsSync(join(r.root, 'failed.png'))
      ? [`- The page as it failed: ${join(r.root, 'failed.png')}`]
      : []),
    ...(office
      ? [
          `- The office's own view: GET ${r.base}/api/office, /api/staff/<id>/chat, /api/ledger?kind=work`
        ]
      : []),
    '- The story: apps/office/scripts/happy/scenario.ts. The owner side: run.ts (API) and browser.ts (the page). The Odds: stand-in.ts.',
    ''
  ];
  writeFileSync(file, lines.join('\n'));
  return file;
}

function headline(r: ReportInput): string {
  const at = r.where.step ? ` at "${r.where.step}"` : '';
  if (r.where.status === 'passed') return 'Passed';
  if (r.where.status === 'failed') return `Failed${at}`;
  if (r.where.status === 'stopped') return `Stopped by hand${at}`;
  if (r.where.status === 'paused') return `Paused${at}`;
  return `Running${at}`;
}

type Run = { odd: string; script: number | null; message: string; crash?: string };

function readRuns(file: string): Run[] {
  if (!existsSync(file)) return [];
  return (
    readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Run & { call?: string })
      // A tool call's own line belongs to its run, which is listed already.
      .filter((r) => !r.call)
  );
}

function oddFiles(staff: string): string[] {
  if (!existsSync(staff)) return ['No Odd has a folder yet.'];
  return readdirSync(staff).map((id) => {
    const files = readdirSync(join(staff, id)).filter((f) => statSync(join(staff, id, f)).isFile());
    return `- ${id}: ${files.join(', ') || '(empty)'}`;
  });
}

/** What the control bar copies for Claude Code. */
export function promptFor(r: ReportInput, report: string): string {
  const ask =
    r.where.status === 'failed'
      ? 'Diagnose why it failed'
      : r.where.status === 'passed'
        ? 'Check the run for anything that looks wrong or slow'
        : `Diagnose what is happening at this point (it is ${r.where.status})`;
  return [
    `The Oddboro happy path (npm run happy) is: ${headline(r)}.`,
    `Read its report first: ${report}`,
    r.officeUp
      ? `The office is still running at ${r.base}, so you can query its API (GET /api/office, /api/staff/<id>/chat, /api/ledger).`
      : '',
    `${ask}, using the report, runs.jsonl and office.log beside it, and the code in apps/office/scripts/happy/ and apps/office/src.`,
    'Tell me what you find, with the evidence, before changing any code.'
  ]
    .filter(Boolean)
    .join('\n');
}
