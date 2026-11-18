// The prompt a path break gives Claude Code: the bug, the evidence, where to
// look, and how to check a fix. One wording for the Dev window's Crowd tab
// (path-guard.ts) and the runners (scripts/happy/path-breaks.ts). Plain
// string work with no imports, so the page and Node both load it.

export type BreakFacts = {
  name: string;
  why: string;
  room?: string;
  to?: string;
  spot?: { id: string; tile: [number, number]; approach?: [number, number] };
  cell?: string;
  visiting?: string;
  at: [number, number];
  path: [number, number][];
};

/** Where a break was caught: what ran, the step, and how to see it again. */
export type Caught = { by: string; step?: string; rerun: string };

export const describeBreak = (b: BreakFacts) =>
  `${b.name}'s path${b.to ? ` to ${b.to}` : ''} ${b.why}${b.room ? ` in ${b.room}` : ''}`;

const tile = (t: [number, number]) => `(${t[0]},${t[1]})`;

export function breakPrompt(
  b: BreakFacts,
  e: {
    caught: Caught;
    /** Each screenshot with what it shows, or none taken and why. */
    shots: { file: string; shows: string }[] | string;
    /** The file with every break of this run, one JSON line each. */
    breaks?: string;
    /** The office's folder: its world, staff and log. */
    folder?: string;
  }
): string {
  return [
    `An Odd on the Oddboro floor walks through a wall. Help me find why and fix it.`,
    '',
    '## The bug',
    '',
    `${describeBreak(b)}.`,
    `- The tile where it breaks: ${tile(b.at)}, which holds ${b.cell ?? 'an unknown cell'}.`,
    b.spot
      ? `- It was going to spot ${b.spot.id} at ${tile(b.spot.tile)}${b.spot.approach ? `, which is entered only from ${tile(b.spot.approach)}` : ', which has no approach tile, so any side may step into it'}.`
      : '- It was going to no spot: a walk to a tile (a visit, a meeting point, or the way out).',
    ...(b.visiting ? [`- It was on a visit: ${b.visiting}.`] : []),
    `- The path, tile by tile from where it stood: ${b.path.map(tile).join(' ')}`,
    '',
    '## Evidence',
    '',
    ...(typeof e.shots === 'string'
      ? [`- No screenshot: ${e.shots}.`]
      : e.shots.map((s) => `- Screenshot: ${s.file}. ${s.shows} Open it first.`)),
    `- Caught by ${e.caught.by}${e.caught.step ? `, at the step "${e.caught.step}"` : ''}.`,
    ...(e.breaks ? [`- Every break in this run, one JSON line each: ${e.breaks}`] : []),
    ...(e.folder ? [`- The office's folder (its world, staff and log): ${e.folder}`] : []),
    '',
    '## Where to look',
    '',
    '- packages/world/src/path.ts: findPath, A* over the walkable grid. The start and the goal tile may be unwalkable; `enter` and `leave` limit how a seat is entered and left.',
    '- apps/office/src/lib/floor/staff.ts: where a path is planned (sendTo, pathTo, a visit re-aiming as its colleague moves, the way back to a spot).',
    '- packages/world/src/compose.ts: which cells are walls, doors and walkable floor, and the spots and their approach tiles.',
    '- apps/office/src/lib/dev/path-check.ts: the check that caught it: a wall with no door, a jump between tiles that do not touch, or a blocked tile before the seat.',
    '',
    '## What to do',
    '',
    '1. Work out how this path came to cross that tile, from the code above and the evidence.',
    '2. Propose the smallest fix in the code that planned it, and say why it is right. If the check is what is wrong, say that instead.',
    `3. After the fix, ${e.caught.rerun}, and confirm no new path break comes.`
  ].join('\n');
}

/** What the screenshots show, for the prompt. */
export const SHOWS = {
  page: "The whole page, with the Dev window's Rooms and Paths layers: each room's bounds and name, the path as a line with a dot per tile, its bad tiles in coral, and a box round the tile where it breaks.",
  floor:
    "The floor as drawn, without the page's panels and name tags, with the same Rooms and Paths marks and the camera on the break."
};
