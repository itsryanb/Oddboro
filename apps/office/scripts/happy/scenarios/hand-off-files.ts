// NEW-1743: a hand-off brief can name files the receiving Odd cannot open.
// Marshall has Fay draft a plan, on one piece of work. Then he has Wes build
// from it on new work, two ways: once handing Wes a copy through hand_off's
// files, and once naming Fay's file in the brief. Wes must be able to read
// both.
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, until } from '../office.ts';
import type { Scenario } from '../play.ts';
import { asked, ids, part } from './parts.ts';

const PLAN = '# Launch plan\n\n1. Build the sign-up page.\n2. Send the invite.\n';
const DRAFT = 'Draft the plan';
const BY_COPY = 'Build from the copy';
const BY_PATH = "Build from Fay's draft";

/** Where Fay wrote plan.md: somewhere under her part of the work's folder. */
function findPlan(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  for (const f of readdirSync(dir, { recursive: true }).map(String))
    if (f.endsWith('plan.md') && !f.includes('handed')) return join(dir, f);
  return undefined;
}

export default {
  name: 'hand-off-files',
  title: 'An Odd can read the files a hand-off names',
  bug: { id: 'NEW-1743', open: true },
  plays: [
    {
      odd: 'Marshall',
      when: asked(DRAFT),
      once: true,
      acts: (c) => [
        {
          call: 'hand_off',
          input: {
            to: ids(c.notes).Fay,
            title: DRAFT,
            brief: 'Write the launch plan to plan.md and send it back.',
            request: DRAFT
          }
        }
      ],
      reply: 'Fay is drafting the plan.'
    },
    {
      odd: 'Fay',
      when: new RegExp(DRAFT),
      once: true,
      acts: (c) => [{ write: join(part(c.thisRun), 'plan.md'), content: PLAN }],
      reply: 'The plan is in plan.md.'
    },
    {
      odd: 'Marshall',
      when: /^Have Wes build/,
      once: true,
      acts: (c) => [
        {
          call: 'hand_off',
          input: {
            to: ids(c.notes).Wes,
            title: BY_COPY,
            brief: 'Build the launch from plan.md, which comes with this.',
            files: ['plan.md'],
            request: BY_COPY
          }
        },
        {
          call: 'hand_off',
          input: {
            to: ids(c.notes).Wes,
            title: BY_PATH,
            brief: `Build the launch from Fay's plan, at ${String(c.notes.faysPlan)}.`,
            request: BY_PATH
          }
        }
      ],
      reply: 'Wes is building from the plan.'
    },
    {
      odd: 'Wes',
      when: new RegExp(BY_COPY),
      once: true,
      // The brief lists the copy by its full path, under "Files Marshall handed you".
      acts: (c) => [{ read: /^\s+- (.*handed.plan\.md)$/m.exec(c.thisRun)?.[1] ?? 'plan.md' }],
      reply: 'Built it from the plan.'
    },
    {
      odd: 'Wes',
      when: new RegExp(BY_PATH),
      once: true,
      acts: (c) => [{ read: String(c.notes.faysPlan) }],
      reply: 'Built it from the plan.'
    }
  ],
  async story(s) {
    const home = s.office.officeHome;
    await s.step('Marshall has Fay draft the plan, and she writes plan.md', async () => {
      await s.chat('Marshall', `${DRAFT} for the launch with Fay.`);
      const sql = await s.office.sql();
      const [a] = await until('the work for the plan', async () => {
        const rows = await sql<
          { id: number }[]
        >`select id from threads where title = ${DRAFT} order by id desc limit 1`;
        return rows.length ? rows : undefined;
      });
      const plan = await until('plan.md', async () =>
        findPlan(join(home, 'threads', String(a.id), s.ids.Fay))
      );
      s.office.note('faysPlan', plan);
      await s.settle();
      // Marshall keeps a copy in his own folder, to hand on.
      cpSync(plan, join(home, 'staff', s.ids.Marshall, 'plan.md'));
    });

    await s.step('Marshall hands Wes the plan two ways, as new work', async () => {
      await s.chat('Marshall', 'Have Wes build the launch from the plan.');
      await s.settle();
      const handed = s.callsOf('Marshall', 'hand_off').slice(-2);
      for (const h of handed) expect(h.ok, `A hand-off was refused: ${h.text}`);
      expect(s.runsOf('Wes', new RegExp(BY_PATH)).length, 'Wes never started on the second');
    });

    await s.step('Wes reads the copy that came with the hand-off', async () => {
      const read = s
        .callsOf('Wes', 'read_file')
        .find((c) => String(c.input.path).includes('handed'));
      expect(read, 'Wes never read the copy');
      expect(read!.ok, `Wes could not read the copy: ${read!.text}`);
    });

    await s.step(
      "Wes reads Fay's plan, which the brief names by its path",
      async () => {
        const read = s
          .callsOf('Wes', 'read_file')
          .find((c) => !String(c.input.path).includes('handed'));
        expect(read, "Wes never read Fay's plan");
        expect(read!.ok, `Wes could not read the file the brief named: ${read!.text}`);
      },
      { bug: true }
    );
  }
} satisfies Scenario;
