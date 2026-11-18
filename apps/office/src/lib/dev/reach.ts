// The reachability check: a walk from the front door over every walkable
// tile, then what no Odd could ever get to. Offices are drawn by an AI from a
// description, so a layout can be broken in ways nobody designed.
import type { World } from '@oddboro/world';
import type { Reach } from './overlay.ts';

export type ReachReport = Reach & {
  tiles: number;
  reachedTiles: number;
  spots: { id: string; room: string; activity: string; why: string; tile: [number, number] }[];
  rooms: string[];
  doors: [number, number][];
};

/** The walkable tile nearest `from`: the arrival tile itself is where Odds appear, not always a floor tile. */
function nearestWalkable(w: World, from: [number, number]): [number, number] {
  for (let r = 0; r < Math.max(w.width, w.height); r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = from[0] + dx;
        const y = from[1] + dy;
        if (x >= 0 && y >= 0 && x < w.width && y < w.height && w.walkable[y * w.width + x])
          return [x, y];
      }
  return from;
}

export function reachFrom(w: World, arrival: [number, number]): ReachReport {
  const reached = new Uint8Array(w.width * w.height);
  const at = (x: number, y: number) => y * w.width + x;
  const start = nearestWalkable(w, arrival);
  const queue: [number, number][] = [];
  if (w.walkable[at(...start)]) {
    reached[at(...start)] = 1;
    queue.push(start);
  }
  while (queue.length) {
    const [x, y] = queue.shift()!;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1]
    ] as const) {
      if (nx < 0 || ny < 0 || nx >= w.width || ny >= w.height) continue;
      const i = at(nx, ny);
      if (reached[i] || !w.walkable[i]) continue;
      reached[i] = 1;
      queue.push([nx, ny]);
    }
  }

  const spots: ReachReport['spots'] = [];
  for (const s of w.spots) {
    const why = !s.approach
      ? 'no open side to step in from'
      : !w.walkable[at(...s.approach)]
        ? 'its approach tile is blocked by a prop'
        : !reached[at(...s.approach)]
          ? 'no path reaches its approach tile'
          : undefined;
    if (why) spots.push({ id: s.id, room: s.room, activity: s.activity, why, tile: s.tile });
  }

  const rooms: string[] = [];
  for (const r of [...w.rooms, ...w.halls]) {
    let walk = 0;
    let got = 0;
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        if (!w.walkable[at(x, y)]) continue;
        walk++;
        if (reached[at(x, y)]) got++;
      }
    if (walk && !got) rooms.push(r.name || r.id);
  }

  const doors: [number, number][] = [];
  w.cells.forEach((c, i) => {
    if (c.kind === 'wall' && c.feature === 'door' && !reached[i])
      doors.push([i % w.width, Math.floor(i / w.width)]);
  });

  return {
    reached,
    badSpots: spots.map((s) => ({ tile: s.tile, why: s.why })),
    tiles: w.walkable.filter(Boolean).length,
    reachedTiles: reached.reduce((n, v) => n + v, 0),
    spots,
    rooms,
    doors
  };
}
