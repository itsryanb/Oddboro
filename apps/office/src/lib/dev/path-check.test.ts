// The path guard's check: a path that steps through a wall, jumps, or crosses
// a blocked tile before its seat breaks; one through a door, or ending on its
// seat, does not. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Cell, World } from '@oddboro/world';
import { pathBreak } from './path-check.ts';

/**
 * Two rooms side by side, a wall between them with one door, and a seat:
 *   . . # . .
 *   . . D . s
 */
const PLAN = ['..#..', '..D.s'];
const world = (): World => {
  const cells: Cell[] = [];
  const walkable: boolean[] = [];
  for (const row of PLAN)
    for (const ch of row) {
      cells.push(
        ch === '#' || ch === 'D'
          ? { kind: 'wall', style: 'plaster', feature: ch === 'D' ? 'door' : 'plain' }
          : { kind: 'floor', material: 'oak' }
      );
      walkable.push(ch === '.' || ch === 'D');
    }
  return { width: 5, height: 2, cells, walkable } as World;
};

test('a path through the door, ending on its seat, does not break', () => {
  const w = world();
  const way: [number, number][] = [
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 1]
  ];
  assert.equal(pathBreak(w, [0, 1], way), undefined);
});

test('a path through the wall breaks there', () => {
  const b = pathBreak(
    world(),
    [1, 0],
    [
      [2, 0],
      [3, 0]
    ]
  );
  assert.deepEqual(b?.at, [2, 0]);
  assert.match(b!.why, /walks through the plain wall at \(2,0\)/);
});

test('a jump between tiles that do not touch breaks', () => {
  const b = pathBreak(world(), [1, 0], [[3, 0]]);
  assert.match(b!.why, /jumps from \(1,0\) to \(3,0\)/);
});

test('crossing the seat on the way somewhere else breaks', () => {
  const w = world();
  w.walkable[1 * 5 + 4] = false;
  const b = pathBreak(
    w,
    [3, 1],
    [
      [4, 1],
      [4, 0]
    ]
  );
  assert.match(b!.why, /blocked tile at \(4,1\)/);
});
