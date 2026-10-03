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
  /** Keep cities within this many degrees of a diagonal. 45 keeps everything. */
  diagonalDeg: number;
  quadrants: Quadrant[];
}

export const cityId = (c: { x: number; z: number }): string => `${c.x},${c.z}`;
