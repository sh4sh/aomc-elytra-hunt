import { JavaRandom } from './java-random';
import { EndTerrain } from './end-terrain';

/** Random-spread placement parameters. These are what a version change would touch. */
export interface StructurePlacement {
  salt: number;
  /** Region size in chunks. */
  spacing: number;
  /** Minimum gap between structures in chunks. */
  separation: number;
}

// Unchanged since End Cities were added to the data-driven structure system.
export const END_CITY: StructurePlacement = { salt: 10387313, spacing: 20, separation: 11 };

/** Chunk holding the End City attempt of a region. Triangular spread: two rolls averaged per axis. */
export function candidateChunk(seed: bigint, regX: number, regZ: number, p: StructurePlacement): [number, number] {
  const rng = new JavaRandom(
    seed + BigInt(regX) * 341873128712n + BigInt(regZ) * 132897987541n + BigInt(p.salt),
  );
  const range = p.spacing - p.separation;
  const x = (rng.nextInt(range) + rng.nextInt(range)) >> 1;
  const z = (rng.nextInt(range) + rng.nextInt(range)) >> 1;
  return [regX * p.spacing + x, regZ * p.spacing + z];
}

export interface FindOptions {
  /** Search out to this many blocks from the origin on each axis. */
  maxBlocks: number;
  /** Search only this square of blocks, wherever it is, instead of the square around the origin. */
  bounds?: { x0: number; x1: number; z0: number; z1: number };
  /** Cheap pre-filter on block coordinates, applied before the expensive terrain check. */
  accept?: (x: number, z: number) => boolean;
  onProgress?: (fraction: number) => void;
  placement?: StructurePlacement;
}

/** Block coordinates of a chunk's centre, which is what Chunkbase displays. */
export const chunkToBlock = (c: number): number => c * 16 + 8;

/** All End City chunk positions as [chunkX, chunkZ] pairs. */
export function findEndCities(seed: bigint, opts: FindOptions): [number, number][] {
  const p = opts.placement ?? END_CITY;
  const terrain = new EndTerrain(seed);
  const b = opts.bounds ?? { x0: -opts.maxBlocks, x1: opts.maxBlocks, z0: -opts.maxBlocks, z1: opts.maxBlocks };
  const regionBlocks = p.spacing * 16;
  // Regions overlapping the square. A region's city always lies inside that region.
  const [rx0, rx1] = [Math.floor(b.x0 / regionBlocks), Math.floor(b.x1 / regionBlocks)];
  const [rz0, rz1] = [Math.floor(b.z0 / regionBlocks), Math.floor(b.z1 / regionBlocks)];
  const out: [number, number][] = [];

  for (let regZ = rz0; regZ <= rz1; regZ++) {
    for (let regX = rx0; regX <= rx1; regX++) {
      const [cx, cz] = candidateChunk(seed, regX, regZ, p);
      const x = chunkToBlock(cx);
      const z = chunkToBlock(cz);
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      // Nothing generates on the central island.
      const bx = cx * 16;
      const bz = cz * 16;
      if (bx * bx + bz * bz < 1008 * 1008) continue;
      if (opts.accept && !opts.accept(x, z)) continue;
      if (terrain.canGenerateEndCity(cx, cz)) out.push([cx, cz]);
    }
    opts.onProgress?.((regZ - rz0 + 1) / (rz1 - rz0 + 1));
  }
  return out;
}
