// A path the page's path guard caught breaking through a wall
// (src/lib/dev/path-guard.ts). It goes in the office's log and in
// path-breaks.jsonl: beside a throwaway office, where the happy path and the
// scripted scenarios fail on it, or in this office's dev/path-breaks folder.
// The answer says which line it is, and where the page's picture of the floor
// for it goes, which the page sends next ({ shot, png }). Dev tools only.
import { error, json } from '@sveltejs/kit';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { home } from '@oddboro/ledger/home';
import { requireDevTools } from '#lib/server/dev.ts';
import type { RequestHandler } from './$types';

const folder = () => {
  const runs = process.env.ODDBORO_HAPPY_RUNS;
  const dir = runs ? dirname(runs) : home('dev', 'path-breaks');
  mkdirSync(dir, { recursive: true });
  return dir;
};
const floorShot = (dir: string, n: number) => join(dir, `path-break-${n}-floor.png`);

export const POST: RequestHandler = async ({ request }) => {
  requireDevTools();
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const dir = folder();
  const breaks = join(dir, 'path-breaks.jsonl');

  if (typeof b.shot === 'number') {
    const png = typeof b.png === 'string' ? b.png : '';
    const data = png.startsWith('data:image/png;base64,') ? png.slice(22) : '';
    if (!Number.isInteger(b.shot) || b.shot < 1 || !data)
      error(400, 'Send a break number and a PNG');
    const file = floorShot(dir, b.shot);
    writeFileSync(file, Buffer.from(data, 'base64'));
    return json({ file });
  }

  console.error(`Path break: ${b.name} ${b.why}${b.room ? ` in ${b.room}` : ''}`);
  appendFileSync(breaks, `${JSON.stringify({ ...b, seen: Date.now() })}\n`);
  const n = readFileSync(breaks, 'utf8').split('\n').filter(Boolean).length;
  return json({ n, shot: floorShot(dir, n), breaks, folder: dir });
};
