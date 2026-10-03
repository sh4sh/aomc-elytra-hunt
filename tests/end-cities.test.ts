import { describe, expect, it } from 'vitest';
import { END_CITY, candidateChunk, chunkToBlock, findEndCities } from '../src/generation/end-cities';
import { endCityHasShip } from '../src/generation/end-city-pieces';
import { EndTerrain } from '../src/generation/end-terrain';
import cases from './fixtures/cubiomes-end-cities.json';

// Fixtures were produced by cubiomes (MC 1.21 rules, built with -ffp-contract=off
// so float maths matches Java) for every region in
// [regMin, regMax) on both axes. Each entry is [chunkX, chunkZ, hasShip].
describe('End City positions and ships match cubiomes', () => {
  for (const c of cases) {
    it(`seed ${c.seed}, regions ${c.regMin}..${c.regMax}`, () => {
      const seed = BigInt(c.seed);
      const terrain = new EndTerrain(seed);
      const found: string[] = [];
      for (let rz = c.regMin; rz < c.regMax; rz++) {
        for (let rx = c.regMin; rx < c.regMax; rx++) {
          const [cx, cz] = candidateChunk(seed, rx, rz, END_CITY);
          if ((cx * 16) ** 2 + (cz * 16) ** 2 < 1008 ** 2) continue;
          if (terrain.canGenerateEndCity(cx, cz)) found.push(`${cx} ${cz} ${endCityHasShip(seed, cx, cz) ? 1 : 0}`);
        }
      }
      expect(found).toEqual(c.cities.map(([x, z, ship]) => `${x} ${z} ${ship}`));
    }, 120_000);
  }

  it('finds the same cities when asked for just one square of the map', () => {
    const c = cases[0];
    const bounds = { x0: 4000, x1: 9000, z0: -12000, z1: -6000 };
    const inside = ([cx, cz]: number[]) => {
      const [x, z] = [chunkToBlock(cx), chunkToBlock(cz)];
      return x >= bounds.x0 && x <= bounds.x1 && z >= bounds.z0 && z <= bounds.z1;
    };
    const expected = c.cities.filter(inside).map(([x, z]) => `${x} ${z}`).sort();
    const found = findEndCities(BigInt(c.seed), { maxBlocks: 0, bounds }).map(([x, z]) => `${x} ${z}`).sort();
    expect(expected.length).toBeGreaterThan(20);
    expect(found).toEqual(expected);
  });

  // Checked in game: there is a city at -1208, 10312 on this seed, and it has no ship.
  it('reports no ship for a city seen without one', () => {
    expect(endCityHasShip(856461443495910397n, -76, 644)).toBe(false);
  });
});
