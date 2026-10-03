import type { City } from './types';

/**
 * Parse pasted coordinates, one position per line. Accepts "x, z", "x z",
 * "x y z", "X: 100 Z: -200" and /tp-style lines; with three numbers the middle one is y.
 */
export function parseCoordinates(text: string): City[] {
  const out: City[] = [];
  for (const line of text.split(/\r?\n/)) {
    const nums = line.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
    if (!nums || nums.length < 2) continue;
    out.push({ x: Math.round(nums[0]), z: Math.round(nums[nums.length >= 3 ? 2 : 1]), source: 'import' });
  }
  return out;
}
