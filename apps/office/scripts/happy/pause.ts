// Pausing a watched happy path, from the control bar in the page (hud.ts) or
// from keys in the terminal. Every page action waits on `gate` first
// (browser.ts), so a pause lands before the next action, with that action's
// target highlighted in the window. While paused the page stays live,
// DevTools included, and keys print what the office holds.
import type { Locator } from 'playwright-core';
import type { HudCommand } from './hud.ts';

/** A key that prints something about the office, while paused or not. */
export type Look = { key: string; label: string; show: () => Promise<string> };

export type PauseState = { status: 'running' | 'pausing' | 'paused'; action?: string };

export type Pauser = {
  gate: (what: string, target: Locator) => Promise<void>;
  control: (c: HudCommand) => void;
  /** Time spent paused so far, which a step's time leaves out. */
  pausedMs: () => number;
  stop: () => void;
};

export function pauser(opts: {
  pauseAt?: string;
  looks: Look[];
  say: (text: string) => void;
  quit: () => void;
  /** Called whenever it pauses, steps or runs on, and before each action. */
  onChange: (s: PauseState) => void;
  /** Called on reaching a pause, before it waits: the report is written then. */
  onPause: (what: string) => Promise<void>;
}): Pauser {
  const { looks, say, quit, onChange, onPause } = opts;
  let paused = false;
  let pauseAt = opts.pauseAt?.toLowerCase();
  let go: (() => void) | undefined;
  let pausedMs = 0;
  let next: string | undefined;
  const help = [
    'p pause or run on',
    'n or Enter do the next action',
    ...looks.map((l) => `${l.key} ${l.label}`),
    'h these keys',
    'Ctrl+C stop'
  ].join(' · ');

  const stdin = process.stdin;
  const keys = !!stdin.isTTY;
  if (keys) {
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', (key: string) => void press(key));
    say(`  Keys: ${help}. The bar at the bottom of the page does the same.`);
  }

  const tell = () =>
    onChange({ status: go ? 'paused' : paused ? 'pausing' : 'running', action: next });

  function control(c: HudCommand) {
    if (c === 'stop') return quit();
    if (c === 'step') return release();
    if (go) {
      paused = false;
      release();
      say('  Running on.');
    } else {
      paused = true;
      say('  Pausing before the next action.');
    }
    tell();
  }

  async function press(key: string) {
    if (key === '\u0003') return control('stop');
    if (key === 'p' || key === ' ') return control('pause');
    if (key === 'n' || key === '\r') return control('step');
    if (key === 'h') return say(`  Keys: ${help}`);
    const look = looks.find((l) => l.key === key);
    if (look)
      say(
        (await look.show().catch((e: unknown) => `Could not read it: ${e}`))
          .split('\n')
          .map((line) => `    ${line}`)
          .join('\n')
      );
  }

  function release() {
    const g = go;
    go = undefined;
    g?.();
  }

  return {
    async gate(what, target) {
      next = what;
      if (pauseAt && what.toLowerCase().includes(pauseAt)) {
        paused = true;
        pauseAt = undefined;
      }
      if (!paused) return tell();
      await target.highlight().catch(() => {});
      const t = performance.now();
      const waiting = new Promise<void>((done) => (go = done));
      tell();
      say(
        `\n  Paused before: ${what}\n  The window is live: look around, or open DevTools with F12.`
      );
      await onPause(what);
      await waiting;
      pausedMs += performance.now() - t;
      tell();
    },
    control,
    pausedMs: () => pausedMs,
    stop() {
      if (!keys) return;
      stdin.setRawMode(false);
      stdin.pause();
    }
  };
}
