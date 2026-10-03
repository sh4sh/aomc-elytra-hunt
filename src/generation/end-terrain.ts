// End terrain: island placement, biome and surface height, as far as End City
// placement needs them. Ported from cubiomes (biomenoise.c / finders.c, MIT licence).

import { chunkRandom } from './end-city-pieces';
import { JavaRandom } from './java-random';
import { PerlinNoise, lerp } from './noise';

const ISLAND_THRESHOLD = Math.fround(-0.9);
const f = Math.fround;

// Noise cells (8 blocks wide, 4 blocks tall) sampled for the surface search.
// An End City needs ground at y >= 60, so only cells 15..18 (y 60..72) matter.
const Y0 = 15;
const Y1 = 18;
const YN = Y1 - Y0 + 1;
// Terrain fades out towards the top of the world: clamped (32 + 46 - y) / 64.
const UPPER_DROP = [63 / 64, 62 / 64, 61 / 64, 60 / 64];

// Window of cached island sizes around the chunk being examined.
const WIN = 30;
const WIN_PAD = 14;

function lerp3(
  dx: number, dy: number, dz: number,
  v000: number, v100: number, v010: number, v110: number,
  v001: number, v101: number, v011: number, v111: number,
): number {
  const a = lerp(dy, lerp(dx, v000, v100), lerp(dx, v010, v110));
  const b = lerp(dy, lerp(dx, v001, v101), lerp(dx, v011, v111));
  return lerp(dz, a, b);
}

function surfaceHeight(
  c00: Float64Array, c01: Float64Array, c10: Float64Array, c11: Float64Array,
  dx: number, dz: number,
): number {
  for (let celly = Y1 - 1; celly >= Y0; celly--) {
    const i = celly - Y0;
    for (let y = 3; y >= 0; y--) {
      const noise = lerp3(
        y / 4, dx, dz,
        c00[i], c00[i + 1], c10[i], c10[i + 1],
        c01[i], c01[i + 1], c11[i], c11[i + 1],
      );
      if (noise > 0) return celly * 4 + y;
    }
  }
  return 0;
}

export class EndTerrain {
  private readonly islands: PerlinNoise;
  private readonly octMin: PerlinNoise[] = [];
  private readonly octMax: PerlinNoise[] = [];
  private readonly octMain: PerlinNoise[] = [];
  private readonly win = new Uint8Array(WIN * WIN);
  private winX = 0;
  private winZ = 0;
  private winValid = false;

  constructor(private readonly worldSeed: bigint) {
    const islandRng = new JavaRandom(worldSeed);
    islandRng.skip(17292);
    this.islands = new PerlinNoise(islandRng);

    const rng = new JavaRandom(worldSeed);
    for (let i = 0; i < 16; i++) this.octMin.push(new PerlinNoise(rng));
    for (let i = 0; i < 16; i++) this.octMax.push(new PerlinNoise(rng));
    for (let i = 0; i < 8; i++) this.octMain.push(new PerlinNoise(rng));
  }

  /** Size factor (9..21) of the outer island centred on this chunk, or 0 if there is none. */
  private computeIsland(rx: number, rz: number): number {
    if (rx * rx + rz * rz <= 4096) return 0;
    if (!(this.islands.simplex2D(rx, rz) < ISLAND_THRESHOLD)) return 0;
    // The game does this in 32-bit floats, which loses precision far from the origin.
    const v = f(f(f(Math.abs(rx)) * 3439) + f(f(Math.abs(rz)) * 147));
    return (v % 13) + 9;
  }

  private setWindow(chunkX: number, chunkZ: number): void {
    this.winX = chunkX - WIN_PAD;
    this.winZ = chunkZ - WIN_PAD;
    for (let j = 0; j < WIN; j++) {
      for (let i = 0; i < WIN; i++) {
        this.win[j * WIN + i] = this.computeIsland(this.winX + i, this.winZ + j);
      }
    }
    this.winValid = true;
  }

  private island(rx: number, rz: number): number {
    const i = rx - this.winX;
    const j = rz - this.winZ;
    if (this.winValid && i >= 0 && i < WIN && j >= 0 && j < WIN) return this.win[j * WIN + i];
    return this.computeIsland(rx, rz);
  }

  /** Squared "distance" to the nearest island, in half-chunk coordinates. Height is 100 - sqrt(this). */
  private heightSq(x: number, z: number): number {
    const hx = Math.trunc(x / 2);
    const hz = Math.trunc(z / 2);
    const oddx = x % 2;
    const oddz = z % 2;
    let h = 64 * (x * x + z * z);
    for (let j = -12; j <= 12; j++) {
      for (let i = -12; i <= 12; i++) {
        const v = this.island(hx + i, hz + j);
        if (v) {
          const rx = oddx - i * 2;
          const rz = oddz - j * 2;
          const n = (rx * rx + rz * rz) * v * v;
          if (n < h) h = n;
        }
      }
    }
    return h;
  }

