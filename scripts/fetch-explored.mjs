// Builds public/explored.json: the End areas players have already mapped,
// read from the community webmap's tiles.
//
//   npm run explored
//
// The webmap sends no CORS headers, so the browser can't read its tiles
// directly; this runs in Node and the app loads the result from its own origin.
//
// Tiles are 512px PNGs named by level of detail and the block coordinates of
// their corner: at level n one pixel is 2^n blocks. The coarsest level (9) is
// scanned first to find where there is anything at all, then only those areas
// are fetched at level 5 (32 blocks per pixel).

import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const TILE_PX = 512;
const COARSE = 9;
const FINE = 5;
/** How far out to look, in coarse tiles each way (4 x 262,144 blocks). */
const COARSE_REACH = 4;
// Unmapped pixels are pure black; mapped void is a dark purple (10, 0, 23).
const MAPPED_MIN = 4;

const tileBlocks = (lod) => TILE_PX * 2 ** lod;

async function fetchTile(lod, x, z) {
  const res = await fetch(`https://a.map.diorite.xyz/map/the_end/${lod}/${x}_${z}.png`);
  if (res.status === 404) return null; // Nobody has mapped anything in this tile.
  if (!res.ok) throw new Error(`Tile ${lod}/${x}_${z}: HTTP ${res.status}`);
  const tile = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
  if (tile.width !== TILE_PX || tile.height !== TILE_PX) throw new Error(`Tile ${lod}/${x}_${z}: unexpected size`);
  return tile;
}

const brightness = (tile, x, y) => {
  const i = (y * TILE_PX + x) * 4;
  return Math.max(tile.data[i], tile.data[i + 1], tile.data[i + 2]);
};

// Pass 1: which fine tiles contain anything.
const fineTiles = new Set();
const fineSize = tileBlocks(FINE);
for (let tz = -COARSE_REACH; tz < COARSE_REACH; tz++) {
  for (let tx = -COARSE_REACH; tx < COARSE_REACH; tx++) {
    const ox = tx * tileBlocks(COARSE);
    const oz = tz * tileBlocks(COARSE);
    const tile = await fetchTile(COARSE, ox, oz);
    if (!tile) continue;
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        // Thin trails fade when scaled down, so any non-black pixel counts here.
        if (brightness(tile, x, y) === 0) continue;
        const bx = ox + x * 2 ** COARSE;
        const bz = oz + y * 2 ** COARSE;
        fineTiles.add(`${Math.floor(bx / fineSize) * fineSize},${Math.floor(bz / fineSize) * fineSize}`);
      }
    }
  }
}
console.log(`${fineTiles.size} areas to fetch in detail`);

// Pass 2: mapped pixels as runs per row. Pixel coordinates are block / 32, so they can be negative.
const rows = new Map();
const bpp = 2 ** FINE;
let mapped = 0;
let done = 0;
const queue = [...fineTiles];
async function work() {
  for (let key; (key = queue.pop()); ) {
    const [ox, oz] = key.split(',').map(Number);
    const tile = await fetchTile(FINE, ox, oz);
    if (++done % 25 === 0) console.log(`${done}/${fineTiles.size}`);
    if (!tile) continue;
    for (let y = 0; y < TILE_PX; y++) {
      let start = -1;
      for (let x = 0; x <= TILE_PX; x++) {
        const on = x < TILE_PX && brightness(tile, x, y) >= MAPPED_MIN;
        if (on && start < 0) start = x;
        if (!on && start >= 0) {
          const pz = oz / bpp + y;
          if (!rows.has(pz)) rows.set(pz, []);
          rows.get(pz).push([ox / bpp + start, x - start]);
          mapped += x - start;
          start = -1;
        }
      }
    }
  }
}
await Promise.all([work(), work(), work(), work()]);

// Flat [row, runCount, start, length, start, length, ...], rows and runs sorted, touching runs merged.
const flat = [];
let x0 = Infinity, x1 = -Infinity;
const sortedRows = [...rows.keys()].sort((a, b) => a - b);
for (const pz of sortedRows) {
  const runs = rows.get(pz).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, l] of runs) {
    const last = merged[merged.length - 1];
    if (last && last[0] + last[1] === s) last[1] += l;
    else merged.push([s, l]);
  }
  flat.push(pz, merged.length, ...merged.flat());
  x0 = Math.min(x0, merged[0][0]);
  x1 = Math.max(x1, merged[merged.length - 1][0] + merged[merged.length - 1][1]);
}
const bounds = sortedRows.length
  ? { x0: x0 * bpp, z0: sortedRows[0] * bpp, x1: x1 * bpp, z1: (sortedRows[sortedRows.length - 1] + 1) * bpp }
  : null;

writeFileSync(
  'public/explored.json',
  JSON.stringify({ blocksPerPixel: bpp, fetchedAt: new Date().toISOString(), bounds, runs: flat }) + '\n',
);
const km2 = ((mapped * bpp * bpp) / 1e6).toFixed(0);
console.log(`Mapped: about ${km2} million square blocks, spanning x ${bounds?.x0}..${bounds?.x1}, z ${bounds?.z0}..${bounds?.z1}.`);
console.log('Wrote public/explored.json');
