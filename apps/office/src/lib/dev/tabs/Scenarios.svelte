<script lang="ts">
  import type { DevState } from '../state.svelte.ts';

  let { dev }: { dev: DevState } = $props();

  type Result = {
    passed: boolean;
    /** Scripted scenarios only: "known" passed with its open bug's step failing as the bug says. */
    outcome?: 'passed' | 'known' | 'failed' | 'skipped';
    seconds?: number;
    steps: {
      name: string;
      ms: number;
      ok: boolean;
      error?: string;
      known?: boolean;
      /** A path break's prompt for Claude Code (scripts/happy/path-breaks.ts). */
      prompt?: string;
    }[];
    folder?: string | null;
    report?: string | null;
    error?: string;
  };

  // What each one found when it was written, on a checkout of main. The files
  // are in apps/office/scripts/happy/scenarios/.
  const SCENARIOS = [
    {
      id: 'first-hour',
      bug: 'NEW-1696',
      what: 'A fresh office onboards Pat, hires Wes and Fay, and Fay plans and books Friday lunch.',
      today: 'Passes. It is the happy path (npm run happy).'
    },
    {
      id: 'stuck-working',
      bug: 'NEW-1659',
      what: 'Wes runs three jobs that crash, hit the usage limit, and go quiet. Each must leave Wes free, with the run on record as failed.',
      today: 'Passes: each run ends failed and Wes is free. Fixed on main (d2208a8a).'
    },
    {
      id: 'hand-off-files',
      bug: 'NEW-1743',
      what: "Marshall has Wes build from Fay's plan: once handing a copy with the hand-off, once naming her file in the brief.",
      today: 'The copy reads. The named file is refused: "outside the folders you may read".'
    },
    {
      id: 'tell-lead-no',
      bug: 'NEW-1740',
      what: 'Pat tells Wes "No, I meant figures-old.md", and Wes passes the "No" to Fay, who leads.',
      today: "Passes: Fay gets Pat's words with Wes's own reading of them. Fixed on main."
    },
    {
      id: 'parked-wake',
      bug: 'NEW-1741',
      what: 'Work parked until tomorrow waits on "Test v1". Pat finishes the test now.',
      today: "Only the test's own work picks up. The parked work waits for the clock."
    },
    {
      id: 'window-leaves',
      bug: 'NEW-1784',
      what: "The 5-hour window holds Fay's and Marshall's hand-offs under one ask. Fay leaves, then the window resets.",
      today: 'Passes: the ask leaves the Desk once the window resets. Fixed on main (d49fa75e).'
    },
    {
      id: 'schedule-limits',
      bug: 'NEW-1682',
      what: 'Wes sets his job to daily at 99:99, then every 200 billion minutes, then the job comes due.',
      today:
        'Both are kept. The job now runs when due without stopping the office, so only the refusals are still open.',
      stopsOffice: true
    }
  ];

  let running = $state<string>();
  /** The step whose prompt was just copied, for a moment. */
  let copied = $state<string>();
  async function copyPrompt(key: string, text: string) {
    await navigator.clipboard.writeText(text).catch(() => {});
    copied = key;
    setTimeout(() => (copied = copied === key ? undefined : copied), 1500);
  }
  /** Whether this office is a throwaway one a scripted scenario can play in, on this floor. */
  let here = $state(false);
  fetch('/api/dev/scenario')
    .then((r) => (r.ok ? (r.json() as Promise<{ here: boolean }>) : { here: false }))
    .then((r) => (here = r.here))
    .catch(() => {});
  let playingHere = $state(false);
  let results = $state<Record<string, Result>>({});
  let problems = $state<Record<string, string>>({});

  const verdict = (r: Result) =>
    r.outcome === 'known'
      ? 'Fails the way its bug says'
      : r.outcome === 'failed' || !r.passed
        ? 'Failed'
        : 'Passed';

  async function run(id: string, inHere = false) {
    running = id;
    playingHere = inHere;
    delete problems[id];
    delete results[id];
    dev.note(
      'dev',
      `Scenario ${id}: started ${inHere ? 'in this office' : 'headless in its own throwaway office'}`
    );
    try {
      const res = await fetch('/api/dev/scenario', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: id, here: inHere })
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const r = (await res.json()) as Result;
      results[id] = r;
      const failed = r.steps.find((s) => !s.ok && !s.known);
      dev.note(
        r.passed ? 'dev' : 'check',
        `Scenario ${id}: ${verdict(r).toLowerCase()}${failed ? ` at "${failed.name}"` : ''}${r.seconds ? ` in ${r.seconds} s` : ''}`
      );
    } catch (e) {
      problems[id] = e instanceof Error ? e.message : String(e);
      dev.note('check', `Scenario ${id} could not run: ${problems[id]}`);
    } finally {
      running = undefined;
    }
  }