  private heightNoise(x: number, z: number): number {
    const ret = f(100 - f(Math.sqrt(f(this.heightSq(x, z)))));
    return ret < -100 ? -100 : ret > 80 ? 80 : ret;
  }

  private surfaceNoise(x: number, y: number, z: number, noiseMin: number, noiseMax: number): number {
    const xzScale = 684.412 * 2.0;
    const yScale = 684.412;
    let vmin = 0;
    let vmax = 0;
    let persist = 1.0 / 32768.0;
    let amp = 64.0;

    for (let i = 15; i >= 0; i--) {
      const dx = x * xzScale * persist;
      const dz = z * xzScale * persist;
      const sy = yScale * persist;
      const dy = y * sy;
      vmin += this.octMin[i].sample(dx, dy, dz, sy, dy) * amp;
      vmax += this.octMax[i].sample(dx, dy, dz, sy, dy) * amp;
      if (vmin - amp > noiseMax && vmax - amp > noiseMax) return noiseMax;
      if (vmin + amp < noiseMin && vmax + amp < noiseMin) return noiseMin;
      amp *= 0.5;
      persist *= 2.0;
    }

    const xzStep = xzScale / 80;
    const yStep = yScale / 160;
    let vmain = 0.5;
    persist = 1.0 / 128.0;
    amp = 0.05 * 128.0;

    for (let i = 7; i >= 0; i--) {
      const dx = x * xzStep * persist;
      const dz = z * xzStep * persist;
      const sy = yStep * persist;
      const dy = y * sy;
      vmain += this.octMain[i].sample(dx, dy, dz, sy, dy) * amp;
      if (vmain - amp > 1) return vmax;
      if (vmain + amp < 0) return vmin;
      amp *= 0.5;
      persist *= 2.0;
    }

    if (vmain <= 0) return vmin;
    if (vmain >= 1) return vmax;
    return lerp(vmain, vmin, vmax);
  }

  private noiseColumn(x: number, z: number): Float64Array {
    const col = new Float64Array(YN);
    // The game's 32-bit overflow here is what produces the rings of void far out.
    if (((x * x + z * z) | 0) < 0) return col.fill(NaN);
    const depth = f(this.heightNoise(x, z) - 8.0);
    for (let y = Y0; y <= Y1; y++) {
      const noise = this.surfaceNoise(x, y, z, -128, 128);
      col[y - Y0] = lerp(1.0, -30, lerp(UPPER_DROP[y - Y0], -3000, noise + depth));
    }
    return col;
  }

  /** End Cities only start in end_midlands or end_highlands. */
  private isCityBiome(chunkX: number, chunkZ: number): boolean {
    if (chunkX * chunkX + chunkZ * chunkZ <= 4096) return false;
    const hx = 2 * chunkX + 1;
    const hz = 2 * chunkZ + 1;
    if (((hx * hx + hz * hz) | 0) < 0) return false;
    return this.heightSq(hx, hz) <= 10000;
  }

  /**
   * Lowest ground height under the city's 5x5 footprint check, which the game
   * requires to be >= 60. The footprint depends on the structure's rotation.
   */
  private cityGroundHeight(chunkX: number, chunkZ: number): number {
    const cellx = chunkX * 2;
    const cellz = chunkZ * 2;
    const cols: (Float64Array | undefined)[] = new Array(9);
    const col = (i: number, j: number) => (cols[i * 3 + j] ??= this.noiseColumn(cellx + i, cellz + j));
    // Height of the block at offset (bx, bz) from the chunk corner, within cell (i, j).
    const H = (i: number, j: number, bx: number, bz: number) =>
      surfaceHeight(col(i, j), col(i, j + 1), col(i + 1, j), col(i + 1, j + 1), (bx & 7) / 8, (bz & 7) / 8);

    const rotation = chunkRandom(this.worldSeed, chunkX, chunkZ).nextInt(4);

    const h00 = H(0, 0, 7, 7);
    let h01: number, h10: number, h11: number;
    switch (rotation) {
      case 0:
        h01 = H(0, 1, 7, 12);
        h10 = H(1, 0, 12, 7);
        h11 = H(1, 1, 12, 12);
        break;
      case 1:
        h01 = H(0, 1, 7, 12);
        h10 = H(0, 0, 2, 7);
        h11 = H(0, 1, 2, 12);
        break;
      case 2:
        h01 = H(0, 0, 7, 2);
        h10 = H(0, 0, 2, 7);
        h11 = H(0, 0, 2, 2);
        break;
      default:
        h01 = H(0, 0, 7, 2);
        h10 = H(1, 0, 12, 7);
        h11 = H(1, 0, 12, 2);
    }
    return Math.min(h00, h01, h10, h11);
  }

  canGenerateEndCity(chunkX: number, chunkZ: number): boolean {
    this.setWindow(chunkX, chunkZ);
    return this.isCityBiome(chunkX, chunkZ) && this.cityGroundHeight(chunkX, chunkZ) >= 60;
  }
}
