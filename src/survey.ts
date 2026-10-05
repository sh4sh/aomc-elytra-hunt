// A survey: a random sample of the cities near End Spawn, visited to estimate how many of them
// were looted before anyone kept a record.
//
// Looting follows flight paths, so cities next to each other tend to share a fate, and a sample of
// neighbours says little about the rest. The sample here is spread out instead: the area is cut
// into distance bands and quadrants, and each piece gives cities in proportion to how many it
// holds. With shares in proportion, the plain fraction found looted estimates the whole area.

/** Ships closer to End Spawn than this (along the longer axis, as the search measures) count as possibly looted. */
export const NEAR_SPAWN_BLOCKS = 10000;

interface Point {
  x: number;
  z: number;
}

/** How many distance bands the surveyed area is cut into, each crossed with the four quadrants. */
const BANDS = 4;

/** The piece of the surveyed area a city falls in: its distance band (along the longer axis) and quadrant. */
export function stratum(c: Point, limit: number): string {
  const band = Math.min(BANDS - 1, Math.floor((Math.max(Math.abs(c.x), Math.abs(c.z)) / limit) * BANDS));
  return `${band}${c.z < 0 ? 'N' : 'S'}${c.x < 0 ? 'W' : 'E'}`;
}

/** Pick `n` of the cities at random, each piece of the area giving its share. Fewer when there are not `n` to pick. */
export function surveySample<T extends Point>(cities: T[], n: number, limit: number, random: () => number = Math.random): T[] {
  const groups = new Map<string, T[]>();
  for (const c of cities) {
    const key = stratum(c, limit);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const want = Math.min(n, cities.length);
  // Whole shares first, then the cities left over go to the pieces that were rounded down the most.
  const shares = [...groups.values()].map((group) => {
    const exact = (want * group.length) / cities.length;
    return { group, take: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = want - shares.reduce((t, s) => t + s.take, 0);
  for (const s of [...shares].sort((p, q) => q.rest - p.rest)) {
    if (left <= 0) break;
    s.take++;
    left--;
  }
  const out: T[] = [];
  for (const { group, take } of shares) {
    const from = [...group];
    for (let k = 0; k < take; k++) out.push(from.splice(Math.floor(random() * from.length), 1)[0]);
  }
  return out;
}

/**
 * The share found already looted among the cities checked so far, with a rough margin either side
 * (95%, narrowing as more of the `frame` the sample was drawn from is checked). Null until one is checked.
 */
export function surveyEstimate(checked: number, already: number, frame: number): { rate: number; margin: number } | null {
  if (checked <= 0) return null;
  const rate = already / checked;
  const whole = frame > 1 ? Math.max(0, (frame - checked) / (frame - 1)) : 0;
  return { rate, margin: 1.96 * Math.sqrt(((rate * (1 - rate)) / checked) * whole) };
}
