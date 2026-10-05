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
  /** How many of the points are cities on the webmap, as opposed to ones a player found already looted. */
  mapped: number;
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
/** The most cities on the webmap that may be counted towards one path. */
const MAX_WEBMAP_SUPPORT = 2;

export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
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
export const findTrajectories = (already: Pt[], intact: Pt[], mapped: Pt[] = []): Trajectory[] =>
  studyTrajectories(already, intact, mapped).paths;

/**
 * The same, along with a sentence for each group of reports that came close to being a path
 * but was not drawn, saying why.
 */
export function studyTrajectories(reported: Pt[], intact: Pt[], mapped: Pt[] = []): { paths: Trajectory[]; near: string[] } {
  const near: string[] = [];
  const where = (pts: Pt[]) => `near x: ${pts[0].x}, z: ${pts[0].z}`;
  // Group the players' reports that are within reach of each other. Only reports start a path: the
  // players behind the webmap have shown where they flew, and it is the others we are trying to trace.
  const group = reported.map((_, i) => i);
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i])));
  for (let i = 0; i < reported.length; i++) {
    for (let j = i + 1; j < reported.length; j++) {
      if (Math.hypot(reported[i].x - reported[j].x, reported[i].z - reported[j].z) <= LINK_BLOCKS) group[root(i)] = root(j);
    }
  }
  const groups = new Map<number, Pt[]>();
  reported.forEach((p, i) => {
    const g = groups.get(root(i));
    if (g) g.push(p);
    else groups.set(root(i), [p]);
  });

  /** The line a set of points is stretched along, and each point's place along and across it. */
  const fit = (pts: Pt[]) => {
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
    const ordered = [...pts].sort((a, b) => along(a) - along(b));
    const length = along(ordered[ordered.length - 1]) - along(ordered[0]);
    return { ux, uz, across, ordered, length, slack: Math.max(500, 0.2 * length) };
  };

  const out: Trajectory[] = [];
  for (const told of groups.values()) {
    if (told.length < 2) continue;
    // A city on the webmap may have been this hunter's too (whoever mapped it can have flown past
    // without looting it), so the nearest couple that sit on the reports' own line lend support.
    // No more than that: a path must not turn into a tracing of the webmap.
    const own = fit(told);
    const support = mapped
      .filter((m) => !told.includes(m) && own.across(m) <= own.slack && told.some((p) => Math.hypot(p.x - m.x, p.z - m.z) <= LINK_BLOCKS))
      .sort((a, b) => own.across(a) - own.across(b))
      .slice(0, MAX_WEBMAP_SUPPORT);
    const pts = [...told, ...support];
    if (pts.length === 2) near.push(`2 ships found already looted ${where(told)}: a third in line with them would make a path`);
    if (pts.length < MIN_POINTS) continue;
    const { ux, uz, across, ordered: points, slack } = fit(pts);
    // A blob of reports says someone was around, not which way they went.
    if (Math.max(...pts.map(across)) > slack) {
      near.push(`${told.length} ships found already looted ${where(told)} do not line up, so no path is drawn`);
      continue;
    }

    const spoilers = intact.filter((p) => distanceToLine(p, points) <= CORRIDOR_BLOCKS).length;
    let confidence: Confidence | null = pts.length >= HIGH_POINTS ? 'high' : 'medium';
    // Elytra still there along the way: think less of the path, or drop it. A single intact
    // city is let pass, since any hunter can miss one.
    if (spoilers > 1 && spoilers * 2 >= pts.length) confidence = null;
    else if (spoilers > 1) confidence = confidence === 'high' ? 'medium' : null;
    if (!confidence) {
      near.push(
        `${told.length} ships found already looted ${where(told)} line up, but ${spoilers} ships along the line were looted the ordinary way, so no path is drawn`,
      );
      continue;
    }

    const first = points[0], last = points[points.length - 1];
    out.push({
      points,
      before: { x: Math.round(first.x - ux * EXTEND_BLOCKS), z: Math.round(first.z - uz * EXTEND_BLOCKS) },
      after: { x: Math.round(last.x + ux * EXTEND_BLOCKS), z: Math.round(last.z + uz * EXTEND_BLOCKS) },
      confidence,
      intact: spoilers,
      mapped: support.length,
    });
  }
  if (reported.length >= MIN_POINTS && groups.size === reported.length) {
    near.push(`${reported.length} ships found already looted, but none within ${LINK_BLOCKS.toLocaleString()} blocks of another`);
  }
  return { paths: out, near };
}

/** Why the path is believed, in words. */
export const describeTrajectory = (t: Trajectory): string =>
  `${t.confidence} confidence: ${t.points.length} ships in a line (` +
  [
    t.points.length - t.mapped ? `${t.points.length - t.mapped} looted by someone else` : '',
    t.mapped ? `${t.mapped} on the webmap` : '',
  ]
    .filter(Boolean)
    .join(', ') +
  '), ' +
  (t.intact ? `${t.intact} found intact along it` : 'none found intact along it');
