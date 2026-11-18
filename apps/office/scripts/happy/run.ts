// The happy path: a throwaway office from this checkout, put through a new
// owner's first minutes in seconds. `npm run happy` from the repo root, on a
// Mac, Linux or Windows. It starts the office, onboards, hires two Odds, and
// works the story in scenario.ts to its known end, checking each step.
//
// The office is office.ts's throwaway: nothing it does reaches the owner's own.
//
// The folder is removed when every step passes, and kept with the office's
// log when one fails. `--keep` keeps it anyway; `--json` prints only a result
// an agent can read.
//
// `--watch` plays the owner through the real page in a browser window
// (browser.ts, Playwright on the installed Chrome or Edge): the welcome cards,
// the hire window, the chat and the Desk, with the floor at 4 times speed and a
// short pause after each step. The office stays open at the end until Ctrl+C.
// `--speed N` sets the speed (1 to 10). `--ui` does the same with no window.
import { join } from 'node:path';
import {
  BOOKING,
  deskFor,
  GUEST_LIST,
  HIRES,
  MANAGER,
  OWNER,
  PICK,
  PLACES,
  PLAN_LUNCH,
  PLAN_REPLY,
  TASK_TITLE,
  ZONE
} from './scenario.ts';
import { chat, hire, onboard, openPage, pick, setGate, type Shown } from './browser.ts';
import type { Page } from 'playwright-core';
import { installHud, type HudCommand, type HudState } from './hud.ts';
import { breakFailure, readBreaks, watchBreaks } from './path-breaks.ts';
import { controlScenario, watchScenario, type LiveState } from './scenario-live.ts';
import { pauser, type Pauser } from './pause.ts';
import { promptFor, writeReport, type Where } from './report.ts';
import {
  doing,
  expect,
  settled,
  sleep,
  throwaway,
  until,
  type Chat,
  type Choice,
  type OfficeState as Office,
  type Task
} from './office.ts';

type Step = { name: string; ms: number; ok: boolean; error?: string };

const keep = process.argv.includes('--keep');
/** `--hold`: keep the office up after a run with no window, for another tool to use. */
const hold = process.argv.includes('--hold');
// Agents start held runs in background shells and forget them, leaving a dev server
// running for days, so a held office closes itself after this long.
const holdMinutes = 30;
const quiet = process.argv.includes('--json');
/** `--pause-at "Your AI"`: watch, and pause before the first action whose name holds those words. */
const pauseAt = process.argv.includes('--pause-at')
  ? process.argv[process.argv.indexOf('--pause-at') + 1]
  : undefined;
const watch = (process.argv.includes('--watch') || !!pauseAt) && !quiet;
/** The owner clicks through the real page (browser.ts) instead of calling the API. */
const ui = watch || process.argv.includes('--ui');
/** `--speed 4`: the floor plays four times faster and the pauses are a quarter. Up to 10; 4 to watch, 10 with no window. */
const speedArg = Number(process.argv[process.argv.indexOf('--speed') + 1]);
const speed = process.argv.includes('--speed')
  ? speedArg > 1
    ? Math.min(speedArg, 10)
    : 1
  : watch
    ? 4
    : ui
      ? 10
      : 1;
/** Long enough to see a hire walk in from the bus stop, or an Odd go to work, at `speed`. */
const PAUSE_MS = 2500 / speed;
/** The page's address, with the floor's speed when it is not 1 (engine.ts reads it). */
const pageUrl = () => (speed > 1 ? `${t.base}/?speed=${speed}` : t.base);

const say = (text: string) => {
  if (!quiet) console.log(text);
};
const t = throwaway({ label: 'happy', say });
const { root, officeHome, logFile, recent, written } = t;
const api = t.api;

const steps: Step[] = [];
const started = performance.now();
// A cast, not an annotation: set inside a step's callback, which TypeScript does not follow.
let shown = undefined as Shown | undefined;
let controls = undefined as Pauser | undefined;
let drawBar = undefined as ((s: HudState) => Promise<void>) | undefined;
/** The step running now, for the control bar and the report. */
let current = '';
let next = undefined as string | undefined;
/** Set once the run is over: the office stays up after that only in a watched run. */
let finishing = false;

const STEPS = {
  start: 'Start the office',
  setup: 'Setup finds Claude Code, signed in',
  open: `Open the office in ${watch ? 'a browser window' : 'a hidden browser'}`,
  onboard: `Onboard ${OWNER} with ${MANAGER}`,
  hire: `Hire ${HIRES.map((h) => h.name).join(' and ')}`,
  plan: 'Fay writes the guest list and asks where to eat',
  pick: `${OWNER} picks ${PICK} on the desk`,
  book: 'Fay picks the work back up and books it',
  settle: 'The office settles: desk clear, nobody working'
};
const stepNames = () => Object.values(STEPS).filter((n) => ui || n !== STEPS.open);

