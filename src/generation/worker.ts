// Runs the End City search off the main thread.
import { endCityHasShip } from './end-city-pieces';
import { chunkToBlock, findEndCities } from './end-cities';
import { passes } from '../filters';
import { searchBounds, type Filters } from '../types';

export interface FindRequest {
  seed: string;
  filters: Filters;
}

/** Block x, block z, and 1 if the city has a ship. */
export type FoundCity = [number, number, 0 | 1];

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
    endCityHasShip(worldSeed, cx, cz) ? 1 : 0,
  ]);
  postMessage({ type: 'done', cities } satisfies FindResponse);
});
