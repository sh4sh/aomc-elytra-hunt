import type { City, Filters, Quadrant } from './types';

/** Shulker box capacity: one run's worth of loot. */
export const BATCH_SIZE = 27;

// In Minecraft, north is -z and east is +x.
export function quadrantOf(x: number, z: number): Quadrant {
  return `${z < 0 ? 'N' : 'S'}${x >= 0 ? 'E' : 'W'}` as Quadrant;
}

/** Degrees between a position's bearing and the nearest diagonal (0 = on the diagonal, 45 = on an axis). */
export function diagonalOffset(x: number, z: number): number {
  return Math.abs(45 - (Math.atan2(Math.abs(z), Math.abs(x)) * 180) / Math.PI);
}

export function passes(x: number, z: number, f: Filters): boolean {
  if (f.around) return Math.hypot(x - f.around.x, z - f.around.z) <= f.around.radius;
  const d = Math.max(Math.abs(x), Math.abs(z));
  if (d < f.minDist || d > f.maxDist) return false;
  if (f.diagonalDeg < 45) {
    // Diagonals and axes are 45° apart, so the angle off the nearest axis is what's left of 45.
    const off = f.angleFrom === 'axis' ? 45 - diagonalOffset(x, z) : diagonalOffset(x, z);
    if (off > f.diagonalDeg) return false;
  }
  return f.quadrants.includes(quadrantOf(x, z));
}

type Point = { x: number; z: number };
const ORIGIN: Point = { x: 0, z: 0 };
/** Routes start in rings this many blocks deep, working outward. */
const START_BAND = 4000;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Order cities into a flight path: start nearest the origin (0,0 unless given), hop to the nearest
 * unvisited city each time, then untangle crossings (2-opt).
 */
export function route(cities: City[], origin: Point = ORIGIN): City[] {
  const left = [...cities];
  const path: City[] = [];
  let at: Point = origin;
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (dist(left[i], at) < dist(left[best], at)) best = i;
    at = left[best];
    path.push(left.splice(best, 1)[0]);
  }
  // Reversing path[i..j] replaces edges (i-1,i) and (j,j+1) with (i-1,j) and (i,j+1). The start stays fixed.
  for (let improved = true; improved; ) {
    improved = false;
    for (let i = 1; i < path.length - 1; i++) {
      for (let j = i + 1; j < path.length; j++) {
        const before = dist(path[i - 1], path[i]) + (j + 1 < path.length ? dist(path[j], path[j + 1]) : 0);
        const after = dist(path[i - 1], path[j]) + (j + 1 < path.length ? dist(path[i], path[j + 1]) : 0);
        if (after < before - 1e-9) {
          path.splice(i, j - i + 1, ...path.slice(i, j + 1).reverse());
          improved = true;
        }
      }
    }
  }
  return path;
}

/** Halve the set along its longer side, in multiples of the batch size, until every piece is one batch. */
function split(cities: City[], size: number): City[][] {
  if (cities.length <= size) return [cities];
  const span = (k: 'x' | 'z') => Math.max(...cities.map((c) => c[k])) - Math.min(...cities.map((c) => c[k]));
  const [k, other]: ['x' | 'z', 'x' | 'z'] = span('x') >= span('z') ? ['x', 'z'] : ['z', 'x'];
  const sorted = [...cities].sort((a, b) => a[k] - b[k] || a[other] - b[other]);
  const cut = Math.ceil(cities.length / size / 2) * size;
  return [...split(sorted.slice(0, cut), size), ...split(sorted.slice(cut), size)];
}

/** A gap in bearing wider than this (degrees) separates two fans of cities, e.g. two diagonals. */
const FAN_GAP_DEG = 8;

/**
 * Group cities into narrow slices by bearing from 0,0, so each batch is a line
 * heading outward, like a long exploration flight. Slices never straddle the
 * empty space between two fans, so each fan may end with short batches.
 */
function lines(cities: City[], size: number): City[][] {
  const bearing = (c: City) => (Math.atan2(c.z, c.x) * 180) / Math.PI;
  const sorted = [...cities].sort((a, b) => bearing(a) - bearing(b) || a.x - b.x || a.z - b.z);
  const n = sorted.length;
  // Gap in bearing between each city and the next one round the circle.
  const gap = (i: number) => (bearing(sorted[(i + 1) % n]) - bearing(sorted[i]) + 360) % 360;
  // Start just after the widest gap so no fan is cut in two by the wrap-around.
  let widest = 0;
  for (let i = 1; i < n; i++) if (gap(i) > gap(widest)) widest = i;
  const fans: City[][] = [[]];
  for (let k = 1; k <= n; k++) {
    const i = (widest + k) % n;
    fans[fans.length - 1].push(sorted[i]);
    if (k < n && gap(i) > FAN_GAP_DEG) fans.push([]);
  }
  const batches: City[][] = [];
  for (const fan of fans) {
    let at = 0;
    while (fan.length - at > size) {
      const left = fan.length - at;
      // Avoid a tiny leftover batch: share the last two slices evenly instead.
      const take = left < size * 1.5 ? Math.ceil(left / 2) : size;
      batches.push(fan.slice(at, at + take));
      at += take;
    }
    batches.push(fan.slice(at));
  }
  return batches;
}