/** Writes report.md for where the run is now, and the prompt that points Claude Code at it. */
async function reportNow(where: Where) {
  const input = {
    root,
    officeHome,
    base: t.base,
    officeUp: t.up() && (watch || !finishing),
    steps,
    stepNames: stepNames(),
    where,
    recent,
    seconds: (performance.now() - started) / 1000
  };
  const file = await writeReport(input);
  return { file, prompt: promptFor(input, file) };
}

/** Draws the control bar, when the run has one, writing the report it copies from. */
async function bar(status: Exclude<HudState['status'], 'known'>, detail?: string) {
  if (!drawBar) return;
  const where: Where = {
    status: status === 'pausing' ? 'running' : status,
    step: current,
    action: next
  };
  const { prompt } = await reportNow(where);
  const n = stepNames().indexOf(current) + 1;
  await drawBar({
    status,
    step: `${n} of ${stepNames().length}: ${current}`,
    action: next,
    detail,
    prompt,
    fixPrompt
  });
}
/** A scripted scenario playing in this office after the run (scenario-live.ts): the bar shows and steers it. */
let scenarioNow = undefined as LiveState | undefined;

/** A button on the bar: the scenario's while one plays, the run's otherwise. */
function onBar(c: HudCommand) {
  if (scenarioNow?.live) {
    const paused = scenarioNow.status === 'paused';
    return controlScenario(root, scenarioNow.session, c === 'pause' && paused ? 'run' : c);
  }
  return controls ? controls.control(c) : void quit();
}

/** How to play a scripted scenario in this office while it stays open. */
const scenariosHere = `Play a scripted scenario in it: Run here in its Dev window's Scenarios tab, or npm run scripted -- <name> --office ${root}`;
/** Set while the office stays open at the end, so Ctrl+C ends that wait instead of the run. */
let atEnd = undefined as (() => void) | undefined;

/** Path breaks already failed a step, of those in path-breaks.jsonl. */
let breaksSeen = 0;
/** The first path break's prompt for Claude Code, which the bar's Prompt copies. */
let fixPrompt = undefined as string | undefined;

async function step(name: string, fn: () => Promise<void>) {
  const t0 = performance.now();
  const p0 = controls?.pausedMs() ?? 0;
  // A pause is the watcher's time, not the office's.
  const took = () => performance.now() - t0 - ((controls?.pausedMs() ?? 0) - p0);
  current = name;
  next = undefined;
  void bar('running');
  try {
    await fn();
    // A path through a wall fails the step, with the page as it was (path-breaks.ts).
    if (shown) {
      const broke = await breakFailure(
        root,
        breaksSeen,
        {
          by: 'the happy path (npm run happy)',
          step: name,
          rerun: `npm run happy -- ${watch ? '--watch' : '--ui'}`
        },
        shown.page
      );
      if (broke) {
        breaksSeen = broke.seen;
        fixPrompt = broke.prompt;
        throw new Error(broke.message);
      }
    }
    steps.push({ name, ms: took(), ok: true });
    say(`  ok    ${name.padEnd(48)} ${seconds(took())}`);
    // After the time is taken, so a step's time stays what the office took.
    if (watch && shown) await sleep(PAUSE_MS);
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).split('\n')[0];
    steps.push({ name, ms: took(), ok: false, error });
    say(`  FAIL  ${name.padEnd(48)} ${seconds(took())}\n        ${error}`);
    if (shown) {
      await shown.page.screenshot({ path: join(root, 'failed.png') }).catch(() => {});
      say(`        The page as it failed: ${join(root, 'failed.png')}`);
    }
    await bar('failed', error);
    throw e;
  }
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
/** What a watched run can print at a key press (pause.ts). */
const officeLooks = () => [
  {
    key: 'o',
    label: 'Odds and the Desk',
    async show() {
      const o = await api<Office>('/api/office');
      return [
        ...o.staff.map((s) => `${s.name}: ${doing(o, s.id) ?? 'free'}`),
        `Desk: ${o.desk.tasks.length} tasks, ${o.desk.asks.length} asks`,
        ...o.desk.tasks.map((t) => `  task #${t.id} ${t.title}`),
        ...o.desk.asks.map((a) => `  ask ${a.title}`)
      ].join('\n');
    }
  },
  {
    key: 'c',
    label: "Claude's sign-in, as Your AI reads it",
    show: async () => JSON.stringify(await api('/api/setup/claude'), null, 2)
  },
  {
    key: 'l',
    label: "the office's last lines",
    show: async () => recent.slice(-15).join('\n') || '(nothing yet)'
  },
  {
    key: 'f',
    label: 'where things are',
    show: async () =>
      [
        `Office: ${t.base}`,
        `Folder: ${root}`,
        `Its log: ${logFile}`,
        `What each run was given: ${join(root, 'runs.jsonl')}`,
        `Odds' files: ${join(officeHome, 'staff')}`
      ].join('\n')
  }
];

