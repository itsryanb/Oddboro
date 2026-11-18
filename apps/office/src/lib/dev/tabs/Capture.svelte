<script lang="ts">
  import { onMount } from 'svelte';
  import type { DevState } from '../state.svelte.ts';

  let { dev }: { dev: DevState } = $props();

  type Summary = {
    file: string;
    odds: number;
    log: number;
    frames: number;
    draws: number;
    warnings: string[];
    shot?: string;
    shotProblem?: string;
  };

  let summary = $state<Summary | undefined>();
  let busy = $state(false);
  let copied = $state(false);

  const stamp = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  };

  async function capture() {
    if (busy) return;
    busy = true;
    copied = false;
    try {
      const when = new Date();
      const now = performance.now();
      const draws = dev.draws.filter((d) => d.at >= now - 10_000);
      const byWhy: Record<string, number> = {};
      for (const d of draws) byWhy[d.why] = (byWhy[d.why] ?? 0) + 1;
      let shot: string | undefined;
      let shotProblem: string | undefined;
      const floor = dev.floor;
      try {
        if (!floor) throw new Error('the floor is not open');
        shot = await floor.app.renderer.extract.base64(floor.app.stage);
      } catch (e) {
        shotProblem = e instanceof Error ? e.message : String(e);
      }
      const file = `oddboro-bug-${stamp(when)}.json`;
      const bundle = {
        capturedAt: when.toISOString(),
        office: location.href,
        odds: dev.rows.map((r) => ({
          name: r.name,
          id: r.id,
          server: r.server,
          page: r.page,
          visit: r.visit,
          tag: r.tag,
          surfaces: r.surfaces,
          flags: r.flags,
          snapshot: r.snap
        })),
        log: dev.log.slice(0, 300),
        rewind: dev.frames.filter((f) => f.at >= when.getTime() - 120_000),
        redraws: { lastTenSeconds: draws.length, byWhy },
        server: dev.server,
        screenshot: shot ?? null,
        screenshotProblem: shotProblem ?? null
      };
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = file;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      summary = {
        file,
        odds: bundle.odds.length,
        log: bundle.log.length,
        frames: bundle.rewind.length,
        draws: draws.length,
        warnings: dev.rows.flatMap((r) => r.flags.map((f) => `${r.name}: ${f.text}`)),
        shot,
        shotProblem
      };
      dev.note('dev', `Captured ${file}: ${summary.odds} Odds, ${summary.warnings.length} flags`);
    } finally {
      busy = false;
    }
  }

  const prompt = $derived(
    summary
      ? [
          `I captured a bug in the Oddboro office with the Dev window: ${summary.file}, saved to my Downloads folder.`,
          `It holds every Odd's row from the floor debugger (what the server says, what the page decided and why, the tag and each surface's words), the last ${summary.log} log lines, ${summary.frames} rewind frames from the last 2 minutes, the redraws of the last 10 s, the server's state and a screenshot of the floor.`,
          summary.warnings.length
            ? `The floor debugger flagged:\n${summary.warnings.map((w) => `- ${w}`).join('\n')}`
            : 'The floor debugger flagged nothing.',
          'Diagnose what the floor shows, with the evidence, before changing code. The code: apps/office/src/routes/+page.svelte (wantOf, statusOf, the ticker), src/lib/floor/staff.ts, src/lib/server/staff.ts.'
        ].join('\n\n')
      : ''
  );

  async function copy() {
    await navigator.clipboard.writeText(prompt);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  // Shift+` reads as "~" on most keyboards.
  onMount(() => {
    const onkey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]'))
        return;
      if (e.key === '~') void capture();
    };
    window.addEventListener('keydown', onkey);
    return () => window.removeEventListener('keydown', onkey);
  });
</script>

<div class="flex flex-col gap-3 text-xs">
  <p class="text-muted">
    One file with everything needed to explain what the floor is doing right now: every Odd's
    inspector row, the log, the last 2 minutes of rewind, the redraws, the server's state and a
    screenshot. Attach it to a bug, or hand it to Claude Code.
  </p>
  <div class="flex items-center gap-2">
    <button class="rounded-md bg-raise px-2 py-1 hover:bg-sea/20" onclick={capture} disabled={busy}
      >{busy ? 'Capturing' : 'Capture this moment'}</button
    >
    <span class="text-faint">or press Shift+`</span>
  </div>
  <p class="text-[11px] text-faint">
    Prototype: Shift+` works while this tab is open. The file goes to the browser's downloads.
  </p>

  {#if summary}
    <section class="flex flex-col gap-2 rounded-lg bg-raise p-2">
      <h3 class="text-[10px] tracking-wider text-faint uppercase">Saved</h3>
      <p class="font-mono text-ink">{summary.file}</p>
      <ul class="text-muted">
        <li>{summary.odds} Odds with their sources and checks</li>
        <li>{summary.log} log lines</li>
        <li>{summary.frames} rewind frames from the last 2 minutes</li>
        <li>{summary.draws} redraws in the last 10 s</li>
        <li>
          {#if summary.warnings.length}
            <span class="text-coral">{summary.warnings.length} flags</span>
          {:else}
            no flags
          {/if}
        </li>
      </ul>
      {#if summary.warnings.length}
        <ul class="flex flex-col gap-0.5">
          {#each summary.warnings as w (w)}<li class="text-coral">{w}</li>{/each}
        </ul>
      {/if}
      {#if summary.shot}
        <img
          src={summary.shot}
          alt="The floor when it was captured"
          class="max-h-40 self-start rounded-md border border-hairline"
        />
      {:else if summary.shotProblem}
        <p class="text-faint">No screenshot: {summary.shotProblem}</p>
      {/if}
      <div>
        <button class="rounded-md bg-raise px-2 py-1 hover:bg-sea/20" onclick={copy}
          >{copied ? 'Copied' : 'Copy for Claude Code'}</button
        >
      </div>
    </section>
  {/if}
</div>
