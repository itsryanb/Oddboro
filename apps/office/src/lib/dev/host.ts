// What the Dev window reads of the office page (+page.svelte builds it). Every
// getter returns the value the floor itself uses, so the window shows the
// office's own state and never a second opinion of it.
import type { Desk } from '@oddboro/ledger';
import type { World } from '@oddboro/world';
import type { Floor } from '../floor/engine.ts';
import type { StaffActor } from '../floor/staff.ts';
import type { OfficeEvent } from '../server/events.ts';
import type { Activity, StaffProfile } from '../staff/roster.ts';
import type { threadTag } from '../staff/thread-tags.ts';
import type { Work } from '../staff/work.ts';

export type DevHost = {
  floor(): Floor | undefined;
  floorModule(): typeof import('../floor/index.ts') | undefined;
  actors(): StaffActor[];
  staff(): StaffProfile[];
  desk(): Desk;
  working(): Record<string, string>;
  inProgress(): Record<string, Work[]>;
  messages(): Record<string, number>;
  /** Odds with an ask, a task or a message for the owner (a task the owner set themselves has no Odd). */
  waiting(): Set<string | null>;
  threadTag(id: string): ReturnType<typeof threadTag> | undefined;
  /** The activity the office put each Odd in, as the ticker last decided it. */
  forced(): Record<string, Activity | undefined>;
  /** Odds the owner (or the Dev window) moved by hand: the ticker leaves them be. */
  manual(): Record<string, string>;
  setManual(id: string, on: boolean): void;
  /** When each free Odd gets up, on performance.now()'s clock. */
  leaveAt(): Record<string, number>;
  /** The words on an Odd's name tag, as the floor shows them now. */
  words(a: StaffActor): string;
  world(): World;
  roomName(id: string): string | undefined;
  taken(except?: StaffActor): Set<string>;
  wearing(id: string): string | undefined;
  /** The tile Odds walk in from. */
  start(): [number, number];
  select(id: string | undefined): void;
  /** Hand an event to the page as if the server sent it. */
  inject(e: OfficeEvent): void;
  dropEvents(): void;
  reconnectEvents(): void;
  eventsOpen(): boolean;
  /** Hear every live event before the page does; returns the way to stop. */
  tap(fn: (e: OfficeEvent) => void): () => void;
  refresh(): Promise<void>;
  hour(): number;
};
