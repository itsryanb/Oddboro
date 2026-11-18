// NEW-1659: an Odd stayed on Working after a failed or idle run. Wes has three
// jobs that each end badly: one crashes, one hits the plan's usage limit, and
// one goes quiet until the office gives up on it. After each, Wes must be free
// and the run must be on record as failed.
import { doing, expect, RUN_TIMEOUT_MS, until } from '../office.ts';
import type { Scenario, Story } from '../play.ts';

const JOBS = {
  crash: 'Crash',
  limit: 'Hit the limit',
  quiet: 'Go quiet'
};
const job = (name: string) => new RegExp(`running your job "${name}"`);
/** What Claude Code says when the plan's limit is hit. The wording is an assumption, not captured. */
const LIMIT = "You've hit your limit · resets 3pm (America/Los_Angeles)";

type Run = { status: string; summary: string | null };

/** Runs one job by hand, as Run now does, and waits for its run to end. */
async function runNow(s: Story, id: number): Promise<Run> {
  await s.office.api(`/api/jobs/${id}`, { op: 'run' });
  const sql = await s.office.sql();
  return until(
    'the run to end',
    async () => {
      const [r] = await sql<Run[]>`select status, summary from runs where job_id = ${id}`;
      return r && r.status !== 'running' ? r : undefined;
    },
    RUN_TIMEOUT_MS + 15_000
  );
}

async function wesIsFree(s: Story) {
  const o = await s.settle();
  const now = doing(o, s.ids.Wes);
  expect(!now, `Wes still shows as busy: ${now}`);
}

export default {
  name: 'stuck-working',
  title: 'A crashed, limited or quiet run leaves the Odd free',
  bug: { id: 'NEW-1659', open: false },
  plays: [
    {
      odd: 'Wes',
      when: job(JOBS.crash),
      acts: [{ exit: 1, stderr: 'TypeError: Cannot read properties of undefined' }]
    },
    { odd: 'Wes', when: job(JOBS.limit), acts: [{ limit: LIMIT }] },
    { odd: 'Wes', when: job(JOBS.quiet), acts: [{ hang: true }] }
  ],
  async story(s) {
    const ids: Record<string, number> = {};
    await s.step('Give Wes three jobs', async () => {
      for (const name of Object.values(JOBS)) {
        const j = await s.office.api<{ id: number }>(`/api/staff/${s.ids.Wes}/jobs`, {
          name,
          instructions: `1. ${name}.`,
          schedule: { every: 'day', at: '07:00' }
        });
        ids[name] = j.id;
      }
    });

    await s.step('A run that crashes ends failed, and Wes is free', async () => {
      const r = await runNow(s, ids[JOBS.crash]);
      expect(r.status === 'failed', `The run is on record as ${r.status}: ${r.summary}`);
      await wesIsFree(s);
    });

    await s.step(
      'A run that hits the usage limit ends failed, and Wes is free',
      async () => {
        const r = await runNow(s, ids[JOBS.limit]);
        await wesIsFree(s);
        expect(
          r.status === 'failed',
          `The limit was taken as a reply: the run is ${r.status}, with "${r.summary}" as what Wes did`
        );
      },
      { bug: true }
    );

    await s.step('A run that goes quiet is stopped, ends failed, and Wes is free', async () => {
      const r = await runNow(s, ids[JOBS.quiet]);
      expect(r.status === 'failed', `The run is on record as ${r.status}: ${r.summary}`);
      await wesIsFree(s);
    });
  }
} satisfies Scenario;
