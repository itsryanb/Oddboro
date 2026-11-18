<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { DevState } from '../state.svelte.ts';
  import { clearBox, drawBox, probeAt, scanAtlas, type Probe, type Scan } from '../probe.ts';

  let { dev }: { dev: DevState } = $props();

  let waiting = $state(false);
  let probe = $state<Probe | undefined>();
  let missed = $state<string | undefined>();
  let scan = $state<Scan | undefined>();
  let scanning = $state(false);
  let problem = $state('');

  function start() {
    waiting = true;
    missed = undefined;
    dev.floorCatch(async (e) => {
      waiting = false;
      const w = dev.worldAt(e);
      if (!w || !dev.floor) return;
      probe = await probeAt(dev.floor, w.x, w.y);
      drawBox(dev.floor, probe);
      if (!probe)
        missed = `No sprite drew (${Math.floor(w.x)}, ${Math.floor(w.y)}): the background shows there.`;
      else
        dev.note(
          'dev',
          `Probed ${probe.key ?? 'a sprite'} at tile (${probe.tile.join(', ')}): ${probe.raw ?? 'no colour'}${probe.raw && !probe.palette ? ', not in the palette' : ''}`
        );
    });
  }

  async function runScan() {
    scanning = true;
    problem = '';
    try {
      scan = await scanAtlas();
      dev.note(
        'check',
        `Palette scan: ${scan.badFrames} of ${scan.frames} frames have colours outside the palette`
      );
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      scanning = false;
    }
  }

  onDestroy(() => {
    dev.floorCatch(undefined);
    clearBox(dev.floor);
  });

  const swatch = (c: string | undefined) => (c ? `background: ${c}` : '');
</script>

<div class="flex flex-col gap-4 text-xs">
  <section class="flex flex-col gap-2">
    <h3 class="text-[10px] tracking-wider text-faint uppercase">Pixel probe</h3>
    <p class="text-muted">
      Click any pixel on the floor to see the sprite and frame that drew it, the art's own colour
      and its palette name, the night tint over it, and the colour that reached the screen.
    </p>
    <div class="flex items-center gap-2">
      <button
        class="rounded-md bg-raise px-2 py-1 hover:bg-sea/20"
        onclick={start}
        disabled={waiting}>{waiting ? 'Click a pixel on the floor' : 'Probe a pixel'}</button
      >
      {#if waiting}<span class="text-ember">Waiting for a click on the floor</span>{/if}
    </div>
    {#if missed}<p class="text-muted">{missed}</p>{/if}
    {#if probe}
      <dl class="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 rounded-lg bg-raise p-2">
        <dt class="text-faint">Sprite and frame</dt>
        <dd class="font-mono">
          {probe.key ?? 'not an atlas frame (a drawn look or built at run time)'}
        </dd>
        <dt class="text-faint">Art file</dt>
        <dd class="font-mono">
          {probe.sprite ? `packages/sprites/**/${probe.sprite}.px` : 'none'}, row {probe.local[1]} of
          the frame, column {probe.local[0]}
        </dd>
        <dt class="text-faint">Where it draws</dt>
        <dd>{probe.layer}, zIndex {probe.zIndex}{probe.flipped ? ', flipped' : ''}</dd>
        <dt class="text-faint">Tile and pixel</dt>
        <dd>
          tile ({probe.tile.join(', ')}), world pixel ({probe.world.join(', ')}), frame {probe.size.join(
            ' × '
          )}
        </dd>
        <dt class="text-faint">Art colour</dt>
        <dd class="flex items-center gap-2">
          {#if probe.raw}
            <span
              class="inline-block size-3 rounded-sm border border-hairline"
              style={swatch(probe.raw)}
            ></span>
            <span class="font-mono">{probe.raw}</span>
            {#if probe.alpha === 0}<span class="text-muted"
                >(clear here: the pixel below shows)</span
              >
            {:else if probe.palette}
              <span class="text-moss">palette "{probe.palette.name}" ({probe.palette.code})</span>
            {:else}
              <span class="text-coral">not in the palette (hard rule 7)</span>
            {/if}
          {:else}
            <span class="text-muted">could not read the texture's pixels</span>
          {/if}
        </dd>
        <dt class="text-faint">Night tint</dt>
        <dd class="flex items-center gap-2">
          <span
            class="inline-block size-3 rounded-sm border border-hairline"
            style={swatch(probe.tint)}
          ></span>
          <span class="font-mono">{probe.tint}</span>
          <span class="text-muted"
            >{probe.tint === '#ffffff' ? 'none: daylight' : 'multiplied over the art'}</span
          >
        </dd>
        <dt class="text-faint">On screen</dt>
        <dd class="flex items-center gap-2">
          {#if probe.final}
            <span
              class="inline-block size-3 rounded-sm border border-hairline"
              style={swatch(probe.final)}
            ></span>
            <span class="font-mono">{probe.final}</span>
            <span class="text-muted">art × tint, before glow and bloom add to it</span>
          {/if}
        </dd>
      </dl>
      <p class="text-[11px] text-faint">
        The box on the floor marks the probed sprite. The source row is the frame's own row; the .px
        file's row is the same when the sprite has one frame.
      </p>
    {/if}
  </section>

  <section class="flex flex-col gap-2">
    <h3 class="text-[10px] tracking-wider text-faint uppercase">Palette check (hard rule 7)</h3>
    <p class="text-muted">
      Hard rule 7 says every colour on the floor comes from the palette, and no guard checks it
      today. This reads every opaque pixel of every frame in the atlas, glow frames included.
    </p>
    <div>
      <button
        class="rounded-md bg-raise px-2 py-1 hover:bg-sea/20"
        onclick={runScan}
        disabled={scanning}
        >{scanning ? 'Scanning the atlas' : 'Scan all art for off-palette pixels'}</button
      >
    </div>
    {#if problem}<p class="text-coral">{problem}</p>{/if}
    {#if scan}
      <p>
        Checked {scan.frames} frames, {scan.pixels.toLocaleString()} opaque pixels.
        {#if scan.badFrames}
          <span class="text-coral">{scan.badFrames} frames have colours outside the palette.</span>
        {:else}
          <span class="text-moss">Every pixel is a palette colour.</span>
        {/if}
      </p>
      {#if scan.bad.length}
        <table class="w-full text-start">
          <thead class="text-faint">
            <tr
              ><th class="text-start font-normal">Frame</th><th class="text-start font-normal"
                >Pixels</th
              ><th class="text-start font-normal">First colour</th></tr
            >
          </thead>
          <tbody>
            {#each scan.bad as b (b.key)}
              <tr class="border-t border-hairline">
                <td class="py-0.5 font-mono">{b.key}</td>
                <td>{b.count}</td>
                <td class="flex items-center gap-1.5 font-mono">
                  <span
                    class="inline-block size-3 rounded-sm border border-hairline"
                    style={swatch(b.first)}
                  ></span>{b.first}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if scan.badFrames > scan.bad.length}
          <p class="text-[11px] text-faint">Showing the {scan.bad.length} frames with the most.</p>
        {/if}
      {/if}
    {/if}
    <p class="text-[11px] text-faint">
      Prototype: it checks the compiled atlas, not drawn looks or art an Odd drew, and does not yet
      draw a floor layer marking each off-palette pixel.
    </p>
  </section>
</div>
