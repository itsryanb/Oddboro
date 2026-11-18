<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { DevState, View } from '../state.svelte.ts';

  let { dev }: { dev: DevState } = $props();
  const hour = $derived(dev.hourOverride ?? dev.host.hour());
  const clock = (h: number) =>
    `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
  const MARKS: [number, string][] = [
    [8.5, 'warm light ends'],
    [13, 'midday'],
    [16, 'warm light starts'],
    [18.5, 'dusk'],
    [21, 'lamps (NEW-1681)'],
    [0, 'midnight']
  ];
  const VIEWS: [View, string, string][] = [
    ['normal', 'As owners see it', 'Everything, with the night tint'],
    ['untinted', 'No tint', 'Every sprite at full colour, lights still on'],
    ['light', 'Light only', 'Only the lamps and their glow'],
    ['glow', 'Glow only', 'Only the bloom around each lamp'],
    ['emissive', 'Emissive only', 'Only pixels that give off their own light']
  ];

  let rendered = $state<string>();
  let live = $state<string>();
  let comparing = $state(false);
  let problem = $state('');

  async function compare() {
    const floor = dev.floor;
    if (!floor) return;
    comparing = true;
    problem = '';
    const h = Math.round(hour) % 24;
    dev.setHour(h);
    floor.invalidate();
    try {
      live = await floor.app.renderer.extract.base64(floor.app.stage);
      const res = await fetch(`/api/dev/render?hour=${h}`);
      if (!res.ok) throw new Error(await res.text());
      if (rendered) URL.revokeObjectURL(rendered);
      rendered = URL.createObjectURL(await res.blob());
      dev.note('dev', `Compared the live floor with npm run render at ${clock(h)}`);
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      comparing = false;
    }
  }

  onDestroy(() => {
    if (rendered) URL.revokeObjectURL(rendered);
  });
</script>

<p class="mb-2 text-xs text-muted">
  Hold the floor at any hour, or run the clock fast. Owners can only pick 13:00 or 22:00, so the
  hours in between go unchecked: the warm-light cutoffs and the dusk tints.
</p>

<div class="flex items-center gap-2">
  <span class="w-12 font-mono text-lg text-ember">{clock(hour)}</span>
  <input
    class="flex-1 accent-[var(--color-ember)]"
    type="range"
    min="0"
    max="24"
    step="0.25"
    value={hour}
    oninput={(e) => dev.setHour(Number(e.currentTarget.value) % 24)}
  />
</div>
<div class="mt-1 flex flex-wrap gap-1">
  {#each MARKS as [h, label] (h)}
    <button
      class="rounded-md bg-raise px-2 py-0.5 text-[11px] hover:bg-sea/20"
      onclick={() => dev.setHour(h)}>{clock(h)} <span class="text-faint">{label}</span></button
    >
  {/each}
</div>
<div class="mt-2 flex flex-wrap items-center gap-1 text-xs">
  <span class="text-faint">Clock</span>
  <button
    class="rounded-md px-2 py-0.5 {dev.hourOverride === undefined
      ? 'bg-moss/25'
      : 'bg-raise hover:bg-sea/20'}"
    onclick={() => {
      dev.clockSpeed = 0;
      dev.setHour(undefined);
    }}>Real time</button
  >
  {#each [[0, 'Frozen'], [600, '600x'], [3600, '1 h a second'], [14_400, '4 h a second']] as [s, label] (s)}
    <button
      class="rounded-md px-2 py-0.5 {dev.hourOverride !== undefined && dev.clockSpeed === s
        ? 'bg-ember/25'
        : 'bg-raise hover:bg-sea/20'}"
      onclick={() => {
        dev.clockSpeed = Number(s);
        if (dev.hourOverride === undefined) dev.setHour(hour);
      }}>{label}</button
    >
  {/each}
</div>

<div class="mt-3 text-[10px] tracking-wider text-faint uppercase">View</div>
<div class="grid grid-cols-2 gap-1">
  {#each VIEWS as [id, label, says] (id)}
    <button
      class="rounded-md p-1.5 text-start {dev.view === id
        ? 'bg-ember/25'
        : 'bg-raise hover:bg-sea/20'}"
      onclick={() => dev.applyView(id)}
    >
      <span class="text-xs font-medium">{label}</span>
      <span class="block text-[11px] text-muted">{says}</span>
    </button>
  {/each}
</div>

<div class="mt-3 flex items-center gap-2">
  <div class="text-[10px] tracking-wider text-faint uppercase">Beside npm run render</div>
  <button
    class="rounded-md bg-raise px-2 py-0.5 text-xs hover:bg-sea/20 disabled:opacity-40"
    disabled={comparing}
    onclick={compare}
    >{comparing ? 'Rendering' : `Compare at ${clock(Math.round(hour) % 24)}`}</button
  >
</div>
{#if problem}<p class="text-xs text-coral">{problem}</p>{/if}
{#if live && rendered}
  <div class="mt-2 grid grid-cols-2 gap-2">
    <figure>
      <img src={live} alt="The live floor" class="w-full rounded-md [image-rendering:pixelated]" />
      <figcaption class="text-[11px] text-muted">The live floor (the camera's view)</figcaption>
    </figure>
    <figure>
      <img
        src={rendered}
        alt="npm run render"
        class="w-full rounded-md [image-rendering:pixelated]"
      />
      <figcaption class="text-[11px] text-muted">
        npm run render: the whole of Main Street
      </figcaption>
    </figure>
  </div>
  <p class="mt-1 text-[11px] text-faint">
    At 21:00 the outdoor lamps glow at 70% on the floor and 100% in the renderer: NEW-1681, in one
    look.
  </p>
{/if}
