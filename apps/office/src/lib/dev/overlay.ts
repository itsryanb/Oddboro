// The Dev window's drawn layers: one PixiJS container added to the floor's
// stage after its last layer, so it draws in world pixels and follows the
// camera for free. It redraws only when its signature (what it shows) changes,
// and asks the floor for one draw then: never a draw a frame.
import { Container, Graphics, Text } from 'pixi.js';
import { TILE, type World } from '@oddboro/world';
import type { Floor } from '../floor/engine.ts';
import type { StaffActor } from '../floor/staff.ts';

export const LAYERS = [
  {
    id: 'tiles',
    key: '1',
    name: 'Tiles',
    says: 'Walkable tiles, walls by kind, a walkable wall in warning colour'
  },
  { id: 'rooms', key: '2', name: 'Rooms', says: "Each room's and hall's bounds, with its name" },
  {
    id: 'spots',
    key: '3',
    name: 'Spots',
    says: 'Every spot and its approach tile; held spots show the holder'
  },
  {
    id: 'paths',
    key: '4',
    name: 'Paths',
    says: "Each moving Odd's path to its spot; a bad tile in warning colour"
  },
  { id: 'visits', key: '5', name: 'Visits', says: 'Visitor to colleague, the phase and re-aims' },
  {
    id: 'tags',
    key: '6',
    name: 'Tags',
    says: "Each name tag's box; overlapping tags in warning colour"
  }
] as const;
export type LayerId = (typeof LAYERS)[number]['id'] | 'reach' | 'rewind';

/** A colour token from app.css, as a number PixiJS takes (hard rule 7). */
export function token(name: string): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();
  return Number.parseInt(v.replace('#', '').slice(0, 6), 16) || 0xffffff;
}

export type Reach = { reached: Uint8Array; badSpots: { tile: [number, number]; why: string }[] };
export type Ghost = { name: string; x: number; y: number; words: string };

export class Overlay {
  private root = new Container();
  private g = new Graphics();
  private labels = new Container();
  private sig = '';
  private c = {
    ember: token('ember'),
    coral: token('coral'),
    sea: token('sea'),
    moss: token('moss'),
    ink: token('ink'),
    muted: token('muted')
  };

  constructor(private floor: Floor) {
    this.root.addChild(this.g, this.labels);
    this.root.zIndex = 1e7;
    floor.stage.addChild(this.root);
  }

  /** Draws the layers that are on, only when what they show has changed. */
  update(on: Set<LayerId>, actors: StaffActor[], reach?: Reach, rewind?: Ghost[]) {
    const w = this.floor.world;
    const moving = on.has('paths') || on.has('visits') || on.has('spots');
    const sig = JSON.stringify([
      [...on],
      w.width,
      moving ? actors.map((a) => [Math.round(a.x), Math.round(a.y), a.spotId]) : 0,
      reach ? reach.badSpots.length : 0,
      rewind ? rewind.map((g) => [Math.round(g.x), Math.round(g.y)]) : 0
    ]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.g.clear();
    for (const l of this.labels.removeChildren()) l.destroy();
    if (on.has('reach') && reach) this.reach(w, reach);
    if (on.has('tiles')) this.tiles(w);
    if (on.has('rooms')) this.rooms(w);
    if (on.has('spots')) this.spots(w, actors);
    if (on.has('paths')) this.paths(w, actors);
    if (on.has('visits')) this.visits(actors);
    if (on.has('rewind') && rewind) this.rewind(rewind);
    this.floor.invalidate();
  }

  private label(text: string, x: number, y: number, fill = this.c.ink, size = 5) {
    const t = new Text({
      text,
      style: { fontFamily: 'monospace', fontSize: size, fill },
      resolution: 6
    });
    t.position.set(x, y);
    this.labels.addChild(t);
  }

  private tiles(w: World) {
    for (let y = 0; y < w.height; y++)
      for (let x = 0; x < w.width; x++) {
        const i = y * w.width + x;
        const cell = w.cells[i];
        const px = x * TILE;
        const py = y * TILE;
        // A doorway is a wall cell walked through on purpose; any other walkable wall is the bug.
        if (cell.kind === 'wall' && w.walkable[i] && cell.feature !== 'door')
          this.g.rect(px, py, TILE, TILE).fill({ color: this.c.coral, alpha: 0.55 });
        else if (cell.kind === 'wall')
          this.g.rect(px + 0.5, py + 0.5, TILE - 1, TILE - 1).stroke({
            width: 0.6,
            color:
              cell.feature === 'door'
                ? this.c.moss
                : cell.feature === 'window'
                  ? this.c.sea
                  : this.c.muted,
            alpha: 0.7
          });
        else if (w.walkable[i])
          this.g.rect(px + 6, py + 6, 4, 4).fill({ color: this.c.sea, alpha: 0.35 });
      }
  }

  private rooms(w: World) {
    for (const r of [...w.rooms, ...w.halls]) {
      this.g
        .rect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE)
        .stroke({ width: 1, color: r.outdoor ? this.c.moss : this.c.ember, alpha: 0.9 });
      this.label(r.name || r.id, r.x * TILE + 2, r.y * TILE + 2, this.c.ember, 6);
    }
  }

