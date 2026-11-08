// Turns text into a vector on this Mac, through Ollama's nomic-embed-text, so
// nothing written to the ledger leaves the machine. Returns null when Ollama is
// not running or does not answer in time; the row is still written and found
// by its words.
const OLLAMA = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
export const EMBED_MODEL = 'nomic-embed-text';
/**
 * Long enough for Ollama to load the model cold. Every ledger write waits for
 * this, and an Ollama that hangs (seen 2026-11-08) held them all: onboarding
 * never answered.
 */
export const EMBED_TIMEOUT_MS = 15_000;
/** After a failure, writes skip Ollama this long, so a stuck one costs one wait, not one per line. */
const PAUSE_MS = 60_000;
let pausedUntil = 0;

/** `document` for text being stored, `query` for text being searched with. */
export async function embed(
  text: string,
  as: 'document' | 'query',
  timeoutMs = EMBED_TIMEOUT_MS
): Promise<number[] | null> {
  if (Date.now() < pausedUntil) return null;
  try {
    const res = await fetch(`${OLLAMA}/api/embed`, {
      method: 'POST',
      body: JSON.stringify({ model: EMBED_MODEL, input: `search_${as}: ${text}` }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { embeddings?: number[][] };
    return body.embeddings?.[0] ?? null;
  } catch {
    pausedUntil = Date.now() + PAUSE_MS;
    return null;
  }
}
