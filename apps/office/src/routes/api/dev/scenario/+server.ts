// The Dev window's Scenarios tab: runs the happy path (scripts/happy/run.ts) or
// a scripted scenario (scripts/happy/scripted.ts) headless, in a throwaway
// office of its own on other ports, and answers with its JSON result. When
// this office is itself a throwaway (`npm run happy -- --watch` keeps one
// open), a scripted scenario can play here instead, on the floor in front of
// the owner. Dev tools only.
import { error, json } from '@sveltejs/kit';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { CODE } from '@oddboro/ledger/home';
import { requireDevTools } from '#lib/server/dev.ts';
import type { RequestHandler } from './$types';

/** One run at a time: each starts a whole office of its own, or plays in this one. */
let running: Promise<unknown> | undefined;

/** This office's folder when it is a throwaway one, which only the happy path's runner makes. */
const throwawayFolder = () =>
  process.env.ODDBORO_HAPPY_RUNS ? dirname(process.env.ODDBORO_HAPPY_RUNS) : undefined;

export const GET: RequestHandler = () => {
  requireDevTools();
  return json({ here: !!throwawayFolder() });
};

export const POST: RequestHandler = async ({ request }) => {
  requireDevTools();
  const { name, here } = (await request.json().catch(() => ({}))) as {
    name?: string;
    here?: boolean;
  };
  // scripted.ts refuses a name it has no scenario for; this only keeps flags out.
  if (!name || !/^[a-z][a-z-]*$/.test(name)) error(400, 'Name a scenario');
  const folder = throwawayFolder();
  if (here && !folder) error(400, 'This office is not a throwaway one, so nothing plays in it');
  if (here && name === 'first-hour')
    error(400, 'The happy path plays only in an office of its own');
  if (running) error(409, 'A scenario is already running');
  // The throwaway office must not inherit this one's home, ports or locks.
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env))
    if (!/^(ODDBORO_|OFFICE_|DATABASE_URL$)/.test(k)) env[k] = v;
  const script = (file: string) => join(CODE, 'apps', 'office', 'scripts', 'happy', file);
  running = new Promise((done) =>
    execFile(
      process.execPath,
      name === 'first-hour'
        ? [script('run.ts'), '--json', '--keep']
        : [script('scripted.ts'), name, '--json', ...(here ? ['--office', folder!] : [])],
      { cwd: CODE, env, timeout: 240_000, windowsHide: true, maxBuffer: 4e6 },
      (_e, out, err) => {
        const line = String(out).trim().split('\n').at(-1) ?? '';
        try {
          done(JSON.parse(line));
        } catch {
          const why = line || String(err).trim().split('\n')[0];
          done({ passed: false, steps: [], error: why || 'The run printed nothing' });
        }
      }
    )
  );
  try {
    return json(await running);
  } finally {
    running = undefined;
  }
};
