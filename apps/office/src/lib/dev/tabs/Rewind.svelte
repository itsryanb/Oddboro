<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { DevState } from '../state.svelte.ts';

  let { dev }: { dev: DevState } = $props();
  const first = $derived(dev.framesCount ? dev.frames[0].at : 0);
  const last = $derived(dev.framesCount ? dev.frames[dev.framesCount - 1].at : 0);
  const frame = $derived(dev.rewindAt !== undefined ? dev.frameAt(dev.rewindAt) : undefined);
  const ago = (at: number) => `${Math.round((Date.now() - at) / 1000)} s ago`;

  function save() {
    const blob = new Blob(
      [JSON.stringify({ saved: new Date().toISOString(), frames: dev.frames }, null, 1)],
      {
        type: 'application/json'
      }
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `oddboro-rewind-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    dev.note('dev', `Saved a recording of ${dev.frames.length} frames`);
  }

  onDestroy(() => (dev.rewindAt = undefined));
</script>

<p class="mb-2 text-xs text-muted">
  The floor is recorded while this window is open: where every Odd stood, what it was doing and what
  its tag said, four times a second, for the last 10 minutes. Scrub back to see a moment again on
  the floor. Made for "Theo looked stuck a minute ago".
</p>

{#if dev.framesCount < 2}
  <p class="text-faint">Recording. Come back in a few seconds.</p>
{:else}
  <div class="flex items-center gap-2">
    <input
      class="flex-1 accent-[var(--color-ember)]"
      type="range"
      min={first}
      max={last}
      step="250"
      value={dev.rewindAt ?? last}
      oninput={(e) => (dev.rewindAt = Number(e.currentTarget.value))}
    />
    <button
      class="rounded-md px-2 py-1 text-xs {dev.rewindAt === undefined
        ? 'bg-moss/25'
        : 'bg-raise hover:bg-sea/20'}"
      onclick={() => (dev.rewindAt = undefined)}>Live</button
    >
    <button class="rounded-md bg-raise px-2 py-1 text-xs hover:bg-sea/20" onclick={save}
      >Save recording</button
    >
  </div>
  <p class="mt-1 text-[11px] text-faint">
    {dev.framesCount} frames, from {ago(first)}.
    {#if dev.rewindAt !== undefined}Showing {ago(dev.rewindAt)}: the floor draws each Odd's place
      then as a ring, over where it is now.{:else}Live.{/if}
  </p>

  {#if frame}
    <table class="mt-2 w-full text-xs">
      <thead class="text-[10px] tracking-wider text-faint uppercase">
        <tr
          ><th class="text-start">Odd</th><th class="text-start">Doing</th><th class="text-start"
            >Tag said</th
          ><th class="text-start">Tile</th></tr
        >
      </thead>
      <tbody>
        {#each frame.odds as o (o.id)}
          <tr class="border-t border-hairline">
            <td class="py-1">{o.name}</td>
            <td>{o.activity}</td>
            <td>"{o.words}"</td>
            <td class="text-faint">{Math.floor(o.x / 16)}, {Math.floor(o.y / 16) - 1}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
{/if}
