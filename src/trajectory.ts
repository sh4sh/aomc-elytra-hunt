// A guess at where an earlier elytra hunter flew, from the cities players found already looted.
// Nothing here is known: it is a line fitted through a few reports, shown only when they agree.

export interface Pt {
  x: number;
  z: number;
}

export type Confidence = 'medium' | 'high';

export interface Trajectory {
  /** The cities found already looted, in order along the path. */
  points: Pt[];
  /** Where the path would carry on past its first and last city. */
  before: Pt;
  after: Pt;
  confidence: Confidence;
  /** Cities found with their elytra still there along the path: evidence against it. */
  intact: number;
}

/** Already-looted cities this close together are taken to be the same hunter's work. */
export const LINK_BLOCKS = 4000;
/** Cities this close to a path count as being on it. */
export const CORRIDOR_BLOCKS = 1000;
/** How far a path is carried on past each end. */
export const EXTEND_BLOCKS = 2000;
/** Fewer reports than this is not a path, just a place. */
const MIN_POINTS = 3;
const HIGH_POINTS = 5;

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = dx * dx + dz * dz;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

function distanceToLine(p: Pt, line: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, distanceToSegment(p, line[i - 1], line[i]));
  return best;
}

/** Whether a position lies on the path or on its continuation past either end. */
export const onTrajectory = (t: Trajectory, p: Pt): boolean =>
  distanceToLine(p, [t.before, ...t.points, t.after]) <= CORRIDOR_BLOCKS;

/**
 * Paths worth showing. `already` are cities found already looted; `intact` are cities found
 * with their elytra, which an earlier hunter passing that way would have taken.
 */
export function findTrajectories(already: Pt[], intact: Pt[]): Trajectory[] {
  // Group reports that are within reach of each other.
  const group = already.map((_, i) => i);
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i])));
  for (let i = 0; i < already.length; i++) {
    for (let j = i + 1; j < already.length; j++) {
      if (Math.hypot(already[i].x - already[j].x, already[i].z - already[j].z) <= LINK_BLOCKS) group[root(i)] = root(j);
    }
  }
  const groups = new Map<number, Pt[]>();
  already.forEach((p, i) => {
    const g = groups.get(root(i));
    if (g) g.push(p);
    else groups.set(root(i), [p]);
  });

  const out: Trajectory[] = [];
  for (const pts of groups.values()) {
    if (pts.length < MIN_POINTS) continue;
    // The direction the group is stretched along.
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const mz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    let sxx = 0, szz = 0, sxz = 0;
    for (const p of pts) {
      sxx += (p.x - mx) ** 2;
      szz += (p.z - mz) ** 2;
      sxz += (p.x - mx) * (p.z - mz);
    }
    const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    const ux = Math.cos(angle), uz = Math.sin(angle);
    const along = (p: Pt) => (p.x - mx) * ux + (p.z - mz) * uz;
    const across = (p: Pt) => Math.abs(-(p.x - mx) * uz + (p.z - mz) * ux);
    const points = [...pts].sort((a, b) => along(a) - along(b));
    const length = along(points[points.length - 1]) - along(points[0]);
    // A blob of reports says someone was around, not which way they went.
    const stray = Math.max(...pts.map(across));
    if (stray > Math.max(500, 0.2 * length)) continue;

    const spoilers = intact.filter((p) => distanceToLine(p, points) <= CORRIDOR_BLOCKS).length;
    let confidence: Confidence | null = pts.length >= HIGH_POINTS ? 'high' : 'medium';
    // Elytra still there along the way: think less of the path, or drop it. A single intact
    // city is let pass, since any hunter can miss one.
    if (spoilers > 1 && spoilers * 2 >= pts.length) confidence = null;
    else if (spoilers > 1) confidence = confidence === 'high' ? 'medium' : null;
    if (!confidence) continue;

    const first = points[0], last = points[points.length - 1];
    out.push({
      points,
      before: { x: Math.round(first.x - ux * EXTEND_BLOCKS), z: Math.round(first.z - uz * EXTEND_BLOCKS) },
      after: { x: Math.round(last.x + ux * EXTEND_BLOCKS), z: Math.round(last.z + uz * EXTEND_BLOCKS) },
      confidence,
      intact: spoilers,
    });
  }
  return out;
}

/** Why the path is believed, in words. */
export const describeTrajectory = (t: Trajectory): string =>
  `${t.confidence} confidence: ${t.points.length} cities found already looted in a line, ` +
  (t.intact ? `${t.intact} found intact along it` : 'none found intact along it');
