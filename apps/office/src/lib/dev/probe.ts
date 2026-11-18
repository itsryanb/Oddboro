// The pixel probe: which sprite drew a pixel on the floor, the art's own
// colour there, its palette name, the night tint over it and the colour that
// reached the screen. Also a scan of every frame in the atlas for colours
// outside the palette: hard rule 7 has no guard yet, and this is one to look at.
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Floor } from '../floor/engine.ts';
import base from '../../../../../packages/sprites/src/palette.json';
import looks from '../../../../../packages/sprites/looks/palette.json';
import { token } from './overlay.ts';

type Palette = { name: string; colors: Record<string, { hex: string; name: string }> };
// The palette is the base file plus every extension in src/palettes/ (the
// compiler's loadPalette), and drawn looks have one of their own.
const extensions = Object.values(
  import.meta.glob<Palette>('../../../../../packages/sprites/src/palettes/*.json', {
    eager: true,
    import: 'default'
  })
);
const PALETTES: Palette[] = [base, ...extensions, looks];

type Rect = { x: number; y: number; w: number; h: number };
type Atlas = { frames: Record<string, { frame: Rect }>; meta: { size: { w: number; h: number } } };

export type Probe = {
  world: [number, number];
  tile: [number, number];
  key?: string;
  sprite?: string;
  layer: string;
  zIndex: number;
  flipped: boolean;
  tint: string;
  local: [number, number];
  size: [number, number];
  raw?: string;
  alpha: number;
  palette?: { code: string; name: string };
  final?: string;
};

export type Scan = {
  frames: number;
  pixels: number;
  /** Frames with any off-palette pixel; `bad` lists the 50 with the most. */
  badFrames: number;
  bad: { key: string; count: number; first: string }[];
};

// By colour only: a few entries carry an alpha (a shadow is ink at 30%).
// Reversed so the base palette's name wins where two palettes share a colour.
const byHex = new Map<string, { code: string; name: string }>(
  PALETTES.flatMap((p) =>
    Object.entries(p.colors).map(([code, c]): [string, { code: string; name: string }] => [
      c.hex.toLowerCase().slice(0, 7),
      { code, name: p === base ? c.name : `${c.name} (${p.name})` }
    ])
  ).reverse()
);

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

let atlas: Promise<Atlas> | undefined;
const loadAtlas = () =>
  (atlas ??= fetch('/atlas/atlas.json').then((r) => r.json() as Promise<Atlas>));

/** Pixels of each texture source, read once into a 2D canvas. */
const sources = new Map<unknown, Promise<ImageData | undefined>>();
function pixelsOf(resource: unknown): Promise<ImageData | undefined> {
  let p = sources.get(resource);
  if (!p) {
    p = (async () => {
      const img = resource as CanvasImageSource & { width: number; height: number };
      if (!img || !img.width) return undefined;
      const c = new OffscreenCanvas(img.width, img.height);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return undefined;
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, img.width, img.height);
    })().catch(() => undefined);
    sources.set(resource, p);
  }
  return p;
}

function atlasImage(): Promise<ImageData | undefined> {
  const img = new Image();
  img.src = '/atlas/atlas.png';
  return img.decode().then(() => pixelsOf(img));
}

/** Every sprite in the floor's tree, in the order the floor draws them. The dev overlays are left out. */
function drawOrder(c: Container, out: Sprite[]) {
  if (!c.visible || c.alpha <= 0) return;
  const kids = c.sortableChildren
    ? [...c.children].sort((a, b) => a.zIndex - b.zIndex)
    : c.children;
  for (const k of kids) {
    if (k.zIndex >= 1e7) continue;
    if (k instanceof Sprite && k.visible && k.alpha > 0) out.push(k);
    if (k instanceof Container) drawOrder(k, out);
  }
}

function layerOf(floor: Floor, s: Sprite): string {
  const f = floor as unknown as {
    objects: Container;
    shadows: Container;
    lightScene: Container;
    glow: Container;
    layers: Container[];
  };
  for (let p: Container | null = s.parent; p; p = p.parent) {
    if (p === f.objects) return 'objects (sorted by feet, zIndex)';
    if (p === f.lightScene) return 'lights (emissive pixels)';
    if (p === f.glow) return 'glow and bloom';
    if (p === f.shadows) return 'shadows';
    const i = f.layers.indexOf(p);
    if (i >= 0) return `layer ${i} (${['floor', 'walls', 'objects', 'overlay'][i] ?? 'pass'})`;
  }
  return 'stage';
}

/** Which atlas frame a texture is, by its rectangle. */
async function frameKey(t: Texture): Promise<string | undefined> {
  const a = await loadAtlas();
  const f = t.frame;
  for (const [key, v] of Object.entries(a.frames))
    if (v.frame.x === f.x && v.frame.y === f.y && v.frame.w === f.width && v.frame.h === f.height)
      return key;
  return undefined;
}

