// Every End City for one seed, generated ahead of time by `npm run precompute`.
// Searching within its range is then a filter instead of a computation.

import { passes } from './filters';
import { chunkToBlock } from './generation/end-cities';
import type { FoundCity } from './generation/worker';
import { searchBounds, type Filters } from './types';

export class Precomputed {
  private constructor(
    readonly seed: string,
    readonly maxBlocks: number,
    /** Flat [chunkX, chunkZ, hasShip, ...]. */
    private readonly data: number[],
  ) {}

  /** Resolves to null when no file has been generated. */
  static async load(): Promise<Precomputed | null> {
    try {
      const res = await fetch('./cities.json');
      if (!res.ok) return null;
      const f = await res.json();
      return new Precomputed(String(f.seed), f.maxBlocks, f.cities);
    } catch {
      return null;
    }
  }

  covers(seed: string, filters: Filters): boolean {
    const b = searchBounds(filters);
    return seed === this.seed && Math.max(-b.x0, b.x1, -b.z0, b.z1) <= this.maxBlocks;
  }

  search(filters: Filters): FoundCity[] {
    const out: FoundCity[] = [];
    const d = this.data;
    for (let i = 0; i < d.length; i += 3) {
      const x = chunkToBlock(d[i]);
      const z = chunkToBlock(d[i + 1]);
      if (passes(x, z, filters)) out.push([x, z, d[i + 2] ? 1 : 0]);
    }
    return out;
  }
}
