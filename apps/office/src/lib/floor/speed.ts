// How fast the floor plays: 1, or N from `?speed=N` in the page's address (up
// to 10), for watching a test run (`npm run happy -- --watch`). Walks and
// glides go by the ticker's time (engine.ts); the office going up and the bus
// wait in real time, so they divide their waits by it (`paced`).

export const SPEED = (() => {
  if (typeof location === 'undefined') return 1;
  const n = Number(new URLSearchParams(location.search).get('speed'));
  return n > 1 ? Math.min(n, 10) : 1;
})();

/** A wait of `ms` at the floor's speed. */
export const paced = (ms: number) => ms / SPEED;
