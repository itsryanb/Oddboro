<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { DevState } from '../state.svelte.ts';
  import { breakMarks, type Caught } from '../path-guard.ts';
  import { describeBreak } from '../path-prompt.ts';

  let { dev }: { dev: DevState } = $props();
  // Frame cost has to be read again each second; only while this tab is open.
  let now = $state(performance.now());
  const timer = setInterval(() => (now = performance.now()), 1000);
  onDestroy(() => clearInterval(timer));

  // Each tile a walk broke through, real Odds and ghosts, newest first.
  let caught = $state<Caught[]>([...breakMarks.caught()].reverse());
  onDestroy(breakMarks.listen(() => (caught = [...breakMarks.caught()].reverse())));
  let copied = $state<Caught>();
  async function copy(c: Caught) {
    if (!c.prompt) return;
    await navigator.clipboard.writeText(c.prompt).catch(() => {});
    copied = c;
    setTimeout(() => (copied = copied === c ? undefined : copied), 1500);
  }
  const fileName = (f: string) => f.split(/[\\/]/).at(-1);

  const spots = $derived(dev.host.world().spots.length);
  const held = $derived.by(() => {
    void now;
    return new Set(
      [...dev.host.actors(), ...dev.ghosts.map((g) => g.a)].map((a) => a.spotId).filter(Boolean)
    ).size;
  });
  const ticker = $derived.by(() => {
    void now;
    const t = dev.floor?.app.ticker;
    return t ? { fps: Math.round(t.FPS), ms: t.deltaMS.toFixed(1) } : { fps: 0, ms: '0' };
  });
  const overlaps = $derived(
    dev.rows.filter((r) => r.flags.some((f) => f.text.startsWith('Tag overlaps'))).length
  );
</script>

<p class="mb-2 text-xs text-muted">
  Ghost Odds live in this page only: they wander, take spots and walk the halls like free Odds, and
  the server never hears of them. Use them to load the floor.
</p>
<div class="flex flex-wrap gap-1">
  {#each [10, 20, 40] as n (n)}
    <button
      class="rounded-md bg-raise px-3 py-1 text-xs hover:bg-sea/20"
      onclick={() => dev.addGhosts(n)}>Add {n}</button
    >
  {/each}
  <button
    class="rounded-md bg-raise px-3 py-1 text-xs hover:bg-coral/20 disabled:opacity-40"
    disabled={!dev.ghostCount}
    onclick={() => dev.clearGhosts()}>Remove all</button
  >
</div>

<div class="mt-3 grid grid-cols-4 gap-2 text-center">
  {#each [[dev.ghostCount, 'ghosts'], [`${held}/${spots}`, 'spots held'], [dev.noSpot, 'found no free spot'], [`${ticker.fps} fps`, `${ticker.ms} ms a frame`]] as [v, label] (label)}
    <div class="rounded-md bg-raise p-2">
      <div
        class="font-mono text-lg {label === 'found no free spot' && dev.noSpot
          ? 'text-coral'
          : 'text-ink'}"
      >
        {v}
      </div>
      <div class="text-[10px] text-faint">{label}</div>
    </div>
  {/each}
</div>

<ul class="mt-3 text-xs">
  <li class={dev.noSpot ? 'text-coral' : 'text-muted'}>
    {dev.noSpot
      ? `${dev.noSpot} times an Odd wanted a spot and the floor had none: the moment NEW-1830 ("suggest an expansion when the floor runs out of seats") needs to catch.`
      : 'Every Odd found a spot so far.'}
  </li>
  <li class={overlaps ? 'text-coral' : 'text-muted'}>
    {overlaps
      ? `${overlaps} real Odds' tags overlap another's (NEW-1690 at scale).`
      : 'No real tags overlap.'}
  </li>
</ul>
<div class="mt-3 flex items-center gap-2">
  <span class="text-[10px] tracking-wider text-faint uppercase">Places walks went through</span>
  <span class="text-xs {caught.length ? 'text-coral' : 'text-moss'}">{caught.length}</span>
  <span class="flex-1"></span>
  <button
    class="rounded-md bg-raise px-2 py-0.5 text-xs hover:bg-coral/20 disabled:opacity-40"
    disabled={!caught.length}
    onclick={() => breakMarks.clear()}>Clear</button
  >
</div>
{#if caught.length}
  <ul class="mt-1 flex max-h-48 flex-col gap-1 overflow-auto text-xs">
    {#each caught.slice(0, 10) as c (c)}
      <li class="flex items-start gap-2 rounded-md bg-raise p-1.5">
        <span class="flex-1">
          <span class={c.ghost ? 'text-muted' : 'text-coral'}>{describeBreak(c.found)}</span>
          {#if c.walks > 1}<span class="text-faint"> · {c.walks} walks crossed here</span>{/if}
          <span class="block text-[11px] text-faint">
            {c.shot
              ? `Screenshot: ${fileName(c.shot)}`
              : c.prompt
                ? 'No screenshot'
                : 'Taking its screenshot'}{c.n ? ` · break ${c.n} in path-breaks.jsonl` : ''}
          </span>
        </span>
        <button
          class="rounded-md bg-coral/20 px-2 py-0.5 text-ink hover:bg-coral/35 disabled:opacity-40"
          title="Copy a prompt for Claude Code to fix it, with the screenshot's path"
          disabled={!c.prompt}
          onclick={() => copy(c)}>{copied === c ? 'Copied' : 'Prompt'}</button
        >
      </li>
    {/each}
    {#if caught.length > 10}
      <li class="text-faint">
        and {caught.length - 10} older places, every walk kept in path-breaks.jsonl
      </li>
    {/if}
  </ul>
{:else}
  <p class="mt-1 text-xs text-muted">
    None yet. Every walk, ghost or real, is checked against the walls. Each place one goes through
    gets a screenshot and a Prompt here, once, with a count of the walks that crossed it.
  </p>
{/if}

<p class="mt-2 text-[11px] text-faint">
  Turn on layers 3 (spots) and 4 (paths) to see contention and jams. Ghosts have no name tags in
  this prototype.
</p>