  private spots(w: World, actors: StaffActor[]) {
    const holder = new Map(actors.filter((a) => a.spotId).map((a) => [a.spotId!, a.profile.name]));
    for (const s of w.spots) {
      const cx = s.tile[0] * TILE + TILE / 2;
      const cy = s.tile[1] * TILE + TILE / 2;
      const held = holder.get(s.id);
      this.g.circle(cx, cy, 3).fill({ color: held ? this.c.ember : this.c.sea, alpha: 0.85 });
      if (s.approach)
        this.g
          .moveTo(cx, cy)
          .lineTo(s.approach[0] * TILE + TILE / 2, s.approach[1] * TILE + TILE / 2)
          .stroke({ width: 0.6, color: this.c.sea, alpha: 0.6 });
      if (held) this.label(held[0], cx - 1.5, cy - 3, this.c.ink, 5);
    }
  }

  private paths(w: World, actors: StaffActor[]) {
    for (const a of actors) {
      const { path } = a.snapshot();
      if (path.length) this.path(w, [a.x, a.y - TILE / 2], path);
    }
  }

  /** One path from a point in world pixels: a dot on each tile, a bad tile in warning colour. */
  private path(
    w: World,
    [px, py]: [number, number],
    path: [number, number][],
    at?: [number, number]
  ) {
    for (const [x, y] of path) {
      const nx = x * TILE + TILE / 2;
      const ny = y * TILE + TILE / 2;
      const cell = w.cells[y * w.width + x];
      const bad = !w.walkable[y * w.width + x] || (cell.kind === 'wall' && cell.feature !== 'door');
      this.g
        .moveTo(px, py)
        .lineTo(nx, ny)
        .stroke({ width: 1, color: bad ? this.c.coral : this.c.moss, alpha: 0.9 });
      this.g.circle(nx, ny, bad ? 2.5 : 1.2).fill({ color: bad ? this.c.coral : this.c.moss });
      [px, py] = [nx, ny];
    }
    if (at)
      this.g
        .rect(at[0] * TILE - 1, at[1] * TILE - 1, TILE + 2, TILE + 2)
        .stroke({ width: 1.5, color: this.c.coral });
  }

  /**
   * The path guard's evidence (path-guard.ts): the Rooms layer, and each
   * broken path frozen as it was planned, in the Paths layer's style, with a
   * box round the tile where it breaks. It stays until `update` draws again.
   */
  showBreaks(breaks: { path: [number, number][]; at: [number, number] }[]) {
    const w = this.floor.world;
    this.sig = 'breaks';
    this.g.clear();
    for (const l of this.labels.removeChildren()) l.destroy();
    if (breaks.length) this.rooms(w);
    for (const b of breaks) {
      const [x, y] = b.path[0];
      this.path(w, [x * TILE + TILE / 2, y * TILE + TILE / 2], b.path.slice(1), b.at);
    }
    this.floor.invalidate();
  }

  private visits(actors: StaffActor[]) {
    for (const a of actors) {
      const { trip } = a.snapshot();
      if (!trip) continue;
      const to = actors.find((o) => o.profile.id === trip.to);
      if (!to) continue;
      this.g
        .moveTo(a.x, a.y - TILE / 2)
        .lineTo(to.x, to.y - TILE / 2)
        .stroke({ width: 1.2, color: this.c.ember, alpha: 0.9 });
      this.label(
        `${trip.phase} · re-aim ${trip.reaims}/${trip.maxReaims}`,
        (a.x + to.x) / 2,
        (a.y + to.y) / 2 - TILE,
        this.c.ember
      );
    }
  }

  private reach(w: World, r: Reach) {
    for (let i = 0; i < w.walkable.length; i++) {
      if (!w.walkable[i]) continue;
      const x = (i % w.width) * TILE;
      const y = Math.floor(i / w.width) * TILE;
      this.g.rect(x, y, TILE, TILE).fill({
        color: r.reached[i] ? this.c.moss : this.c.coral,
        alpha: r.reached[i] ? 0.12 : 0.5
      });
    }
    for (const b of r.badSpots) {
      const cx = b.tile[0] * TILE + TILE / 2;
      const cy = b.tile[1] * TILE + TILE / 2;
      this.g
        .moveTo(cx - 5, cy - 5)
        .lineTo(cx + 5, cy + 5)
        .moveTo(cx + 5, cy - 5)
        .lineTo(cx - 5, cy + 5);
      this.g.stroke({ width: 2, color: this.c.coral });
    }
  }

  private rewind(ghosts: Ghost[]) {
    for (const p of ghosts) {
      this.g.circle(p.x, p.y - TILE / 2, 5).stroke({ width: 1.5, color: this.c.ember });
      this.label(`${p.name}: ${p.words}`, p.x + 6, p.y - TILE, this.c.ember, 5);
    }
  }

  /** Shows or hides everything it drew, keeping it to show again. */
  setVisible(on: boolean) {
    this.root.visible = on;
    this.floor.invalidate();
  }

  destroy() {
    this.root.destroy({ children: true });
    this.floor.invalidate();
  }
}
