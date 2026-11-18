<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { DevState } from '../state.svelte.ts';

  let { dev }: { dev: DevState } = $props();
  // A meter has to look again each second; it does only while this tab is open.
  let now = $state(performance.now());
  const timer = setInterval(() => (now = performance.now()), 1000);
  onDestroy(() => clearInterval(timer));

  const recent = $derived(dev.draws.filter((d) => d.at > now - 10_000));
  const perSecond = $derived(
    Array.from({ length: 30 }, (_, i) => {
      const end = now - (29 - i) * 1000;
      return dev.draws.filter((d) => d.at > end - 1000 && d.at <= end).length;
    })
  );
  const peak = $derived(Math.max(4, ...perSecond));
  const reasons = $derived(
    [
      ...recent.reduce((m, d) => m.set(d.why, (m.get(d.why) ?? 0) + 1), new Map<string, number>())
    ].sort((a, b) => b[1] - a[1])
  );
  const dom = $derived(dev.domChanges.filter((t) => t > now - 10_000).length);
  const moving = $derived(dev.host.actors().some((a) => a.moving));
  const lastFive = $derived(perSecond.slice(-5).reduce((a, b) => a + b, 0) / 5);
  const runaway = $derived(
    lastFive > 12 && !moving && !reasons.some(([why]) => why === 'camera move')
  );
  const ticker = $derived(dev.floor?.app.ticker);
</script>

<p class="mb-2 text-xs text-muted">
  Hard rule 13: nothing redraws while the screen is still. Every floor draw is counted here with
  what asked for it.
</p>

{#if runaway}
  <div class="mb-2 rounded-md bg-coral/20 p-2 text-xs text-coral">
    The floor draws {lastFive.toFixed(0)} times a second while nobody walks and the camera is still. Something
    asks for a draw every frame: see the callers below.
  </div>
{:else if lastFive === 0}
  <div class="mb-2 rounded-md bg-moss/15 p-2 text-xs text-moss">
    Still: no draws in the last 5 seconds.
  </div>
{/if}

<div class="grid grid-cols-4 gap-2 text-center">
  {#each [[recent.length, 'draws, last 10 s'], [`${(recent.length / 10).toFixed(1)}/s`, 'draw rate'], [ticker ? Math.round(ticker.FPS) : 0, 'ticker FPS'], [dom, 'page DOM changes, 10 s']] as [v, label] (label)}
    <div class="rounded-md bg-raise p-2">
      <div class="font-mono text-lg text-ink">{v}</div>
      <div class="text-[10px] text-faint">{label}</div>
    </div>
  {/each}
</div>

<div class="mt-3 text-[10px] tracking-wider text-faint uppercase">Draws a second, last 30 s</div>
<div class="mt-1 flex h-16 items-end gap-0.5">
  {#each perSecond as n, i (i)}
    <div
      class="flex-1 rounded-t-sm {n > 12 ? 'bg-coral' : n ? 'bg-sea' : 'bg-raise'}"
      style="block-size: {Math.max(2, (n / peak) * 100)}%"
      title="{n} draws"
    ></div>
  {/each}
</div>

<div class="mt-3 text-[10px] tracking-wider text-faint uppercase">
  What asked for each draw, last 10 s
</div>
<table class="w-full text-xs">
  <tbody>
    {#each reasons as [why, n] (why)}
      <tr class="border-t border-hairline">
        <td class="py-0.5 font-mono">{why}</td>
        <td class="text-end">{n}</td>
      </tr>
    {:else}
      <tr><td class="text-faint">No draws.</td></tr>
    {/each}
  </tbody>
</table>
<p class="mt-2 text-[11px] text-faint">
  Also catches the effect_update_depth_exceeded loop the office's CLAUDE.md records for the rail,
  and a laptop's battery draining. Svelte effect counts are not wired in this prototype; the DOM
  change count stands in for them.
</p>
