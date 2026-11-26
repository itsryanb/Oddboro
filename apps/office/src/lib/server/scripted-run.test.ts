// Scripted runs through the office's real run path: each stand-in tool
// (`scripts/stand-in/run.mjs`) plays a scenario file's steps in its own
// shape, and a call it makes reaches the run's own office server, as the real
// tool's would. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Agent } from '@oddboro/ledger';
import { L, chat, folder, odd } from './office-under-test.ts';

/** One Odd on each tool. */
const ODDS: Record<Agent, string> = { claude: 'cal', grok: 'gil', codex: 'cora', gemini: 'gem' };
await L.pg`insert into staff ${L.pg(
  Object.entries(ODDS).map(([agent, id]) => ({ ...odd(id, id), agent }))
)}`;

/** A scenario file of `lines`, in a folder of its own. */
function scenarioFile(...lines: string[]): string {
  const file = join(mkdtempSync(join(folder, 'scenario-')), 'scenario.txt');
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

/** One chat message's end, and the tools the floor was told it used. */
async function chatEnd(id: string, message: string) {
  const end = { tools: [] as string[], reply: '', error: '' };
  await chat(id, message, (e) => {
    if (e.type === 'tool') end.tools.push(e.name);
    if (e.type === 'done') end.reply = e.text;
    if (e.type === 'error') end.error = e.message;
  });
  return end;
}

for (const [agent, id] of Object.entries(ODDS) as [Agent, string][])
  test(`a scripted ${L.AGENT_NAMES[agent]} run's call to an office tool reaches the office, which shows the call and keeps what it did`, async () => {
    const title = `Order more seats, for ${id}`;
    const ask = { title, why: 'The hall is full.', if_approved: 'I order them.' };
    const file = scenarioFile(
      'Think aloud: Asking first.',
      `Call office raise_ask with ${JSON.stringify(ask)}`,
      'Reply: I asked.'
    );
    const end = await chatEnd(id, `Play the scenario ${file}.`);
    assert.equal(end.error, '');
    assert.match(end.reply, /I asked\.$/);
    assert.ok(end.tools.includes('mcp__office__raise_ask'), end.tools.join(', '));
    const asks = await L.pg<
      { staff_id: string }[]
    >`select staff_id from asks where title = ${title}`;
    assert.deepEqual(
      asks.map((a) => a.staff_id),
      [id]
    );
  });

test("a scripted run's call to a tool the office does not have fails the run, which names the call", async () => {
  const file = scenarioFile('Call office no_such_tool', 'Reply: Never sent.');
  const end = await chatEnd('cal', `Play the scenario ${file}.`);
  assert.equal(end.reply, '');
  assert.match(end.error, /call to office no_such_tool failed/);
});
