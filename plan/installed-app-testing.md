# Testing the installed app

**Status: proposed.** This plan lives only in the fork (`itsryanb/Oddboro`,
branch `ci/installed-app-smoke`). Hard rule 11 keeps undecided things out of
the main repo, so drop the `plan/` folder from anything sent upstream. Once the
owner agrees to the approach, it becomes a decision in `docs/decisions/`.

Started 2026-11-07. Update the tracker below as phases land.

## The problem

Nothing tests the installed app. `stage.ts --smoke` starts the staged server
and checks it answers. It never installs or launches the real installer,
AppImage or `.dmg`. An artifact can pass every check and still be broken when
it runs.

| Incident         | What broke                                                                                                           | Where it showed                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| #25 (2c44686)    | Revoke, deleting a poke and signing out did nothing. SvelteKit's origin check runs only in the release, never in dev | Released app, Mac and Windows      |
| #40 (e3fa51d)    | The 0.0.6 Windows installer held 0.0.5, so every Windows app updated forever                                         | Every Windows install, until 0.0.7 |
| PR #14 (3a5c842) | URL paths broke the first start on Windows                                                                           | Windows only                       |
| PR #18 (703b78f) | An npm-installed Claude Code on Windows is `claude.cmd`, so the office said it was not installed                     | Windows only                       |
| #13 (549fbd8)    | 785 kB first chunk and 16,000 extra files shipped                                                                    | Every install                      |
| e718aba          | On Linux the office started before the desktop, so sign-in never opened the browser                                  | Linux login                        |

This is Quinn's pattern 3 ("works on the Mac or in dev, breaks on another
system or in the release") and the half of pattern 2 that the release artifact
gate (`ci/release-artifact-gate`) cannot see.

## Tracker

| Phase                                  | Status                                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Prerequisite: tests run on Windows     | Done on this branch (3be9027, `windows-and-linux-test-fixes`). Ledger tests on Windows 11, 2026-11-07: 302 pass, 0 fail, 3 skipped |
| 0. Prove the unknowns on real runners  | In progress. Windows x64 proven locally (below). The rest is open                                                                  |
| 1a. Instrument the app                 | Not started                                                                                                                        |
| 1. Gate the release on installed smoke | Not started                                                                                                                        |
| 2. Checks on every pull request        | Not started                                                                                                                        |
| 3. Deeper journeys, fakes, MCP driver  | Not started                                                                                                                        |

## How the installed app runs

The facts the harness depends on, from the code at 5b9e264.

- **Isolation already exists.** `ODDBORO_PORT` (default 4500),
  `ODDBORO_HOME` (default `~/.oddboro`) and `ODDBORO_DB_PORT` (default 54329) move everything except the log
  ([env.rs](../apps/desktop/src-tauri/src/env.rs)).
- **The log ignores isolation.** `~/Library/Logs/Oddboro/office.log` on a
  Mac, `$XDG_STATE_HOME/oddboro/office.log` on Linux,
  `%LOCALAPPDATA%\Oddboro\Logs\office.log` on Windows. Lines have no
  timestamps.
