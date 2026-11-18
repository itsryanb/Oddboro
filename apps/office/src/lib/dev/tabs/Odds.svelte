<script lang="ts">
  import type { DevState } from '../state.svelte.ts';
  import { seconds } from '../snapshot.ts';

  let { dev }: { dev: DevState } = $props();
  const sorted = $derived(
    [...dev.rows].sort((a, b) => b.flags.length - a.flags.length || a.name.localeCompare(b.name))
  );
  const open = $derived(dev.rows.find((r) => r.id === dev.picked));
</script>

<p class="mb-2 text-xs text-muted">
  Why is this Odd here, saying that? Each row puts the server's state, the page's decision and the
  tag side by side, with the field each came from. A flag marks two sources that disagree.
</p>

<table class="w-full text-xs">
  <thead class="text-start text-[10px] tracking-wider text-faint uppercase">
    <tr>
      <th class="w-4"></th>
      <th class="py-1 text-start">Odd</th>
      <th class="text-start">Server</th>
      <th class="text-start">Page decided</th>
      <th class="text-start">Tag says</th>
    </tr>
  </thead>
  <tbody>
    {#each sorted as r (r.id)}
      <tr
        class="cursor-pointer border-t border-hairline align-top hover:bg-raise {dev.picked === r.id
          ? 'bg-raise'
          : ''}"
        onclick={() => {
          dev.picked = dev.picked === r.id ? undefined : r.id;
          dev.host.select(r.id);
        }}
      >
        <td class="pt-1.5">
          {#if r.flags.some((f) => f.level === 'warn')}<span class="text-coral">●</span>
          {:else if r.flags.length}<span class="text-ember">●</span>{/if}
        </td>
        <td class="py-1.5 pe-2 font-medium">{r.name}</td>
        <td class="pe-2">
          {#if r.server.run}<span class="text-moss">running</span> "{r.server.run}"
          {:else}<span class="text-faint">no run</span>{/if}
          {#if r.server.queued}<div class="text-faint">{r.server.queued} queued</div>{/if}
          {#if r.server.chatting}<div class="text-sea">chat reply in flight</div>{/if}
          {#if r.server.desk.length}<div class="text-ember">
              {r.server.desk.length} on the Desk
            </div>{/if}
        </td>
        <td class="pe-2">
          <span class="text-ink">{r.page.activity}</span>
          <span class="text-faint">· {r.page.mode}</span>
          <div class="text-muted">{r.page.reason}</div>
          {#if r.page.stayLeft !== undefined}<div class="text-faint">
              stays {seconds(r.page.stayLeft)} more
            </div>{/if}
          {#if r.page.moving}<div class="text-faint">
              walking, {r.page.pathLen} tiles to go
            </div>{/if}
          {#if r.visit}<div class="text-ember">visit: {r.visit}</div>{/if}
        </td>
        <td>
          "{r.tag.words}"
          <div class="text-faint">{r.tag.rule}</div>
        </td>
      </tr>
      {#each r.flags as f (f.text)}
        <tr>
          <td></td>
          <td colspan="4" class="pb-1 {f.level === 'warn' ? 'text-coral' : 'text-ember'}"
            >⚑ {f.text}</td
          >
        </tr>
      {/each}
    {/each}
  </tbody>
</table>

{#if open}
  <div class="mt-3 rounded-lg border border-hairline p-2">
    <div class="mb-1 text-[10px] tracking-wider text-faint uppercase">
      {open.name}: every surface, and what each reads
    </div>
    <table class="w-full text-xs">
      <tbody>
        {#each open.surfaces as s (s.surface)}
          <tr class="border-t border-hairline">
            <td class="py-1 pe-2 text-muted">{s.surface}</td>
            <td class="pe-2">"{s.says}"</td>
            <td class="text-faint">{s.reads}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
      <span class="text-faint">Tile</span><span>{open.snap.tile.join(', ')}</span>
      <span class="text-faint">Spot held</span>
      <span>{open.page.spot ?? 'none'}{open.page.room ? ` in ${open.page.room}` : ''}</span>
      <span class="text-faint">Run started</span>
      <span>{open.server.since ? new Date(open.server.since).toLocaleTimeString() : 'no run'}</span>
      <span class="text-faint">Held by</span><span>{open.snap.heldBy ?? 'nobody'}</span>
      <span class="text-faint">Visits queued</span><span
        >{open.snap.visits.join(', ') || 'none'}</span
      >
      <span class="text-faint">Desk items from it</span><span
        >{open.server.desk.join('; ') || 'none'}</span
      >
    </div>
  </div>
{/if}
