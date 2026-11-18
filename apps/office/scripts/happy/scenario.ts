// The happy path's story, read by both sides: the runner (run.ts) plays the
// owner through the office's own API, and the Claude Code stand-in
// (stand-in.ts) plays every Odd. Each run the stand-in matches below does
// exactly what it says, so the story always ends the same way.
import type { Play } from './play.ts';

export const OWNER = 'Pat';
export const ZONE = 'America/Los_Angeles';
export const MANAGER = 'marshall';

/**
 * Each hire wears a ready-made manager's look, since the office refuses a
 * look another Odd already has and drawing one would need a real model.
 * Rooms are on Main Street, the office a new owner starts in.
 */
export const HIRES = [
  { name: 'Wes', role: 'Researcher', remit: 'Finds things out.', room: 'library', look: 'ziva' },
  { name: 'Fay', role: 'Writer', remit: 'Writes things up.', room: 'workspace', look: 'jamal' }
] as const;

export const deskFor = (name: string, role: string) =>
  `You are ${name}, the office's ${role.toLowerCase()}.`;

export const PLAN_LUNCH =
  "Plan Friday's team lunch. Write the guest list to guest-list.md, then ask me where we should eat.";
export const PLACES = ['Taco Hut', 'Noodle Bar'];
export const PICK = 'Noodle Bar';
export const GUEST_LIST = '# Friday team lunch\n\n- Pat\n- Marshall\n- Wes\n- Fay\n';
export const BOOKING = `Booked ${PICK} for Friday at noon, a table for 4.\n`;
export const TASK_TITLE = 'Pick where we eat on Friday';
export const PLAN_REPLY =
  'I wrote the guest list to guest-list.md and put the choice of place on your desk.';

/** First match wins, so the follow-up (which also names the lunch) comes first. */
export const SCRIPTS: Play[] = [
  {
    odd: 'Fay',
    when: new RegExp(PICK),
    acts: [{ write: 'booking.md', content: BOOKING }],
    reply: `${PICK} it is. I booked a table for Friday at noon and wrote it to booking.md.`,
    outcome: 'done'
  },
  {
    odd: 'Fay',
    when: /guest list/i,
    acts: [
      { write: 'guest-list.md', content: GUEST_LIST },
      {
        task: {
          title: TASK_TITLE,
          why: 'I can book either place, but where the team eats is your call.',
          steps: ['Pick a place below.'],
          choices: PLACES
        }
      }
    ],
    reply: PLAN_REPLY,
    outcome: 'waiting'
  }
];

/** Any run the story does not script, such as a new hire's hello. */
export const fallbackReply = (odd: string) => `Hi ${OWNER}, ${odd} here. Ready when you are.`;
