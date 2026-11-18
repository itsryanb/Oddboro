// A* over the walkable grid, four directions. Staff use it to walk between
// spots; the grid comes from composeWorld.
export type PathRules = {
  /** The only tile the path may step into the goal from (a seat's approach). */
  enter?: [number, number];
  /** The only tile the path may step to from the start (standing up from a seat). */
  leave?: [number, number];
};

export function findPath(
  walkable: boolean[],
  width: number,
  from: [number, number],
  to: [number, number],
  rules: PathRules = {}
): [number, number][] | undefined {
  const height = walkable.length / width;
  const idx = (x: number, y: number) => y * width + x;
  const goal = idx(to[0], to[1]);
  const start = idx(from[0], from[1]);
  const h = (i: number) => Math.abs((i % width) - to[0]) + Math.abs(Math.floor(i / width) - to[1]);
  const g = new Map<number, number>([[start, 0]]);
  const came = new Map<number, number>();
  const open: number[] = [start];
  const f = new Map<number, number>([[start, h(start)]]);
  while (open.length) {
    let best = 0;
    for (let k = 1; k < open.length; k++) if (f.get(open[k])! < f.get(open[best])!) best = k;
    const cur = open.splice(best, 1)[0];
    if (cur === goal) {
      const path: [number, number][] = [];
      for (let c: number | undefined = cur; c !== undefined; c = came.get(c))
        path.unshift([c % width, Math.floor(c / width)]);
      return path;
    }
    const cx = cur % width;
    const cy = Math.floor(cur / width);
    for (const [nx, ny] of [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1]
    ]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = idx(nx, ny);
      if (!walkable[n] && n !== goal) continue;
      if (n === goal && rules.enter && idx(...rules.enter) !== cur) continue;
      if (cur === start && rules.leave && n !== idx(...rules.leave) && n !== goal) continue;
      const score = g.get(cur)! + 1;
      if (score < (g.get(n) ?? Infinity)) {
        came.set(n, cur);
        g.set(n, score);
        f.set(n, score + h(n));
        if (!open.includes(n)) open.push(n);
      }
    }
  }
  return undefined;
}
