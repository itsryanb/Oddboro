// The path guard: every way an Odd walks, checked against the walls as the
// floor renders it. A path that steps onto a wall with no door, jumps between
// tiles that do not touch, or crosses a blocked tile before its seat is a
// break: the guard shows it the way the Dev window's Rooms and Paths layers
// would (overlay.ts), with the camera on it, and tells the server
// (/api/dev/path-break), which writes it beside a throwaway office for the
// happy path and the scripted scenarios to fail on. Then it takes its own
// picture of the floor and keeps a prompt for Claude Code with it, which the
// Crowd tab's Prompt copies. It checks the real Odds and, while the Dev window
// is open, its ghost Odds (`guardAlso`). Dev tools only, like the Dev window,
// and it rides the floor's render hook, so it does nothing while the floor is
// still.
import { Rectangle } from 'pixi.js';
import { TILE, type World } from '@oddboro/world';
import type { StaffActor } from '../floor/staff.ts';
import { pathBreak } from './path-check.ts';
import type { DevHost } from './host.ts';
import { Overlay } from './overlay.ts';
import { breakPrompt, describeBreak, SHOWS } from './path-prompt.ts';

export type PathBreak = {
  odd: string;
  name: string;
  /** The tile where the path breaks. */
  at: [number, number];
  why: string;
  /** The room that tile is in, if any. */
  room?: string;
  /** Where the Odd was going: its spot's room and what it does there. */
  to?: string;
  /** The spot it was going to, with the tile it must step in from. */
  spot?: { id: string; tile: [number, number]; approach?: [number, number] };
  /** What the world holds at the break: "a plain wall (plaster)", "floor (oak), blocked by a prop". */
  cell: string;
  /** Whether it was on a visit to a colleague, which re-aims as the colleague moves. */
  visiting?: string;
  path: [number, number][];
};

/** What the world holds at a tile, in words, for the prompt a break gives Claude Code. */
function cellAt(w: World, [x, y]: [number, number]): string {
  const c = w.cells[y * w.width + x];
  const walk = w.walkable[y * w.width + x] ? 'walkable' : 'not walkable';
  if (!c || c.kind === 'void') return `nothing (outside the floor), ${walk}`;
  if (c.kind === 'floor')
    return `floor (${c.material}), ${walk}${walk === 'not walkable' ? ': a prop or seat stands on it' : ''}`;
  return `a ${c.feature} wall (${c.style}), ${walk}`;
}

const roomAt = (w: World, [x, y]: [number, number]) =>
  [...w.rooms, ...w.halls].find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
    ?.name || undefined;

/**
 * Checks each path once, on the frame after it changes, and reports each
 * broken walk once: a walk is one Odd's way to one place, until it gets there.
 * Returns the way to stop.
 */
export function guardPaths(host: DevHost): () => void {
  const floor = host.floor();
  if (!floor) return () => {};
  const checked = new Map<string, string>();
  /** Each Odd's walk already reported, by where it ends. */
  const told = new Map<string, string>();
  marks.shown = [];
  marks.overlay = undefined;
  const before = floor.onRender;
  floor.onRender = () => {
    before?.();
    const w = host.world();
    for (const a of [...host.actors(), ...[...marks.also].flatMap((f) => f())]) {
      const id = a.profile.id;
      const { tile, path, spot, trip } = a.snapshot();
      if (!path.length) {
        told.delete(id);
        continue;
      }
      const sig = `${tile}>${path.join(' ')}`;
      if (checked.get(id) === sig) continue;
      checked.set(id, sig);
      const b = pathBreak(w, tile, path);
      if (!b) continue;
      const end = String(path.at(-1));
      if (told.get(id) === end) continue;
      told.set(id, end);
      const found: PathBreak = {
        odd: id,
        name: a.profile.name,
        ...b,
        room: roomAt(w, b.at),
        to: spot ? `${host.roomName(spot.room) ?? spot.room}, to ${spot.activity}` : undefined,
        spot: spot && { id: spot.id, tile: spot.tile, approach: spot.approach },
        cell: cellAt(w, b.at),
        visiting: trip
          ? `visiting ${trip.to}, ${trip.phase}, re-aimed ${trip.reaims} times`
          : undefined,
        path: [tile, ...path]
      };
      marks.shown.push(found);
      (marks.overlay ??= new Overlay(floor)).showBreaks(marks.shown);
      // A new break shows, so the runner's screenshot of it does too.
      marks.overlay.setVisible((marks.visible = true));
      floor.focus(b.at[0] * TILE + TILE / 2, b.at[1] * TILE + TILE / 2);
      // One bug per tile crossed, however many walks cross it: the first gets the picture and prompt.
      const first = marks.caught.find((o) => String(o.found.at) === String(b.at));
      const caught: Caught = { found, ghost: id.startsWith('ghost-'), walks: 1 };
      if (first) first.walks++;
      else marks.caught.push(caught);
      tell();
      void report(caught, host, !first);
    }
  };
  return () => {
    floor.onRender = before;
    marks.overlay?.destroy();
    marks.overlay = undefined;
  };
}

