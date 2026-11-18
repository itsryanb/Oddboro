<script lang="ts">
  import { TILE, type RoomBounds } from '@oddboro/world';
  import type { DevState } from '../state.svelte.ts';

  let { dev }: { dev: DevState } = $props();

  type Rect = { x: number; y: number; w: number; h: number };
  type AtlasJson = { frames: Record<string, { frame: Rect }> };

  const world = $derived(dev.host.world());
  const places = $derived([
    ...world.rooms.map((r) => ({ ...r, kind: r.outdoor ? 'outdoors' : 'room' })),
    ...world.halls.map((r) => ({ ...r, kind: 'hall' }))
  ]);
  const propKinds = $derived.by(() => {
    const count = new Map<string, number>();
    for (const d of world.draws)
      if (d.pass === 2) count.set(d.sprite, (count.get(d.sprite) ?? 0) + 1);
    return [...count].sort((a, b) => a[0].localeCompare(b[0]));
  });

  function go(r: RoomBounds) {
    dev.floor?.focus((r.x + r.w / 2) * TILE, (r.y + r.h / 2) * TILE);
    dev.note('dev', `Camera to ${r.name || r.id}`);
  }

  let sprite = $state<string | undefined>();
  const meta = $derived(sprite ? dev.floor?.atlas.catalog[sprite] : undefined);

  // The atlas the page already loads, read once more as plain pixels to draw frames on small canvases.
  let atlas: { json: AtlasJson; img: HTMLImageElement } | undefined;
  let atlasProblem = $state('');
  async function loadAtlas() {
    if (atlas) return atlas;
    const json = (await fetch('/atlas/atlas.json').then((r) => r.json())) as AtlasJson;
    const img = new Image();
    img.src = '/atlas/atlas.png';
    await img.decode();
    atlas = { json, img };
    return atlas;
  }

  type Frame = { name: string; rect: Rect };
  let frames = $state<{ main: Frame[]; emissive: Frame[]; off: Frame[] }>({
    main: [],
    emissive: [],
    off: []
  });
  let step = $state(0);

  async function pick(name: string) {
    sprite = name;
    step = 0;
    playing = false;
    try {
      const a = await loadAtlas();
      const all = Object.entries(a.json.frames)
        .filter(([k]) => k.startsWith(`${name}/`))
        .map(([k, v]) => ({ name: k.slice(name.length + 1), rect: v.frame }));
      frames = {
        main: all.filter((f) => !f.name.endsWith('~e') && !f.name.endsWith('~off')),
        emissive: all.filter((f) => f.name.endsWith('~e')),
        off: all.filter((f) => f.name.endsWith('~off'))
      };
      atlasProblem = '';
    } catch (e) {
      atlasProblem = `Could not read the atlas: ${e instanceof Error ? e.message : e}`;
    }
  }

  function paint(canvas: HTMLCanvasElement, f: { rect: Rect; scale: number }) {
    const draw = ({ rect, scale }: { rect: Rect; scale: number }) => {
      if (!atlas) return;
      canvas.width = rect.w * scale;
      canvas.height = rect.h * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(atlas.img, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
    };
    draw(f);
    return { update: draw };
  }

  let playing = $state(false);
  $effect(() => {
    if (!playing || !frames.main.length) return;
    const fps = meta?.fps || 4;
    const t = setInterval(() => (step = (step + 1) % frames.main.length), 1000 / fps);
    return () => clearInterval(t);
  });

  // The floor lost its highlight on main (a7ceef4c), so this brings the camera to the prop instead.
  function highlight() {
    const d = world.draws.find((x) => x.sprite === sprite);
    if (!d || !dev.floor) {
      dev.note('dev', `No ${sprite} is placed on this floor`);
      return;
    }
    dev.floor.focus(d.x + TILE, d.y + TILE);
    dev.note('dev', `Moved the camera to ${d.obj ?? sprite}`);
  }
</script>

<div class="flex flex-col gap-4 text-xs">
  <p class="text-faint">
    Every room and prop on this floor, checked in place. The door-frame fixes in 6dc0f4b are the
    kind of bug this catches, and a new .px can be looked at here instead of through npm run render.
  </p>

  <section class="flex flex-col gap-2">
    <h3 class="text-[10px] tracking-wider text-faint uppercase">
      Rooms and halls ({places.length})
    </h3>
    <ul class="grid grid-cols-2 gap-1">
      {#each places as r (r.id)}
        <li class="flex items-center gap-2 rounded-md bg-raise px-2 py-1">
          <span class="min-w-0 flex-1 truncate">{r.name || r.id}</span>
          <span class="text-faint">{r.kind} · {r.w}×{r.h}</span>
          <button class="rounded-md px-1.5 text-sea hover:bg-sea/20" onclick={() => go(r)}
            >Go</button
          >
        </li>
      {/each}
    </ul>
  </section>

  <section class="flex flex-col gap-2">
    <h3 class="text-[10px] tracking-wider text-faint uppercase">
      Props ({propKinds.length} kinds)
    </h3>
    <div class="flex flex-wrap gap-1">
      {#each propKinds as [name, n] (name)}
        <button
          class="rounded-md px-2 py-0.5 text-xs {sprite === name
            ? 'bg-ember/25 text-ink'
            : 'bg-raise text-muted hover:text-ink'}"
          onclick={() => pick(name)}>{name} <span class="text-faint">{n}</span></button
        >
      {/each}
    </div>
  </section>

  {#if sprite}
    <section class="flex flex-col gap-2 rounded-lg border border-hairline p-2">
      <div class="flex items-center gap-2">
        <span class="font-medium text-ink">{sprite}</span>
        <span class="flex-1"></span>
        <button class="rounded-md bg-raise px-2 py-1 text-xs hover:bg-sea/20" onclick={highlight}
          >Show on the floor</button
        >
      </div>
      {#if atlasProblem}<p class="text-coral">{atlasProblem}</p>{/if}
      {#if meta}
        <dl class="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-0.5">
          <dt class="text-faint">Footprint</dt>
          <dd>{meta.footprint[0]} × {meta.footprint[1]} tiles · {meta.width} × {meta.height} px</dd>
          <dt class="text-faint">Walkable</dt>
          <dd class={meta.walkable ? 'text-moss' : 'text-muted'}>{meta.walkable ? 'yes' : 'no'}</dd>
          <dt class="text-faint">Layer</dt>
          <dd>{meta.layer} · zbias {meta.zbias}</dd>
          <dt class="text-faint">Animation</dt>
          <dd>{meta.fps ? `${meta.fps} fps` : 'still'}{meta.emissive ? ' · emissive' : ''}</dd>
          <dt class="text-faint">Spots</dt>
          <dd>
            {#if meta.spots.length}
              {meta.spots.map((s) => `${s.name}: ${s.activity}, faces ${s.facing}`).join(' · ')}
            {:else}none{/if}
          </dd>
          <dt class="text-faint">Lights</dt>
          <dd>
            {#if meta.lights.length}
              {meta.lights.map((l) => `r ${l.radius}, ${l.color}, ${l.intensity}`).join(' · ')}
            {:else}none{/if}
          </dd>
          <dt class="text-faint">Variants</dt>
          <dd>{meta.variants.length ? meta.variants.join(', ') : 'none'}</dd>
        </dl>
      {:else}
        <p class="text-faint">No catalog entry for this sprite.</p>
      {/if}

      {#if frames.main.length}
        <div class="flex items-center gap-3">
          {#key frames.main}
            <canvas
              class="rounded bg-night"
              use:paint={{ rect: frames.main[step % frames.main.length].rect, scale: 4 }}
            ></canvas>
          {/key}
          <div class="flex flex-col gap-1">
            <span class="text-muted"
              >Frame {step + 1} of {frames.main.length}: {frames.main[step % frames.main.length]
                .name}</span
            >
            <div class="flex gap-1">
              <button
                class="rounded-md bg-raise px-2 py-1 text-xs hover:bg-sea/20"
                onclick={() => (step = (step + 1) % frames.main.length)}>Step</button
              >
              <button
                class="rounded-md bg-raise px-2 py-1 text-xs hover:bg-sea/20"
                onclick={() => (playing = !playing)}>{playing ? 'Stop' : 'Play'}</button
              >
            </div>
          </div>
        </div>
        {#each [['Frames', frames.main], ['Emissive', frames.emissive], ['Off', frames.off]] as const as [label, list] (label)}
          {#if list.length}
            <div class="flex flex-col gap-1">
              <span class="text-[10px] tracking-wider text-faint uppercase"
                >{label} ({list.length})</span
              >
              <div class="flex flex-wrap gap-1.5">
                {#each list as f (f.name)}
                  <canvas
                    class="rounded bg-night"
                    title={f.name}
                    use:paint={{ rect: f.rect, scale: 3 }}
                  ></canvas>
                {/each}
              </div>
            </div>
          {/if}
        {/each}
      {/if}
    </section>
  {/if}
</div>
