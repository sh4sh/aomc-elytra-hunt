// End City layout: which pieces a city is built from, and so whether it has a
// ship (the only place elytra generate). Ported from cubiomes (finders.c, MIT licence),
// with one correction, marked below, where cubiomes and the game part ways.

import { JavaRandom } from './java-random';

const enum T {
  BASE_FLOOR, BASE_ROOF, BRIDGE_END, BRIDGE_GENTLE_STAIRS, BRIDGE_PIECE, BRIDGE_STEEP_STAIRS,
  FAT_TOWER_BASE, FAT_TOWER_MIDDLE, FAT_TOWER_TOP, SECOND_FLOOR_1, SECOND_FLOOR_2, SECOND_ROOF,
  SHIP, THIRD_FLOOR_1, THIRD_FLOOR_2, THIRD_ROOF, TOWER_BASE, TOWER_FLOOR, TOWER_PIECE, TOWER_TOP,
}

// Template sizes [x, y, z], indexed by piece type.
const SIZE: [number, number, number][] = [
  [9, 3, 9], [11, 1, 11], [4, 5, 1], [4, 6, 7], [4, 5, 3], [4, 6, 3],
  [12, 3, 12], [12, 7, 12], [16, 5, 16], [11, 7, 11], [11, 7, 11], [13, 1, 13],
  [12, 23, 28], [13, 7, 13], [13, 7, 13], [15, 1, 15], [6, 6, 6], [6, 3, 6], [6, 3, 6], [8, 4, 8],
];

interface Piece {
  type: T;
  rot: number;
  /** Pieces generated together share a random depth tag; overlapping pieces from different groups are rejected. */
  depth: number;
  x: number; y: number; z: number;
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
}

interface Env {
  list: Piece[];
  rng: JavaRandom;
  /** Set once a ship has been attempted; at most one per city. */
  ship: { tried: boolean };
  y: number;
}

type Gen = (env: Env, current: Piece, depth: number) => boolean;

function add(env: Env, prev: Piece | null, rot: number, px: number, py: number, pz: number, type: T): Piece {
  const [sx, sy, sz] = SIZE[type];
  const ox = prev ? prev.x : px;
  const oy = prev ? prev.y : py;
  const oz = prev ? prev.z : pz;
  const p: Piece = { type, rot, depth: 0, x: ox, y: oy, z: oz, x0: ox, y0: oy, z0: oz, x1: ox, y1: oy + sy, z1: oz };
  switch (rot) {
    case 0: p.x1 += sx; p.z1 += sz; break;
    case 1: p.x0 -= sz; p.z1 += sx; break;
    case 2: p.x0 -= sx; p.z0 -= sz; break;
    default: p.x1 += sz; p.z0 -= sx;
  }
  if (prev) {
    let dx = 0, dz = 0;
    switch (prev.rot) {
      case 0: dx = px; dz = pz; break;
      case 1: dx = -pz; dz = px; break;
      case 2: dx = -px; dz = -pz; break;
      default: dx = pz; dz = -px;
    }
    p.x += dx; p.y += py; p.z += dz;
    p.x0 += dx; p.y0 += py; p.z0 += dz;
    p.x1 += dx; p.y1 += py; p.z1 += dz;
  }
  env.list.push(p);
  return p;
}

function recurse(gen: Gen, env: Env, current: Piece, depth: number): boolean {
  if (depth > 8) return false;
  const local: Env = { ...env, list: [] };
  if (!gen(local, current, depth)) return false;
  const tag = env.rng.next(32);
  for (const p of local.list) {
    p.depth = tag;
    const hit = env.list.find(
      (q) => q.x1 >= p.x0 && q.x0 <= p.x1 && q.z1 >= p.z0 && q.z0 <= p.z1 && q.y1 >= p.y0 && q.y0 <= p.y1,
    );
    // Overlapping a piece from the same group as the parent is allowed; go on to check the next piece.
    if (hit && current.depth !== hit.depth) return false;
  }
  env.list.push(...local.list);
  return true;
}

