// NEW-1784: a removed lead's window-held work keeps held_by, so an unanswered
// window ask can stay on the desk. The plan's 5-hour window is at 90%, so the
// office holds Fay's hand-off and Marshall's, under one window ask. Fay leaves
// the office. At the reset, Marshall's work picks back up, and the ask nobody
// answered should leave the desk.
import { expect } from '../office.ts';
import type { Play, Scenario } from '../play.ts';
import { asked, ids } from './parts.ts';

const FAYS = 'Get the figures for the board';
const MARSHALLS = 'Check the dates for the offsite';
const HELD = /holds new hand-offs/;

/** A run that sees the window at 90%, then hands on: the office holds it. */
const handsOn = (odd: string, words: string, to: string): Play => ({
  odd,
  when: asked(words),
  once: true,
  acts: (c) => [
    { usage: { fiveHour: 0.9, resetsInMinutes: 30 } },
    // The office notes the window as the line arrives, a moment before the hand-off.
    { think: 1500 },
    {
      call: 'hand_off',
      input: { to: ids(c.notes)[to], title: words, brief: `${words}.`, request: words }
    }
  ],
  reply: 'The office is holding that until the window resets.',
  outcome: 'waiting'
});

const windowAsk = async (s: Parameters<Scenario['story']>[0]) =>
  (
    await (await s.office.sql())<{ id: number; status: string }[]>`
    select id, status from asks where kind = 'window' order by id desc limit 1`
  )[0];

export default {
  name: 'window-leaves',
  title: "A leaving Odd's held work does not keep the window ask on the desk",
  bug: { id: 'NEW-1784', open: false },
  plays: [handsOn('Fay', FAYS, 'Wes'), handsOn('Marshall', MARSHALLS, 'Wes')],
  async story(s) {
    const sql = await s.office.sql();
    const heldBy = async (title: string) =>
      (
        await sql<
          { held_by: number | null }[]
        >`select held_by from threads where title = ${title} order by id desc limit 1`
      )[0]?.held_by;

    await s.step("The window is at 90%: the office holds Fay's hand-off", async () => {
      await s.chat('Fay', `${FAYS}.`);
      const [h] = s.callsOf('Fay', 'hand_off');
      expect(h && HELD.test(h.text), `The hand-off was not held: ${h?.text ?? 'never called'}`);
      const ask = await windowAsk(s);
      expect(ask, 'No window ask was raised');
      expect((await heldBy(FAYS)) === ask.id, "Fay's work is not held by the window ask");
    });

    await s.step("Marshall's hand-off waits on the same ask", async () => {
      await s.chat('Marshall', `${MARSHALLS}.`);
      const [h] = s.callsOf('Marshall', 'hand_off');
      expect(h && HELD.test(h.text), `The hand-off was not held: ${h?.text ?? 'never called'}`);
      expect((await heldBy(MARSHALLS)) === (await windowAsk(s)).id, 'It is held by another ask');
      await s.settle();
    });

    await s.step('Fay leaves the office, and her work stops', async () => {
      await s.office.api(`/api/staff/${s.ids.Fay}`, undefined, 'DELETE');
      const [t] = await sql<{ ended_at: Date | null }[]>`
        select ended_at from threads where title = ${FAYS} order by id desc limit 1`;
      expect(t?.ended_at, "Fay's work is still open");
    });

    await s.step(
      'At the reset, the held work picks up and the unanswered ask leaves the desk',
      async () => {
        const before = s.runsOf('Marshall').length;
        await s.clock.windowReset();
        await s.settle();
        expect(s.runsOf('Marshall').length > before, "Marshall's held work never picked up");
        const ask = await windowAsk(s);
        const desk = (await s.now()).desk.asks;
        expect(
          !desk.some((a) => a.id === ask.id),
          `The window ask is still on the desk (${ask.status}). Fay's stopped work still holds it: held_by ${await heldBy(FAYS)}`
        );
      },
      { bug: true }
    );
  }
} satisfies Scenario;
