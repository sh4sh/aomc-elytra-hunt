import type { City } from './types';

const NUMBER = String.raw`(-?\d+(?:\.\d+)?)`;

/**
 * Parse typed coordinates, one position per line. Accepts labelled values in
 * any order and spacing ("x:100, z:-200", "z: -200 x: 100", "X=100 Y=64 Z=-200")
 * and bare numbers ("100,-200", "100 -200", or "100 64 -200", where the middle
 * one is y).
 */
export function parseCoordinates(text: string): City[] {
  const out: City[] = [];
  for (const line of text.split(/\r?\n/)) {
    const labelled = (axis: string) => line.match(new RegExp(String.raw`\b${axis}\s*[:=]?\s*${NUMBER}`, 'i'))?.[1];
    const [lx, lz] = [labelled('x'), labelled('z')];
    if (lx !== undefined && lz !== undefined) {
      out.push({ x: Math.round(Number(lx)), z: Math.round(Number(lz)), source: 'import' });
      continue;
    }
    const nums = line.match(new RegExp(NUMBER, 'g'))?.map(Number);
    if (!nums || nums.length < 2) continue;
    out.push({ x: Math.round(nums[0]), z: Math.round(nums[nums.length >= 3 ? 2 : 1]), source: 'import' });
  }
  return out;
}