</script>

<div class="flex flex-col gap-3 text-xs">
  <p class="text-muted">
    Scripted Odds: each scenario plays a written script in place of a model, in a throwaway office
    of its own, so an office situation reproduces in seconds, the same way every time. A scenario
    tied to an open bug fails the way the bug says until it is fixed, then guards the fix.
  </p>
  {#if here}
    <p class="text-ember">
      This office is a throwaway one, so a scenario can play here: Run here plays it on this floor
      with Marshall, Wes and Fay, and hires back any of them who left.
    </p>
  {/if}
  <p class="text-faint">
    From a terminal: <code class="rounded bg-raise px-1 font-mono text-ink"
      >npm run scripted -- --all</code
    >
  </p>

  <ul class="flex flex-col gap-2">
    {#each SCENARIOS as s (s.id)}
      {@const result = results[s.id]}
      <li class="rounded-lg bg-raise p-2">
        <div class="flex items-center gap-2">
          <span class="font-mono text-ink">{s.id}</span>
          <span class="text-faint">{s.bug}</span>
          {#if s.id !== 'first-hour'}<span class="rounded bg-coral/15 px-1.5 text-[10px] text-coral"
              >known bug, open</span
            >{/if}
          <span class="flex-1"></span>
          {#if here && s.id !== 'first-hour' && !s.stopsOffice}
            <button
              class="rounded-md bg-sea/20 px-2 py-1 text-ink hover:bg-sea/35 disabled:opacity-40"
              onclick={() => run(s.id, true)}
              disabled={!!running}
              >{running === s.id && playingHere ? 'Playing' : 'Run here'}</button
            >
          {/if}
          <button
            class="rounded-md bg-raise px-2 py-1 hover:bg-sea/20 disabled:opacity-40"
            onclick={() => run(s.id)}
            disabled={!!running}
            >{running === s.id && !playingHere
              ? 'Running'
              : here
                ? 'Own office'
                : 'Run headless'}</button
          >
        </div>
        <p class="mt-1 text-muted">{s.what}</p>
        <p class="text-muted"><span class="text-faint">Today:</span> {s.today}</p>
        {#if here && s.stopsOffice}
          <p class="text-[11px] text-faint">It stops the office, so it plays only in its own.</p>
        {/if}
        {#if running === s.id}
          <p class="mt-1 text-ember">
            {playingHere
              ? 'Playing on this floor now, about 15 s. Close this window to watch.'
              : 'Running in its own throwaway office, about 25 s.'}
          </p>
        {/if}
        {#if problems[s.id]}<p class="mt-1 text-coral">{problems[s.id]}</p>{/if}
        {#if result}
          <div class="mt-2 rounded-md border border-hairline p-2">
            <p
              class={result.outcome === 'known'
                ? 'text-ember'
                : result.passed
                  ? 'text-moss'
                  : 'text-coral'}
            >
              {verdict(result)}{result.seconds ? ` in ${result.seconds} s` : ''}
            </p>
            {#if result.error}<p class="text-coral">{result.error}</p>{/if}
            <ol class="mt-1 flex flex-col gap-0.5">
              {#each result.steps as st (st.name)}
                <li class="flex gap-2">
                  <span class="w-10 {st.known ? 'text-ember' : st.ok ? 'text-moss' : 'text-coral'}"
                    >{st.known ? 'known' : st.ok ? 'ok' : 'FAIL'}</span
                  >
                  <span class="flex-1">{st.name}</span>
                  <span class="text-faint">{(st.ms / 1000).toFixed(1)} s</span>
                </li>
                {#if st.error}<li class="ps-12 {st.known ? 'text-muted' : 'text-coral'}">
                    {st.error}
                  </li>{/if}
                {#if st.prompt}
                  <li class="ps-12">
                    <button
                      class="rounded-md bg-coral/20 px-2 py-0.5 text-ink hover:bg-coral/35"
                      title="Copy a prompt for Claude Code to fix the path that broke through a wall, with its screenshot"
                      onclick={() => copyPrompt(`${s.id}:${st.name}`, st.prompt!)}
                      >{copied === `${s.id}:${st.name}` ? 'Copied' : 'Prompt'}</button
                    >
                  </li>
                {/if}
              {/each}
            </ol>
            {#if result.folder}
              <p class="mt-1 text-faint">
                Kept folder: <span class="font-mono">{result.folder}</span>
              </p>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</div>
