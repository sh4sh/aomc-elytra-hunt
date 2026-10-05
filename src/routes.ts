// The routes: how they are worked out from the search, which ships are possibly looted, and the changes a
// player makes to routes by hand (with undo and redo).

import { BATCH_IN_PLACE_LIMIT, BEYOND_LIVE_BLOCKS, EXTRA_NOTE, MAPPED_NOTE, NEAR_SPAWN_NOTE, POSSIBLE_NOTE, POSSIBLE_RADIUS, REMOVED_NOTE } from './constants';
import { $, fmt } from './dom';
import { Explored } from './explored';
import { type BatchJob, makeBatchesOrSmaller, passes, route } from './filters';
import { candidateChunk, chunkToBlock, END_CITY, findEndCities } from './generation/end-cities';
import { endCityHasShip, shipCode } from './generation/end-city-pieces';
import { EndTerrain } from './generation/end-terrain';
import type { FoundCity } from './generation/worker';
import { rebuildKeeping } from './map-actions';
import { render, reopen } from './render';
import { session } from './session';
import { DEFAULT_SEED, type RouteEdit, save, state } from './state';
import { NEAR_SPAWN_BLOCKS } from './survey';
import { describeTrajectory, onTrajectory, studyTrajectories, type Trajectory } from './trajectory';
import { type City, cityId, type Filters, searchBounds } from './types';
import { batchColor, setBatchTags, XAERO_COLORS } from './xaero';

export const lootedCities = (): City[] =>
  session.tracker.all().map((id) => {
    const [x, z] = id.split(',').map(Number);
    return { x, z, source: 'seed' as const };
  });

/**
 * Find every ship city in terrain the webmap shows, however far out. Only the regions that contain
 * mapped terrain are examined, in small slices so the page stays responsive.
 */
export async function findWebmapCities(mask: Explored): Promise<City[]> {
  const seed = BigInt(DEFAULT_SEED);
  const terrain = new EndTerrain(seed);
  const out: City[] = [];
  const regions = mask.regions(END_CITY.spacing * 16);
  for (let i = 0; i < regions.length; i++) {
    if (i % 250 === 249) await new Promise((r) => setTimeout(r));
    const [cx, cz] = candidateChunk(seed, regions[i][0], regions[i][1], END_CITY);
    const [x, z] = [chunkToBlock(cx), chunkToBlock(cz)];
    if (!mask.isMapped(x, z)) continue;
    // Nothing generates on the central island.
    if ((cx * 16) ** 2 + (cz * 16) ** 2 < 1008 ** 2) continue;
    if (terrain.canGenerateEndCity(cx, cz) && endCityHasShip(seed, cx, cz)) out.push({ x, z, source: 'seed' });
  }
  return out;
}
/** What the map and tooltips say about a city reported missing. */
const MISSING_NOTE = { missing: 'End Ship reported missing', 'no-city': 'End City reported missing' };

export function earlierStudy(): { paths: Trajectory[]; near: string[] } {
  if (session.pathsFor?.tracker !== session.tracker || session.pathsFor.version !== session.tracker.version || session.pathsFor.mapped !== session.webmapShips) {
    const point = (id: string) => {
      const [x, z] = id.split(',').map(Number);
      return { x, z };
    };
    const already = session.tracker.alreadyAll().map(point);
    // Cities looted the ordinary way had their elytra, so no earlier hunter took it.
    const intact = session.tracker.all().map(point).filter((p) => !session.tracker.isAlready(p));
    // A webmap city the player has marked themselves is counted by that mark, not twice.
    const mapped = session.webmapShips.filter((c) => !session.tracker.has(c));
    session.pathsFor = { tracker: session.tracker, version: session.tracker.version, mapped: session.webmapShips, ...studyTrajectories(already, intact, mapped) };
  }
  return session.pathsFor;
}
export const earlierPaths = (): Trajectory[] => earlierStudy().paths;

/** Why a city that nobody has marked looted may be looted all the same, or null if there is no sign of it. */
export function possibleNote(c: City): string | null {
  if (session.tracker.has(c)) return null;
  const path = earlierPaths().find((t) => onTrajectory(t, c));
  if (path) return `possibly looted: on a possible earlier flight path (${describeTrajectory(path)})`;
  if (session.tracker.nearAlready(c, POSSIBLE_RADIUS)) return POSSIBLE_NOTE;
  // Close to End Spawn on the server, most ships were emptied long ago by players nobody has a record of.
  if (state.seed === DEFAULT_SEED && Math.max(Math.abs(c.x), Math.abs(c.z)) < NEAR_SPAWN_BLOCKS) return NEAR_SPAWN_NOTE;
  return null;
}
export const possible = (c: City): boolean => possibleNote(c) !== null;

