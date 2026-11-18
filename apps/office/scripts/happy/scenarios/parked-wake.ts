// NEW-1741: approved work waiting on a task in another thread does not start
// when that task is done. Marshall's first piece of work ends with "Test v1" on
// Pat's desk. His second is parked until 9 tomorrow, to start once Pat has
// tested. Pat finishes the test now: the second should start now, and the
// 9 o'clock wake should not start it again.
import { expect, sleep, until, type Task } from '../office.ts';
import type { Scenario } from '../play.ts';
import { asked, ids } from './parts.ts';

const V1 = 'Ship v1 for Pat to test';
const V2 = 'Prep v2, and start it once Pat has tested v1';
const TEST = 'Test v1';
const v2Runs = /Prep v2/;

export default {
  name: 'parked-wake',
  title: 'Finishing a task starts the work parked on it',
  bug: { id: 'NEW-1741', open: true },
  plays: [
    {
      odd: 'Marshall',
      when: asked(V1),
      once: true,
      acts: (c) => [
        {
          call: 'hand_off',
          input: { to: ids(c.notes).Wes, title: 'Build v1', brief: 'Build v1.', request: V1 }
        }
      ],
      reply: 'Wes is building v1.'
    },
    { odd: 'Wes', when: /Build v1/, once: true, acts: [], reply: 'v1 is built.' },
    {
      odd: 'Marshall',
      when: /Wes took the work/,
      once: true,
      acts: [
        {
          task: {
            title: TEST,
            why: 'v1 is built. Try it before we start on v2.',
            steps: ['Try v1, then mark this done.']
          }
        }
      ],
      reply: 'v1 is ready for you to test.',
      outcome: 'waiting'
    },
    {
      odd: 'Marshall',
      when: asked(V2),
      once: true,
      acts: (c) => [
        {
          call: 'hand_off',
          input: { to: ids(c.notes).Fay, title: 'Prep v2', brief: 'Get v2 ready.', request: V2 }
        }
      ],
      reply: 'Fay is getting v2 ready.'
    },
    { odd: 'Fay', when: /Prep v2/, once: true, acts: [], reply: 'v2 is ready to start.' },
    {
      odd: 'Marshall',
      when: /Fay took the work/,
      once: true,
      // Tomorrow at 9, as Marshall did in the office this came from.
      acts: [{ call: 'resume_at', input: { in_minutes: 12 * 60 } }],
      reply: 'v2 starts at 9 tomorrow, after your test.',
      outcome: 'waiting'
    }
  ],
  async story(s) {
    let task: Task | undefined;
    await s.step(`Marshall's first work ends with "${TEST}" on the desk`, async () => {
      await s.chat('Marshall', `${V1}.`);
      task = await until('the test on the desk', async () =>
        (await s.now()).desk.tasks.find((t) => t.title === TEST)
      );
      await s.settle();
    });

    await s.step('His second work is parked until tomorrow', async () => {
      await s.chat('Marshall', `${V2}.`);
      await s.settle();
      const [parked] = s.callsOf('Marshall', 'resume_at');
      expect(parked?.ok, `resume_at failed: ${parked?.text ?? 'never called'}`);
      const sql = await s.office.sql();
      const [b] = await sql<
        { resume_at: Date | null }[]
      >`select resume_at from threads where title = ${V2} order by id desc limit 1`;
      expect(b?.resume_at, 'The second work is not parked');
    });

    const parkedRuns = s.runsOf('Marshall', v2Runs).length;
    await s.step(
      `Pat finishes "${TEST}", and the parked work starts`,
      async () => {
        await s.office.api(`/api/tasks/${task!.id}`, { op: 'finish', done: true });
        await s.settle();
        // One more look than the clock needs: it plans again on every change.
        await sleep(1000);
        expect(
          s.runsOf('Marshall', v2Runs).length > parkedRuns,
          `Only the test's own work picked up. The v2 work stays parked until tomorrow.`
        );
      },
      { bug: true }
    );

    await s.step('At 9, the parked work is picked up once in all', async () => {
      await s.clock.thread(V2).catch(() => {});
      await s.settle();
      const picked = s.runsOf('Marshall', v2Runs).length - parkedRuns;
      expect(picked === 1, `The parked work was picked up ${picked} times`);
    });
  }
} satisfies Scenario;