const TOWER_BRIDGES = [[0, 1, -1, 0], [1, 6, -1, 1], [3, 0, -1, 5], [2, 5, -1, 6]];
const FAT_TOWER_BRIDGES = [[0, 4, -1, 0], [1, 12, -1, 4], [3, 0, -1, 8], [2, 8, -1, 12]];

const genTower: Gen = (env, current, depth) => {
  const { rng } = env;
  const rot = current.rot;
  const x = 3 + rng.nextInt(2);
  const z = 3 + rng.nextInt(2);
  let base = add(env, current, rot, x, -3, z, T.TOWER_BASE);
  base = add(env, base, rot, 0, 7, 0, T.TOWER_PIECE);
  let floor: Piece | null = rng.nextInt(3) === 0 ? base : null;
  const floors = 1 + rng.nextInt(3);
  for (let i = 0; i < floors; i++) {
    base = add(env, base, rot, 0, 4, 0, T.TOWER_PIECE);
    if (i < floors - 1 && rng.next(1)) floor = base;
  }
  if (floor) {
    for (const [r, bx, by, bz] of TOWER_BRIDGES) {
      if (!rng.next(1)) continue;
      // Bridges leave the tower at the floor chosen above, which is not always its top one. cubiomes
      // (as of e61f905) hangs them on the top piece; that puts some bridges, and the ships at their
      // ends, 4 or 8 blocks too high, clear of parts they collide with in the game. Checked in game
      // at eleven cities where the two readings disagree or might: this one matched every time.
      const bridge = add(env, floor, (rot + r) & 3, bx, by, bz, T.BRIDGE_END);
      recurse(genBridge, env, bridge, depth + 1);
    }
  } else if (depth !== 7) {
    return recurse(genFatTower, env, base, depth + 1);
  }
  add(env, base, rot, -1, 4, -1, T.TOWER_TOP);
  return true;
};

const genBridge: Gen = (env, current, depth) => {
  const { rng } = env;
  const rot = current.rot;
  const floors = 1 + rng.nextInt(4);
  let base = add(env, current, rot, 0, 0, -4, T.BRIDGE_PIECE);
  base.depth = -1;
  let y = 0;
  for (let i = 0; i < floors; i++) {
    if (rng.next(1)) {
      base = add(env, base, rot, 0, y, -4, T.BRIDGE_PIECE);
      y = 0;
      continue;
    }
    if (rng.next(1)) base = add(env, base, rot, 0, y, -4, T.BRIDGE_STEEP_STAIRS);
    else base = add(env, base, rot, 0, y, -8, T.BRIDGE_GENTLE_STAIRS);
    y = 4;
  }
  if (!env.ship.tried && rng.nextInt(10 - depth) === 0) {
    const x = -8 + rng.nextInt(8);
    const z = -70 + rng.nextInt(10);
    base = add(env, base, rot, x, y, z, T.SHIP);
    // Stays set even if this bridge is later rejected for overlapping, so a city can end up with no ship.
    env.ship.tried = true;
  } else {
    env.y = y + 1;
    if (!recurse(genHouseTower, env, base, depth + 1)) return false;
  }
  base = add(env, base, (rot + 2) & 3, 4, y, 0, T.BRIDGE_END);
  base.depth = -1;
  return true;
};

const genHouseTower: Gen = (env, current, depth) => {
  if (depth > 8) return false;
  const rot = current.rot;
  let base = add(env, current, rot, -3, env.y, -11, T.BASE_FLOOR);
  const size = env.rng.nextInt(3);
  if (size === 0) {
    add(env, base, rot, -1, 4, -1, T.BASE_ROOF);
    return true;
  }
  base = add(env, base, rot, -1, 0, -1, T.SECOND_FLOOR_2);
  if (size === 1) {
    base = add(env, base, rot, -1, 8, -1, T.SECOND_ROOF);
  } else {
    base = add(env, base, rot, -1, 4, -1, T.THIRD_FLOOR_2);
    base = add(env, base, rot, -1, 8, -1, T.THIRD_ROOF);
  }
  recurse(genTower, env, base, depth + 1);
  return true;
};