export const isCustom = (i: number) => i >= session.generatedCount;
/** Display name of a batch, which players see as a route: "Route 12", or "Custom 1" for one they made. */
export const batchTitle = (i: number) => (isCustom(i) ? `Custom ${i - session.generatedCount + 1}` : `Route ${i + 1}`);
export const pushEdit = (e: RouteEdit) => {
  state.edits = [...(state.edits ?? []), e].slice(-100);
  // A fresh change leaves nothing to redo.
  state.redo = [];
};
/** Call just before changing the looted marks of these cities, so the change can be taken back. */
export function recordMarks(cities: { x: number; z: number }[]): void {
  pushEdit({ kind: 'marks', before: cities.map((c) => [cityId(c), session.tracker.isAlready(c) ? 2 : session.tracker.has(c) ? 1 : 0]) });
  save();
}

/** The cities in the order the ids give; any not among them keep their order, at the end. */
function inOrder(batch: City[], ids: string[]): City[] {
  const at = new Map(ids.map((id, k) => [id, k]));
  return [...batch].sort((p, q) => (at.get(cityId(p)) ?? Infinity) - (at.get(cityId(q)) ?? Infinity) || batch.indexOf(p) - batch.indexOf(q));
}

/** What a route's hand-made order is saved under: for a generated route, a city that belongs to it of its own accord. */
export function orderKey(i: number): string | null {
  if (isCustom(i)) return `custom:${i - session.generatedCount}`;
  const own = session.batches[i].map(cityId).filter((id) => !(id in state.moved));
  return own.find((id) => state.orders?.[id]) ?? own[0] ?? null;
}

/** Give route i a new order, or with null return it to the order it was worked out in. */
export function writeOrder(i: number, key: string, ids: string[] | null): void {
  if (isCustom(i)) {
    const k = i - session.generatedCount;
    // Cities of the custom route that are not on show just now keep their place at the end.
    if (ids) state.custom[k] = [...ids, ...state.custom[k].filter((id) => !ids.includes(id))];
  } else if (ids) (state.orders ??= {})[key] = ids;
  else delete state.orders?.[key];
  save();
  if (!ids) return rebuildKeeping(key);
  session.batches[i] = inOrder(session.batches[i], ids);
  render();
}

/** Move the city at one place in the open route to another. */
export function moveCity(i: number, from: number, to: number): void {
  const key = orderKey(i);
  if (!key || from === to || to < 0 || to >= session.batches[i].length) return;
  const ids = session.batches[i].map(cityId);
  pushEdit({ kind: 'order', key, before: isCustom(i) ? [...state.custom[i - session.generatedCount]] : (state.orders?.[key] ?? null) });
  ids.splice(to, 0, ...ids.splice(from, 1));
  writeOrder(i, key, ids);
}

/** The latest hand-made change to route i that can still be taken back (or, from the redo list, made again). */
export function lastEdit(i: number, from: RouteEdit[] | undefined = state.edits): RouteEdit | undefined {
  const here = new Set(session.batches[i].map(cityId));
  const key = orderKey(i);
  return [...(from ?? [])].reverse().find((e) =>
    e.kind === 'order' ? e.key === key
    : e.kind === 'marks' ? e.before.some(([id]) => here.has(id))
    : e.kind === 'readd' ? (e.custom !== undefined ? isCustom(i) && i - session.generatedCount === e.custom : !!e.anchor && here.has(e.anchor))
    : here.has(e.id),
  );
}

/** Every End City within a distance of a spot, whatever the search settings say. */
export function citiesAround(at: { x: number; z: number }, radius: number): FoundCity[] {
  const circle: Filters = { ...state.filters, around: { x: at.x, z: at.z, radius } };
  if (session.precomputed?.covers(state.seed, circle)) return session.precomputed.search(circle);
  circle.around!.radius = Math.min(radius, BEYOND_LIVE_BLOCKS);
  const seed = BigInt(state.seed);
  return findEndCities(seed, {
    maxBlocks: 0,
    bounds: searchBounds(circle),
    accept: (x, z) => passes(x, z, circle),
  }).map(([cx, cz]): FoundCity => [chunkToBlock(cx), chunkToBlock(cz), shipCode(seed, cx, cz)]);
}
/** Take a city off the removed-by-hand list, as when it is added to a route again. */
export const undrop = (id: string) => {
  if (state.dropped) state.dropped = state.dropped.filter((x) => x !== id);
};
export const tooltip = $('tooltip');
export let batchWorker: Worker | null = null;
/** Counts rebuilds, so an answer from a superseded one is ignored. */
let rebuildRun = 0;

function showBatching(busy: boolean): void {
  $('batchBusy').hidden = !busy;
  $('batches').classList.toggle('stale', busy);
}

/**
 * Work out the batches from the current search and settings. `done` runs once they are ready:
 * straight away for small jobs, or when the worker reports back for large ones, in which case
 * the page is redrawn then too.
 */