/** Ctrl+C: ends the wait at the end, or stops the run where it is and keeps its folder. */
async function quit() {
  if (atEnd) return atEnd();
  say('\n  Stopped.');
  const { file } = await reportNow({ status: 'stopped', step: current, action: next });
  say(`  Report for Claude Code: ${file}`);
  controls?.stop();
  await shown?.browser.close().catch(() => {});
  await t.stop();
  say(`The office's folder is kept: ${root}`);
  process.exit(130);
}
process.on('SIGINT', () => void quit());

async function main() {
  say(`Happy path: a throwaway office in ${root}`);
  await t.prepare();
  const looks = t.looks();
  looks.catch(() => {});
  const ids: Record<string, string> = {};
  await step(STEPS.start, async () => {
    await t.start();
  });

  await step(STEPS.setup, async () => {
    const setup = await api<{ checks: { id: string; state: string; found: string }[] }>(
      '/api/setup'
    );
    const claude = setup.checks.find((c) => c.id === 'claude');
    expect(claude?.state === 'ok', `Setup says Claude Code is: ${claude?.found ?? 'not listed'}`);
  });

  if (ui)
    await step(STEPS.open, async () => {
      // Watched: the control bar goes in before the page's first load.
      const withBar = async (page: Page) => {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        drawBar = await installHud(page, onBar);
      };
      shown = await openPage(pageUrl(), watch, watch ? 60 / speed : 0, watch ? withBar : undefined);
      if (watch) {
        controls = pauser({
          pauseAt,
          looks: officeLooks(),
          say,
          quit: () => void quit(),
          onChange: (s) => {
            next = s.action;
            void bar(s.status);
          },
          onPause: async (what) => {
            const { file } = await reportNow({ status: 'paused', step: current, action: what });
            say(`  Report for Claude Code: ${file}`);
          }
        });
        setGate(controls.gate);
      }
    });

  /** An Odd's id, read from the office by name, for an Odd the page made. */
  const idOf = async (name: string) => {
    const o = await api<Office>('/api/office');
    const s = o.staff.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!s) throw new Error(`No Odd named ${name} in the office`);
    return s.id;
  };

  await step(STEPS.onboard, async () => {
    if (shown) {
      await onboard(shown.page, OWNER, !watch);
      ids[MANAGER] = await idOf(MANAGER);
    } else {
      await api('/api/onboarding');
      const { manager } = await api<{ manager: { id: string } }>('/api/onboarding', {
        name: OWNER,
        zone: ZONE,
        manager: { preset: MANAGER }
      });
      ids[MANAGER] = manager.id;
    }
    const chat = await api<Chat>(`/api/staff/${ids[MANAGER]}/chat`);
    expect(JSON.stringify(chat.history).includes(OWNER), 'The manager did not say hello by name');
  });

  await step(STEPS.hire, async () => {
    if (shown)
      for (const h of HIRES) {
        await hire(shown.page, { ...h, desk: deskFor(h.name, h.role) });
        ids[h.name] = await idOf(h.name);
      }
    else {
      const ready = await looks;
      for (const h of HIRES) {
        const hired = await api<{ id: string }>('/api/staff', {
          name: h.name,
          role: h.role,
          remit: h.remit,
          desk: deskFor(h.name, h.role),
          room: h.room,
          permission: 'draft',
          ...ready[h.look]
        });
        ids[h.name] = hired.id;
      }
    }
    // Each hire says hello on its own first run, through the stand-in.
    for (const h of HIRES)
      await until(`${h.name}'s hello`, async () => {
        const chat = await api<Chat>(`/api/staff/${ids[h.name]}/chat`);
        return chat.history.length > 0 && !chat.busy;
      });
  });

  let task: Task | undefined;
  await step(STEPS.plan, async () => {
    if (shown) await chat(shown.page, 'Fay', 'Writer', PLAN_LUNCH, PLAN_REPLY);
    else {
      const reply = await api<string>(`/api/staff/${ids.Fay}/chat`, { message: PLAN_LUNCH });
      const failed = reply
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => JSON.parse(l.slice(6)) as { type: string; message?: string })
        .find((e) => e.type === 'error');
      expect(!failed, `The chat failed: ${failed?.message}`);
    }
    expect(written(ids.Fay, 'guest-list.md') === GUEST_LIST, 'guest-list.md is not as written');
    task = await until('the choice on the desk', async () =>
      (await api<Office>('/api/office')).desk.tasks.find((t) => t.title === TASK_TITLE)
    );
    const choice = task.steps.find((s) => s.action?.kind === 'choice')?.action as Choice;
    expect(
      JSON.stringify(choice?.options) === JSON.stringify(PLACES),
      `The desk offers ${JSON.stringify(choice?.options)}`
    );
  });

  await step(STEPS.pick, async () => {
    if (shown) return pick(shown.page, TASK_TITLE, PICK);
    const index = task!.steps.findIndex((s) => s.action?.kind === 'choice');
    await api(`/api/tasks/${task!.id}`, { op: 'choose', index, answer: PICK });
    await api(`/api/tasks/${task!.id}`, { op: 'finish', done: true });
  });

  await step(STEPS.book, async () => {
    await until('booking.md', async () => written(ids.Fay, 'booking.md'));
    expect(written(ids.Fay, 'booking.md') === BOOKING, 'booking.md is not as written');
  });

  await step(STEPS.settle, async () => {
    const o = await until('every run to end', async () => {
      const o = await api<Office>('/api/office');
      return settled(o) ? o : undefined;
    });
    expect(!o.desk.tasks.length && !o.desk.asks.length, 'Something is still on the desk');
    for (const [name, id] of Object.entries(ids)) {
      const chat = await api<Chat>(`/api/staff/${id}/chat`);
      expect(!chat.busy, `${name}'s chat is still busy`);
    }
    const work = await api<{ title: string }[]>('/api/ledger?kind=work');
    expect(
      work.some((r) => r.title.includes(TASK_TITLE)),
      `The ledger has no line for "${TASK_TITLE}"`
    );
  });
}

