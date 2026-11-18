<script lang="ts">
  import type { DevState } from '../state.svelte.ts';
  import { onDestroy } from 'svelte';
  import { LAYERS } from '../overlay.ts';
  import { breakMarks } from '../path-guard.ts';

  let { dev }: { dev: DevState } = $props();
  // The path guard's marks are its own, drawn with or without this window open.
  let breaks = $state(breakMarks.count());
  let breaksOn = $state(breakMarks.visible());
  onDestroy(
    breakMarks.listen(() => {
      breaks = breakMarks.count();
      breaksOn = breakMarks.visible();
    })
  );
  const pathFlags = $derived(
    dev.rows.filter((r) => r.flags.some((f) => f.text.startsWith('Path crosses')))
  );
  const tagFlags = $derived(
    dev.rows.filter((r) => r.flags.some((f) => f.text.startsWith('Tag overlaps')))
  );
</script>

<p class="mb-2 text-xs text-muted">
  Drawn over the floor in world pixels, so they follow the camera. They redraw only when what they
  show changes. Keys 1 to 6 toggle them while this window is open.
</p>
<ul class="flex flex-col gap-1">
  {#each LAYERS as l (l.id)}
    <li>
      <label class="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-raise">
        <input
          type="checkbox"
          class="mt-0.5 accent-[var(--color-ember)]"
          checked={!!dev.layers[l.id]}
          onchange={(e) => (dev.layers = { ...dev.layers, [l.id]: e.currentTarget.checked })}
        />
        <span class="w-4 font-mono text-faint">{l.key}</span>
        <span>
          <span class="font-medium">{l.name}</span>
          <span class="block text-xs text-muted">{l.says}</span>
        </span>
      </label>
    </li>
  {/each}
  <li>
    <div class="flex items-start gap-2 rounded-md p-1.5 hover:bg-raise">
      <label class="flex flex-1 cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          class="mt-0.5 accent-[var(--color-ember)]"
          checked={breaksOn}
          disabled={!breaks}
          onchange={(e) => breakMarks.setVisible(e.currentTarget.checked)}
        />
        <span class="w-4 font-mono text-faint"></span>
        <span>
          <span class="font-medium">Path breaks</span>
          <span class="ms-1 {breaks ? 'text-coral' : 'text-faint'}">{breaks}</span>
          <span class="block text-xs text-muted">
            Each walk the path guard caught through a wall, frozen as it was planned so a screenshot
            still shows it; it comes back on with each new one
          </span>
        </span>
      </label>
      <button
        class="rounded-md bg-raise px-2 py-0.5 text-xs hover:bg-coral/20 disabled:opacity-40"
        disabled={!breaks}
        onclick={() => breakMarks.clear()}>Clear</button
      >
    </div>
  </li>
</ul>
<div class="mt-3 text-[10px] tracking-wider text-faint uppercase">Found now</div>
<ul class="text-xs">
  <li class={pathFlags.length ? 'text-coral' : 'text-moss'}>
    {pathFlags.length
      ? `${pathFlags.map((r) => r.name).join(', ')}: a path crosses a tile it should not`
      : 'Every path stays on walkable tiles'}
  </li>
  <li class={tagFlags.length ? 'text-coral' : 'text-moss'}>
    {tagFlags.length
      ? `Tags overlap: ${tagFlags.map((r) => r.name).join(', ')} (NEW-1690)`
      : 'No tags overlap'}
  </li>
</ul>
<p class="mt-2 text-[11px] text-faint">
  The doorway bug (6dc0f4b) showed as a path drawn over a wall cap: layer 4 marks such a tile in
  coral.
</p>
