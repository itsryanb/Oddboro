// What the Dev window needs that the page cannot see: whose chat reply is in
// flight, and the server process itself. Read-only, and 404 unless dev tools
// are on (src/lib/server/dev.ts).
import { json } from '@sveltejs/kit';
import { roster } from '@oddboro/ledger';
import { requireDevTools } from '#lib/server/dev.ts';
import { chatting, inProgress } from '#lib/server/staff.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  requireDevTools();
  const staff = await roster();
  const mem = process.memoryUsage();
  return json({
    chatting: chatting().filter((id) => staff.some((s) => s.id === id)),
    inProgress: inProgress(),
    server: {
      pid: process.pid,
      upSeconds: Math.round(process.uptime()),
      rssMb: Math.round(mem.rss / 1e6),
      heapMb: Math.round(mem.heapUsed / 1e6),
      node: process.version
    }
  });
};
