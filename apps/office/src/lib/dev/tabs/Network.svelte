<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { DevState } from '../state.svelte.ts';
  import type { Work } from '../../staff/work.ts';

  let { dev }: { dev: DevState } = $props();
  let open = $state(true);
  $effect(() => {
    open = dev.host.eventsOpen();
  });
  let who = $state<string>();
  let other = $state<string>();
  let said = $state('');
  const named = (id: string | undefined) => dev.rows.find((r) => r.id === id)?.name ?? id;
  function done(text: string) {
    said = text;
    dev.note('dev', text);
  }

  /** A run going now, as the server lists one, made up for the page alone. */
  function fakeRun(label: string): Work {
    return {
      id: -Date.now(),
      kind: 'job',
      label,
      detail: 'From the Dev window',
      since: new Date().toISOString(),
      queued: false,
      steps: 0
    };
  }
  const withRun = (id: string, label: string) => ({
    ...dev.host.inProgress(),
    [id]: [fakeRun(label), ...(dev.host.inProgress()[id] ?? [])]
  });

  function inject(kind: 'hand-off' | 'lesson' | 'working-on' | 'working-off' | 'asks') {
    const h = dev.host;
    if (kind === 'hand-off' && who && other) {
      h.inject({ type: 'hand-off', kind: 'given', from: who, to: other });
      return done(`Fired a hand-off: ${named(who)} to ${named(other)}`);
    }
    if (kind === 'lesson' && who) {
      h.inject({ type: 'lesson', kind: 'kept', staff: who, lesson: 0 });
      return done(`Fired a kept lesson for ${named(who)}`);
    }
    if (kind === 'working-on' && who) {
      h.inject({
        type: 'working',
        chatting: [],
        inProgress: withRun(who, 'A fake run from the Dev window')
      });
      return done(`Fired working: ${named(who)} runs a fake job (the page only)`);
    }
    if (kind === 'working-off') {
      h.inject({ type: 'working', chatting: [], inProgress: {} });
      return done('Fired working: nobody runs anything');
    }
    if (kind === 'asks') {
      h.inject({ type: 'change', table: 'asks' });
      return done('Fired a change to asks: the page fetches /api/office again');
    }
    done('Pick the Odds that event needs.');
  }

  // The race the code map found: refresh() can land after a newer live event
  // and put an old "working" label back. Nearly impossible to time by hand.
  async function race() {
    if (!who) return done('Pick an Odd for the race.');
    const was = dev.delayMs;
    dev.delayMs = 1500;
    dev.host.inject({ type: 'change', table: 'asks' });
    await new Promise((r) => setTimeout(r, 200));
    dev.host.inject({
      type: 'working',
      chatting: [],
      inProgress: withRun(who, 'Newer than the fetch')
    });
    done(`Race: a newer working event for ${named(who)} arrived while /api/office was held 1.5 s`);
    await new Promise((r) => setTimeout(r, 1700));
    dev.delayMs = was;
    const now = dev.host.working()[who];
    done(
      now === 'Newer than the fetch'
        ? `Race result: the newer event survived`
        : `Race result: the late fetch overwrote the newer event: ${named(who)} reads "${now ?? 'not working'}" again`
    );
  }

  const timer = setInterval(() => (open = dev.host.eventsOpen()), 1000);
  onDestroy(() => {
    clearInterval(timer);
    dev.delayMs = 0;
  });
</script>

<p class="mb-2 text-xs text-muted">
  Fire any live event in this page, slow down /api/office, or cut the event stream and see what the
  page does. Nothing here reaches the server.
</p>

<div class="text-[10px] tracking-wider text-faint uppercase">Network</div>
<div class="flex flex-wrap items-center gap-1 text-xs">
  <span class="text-faint">Hold /api/office</span>
  {#each [0, 500, 1500, 5000] as ms (ms)}
    <button
      class="rounded-md px-2 py-0.5 {dev.delayMs === ms
        ? 'bg-ember/25'
        : 'bg-raise hover:bg-sea/20'}"
      onclick={() => (dev.delayMs = ms)}>{ms ? `${ms} ms` : 'Off'}</button
    >
  {/each}
</div>
<div class="mt-1 flex flex-wrap items-center gap-1 text-xs">
  <span class="text-faint">Event stream</span>
  <span class={open ? 'text-moss' : 'text-coral'}>{open ? 'open' : 'closed'}</span>
  <button
    class="rounded-md bg-raise px-2 py-0.5 hover:bg-coral/20"
    onclick={() => {
      dev.host.dropEvents();
      open = false;
      done('Dropped the event stream: watch whether the page notices');
    }}>Drop it</button
  >
  <button
    class="rounded-md bg-raise px-2 py-0.5 hover:bg-sea/20"
    onclick={() => {
      dev.host.reconnectEvents();
      open = true;
      done('Opened the event stream again');
    }}>Reconnect</button
  >
</div>
{#if !open}
  <p class="mt-1 text-[11px] text-coral">
    The page shows nothing while the stream is down: the floor goes quietly stale. Dropped this way
    (closed), it stays down until Reconnect; a real network drop is retried by the browser.
  </p>
{/if}

<div class="mt-3 text-[10px] tracking-wider text-faint uppercase">Fire an event</div>
<div class="grid grid-cols-[5rem_1fr] items-center gap-x-2 gap-y-1 text-xs">
  <span class="text-faint">Odd</span>
  <select class="rounded-md bg-raise px-2 py-1" bind:value={who}>
    <option value={undefined}>Pick one</option>
    {#each dev.rows as r (r.id)}<option value={r.id}>{r.name}</option>{/each}
  </select>
  <span class="text-faint">Colleague</span>
  <select class="rounded-md bg-raise px-2 py-1" bind:value={other}>
    <option value={undefined}>For a hand-off</option>
    {#each dev.rows as r (r.id)}<option value={r.id}>{r.name}</option>{/each}
  </select>
</div>
<div class="mt-1 flex flex-wrap gap-1">
  <button
    class="rounded-md bg-raise px-2 py-1 text-xs hover:bg-sea/20"
    onclick={() => inject('hand-off')}>Hand-off</button
  >
  <button
    class="rounded-md bg-raise px-2 py-1 text-xs hover:bg-sea/20"
    onclick={() => inject('lesson')}>Kept lesson</button
  >
  <button
    class="rounded-md bg-raise px-2 py-1 text-xs hover:bg-sea/20"
    onclick={() => inject('working-on')}>Working: starts</button
  >
  <button
    class="rounded-md bg-raise px-2 py-1 text-xs hover:bg-sea/20"
    onclick={() => inject('working-off')}>Working: everyone stops</button
  >
  <button
    class="rounded-md bg-raise px-2 py-1 text-xs hover:bg-sea/20"
    onclick={() => inject('asks')}>Table change: asks</button
  >
</div>

<div class="mt-3 text-[10px] tracking-wider text-faint uppercase">Reproduce on purpose</div>
<button class="w-full rounded-md bg-raise p-1.5 text-start text-xs hover:bg-sea/20" onclick={race}>
  The stale-working race <span class="text-faint"
    >· a late /api/office lands after a newer live event</span
  >
</button>
{#if said}<p class="mt-2 text-xs text-ember">{said}</p>{/if}
