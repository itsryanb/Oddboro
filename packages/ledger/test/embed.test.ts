// An Ollama that takes the request and never answers, as one did on
// 2026-11-08 and held every ledger write with it.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';

let asked = 0;
const stuck = createServer(() => {
  asked++;
});
await new Promise<void>((done) => stuck.listen(0, '127.0.0.1', done));
process.env.OLLAMA_URL = `http://127.0.0.1:${(stuck.address() as AddressInfo).port}`;
const { embed } = await import('../src/embed.ts');

after(() => {
  stuck.closeAllConnections();
  stuck.close();
});

test('an Ollama that never answers gives no vector in time, and is left alone a while after', async () => {
  const started = Date.now();
  assert.equal(await embed('a line for the ledger', 'document', 300), null);
  assert.ok(Date.now() - started < 3000);
  assert.equal(await embed('the next line', 'document', 300), null);
  assert.equal(asked, 1);
});