- **Start order** ([main.rs `start`](../apps/desktop/src-tauri/src/main.rs#L99-L168)):
  update check (5 s), port check, find Node and the server, loading window,
  start Node, poll `GET /` every 0.5 s for up to 90 s, open the office window.
- **Dialogs are modal and silent.** A taken port shows "Another office is
  already running", logs nothing and exits 0
  ([main.rs:116-124](../apps/desktop/src-tauri/src/main.rs#L116-L124)).
  `alert` and `fail` never write the log
  ([main.rs:405-417](../apps/desktop/src-tauri/src/main.rs#L405-L417)).
- **Updates run on launch in release builds.** `ODDBORO_UPDATE_URL` replaces
  the address, but only an `https` one unless the build is a `--test` build
  (`dangerousInsecureTransportProtocol`).
- **Quitting.** Mac and Linux: SIGTERM to the shell takes the normal path
  (`server::stop`, Node gets 10 s). Windows: nothing a script can send. A kill
  of the shell closes Node's stdin and Node quits.
- **Restarts are silent.** Node is restarted after 1, 5, then 30 s, up to 5
  times in 10 minutes. A test could pass against a restarted server.
- **The PATH on Mac and Linux** comes from the login shell, not the app's
  environment, plus `~/.local/bin`, `~/.claude/local` and the usual folders.
  A fake `claude` must sit in one of those.
- **Secrets.** The Mac app keeps the office's secrets in the Keychain through
  the shell (`ODDBORO_SECRETS=shell`), read at first start. Linux uses
  `secret-tool` and a Secret Service keyring. Windows uses the Credential
  Manager.
- **Single instance** on Linux and Windows. The plugin's callback ignores a
  second launch's arguments
  ([main.rs:38](../apps/desktop/src-tauri/src/main.rs#L38)).

### What the server offers a test

- `GET /api/update` returns `current`, the running app's version.
- `GET /api/setup` returns `checks`: `mac` (the system), `node`, `claude`,
  `ollama`, `uv`, `service`, `keyring`, `database`. It took 2 to 7 s and runs
  `claude --version` and other programs.
- `POST /api/onboarding` with
  `{ "name": "Smoke", "zone": "America/Los_Angeles", "manager": { "preset": "marshall" } }`
  finishes the welcome: env, database and roster. No Claude call.
- `DELETE /api/pokes/999999` answers 404 "No such poke waiting" when the
  request reached its route, and 403 when the guard refused it.
- **The guard** (`guardOffice`,
  [owner-page.ts](../apps/office/src/lib/server/owner-page.ts)): the Host must
  be one of the office's names, and any write needs `Sec-Fetch-Site:
same-origin`, or with no `Sec-Fetch-Site`, an `Origin` whose host is the
  Host. A script can send what a browser sends. That does not weaken anything:
  the guard stops web pages, which cannot forge those headers, and any local
  program can already read `~/.oddboro`. Never add a test bypass to it.
- **The page sends every write as JSON** through `call()`
  ([api.ts](../apps/office/src/lib/ui/api.ts)), the #25 fix. There are 41
  `call()` sites in components and one raw `fetch` POST (in `ChatPanel.svelte`,
  which sets JSON).

## What we proved on Windows (2026-11-07)

Installed 0.0.8 at `%LOCALAPPDATA%\Oddboro`, run with a spare port, database
port and a throwaway home. Scripts in [spikes/](spikes/).

| Check                                               | Result                                                         |
| --------------------------------------------------- | -------------------------------------------------------------- |
| First start                                         | Answered in 7 to 10 s across six runs                          |
| `GET /api/update`                                   | `current: "0.0.8"`                                             |
| Write with no `Origin`                              | 403                                                            |
| `DELETE` as today's page sends it (Origin and JSON) | 404, reached the route                                         |
| `DELETE` as 0.0.5's page sent it (Origin, no type)  | 403 "Cross-site DELETE form submissions are forbidden": #25    |
| WebView2 DevTools port                              | Opened with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`            |
| Requests from inside the real page                  | Same results as above                                          |
| Screenshot of the real page                         | Works: the Welcome screen, under 8 s after launch              |
| Onboarding with Marshall                            | 200, about 1.5 s                                               |
| Setup checks                                        | All ok on this machine                                         |
| Kill the shell                                      | Node and the office port gone in 0.4 s, database port in 1.7 s |
| Relaunch at once with the same home                 | Answered in 7 s and kept its data (one run)                    |

**Seen once, not reproduced.** A second launch half a second after a quit
logged its update check, then nothing, and exited 0 about 110 s later. That
matches the silent "Another office is already running" dialog and someone
pressing OK. One repeat with the same steps started normally. Phase 0 runs the
relaunch 20 times on a runner. The log fixes in 1a would have explained it.

## Driving the real window

| System  | Install                                                                                                            | Drive the real window                                                                                                                                                                                  | Watch out for                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Windows | NSIS with `/S` (case matters). Check the uninstall entry's `DisplayVersion` and the Start menu shortcut            | DevTools over `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<p>`. Proven. Set `WEBVIEW2_USER_DATA_FOLDER` per instance for parallel runs                                              | Modal dialogs block. `windows-latest` is Windows Server, not 10 or 11                                                       |
| Linux   | Run the AppImage under `xvfb-run` and `dbus-run-session`, with `libfuse2` and `gnome-keyring`                      | WebDriver through `WebKitWebDriver` (`webkit2gtk-driver`), or `tauri-driver`. Release builds allow it when `TAURI_WEBVIEW_AUTOMATION=true`, read at run time by `tauri-runtime-wry`, Linux only        | wry hands automation the first webview created, and Oddboro creates the loading window first. Ubuntu 24.04 lacks `libfuse2` |
| Mac     | `hdiutil attach`, then `codesign --verify --deep --strict`, `spctl --assess -vv`, `xcrun stapler validate`, launch | None without a WebDriver server built into the app, which a shipped app must not carry. Use requests from outside the window, both header shapes (with and without `Sec-Fetch-Site`), and a screenshot | The Keychain read at first start may prompt on a runner. Screen capture permission on `macos-15` runners is unproven        |

Other Mac routes, for later if a Mac-only window bug shows up: a separate
test build (never shipped) with `tauri-plugin-wdio-webdriver` for
`@wdio/tauri-service`, CrabNebula's paid driver, or the open-source
`tauri-webdriver` plugin (debug builds).

## Design

### One driver library, three callers

A driver library with no new dependencies (hard rule 13). Node 24's `fetch`
and `WebSocket` cover DevTools and WebDriver, as the spikes show. It lives
where the stage never ships it.

- `install(artifact)`, `launch({ port, home, scenario })`, `relaunch()`,
  `quit({ graceful })`, `uninstall()`
- `health()`, `log.tail()`, `log.grep()`
- `actions.*`: the page's own actions (phase 2)
- `page.click / read / screenshot`: DevTools on Windows, WebDriver on Linux,
  outside-the-window requests and a screenshot on the Mac
- `fakeRuntime(script)` (phase 3)

Callers:

1. `apps/desktop/scripts/smoke.ts`, with `--stage` (replaces `stage.ts
--smoke`), `--artifact <file> --version x.y.z` and `--installed` (the app
   already on a developer's machine, isolated from their office).
2. The test suites, in CI. Deterministic.
3. An MCP server for agents (phase 3). Never CI's mechanism.

### The checks

| Check                                                                                              | Catches                                                  | Staged server | Windows     | Linux                        | Mac                           |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------- | ----------- | ---------------------------- | ----------------------------- |
| Starts in under 60 s with no dialog                                                                | Broken bundle, missing Node, PR #14                      | yes           | yes         | yes                          | yes                           |
| Reports its version                                                                                | #40 at run time. Gives Linux the check the gate lacks    |               | yes         | yes                          | yes                           |
| A write with no `Origin` gets 403                                                                  | A guard switched off, which would also pass the next row | yes           | yes         | yes                          | yes                           |
| Page-shaped writes reach their routes: onboarding 200, `DELETE` poke 404                           | The server side of #25                                   | yes           | in the page | in the page (if 0 proves it) | from Node, both header shapes |
| Setup checks: database, keyring, Claude found through a stub (`claude.cmd` on Windows)             | PR #18, the built-in database, keyring wiring            | yes           | yes         | yes                          | yes                           |
| The page renders, screenshot kept                                                                  | Blank window, broken page files                          |               | yes         | yes                          | screenshot only               |
| Quits with Node and both ports gone                                                                | A leftover Node holding 4500                             | yes           | yes         | yes                          | yes                           |
| Relaunch keeps its data                                                                            | Migrations, home layout, the stall above                 | yes           | yes         | yes                          | yes                           |
| Install facts: uninstall entry version, shortcut, signing and notarization, data kept on uninstall | Broken signing, notifications without a shortcut         |               | yes         |                              | yes                           |

### Covering #25 for real

A request the test builds proves only that the server accepts the test's
shape. #25 was the page sending the wrong shape. Three layers:

1. A lint guard: every write from the page goes through the actions module or
   `api.ts`.
2. The server-side checks above, on every target.
3. A real click on Revoke in the real window (Windows and Linux), with the
   grant set up through the API first (phase 3). It must fail against 0.0.5.

## Execution plan

### Phase 0: prove the unknowns (about 1 day)

On real GitHub runners, from a workflow on this branch in the fork:

- Linux: the AppImage under Xvfb on `ubuntu-22.04` and `ubuntu-24.04`, with a
  keyring. WebDriver with `TAURI_WEBVIEW_AUTOMATION=true`: does it attach to
  the loading window or the office window? Fallback: outside-the-window
  requests and an Xvfb screenshot.
- Mac (`macos-15`): does first start prompt for the Keychain? If so, create
  and unlock a temporary default keychain first. Does `screencapture` work?
- Windows arm64 (`windows-11-arm`): DevTools as on x64.
- Windows: launch, quit and relaunch 20 times, logging any dialog's text.
- Test against the published 0.0.8 files, downloaded from the release. No
  secrets needed.

Done when each risk is confirmed or has a fallback written here.

### Phase 1a: instrument the app (about 1.5 days)

Small changes that make failures explain themselves. Each one helps support as
much as testing. All of it stays on the owner's computer: no telemetry leaves
it.

1. Every dialog's text goes to the log before it shows, and each failure gets
   its own exit code (port taken, no Node, no server, timed out, gave up after
   restarts).
2. Timestamps on the shell's lines, and a header line at each launch: app
   version, Rust target, OS version, `tauri::webview_version()`, port, home.
3. `ODDBORO_LOG` moves the log, like `ODDBORO_PORT` moves the port.
4. One line per server startup step with its time: secrets, database,
   migrations, update row, then "office ready in X ms"
   ([hooks.server.ts](../apps/office/src/hooks.server.ts)).
5. The page's boot and errors reach the log. There is no `hooks.client.ts`
   and no `window.onerror` today. Add a client `handleError`, listeners for
   uncaught errors and rejections, a guarded and capped `POST
/api/client-log` written as `page:` lines, a "page booted" line, and the
   shell logging the office window's `on_page_load`. This is the Mac's only
   signal that the real window ran the page.
6. `GET /api/health`: version, pid, uptime, step times, database status,
   connected pages, page error count. Harmless facts only, since any local
   program can read a GET.
7. Version changes: "first start of 0.0.9 after 0.0.8, backed up to ..." from
   the server, and "updated from X to Y" from the shell. The same update twice
   in a row is a loop.

The harness must still work against 0.0.8, which has none of this. The log
lines make it faster and its errors clearer, but it falls back to polling over
HTTP.

### Phase 1: gate the release (2 to 3 days)

- The driver library and `smoke.ts`. `stage.ts --smoke` goes away.
- `release.yml`: a `smoke` job per target on the same runner type as its
  build, plus `ubuntu-24.04` for the x86_64 AppImage. No `environment:
release`, `contents: read` only. Uploads screenshots and logs, writes a
  summary table, and `draft` needs it.
- `apps/desktop/CLAUDE.md` gains a "Smoke tests" section.

Done when a hand-started workflow passes against the published 0.0.8 files on
all five targets and fails when a check is broken on purpose.

Merge `ci/release-artifact-gate` first. Both change what `draft` needs.

### Phase 2: checks on every pull request (1 to 2 days, plus the refactor)

- `ci.yml` on `ubuntu-24.04`, `windows-latest` and `macos-15`: lint guards,
  type checks, the office and ledger tests, `smoke.ts --stage`. About 10
  minutes. Needs the test fixes already on this branch.
- An unsigned build and the installed smoke when `apps/desktop` changes or a
  PR carries a label. The full five targets nightly on `main`.
- **The page's actions as an importable client.** Move the 41 `call()` sites
  into named functions in `lib/ui/actions/` (`revokeAccess`, `cancelPoke`,
  `finishOnboarding`, ...). Components call them. Tests call the same
  functions from Node through a `fetch` wrapper that adds only what a browser
  adds (`Origin`, `Sec-Fetch-Site`), against the built server. A request shape
  can no longer drift from what the test checks: 0.0.5's bodiless `DELETE`
  fails on the PR, on every system, in seconds. Start with the writes,
  bodiless `DELETE`s first.

### Phase 3: deeper journeys, fakes and the MCP driver (3 to 5 days)

- **Upgrade over the top:** install the previous release, onboard, install
  the candidate. Data kept, a backup made, the right version, no second
  update.
- **Fake runtimes:** `fake-claude` (later Codex, Gemini, Grok) replays a
  scripted run and can call the office's tools through `/api/gateway`. A
  shell change, `ODDBORO_EXTRA_PATH` ahead of the login-shell PATH, keeps a
  developer's local run from touching their real `~/.local/bin`.
- **Named starting states** built from actions and fake runs ("onboarded",
  "one tool granted", "a poke waiting"). No test-only routes in the app.
- **`oddboro --quit`** through the single-instance plugin, so Windows has a
  graceful quit a script (and the uninstaller) can use.
- **Revoke in the real window** on Windows and Linux.
- **The MCP server:** a thin layer over the driver library with
  `@modelcontextprotocol/sdk`, keeping a session (the app running, the window
  connection held) between tool calls. For Claude Code checking its own change
  in the real app, reproducing a bug report on a given version, and
  exploratory testing (an Odd only with the owner's explicit grant, hard
  rule 4, and only against a throwaway instance). It never ships inside the
  app, and it refuses port 4500 and the real `~/.oddboro` unless told
  explicitly.
- Optional: a real updater test, through local HTTPS (check which roots the
  updater trusts) or a nightly `--test` build.

Available with no code: Playwright's MCP server can attach to a DevTools
endpoint (`--cdp-endpoint`), so an agent can drive the real Windows window when
the app runs with the DevTools port open.

### Later

- **One clock.** Route the 93 `Date.now()` and `new Date()` calls in server
  code through one `now()` in the ledger. Unit tests inject a time. Later, an
  offset for end-to-end runs (pokes landing, the overnight install window).
- **Overridable service addresses.** Google, Gmail, Drive and Gemini
  addresses are constants today. One module tests can point at fakes.
- Selectors by role and accessible name, with an `aria-label` where a name is
  ambiguous ("Revoke Gmail for Marshall"). No test ids.

## What it will not catch

- Mac-only webview behaviour.
- Visual bugs like the lost blur. The clock and the automatic theme make pixel
  comparisons flaky. A person looks at the screenshots.
- Real Claude runs and real sign-ins (Google, OAuth).
- Linux desktop and login-order quirks (e718aba).
- Systems the runners lack: Windows 10 and 11 on x64 (`windows-latest` is
  Server), macOS 13 and 14 unless added, other Linux distributions.

## Open decisions for the owner

1. Hard rule 14: may the automated journey replace the manual setup walk on
   each system before a release, leaving a spot-check?
2. Mac: outside-the-window checks and a screenshot, or a separate test build
   with a WebDriver server, never shipped?
3. Unsigned app builds on PRs: on a label or `apps/desktop` changes
   (recommended), or every PR?

## Working in the fork

- A new fork has Actions turned off. Turn them on in the fork's Actions tab.
- Turn off the Release workflow there: the fork has no `release` environment
  or secrets, so a push to the fork's `main` would fail. Leave the fork's
  `main` alone.
- A `workflow_dispatch` workflow can only be started once the file is on the
  default branch. Trigger Phase 0 workflows on a push to this branch instead.
- Hosted runners, macOS and arm64 included, are free for public repos.
- `3be9027` has no `Signed-off-by` line. Add one before it goes upstream
  (the DCO decision).

## The spike scripts

In [spikes/](spikes/). Windows only, against the installed app. Each starts
Oddboro on its own port, database port and throwaway home, and quits it after.
They still write a few lines to the real `office.log` (1a, item 3).

```sh
node plan/spikes/installed.ts   # guard, #25 shapes, DevTools, in-page requests, screenshot
node plan/spikes/journey.ts     # setup checks, onboarding, quit, relaunch
node plan/spikes/relaunch.ts    # the relaunch stall, with dialog text on a stall
```

## Sources

- Tauri WebDriver: https://v2.tauri.app/develop/tests/webdriver/
- Tauri WebDriver in CI: https://v2.tauri.app/develop/tests/webdriver/ci/
- tauri-driver on macOS, still open: https://github.com/tauri-apps/tauri/issues/7068
- `TAURI_WEBVIEW_AUTOMATION` in `tauri-runtime-wry` and `tauri-driver`:
  https://github.com/tauri-apps/tauri (search the name)
- wry's WebKitGTK automation: https://docs.rs/crate/wry/latest/source/src/webkitgtk/web_context.rs
- A macOS WebDriver plugin for Tauri: https://danielraffel.me/2026/02/14/i-built-a-webdriver-for-wkwebview-tauri-apps-on-macos/
- Playwright and WebView2: https://playwright.dev/docs/webview2
- NSIS command line: https://nsis.sourceforge.io/Which_command_line_parameters_can_be_used_to_configure_installers