export async function probeAt(floor: Floor, x: number, y: number): Promise<Probe | undefined> {
  const global = floor.stage.toGlobal({ x, y });
  const all: Sprite[] = [];
  drawOrder(floor.stage, all);
  let hit: { s: Sprite; lx: number; ly: number } | undefined;
  for (const s of all) {
    const w = s.texture.frame.width;
    const h = s.texture.frame.height;
    const p = s.toLocal(global);
    const lx = p.x + s.anchor.x * w;
    const ly = p.y + s.anchor.y * h;
    if (lx >= 0 && ly >= 0 && lx < w && ly < h) hit = { s, lx, ly };
  }
  const base = {
    world: [Math.floor(x), Math.floor(y)] as [number, number],
    tile: [Math.floor(x / 16), Math.floor(y / 16)] as [number, number]
  };
  if (!hit) return undefined;
  const { s, lx, ly } = hit;
  const t = s.texture;
  const key = await frameKey(t);
  const data = await pixelsOf(t.source.resource);
  const px = Math.floor(t.frame.x + lx);
  const py = Math.floor(t.frame.y + ly);
  let raw: string | undefined;
  let alpha = 0;
  let final: string | undefined;
  if (data && px < data.width && py < data.height) {
    const i = (py * data.width + px) * 4;
    const [r, g, b, a] = [data.data[i], data.data[i + 1], data.data[i + 2], data.data[i + 3]];
    alpha = a;
    raw = hex(r, g, b);
    const tint = s.tint;
    final = hex(
      Math.round((r * ((tint >> 16) & 255)) / 255),
      Math.round((g * ((tint >> 8) & 255)) / 255),
      Math.round((b * (tint & 255)) / 255)
    );
  }
  return {
    ...base,
    key,
    sprite: key?.split('/')[0],
    layer: layerOf(floor, s),
    zIndex: s.zIndex,
    flipped: s.scale.x < 0,
    tint: hex((s.tint >> 16) & 255, (s.tint >> 8) & 255, s.tint & 255),
    local: [Math.floor(lx), Math.floor(ly)],
    size: [t.frame.width, t.frame.height],
    raw,
    alpha,
    palette: raw ? byHex.get(raw) : undefined,
    final
  };
}

let box: Graphics | undefined;

/** A rectangle round the probed sprite's bounds, until the next probe. */
export function drawBox(floor: Floor, p: Probe | undefined, s?: Sprite) {
  clearBox(floor);
  if (!p) return;
  const target = s ?? spriteAt(floor, p);
  if (!target) return;
  const w = target.texture.frame.width;
  const h = target.texture.frame.height;
  const corners = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h]
  ].map(([cx, cy]) =>
    floor.stage.toLocal(
      target.toGlobal({ x: cx - target.anchor.x * w, y: cy - target.anchor.y * h })
    )
  );
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  box = new Graphics()
    .rect(
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys)
    )
    .stroke({ width: 1, color: token('ember') })
    .circle(p.world[0] + 0.5, p.world[1] + 0.5, 1.5)
    .fill({ color: token('coral') });
  box.zIndex = 1e7 + 1;
  floor.stage.addChild(box);
  floor.invalidate();
}

function spriteAt(floor: Floor, p: Probe): Sprite | undefined {
  const global = floor.stage.toGlobal({ x: p.world[0] + 0.5, y: p.world[1] + 0.5 });
  const all: Sprite[] = [];
  drawOrder(floor.stage, all);
  let hit: Sprite | undefined;
  for (const s of all) {
    const w = s.texture.frame.width;
    const h = s.texture.frame.height;
    const q = s.toLocal(global);
    const lx = q.x + s.anchor.x * w;
    const ly = q.y + s.anchor.y * h;
    if (lx >= 0 && ly >= 0 && lx < w && ly < h) hit = s;
  }
  return hit;
}

export function clearBox(floor: Floor | undefined) {
  if (!box) return;
  box.destroy();
  box = undefined;
  floor?.invalidate();
}

const paletteRgb = [...byHex.keys()].map((h) =>
  [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16))
);

/**
 * A see-through pixel (glass, a shadow) comes back from the canvas a few
 * values off its palette colour: the browser keeps it premultiplied by its
 * alpha, and undoing that rounds. The fainter the pixel, the further off.
 */
function nearPalette(r: number, g: number, b: number, alpha: number): boolean {
  const slack = Math.ceil(255 / alpha) + 1;
  return paletteRgb.some(
    ([pr, pg, pb]) =>
      Math.abs(pr - r) <= slack && Math.abs(pg - g) <= slack && Math.abs(pb - b) <= slack
  );
}

/** Every opaque pixel of every atlas frame, checked against the palette. */
export async function scanAtlas(): Promise<Scan> {
  const [a, data] = await Promise.all([loadAtlas(), atlasImage()]);
  if (!data) throw new Error('Could not read /atlas/atlas.png');
  let pixels = 0;
  const bad: Scan['bad'] = [];
  for (const [key, v] of Object.entries(a.frames)) {
    const f = v.frame;
    let count = 0;
    let first = '';
    for (let y = f.y; y < f.y + f.h; y++)
      for (let x = f.x; x < f.x + f.w; x++) {
        const i = (y * data.width + x) * 4;
        const alpha = data.data[i + 3];
        if (alpha === 0) continue;
        pixels++;
        const c = hex(data.data[i], data.data[i + 1], data.data[i + 2]);
        if (byHex.has(c)) continue;
        if (alpha < 255 && nearPalette(data.data[i], data.data[i + 1], data.data[i + 2], alpha))
          continue;
        if (!count) first = c;
        count++;
      }
    if (count) bad.push({ key, count, first });
  }
  bad.sort((x, y) => y.count - x.count);
  return {
    frames: Object.keys(a.frames).length,
    pixels,
    badFrames: bad.length,
    bad: bad.slice(0, 50)
  };
}
