// Whether a path breaks through a wall: the path guard's check
// (path-guard.ts), with no renderer, so a test can run it.
import type { World } from '@oddboro/world';

/** Why a walk from `from` along `path` breaks through a wall, or undefined when it does not. */
export function pathBreak(
  w: World,
  from: [number, number],
  path: [number, number][]
): { at: [number, number]; why: string } | undefined {
  let [px, py] = from;
  for (let k = 0; k < path.length; k++) {
    const [x, y] = path[k];
    if (Math.abs(x - px) + Math.abs(y - py) > 1)
      return {
        at: [x, y],
        why: `jumps from (${px},${py}) to (${x},${y}), tiles that do not touch`
      };
    const cell = w.cells[y * w.width + x];
    if (cell?.kind === 'wall' && cell.feature !== 'door')
      return { at: [x, y], why: `walks through the ${cell.feature} wall at (${x},${y})` };
    // The last tile is the seat itself, which is never walkable.
    if (k < path.length - 1 && !w.walkable[y * w.width + x])
      return { at: [x, y], why: `walks over the blocked tile at (${x},${y})` };
    [px, py] = [x, y];
  }
  return undefined;
}
