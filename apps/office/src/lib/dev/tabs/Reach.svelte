<script lang="ts">
  import { onMount } from 'svelte';
  import type { DevState } from '../state.svelte.ts';
  import { reachFrom, type ReachReport } from '../reach.ts';

  let { dev }: { dev: DevState } = $props();
  let report = $state<ReachReport>();
  let took = $state(0);

  function check() {
    const t = performance.now();
    report = reachFrom(dev.host.world(), dev.host.start());
    took = performance.now() - t;
    dev.reach = report;
    dev.layers = { ...dev.layers, reach: true };
    const bad = report.spots.length + report.rooms.length + report.doors.length;
    dev.note(
      bad ? 'check' : 'dev',
      `Reachability: ${bad ? `${bad} problems` : 'every spot, room and door reached'}`
    );
  }
  onMount(check);

  const roomName = (id: string) => dev.host.roomName(id) ?? id;
</script>

<p class="mb-2 text-xs text-muted">
  A walk from the front door over every walkable tile. Whatever it never reaches, no Odd can either.
  It runs on every new or swapped office: an AI draws offices from a description.
</p>
<div class="mb-2 flex items-center gap-2">
  <button class="rounded-md bg-raise px-2 py-1 text-xs hover:bg-sea/20" onclick={check}
    >Check again</button
  >
  <label class="flex items-center gap-1 text-xs text-muted">
    <input
      type="checkbox"
      class="accent-[var(--color-ember)]"
      checked={!!dev.layers.reach}
      onchange={(e) => (dev.layers = { ...dev.layers, reach: e.currentTarget.checked })}
    />
    Heatmap on the floor
  </label>
</div>

{#if report}
  <p class="text-xs">
    Reached <span class="text-moss">{report.reachedTiles}</span> of {report.tiles} walkable tiles in
    {took.toFixed(1)} ms.
  </p>
  <div class="mt-2 text-[10px] tracking-wider text-faint uppercase">
    Spots no Odd can use ({report.spots.length})
  </div>
  <ul class="text-xs">
    {#each report.spots as s (s.id)}
      <li class="border-t border-hairline py-0.5">
        <span class="text-coral">{s.activity}</span> in {roomName(s.room)}: {s.why}
        <span class="text-faint">({s.tile.join(', ')})</span>
      </li>
    {:else}
      <li class="text-moss">Every spot can be reached.</li>
    {/each}
  </ul>
  <div class="mt-2 text-[10px] tracking-wider text-faint uppercase">Rooms with no way in</div>
  <p class="text-xs {report.rooms.length ? 'text-coral' : 'text-moss'}">
    {report.rooms.join(', ') || 'None.'}
  </p>
  <div class="mt-2 text-[10px] tracking-wider text-faint uppercase">Doors no path crosses</div>
  <p class="text-xs {report.doors.length ? 'text-ember' : 'text-moss'}">
    {report.doors.length ? report.doors.map((d) => `(${d.join(', ')})`).join(' ') : 'None.'}
  </p>
  <p class="mt-2 text-[11px] text-faint">
    The doorway bug (6dc0f4b) belongs to this family: a layout fault that showed up as strange
    walking.
  </p>
{/if}