/**
 * What the guard has drawn: each broken walk, frozen as planned, so a
 * screenshot taken after the Odd walked on still shows it. They stay until
 * cleared; the Layers tab hides, shows and clears them.
 */
const marks = {
  shown: [] as PathBreak[],
  overlay: undefined as Overlay | undefined,
  visible: true,
  /** Every break caught in this page, with its picture and prompt as they come. */
  caught: [] as Caught[],
  /** More Odds to check: the Dev window's ghosts. */
  also: new Set<() => StaffActor[]>(),
  /** Pictures taken this page, at most SHOTS, the last at `lastShot`. */
  shots: 0,
  queue: Promise.resolve(),
  listeners: new Set<() => void>()
};

/** A break the page caught: what broke, where its picture went, and the prompt to fix it. */
export type Caught = {
  found: PathBreak;
  ghost: boolean;
  /** How many walks crossed this same tile, this one first. */
  walks: number;
  /** Its line in path-breaks.jsonl, from 1, once the server has it. */
  n?: number;
  shot?: string;
  prompt?: string;
};

/** A crowd with walls ignored breaks every few steps: past this, breaks are listed without a picture. */
const SHOTS = 25;
/** Long enough for the camera to glide to the break in a watched page. */
const SETTLE_MS = 1200;
const tell = () => marks.listeners.forEach((fn) => fn());

export const breakMarks = {
  count: () => marks.shown.length,
  visible: () => marks.visible,
  setVisible(on: boolean) {
    marks.visible = on;
    marks.overlay?.setVisible(on);
    tell();
  },
  clear() {
    marks.shown = [];
    marks.caught = [];
    marks.overlay?.showBreaks([]);
    tell();
  },
  /** Each tile a walk broke through in this page, oldest first, with how many walks did. */
  caught: () => marks.caught,
  /** Calls `fn` each time the marks change; returns the way to stop. */
  listen(fn: () => void) {
    marks.listeners.add(fn);
    return () => void marks.listeners.delete(fn);
  }
};

/** Checks these Odds too, as long as the caller keeps them; returns the way to stop. */
export function guardAlso(actors: () => StaffActor[]): () => void {
  marks.also.add(actors);
  return () => void marks.also.delete(actors);
}

/**
 * Sends a break to the server, then, one at a time, turns the camera to it,
 * takes the floor's picture and sends that, and writes the prompt.
 */
async function report(c: Caught, host: DevHost, first: boolean) {
  const b = c.found;
  console.warn(`Path break: ${describeBreak(b)}`);
  const kept = await fetch('/api/dev/path-break', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(b)
  })
    .then((r) =>
      r.ok ? (r.json() as Promise<{ n: number; breaks: string; folder: string }>) : undefined
    )
    .catch(() => undefined);
  // A tile already caught has its picture: this walk is only counted, and logged for the runners.
  if (!first) return tell();
  c.n = kept?.n;
  const prompt = (shots: { file: string; shows: string }[] | string) =>
    breakPrompt(b, {
      caught: c.ghost
        ? {
            by: 'a crowd of ghost Odds in the Dev window (Crowd tab)',
            rerun: 'add a crowd again in the Dev window (Crowd tab) and let it walk a while'
          }
        : {
            by: "the path guard, watching the office's own Odds",
            rerun: `send ${b.name} the same way again`
          },
      shots,
      breaks: kept?.breaks,
      folder: kept?.folder
    });
  if (!kept) {
    c.prompt = prompt('the server did not keep the break');
    return tell();
  }
  if (marks.shots >= SHOTS) {
    c.prompt = prompt(`this page already took ${SHOTS} pictures, so this break has none`);
    return tell();
  }
  marks.shots++;
  marks.queue = marks.queue.then(async () => {
    const floor = host.floor();
    if (!floor) return;
    floor.focus(b.at[0] * TILE + TILE / 2, b.at[1] * TILE + TILE / 2);
    marks.overlay?.setVisible((marks.visible = true));
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    // This walk alone in the picture, then every mark back.
    marks.overlay?.showBreaks([b]);
    const { width, height } = floor.app.screen;
    const png = await floor.app.renderer.extract
      .base64({ target: floor.app.stage, frame: new Rectangle(0, 0, width, height) })
      .catch(() => undefined);
    marks.overlay?.showBreaks(marks.shown);
    const saved = png
      ? await fetch('/api/dev/path-break', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ shot: kept.n, png })
        })
          .then((r) => (r.ok ? (r.json() as Promise<{ file: string }>) : undefined))
          .catch(() => undefined)
      : undefined;
    c.shot = saved?.file;
    c.prompt = prompt(
      saved ? [{ file: saved.file, shows: SHOWS.floor }] : 'the floor could not be read or saved'
    );
    tell();
  });
}
