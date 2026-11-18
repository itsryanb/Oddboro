// The happy path's control bar, drawn over the page in a watched run: where
// the run is, what it does next, and buttons to pause, step, stop, and copy a
// prompt for Claude Code. Playwright puts it in, so it is never part of the
// app; a shadow root keeps the page's styles and its own apart. It is drawn
// again after any reload (the dev server reloads the page once on a first load).
import type { Page } from 'playwright-core';

export type HudState = {
  /** `known`: a scripted scenario failed the way its open bug says (scenario-live.ts). */
  status: 'running' | 'pausing' | 'paused' | 'known' | 'passed' | 'failed' | 'stopped';
  /** "3 of 9: Onboard Pat with marshall". */
  step: string;
  /** The action it is paused before, or the one it does next. */
  action?: string;
  /** A failure's reason, or what to do at the end. */
  detail?: string;
  /** What Copy for Claude Code puts on the clipboard. */
  prompt: string;
  /** A path break's prompt to fix it (path-breaks.ts): Prompt copies it, and is off without one. */
  fixPrompt?: string;
};

export type HudCommand = 'pause' | 'step' | 'stop';

/** Before the first load: the page gets the bar's code and a way to call back. */
export async function installHud(page: Page, onCommand: (c: HudCommand) => void) {
  await page.exposeFunction('__happyCommand', (c: HudCommand) => onCommand(c));
  await page.addInitScript(BAR);
  let last: HudState | undefined;
  const draw = () =>
    page
      .evaluate(
        (s) => (window as unknown as { __happyDraw?: (s: unknown) => void }).__happyDraw?.(s),
        last
      )
      .catch(() => {});
  page.on('load', () => void draw());
  return (s: HudState) => {
    last = s;
    return draw();
  };
}

// Runs in the page, so it is plain JavaScript in a string.
const BAR = `(() => {
  const COLOURS = {
    running: '#5fb3a1', pausing: '#e0b04f', paused: '#e0b04f',
    known: '#e0904f', passed: '#7cc47a', failed: '#e06a5f', stopped: '#9aa0b4'
  };
  const LABEL = {
    running: 'Running', pausing: 'Pausing', paused: 'Paused',
    known: 'Known bug', passed: 'Passed', failed: 'Failed', stopped: 'Stopped'
  };
  // Built once and then only updated in place, at a fixed size with every
  // button always there: a bar redrawn or resized under the pointer moves or
  // replaces the button between press and release, and the click is lost.
  let root;
  let el;
  let state;
  function build() {
    root = document.createElement('div');
    root.id = 'happy-path-bar';
    const shadow = root.attachShadow({ mode: 'open' });
    shadow.innerHTML = \`
      <style>
        .bar { position: fixed; inset-block-end: 12px; inset-inline-start: 50%; transform: translateX(-50%);
          z-index: 2147483647; display: grid; grid-template-columns: 10px minmax(0, 1fr) auto;
          align-items: center; gap: 10px; inline-size: min(880px, 96vw); box-sizing: border-box;
          padding-block: 8px; padding-inline: 12px; border-radius: 12px; background: rgba(14, 16, 28, 0.94);
          color: #e8e6f0; font: 13px/1.35 system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,0.45); }
        .dot { inline-size: 10px; block-size: 10px; border-radius: 50%; }
        .text { display: flex; flex-direction: column; min-inline-size: 0; }
        .step, .action { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; block-size: 1.35em; }
        .step { font-weight: 600; }
        .action { color: #b8b5c8; }
        .buttons { display: flex; gap: 6px; }
        button { font: inherit; padding-block: 5px; padding-inline: 10px; border: 0; border-radius: 8px;
          background: #2a2f45; color: #e8e6f0; cursor: pointer; white-space: nowrap; text-align: center; }
        button:hover:not(:disabled) { background: #3a4060; }
        button:disabled { opacity: 0.35; cursor: default; }
        button.main { background: #5fb3a1; color: #0e101c; font-weight: 600; inline-size: 76px; }
        button.copy { inline-size: 168px; }
        button.fix { inline-size: 84px; background: #e06a5f; color: #0e101c; font-weight: 600; }
        button.fix:hover:not(:disabled) { background: #f08a7f; }
        button.stop { inline-size: 132px; }
      </style>
      <div class="bar" role="toolbar" aria-label="Happy path">
        <span class="dot"></span>
        <div class="text"><span class="step"></span><span class="action"></span></div>
        <div class="buttons">
          <button class="main" data-c="pause">Pause</button>
          <button data-c="step">Step</button>
          <button class="fix" data-c="fix" disabled>Prompt</button>
          <button class="copy" data-c="copy">Copy for Claude Code</button>
          <button class="stop" data-c="stop">Stop</button>
        </div>
      </div>\`;
    const q = (s) => shadow.querySelector(s);
    el = {
      dot: q('.dot'), step: q('.step'), action: q('.action'),
      main: q('[data-c="pause"]'), stepBtn: q('[data-c="step"]'),
      copy: q('[data-c="copy"]'), fix: q('[data-c="fix"]'), stop: q('[data-c="stop"]')
    };
    // One listener on the bar, reading the state at the moment of the click.
    q('.buttons').addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled || !state) return;
      const c = b.dataset.c;
      if (c !== 'copy' && c !== 'fix') return window.__happyCommand(c);
      // Prompt copies the path break's own prompt; Copy for Claude Code, the report's.
      const text = c === 'fix' ? state.fixPrompt : state.prompt;
      const label = c === 'fix' ? 'Prompt' : 'Copy for Claude Code';
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const t = document.createElement('textarea');
        t.value = text;
        shadow.appendChild(t);
        t.select();
        document.execCommand('copy');
        t.remove();
      }
      b.textContent = 'Copied';
      setTimeout(() => (b.textContent = label), 1500);
    });
    (document.body || document.documentElement).appendChild(root);
  }
  window.__happyDraw = (s) => {
    if (!s || !document.body) return;
    if (!root || !root.isConnected) build();
    state = s;
    const done = ['known', 'passed', 'failed', 'stopped'].includes(s.status);
    el.dot.style.background = COLOURS[s.status];
    el.step.textContent = LABEL[s.status] + ' · ' + s.step;
    el.action.textContent = s.detail || (s.action ? (s.status === 'paused' ? 'Next: ' : 'Now: ') + s.action : '');
    el.main.textContent = s.status === 'paused' ? 'Run on' : s.status === 'pausing' ? 'Pausing' : 'Pause';
    el.main.disabled = done;
    el.stepBtn.disabled = s.status !== 'paused';
    el.stop.textContent = done ? 'Close the office' : 'Stop';
    el.fix.disabled = !s.fixPrompt;
    el.fix.title = s.fixPrompt
      ? 'Copy a prompt for Claude Code to fix the path that broke through a wall, with its screenshot'
      : 'Comes on when a path breaks through a wall';
  };
})();`;
