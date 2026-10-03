// Checks a looted-cities submission before it becomes a GitHub issue.
// Kept free of Worker-specific code so it can be tested on its own.

/** GitHub rejects issue bodies over 65,536 characters; this many cities stays well inside that. */
export const MAX_CITIES = 4000;
const MAX_NAME = 32;

export interface Submission {
  name: string;
  cities: string[];
}

export type Parsed = { ok: true; value: Submission } | { ok: false; error: string };

export function parseSubmission(input: unknown): Parsed {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Expected a JSON object.' };
  const { name, cities } = input as { name?: unknown; cities?: unknown };
  if (!Array.isArray(cities) || cities.length === 0) return { ok: false, error: 'No cities to submit.' };
  if (cities.length > MAX_CITIES) return { ok: false, error: `Too many cities at once (the limit is ${MAX_CITIES}).` };
  const clean = new Set<string>();
  for (const c of cities) {
    // Block coordinates only: "x,z" with nothing else, so no text can be smuggled into the issue.
    if (typeof c !== 'string' || !/^-?\d{1,8},-?\d{1,8}$/.test(c)) return { ok: false, error: 'Cities must look like "x,z".' };
    clean.add(c);
  }
  // The name is shown in the issue title: keep only characters a Minecraft username can have.
  const who = typeof name === 'string' ? name.replace(/[^A-Za-z0-9_]/g, '').slice(0, MAX_NAME) : '';
  return { ok: true, value: { name: who || 'anonymous', cities: [...clean] } };
}

/** Label put on every submission, so they are easy to find among other issues. It must exist in the repository. */
export const LABEL = 'map-submission';

export function issueFor(s: Submission): { title: string; body: string; labels: string[] } {
  return {
    labels: [LABEL],
    title: `Looted cities from ${s.name} (${s.cities.length})`,
    body: [
      `Submitted through the app by **${s.name}**. Not verified.`,
      '',
      'To add these to the shared list, run `npm run looted -- --issue <this issue number>`, then commit and push.',
      '',
      '```csv',
      'x,z',
      ...s.cities,
      '```',
    ].join('\n'),
  };
}
