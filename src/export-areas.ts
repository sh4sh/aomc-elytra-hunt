// Which part of the map to export from Xaero's World Map after flying a route, for the community
// webmap: one rectangle around the path flown, with room for what the game mapped either side of it.
//
// An export may take in ground the player never saw. That comes out black, and the webmap leaves
// whatever it already has there alone, so the rectangle does not need to be exact.

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

/**
 * Room left around the path: a little more than a player's game maps either side of them, which is the
 * server's view distance of 10 chunks and the chunk they are in. Measured from players' exports, the
 * strip is 20 to 22 chunks wide.
 */
const PAD = 176;

/** The rectangle to export for a path flown from point to point, on chunk boundaries. Null when there is no path. */
export function exportArea(path: Point[]): Area | null {
  if (!path.length) return null;
  const down = (v: number) => Math.floor(v / 16) * 16;
  return {
    x0: down(Math.min(...path.map((p) => p.x)) - PAD),
    z0: down(Math.min(...path.map((p) => p.z)) - PAD),
    x1: down(Math.max(...path.map((p) => p.x)) + PAD) + 16,
    z1: down(Math.max(...path.map((p) => p.z)) + PAD) + 16,
  };
}
