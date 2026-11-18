// NEW-1682: a schedule is checked by two different rules. The page takes times
// from 00:00 to 23:59 and every 5 to 1,440 minutes. Wes changes his own job
// through edit_my_job, in chat, as the owner asks: first to 99:99, then to
// every 200 billion minutes. The office should refuse both, keep the schedule
// as it was, and run the job on time with no error.
import { readFileSync } from 'node:fs';
import { expect, until } from '../office.ts';
import type { Play, Scenario, Story } from '../play.ts';
import { asked } from './parts.ts';

const JOB = 'Morning digest';
const AT = '07:00';
const LATE = 'Run my digest at 99:99 from now on.';
const RARE = 'Run my digest every 200000000000 minutes.';

const edit = (words: string, schedule: Record<string, unknown>): Play => ({
  odd: 'Wes',
  when: asked(words),
  once: true,
  acts: [{ call: 'edit_my_job', input: { job: JOB, schedule } }],
  reply: 'Done.'
});

type Job = { name: string; schedule: Record<string, unknown> };

async function scheduleOf(s: Story) {
  const jobs = await s.office.api<Job[]>(`/api/staff/${s.ids.Wes}/jobs`);
  return jobs.find((j) => j.name === JOB)?.schedule;
}

async function refusedAndKept(s: Story, words: string, call: number) {
  await s.chat('Wes', words);
  const c = s.callsOf('Wes', 'edit_my_job')[call];
  expect(c, 'Wes never called edit_my_job');
  const schedule = await scheduleOf(s);
  expect(
    !c.ok || !/^Changed/.test(c.text),
    `The office took it: "${c.text}", and the job now runs ${JSON.stringify(schedule)}`
  );
  expect(schedule?.at === AT, `The schedule changed anyway: ${JSON.stringify(schedule)}`);
}

export default {
  name: 'schedule-limits',
  title: 'An Odd cannot set a schedule the page would refuse',
  bug: { id: 'NEW-1682', open: true },
  stopsOffice: true,
  plays: [edit(LATE, { every: 'day', at: '99:99' }), edit(RARE, { every: 'minutes', n: 2e11 })],
  async story(s) {
    await s.step(`Wes has a job, "${JOB}", daily at ${AT}`, async () => {
      await s.office.api(`/api/staff/${s.ids.Wes}/jobs`, {
        name: JOB,
        instructions: '1. Sum up the morning.',
        schedule: { every: 'day', at: AT }
      });
    });

    await s.step('The office refuses a daily time of 99:99', () => refusedAndKept(s, LATE, 0), {
      bug: true
    });

    await s.step('The office refuses every 200 billion minutes', () => refusedAndKept(s, RARE, 1), {
      bug: true
    });

    // Found by this scenario, past what NEW-1682 says: the clock used to throw
    // when the bad schedule came due. That part is fixed on main, so this
    // step now guards against it coming back.
    await s.step('The job runs when due, and the office keeps running', async () => {
      const lines = readFileSync(s.office.logFile, 'utf8').split('\n').length;
      const before = s.runsOf('Wes', new RegExp(JOB)).length;
      await s.clock.job(JOB);
      await until(
        'the digest to run',
        async () => !s.office.up() || s.runsOf('Wes', new RegExp(JOB)).length > before
      );
      const errors = readFileSync(s.office.logFile, 'utf8')
        .split('\n')
        .slice(lines - 1)
        .filter((l) => /error/i.test(l));
      expect(
        s.office.up(),
        `The office stopped when the job came due: ${errors[0]?.trim() ?? 'no error logged'}`
      );
      await s.settle();
      expect(!errors.length, `The office logged: ${errors[0]?.trim()}`);
    });
  }
} satisfies Scenario;