export function rebuild(done?: () => void): void {
  // The webmap only describes the default server's world.
  const mapped = !state.includeMapped && session.explored && state.seed === DEFAULT_SEED ? session.explored : null;
  // Only ships hold elytra, so cities without one are never offered.
  // A city reported in game as having no ship is treated like any other shipless city.
  // A city reported in game as missing its ship, or missing altogether, stays on the map but out of the routes.
  const reports =
    state.seed === DEFAULT_SEED ? session.shipReports : { gone: new Map<string, 'missing' | 'no-city'>(), found: new Set<string>() };
  const withShip = state.found.filter((c) => c[2]);
  // Whatever the routes do with them, cities on the webmap help to guess where earlier hunters flew.
  session.webmapShips =
    session.explored && state.seed === DEFAULT_SEED
      ? withShip.filter((c) => session.explored!.isMapped(c[0], c[1])).map((c): City => ({ x: c[0], z: c[1], source: 'seed' }))
      : [];
  const extra = state.extra ?? [];
  session.uncertainShips = new Set(
    [...withShip, ...extra]
      .filter((c) => c[2] === 2 && !reports.found.has(`${c[0]},${c[1]}`) && !reports.gone.has(`${c[0]},${c[1]}`))
      .map((c) => `${c[0]},${c[1]}`),
  );
  session.shipless = state.found.length - withShip.length;
  session.skipped = 0;

  // Every city worth showing, with the reason it is kept out of the batches, if any.
  const pool = new Map<string, { city: City; note?: string; missing?: boolean }>();
  const seen = new Set<string>();
  const excluded = new Set(state.excluded);
  const add = (x: number, z: number, source: City['source'], ship: boolean) => {
    // One city per chunk, whichever source it came from.
    const key = `${x >> 4},${z >> 4}`;
    if (seen.has(key)) return;
    seen.add(key);
    const city: City = { x, z, source };
    let note: string | undefined;
    const reported = reports.gone.get(cityId(city));
    if (reported) {
      pool.set(cityId(city), { city, note: MISSING_NOTE[reported], missing: true });
      return;
    }
    // Only while still looted: unticking a city puts it back.
    if (excluded.has(cityId(city)) && session.tracker.has(city)) note = 'looted, removed from routes';
    else if (source === 'seed' && mapped?.isMapped(x, z)) {
      session.skipped++;
      // Ships near mapped terrain may still be unlooted, so keep them visible.
      if (!ship) return;
      note = MAPPED_NOTE;
    } else if (state.skipPossible) note = possibleNote(city) ?? undefined;
    pool.set(cityId(city), { city, note });
  };
  for (const [x, z, ship] of withShip) add(x, z, 'seed', !!ship);
  // Cities "+1 city" brought in from beyond the search: on the map, but never batched of their own accord.
  for (const [x, z] of extra) {
    const id = `${x},${z}`;
    if (pool.has(id)) continue;
    add(x, z, 'seed', true);
    const entry = pool.get(id);
    if (entry && !entry.note) entry.note = EXTRA_NOTE;
  }

  session.outside = [];
  const cities: City[] = [];
  for (const entry of pool.values()) {
    if (entry.note) session.outside.push({ city: entry.city, note: entry.note, missing: entry.missing });
    else cities.push(entry.city);
  }
  const job: BatchJob = {
    cities,
    size: state.batchSize,
    shape: state.batchShape,
    maxHop: state.maxHop,
    lineDeviation: state.lineDeviation,
    origin: startPoint(),
  };
  const run = ++rebuildRun;
  batchWorker?.terminate();
  batchWorker = null;
  const finish = (made: { batches: City[][]; size: number }) => {
    finishRebuild(made, pool, cities);
    if (session.reopening) reopen();
    done?.();
  };
  if (job.maxHop <= 0 || cities.length * job.size <= BATCH_IN_PLACE_LIMIT) {
    showBatching(false);
    finish(makeBatchesOrSmaller(job));
    return;
  }
  // Until the worker answers, the previous batches stay on screen, marked as being updated.
  showBatching(true);
  batchWorker = import.meta.env.DEV
    ? new Worker(new URL('./batch-worker.ts', import.meta.url), { type: 'module' })
    : new Worker(new URL('./batch-worker.ts', import.meta.url));
  batchWorker.addEventListener('message', (e: MessageEvent<{ batches: City[][]; size: number }>) => {
    if (run !== rebuildRun) return;
    batchWorker?.terminate();
    batchWorker = null;
    showBatching(false);
    finish(e.data);
    render();
  });
  batchWorker.addEventListener('error', () => {
    if (run !== rebuildRun) return;
    showBatching(false);
    $('stats').textContent = 'Working out the routes failed. Try a smaller route size.';
  });
  batchWorker.postMessage(job);
}

