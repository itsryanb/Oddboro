<script lang="ts">
  import type { DevState, LogLine } from '../state.svelte.ts';

  let { dev }: { dev: DevState } = $props();
  const KINDS: { id: LogLine['kind'] | 'all'; label: string; colour: string }[] = [
    { id: 'all', label: 'All', colour: 'text-ink' },
    { id: 'event', label: 'Server events', colour: 'text-sea' },
    { id: 'page', label: 'Page decisions', colour: 'text-ink' },
    { id: 'check', label: 'Checks', colour: 'text-coral' },
    { id: 'dev', label: 'Dev tools', colour: 'text-ember' }
  ];
  let kind = $state<(typeof KINDS)[number]['id']>('all');
  const shown = $derived(dev.log.filter((l) => kind === 'all' || l.kind === kind));
  const colour = (k: LogLine['kind']) => KINDS.find((x) => x.id === k)?.colour ?? 'text-ink';
</script>

<p class="mb-2 text-xs text-muted">
  Every live event from the server and every decision the page makes, newest first, the last 300.
</p>
<div class="mb-2 flex flex-wrap gap-1">
  {#each KINDS as k (k.id)}
    <button
      class="rounded-md px-2 py-0.5 text-xs {kind === k.id
        ? 'bg-ember/25'
        : 'bg-raise hover:bg-sea/20'}"
      onclick={() => (kind = k.id)}>{k.label}</button
    >
  {/each}
  <span class="flex-1"></span>
  <button
    class="rounded-md bg-raise px-2 py-0.5 text-xs hover:bg-sea/20"
    onclick={() => (dev.log = [])}>Clear</button
  >
</div>
<ol class="font-mono text-[11px] leading-relaxed">
  {#each shown as l, i (i)}
    <li class="flex gap-2 border-t border-hairline py-0.5">
      <span class="shrink-0 text-faint">{new Date(l.at).toLocaleTimeString()}</span>
      <span class="w-12 shrink-0 text-faint">{l.kind}</span>
      <span class={colour(l.kind)}>{l.text}</span>
    </li>
  {:else}
    <li class="text-faint">Nothing yet. Events arrive as the office changes.</li>
  {/each}
</ol>