let passed = false;
try {
  await main();
  passed = true;
} catch {
  if (!quiet) {
    console.log(`\nThe office's last lines (all of them in ${logFile}):`);
    for (const l of recent) console.log(`  | ${l}`);
  }
}
const total = performance.now() - started;
const failedAt = steps.find((s) => !s.ok)?.name;
finishing = true;
const final = await reportNow({ status: passed ? 'passed' : 'failed', step: failedAt });
if (quiet)
  console.log(
    JSON.stringify({
      passed,
      seconds: +(total / 1000).toFixed(1),
      steps,
      folder: root,
      // A passing run's folder goes, report and all, unless kept.
      report: passed && !keep ? null : final.file
    })
  );
else {
  say(`\n${passed ? 'Passed' : 'Failed'} in ${seconds(total)}.`);
  if (!passed || keep || watch) say(`Report for Claude Code: ${final.file}`);
}
// Kept up after a failure too, so the office can be looked at where it stopped.
if (hold && !watch && t.up()) {
  say(
    `The office stays open at ${t.base} for ${holdMinutes} minutes. Press Ctrl+C to stop it sooner.`
  );
  say(scenariosHere);
  await new Promise<void>((done) => {
    atEnd = done;
    setTimeout(done, holdMinutes * 60_000).unref();
  });
}
if (watch && t.up()) {
  next = undefined;
  if (failedAt) current = failedAt;
  await bar(
    passed ? 'passed' : 'failed',
    `${passed ? 'Passed' : 'Failed'} in ${seconds(total)}. The office stays open: look around, play a scripted scenario from Dev (backquote), Scenarios, then Close the office.`
  );
  say(`The office stays open at ${t.base}. Close it from the bar in the page, or press Ctrl+C.`);
  say(scenariosHere);
  const watching = watchScenario(root, (s) => {
    scenarioNow = s;
    void drawBar?.({
      ...s,
      detail: s.live
        ? s.detail
        : `${s.detail} The office stays open: play another from Dev, Scenarios, or Close the office.`
    });
  });
  // A scenario played here checks its paths too: this run holds the page, so it takes the screenshots.
  const shooting = shown && watchBreaks(root, shown.page);
  await new Promise<void>((done) => (atEnd = done));
  watching.close();
  shooting?.close();
}
controls?.stop();
await shown?.browser.close().catch(() => {});
await t.stop();
// A path break's screenshots stay, even after a pass.
if (passed && !keep && !readBreaks(root).length) t.remove();
else say(`The office's folder is kept: ${root}`);
process.exit(passed ? 0 : 1);
