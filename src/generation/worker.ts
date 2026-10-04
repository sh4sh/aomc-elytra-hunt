// Runs the End City search off the main thread.
import { shipCode } from './end-city-pieces';
import { chunkToBlock, findEndCities } from './end-cities';
import { passes } from '../filters';
import { searchBounds, type Filters } from '../types';

export interface FindRequest {
  seed: string;
  filters: Filters;
}

/** Block x, block z, and the ship: 0 for none, 1 for a ship, 2 for a ship that is a tight fit and so uncertain. */
export type FoundCity = [number, number, 0 | 1 | 2];

export type FindResponse = { type: 'progress'; fraction: number } | { type: 'done'; cities: FoundCity[] };

addEventListener('message', (e: MessageEvent<FindRequest>) => {
  const { seed, filters } = e.data;
  const worldSeed = BigInt(seed);
  const chunks = findEndCities(worldSeed, {
    maxBlocks: filters.maxDist,
    bounds: searchBounds(filters),
    accept: (x, z) => passes(x, z, filters),
    onProgress: (fraction) => postMessage({ type: 'progress', fraction } satisfies FindResponse),
  });
  const cities = chunks.map(([cx, cz]): FoundCity => [
    chunkToBlock(cx),
    chunkToBlock(cz),
    shipCode(worldSeed, cx, cz),
  ]);
  postMessage({ type: 'done', cities } satisfies FindResponse);
});
