// Builds public/cities.json: every End City for the server's seed out to
// 100,000 blocks, so the app can filter instead of generating.
//
//   npm run precompute                    (default seed and distance)
//   npm run precompute -- <seed> <blocks>
//
// Rerun this if a game update changes End generation.

import { writeFileSync } from 'node:fs';
import { shipCode } from '../src/generation/end-city-pieces';
import { findEndCities } from '../src/generation/end-cities';

const seed = process.argv[2] ?? '856461443495910397';
const maxBlocks = Number(process.argv[3]) || 100000;

let shown = -1;
const chunks = findEndCities(BigInt(seed), {
  maxBlocks,
  onProgress: (f) => {
    const pct = Math.floor(f * 10) * 10;
    if (pct !== shown) console.log(`${(shown = pct)}%`);
  },
});
// Flat [chunkX, chunkZ, ship, ...] keeps the file small. Ship is 0 (none), 1 (ship) or 2 (ship, but a tight fit: uncertain).
const cities = chunks.flatMap(([cx, cz]) => [cx, cz, shipCode(BigInt(seed), cx, cz)]);
writeFileSync('public/cities.json', JSON.stringify({ seed, maxBlocks, generatedAt: new Date().toISOString(), cities }) + '\n');
console.log(`${chunks.length} cities (${cities.filter((_, i) => i % 3 === 2 && cities[i]).length} with ships). Wrote public/cities.json`);
