// Small pieces the scenarios' plays share.

/** Each Odd's id by name, which the runner notes once they are hired. */
export const ids = (notes: Record<string, unknown>) => notes.ids as Record<string, string>;

/** A colleague's run writes in its own part of the work's folder, which its brief names. */
export const part = (thisRun: string) => /save it in (.+?) and name it/.exec(thisRun)?.[1] ?? '.';

/** A run the owner started in chat with these words, not a later run that carries them in its story. */
export const asked = (words: string) => new RegExp(`^${words}`);
