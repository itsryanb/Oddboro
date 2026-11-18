// Paths the page's path guard caught breaking through a wall
// (src/lib/dev/path-guard.ts), as the office keeps them beside a throwaway
// office: one line each in path-breaks.jsonl. The happy path (run.ts) and the
// scripted scenarios (scripted.ts) fail the step one lands in, with a
// screenshot of the page named for its line (path-break-1.png for the first)
// and, beside it, a prompt that asks Claude Code to fix it
// (path-break-1.prompt.md), which the bar's and the Dev window's Prompt
// buttons copy.
import { existsSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import {
  breakPrompt,
  describeBreak,
  SHOWS,
  type BreakFacts,
  type Caught
} from '../../src/lib/dev/path-prompt.ts';
import { sleep } from './office.ts';

export { describeBreak };

export type PathBreak = BreakFacts;
export type { Caught };

const FILE = 'path-breaks.jsonl';

export function readBreaks(root: string): PathBreak[] {
  const f = join(root, FILE);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as PathBreak);
}

/** The runner's screenshot of the page for the break on line `n` (from 0). */
export const shotOf = (root: string, n: number) => join(root, `path-break-${n + 1}.png`);
/** The page's own picture of the floor for it (/api/dev/path-break). */
export const floorShotOf = (root: string, n: number) => join(root, `path-break-${n + 1}-floor.png`);

/** What Claude Code is told about the break on line `n`, with whichever screenshots exist. */
export function promptFor(root: string, n: number, b: PathBreak, caught: Caught): string {
  const shots = [
    { file: shotOf(root, n), shows: SHOWS.page },
    { file: floorShotOf(root, n), shows: SHOWS.floor }
  ].filter((s) => existsSync(s.file));
  return breakPrompt(b, {
    caught,
    shots: shots.length ? shots : 'none was taken in time',
    breaks: join(root, FILE),
    folder: root
  });
}

/** Saves the page as it is now for each break from line `from` on. */
export async function shoot(page: Page, root: string, from: number, to: number) {
  // The guard turns the camera to the break: in a watched run it glides there for about a second.
  await sleep(1200);
  for (let n = from; n < to; n++) await page.screenshot({ path: shotOf(root, n) }).catch(() => {});
}

/**
 * The failure for breaks from line `from` on, once the page has shown them,
 * or undefined with none: its message, and the prompt for the first break,
 * also written beside its screenshot. `page` takes the screenshot; without
 * one, it waits a moment for the runner that holds the page to take it.
 */
export async function breakFailure(root: string, from: number, caught: Caught, page?: Page) {
  // The guard reports as it draws: give a break made at the step's end a frame to land.
  await sleep(150);
  const all = readBreaks(root);
  if (all.length <= from) return undefined;
  // The page sends its own picture of the floor as well, a moment after the camera turns.
  const taken = () => existsSync(shotOf(root, from)) && existsSync(floorShotOf(root, from));
  if (page) await shoot(page, root, from, all.length);
  for (let i = 0; i < 20 && !taken(); i++) await sleep(150);
  const shot = [shotOf(root, from), floorShotOf(root, from)].find((f) => existsSync(f));
  const prompt = promptFor(root, from, all[from], caught);
  const promptFile = shotOf(root, from).replace(/\.png$/, '.prompt.md');
  writeFileSync(promptFile, prompt);
  return {
    seen: all.length,
    prompt,
    message: `${describeBreak(all[from])}. ${shot ? `Screenshot: ${shot}` : 'No screenshot came in time.'} Prompt for Claude Code: ${promptFile}${all.length - from > 1 ? `. ${all.length - from - 1} more in path-breaks.jsonl.` : ''}`
  };
}

/** For a runner that holds the page while the office stays open: screenshots each new break. */
export function watchBreaks(root: string, page: Page) {
  let seen = readBreaks(root).length;
  return watch(root, (_, file) => {
    if (file !== FILE) return;
    const now = readBreaks(root).length;
    if (now <= seen) return;
    const from = seen;
    seen = now;
    void shoot(page, root, from, now);
  });
}
