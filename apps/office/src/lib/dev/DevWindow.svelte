<script lang="ts">
  // The Dev window: the office's developer tools, one tab each, grouped by
  // the kind of bug they find. It opens with ` (backquote) or the Dev button,
  // only behind the three locks in src/lib/server/dev.ts. Its hooks into the
  // floor come and go with it (state.svelte.ts).
  import { onDestroy, onMount, type Component } from 'svelte';
  import type { DevHost } from './host.ts';
  import { DevState } from './state.svelte.ts';
  import { LAYERS } from './overlay.ts';
  import Odds from './tabs/Odds.svelte';
  import Log from './tabs/Log.svelte';
  import Rewind from './tabs/Rewind.svelte';
  import Layers from './tabs/Layers.svelte';
  import Reach from './tabs/Reach.svelte';
  import Gallery from './tabs/Gallery.svelte';
  import Light from './tabs/Light.svelte';
  import Probe from './tabs/Probe.svelte';
  import Perf from './tabs/Perf.svelte';
  import Puppet from './tabs/Puppet.svelte';
  import Crowd from './tabs/Crowd.svelte';
  import Network from './tabs/Network.svelte';
  import Access from './tabs/Access.svelte';
  import Scenarios from './tabs/Scenarios.svelte';
  import Capture from './tabs/Capture.svelte';

  let { host, onclose }: { host: DevHost; onclose: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const dev = new DevState(host);

  const GROUPS: { name: string; tabs: [string, string, Component<{ dev: DevState }>][] }[] = [
    {
      name: 'Inspect',
      tabs: [
        ['odds', 'Odds', Odds],
        ['log', 'Log', Log],
        ['rewind', 'Rewind', Rewind]
      ]
    },
    {
      name: 'Floor',
      tabs: [
        ['layers', 'Layers', Layers],
        ['reach', 'Reach', Reach],
        ['gallery', 'Gallery', Gallery]
      ]
    },
    {
      name: 'Light and art',
      tabs: [
        ['light', 'Time of day', Light],
        ['probe', 'Pixel probe', Probe]
      ]
    },
    { name: 'Cost', tabs: [['perf', 'Redraws', Perf]] },
    {
      name: 'Drive',
      tabs: [
        ['puppet', 'Puppet', Puppet],
        ['crowd', 'Crowd', Crowd],
        ['network', 'Network', Network]
      ]
    },
    { name: 'Page', tabs: [['access', 'Layout and access', Access]] },
    {
      name: 'Tests',
      tabs: [
        ['scenarios', 'Scenarios', Scenarios],
        ['capture', 'Bug capture', Capture]
      ]
    }
  ];
  const Current = $derived(
    GROUPS.flatMap((g) => g.tabs).find((t) => t[0] === dev.tab)?.[2] ?? Odds
  );
  const warnings = $derived(
    dev.rows.reduce((n, r) => n + r.flags.filter((f) => f.level === 'warn').length, 0)
  );

  onMount(() => dev.attach());
  onDestroy(() => dev.detach());

  // Number keys 1 to 6 toggle the floor layers while the window is open.
  function onkey(e: KeyboardEvent) {
    if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]'))
      return;
    const layer = LAYERS.find((l) => l.key === e.key);
    if (layer) dev.layers = { ...dev.layers, [layer.id]: !dev.layers[layer.id] };
  }

  // The window moves by its header.
  let dx = $state(0);
  let dy = $state(0);
  function drag(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    const [sx, sy, ox, oy] = [e.clientX, e.clientY, dx, dy];
    const move = (m: PointerEvent) => {
      dx = ox + m.clientX - sx;
      dy = oy + m.clientY - sy;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // A tab that asks for a click on the floor (the probe, puppet moves) gets
  // this sheet over the floor until the click lands.
  let catcher: ((e: MouseEvent) => void) | undefined = $state();
  dev.floorCatch = (fn) => (catcher = fn);
</script>

<svelte:window onkeydown={onkey} />

{#if catcher}
  <button
    class="fixed inset-0 z-[60] cursor-crosshair bg-transparent"
    aria-label="Pick a point on the floor"
    onclick={(e) => {
      const fn = catcher;
      catcher = undefined;
      fn?.(e);
    }}
  ></button>
{/if}

<section
  class="dev fixed bottom-4 start-4 z-[70] flex flex-col overflow-hidden rounded-xl border border-ember/40 bg-panel-solid text-sm text-ink shadow-2xl"
  style="translate: {dx}px {dy}px"
  aria-label="Dev tools"
>
  <header
    class="flex cursor-move items-center gap-2 border-b border-hairline px-3 py-2"
    role="toolbar"
    aria-label="Drag to move the Dev window"
    tabindex="-1"
    onpointerdown={drag}
  >
    <span class="font-pixel text-xs tracking-[0.2em] text-ember uppercase">Dev</span>
    <span class="text-xs text-muted">
      {dev.rows.length} Odds · {#if warnings}<span class="text-coral">{warnings} warnings</span
        >{:else}no warnings{/if}
      {#if dev.server}· server {dev.server.rssMb} MB, up {Math.round(dev.server.upSeconds / 60)} min{/if}
    </span>
    <span class="flex-1"></span>
    <span class="text-[10px] text-faint">` to close · 1 to 6 layers</span>
    <button
      class="rounded-md px-2 text-muted hover:bg-raise hover:text-ink"
      onclick={onclose}
      aria-label="Close">✕</button
    >
  </header>
  <nav class="flex flex-wrap gap-x-3 gap-y-1 border-b border-hairline px-3 py-2">
    {#each GROUPS as g (g.name)}
      <div class="flex items-center gap-1">
        <span class="text-[10px] tracking-wider text-faint uppercase">{g.name}</span>
        {#each g.tabs as [id, label] (id)}
          <button
            class="rounded-md px-2 py-0.5 text-xs {dev.tab === id
              ? 'bg-ember/25 text-ink'
              : 'text-muted hover:bg-raise hover:text-ink'}"
            onclick={() => (dev.tab = id)}>{label}</button
          >
        {/each}
      </div>
    {/each}
  </nav>
  <div class="min-h-0 flex-1 overflow-y-auto p-3">
    <Current {dev} />
  </div>
</section>

<style>
  .dev {
    inline-size: min(720px, calc(100vw - 2rem));
    block-size: min(560px, calc(100vh - 2rem));
    resize: both;
  }
  /* A select's list takes its colour from the select with the alpha dropped,
     so bg-raise (white at 6%) lists in solid white under the light ink. */
  .dev :global(select option) {
    background-color: var(--color-panel-solid);
    color: var(--color-ink);
  }
</style>