/** Where routes are built and numbered outward from: the centre of an around-a-position search, else 0,0. */
export const startPoint = () => (state.filters.around ? { x: state.filters.around.x, z: state.filters.around.z } : { x: 0, z: 0 });

/** Total flying along a route, in blocks. */
export const routeLength = (b: City[]) => b.reduce((t, c, k) => t + (k ? Math.hypot(c.x - b[k - 1].x, c.z - b[k - 1].z) : 0), 0);

/** Second half of a rebuild: take the generated batches and apply hand-made moves and custom batches. */
function finishRebuild(
  made: { batches: City[][]; size: number },
  pool: Map<string, { city: City; note?: string }>,
  cities: City[],
): void {
  // Cities taken out by hand leave after batching, so removing one never reshuffles the other routes.
  const dropped = new Set(state.dropped ?? []);
  session.batches = dropped.size ? made.batches.map((b) => b.filter((c) => !dropped.has(cityId(c)))) : made.batches;
  // Route 1 is the least flying in all: from the point of origin to the route's first city, then along the route.
  const origin = startPoint();
  const cost = new Map(session.batches.map((b) => [b, (b.length ? Math.hypot(b[0].x - origin.x, b[0].z - origin.z) : 0) + routeLength(b)]));
  session.batches = [...session.batches].sort((p, q) => cost.get(p)! - cost.get(q)!);
  session.usedBatchSize = made.size;
  // Hand-made moves are applied after batching, so adding a city to a batch never reshuffles the others.
  // A move holds while both cities still exist and its target is in a batch of its own accord.
  const batchOf = new Map<string, number>();
  session.batches.forEach((batch, b) => batch.forEach((c) => batchOf.set(cityId(c), b)));
  const moved = new Set<string>();
  const appended = state.appended ?? [];
  const tails = new Map<number, string[]>();
  for (const [id, anchor] of Object.entries(state.moved)) {
    const to = batchOf.get(anchor);
    if (!pool.has(id) || to === undefined || anchor in state.moved) continue;
    const from = batchOf.get(id);
    if (from === to) continue;
    if (from !== undefined) session.batches[from] = session.batches[from].filter((c) => cityId(c) !== id);
    moved.add(id);
    // Cities added by hand go on the end, in the order they were added.
    tails.set(to, [...(tails.get(to) ?? []), id]);
  }
  for (const [b, ids] of tails) {
    ids.sort((p, q) => appended.indexOf(p) - appended.indexOf(q));
    session.batches[b] = [...session.batches[b], ...ids.map((id) => pool.get(id)!.city)];
  }
  // Then any order given by hand. One that no longer fits its route (the routes were regrouped) is forgotten.
  for (const [key, ids] of Object.entries(state.orders ?? {})) {
    const b = batchOf.get(key);
    if (b === undefined || key in state.moved) continue;
    const known = new Set(ids);
    const own = session.batches[b].filter((c) => !moved.has(cityId(c)));
    if (own.filter((c) => known.has(cityId(c))).length * 2 < own.length) delete state.orders![key];
    else session.batches[b] = inOrder(session.batches[b], ids);
  }

  // Custom batches take their cities out of wherever they were and are listed after the generated ones.
  const customs: City[][] = [];
  const inCustom = new Set<string>();
  for (const ids of state.custom) {
    const members = ids.filter((id) => pool.has(id) && !inCustom.has(id));
    members.forEach((id) => inCustom.add(id));
    customs.push(members.map((id) => pool.get(id)!.city));
  }
  if (inCustom.size) session.batches = session.batches.map((b) => b.filter((c) => !inCustom.has(cityId(c))));
  session.batches = session.batches.filter((b) => b.length);
  session.generatedCount = session.batches.length;
  // An emptied custom batch is kept, so its number does not shift while the player is still building it.
  session.batches.push(...customs.map((b) => (b.length > 1 ? route(b, startPoint()) : b)));
  setBatchTags(session.batches.map((_, i) => (isCustom(i) ? `C${i - session.generatedCount + 1}` : String(i + 1))));

  const inBatch = new Set(session.batches.flat().map(cityId));
  session.outside = session.outside.filter((o) => !moved.has(cityId(o.city)) && !inCustom.has(cityId(o.city)));
  session.unbatched = 0;
  for (const c of cities) {
    if (inBatch.has(cityId(c))) continue;
    if (dropped.has(cityId(c))) {
      session.outside.push({ city: c, note: REMOVED_NOTE });
      continue;
    }
    session.unbatched++;
    session.outside.push({ city: c, note: `no route to it with flights under ${fmt(state.maxHop)} blocks` });
  }
  if (session.selected !== null && session.selected >= session.batches.length) session.selected = null;
}

export const looted = (batch: City[]) => batch.filter((c) => session.tracker.has(c)).length;
export const color = (i: number) => XAERO_COLORS[batchColor(i)];
