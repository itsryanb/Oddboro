// Everything the Dev window's tabs share, and the one place it hooks into the
// floor: the render hook (inspector rows, rewind, tag boxes), the renderer
// (the redraw meter), the ticker (overlay, ghosts, the clock), setHour (the
// time scrubber), fetch (the network conditioner) and the event tap (the log).
// `attach` adds each hook, `detach` takes each away, so a closed window
// leaves the office as it was.
import { TILE } from '@oddboro/world';
import type { Activity } from '../staff/roster.ts';
import type { OfficeEvent } from '../server/events.ts';
import type { StaffActor } from '../floor/staff.ts';
import type { Floor } from '../floor/engine.ts';
import type { DevHost } from './host.ts';
import { guardAlso } from './path-guard.ts';
import { Overlay, type Ghost, type LayerId, type Reach } from './overlay.ts';
import { rows, tagRects, type Row } from './snapshot.ts';

export type LogLine = { at: number; kind: 'event' | 'page' | 'check' | 'dev'; text: string };
export type Frame = {
  at: number;
  odds: { id: string; name: string; x: number; y: number; activity: Activity; words: string }[];
};
export type View = 'normal' | 'untinted' | 'light' | 'glow' | 'emissive';
type Inside = {
  layers: { visible: boolean }[];
  sky: { visible: boolean };
  shafts: { visible: boolean };
  shadows: { visible: boolean };
  objects: { visible: boolean };
  lightScene: { visible: boolean };
  glow: { visible: boolean };
  moteLayer: { visible: boolean };
  shaded: { tint: number }[];
  nightTint: number;
};

const REWIND_MS = 10 * 60_000;

export class DevState {
  tab = $state('odds');
  layers = $state<Record<string, boolean>>({});
  rows = $state.raw<Row[]>([]);
  picked = $state<string | undefined>();
  log = $state.raw<LogLine[]>([]);
  server = $state<{
    pid: number;
    upSeconds: number;
    rssMb: number;
    heapMb: number;
    node: string;
  }>();
  chatting = new Set<string>();

  hourOverride = $state<number | undefined>();
  clockSpeed = $state(0);
  view = $state<View>('normal');

  draws: { at: number; why: string }[] = [];
  domChanges: number[] = [];
  perfTick = $state(0);

  reach = $state.raw<Reach | undefined>();
  rewindAt = $state<number | undefined>();
  frames: Frame[] = [];
  framesCount = $state(0);

  ghosts: { a: StaffActor; leave: number }[] = [];
  ghostCount = $state(0);
  noSpot = $state(0);

  delayMs = $state(0);
  /** Set by the window: the next click on the floor goes to `fn` instead (the probe, a puppet move). */
  floorCatch: (fn: ((e: MouseEvent) => void) | undefined) => void = () => {};

  /** A click on the floor, in world pixels and the tile under it. */
  worldAt(e: MouseEvent): { x: number; y: number; tile: [number, number] } | undefined {
    const f = this.floor;
    if (!f) return undefined;
    const r = f.app.canvas.getBoundingClientRect();
    const p = f.stage.toLocal({ x: e.clientX - r.left, y: e.clientY - r.top });
    return { x: p.x, y: p.y, tile: [Math.floor(p.x / TILE), Math.floor(p.y / TILE)] };
  }

  private overlay: Overlay | undefined;
  private undo: (() => void)[] = [];
  private lastRows = 0;
  private lastFrame = 0;
  private lastActivity = new Map<string, string>();
  private lastFlags = new Set<string>();
  private pendingWhy = '';

  constructor(readonly host: DevHost) {}

  get floor(): Floor | undefined {
    return this.host.floor();
  }

  note(kind: LogLine['kind'], text: string) {
    this.log = [{ at: Date.now(), kind, text }, ...this.log].slice(0, 300);
  }

  attach() {
    const floor = this.floor;
    if (!floor) return;
    const h = this.host;
    this.overlay = new Overlay(floor);
    this.undo.push(() => this.overlay?.destroy());

    this.undo.push(h.tap((e) => this.heard(e)));
    // The path guard checks the ghosts' walks too, while they are on the floor.
    this.undo.push(guardAlso(() => this.ghosts.map((g) => g.a)));

    // The render hook: rows, rewind and tag boxes follow the floor's own draws.
    const onRender = floor.onRender;
    floor.onRender = () => {
      onRender?.();
      this.afterDraw();
    };
    this.undo.push(() => (floor.onRender = onRender));

    // The redraw meter: every draw, and why it happened.
    const app = floor.app;
    const render = app.render.bind(app);
    let last = [floor.stage.x, floor.stage.y, floor.stage.scale.x];
    app.render = () => {
      const now = [floor.stage.x, floor.stage.y, floor.stage.scale.x];
      const camera = now.some((v, i) => Math.abs(v - last[i]) > 0.01);
      last = now;
      this.draws.push({
        at: performance.now(),
        why: camera ? 'camera move' : this.pendingWhy || 'animation'
      });
      this.pendingWhy = '';
      if (this.draws.length > 4000) this.draws.splice(0, 2000);
      render();
    };
    this.undo.push(() => (app.render = render));
    const invalidate = floor.invalidate.bind(floor);
    floor.invalidate = () => {
      if (!this.pendingWhy) this.pendingWhy = `invalidate() from ${caller()}`;
      invalidate();
    };
    this.undo.push(() => (floor.invalidate = invalidate));

    // The time scrubber holds the floor at its hour, whatever the page asks for.
    const setHour = floor.setHour.bind(floor);
    floor.setHour = (hour: number) => setHour(this.hourOverride ?? hour);
    this.undo.push(() => {
      floor.setHour = setHour;
      setHour(h.hour());
    });

    // The network conditioner: /api/office answers late.
    const fetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (this.delayMs && url.includes('/api/office')) {
        this.note('dev', `Holding GET /api/office for ${this.delayMs} ms`);
        await new Promise((r) => setTimeout(r, this.delayMs));
      }
      return fetch(input, init);
    };
    this.undo.push(() => (window.fetch = fetch));