const genFatTower: Gen = (env, current, depth) => {
  const { rng } = env;
  const rot = current.rot;
  let base = add(env, current, rot, -3, 4, -3, T.FAT_TOWER_BASE);
  base = add(env, base, rot, 0, 4, 0, T.FAT_TOWER_MIDDLE);
  for (let j = 0; j < 2 && rng.nextInt(3) !== 0; j++) {
    base = add(env, base, rot, 0, 8, 0, T.FAT_TOWER_MIDDLE);
    for (const [r, bx, by, bz] of FAT_TOWER_BRIDGES) {
      if (!rng.next(1)) continue;
      const bridge = add(env, base, (rot + r) & 3, bx, by, bz, T.BRIDGE_END);
      recurse(genBridge, env, bridge, depth + 1);
    }
  }
  add(env, base, rot, -2, 8, -2, T.FAT_TOWER_TOP);
  return true;
};

/** Random source for structure generation in a chunk. Its first roll is the structure's rotation. */
export function chunkRandom(worldSeed: bigint, chunkX: number, chunkZ: number): JavaRandom {
  const rng = new JavaRandom(worldSeed);
  const a = rng.nextLong();
  const b = rng.nextLong();
  return new JavaRandom(BigInt.asIntN(64, (a * BigInt(chunkX)) ^ (b * BigInt(chunkZ)) ^ worldSeed));
}

/**
 * The game builds no part of a structure more than this many chunks from the chunk it starts in. A
 * ship at the end of a long run of bridges can lie beyond that: it is then cut off, or missing
 * altogether. Checked in game: two ships wholly out of reach were not there, and one with its elytra
 * a single chunk out of reach was cut in half, without the elytra.
 */
const STRUCTURE_REACH_CHUNKS = 8;

/**
 * Whether the End City starting in this chunk has a ship with its elytra in reach. `tight` is always false now: it once marked
 * ships that sat close to another part of the city as uncertain, before the real cause of a missing
 * ship was found (see genTower). Kept so saved data and callers that read it still work.
 */
export function endCityShip(worldSeed: bigint, chunkX: number, chunkZ: number): { ship: boolean; tight: boolean } {
  const rng = chunkRandom(worldSeed, chunkX, chunkZ);
  const rot = rng.nextInt(4);
  const env: Env = { list: [], rng, ship: { tried: false }, y: 0 };
  let base = add(env, null, rot, chunkX * 16 + 8, 0, chunkZ * 16 + 8, T.BASE_FLOOR);
  base = add(env, base, rot, -1, 0, -1, T.SECOND_FLOOR_1);
  base = add(env, base, rot, -1, 4, -1, T.THIRD_FLOOR_1);
  base = add(env, base, rot, -1, 8, -1, T.THIRD_ROOF);
  recurse(genTower, env, base, 1);
  const ship = env.list.find((p) => p.type === T.SHIP);
  if (!ship) return { ship: false, tight: false };
  // The elytra hangs in a frame at 6, 5, 7 in the ship's template, turned with the ship.
  const [dx, dz] = [[6, 7], [-7, 6], [-6, -7], [7, -6]][ship.rot];
  const far = Math.max(Math.abs(((ship.x + dx) >> 4) - chunkX), Math.abs(((ship.z + dz) >> 4) - chunkZ));
  return { ship: far <= STRUCTURE_REACH_CHUNKS, tight: false };
}

/** Whether the End City starting in this chunk includes a ship. */
export function endCityHasShip(worldSeed: bigint, chunkX: number, chunkZ: number): boolean {
  return endCityShip(worldSeed, chunkX, chunkZ).ship;
}

/** The ship as one number, as stored with each city: 0 for none, 1 for a ship, 2 for a tight-fitting (uncertain) ship. */
export function shipCode(worldSeed: bigint, chunkX: number, chunkZ: number): 0 | 1 | 2 {
  const { ship, tight } = endCityShip(worldSeed, chunkX, chunkZ);
  return !ship ? 0 : tight ? 2 : 1;
}
