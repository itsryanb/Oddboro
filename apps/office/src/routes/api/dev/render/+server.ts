// The Dev window's lighting comparison: Main Street as `npm run render` draws
// it at an hour, as a PNG, to set beside the live floor (NEW-1681: the floor
// and the renderer glow at different strengths). Dev tools only.
import { error } from '@sveltejs/kit';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CODE } from '@oddboro/ledger/home';
import { requireDevTools } from '#lib/server/dev.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  requireDevTools();
  const hour = Math.round(Math.min(24, Math.max(0, Number(url.searchParams.get('hour')) || 0)));
  const world = join(CODE, 'packages', 'world');
  await new Promise<void>((done, fail) =>
    execFile(
      process.execPath,
      ['scripts/render.ts', 'main-street', '--hour', String(hour), '--scale', '1'],
      { cwd: world, timeout: 60_000, windowsHide: true },
      (e, _out, err) => (e ? fail(new Error(err || e.message)) : done())
    )
  ).catch((e: unknown) => error(500, `The renderer failed: ${e instanceof Error ? e.message : e}`));
  const png = readFileSync(join(world, 'out', `main-street-h${hour}.png`));
  return new Response(png, {
    headers: { 'content-type': 'image/png', 'cache-control': 'no-store' }
  });
};
