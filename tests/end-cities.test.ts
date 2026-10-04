import { describe, expect, it } from 'vitest';
import { END_CITY, candidateChunk, chunkToBlock, findEndCities } from '../src/generation/end-cities';
import { endCityHasShip, endCityShip, shipCode } from '../src/generation/end-city-pieces';
import { EndTerrain } from '../src/generation/end-terrain';
import cases from './fixtures/cubiomes-end-cities.json';
import far from './fixtures/cubiomes-far-strip.json';

// Fixtures were produced by cubiomes (MC 1.21 rules, built with -ffp-contract=off
// so float maths matches Java) for every region in
// [regMin, regMax) on both axes. Each entry is [chunkX, chunkZ, hasShip].
// cubiomes was built with two corrections, both of which this code has too: the piece "depth"
// tag widened to a full int, and tower bridges hung on the tower's chosen floor (see genTower).
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

  // Checked in a single-player copy of the world (and the first also on the server). cubiomes as
  // published gives every one of these a ship; the game, and this code, only the last three.
  it('agrees with the game on ships that hang from a tower bridge', () => {
    const seed = 856461443495910397n;
    const ship = (x: number, z: number) => endCityHasShip(seed, (x - 8) / 16, (z - 8) / 16);
    for (const [x, z] of [
      [-554792, 8712], [5176, -44680], [-22328, -43464], [66584, -25784],
      [-44424, 49352], [-38344, 55752], [25336, 79064], [12888, 93800],
    ]) {
      expect(ship(x, z), `x: ${x}, z: ${z}`).toBe(false);
    }
    for (const [x, z] of [[63448, -49224], [81672, 39480], [-7944, 1976]]) {
      expect(ship(x, z), `x: ${x}, z: ${z}`).toBe(true);
    }
  });

  // Both checked in game: the layout has a ship, but all of it lies more than 8 chunks from the city's start.
  it('leaves out ships the game never builds because they are too far from the city', () => {
    const seed = 856461443495910397n;
    for (const [x, z] of [[62152, 360], [-70328, -4088]]) expect(endCityHasShip(seed, (x - 8) / 16, (z - 8) / 16)).toBe(false);
    // Also checked in game: half the ship is built, but not the half with the elytra, which is 9 chunks out.
    expect(endCityHasShip(seed, (-546776 - 8) / 16, (5576 - 8) / 16)).toBe(false);
    // Looted by players: the ship is partly out of reach, but the elytra, 8 chunks out, is not.
    for (const [x, z] of [[-12712, 2952], [-17592, 3560]]) expect(endCityHasShip(seed, (x - 8) / 16, (z - 8) / 16)).toBe(true);
  });

  // Both checked in game. They turn on what a bridge's end piece hangs from when the bridge ends in a ship.
  it('hangs the end of a ship bridge from the bridge, not the ship', () => {
    const seed = 856461443495910397n;
    expect(endCityHasShip(seed, (26008 - 8) / 16, (-53384 - 8) / 16)).toBe(false);
    expect(endCityHasShip(seed, (-37752 - 8) / 16, (-26824 - 8) / 16)).toBe(true);
  });

  it('no longer marks any ship as uncertain', () => {
    expect(endCityShip(856461443495910397n, -497, 123)).toEqual({ ship: true, tight: false });
    expect(shipCode(856461443495910397n, -497, 123)).toBe(1);
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
