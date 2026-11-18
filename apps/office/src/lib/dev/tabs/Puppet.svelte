<script lang="ts">
  import type { PlacedSpot } from '@oddboro/world';
  import type { StaffActor } from '../../floor/staff.ts';
  import type { Activity } from '../../staff/roster.ts';
  import type { DevState } from '../state.svelte.ts';

  let { dev }: { dev: DevState } = $props();
  const actors = $derived(dev.rows.map((r) => r.id));
  let who = $state<string>();
  let other = $state<string>();
  let activity = $state<Activity>('play');
  let said = $state('');
  const ACTIVITIES: Activity[] = [
    'work',
    'read',
    'intake',
    'wait',
    'talk',
    'play',
    'rest',
    'eat',
    'exercise',
    'home'
  ];

  const actor = (id: string | undefined) => dev.host.actors().find((a) => a.profile.id === id);
  const named = (id: string | undefined) => dev.rows.find((r) => r.id === id)?.name ?? id;
  function done(text: string) {
    said = text;
    dev.note('dev', `Puppet: ${text}`);
  }
  /** Moved by hand: the page's ticker leaves the Odd be until it is handed back. */
  function hold(a: StaffActor) {
    dev.host.setManual(a.profile.id, true);
  }
  function show(...layers: string[]) {
    dev.layers = { ...dev.layers, ...Object.fromEntries(layers.map((l) => [l, true])) };
  }

  function sendToTile() {
    const a = actor(who);
    if (!a) return;
    said = 'Click a tile on the floor.';
    dev.floorCatch((e) => {
      const at = dev.worldAt(e);
      if (!at) return;
      const w = dev.host.world();
      const near = [...w.spots].sort(
        (p, q) =>
          Math.hypot(p.tile[0] - at.tile[0], p.tile[1] - at.tile[1]) -
          Math.hypot(q.tile[0] - at.tile[0], q.tile[1] - at.tile[1])
      )[0] as PlacedSpot | undefined;
      if (!near) return done('No spot on this floor.');
      hold(a);
      const ok = a.sendTo(near);
      show('paths');
      done(
        ok
          ? `${a.profile.name} walks to ${near.name} on ${near.prop}, the spot nearest (${at.tile.join(', ')})`
          : `${a.profile.name} has no path to ${near.prop} near (${at.tile.join(', ')})`
      );
    });
  }

  function force() {
    const a = actor(who);
    if (!a) return;
    hold(a);
    const ok = a.assign(activity, dev.host.world().spots, dev.host.taken(a));
    show('paths', 'spots');
    done(
      ok
        ? `${a.profile.name} is forced to ${activity}`
        : `${a.profile.name}: no free ${activity} spot`
    );
  }

  function visit() {
    const a = actor(who);
    const b = actor(other);
    if (!a || !b || a === b) return done('Pick two different Odds.');
    show('visits', 'paths');
    done(
      a.visit(b)
        ? `${a.profile.name} sets off to visit ${b.profile.name}`
        : 'That visit could not start'
    );
  }

  function release() {
    const a = actor(who);
    if (!a) return;
    dev.host.setManual(a.profile.id, false);
    done(`${a.profile.name} is back in the office's hands`);
  }

  // The edge cases that are hard to time by hand.
  function chase() {
    const a = actor(who);
    const b = actor(other);
    if (!a || !b || a === b) return done('Pick two different Odds.');
    const far = [...dev.host.world().spots]
      .filter((s) => !dev.host.taken(b).has(s.id))
      .sort(
        (p, q) =>
          Math.hypot(q.tile[0] - b.x / 16, q.tile[1] - b.y / 16) -
          Math.hypot(p.tile[0] - b.x / 16, p.tile[1] - b.y / 16)
      )[0];
    hold(b);
    if (far) b.sendTo(far);
    a.visit(b);
    show('visits', 'paths');
    done(
      `${b.profile.name} walks off as ${a.profile.name} sets out to visit: watch the re-aims climb (935f63b)`
    );
  }

  function twoPops() {
    const a = actor(who);
    if (!a) return;
    a.pop('notebook');
    setTimeout(() => a.pop('note'), 300);
    done(`${a.profile.name}: a note pop while a notebook pop plays (the second should be dropped)`);
  }

  function deskTaken() {
    const a = actor(who);
    const b = actor(other);
    if (!a || !b || a === b) return done('Pick two different Odds.');
    const spots = dev.host.world().spots;
    hold(a);
    hold(b);
    const first = a.assign('talk', spots, dev.host.taken(a));
    const second = b.assign('talk', spots, dev.host.taken(b));
    show('spots', 'paths');
    done(
      `Both to the owner's desk: ${a.profile.name} ${first ? 'got a spot' : 'found none'}, ${b.profile.name} ${second ? 'got a spot' : 'found none, as a chat would when the desk is taken'}`
    );
  }
