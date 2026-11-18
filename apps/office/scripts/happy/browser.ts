// The owner's side of the happy path played through the real page with
// Playwright: the welcome cards, the hire window, an Odd's chat and the Desk.
// run.ts uses it for `--watch` (a window to follow) and `--ui` (none). It
// drives the Chrome or Edge already installed, so nothing downloads a browser.
//
// Every action goes through `act`, which first waits on the gate run.ts sets
// (`setGate`): that is how a watched run pauses, and steps one action at a time.
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';

export type Shown = { browser: Browser; page: Page };

/** What run.ts does before each action: nothing, or a pause until the owner of the run goes on. */
export type Gate = (what: string, target: Locator) => Promise<void>;
let gate: Gate = async () => {};
export const setGate = (g: Gate) => {
  gate = g;
};

/** `init` runs on the new page before it loads, such as putting in the control bar. */
export async function openPage(
  url: string,
  show: boolean,
  slowMo: number,
  init?: (page: Page) => Promise<void>
): Promise<Shown> {
  const tried: string[] = [];
  for (const channel of ['chrome', 'msedge']) {
    try {
      const browser = await chromium.launch({
        channel,
        headless: !show,
        slowMo,
        args: ['--mute-audio']
      });
      // With no window, motion is reduced, as the page offers its owners: the
      // office going up is then instant (reveal.ts), and nobody misses it.
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
        reducedMotion: show ? 'no-preference' : 'reduce'
      });
      page.setDefaultTimeout(30_000);
      await init?.(page);
      await page.goto(url);
      return { browser, page };
    } catch (e) {
      tried.push(`${channel}: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}`);
    }
  }
  throw new Error(`No Chrome or Edge to drive. ${tried.join('; ')}`);
}

/** One action, named for a pause to show: it waits for its target on the page, then the gate. */
async function act(what: string, target: Locator, run: (t: Locator) => Promise<unknown>) {
  await target.waitFor();
  await gate(what, target);
  await run(target);
}

const button = (where: Locator | Page, name: string | RegExp) =>
  where.getByRole('button', { name, exact: typeof name === 'string' });

/** Clicks a button once it is enabled, which Playwright waits for. */
const press = (what: string, where: Locator | Page, name: string | RegExp) =>
  act(what, button(where, name), (b) => b.click());

const type = (what: string, field: Locator, text: string) => act(what, field, (f) => f.fill(text));

/**
 * The six welcome cards, then the office going up and the manager arriving.
 * `skip` presses the page's own Skip on that show, for when nobody watches.
 */
export async function onboard(page: Page, owner: string, skip: boolean) {
  const welcome = page.getByRole('region', { name: 'Welcome to Oddboro' });
  // The dev server builds the page on its first load, which takes a while.
  await welcome.waitFor({ timeout: 120_000 });
  await press('Your computer: press Next once the checks pass', welcome, 'Next');
  await type(`You: type "${owner}"`, welcome.getByPlaceholder('Your first name'), owner);
  await press("You: press That's me", welcome, "That's me");
  // Your AI: the office signs in to Claude of its own before Next opens.
  const signIn = button(welcome, 'Sign in with Claude');
  await signIn
    .or(welcome.getByRole('button', { name: 'Next', disabled: false }))
    .first()
    .waitFor();
  if (await signIn.isVisible())
    await press('Your AI: press Sign in with Claude', welcome, 'Sign in with Claude');
  await press('Your AI: press Next', welcome, 'Next');
  await press('Your office manager: press Next, with Marshall picked', welcome, 'Next');
  await press('Your space: press Next, with Main Street picked', welcome, 'Next');
  await press('Open the office: press Open the office', welcome, 'Open the office');
  await welcome.waitFor({ state: 'detached', timeout: 120_000 });
  const opening = page.getByRole('status', { name: 'Opening the office' });
  if (skip)
    await button(opening, 'Skip')
      .click()
      .catch(() => {});
  await opening.waitFor({ state: 'detached', timeout: 120_000 });
}

export type Hire = { name: string; role: string; remit: string; room: string; desk: string };

/** The hire window, step by step, with a look built from random parts so no model draws one. */
export async function hire(page: Page, h: Hire) {
  const odd = page.getByRole('region', { name: 'Hire an Odd' });
  const at = `Hire ${h.name}:`;
  if (!(await odd.isVisible())) {
    if (!(await page.getByRole('region', { name: 'Hire', exact: true }).isVisible()))
      await press(`${at} open Hire`, page, 'Hire');
    await press(`${at} press Hire an Odd`, page, 'Hire an Odd');
  }
  await type(`${at} type the name`, odd.getByPlaceholder('e.g. Mira'), h.name);
  await type(`${at} type the role`, odd.getByPlaceholder('e.g. Mail Clerk'), h.role);
  // Offered only where the office draws looks; elsewhere parts are the only way.
  const parts = odd.getByRole('radio', { name: 'Build from parts' });
  await odd.getByRole('region', { name: 'Build from parts' }).or(parts).first().waitFor();
  if (await parts.isVisible()) await act(`${at} pick Build from parts`, parts, (p) => p.click());
  // Next waits until the built look is kept.
  await press(`${at} press Next once the look is kept`, odd, 'Next');
  // Whole name only: Workspace is not Workspace East.
  await press(`${at} pick the ${h.room}`, odd, new RegExp('^' + h.room + '$', 'i'));
  await press(`${at} press Next`, odd, 'Next');
  await type(`${at} type the card's line`, odd.getByPlaceholder('What this Odd is for'), h.remit);
  await type(
    `${at} type the job description`,
    odd.getByLabel('Job description (its instructions)'),
    h.desk
  );
  // What it may use, its first job (none), then the summary.
  for (const what of ['its tools', 'its first job (none)', 'the summary'])
    await press(`${at} press Next to ${what}`, odd, 'Next');
  await press(`${at} press Hire ${h.name}`, odd, `Hire ${h.name}`);
  await odd.waitFor({ state: 'detached' });
}

/** Opens an Odd's chat from the rail, sends `message`, and waits for `reply` to show. */
export async function chat(page: Page, name: string, role: string, message: string, reply: string) {
  const box = page.getByPlaceholder(`Message ${name}`);
  // A new hire's chat opens by itself; any other Odd is picked from the rail.
  if (!(await box.isVisible())) await press(`Open ${name}'s chat`, page, `${name}, ${role}`);
  await type(`${name}'s chat: type the message`, box, message);
  await act(`${name}'s chat: press Enter to send`, box, (b) => b.press('Enter'));
  await page.getByText(reply).first().waitFor({ timeout: 60_000 });
}

/** Opens a task on the Desk, ticks its plain steps, picks `answer`, and marks it done. */
export async function pick(page: Page, title: string, answer: string) {
  await press('Desk: open it', page, /^Desk/);
  await act(`Desk: open "${title}"`, page.getByText(title).first(), (t) => t.click());
  for (const box of await page.getByRole('checkbox', { name: /^Mark step \d+ done$/ }).all())
    await act('Desk: tick the step', box, (b) => b.check());
  const choices = page.getByRole('group', { name: 'Choices' });
  await press(`Desk: pick ${answer}`, choices, answer);
  await press('Desk: press Mark done', page, 'Mark done');
}
