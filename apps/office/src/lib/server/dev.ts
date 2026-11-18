// The office's dev tools (src/lib/dev/, the Dev window) answer behind three
// locks, all held here. The page also loads their code only in a dev build
// (`import.meta.env.DEV`), so a release never contains it.
//
// 1. Opt-in: ODDBORO_DEV_TOOLS=1 in the environment or .env. The office's
//    login service runs `vite dev` too, so a dev build alone is not enough.
// 2. Never in the app: ODDBORO_APP or ODDBORO_VERSION refuses it.
import { error } from '@sveltejs/kit';

export function devTools(): boolean {
  if (process.env.ODDBORO_APP || process.env.ODDBORO_VERSION) return false;
  return process.env.ODDBORO_DEV_TOOLS === '1';
}

/** For a dev route: answers 404, as if the route were not there, unless dev tools are on. */
export function requireDevTools(): void {
  if (!devTools()) error(404, 'Not found');
}
