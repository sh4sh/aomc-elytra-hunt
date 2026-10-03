export interface City {
  /** Block coordinates (chunk centre). */
  x: number;
  z: number;
  /** Where the position came from: computed from the seed, or pasted in. */
  source: 'seed' | 'import';
}

export type Quadrant = 'NE' | 'NW' | 'SE' | 'SW';

export interface Filters {
  /** Minimum distance on the larger axis: max(|x|, |z|). */
  minDist: number;
  maxDist: number;
  /** Keep cities within this many degrees of the chosen lines. 45 keeps everything. */
  diagonalDeg: number;
  /** Which lines the angle is measured from: the four diagonals (the default) or the four axes. */
  angleFrom?: 'diagonal' | 'axis';
  quadrants: Quadrant[];
  /**
   * Search a circle around a position instead of a band around 0,0. When set, the
   * distances, angle and quadrants above are not used.
   */
  around?: { x: number; z: number; radius: number };
}

/** The square of blocks a search can find cities in. */
export function searchBounds(f: Filters): { x0: number; x1: number; z0: number; z1: number } {
  if (f.around) {
    const { x, z, radius } = f.around;
    return { x0: x - radius, x1: x + radius, z0: z - radius, z1: z + radius };
  }
  return { x0: -f.maxDist, x1: f.maxDist, z0: -f.maxDist, z1: f.maxDist };
}

export const cityId = (c: { x: number; z: number }): string => `${c.x},${c.z}`;
