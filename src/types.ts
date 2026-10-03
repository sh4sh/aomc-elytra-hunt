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
}

export const cityId = (c: { x: number; z: number }): string => `${c.x},${c.z}`;
