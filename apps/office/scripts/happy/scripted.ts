// Scripted scenarios: `npm run scripted -- stuck-working`, or `--all`. Each
// scenario in scenarios/ gets a throwaway office of its own (office.ts),
// onboarded with Marshall and with Wes and Fay hired, then plays its story:
// the owner's moves through the office's API, every Odd's run from the
// scenario's plays (stand-in.ts), and a check after each step.
//
// A scenario for an open bug marks the step the bug breaks. While that step
// fails, the scenario passes as "known"; once it passes, the scenario fails, so
// whoever fixed the bug takes the mark off and the scenario guards the fix.
//
// A hidden browser shows each office's floor, so the page's path guard checks
// every way an Odd walks: a path through a wall fails the step, with a
// screenshot (path-breaks.ts). `--no-floor` skips it.
//
// `--json` prints only a result an agent can read; `--keep` keeps each
// office's folder, which a failed scenario keeps anyway.
//
// `--office <folder>` plays in an office already open instead, such as the one
// `npm run happy -- --watch` leaves up (its folder is printed at the end), so
// it plays out on the floor in front of you. Its Dev window does the same from
// the Scenarios tab. Marshall, Wes and Fay are found by name, any of them gone
// is hired again, and each scenario only checks its own runs. A scenario that
// stops the office (`stopsOffice`) never plays there.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, settled, throwaway, until, type Chat, type OfficeState } from './office.ts';
import type { Scenario, Story } from './play.ts';
import { openPage, type Shown } from './browser.ts';
import { breakFailure, readBreaks } from './path-breaks.ts';
import { liveScenario, Stopped, writeScenarioReport, type LiveStatus } from './scenario-live.ts';
import { FIRST_QUESTIONS } from '@oddboro/ledger/first-questions';
import { deskFor, HIRES, MANAGER, OWNER, ZONE } from './scenario.ts';
import { SCENARIOS } from './scenarios/index.ts';

type Step = {
  name: string;
  ms: number;
  ok: boolean;
  error?: string;
  known?: boolean;
  /** A path break's prompt for Claude Code (path-breaks.ts), which a Prompt button copies. */
  prompt?: string;
};
type Outcome = 'passed' | 'known' | 'failed' | 'skipped' | 'stopped';
type Result = {
  name: string;
  title: string;
  bug?: Scenario['bug'];
  outcome: Outcome;
  seconds: number;
  steps: Step[];
  folder: string | null;
};

const argv = process.argv.slice(2);
const quiet = argv.includes('--json');
const keep = argv.includes('--keep');
/** `--no-floor`: no hidden page, so no path is checked, a few seconds sooner. */
const withFloor = !argv.includes('--no-floor');
const at = argv.indexOf('--office');
const here = at >= 0 ? argv[at + 1] : undefined;
const asked = argv.filter((a, i) => !a.startsWith('--') && (at < 0 || i !== at + 1));
const say = (text: string) => {
  if (!quiet) console.log(text);
};
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

const names = argv.includes('--all') ? SCENARIOS.map((s) => s.name) : asked;
const unknown = names.filter((n) => !SCENARIOS.some((s) => s.name === n));
if (!names.length || unknown.length) {
  console.error(
    `${unknown.length ? `No scenario named ${unknown.join(', ')}. ` : ''}Name one or more, or --all:\n${SCENARIOS.map((s) => `  ${s.name.padEnd(16)} ${s.title}`).join('\n')}`
  );
  process.exit(2);
}

/** The reply a chat streamed back, or the error it ended with. */
function replyOf(stream: string): { text: string; error?: string } {
  const events = stream
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)) as { type: string; text?: string; message?: string });
  const failed = events.find((e) => e.type === 'error');
  const text = events
    .filter((e) => e.type === 'delta')
    .map((e) => e.text ?? '')
    .join('');
  return { text, error: failed?.message };
}