    // Page changes, as the DOM sees them.
    const seen = new MutationObserver((m) => {
      const now = performance.now();
      for (let i = 0; i < m.length; i++) this.domChanges.push(now);
      if (this.domChanges.length > 20_000) this.domChanges.splice(0, 10_000);
    });
    seen.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true
    });
    this.undo.push(() => seen.disconnect());

    // The ticker: the overlay, the ghosts and a running clock.
    const tick = (t: { deltaMS: number }) => this.onTick(t.deltaMS / 1000);
    floor.app.ticker.add(tick);
    this.undo.push(() => floor.app.ticker.remove(tick));

    this.undo.push(() => this.clearGhosts());
    this.undo.push(() => this.applyView('normal'));
    void this.fetchServer();
    this.afterDraw(true);
    floor.invalidate();
  }

  detach() {
    for (const u of this.undo.reverse()) u();
    this.undo = [];
  }

  async fetchServer() {
    const s = await fetch('/api/dev/state')
      .then((r) => (r.ok ? r.json() : undefined))
      .catch(() => undefined);
    if (!s) return;
    this.chatting = new Set(s.chatting);
    this.server = s.server;
    this.refreshRows();
  }

  private heard(e: OfficeEvent) {
    if (e.type === 'change') this.note('event', `change: ${e.table}`);
    else if (e.type === 'working') {
      const names = Object.entries(e.working).map(([id, w]) => `${this.name(id)} on "${w}"`);
      this.note('event', `working: ${names.join(', ') || 'nobody'}`);
      void this.fetchServer();
    } else if (e.type === 'hand-off')
      this.note('event', `hand-off ${e.kind}: ${this.name(e.from)} to ${this.name(e.to)}`);
    else if (e.type === 'lesson') this.note('event', `lesson ${e.kind} by ${this.name(e.staff)}`);
    else this.note('event', e.type);
    queueMicrotask(() => this.refreshRows());
  }

  name(id: string) {
    return this.host.staff().find((s) => s.id === id)?.name ?? id;
  }

  refreshRows() {
    const next = rows(this.host, this.chatting);
    for (const r of next) {
      const was = this.lastActivity.get(r.id);
      if (was && was !== r.page.activity)
        this.note('page', `${r.name}: ${was} → ${r.page.activity} (${r.page.reason})`);
      this.lastActivity.set(r.id, r.page.activity);
      for (const f of r.flags) {
        const key = `${r.id}:${f.text.replace(/\(\d+ s left\)/, '')}`;
        if (!this.lastFlags.has(key)) this.note('check', `${r.name}: ${f.text}`);
      }
    }
    this.lastFlags = new Set(
      next.flatMap((r) => r.flags.map((f) => `${r.id}:${f.text.replace(/\(\d+ s left\)/, '')}`))
    );
    this.rows = next;
  }

  private afterDraw(force = false) {
    const now = performance.now();
    if (force || now - this.lastRows > 300) {
      this.lastRows = now;
      this.refreshRows();
      this.markTags();
    }
    if (now - this.lastFrame > 250 && this.rewindAt === undefined) {
      this.lastFrame = now;
      const at = Date.now();
      this.frames.push({
        at,
        odds: this.host
          .actors()
          .filter((a) => a.visible)
          .map((a) => ({
            id: a.profile.id,
            name: a.profile.name,
            x: a.x,
            y: a.y,
            activity: a.activity,
            words: this.host.words(a)
          }))
      });
      while (this.frames.length && this.frames[0].at < at - REWIND_MS) this.frames.shift();
      this.framesCount = this.frames.length;
    }
  }

  /** The Tags layer: outline every tag, and mark the ones that overlap. */
  private markTags() {
    const on = !!this.layers.tags;
    const boxes = tagRects();
    for (const el of document.querySelectorAll<HTMLElement>('button.tag')) {
      const name = el.querySelector('span')?.textContent?.trim() ?? '';
      const me = boxes.get(name);
      const hit =
        on &&
        !!me &&
        [...boxes].some(
          ([n, b]) =>
            n !== name &&
            me.x < b.x + b.w &&
            b.x < me.x + me.w &&
            me.y < b.y + b.h &&
            b.y < me.y + me.h
        );
      el.style.outline = on ? `1.5px solid var(--color-${hit ? 'coral' : 'sea'})` : '';
    }
  }

  private onTick(dt: number) {
    const floor = this.floor;
    if (!floor) return;
    if (this.clockSpeed && this.hourOverride !== undefined) {
      this.hourOverride = (this.hourOverride + (dt * this.clockSpeed) / 3600) % 24;
      floor.setHour(this.hourOverride);
    }
    const now = performance.now();
    for (const g of this.ghosts) {
      g.a.update(Math.min(0.05, dt));
      if (now > g.leave && !g.a.moving) {
        g.leave = now + 4000 + Math.random() * 12_000;
        this.placeGhost(g.a);
      }
    }
    const on = new Set(
      Object.entries(this.layers)
        .filter(([, v]) => v)
        .map(([k]) => k as LayerId)
    );
    if (this.rewindAt !== undefined) on.add('rewind');
    this.overlay?.update(
      on,
      [...this.host.actors(), ...this.ghosts.map((g) => g.a)],
      this.reach,
      this.rewindGhosts()
    );
  }

  rewindGhosts(): Ghost[] | undefined {
    if (this.rewindAt === undefined) return undefined;
    const f = this.frameAt(this.rewindAt);
    return f?.odds.map((o) => ({ name: o.name, x: o.x, y: o.y, words: o.words }));
  }

  frameAt(at: number): Frame | undefined {
    let best: Frame | undefined;
    for (const f of this.frames) if (f.at <= at) best = f;
    return best ?? this.frames[0];
  }

  setHour(hour: number | undefined) {
    this.hourOverride = hour;
    this.floor?.setHour(hour ?? this.host.hour());
  }

  applyView(view: View) {
    this.view = view;
    const f = this.floor as unknown as Inside | undefined;
    if (!f) return;
    const all = [
      ...f.layers,
      f.sky,
      f.shafts,
      f.shadows,
      f.objects,
      f.lightScene,
      f.glow,
      f.moteLayer
    ];
    for (const c of all) c.visible = true;
    const only = (keep: { visible: boolean }[]) => {
      for (const c of all) c.visible = keep.includes(c);
    };
    if (view === 'light') only([f.lightScene, f.glow]);
    if (view === 'glow') only([f.glow]);
    if (view === 'emissive') only([f.lightScene]);
    for (const s of f.shaded) s.tint = view === 'untinted' ? 0xffffff : f.nightTint;
    this.floor?.invalidate();
  }

  // The crowd: page-only Odds that wander like free ones, never on the server.
  addGhosts(n: number) {
    const floor = this.floor;
    const F = this.host.floorModule();
    const staff = this.host.staff();
    if (!floor || !F || !staff.length) return;
    for (let i = 0; i < n; i++) {
      const like = staff[(this.ghostCount + i) % staff.length];
      const k = this.ghosts.length + 1;
      const a = new F.StaffActor(
        floor,
        { ...like, id: `ghost-${k}`, name: `Ghost ${k}` },
        this.host.start()
      );
      a.wear(this.host.wearing(like.id));
      a.sprite.alpha = 0.75;
      this.ghosts.push({ a, leave: performance.now() + Math.random() * 3000 });
      this.placeGhost(a);
    }
    this.ghostCount = this.ghosts.length;
    this.note('dev', `Added ${n} ghost Odds (${this.ghostCount} on the floor, page only)`);
  }

  private placeGhost(a: StaffActor) {
    const w = this.host.world();
    const taken = this.host.taken();
    for (const g of this.ghosts) if (g.a !== a && g.a.spotId) taken.add(g.a.spotId);
    const kinds: Activity[] = ['work', 'read', 'play', 'rest', 'eat', 'exercise', 'intake'];
    const want = kinds[Math.floor(Math.random() * kinds.length)];
    if (!a.assign(want, w.spots, taken)) {
      this.noSpot++;
      this.note('check', `${a.profile.name} found no free ${want} spot: the floor is full there`);
    }
  }

  clearGhosts() {
    for (const g of this.ghosts) g.a.destroy();
    if (this.ghosts.length) this.note('dev', `Removed ${this.ghosts.length} ghost Odds`);
    this.ghosts = [];
    this.ghostCount = 0;
    this.noSpot = 0;
    this.floor?.invalidate();
  }
}

/** The function that called invalidate(), read off the stack. */
function caller(): string {
  const line = new Error().stack?.split('\n')[3] ?? '';
  return /at (?:[\w$.]+\.)?([\w$<>]+) /.exec(line)?.[1] ?? 'somewhere';
}