export type BatchShape = 'cluster' | 'line';

/** Flight between two neighbouring stops that most players are happy to make. */
export const DEFAULT_MAX_HOP = 2000;

/**
 * Build full batches in which no hop between consecutive cities is longer than
 * maxHop. Each batch is grown as a path, from either end, one reachable city at
 * a time, so its order is already a valid route. Cities that cannot be worked
 * into a full batch are left out.
 *
 * `shape` steers which reachable city is taken next: for clusters, the one
 * nearest the batch's centre; for lines, the one nearest the ray from 0,0
 * through the batch's first city. With lineDeviation set, a line never takes a
 * city further than that many blocks to either side of that ray.
 */
function chains(
  cities: City[],
  size: number,
  maxHop: number,
  shape: BatchShape,
  lineDeviation = 0,
  origin: Point = ORIGIN,
): City[][] {
  const order = [...cities].sort((a, b) => dist(a, origin) - dist(b, origin) || a.x - b.x || a.z - b.z);

  // Cities bucketed into squares one hop wide, so "who is within reach" only looks at nine squares.
  const cellOf = (c: { x: number; z: number }) => `${Math.floor(c.x / maxHop)},${Math.floor(c.z / maxHop)}`;
  const grid = new Map<string, City[]>();
  for (const c of order) {
    const k = cellOf(c);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(c);
  }
  const reachable = (from: City, taken: Set<City>): City[] => {
    const out: City[] = [];
    const cx = Math.floor(from.x / maxHop);
    const cz = Math.floor(from.z / maxHop);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        for (const c of grid.get(`${i},${j}`) ?? []) if (!taken.has(c) && dist(c, from) <= maxHop) out.push(c);
      }
    }
    return out;
  };

  const batched = new Set<City>();
  const batches: City[][] = [];
  // Start close to the origin and work outward, so routes fill the area nearest the player first and
  // fewer cities are stranded between them. Within each band of distance, start from the cities with
  // the fewest neighbours: those can only ever be the end of a path, so they are best used up early.
  const degree = new Map(order.map((c) => [c, reachable(c, new Set([c])).length]));
  const band = (c: City) => Math.floor(dist(c, origin) / START_BAND);
  const starts = [...order].sort((a, b) => band(a) - band(b) || degree.get(a)! - degree.get(b)!);

  // A start that fails once may succeed later, after neighbouring batches have taken shape, so sweep until nothing changes.
  for (let found = true; found; ) {
    found = false;
    for (const start of starts) {
      if (batched.has(start) || degree.get(start) === 0) continue;
      let path = [start];
      const taken = new Set(batched).add(start);
      let sx = start.x;
      let sz = start.z;
      const ray = Math.hypot(start.x, start.z) || 1;
      /** How far a city sits to the side of the straight line from 0,0 through this batch's first city. */
      const offLine = (c: City) => Math.abs(c.x * start.z - c.z * start.x) / ray;
      const corridor = shape === 'line' && lineDeviation > 0;
      // Lower is better. Mostly "nearest to the end being extended", nudged towards the wanted shape.
      const score = (c: City, end: City) =>
        dist(c, end) +
        (shape === 'line'
          ? 0.5 * offLine(c)
          : 0.5 * dist(c, { x: sx / path.length, z: sz / path.length }));

      const extend = (): boolean => {
        let best: City | null = null;
        let bestScore = Infinity;
        let atTail = true;
        for (const [end, tail] of [[path[path.length - 1], true], [path[0], false]] as const) {
          for (const c of reachable(end, taken)) {
            if (corridor && offLine(c) > lineDeviation) continue;
            const v = score(c, end);
            if (v < bestScore || (v === bestScore && best && (c.x - best.x || c.z - best.z) < 0)) {
              best = c;
              bestScore = v;
              atTail = tail;
            }
          }
        }
        if (!best) return false;
        if (atTail) path.push(best);
        else path.unshift(best);
        taken.add(best);
        sx += best.x;
        sz += best.z;
        return true;
      };

      // When both ends are stuck, re-thread the path: if the tail can reach an earlier stop k, reversing
      // everything after k keeps every hop legal and makes stop k+1 the new tail, which may have somewhere to go.
      const rethread = (): boolean => {
        for (const flip of [false, true]) {
          const p = flip ? [...path].reverse() : path;
          const tail = p[p.length - 1];
          for (let k = p.length - 3; k >= 0; k--) {
            if (dist(tail, p[k]) > maxHop) continue;
            if (!reachable(p[k + 1], taken).some((c) => !corridor || offLine(c) <= lineDeviation)) continue;
            path = [...p.slice(0, k + 1), ...p.slice(k + 1).reverse()];
            return true;
          }
        }
        return false;
      };

      while (path.length < size) {
        if (!extend() && !(rethread() && extend())) break;
      }
      if (path.length === size) {
        for (const c of path) batched.add(c);
        batches.push(path);
        found = true;
      }
    }
  }
  return batches;
}