async function play(scenario: Scenario): Promise<Result> {
  if (here && scenario.stopsOffice) {
    say(`\n${scenario.name}: skipped. It stops the office, so it plays only in one of its own.`);
    return {
      name: scenario.name,
      title: scenario.title,
      bug: scenario.bug,
      outcome: 'skipped',
      seconds: 0,
      steps: [],
      folder: null
    };
  }
  const t = throwaway({
    label: `scripted-${scenario.name}`,
    say,
    env: scenario.env,
    attach: here
  });
  // The stand-in reads which plays to use, and tags each run with the session.
  const session = randomUUID().slice(0, 8);
  t.note('session', session);
  const file = fileURLToPath(new URL(`./scenarios/${scenario.name}.ts`, import.meta.url));
  t.note('scenario', file);
  const mine = () => t.runs().filter((r) => r.session === session);
  const started = performance.now();
  const steps: Step[] = [];
  const open = !!scenario.bug?.open;
  say(`\n${scenario.name}: ${scenario.title}${scenario.bug ? ` (${scenario.bug.id})` : ''}`);

  // In an office the happy path keeps open, its control bar shows this
  // scenario as it plays (scenario-live.ts). Each step the story takes is one
  // `s.step(` in the file, after the one that readies the office.
  const live = here ? liveScenario(t.root, session) : undefined;
  // In its own office, a hidden page shows the floor, so the path guard sees
  // every way an Odd walks. An office kept open has its runner's page.
  let floor = undefined as Shown | undefined;
  let breaksSeen = readBreaks(t.root).length;
  const total = 1 + (readFileSync(file, 'utf8').match(/\bs\.step\(/g)?.length ?? 0);
  const where = (n: number, name: string) => `${scenario.name} · ${n} of ${total}: ${name}`;
  const about = `${scenario.bug ? `${scenario.bug.id}: ` : ''}${scenario.title}`;
  const report = (status: LiveStatus, next?: string) =>
    writeScenarioReport({ root: t.root, file, ...scenario, status, session, steps, next });

  async function step(name: string, fn: () => Promise<void>, opts: { bug?: boolean } = {}) {
    await live?.gate({
      step: where(steps.length + 1, name),
      detail: about,
      prompt: report('paused', name).prompt
    });
    const t0 = performance.now();
    let failed: unknown;
    try {
      await fn();
    } catch (e) {
      failed = e;
    }
    // A path through a wall fails the step whatever else it checks, and never as the known bug.
    const broke = await breakFailure(
      t.root,
      breaksSeen,
      {
        by: `the scripted scenario "${scenario.name}" (${about})`,
        step: name,
        rerun: `npm run scripted -- ${scenario.name}`
      },
      floor?.page
    );
    if (broke) breaksSeen = broke.seen;
    const known = open && !!opts.bug && !broke;
    if (broke || failed) {
      const error = broke
        ? broke.message
        : (failed instanceof Error ? failed.message : String(failed)).split('\n')[0];
      steps.push({
        name,
        ms: performance.now() - t0,
        ok: false,
        error,
        known,
        ...(broke ? { prompt: broke.prompt } : {})
      });
      say(`  ${known ? 'known' : 'FAIL '} ${name.padEnd(64)} ${seconds(performance.now() - t0)}`);
      say(`        ${error}`);
      if (!known) throw broke ? new Error(error) : failed;
      return;
    }
    const fixed = known;
    const error = fixed
      ? `This step passed, but it is marked as the one ${scenario.bug!.id} breaks. If the bug is fixed, set its open to false in scenarios/${scenario.name}.ts.`
      : undefined;
    steps.push({ name, ms: performance.now() - t0, ok: !fixed, ...(error ? { error } : {}) });
    say(`  ${fixed ? 'FIXED' : 'ok   '} ${name.padEnd(64)} ${seconds(performance.now() - t0)}`);
    if (error) say(`        ${error}`);
  }

  const ids: Record<string, string> = {};
  const now = () => t.api<OfficeState>('/api/office');
  const story: Story = {
    office: t,
    ids,
    step,
    async chat(who, message) {
      const r = replyOf(await t.api<string>(`/api/staff/${ids[who]}/chat`, { message }));
      if (r.error) throw new Error(`${who}'s chat failed: ${r.error}`);
      return r.text;
    },
    now,
    async settle(ms = 30_000) {
      let since = 0;
      return until(
        'the office to settle',
        async () => {
          const o = await now();
          if (!settled(o)) since = 0;
          else if (!since) since = Date.now();
          return since && Date.now() - since > 1500 ? o : undefined;
        },
        ms
      );
    },
    clock: {
      async job(job) {
        const sql = await t.sql();
        await sql`update jobs set next_run_at = now() where name = ${job}`;
      },
      async thread(title) {
        const sql = await t.sql();
        const set =
          await sql`update threads set resume_at = now() where title = ${title} and ended_at is null returning id`;
        expect(set.length, `No open work titled "${title}" to wake`);
      },
      async windowReset() {
        const sql = await t.sql();
        await sql`update plan_limits set five_hour = 0, five_hour_resets_at = now()`;
        await sql`update threads set resume_at = now() where held_by is not null and ended_at is null`;
      }
    },
    runsOf: (who, re) =>
      mine().filter((r) => r.odd === who && (!re || re.test(`${r.message}\n${r.thisRun ?? ''}`))),
    callsOf: (who, tool) =>
      mine()
        .filter((r) => r.odd === who)
        .flatMap((r) => r.calls.filter((c) => c.call === tool))
  };

  /** Hires each of Wes and Fay the office lacks, and waits for each new one's hello. */
  async function hireMissing() {
    const staff = (await now()).staff;
    const missing = HIRES.filter((h) => {
      const found = staff.find((s) => s.name === h.name);
      if (found) ids[h.name] = found.id;
      return !found;
    });
    if (!missing.length) return;
    const looks = await t.looks();
    for (const h of missing) {
      const hired = await t.api<{ id: string }>('/api/staff', {
        name: h.name,
        role: h.role,
        remit: h.remit,
        desk: deskFor(h.name, h.role),
        room: h.room,
        permission: 'draft',
        ...looks[h.look]
      });
      ids[h.name] = hired.id;
    }
    for (const h of missing)
      await until(`${h.name}'s hello`, async () => {
        const c = await t.api<Chat>(`/api/staff/${ids[h.name]}/chat`);
        return c.history.length > 0 && !c.busy;
      });
  }

  /** Marshall asks three questions before his chat runs at all: each still waiting gets its first answer. */
  async function answerQuestions() {
    for (const _ of FIRST_QUESTIONS) {
      const c = await t.api<Chat>(`/api/staff/${ids.Marshall}/chat`);
      const last = JSON.stringify(c.history.at(-1) ?? '');
      const q = FIRST_QUESTIONS.find((f) => last.includes(f.ask));
      if (!q) return;
      await story.chat('Marshall', q.answers[0]);
    }
  }

  let passed = false;
  let stopped = false;
  try {
    if (here)
      await step('Use the open office: Marshall, Wes and Fay', async () => {
        const marshall = (await now()).staff.find((s) => s.name === 'Marshall');
        expect(marshall, 'This office has no Marshall: onboard with him first');
        ids.Marshall = marshall!.id;
        await hireMissing();
        await answerQuestions();
        await story.settle();
      });
    else {
      await step('Start a throwaway office', async () => {
        await t.prepare();
        await t.start();
      });
      await step(
        `Onboard ${OWNER} with Marshall, answer his questions, hire Wes and Fay`,
        async () => {
          await t.api('/api/onboarding');
          const { manager } = await t.api<{ manager: { id: string } }>('/api/onboarding', {
            name: OWNER,
            zone: ZONE,
            manager: { preset: MANAGER }
          });
          ids.Marshall = manager.id;
          await hireMissing();
          await answerQuestions();
        }
      );
      if (withFloor)
        await step('Open the floor in a hidden browser, to check every path', async () => {
          floor = await openPage(`${t.base}/?speed=10`, false, 0);
        });
    }
    t.note('ids', ids);
    await scenario.story(story);
    passed = true;
  } catch (e) {
    if (e instanceof Stopped) stopped = true;
    else if (!quiet) {
      say(`  The office's last lines (all of them in ${t.logFile}):`);
      for (const l of t.recent.slice(-15)) say(`    | ${l}`);
    }
  }
  // Steps a known bug broke still count; a step that passed under a bug mark does not.
  const outcome: Outcome = stopped
    ? 'stopped'
    : !passed || steps.some((s) => !s.ok && !s.known)
      ? 'failed'
      : steps.some((s) => s.known)
        ? 'known'
        : 'passed';
  if (live) {
    const status = outcome;
    const why = steps.find((s) => !s.ok && !s.known) ?? steps.find((s) => s.known);
    live.show({
      status,
      step: where(steps.length, steps.at(-1)?.name ?? 'nothing ran'),
      detail: {
        stopped: 'Stopped from the bar.',
        failed: why?.error ?? 'It stopped before a step ran',
        known: `As ${scenario.bug?.id} says: ${why?.error}`,
        passed: 'Every step passed.'
      }[status],
      prompt: report(status).prompt,
      fixPrompt: steps.find((s) => s.prompt)?.prompt,
      live: false
    });
    live.close();
  }
  // The office's own runs go back to the happy path's story.
  t.note('scenario', null);
  t.note('session', null);
  await floor?.browser.close().catch(() => {});
  await t.stop();
  const kept = !here && (keep || outcome === 'failed');
  if (!here && !kept) t.remove();
  if (kept) say(`  Kept: ${t.root}`);
  return {
    name: scenario.name,
    title: scenario.title,
    bug: scenario.bug,
    outcome,
    seconds: +((performance.now() - started) / 1000).toFixed(1),
    steps,
    folder: kept ? t.root : null
  };
}

const results: Result[] = [];
for (const n of names) results.push(await play(SCENARIOS.find((s) => s.name === n)!));
const passed = results.every((r) => r.outcome !== 'failed');
if (quiet) {
  const one = results.length === 1 ? results[0] : undefined;
  console.log(
    JSON.stringify(
      one
        ? { passed, ...one }
        : { passed, seconds: results.reduce((n, r) => n + r.seconds, 0), scenarios: results }
    )
  );
} else {
  say('');
  for (const r of results)
    say(
      `${{ failed: 'FAILED', known: 'known ', passed: 'passed', skipped: 'skip  ', stopped: 'stop  ' }[r.outcome]}  ${r.name.padEnd(16)} ${seconds(r.seconds * 1000).padStart(7)}${r.bug ? `  ${r.bug.id}${r.outcome === 'known' ? ', still open: fails the way the bug says' : ''}` : ''}`
    );
}
process.exit(passed ? 0 : 1);
