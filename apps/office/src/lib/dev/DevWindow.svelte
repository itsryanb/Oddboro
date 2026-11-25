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

  let {
    host,
    onclose,
    ondock
  }: {
    host: DevHost;
    onclose: () => void;
    /** The width the panel takes at the page's end edge, so the office can make room for it. */
    ondock?: (px: number) => void;
  } = $props();
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

  // Docked to the right, full height. Its start edge drags to resize, and it
  // folds to a strip that still shows the warnings. Both are kept per browser.
  const MIN_WIDTH = 320;
  const stored = (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const store = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private window: the panel opens at its defaults next time */
    }
  };
  let width = $state(Math.max(MIN_WIDTH, Number(stored('oddboro.dev.width')) || 420));
  let folded = $state(stored('oddboro.dev.folded') === '1');
  $effect(() => store('oddboro.dev.folded', folded ? '1' : '0'));
  const STRIP = 36;
  let innerWidth = $state(1280);
  $effect(() => ondock?.(folded ? STRIP : Math.min(width, innerWidth - 32)));
  onDestroy(() => ondock?.(0));

  /** Folds the panel to its strip, or opens it again (backquote, from the page). */
  export function fold() {
    folded = !folded;
  }

  function resize(e: PointerEvent) {
    const [sx, sw] = [e.clientX, width];
    // The panel sits at the inline end, so in a right-to-left page its edge moves the other way.
    const dir = getComputedStyle(document.documentElement).direction === 'rtl' ? -1 : 1;
    const move = (m: PointerEvent) => {
      const max = Math.max(MIN_WIDTH, window.innerWidth - 160);
      width = Math.round(Math.min(max, Math.max(MIN_WIDTH, sw + (sx - m.clientX) * dir)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      store('oddboro.dev.width', String(width));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // A tab that asks for a click on the floor (the probe, puppet moves) gets
  // this sheet over the floor until the click lands.
  let catcher: ((e: MouseEvent) => void) | undefined = $state();
  dev.floorCatch = (fn) => (catcher = fn);
</script>

<svelte:window onkeydown={onkey} bind:innerWidth />

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

{#if folded}
  <button
    class="dev-strip fixed z-[70] flex flex-col items-center gap-2 border-s border-ember/40 bg-panel-solid py-3 text-ink shadow-2xl hover:bg-raise"
    onclick={fold}
    title="Open the Dev tools (`)"
    aria-label="Open the Dev tools, {warnings} warnings"
  >
    <span class="font-pixel text-xs tracking-[0.2em] text-ember uppercase">Dev</span>
    {#if warnings}
      <span class="rounded-full bg-coral/25 px-1.5 text-[11px] text-coral">{warnings}</span>
    {/if}
  </button>
{/if}

<section
  class="dev fixed z-[70] flex flex-col overflow-hidden border-s border-ember/40 bg-panel-solid text-sm text-ink shadow-2xl"
  class:hidden={folded}
  style="inline-size: min({width}px, calc(100vw - 2rem))"
  aria-label="Dev tools"
>
  <div
    class="resize-edge absolute z-10 cursor-ew-resize hover:bg-ember/30"
    role="separator"
    aria-orientation="vertical"
    aria-label="Drag to resize the Dev tools"
    onpointerdown={resize}
  ></div>
  <header class="flex items-center gap-2 border-b border-hairline px-3 py-2">
    <span class="font-pixel text-xs tracking-[0.2em] text-ember uppercase">Dev</span>
    <span class="min-w-0 truncate text-xs text-muted">
      {dev.rows.length} Odds · {#if warnings}<span class="text-coral">{warnings} warnings</span
        >{:else}no warnings{/if}
      {#if dev.server}· server {dev.server.rssMb} MB, up {Math.round(dev.server.upSeconds / 60)} min{/if}
    </span>
    <span class="flex-1"></span>
    <button
      class="rounded-md px-2 text-muted hover:bg-raise hover:text-ink"
      onclick={fold}
      title="Fold to the edge (`)"
      aria-label="Fold">»</button
    >
    <button
      class="rounded-md px-2 text-muted hover:bg-raise hover:text-ink"
      onclick={onclose}
      title="Close the Dev tools"
      aria-label="Close">✕</button
    >
  </header>
  <p class="border-b border-hairline px-3 py-1 text-[10px] text-faint">
    ` folds · 1 to 6 layers · drag the left edge to resize
  </p>
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
  .dev,
  .dev-strip {
    inset-block: 0;
    inset-inline-end: 0;
  }
  .dev-strip {
    inline-size: 36px;
  }
  .resize-edge {
    inset-block: 0;
    inset-inline-start: -3px;
    inline-size: 6px;
  }
  /* A select's list takes its colour from the select with the alpha dropped,
     so bg-raise (white at 6%) lists in solid white under the light ink. */
  .dev :global(select option) {
    background-color: var(--color-panel-solid);
    color: var(--color-ink);
  }
</style>