</script>

<p class="mb-2 text-xs text-muted">
  Move Odds by hand, in this page only. The server never hears of it, so nothing an owner sees
  changes.
</p>

<div class="grid grid-cols-[5rem_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
  <span class="text-faint">Odd</span>
  <select class="rounded-md bg-raise px-2 py-1" bind:value={who}>
    <option value={undefined}>Pick one</option>
    {#each actors as id (id)}<option value={id}>{named(id)}</option>{/each}
  </select>
  <span class="text-faint">Colleague</span>
  <select class="rounded-md bg-raise px-2 py-1" bind:value={other}>
    <option value={undefined}>For visits</option>
    {#each actors as id (id)}<option value={id}>{named(id)}</option>{/each}
  </select>
</div>

<div class="mt-3 text-[10px] tracking-wider text-faint uppercase">Do</div>
<div class="flex flex-wrap gap-1">
  <button
    class="rounded-md bg-raise px-2 py-1 text-xs hover:bg-sea/20 disabled:opacity-40"
    disabled={!who}
    onclick={sendToTile}>Send to a tile</button
  >
  <span class="flex items-center gap-1">
    <select class="rounded-md bg-raise px-1 py-1 text-xs" bind:value={activity}>
      {#each ACTIVITIES as a (a)}<option value={a}>{a}</option>{/each}
    </select>
    <button
      class="rounded-md bg-raise px-2 py-1 text-xs hover:bg-sea/20 disabled:opacity-40"
      disabled={!who}
      onclick={force}>Force it</button
    >
  </span>
  <button
    class="rounded-md bg-raise px-2 py-1 text-xs hover:bg-sea/20 disabled:opacity-40"
    disabled={!who || !other}
    onclick={visit}>Visit the colleague</button
  >
  <button
    class="rounded-md bg-raise px-2 py-1 text-xs hover:bg-sea/20 disabled:opacity-40"
    disabled={!who}
    onclick={() => {
      actor(who)?.pop('notebook');
      done(`${named(who)} plays a lesson pop`);
    }}>Lesson pop</button
  >
  <button
    class="rounded-md bg-raise px-2 py-1 text-xs hover:bg-sea/20 disabled:opacity-40"
    disabled={!who}
    onclick={release}>Hand back to the office</button
  >
</div>

<div class="mt-3 text-[10px] tracking-wider text-faint uppercase">
  Hard-to-time cases, set up in one click
</div>
<div class="flex flex-col gap-1">
  <button
    class="rounded-md bg-raise p-1.5 text-start text-xs hover:bg-sea/20 disabled:opacity-40"
    disabled={!who || !other}
    onclick={chase}
  >
    Visit a colleague who is mid-walk <span class="text-faint">· the chase fixed in 935f63b</span>
  </button>
  <button
    class="rounded-md bg-raise p-1.5 text-start text-xs hover:bg-sea/20 disabled:opacity-40"
    disabled={!who}
    onclick={twoPops}
  >
    A pop while another plays <span class="text-faint">· one is dropped, by design</span>
  </button>
  <button
    class="rounded-md bg-raise p-1.5 text-start text-xs hover:bg-sea/20 disabled:opacity-40"
    disabled={!who || !other}
    onclick={deskTaken}
  >
    Two Odds to the owner's desk <span class="text-faint">· a chat when the desk is taken</span>
  </button>
</div>
{#if said}<p class="mt-2 text-xs text-ember">{said}</p>{/if}
