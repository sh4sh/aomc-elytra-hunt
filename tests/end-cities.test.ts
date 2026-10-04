import { describe, expect, it } from 'vitest';
import { END_CITY, candidateChunk, chunkToBlock, findEndCities } from '../src/generation/end-cities';
import { endCityHasShip, endCityShip, shipCode } from '../src/generation/end-city-pieces';
import { EndTerrain } from '../src/generation/end-terrain';
import cases from './fixtures/cubiomes-end-cities.json';
import far from './fixtures/cubiomes-far-strip.json';

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

  // The far end of the webmap's western corridor, about 600,000 blocks out. Produced by cubiomes
  // with one change: its piece "depth" tag widened from 8 bits to a full int, as the game has it.
  // (With the 8-bit tag, cubiomes reports a ship for 4 of 36,398 cities across the webmap's area
  // where this code and the widened cubiomes agree there is none.)
  it('matches the reference 600,000 blocks out', () => {
    const seed = BigInt(far.seed);
    const terrain = new EndTerrain(seed);
    const found: string[] = [];
    for (let rz = far.rz[0]; rz < far.rz[1]; rz++) {
      for (let rx = far.rx[0]; rx < far.rx[1]; rx++) {
        const [cx, cz] = candidateChunk(seed, rx, rz, END_CITY);
        if (terrain.canGenerateEndCity(cx, cz)) found.push(`${cx} ${cz} ${endCityHasShip(seed, cx, cz) ? 1 : 0}`);
      }
    }
    expect(far.cities.length).toBeGreaterThan(40);
    expect(found).toEqual(far.cities.map(([x, z, ship]) => `${x} ${z} ${ship}`));
  });

  it('follows the game, not the 8-bit shortcut, where the two differ on a ship', () => {
    for (const [cx, cz] of [[-15396, -1317], [-32937, 562], [-13233, 1403], [-19116, 1720]]) {
      expect(endCityHasShip(856461443495910397n, cx, cz)).toBe(false);
    }
  });

  // Found in game with a city but no ship (x: -554792, z: 8712), although this code and cubiomes both
  // lay it out with one. The ship sits 3 blocks above a tower top, so it is flagged as a tight fit.
  it('flags a ship that is a tight fit as uncertain', () => {
    expect(endCityShip(856461443495910397n, -34675, 544)).toEqual({ ship: true, tight: true });
    expect(shipCode(856461443495910397n, -34675, 544)).toBe(2);
    // A city with no ship is never flagged.
    expect(endCityShip(856461443495910397n, -76, 644)).toEqual({ ship: false, tight: false });
  });

  it('flags only a small share of ships', () => {
    const ships = cases[0].cities.filter(([, , ship]) => ship);
    const tight = ships.filter(([cx, cz]) => endCityShip(BigInt(cases[0].seed), cx, cz).tight).length;
    expect(tight / ships.length).toBeLessThan(0.02);
  });

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
