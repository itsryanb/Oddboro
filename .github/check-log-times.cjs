// Fork only (plan-new-1781.yml): every line of an installed app's office.log
// starts with its time, and any failed or stopped run shows as its own line.
const fs = require('fs');
const file = process.argv[2];
if (!fs.existsSync(file)) {
  console.log(`::error title=No log::${file}`);
  process.exit(1);
}
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
const timed = /^(oddboro: )?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z /;
const bare = lines.filter((l) => !timed.test(l));
const runs = lines.filter((l) => / run (failed|stopped): /.test(l));
const show = (a) => a.slice(0, 8).join(' / ').replace(/%/g, '%25');
console.log(
  `::notice title=Log lines::${lines.length} lines, ${bare.length} without a time. First: ${show(lines.slice(0, 4))}`
);
if (runs.length) console.log(`::notice title=Run lines::${show(runs)}`);
if (bare.length) {
  console.log(`::error title=Lines without a time::${show(bare)}`);
  process.exit(1);
}