/** Shorten a path by untangling crossings, never creating a hop longer than maxHop, then start it at the end nearer 0,0. */
function tidyPath(path: City[], maxHop: number, origin: Point = ORIGIN): City[] {
  const p = [...path];
  for (let improved = true; improved; ) {
    improved = false;
    for (let i = 0; i < p.length - 1; i++) {
      for (let j = i + 1; j < p.length; j++) {
        // Reversing p[i..j] swaps the edges on either side of that stretch.
        const before = (i ? dist(p[i - 1], p[i]) : 0) + (j + 1 < p.length ? dist(p[j], p[j + 1]) : 0);
        const e1 = i ? dist(p[i - 1], p[j]) : 0;
        const e2 = j + 1 < p.length ? dist(p[i], p[j + 1]) : 0;
        if (e1 <= maxHop && e2 <= maxHop && e1 + e2 < before - 1e-9) {
          p.splice(i, j - i + 1, ...p.slice(i, j + 1).reverse());
          improved = true;
        }
      }
    }
  }
  return dist(p[p.length - 1], origin) < dist(p[0], origin) ? p.reverse() : p;
}

/**
 * Split cities into groups of 27: compact clusters, or lines heading outward.
 * Deterministic for a given input, so "batch 7" means the same thing for
 * everyone using the same settings.
 *
 * With maxHop set, no flight between consecutive cities in a batch is longer
 * than that (the batch as a whole can still cover more ground), every batch is
 * full, and cities that cannot be fitted into one are not returned: the caller
 * shows those as unbatched. With maxHop 0 there is no limit, every city is
 * batched, and at most one cluster is short.
 *
 * lineDeviation (lines with a maxHop only) keeps each line within that many
 * blocks either side of straight; 0 means no limit.
 *
 * origin is where the player sets out from: 0,0, or the centre of a search
 * around a position. Routes are built and numbered outward from it.
 */
export function makeBatches(
  cities: City[],
  size = BATCH_SIZE,
  shape: BatchShape = 'cluster',
  maxHop = 0,
  lineDeviation = 0,
  origin: Point = ORIGIN,
): City[][] {
  if (!cities.length) return [];
  const routed =
    maxHop > 0
      ? chains(cities, size, maxHop, shape, lineDeviation, origin).map((p) => tidyPath(p, maxHop, origin))
      : (shape === 'line' ? lines(cities, size) : split(cities, size)).map((b) => route(b, origin));
  // Number batches outward: batch 1 is the one centred closest to the origin.
  const centre = (b: City[]) =>
    Math.hypot(b.reduce((t, c) => t + c.x, 0) / b.length - origin.x, b.reduce((t, c) => t + c.z, 0) / b.length - origin.z);
  return routed
    .map((b) => ({ b, d: centre(b), key: Math.min(...b.map((c) => c.x * 1e7 + c.z)) }))
    .sort((p, q) => p.d - q.d || p.key - q.key)
    .map((e) => e.b);
}

/** Everything needed to work out the batches for a set of cities. */
export interface BatchJob {
  cities: City[];
  size: number;
  shape: BatchShape;
  maxHop: number;
  lineDeviation: number;
  /** Where routes are built and numbered outward from. 0,0 if left out. */
  origin?: Point;
}

/**
 * Batches of the wanted size, or, if not even one of those can be made, of the
 * largest size that gives at least one (down to pairs). Returns the size used.
 */
export function makeBatchesOrSmaller(job: BatchJob): { batches: City[][]; size: number } {
  const attempt = (size: number) => makeBatches(job.cities, size, job.shape, job.maxHop, job.lineDeviation, job.origin);
  const batches = attempt(job.size);
  if (batches.length || job.cities.length < 2 || job.size <= 2) return { batches, size: job.size };
  // Halve the range each time rather than stepping down one by one, which matters for large sizes.
  let [fits, tooBig] = [1, job.size];
  let best: City[][] = [];
  while (tooBig - fits > 1) {
    const size = Math.floor((fits + tooBig) / 2);
    const made = attempt(size);
    if (made.length) [fits, best] = [size, made];
    else tooBig = size;
  }
  return fits >= 2 ? { batches: best, size: fits } : { batches: [], size: job.size };
}
