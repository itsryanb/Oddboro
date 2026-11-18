// A scripted scenario (apps/office/scripts/happy) gives up on a quiet run in
// seconds, not minutes, through ODDBORO_RUN_TIMEOUT_MS. The app sets
// ODDBORO_APP and a release ODDBORO_VERSION, so neither ever reads it.
const testTimeout =
  process.env.ODDBORO_APP || process.env.ODDBORO_VERSION
    ? undefined
    : Number(process.env.ODDBORO_RUN_TIMEOUT_MS) || undefined;

/** `ms`, or the scripted scenarios' shorter timeout when one is set. */
export const runTimeout = (ms: number): number => testTimeout ?? ms;
