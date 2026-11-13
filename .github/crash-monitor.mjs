// Fork only (plan-ledger-flake-hunt.yml): loaded into every test file's process
// through NODE_OPTIONS. Writes why a process ended badly, with its file's name,
// without changing how it ends: uncaughtExceptionMonitor only watches.
import { appendFileSync } from 'node:fs';
const file = process.argv.find((a) => a.endsWith('.test.ts'))?.split('/').pop() ?? 'runner';
const note = (what) =>
  appendFileSync(process.env.CRASH_LOG, `${new Date().toISOString()} ${file} ${what}\n`);
process.on('uncaughtExceptionMonitor', (e, origin) => note(`${origin}: ${e?.stack ?? e}`));
process.on('exit', (code) => {
  if (code) note(`exit ${code}`);
});
