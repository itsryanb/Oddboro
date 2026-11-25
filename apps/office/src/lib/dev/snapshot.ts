// One row per Odd for the Dev window's inspector: what the server says, what
// the page decided and which rule decided it, where it walks, and what its
// tag says with the field the words came from. Each value names its source,
// so the window answers "where did that come from?" without the code.
import { TILE } from '@oddboro/world';
import type { StaffActor } from '../floor/staff.ts';
import { ACTIVITY_LABEL, type Activity } from '../staff/roster.ts';
import type { DevHost } from './host.ts';

export type Flag = { level: 'warn' | 'info'; text: string };

export type Row = {
  id: string;
  name: string;
  server: { run?: string; since?: string; queued: number; chatting: boolean; desk: string[] };
  page: {
    activity: Activity;
    want: string;
    reason: string;
    mode: 'manual' | 'forced' | 'free';
    stayLeft?: number;
    spot?: string;
    room?: string;
    pathLen: number;
    moving: boolean;
  };
  visit?: string;
  tag: { words: string; rule: string };
  surfaces: { surface: string; says: string; reads: string }[];
  flags: Flag[];
  snap: ReturnType<StaffActor['snapshot']>;
};

/** Which of the tag's six rules made its words (statusOf in +page.svelte). */
export function tagRule(h: DevHost, a: StaffActor): string {
  const id = a.profile.id;
  if (a.moving && (a.visiting || a.destination)) return 'rule 1: walking, the heading';
  if (h.messages()[id]) return 'rule 2: an unread message';
  if (h.waiting().has(id)) {
    const d = h.desk();
    const ask = d.asks.find((x) => x.staffId === id);
    const task = d.tasks.find((x) => x.staffId === id);
    return `rule 3: waiting, ${ask ? `ask #${ask.id}` : task ? `task #${task.id}` : 'a message'}`;
  }
  if (h.threadTag(id)?.text) return 'rule 4: a thread a colleague holds';
  if (h.working()[id]) return 'rule 5: working[id], the run going';
  return `rule 6: the activity label, ${a.activity}`;
}

/** What the page wants for an Odd and why, as wantOf decides it. */
function wantOf(h: DevHost, id: string): { want: string; reason: string } {
  const d = h.desk();
  if (h.waiting().has(id)) {
    const ask = d.asks.find((x) => x.staffId === id);
    const task = d.tasks.find((x) => x.staffId === id);
    const why = ask ? `ask #${ask.id}` : task ? `task #${task.id}` : 'an unread message';
    return { want: 'wait', reason: `waiting on you: ${why}` };
  }
  if (h.working()[id]) return { want: 'work', reason: `running "${h.working()[id]}"` };
  const waitsOn = h.threadTag(id)?.waitsOn;
  if (waitsOn) return { want: 'work', reason: `waits on ${waitsOn}` };
  return { want: 'nothing', reason: 'free: wanders between activities' };
}

export function rows(h: DevHost, chatting: Set<string>): Row[] {
  const now = performance.now();
  const world = h.world();
  const d = h.desk();
  const tagBoxes = tagRects();
  return h.actors().map((a) => {
    const id = a.profile.id;
    const snap = a.snapshot();
    const work = h.inProgress()[id] ?? [];
    const going = h.working()[id];
    const mine = [
      ...d.asks.filter((x) => x.staffId === id).map((x) => `ask #${x.id} ${x.title}`),
      ...d.tasks.filter((x) => x.staffId === id).map((x) => `task #${x.id} ${x.title}`)
    ];
    const { want, reason } = wantOf(h, id);
    const manual = !!h.manual()[id];
    const forced = h.forced()[id];
    const leave = h.leaveAt()[id];
    const words = h.words(a);
    const rule = tagRule(h, a);
    const flags: Flag[] = [];

    if (words === 'Waiting on you' && !mine.length && !h.messages()[id])
      flags.push({
        level: 'warn',
        text: 'Tag says Waiting on you, but nothing on the Desk is from this Odd'
      });
    // Bug 5 (NEW-1659): main now shows a free Odd at a desk as "At their desk",
    // so this fires only if the words claim work that is not going.
    if (/\bWorking\b/.test(words) && !going && !work.length && !manual)
      flags.push({
        level: 'warn',
        text: `Says Working, but the server has no run${leave ? ` (a free Odd's stay, ${Math.max(0, Math.round((leave - now) / 1000))} s left)` : ''}`
      });
    if (going && a.activity !== 'work' && !a.onTrip && !manual)
      flags.push({
        level: 'warn',
        text: `The server runs "${going}" but the page shows ${a.activity}`
      });
    const bad = snap.path.find(([x, y]) => !world.walkable[y * world.width + x]);
    if (bad)
      flags.push({
        level: 'warn',
        text: `Path crosses tile (${bad[0]}, ${bad[1]}), which is not walkable`
      });
    if (snap.trip?.phase === 'stay') {
      const to = h.actors().find((o) => o.profile.id === snap.trip!.to);
      if (to && Math.hypot(to.x - a.x, to.y - a.y) > TILE * 1.5)
        flags.push({
          level: 'warn',
          text: `Visit stayed more than a tile from ${to.profile.name}`
        });
    }
    const box = tagBoxes.get(a.profile.name);
    if (box)
      for (const [other, b] of tagBoxes)
        if (other !== a.profile.name && overlap(box, b)) {
          flags.push({ level: 'warn', text: `Tag overlaps ${other}'s` });
          break;
        }

    const spot = snap.spot;
    return {
      id,
      name: a.profile.name,
      server: {
        run: going,
        since: work.find((w) => !w.queued)?.since,
        queued: work.filter((w) => w.queued).length,
        chatting: chatting.has(id),
        desk: mine
      },
      page: {
        activity: a.activity,
        want,
        reason,
        mode: manual ? 'manual' : forced ? 'forced' : 'free',
        stayLeft: leave ? Math.max(0, (leave - now) / 1000) : undefined,
        spot: spot?.id,
        room: spot ? (h.roomName(spot.room) ?? spot.room) : undefined,
        pathLen: snap.path.length,
        moving: a.moving
      },
      visit: snap.trip
        ? `${snap.trip.phase} to ${h.staff().find((s) => s.id === snap.trip!.to)?.name ?? snap.trip.to}, re-aim ${snap.trip.reaims}/${snap.trip.maxReaims}`
        : undefined,
      tag: { words, rule },
      surfaces: [
        { surface: 'Floor tag', says: words, reads: rule },
        {
          surface: 'Card and rail',
          says: ACTIVITY_LABEL[a.activity],
          reads: "the floor actor's activity"
        },
        {
          surface: 'In progress tab',
          says: work.length ? work.map((w) => w.label).join(', ') : 'Nothing right now',
          reads: `inProgress[${id}]`
        },
        { surface: 'Server run', says: going ?? 'none', reads: `working[${id}]` }
      ],
      flags,
      snap
    };
  });
}

type Box = { x: number; y: number; w: number; h: number };
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Each floor name tag's box on screen, by the Odd's name. */
export function tagRects(): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const el of document.querySelectorAll<HTMLElement>('button.tag')) {
    const name = el.querySelector('span')?.textContent?.trim();
    const r = el.getBoundingClientRect();
    if (name && r.width) out.set(name, { x: r.x, y: r.y, w: r.width, h: r.height });
  }
  return out;
}

export const seconds = (s: number | undefined) =>
  s === undefined
    ? ''
    : s < 60
      ? `${Math.round(s)} s`
      : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
