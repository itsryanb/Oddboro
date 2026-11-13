// Fork only: the 20 slowest tests in a node:test spec report, as one notice.
import { readFileSync } from 'node:fs';
const times = readFileSync(process.argv[2], 'utf8')
  .split('\n')
  .map((l) => l.match(/^\s*[✔✖] (.+) \((\d+(?:\.\d+)?)ms\)$/))
  .filter((m) => m && !m[1].startsWith('test/'))
  .map((m) => [Number(m[2]), m[1]])
  .sort((a, b) => b[0] - a[0])
  .slice(0, 20);
console.log(`::notice title=Slowest::${times.map(([ms, n]) => `${(ms / 1000).toFixed(1)}s ${n}`).join('%0A')}`);
