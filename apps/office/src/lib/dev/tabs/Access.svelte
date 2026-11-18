<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { DevState } from '../state.svelte.ts';

  let { dev }: { dev: DevState } = $props();

  const WIDTHS = [390, 768, 1024, 1440];
  const DEV_WINDOW = 'section[aria-label="Dev tools"]';

  function openAt(w: number) {
    const h = w < 600 ? 844 : 900;
    window.open(location.href, '_blank', `width=${w},height=${h}`);
    dev.note('dev', `Opened the office in a ${w} px window`);
  }

  // Overlays are plain fixed elements on the page, so they never touch the floor's draws.
  let crosshair = $state(false);
  let clipped = $state(false);
  let marks: HTMLElement[] = [];
  let clippedCount = $state(0);

  function clearMarks() {
    for (const m of marks) m.remove();
    marks = [];
  }

  function mark(style: string, text = '') {
    const el = document.createElement('div');
    el.style.cssText = `position: fixed; pointer-events: none; z-index: 65; ${style}`;
    el.textContent = text;
    document.body.appendChild(el);
    marks.push(el);
  }

  function drawOverlays() {
    clearMarks();
    if (crosshair && dev.floor) {
      const x = innerWidth / 2 + dev.floor.viewOffsetX;
      const y = innerHeight / 2;
      mark(
        `inset-inline-start: ${x - 12}px; inset-block-start: ${y}px; inline-size: 24px; block-size: 1px; background: var(--color-ember)`
      );
      mark(
        `inset-inline-start: ${x}px; inset-block-start: ${y - 12}px; inline-size: 1px; block-size: 24px; background: var(--color-ember)`
      );
      mark(
        `inset-inline-start: ${x + 6}px; inset-block-start: ${y + 6}px; font: 10px monospace; color: var(--color-ember)`,
        'floor centre'
      );
    }
    clippedCount = 0;
    if (clipped)
      for (const el of document.querySelectorAll<HTMLElement>('button.tag')) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const outside = r.x < 0 || r.y < 0 || r.right > innerWidth || r.bottom > innerHeight;
        const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const covered = !outside && !!at && !el.contains(at);
        if (!outside && !covered) continue;
        clippedCount++;
        mark(
          `inset-inline-start: ${r.x - 2}px; inset-block-start: ${r.y - 2}px; inline-size: ${r.width + 4}px; block-size: ${r.height + 4}px; outline: 2px dashed var(--color-coral); border-radius: 9999px`
        );
      }
  }

  $effect(() => {
    void crosshair;
    void clipped;
    drawOverlays();
  });

  // Tags move with the floor, so the marks follow it on the floor's own ticker
  // while on. A ticker callback comes off cleanly whatever else hooks the floor.
  $effect(() => {
    const floor = dev.floor;
    if (!floor || (!crosshair && !clipped)) return;
    let last = 0;
    const follow = () => {
      const now = performance.now();
      if (now - last > 200) {
        last = now;
        drawOverlays();
      }
    };
    floor.app.ticker.add(follow);
    return () => {
      floor.app.ticker.remove(follow);
    };
  });

  type Low = { el: HTMLElement; text: string; ratio: number; need: number; fg: string; bg: string };
  let low = $state<Low[]>([]);
  let contrastRan = $state(false);
  let outline = $state(false);

  function rgb(c: string): [number, number, number, number] | undefined {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return undefined;
    const p = m[1]
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }

  const lum = ([r, g, b]: number[]) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  const hex = (c: number[]) =>
    `#${c
      .slice(0, 3)
      .map((v) => Math.round(v).toString(16).padStart(2, '0'))
      .join('')}`;

  // The first ancestor background that is mostly opaque; translucent panels over the floor fall back to the night colour.
  function backgroundOf(el: HTMLElement): number[] {
    for (let n: HTMLElement | null = el; n; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c && c[3] >= 0.6) return c;
    }
    return [0x0b, 0x0d, 0x17, 1];
  }

  function checkContrast() {
    const found: Low[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (el.closest(DEV_WINDOW)) continue;
      const own = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent?.trim());
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
      const fg = rgb(s.color);
      if (!fg) continue;
      const bg = backgroundOf(el);
      const blended = fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
      const [a, b] = [lum(blended), lum(bg)];
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const size = Number.parseFloat(s.fontSize);
      const bold = Number(s.fontWeight) >= 700;
      const need = size >= 18 || (bold && size >= 14) ? 3 : 4.5;
      if (ratio < need)
        found.push({
          el,
          text: (el.textContent ?? '').trim().slice(0, 40),
          ratio,
          need,
          fg: hex(blended),
          bg: hex(bg)
        });
    }
    low = found.sort((x, y) => x.ratio / x.need - y.ratio / y.need).slice(0, 40);
    contrastRan = true;
    dev.note('check', `Contrast: ${found.length} text elements under the WCAG ratio`);
  }

  let outlined: HTMLElement[] = [];
  $effect(() => {
    for (const el of outlined) el.style.removeProperty('outline');
    outlined = [];
    if (!outline) return;
    for (const l of low) {
      l.el.style.outline = '1.5px solid var(--color-coral)';
      outlined.push(l.el);
    }
  });

  type NoRing = { what: string };
  let noRing = $state<NoRing[]>([]);
  let focusRan = $state(false);
  let focusTotal = $state(0);
  let noRingCount = $state(0);
  /** Set when the check could not judge: the browser was showing no keyboard focus at all. */
  let focusMouse = $state(false);

  // Only what draws: an outline or border colour alone follows the text colour,
  // so a control that only brightens its text on focus would read as a ring.
  const ringOf = (el: HTMLElement) => {
    const s = getComputedStyle(el);
    const outline =
      s.outlineStyle === 'none' || !parseFloat(s.outlineWidth)
        ? 'none'
        : `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`;
    const border = [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth]
      .map(parseFloat)
      .some(Boolean)
      ? s.borderColor
      : 'none';
    return `${outline}|${s.boxShadow}|${border}`;
  };

  function describe(el: HTMLElement) {
    const label =
      el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? el.textContent ?? '';
    return `${el.tagName.toLowerCase()}: ${label.trim().replace(/\s+/g, ' ').slice(0, 40) || '(no label)'}`;
  }

  function checkFocus() {
    const was = document.activeElement as HTMLElement | null;
    const found: NoRing[] = [];
    const els = [
      ...document.querySelectorAll<HTMLElement>(
        'button, a[href], input, textarea, select, [tabindex]'
      )
    ].filter((el) => !el.closest(DEV_WINDOW) && el.getBoundingClientRect().width > 0);
    // A ring shows only for :focus-visible, which follows how the person last
    // moved focus: after a click, a focus from script shows none on any control.
    // Started from the keyboard, it shows wherever the page draws one.
    let judged = 0;
    for (const el of els) {
      el.blur();
      const before = ringOf(el);
      el.focus({ preventScroll: true });
      if (document.activeElement !== el) continue;
      if (!el.matches(':focus-visible')) continue;
      judged++;
      if (ringOf(el) === before) found.push({ what: describe(el) });
    }
    was?.focus({ preventScroll: true });
    focusRan = true;
    focusMouse = !judged;
    noRing = found.slice(0, 40);
    noRingCount = found.length;
    focusTotal = judged;
    dev.note(
      'check',
      judged
        ? `Focus: ${found.length} of ${judged} controls show no focus ring`
        : 'Focus: not judged, the check was started with the mouse'
    );
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

  onDestroy(() => {
    clearMarks();
    for (const el of outlined) el.style.removeProperty('outline');
  });
</script>

<div class="flex flex-col gap-4 text-xs">
  <section class="flex flex-col gap-2">
    <h3 class="text-[10px] tracking-wider text-faint uppercase">Width presets</h3>
    <div class="flex flex-wrap gap-1.5">
      {#each WIDTHS as w (w)}
        <button
          class="rounded-md bg-raise px-2 py-1 text-xs hover:bg-sea/20"
          onclick={() => openAt(w)}>{w} px</button
        >
      {/each}
    </div>
    <p class="text-faint">
      Opens this office in a real window of that width. Catches NEW-1748: at narrow widths, windows
      open behind an Odd's panel.
    </p>
  </section>

  <section class="flex flex-col gap-2">
    <h3 class="text-[10px] tracking-wider text-faint uppercase">Overlays</h3>
    <label class="flex items-center gap-2"
      ><input type="checkbox" bind:checked={crosshair} /> Where the camera thinks the floor's centre is</label
    >
    <label class="flex items-center gap-2"
      ><input type="checkbox" bind:checked={clipped} /> Name tags clipped by the edge or covered
      {#if clipped}<span class={clippedCount ? 'text-coral' : 'text-moss'}
          >({clippedCount} now)</span
        >{/if}</label
    >
  </section>

  <section class="flex flex-col gap-2">
    <h3 class="text-[10px] tracking-wider text-faint uppercase">Contrast</h3>
    <div class="flex items-center gap-2">
      <button class="rounded-md bg-raise px-2 py-1 text-xs hover:bg-sea/20" onclick={checkContrast}
        >Check the page's text</button
      >
      {#if low.length}
        <label class="flex items-center gap-1.5"
          ><input type="checkbox" bind:checked={outline} /> Outline them</label
        >
      {/if}
    </div>
    {#if contrastRan}
      {#if low.length}
        <ul class="flex flex-col gap-1">
          {#each low as l, i (i)}
            <li class="flex items-center gap-2">
              <span class="w-12 shrink-0 font-mono text-coral">{l.ratio.toFixed(2)}:1</span>
              <span class="inline-block size-3 shrink-0 rounded-sm" style="background: {l.fg}"
              ></span>
              <span class="inline-block size-3 shrink-0 rounded-sm" style="background: {l.bg}"
              ></span>
              <span class="min-w-0 truncate text-muted">"{l.text}"</span>
              <span class="ms-auto shrink-0 text-faint">needs {l.need}:1</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-moss">Every visible text element meets its WCAG ratio.</p>
      {/if}
    {/if}
    <p class="text-faint">
      WCAG AA: 4.5:1, or 3:1 for large text. Catches NEW-1691 (faint text on cards too low in
      contrast). The background is the nearest mostly opaque one, so text over the floor is measured
      against the night colour: an estimate there.
    </p>
  </section>

  <section class="flex flex-col gap-2">
    <h3 class="text-[10px] tracking-wider text-faint uppercase">Focus</h3>
    <button
      class="self-start rounded-md bg-raise px-2 py-1 text-xs hover:bg-sea/20"
      onclick={checkFocus}>Check every control's focus ring</button
    >
    {#if focusRan && focusMouse}
      <p class="text-ember">
        Not judged: the browser shows focus rings only for keyboard focus, and this check was
        started with the mouse. Press Tab until this button is focused, then Enter.
      </p>
    {:else if focusRan}
      {#if noRing.length}
        <p class="text-coral">
          {noRingCount} of {focusTotal} controls show no visible focus ring{noRingCount >
          noRing.length
            ? ` (the first ${noRing.length})`
            : ''}:
        </p>
        <ul class="flex flex-col gap-0.5">
          {#each noRing as n, i (i)}
            <li class="truncate text-muted">{n.what}</li>
          {/each}
        </ul>
      {:else}
        <p class="text-moss">All {focusTotal} controls change when focused.</p>
      {/if}
    {/if}
    <p class="text-faint">
      Focuses each control as the keyboard would and compares its outline and shadow, so start it
      from the keyboard. Catches NEW-1691 (keyboard focus not visible in the chat box and most
      fields).
    </p>
  </section>

  <section class="flex flex-col gap-1">
    <h3 class="text-[10px] tracking-wider text-faint uppercase">This viewer</h3>
    <p>Reduced motion: <span class="text-ink">{reduced ? 'on' : 'off'}</span></p>
    <p>Colour scheme: <span class="text-ink">{scheme}</span></p>
    <p class="text-faint">
      These follow the system and cannot be switched from the page. The happy path's --ui mode runs
      with reduced motion, and Playwright can emulate either setting.
    </p>
  </section>
</div>
