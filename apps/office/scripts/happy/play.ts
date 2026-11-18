// What the Claude Code stand-in (stand-in.ts) does on a run: a play. And a
// scripted scenario: its plays, and the owner's story (scripted.ts) around them. The happy
// path's plays are in scenario.ts, and each scripted scenario's in its own file
// in scenarios/. Types only, so the stand-in and the runners share them
// without loading each other.
import type { OfficeState, Throwaway } from './office.ts';

/** What the stand-in knows about the run it is playing, for plays that need it. */
export type PlayContext = {
  odd: string;
  /** What the run was sent on stdin: the owner's message in a chat, a label otherwise. */
  message: string;
  /** The owner's newest words: a chat in a new session opens with the chat so far. */
  said: string;
  /** The "## This run" section of the system prompt: a job's name, a pick-up's story. */
  thisRun: string;
  system: string;
  /** The office's folder (ODDBORO_HOME). */
  home: string;
  /** What the scenario wrote down for its plays as it went (`Throwaway.note`). */
  notes: Record<string, unknown>;
};

export type Act =
  /** Write a file through the files server; a refusal ends the run as failed. */
  | { write: string; content: string }
  /** Put a task on the owner's desk; a refusal ends the run as failed. */
  | { task: { title: string; why: string; steps: string[]; choices?: string[] } }
  /** Call any tool. Whatever it answers is written down for the story to check. */
  | { call: string; server?: 'office' | 'files'; input: Record<string, unknown> }
  /** Read a file through the files server, written down like `call`. */
  | { read: string }
  /** Wait, as a model thinking would. */
  | { think: number }
  /** Stop the process here, as a crash: nothing more on stdout. */
  | { exit: number; stderr?: string }
  /**
   * End the run the way Claude Code ends one on a usage limit. Assumed, not
   * captured from a real run: a `result` with subtype success and is_error set.
   */
  | { limit: string }
  /** Go quiet: no output and no end, until the office gives up on the run. */
  | { hang: true }
  /** Report the plan's 5-hour window, as each Claude Code run does (`notePlan` in staff.ts). */
  | { usage: { fiveHour: number; resetsInMinutes: number } };

export type Play = {
  odd: string;
  /** Matched against the owner's newest words and the run's "This run" section. */
  when: RegExp;
  /** Play this only the first time it matches. */
  once?: boolean;
  acts: Act[] | ((c: PlayContext) => Act[]);
  /** Defaults to a short line that says it is done. */
  reply?: string;
  outcome?: 'done' | 'waiting' | 'failed';
};

/** One tool call a run made, as runs.jsonl keeps it. */
export type CallLine = {
  run: string;
  call: string;
  input: Record<string, unknown>;
  ok: boolean;
  text: string;
};

/** One run the stand-in played, from runs.jsonl. */
export type RunLine = {
  run: string;
  /** The scripted runner's session it ran in, when one was playing. */
  session?: string;
  odd: string;
  /** The play's index in its list, or null when no play matched. */
  script: number | null;
  message: string;
  thisRun?: string;
  crash?: string;
  calls: CallLine[];
};

/** What a scenario's story gets: the office, its Odds, and the owner's moves. */
export type Story = {
  office: Throwaway;
  /** Each Odd's id by name: Marshall, Wes and Fay. */
  ids: Record<string, string>;
  /**
   * One checked step. `bug` marks the step the scenario's open bug breaks:
   * while it fails the way the bug says, the scenario passes as known, and if
   * it passes, the scenario fails, to say the mark should come off.
   */
  step(name: string, fn: () => Promise<void>, opts?: { bug?: boolean }): Promise<void>;
  /** The owner says `message` to the Odd named `name`, and waits for its reply. A chat that fails throws. */
  chat(name: string, message: string): Promise<string>;
  now(): Promise<OfficeState>;
  /** Waits until nobody has run or waited for a slot for a second and a half. */
  settle(ms?: number): Promise<OfficeState>;
  /** Moves the office clock on, as if time had passed. */
  clock: {
    /** A job's next run is due now. */
    job(name: string): Promise<void>;
    /** A parked thread's time to pick back up is now. */
    thread(title: string): Promise<void>;
    /** The plan's 5-hour window has reset, and every thread it held is due. */
    windowReset(): Promise<void>;
  };
  /** The runs this scenario's stand-in played for the Odd named `name`, matching `re` in their message or "This run" section. */
  runsOf(name: string, re?: RegExp): RunLine[];
  /** Every call to `tool` the Odd named `name` made. */
  callsOf(name: string, tool: string): CallLine[];
};

export type Scenario = {
  name: string;
  title: string;
  /** The Linear issue the scenario reproduces, and whether it is still open. */
  bug?: { id: string; open: boolean };
  /** Added to the office's environment, so only in an office of its own. */
  env?: Record<string, string>;
  /** It stops the office, so it never plays in one kept open for a person (`--here`). */
  stopsOffice?: boolean;
  plays: Play[];
  story(s: Story): Promise<void>;
};
