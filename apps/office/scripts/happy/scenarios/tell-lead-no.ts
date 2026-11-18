// NEW-1740: a clarifying "no" passed through tell_lead was read as rejecting
// the work. Fay leads work Wes is on. Pat tells Wes "No, I meant
// figures-old.md", and Wes passes the "No" to Fay, as the tool asks: the
// owner's words, copied exactly. Fay's next run must see what the "no" was
// about, not the bare word.
import { expect, until } from '../office.ts';
import type { Scenario } from '../play.ts';
import { asked, ids } from './parts.ts';

const WORK = 'Find the figures for the report';
const CLARIFY = 'No, I meant figures-old.md, not figures.md.';

export default {
  name: 'tell-lead-no',
  title: 'A "no" passed to the lead keeps what it was about',
  bug: { id: 'NEW-1740', open: false },
  plays: [
    {
      odd: 'Fay',
      when: asked(WORK),
      once: true,
      acts: (c) => [
        {
          call: 'hand_off',
          input: {
            to: ids(c.notes).Wes,
            title: 'Find the figures',
            brief: "Find last quarter's figures and send them back.",
            request: WORK
          }
        }
      ],
      reply: 'Wes is finding the figures.'
    },
    {
      odd: 'Wes',
      when: /Find the figures/,
      once: true,
      acts: [],
      reply: 'I used the figures in figures.md.'
    },
    {
      odd: 'Fay',
      when: /Wes took the work/,
      once: true,
      acts: [],
      reply: 'Wes found the figures in figures.md. The report waits for them to be checked.',
      outcome: 'waiting'
    },
    {
      odd: 'Wes',
      when: asked(CLARIFY),
      once: true,
      acts: (c) => [
        {
          call: 'tell_lead',
          input: {
            work: c.notes.work,
            words: 'No',
            reading: 'Pat meant figures-old.md, not the new figures file.'
          }
        }
      ],
      reply: 'Got it, figures-old.md. I passed that to Fay.'
    }
  ],
  async story(s) {
    await s.step('Fay leads the work, and Wes is on it', async () => {
      await s.chat('Fay', `${WORK}.`);
      await s.settle();
      const sql = await s.office.sql();
      const [w] = await sql<
        { id: number }[]
      >`select id from threads where title = ${WORK} order by id desc limit 1`;
      expect(w, 'There is no work for the figures');
      s.office.note('work', w.id);
    });

    await s.step('Pat clarifies to Wes, and Wes passes it to Fay', async () => {
      const before = s.runsOf('Fay').length;
      await s.chat('Wes', CLARIFY);
      const [told] = s.callsOf('Wes', 'tell_lead');
      expect(told?.ok, `tell_lead did not pass it on: ${told?.text ?? 'never called'}`);
      await until("Fay's next run", async () => s.runsOf('Fay').length > before);
      await s.settle();
    });

    await s.step(
      "Fay's run sees what the no was about",
      async () => {
        const run = s.runsOf('Fay').at(-1)!;
        const told = /Pat's words: .*/.exec(run.thisRun ?? '')?.[0] ?? '(no words passed)';
        expect((run.thisRun ?? '').includes('figures-old.md'), `Fay was told only: ${told}`);
      },
      { bug: true }
    );
  }
} satisfies Scenario;
