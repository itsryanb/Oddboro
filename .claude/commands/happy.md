---
description: Run Oddboro's happy path and diagnose it from its report
argument-hint: [what to look at, e.g. "why is the Desk step slow"]
---

Run the office's happy path and tell me what it shows. $ARGUMENTS

1. Run `npm run happy -- --json --keep` from the repo root. It prints one line of JSON: `passed`, `seconds`, each step with its time, `folder`, and `report`.
2. Read the `report` file it names (report.md). It holds every step's time, where the run stopped, what the office held then, each Odd's runs with the line of `SCRIPTS` that answered them (or a stand-in crash), each Odd's files, and the office's last log lines.
3. If a step failed, find the cause before suggesting anything:
   - Read `runs.jsonl` beside the report when a run did the wrong thing: it holds each run's full message and arguments.
   - Read `office.log` beside it for the office's own errors.
   - Look at `failed.png` when the report names one.
   - The story is `apps/office/scripts/happy/scenario.ts`. The owner's side is `run.ts` (API) and `browser.ts` (the page). The Odds are played by `stand-in.ts`.
4. If it passed, look at the step times and say which step is slow and why, from the report and the log.
5. Leave nothing running. If you start a run with `--hold` or `--watch`, or in a background shell, stop it (and its vite dev server) once you are done with it, before you finish.
6. Tell me what you found, with the evidence (file, line, log line or run), before changing any code. Say whether the cause is in the office itself or in the happy path's own scripts.

When I pasted a prompt from the control bar's "Copy for Claude Code" button instead, it names a report from a watched run whose office may still be open. Start from that report and query the office it names instead of running a new one.
