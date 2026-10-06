// Which parts of the map to export from Xaero's World Map after flying a route, for the community
// webmap.
//
// An export is a rectangle, and everything in it that the player has not explored comes out black.
// Uploaded, that black replaces whatever the webmap had there. So a rectangle is only safe if all the
// terrain the webmap already shows inside it lies along the player's own path, where their export has
// fresh terrain to put in its place. The path is cut into as few rectangles as that allows; a stretch
// that cannot be made safe (it crosses someone else's trail) is left out.

interface Point {
  x: number;
  z: number;
}

/** A rectangle of the world, in blocks. */
export interface Area {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Where the webmap already has terrain. `visit` is called for each mapped spot in the area until it returns true. */
export interface MappedLookup {
  eachMapped(area: Area, visit: (x: number, z: number) => boolean | void): void;
}

/**
 * How far either side of their path a player's game maps: the server's view distance of 10 chunks,
 * and the chunk they are in. Measured from players' exports, the strip is 20 to 22 chunks wide.
 */
export const EXPLORED_EACH_SIDE = 168;
/** Room left around the path in an export, a little more than is explored, so none of it is cut off. */
const PAD = 176;
/** Terrain within this distance of the path is taken to be covered by the player's own export. A little less than is explored, to be safe. */
const COVERED = 144;
/** The longest side an export may have, in blocks. Xaero splits an export into 1,024-block images, so this is 16 of them. */
const MAX_SIDE = 16384;
/** A stretch of path shorter than this is not cut any further: if it is still unsafe, it is left out. */
const SHORTEST = 256;

type Segment = [Point, Point];

const distance = (p: Point, [a, b]: Segment): number => {
  const [dx, dz] = [b.x - a.x, b.z - a.z];
  const along = dx || dz ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz))) : 0;
  return Math.hypot(p.x - (a.x + along * dx), p.z - (a.z + along * dz));
};

/** The rectangle around some stretches of path, with room either side, on chunk boundaries. */
function around(segments: Segment[]): Area {
  const points = segments.flat();
  const out = (v: number) => Math.floor(v / 16) * 16;
  return {
    x0: out(Math.min(...points.map((p) => p.x)) - PAD),
    z0: out(Math.min(...points.map((p) => p.z)) - PAD),
    x1: out(Math.max(...points.map((p) => p.x)) + PAD) + 16,
    z1: out(Math.max(...points.map((p) => p.z)) + PAD) + 16,
  };
}

/**
 * The rectangles to export for a path flown from point to point, in order, and how many blocks of
 * the path had to be left out. With no record of the webmap, the whole path is taken as safe.
 */
export function exportAreas(path: Point[], mapped: MappedLookup | null): { areas: Area[]; leftOut: number } {
  if (!path.length) return { areas: [], leftOut: 0 };
  /** Whether exporting the rectangle around these stretches would blank out terrain the webmap has. */
  const unsafe = (segments: Segment[]): boolean => {
    if (!mapped) return false;
    let hit = false;
    mapped.eachMapped(around(segments), (x, z) => (hit = segments.every((s) => distance({ x, z }, s) > COVERED)));
    return hit;
  };

  // Cut each leg of the path down until every piece is safe on its own.
  let leftOut = 0;
  const pieces: Segment[] = [];
  const cut = (s: Segment): void => {
    if (!unsafe([s])) {
      pieces.push(s);
      return;
    }
    const length = Math.hypot(s[1].x - s[0].x, s[1].z - s[0].z);
    if (length <= SHORTEST) {
      leftOut += length;
      return;
    }
    const mid = { x: (s[0].x + s[1].x) / 2, z: (s[0].z + s[1].z) / 2 };
    cut([s[0], mid]);
    cut([mid, s[1]]);
  };
  if (path.length === 1) cut([path[0], path[0]]);
  for (let k = 1; k < path.length; k++) cut([path[k - 1], path[k]]);

  // Then join neighbouring pieces into one rectangle for as long as the whole stays safe and not too big.
  const areas: Area[] = [];
  let group: Segment[] = [];
  for (const piece of pieces) {
    const joined = [...group, piece];
    const box = around(joined);
    if (group.length && (box.x1 - box.x0 > MAX_SIDE || box.z1 - box.z0 > MAX_SIDE || unsafe(joined))) {
      areas.push(around(group));
      group = [piece];
    } else {
      group = joined;
    }
  }
  if (group.length) areas.push(around(group));
  return { areas, leftOut: Math.round(leftOut) };
}
