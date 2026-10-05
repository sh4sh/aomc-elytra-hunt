import { lookalike, type Constellation } from './constellations';
import { Explored } from './explored';
import { endCityHasShip, shipCode } from './generation/end-city-pieces';
import { END_CITY, candidateChunk, chunkToBlock, findEndCities } from './generation/end-cities';
import { EndTerrain } from './generation/end-terrain';
import { BATCH_SIZE, DEFAULT_MAX_HOP, makeBatchesOrSmaller, passes, route, type BatchJob, type BatchShape } from './filters';
import type { FindRequest, FindResponse, FoundCity } from './generation/worker';
import { parseCoordinates } from './import';
import { chatLine, cleanUsername } from './journeymap';
import { EndMap, type MapCity } from './map';
import { Precomputed } from './precomputed';
import { loadSkyFigures } from './sky-cultures';
import { surveyEstimate, surveySample } from './survey';
import { Tracker } from './tracker';
import { describeTrajectory, onTrajectory, studyTrajectories, type Trajectory } from './trajectory';
import { cityId, searchBounds, type City, type Filters, type Quadrant } from './types';
import { OUTSIDE_COLOR, XAERO_COLORS, batchColor, setBatchTags, shareLine, waypointFile, waypointLines, waypointName } from './xaero';

const DEFAULT_SEED = '856461443495910397';
const ISSUES_URL = 'https://github.com/sh4sh/aomc-elytra-hunt/issues';
/** The latest finished runs of the job that checks the webmap for changes, as GitHub reports them to anyone. */
const WEBMAP_CHECKS_URL =
  'https://api.github.com/repos/sh4sh/aomc-elytra-hunt/actions/workflows/update-webmap.yml/runs?status=success&per_page=1';
/**
 * Address of the relay that files looted-city submissions as GitHub issues (see relay/README.md).
 * While empty, the Submit button is hidden and players are pointed at GitHub instead.
 */
const SUBMIT_URL = 'https://aomc-looted-relay.sh4sh.workers.dev';
/** How far a line batch may stray to either side of straight, in blocks, unless the player changes it. */
const DEFAULT_LINE_DEVIATION = 1000;
/**
 * Most ship cities one search may bring in. Batching and drawing slow down with every city, and beyond
 * this the page would hang for many seconds, so a wider search is refused with advice to narrow it.
 */
const MAX_SEARCH_CITIES = 25000;
/** Ship cities per square block, measured over the first 100,000 blocks of the default world. */
const SHIP_DENSITY = 4.6e-7;
const DEFAULT_FILTERS: Filters = { minDist: 10000, maxDist: 50000, diagonalDeg: 45, quadrants: ['NE', 'NW', 'SE', 'SW'] };
const STORE = 'end-cities:state';

interface Saved {
  seed: string;
  filters: Filters;
  /** Result of the last search. */
  found: FoundCity[];
  imported: [number, number][];
  /** Leave out cities that already show up on the community webmap. */
  /** Leave out cities that generate without a ship, since only ships hold elytra. */
  shipsOnly: boolean;
  /** Cities per batch. A full shulker box is 27. */
  batchSize: number;
  batchShape: BatchShape;
  /** Longest allowed flight between consecutive cities in a batch, in blocks. 0 means no limit. */
  maxHop: number;
  /** For line batches: how many blocks a line may stray to either side of straight. 0 means no limit. */
  lineDeviation: number;
  /** Looted cities (by id) taken out of the batches the last time they were regrouped. */
  excluded: string[];
  /** Cities moved by hand: city id -> id of a city in the batch it was added to. */
  moved: Record<string, string>;
  /** Put cities already on the webmap in the routes too. Normally they are left out as probably looted. */
  includeMapped?: boolean;
  /** Cities from beyond the search area that "+1 city" brought into a route. */
  extra?: FoundCity[];
  /** Cities taken out of their route by hand. They stay on the map without a route. */
  dropped?: string[];
  /** Cities added to a route by hand, oldest first: they go at the end of their route, in this order. */
  appended?: string[];
  /** Routes put in an order by hand: the city ids in that order, under the id of one city that belongs to the route. */
  orders?: Record<string, string[]>;
  /** Changes made by hand to routes, oldest first, so the latest can be taken back. */
  edits?: RouteEdit[];
  /** On a touch screen, move the map with one finger (and so give up scrolling the page across it). */
  oneFingerMap?: boolean;
  /** Whether the "add to your map mod" section of a route is unfolded. */
  exportOpen?: boolean;
  /** Changes that undo took back, latest last, so they can be made again. */
  redo?: RouteEdit[];
  /** Keep cities near one found already looted out of the routes. */
  skipPossible?: boolean;
  /** Whether the tools for working on the app are shown. */
  devMode?: boolean;
  /** The latest survey of the cities near End Spawn: the cities picked, and how many they were picked from. */
  survey?: { ids: string[]; frame: number };
  /** Minecraft username to whisper JourneyMap chat lines to, or empty to write them for public chat. */
  /** Batches the player put together by hand, each a list of city ids. */
  custom: string[][];
  chatName: string;
  /** Which map mod the export controls are shown for. */
  mapMod: 'xaero' | 'journeymap';
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (s?.seed && s.filters) {
      const saved: Saved = { found: [], imported: [], shipsOnly: true, batchSize: BATCH_SIZE, batchShape: 'cluster', maxHop: DEFAULT_MAX_HOP, lineDeviation: DEFAULT_LINE_DEVIATION, excluded: [], moved: {}, custom: [], chatName: '', mapMod: 'xaero', ...s };
      // Fixed since the setting for it was removed.
      saved.shipsOnly = true;
      // Results saved before ships were tracked have no ship flag: search again.
      if (saved.found.some((c) => c.length < 3)) saved.found = [];
      return saved;
    }
  } catch {
    // Fall through to defaults.
  }
  return { seed: DEFAULT_SEED, filters: DEFAULT_FILTERS, found: [], imported: [], shipsOnly: true, batchSize: BATCH_SIZE, batchShape: 'cluster', maxHop: DEFAULT_MAX_HOP, lineDeviation: DEFAULT_LINE_DEVIATION, excluded: [], moved: {}, custom: [], chatName: '', mapMod: 'xaero' };
}

const state = load();
let tracker = new Tracker(state.seed);
let batches: City[][] = [];
let selected: number | null = null;
let hot: City | null = null;
let worker: Worker | null = null;
let explored: Explored | null = null;
let precomputed: Precomputed | null = null;
let you: { x: number; z: number } | null = null;
/** A spot the map was jumped to with "Go to coordinates". It is only a marker: it does not count as the player's position. */
let pin: { x: number; z: number } | null = null;
let showStars = false;
/** Hidden extra, toggled by the goose: show every looted city on the map. */
let showTrophies = false;
const lootedCities = (): City[] =>
  tracker.all().map((id) => {
    const [x, z] = id.split(',').map(Number);
    return { x, z, source: 'seed' as const };
  });
/** Ship cities in areas on the webmap, worked out the first time the hidden view is opened. */
let webmapCities: City[] | null = null;

/**
 * Find every ship city in terrain the webmap shows, however far out. Only the regions that contain
 * mapped terrain are examined, in small slices so the page stays responsive.
 */
async function findWebmapCities(mask: Explored): Promise<City[]> {
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
/** Whether the instructions are showing in place of the open batch. */
let helpOpen = false;
/** Figures from the world's sky cultures, fetched the first time the sketch is opened. */
let skyFigures: Constellation[] | null = null;
let starCache: { key: string; match: ReturnType<typeof lookalike> } | null = null;
/** Batches shown per page of the list. */
const PAGE_SIZE = 5;
let page = 0;
/** Whether routes that are all looted are listed after all. */
let showFinished = false;
/** The selection the list last jumped to, so paging by hand isn't undone on the next redraw. */
let pageFollowed: number | null = null;
/** Cities left out because they are already on the webmap. */
let skipped = 0;
/** Cities left out because they have no ship. */
let shipless = 0;
/** Largest batch a player can ask for. Routes much longer than this get slow to work out. */
const MAX_BATCH_SIZE = 500;
/** Cities per batch actually used: the setting, or fewer when no batch that large could be made. */
let usedBatchSize = BATCH_SIZE;
/**
 * Players' reports, published with the site. `gone` holds cities to keep out of routes, with what was
 * reported: found with no ship, or no End City there at all. `found` holds ships confirmed present.
 */
let shipReports = { gone: new Map<string, 'missing' | 'no-city'>(), found: new Set<string>() };
/** What the map and tooltips say about a city reported missing. */
const MISSING_NOTE = { missing: 'End Ship reported missing', 'no-city': 'End City reported missing' };
/**
 * Cities whose ship is a tight fit against another part of the city, and so may not have generated.
 * A confirmed report clears the doubt.
 */
let uncertainShips = new Set<string>();
/** A city this close (in blocks) to one found already looted counts as possibly looted. */
const POSSIBLE_RADIUS = 2000;
const POSSIBLE_NOTE = 'possibly looted: near a city found already looted';
/** Ships closer to End Spawn than this (along the longer axis, as the search measures) count as possibly looted. */
const NEAR_SPAWN_BLOCKS = 10000;
const NEAR_SPAWN_NOTE = 'possibly looted: within 10,000 blocks of End Spawn, where most ships were emptied long ago';

/** Guessed flight paths of earlier hunters, worked out again whenever a looted mark changes. */
let pathsFor: { tracker: Tracker; version: number; mapped: City[]; paths: Trajectory[]; near: string[] } | null = null;
/** Ship cities of the current search that are on the webmap: another player has been there. Set by each rebuild. */
let webmapShips: City[] = [];
function earlierStudy(): { paths: Trajectory[]; near: string[] } {
  if (pathsFor?.tracker !== tracker || pathsFor.version !== tracker.version || pathsFor.mapped !== webmapShips) {
    const point = (id: string) => {
      const [x, z] = id.split(',').map(Number);
      return { x, z };
    };
    const already = tracker.alreadyAll().map(point);
    // Cities looted the ordinary way had their elytra, so no earlier hunter took it.
    const intact = tracker.all().map(point).filter((p) => !tracker.isAlready(p));
    // A webmap city the player has marked themselves is counted by that mark, not twice.
    const mapped = webmapShips.filter((c) => !tracker.has(c));
    pathsFor = { tracker, version: tracker.version, mapped: webmapShips, ...studyTrajectories(already, intact, mapped) };
  }
  return pathsFor;
}
const earlierPaths = (): Trajectory[] => earlierStudy().paths;

/** Why a city that nobody has marked looted may be looted all the same, or null if there is no sign of it. */
function possibleNote(c: City): string | null {
  if (tracker.has(c)) return null;
  const path = earlierPaths().find((t) => onTrajectory(t, c));
  if (path) return `possibly looted: on a possible earlier flight path (${describeTrajectory(path)})`;
  if (tracker.nearAlready(c, POSSIBLE_RADIUS)) return POSSIBLE_NOTE;
  // Close to End Spawn on the server, most ships were emptied long ago by players nobody has a record of.
  if (state.seed === DEFAULT_SEED && Math.max(Math.abs(c.x), Math.abs(c.z)) < NEAR_SPAWN_BLOCKS) return NEAR_SPAWN_NOTE;
  return null;
}
const possible = (c: City): boolean => possibleNote(c) !== null;
/** Why each kind of "possibly looted" is said, in a sentence a player can read, keyed by how its note starts. */
const POSSIBLE_WHY: [string, string][] = [
  ['possibly looted: within', 'Within 10,000 blocks of End Spawn, where most ships were emptied long ago.'],
  ['possibly looted: near a city', 'Within 2,000 blocks of a city found already looted.'],
  ['possibly looted: on a possible', 'On a guessed flight path of an earlier hunter.'],
];
/** How many of `batches` were generated; the player's custom batches follow them. */
let generatedCount = 0;

const isCustom = (i: number) => i >= generatedCount;
/** Display name of a batch, which players see as a route: "Route 12", or "Custom 1" for one they made. */
const batchTitle = (i: number) => (isCustom(i) ? `Custom ${i - generatedCount + 1}` : `Route ${i + 1}`);
/** Cities that could not be fitted into a full batch within the longest-flight limit. */
let unbatched = 0;
/** A change made by hand to a route: a city added to it, or its order changed (`before` being the order it had, if any). */
type RouteEdit =
  | { kind: 'add'; id: string }
  | { kind: 'order'; key: string; before: string[] | null }
  // Looted marks changed: what each city's mark was before (0 not looted, 1 looted, 2 looted by someone else).
  | { kind: 'marks'; before: [string, 0 | 1 | 2][] }
  // Only ever waiting to be redone: a city that undo took back out, and how it had been held in its route.
  | { kind: 'readd'; id: string; anchor?: string; custom?: number; extra?: FoundCity };
const pushEdit = (e: RouteEdit) => {
  state.edits = [...(state.edits ?? []), e].slice(-100);
  // A fresh change leaves nothing to redo.
  state.redo = [];
};
/** Call just before changing the looted marks of these cities, so the change can be taken back. */
function recordMarks(cities: { x: number; z: number }[]): void {
  pushEdit({ kind: 'marks', before: cities.map((c) => [cityId(c), tracker.isAlready(c) ? 2 : tracker.has(c) ? 1 : 0]) });
  save();
}

/** The cities in the order the ids give; any not among them keep their order, at the end. */
function inOrder(batch: City[], ids: string[]): City[] {
  const at = new Map(ids.map((id, k) => [id, k]));
  return [...batch].sort((p, q) => (at.get(cityId(p)) ?? Infinity) - (at.get(cityId(q)) ?? Infinity) || batch.indexOf(p) - batch.indexOf(q));
}

/** What a route's hand-made order is saved under: for a generated route, a city that belongs to it of its own accord. */
function orderKey(i: number): string | null {
  if (isCustom(i)) return `custom:${i - generatedCount}`;
  const own = batches[i].map(cityId).filter((id) => !(id in state.moved));
  return own.find((id) => state.orders?.[id]) ?? own[0] ?? null;
}

/** Give route i a new order, or with null return it to the order it was worked out in. */
function writeOrder(i: number, key: string, ids: string[] | null): void {
  if (isCustom(i)) {
    const k = i - generatedCount;
    // Cities of the custom route that are not on show just now keep their place at the end.
    if (ids) state.custom[k] = [...ids, ...state.custom[k].filter((id) => !ids.includes(id))];
  } else if (ids) (state.orders ??= {})[key] = ids;
  else delete state.orders?.[key];
  save();
  if (!ids) return rebuildKeeping(key);
  batches[i] = inOrder(batches[i], ids);
  render();
}

/** Move the city at one place in the open route to another. */
function moveCity(i: number, from: number, to: number): void {
  const key = orderKey(i);
  if (!key || from === to || to < 0 || to >= batches[i].length) return;
  const ids = batches[i].map(cityId);
  pushEdit({ kind: 'order', key, before: isCustom(i) ? [...state.custom[i - generatedCount]] : (state.orders?.[key] ?? null) });
  ids.splice(to, 0, ...ids.splice(from, 1));
  writeOrder(i, key, ids);
}

/** The latest hand-made change to route i that can still be taken back (or, from the redo list, made again). */
function lastEdit(i: number, from: RouteEdit[] | undefined = state.edits): RouteEdit | undefined {
  const here = new Set(batches[i].map(cityId));
  const key = orderKey(i);
  return [...(from ?? [])].reverse().find((e) =>
    e.kind === 'order' ? e.key === key
    : e.kind === 'marks' ? e.before.some(([id]) => here.has(id))
    : e.kind === 'readd' ? (e.custom !== undefined ? isCustom(i) && i - generatedCount === e.custom : !!e.anchor && here.has(e.anchor))
    : here.has(e.id),
  );
}

const REMOVED_NOTE = 'removed from its route by hand';
const MAPPED_NOTE = 'has a ship, but already on the webmap';
const EXTRA_NOTE = 'outside the search area, added with Add +1 city to route';
/** How far past the search area "+1 city" will look from a route's last stop, in blocks. */
const BEYOND_BLOCKS = 4000;
/**
 * The same, where the cities have to be generated on the spot (another seed, or past the pre-generated
 * area). Kept small so the press stays instant: this far takes a few hundredths of a second.
 */
const BEYOND_LIVE_BLOCKS = 2500;

/** Every End City within a distance of a spot, whatever the search settings say. */
function citiesAround(at: { x: number; z: number }, radius: number): FoundCity[] {
  const circle: Filters = { ...state.filters, around: { x: at.x, z: at.z, radius } };
  if (precomputed?.covers(state.seed, circle)) return precomputed.search(circle);
  circle.around!.radius = Math.min(radius, BEYOND_LIVE_BLOCKS);
  const seed = BigInt(state.seed);
  return findEndCities(seed, {
    maxBlocks: 0,
    bounds: searchBounds(circle),
    accept: (x, z) => passes(x, z, circle),
  }).map(([cx, cz]): FoundCity => [chunkToBlock(cx), chunkToBlock(cz), shipCode(seed, cx, cz)]);
}
/** Take a city off the removed-by-hand list, as when it is added to a route again. */
const undrop = (id: string) => {
  if (state.dropped) state.dropped = state.dropped.filter((x) => x !== id);
};
/** The place in the open route of the row being dragged, while a drag is under way. */
let dragFrom: number | null = null;
/** Cities kept out of the batches but still drawn on the map, with the reason. */
let outside: { city: City; note: string; missing?: boolean }[] = [];

const save = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    // Not fatal: the search can be rerun.
  }
};

const map = new EndMap($<HTMLCanvasElement>('map'));
const tooltip = $('tooltip');

// ---------- derived data ----------

/**
 * Batching cost grows with cities times batch size. Above this it is handed to a worker, so the page
 * stays responsive; below it the answer is instant and worked out on the spot.
 */
const BATCH_IN_PLACE_LIMIT = 150_000;
let batchWorker: Worker | null = null;
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
function rebuild(done?: () => void): void {
  // The webmap only describes the default server's world.
  const mapped = !state.includeMapped && explored && state.seed === DEFAULT_SEED ? explored : null;
  // Only ships hold elytra, so cities without one are never offered.
  // A city reported in game as having no ship is treated like any other shipless city.
  // A city reported in game as missing its ship, or missing altogether, stays on the map but out of the routes.
  const reports =
    state.seed === DEFAULT_SEED ? shipReports : { gone: new Map<string, 'missing' | 'no-city'>(), found: new Set<string>() };
  const withShip = state.found.filter((c) => c[2]);
  // Whatever the routes do with them, cities on the webmap help to guess where earlier hunters flew.
  webmapShips =
    explored && state.seed === DEFAULT_SEED
      ? withShip.filter((c) => explored!.isMapped(c[0], c[1])).map((c): City => ({ x: c[0], z: c[1], source: 'seed' }))
      : [];
  const extra = state.extra ?? [];
  uncertainShips = new Set(
    [...withShip, ...extra]
      .filter((c) => c[2] === 2 && !reports.found.has(`${c[0]},${c[1]}`) && !reports.gone.has(`${c[0]},${c[1]}`))
      .map((c) => `${c[0]},${c[1]}`),
  );
  shipless = state.found.length - withShip.length;
  skipped = 0;

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
    if (excluded.has(cityId(city)) && tracker.has(city)) note = 'looted, removed from routes';
    else if (source === 'seed' && mapped?.isMapped(x, z)) {
      skipped++;
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

  outside = [];
  const cities: City[] = [];
  for (const entry of pool.values()) {
    if (entry.note) outside.push({ city: entry.city, note: entry.note, missing: entry.missing });
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
const startPoint = () => (state.filters.around ? { x: state.filters.around.x, z: state.filters.around.z } : { x: 0, z: 0 });

/** Total flying along a route, in blocks. */
const routeLength = (b: City[]) => b.reduce((t, c, k) => t + (k ? Math.hypot(c.x - b[k - 1].x, c.z - b[k - 1].z) : 0), 0);

/** Second half of a rebuild: take the generated batches and apply hand-made moves and custom batches. */
function finishRebuild(
  made: { batches: City[][]; size: number },
  pool: Map<string, { city: City; note?: string }>,
  cities: City[],
): void {
  // Cities taken out by hand leave after batching, so removing one never reshuffles the other routes.
  const dropped = new Set(state.dropped ?? []);
  batches = dropped.size ? made.batches.map((b) => b.filter((c) => !dropped.has(cityId(c)))) : made.batches;
  // Route 1 is the least flying in all: from the point of origin to the route's first city, then along the route.
  const origin = startPoint();
  const cost = new Map(batches.map((b) => [b, (b.length ? Math.hypot(b[0].x - origin.x, b[0].z - origin.z) : 0) + routeLength(b)]));
  batches = [...batches].sort((p, q) => cost.get(p)! - cost.get(q)!);
  usedBatchSize = made.size;
  // Hand-made moves are applied after batching, so adding a city to a batch never reshuffles the others.
  // A move holds while both cities still exist and its target is in a batch of its own accord.
  const batchOf = new Map<string, number>();
  batches.forEach((batch, b) => batch.forEach((c) => batchOf.set(cityId(c), b)));
  const moved = new Set<string>();
  const appended = state.appended ?? [];
  const tails = new Map<number, string[]>();
  for (const [id, anchor] of Object.entries(state.moved)) {
    const to = batchOf.get(anchor);
    if (!pool.has(id) || to === undefined || anchor in state.moved) continue;
    const from = batchOf.get(id);
    if (from === to) continue;
    if (from !== undefined) batches[from] = batches[from].filter((c) => cityId(c) !== id);
    moved.add(id);
    // Cities added by hand go on the end, in the order they were added.
    tails.set(to, [...(tails.get(to) ?? []), id]);
  }
  for (const [b, ids] of tails) {
    ids.sort((p, q) => appended.indexOf(p) - appended.indexOf(q));
    batches[b] = [...batches[b], ...ids.map((id) => pool.get(id)!.city)];
  }
  // Then any order given by hand. One that no longer fits its route (the routes were regrouped) is forgotten.
  for (const [key, ids] of Object.entries(state.orders ?? {})) {
    const b = batchOf.get(key);
    if (b === undefined || key in state.moved) continue;
    const known = new Set(ids);
    const own = batches[b].filter((c) => !moved.has(cityId(c)));
    if (own.filter((c) => known.has(cityId(c))).length * 2 < own.length) delete state.orders![key];
    else batches[b] = inOrder(batches[b], ids);
  }

  // Custom batches take their cities out of wherever they were and are listed after the generated ones.
  const customs: City[][] = [];
  const inCustom = new Set<string>();
  for (const ids of state.custom) {
    const members = ids.filter((id) => pool.has(id) && !inCustom.has(id));
    members.forEach((id) => inCustom.add(id));
    customs.push(members.map((id) => pool.get(id)!.city));
  }
  if (inCustom.size) batches = batches.map((b) => b.filter((c) => !inCustom.has(cityId(c))));
  batches = batches.filter((b) => b.length);
  generatedCount = batches.length;
  // An emptied custom batch is kept, so its number does not shift while the player is still building it.
  batches.push(...customs.map((b) => (b.length > 1 ? route(b, startPoint()) : b)));
  setBatchTags(batches.map((_, i) => (isCustom(i) ? `C${i - generatedCount + 1}` : String(i + 1))));

  const inBatch = new Set(batches.flat().map(cityId));
  outside = outside.filter((o) => !moved.has(cityId(o.city)) && !inCustom.has(cityId(o.city)));
  unbatched = 0;
  for (const c of cities) {
    if (inBatch.has(cityId(c))) continue;
    if (dropped.has(cityId(c))) {
      outside.push({ city: c, note: REMOVED_NOTE });
      continue;
    }
    unbatched++;
    outside.push({ city: c, note: `no route to it with flights under ${fmt(state.maxHop)} blocks` });
  }
  if (selected !== null && selected >= batches.length) selected = null;
}

const looted = (batch: City[]) => batch.filter((c) => tracker.has(c)).length;
const color = (i: number) => XAERO_COLORS[batchColor(i)];
const fmt = (n: number) => n.toLocaleString();
/** Coordinates the way Minecraft writes them. No thousands separators, so they can be typed straight in. */
const xzText = (c: { x: number; z: number }) => `x: ${c.x}, z: ${c.z}`;

// ---------- rendering ----------

/**
 * What to shade as the search area: the form's settings, so the shape follows the controls while
 * they are being changed, or the applied search if the form holds something unusable.
 */
function previewFilters(): Filters {
  const f = formFilters();
  if (aroundMode()) return f.around ? f : state.filters;
  const usable = Number.isFinite(f.minDist) && Number.isFinite(f.maxDist) && f.minDist >= 0 && f.maxDist > f.minDist;
  return usable ? f : state.filters;
}

/** The cities last handed to the map, for the legend to look through. */
let shownCities: MapCity[] = [];
/** The legend only explains marks that are in view on the map just now. */
function renderLegend(): void {
  const seen = shownCities.filter((c) => map.inView(c.city.x, c.city.z));
  const legend = {
    route: seen.some((c) => c.batch >= 0 && !c.visited && !(c.possible && map.detailed)),
    looted: seen.some((c) => c.visited && !c.already),
    missing: seen.some((c) => c.missing && !c.visited),
    already: seen.some((c) => c.already),
    possible: map.detailed && seen.some((c) => c.possible && !c.visited && c.batch >= 0),
    path: map.detailed && earlierPaths().some((t) => [t.before, ...t.points, t.after].some((p) => map.inView(p.x, p.z))),
    outside: seen.some((c) => c.batch < 0 && !c.visited && !c.missing),
  };
  for (const key of document.querySelectorAll<HTMLElement>('#mapbar [data-key]')) {
    key.hidden = !legend[key.dataset.key as keyof typeof legend];
  }
}

function renderMap(): void {
  const cities: MapCity[] = [];
  batches.forEach((batch, b) =>
    batch.forEach((city, order) =>
      cities.push({
        city,
        batch: b,
        order,
        color: color(b),
        visited: tracker.has(city),
        already: tracker.showsAlready(city),
        possible: possible(city),
      }),
    ),
  );
  for (const o of outside) {
    cities.push({
      city: o.city,
      batch: -1,
      order: 0,
      color: OUTSIDE_COLOR,
      visited: tracker.has(o.city),
      already: tracker.showsAlready(o.city),
      note: o.note,
      missing: o.missing,
    });
  }
  if (showTrophies) {
    // Hidden extra: every looted city there is, wherever the current search happens to be looking.
    const drawn = new Map(cities.map((c) => [cityId(c.city), c]));
    const mark = (city: City, trophy: 'looted' | 'mapped', note: string) => {
      const there = drawn.get(cityId(city));
      // Looted outranks mapped, and is added second so it wins.
      if (there) {
        there.trophy = trophy;
        there.visited = true;
      } else {
        const entry: MapCity = { city, batch: -1, order: 0, color: OUTSIDE_COLOR, visited: true, note, trophy };
        cities.push(entry);
        drawn.set(cityId(city), entry);
      }
    };
    if (state.seed === DEFAULT_SEED) for (const city of webmapCities ?? []) mark(city, 'mapped', 'in an area on the webmap');
    for (const city of lootedCities()) mark(city, 'looted', 'looted');
  }
  shownCities = cities;
  map.setScene({
    cities,
    selectedBatch: selected,
    hot,
    filters: state.filters,
    searchArea: previewFilters(),
    explored: state.seed === DEFAULT_SEED ? explored : null,
    paths: earlierPaths(),
    you,
    pin,
  });
}

/** One-line description of the current search, shown while the settings are folded away. */
function renderSettingsSummary(): void {
  const f = state.filters;
  const where = f.around
    ? [`within ${fmt(f.around.radius)} blocks of ${xzText(f.around)}`]
    : [
        `${fmt(f.minDist)}–${fmt(f.maxDist)} blocks out`,
        f.diagonalDeg >= 45 ? 'any angle' : `within ${f.diagonalDeg}° of ${f.angleFrom === 'axis' ? 'an axis' : 'a diagonal'}`,
        f.quadrants.length === 4 ? 'all quadrants' : f.quadrants.join(' '),
      ];
  $('settingsSummary').textContent = [
    ...where,
    `${state.batchSize} per route`,
    state.batchShape !== 'line'
      ? 'clusters'
      : state.lineDeviation && state.maxHop
        ? `lines outward within ${fmt(state.lineDeviation)} of straight`
        : 'lines outward',
    state.maxHop ? `flights up to ${fmt(state.maxHop)}` : 'any flight length',
  ].join(' · ');
}

function renderBatches(): void {
  renderSettingsSummary();
  const total = batches.reduce((n, b) => n + b.length, 0);
  const done = batches.reduce((n, b) => n + looted(b), 0);
  const maybeCount = batches.flat().filter(possible).length;
  // Earlier flight paths get a line of their own, and only when there is something to say: the paths
  // drawn, then the reports that nearly made one and what stopped them.
  const study = earlierStudy();
  const pathNote = $('pathNote');
  // Like the lines themselves, only once zoomed in.
  pathNote.hidden = !map.detailed || (!study.paths.length && !study.near.length);
  pathNote.replaceChildren(
    ...[...study.paths.map((t) => `Possible earlier flight path (${describeTrajectory(t)}).`), ...study.near.map((why) => `${why[0].toUpperCase()}${why.slice(1)}.`)].map(
      (text) => Object.assign(document.createElement('span'), { textContent: text }),
    ),
  );
  // The line itself says what a player acts on; the rest of the tally is there on hover.
  $('stats').title = total
    ? [
        shipless ? `${fmt(shipless)} cities without a ship left out` : '',
        skipped ? `${fmt(skipped)} left out as already on the webmap` : '',
        unbatched ? `${fmt(unbatched)} without a route (faint diamonds)` : '',
        uncertainShips.size ? `${fmt(uncertainShips.size)} with an uncertain ship (marked ?)` : '',
        maybeCount ? `${fmt(maybeCount)} possibly looted (marked ?)` : '',
        state.excluded.length ? `${fmt(state.excluded.length)} looted removed from routes` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  $('stats').textContent = total
    ? `${fmt(total)} cities · ${fmt(batches.length)} routes · ${fmt(done)} looted` +
      (usedBatchSize < state.batchSize && generatedCount
        ? ` · no route of ${state.batchSize} fits here, so routes of ${usedBatchSize} were made`
        : '')
    : unbatched
      ? `No routes: ${fmt(unbatched)} cities, but no two are within the longest flight of each other. Raise the longest flight.`
      : 'No cities yet. Set a range and press Find cities.';


  // Finished routes drop out of the list, so what is left is what there is still to fly. The open
  // route stays while it is open, finished or not. Route numbers do not change: waypoints already in
  // the player's map mod keep matching.
  const finished = (b: City[]) => b.length > 0 && b.every((c) => tracker.has(c));
  const live: number[] = [];
  let hiddenCount = 0;
  for (let i = 0; i < generatedCount; i++) {
    if (finished(batches[i])) hiddenCount++;
    if (showFinished || i === selected || !finished(batches[i])) live.push(i);
  }
  const finishedNote = $('finishedNote');
  finishedNote.hidden = hiddenCount === 0;
  $('finishedCount').textContent = `${fmt(hiddenCount)} finished ${hiddenCount === 1 ? 'route' : 'routes'} ${showFinished ? 'shown' : 'hidden'}`;
  $('finishedToggle').textContent = showFinished ? 'hide' : 'show';

  const pages = Math.max(1, Math.ceil(live.length / PAGE_SIZE));
  // Jump to the selected batch's page when the selection changes, e.g. after clicking a city on the map.
  if (selected !== pageFollowed) {
    pageFollowed = selected;
    if (selected !== null && !isCustom(selected)) page = Math.floor(live.indexOf(selected) / PAGE_SIZE);
  }
  page = Math.max(0, Math.min(page, pages - 1));
  const onPage = live.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  $('pager').hidden = pages === 1;
  // One entry per page, named by the batches on it, so any page is one pick away.
  const pageSelect = $<HTMLSelectElement>('pageSelect');
  pageSelect.replaceChildren(
    ...Array.from({ length: pages }, (_, p) => {
      const from = live[p * PAGE_SIZE];
      const to = live[Math.min((p + 1) * PAGE_SIZE, live.length) - 1];
      return new Option(`${from + 1}–${to + 1}`, String(p));
    }),
  );
  pageSelect.value = String(page);
  $<HTMLButtonElement>('pagePrev').disabled = page === 0;
  $<HTMLButtonElement>('pageNext').disabled = page === pages - 1;
  $<HTMLInputElement>('gotoBatch').max = String(generatedCount);

  // Custom batches stay pinned above whichever page of generated batches is showing.
  const shown: number[] = [];
  for (let i = generatedCount; i < batches.length; i++) shown.push(i);
  shown.push(...onPage);

  const list = $('batches');
  list.replaceChildren(
    ...shown.map((i) => {
      const batch = batches[i];
      const li = document.createElement('li');
      li.classList.toggle('custom', isCustom(i));
      const n = looted(batch);
      li.classList.toggle('done', batch.length > 0 && n === batch.length);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-current', String(i === selected));
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = color(i);
      const name = document.createElement('span');
      name.textContent = batchTitle(i);
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = `${n}/${batch.length}`;
      // How much flying the route takes in all: getting to its first city, then the route itself.
      const start = startPoint();
      const reach = batch.length ? Math.hypot(batch[0].x - start.x, batch[0].z - start.z) : 0;
      const along = routeLength(batch);
      const round = (blocks: number) => fmt(Math.round(blocks / 100) * 100);
      const dist = document.createElement('span');
      dist.className = 'count';
      dist.textContent = batch.length ? `${round(reach + along)} blocks` : '';
      btn.title = batch.length
        ? `About ${round(reach + along)} blocks of flying in all: ${round(reach)} to reach the first city, then ${round(along)} along the route`
        : '';
      btn.append(sw, name, dist, count);
      btn.addEventListener('click', () => {
        select(i, true);
        // On a narrow screen the map and the route's details are further down the page: go there.
        if (matchMedia('(max-width: 900px)').matches) $('map').scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
      li.append(btn);
      return li;
    }),
  );
}

function renderDetail(): void {
  // Help sits over the batch without closing it, so the batch is still there to go back to.
  const showBatch = selected !== null && !helpOpen;
  $('detailEmpty').hidden = showBatch;
  $('detailBody').hidden = !showBatch;
  const back = $('helpBack');
  back.hidden = selected === null;
  if (selected !== null) back.textContent = `← Back to ${batchTitle(selected).toLowerCase()}`;
  $('help').textContent = selected !== null && helpOpen ? 'Close help' : 'How to use';
  if (selected === null) return;
  const batch = batches[selected];
  const i = selected;

  let length = 0;
  batch.forEach((c, k) => {
    if (k) length += Math.hypot(c.x - batch[k - 1].x, c.z - batch[k - 1].z);
  });
  $('detailTitle').textContent = batchTitle(i);
  $('customDelete').hidden = !isCustom(i);
  // Always there, faded when there is nothing to undo or redo, so they do not jump in and out.
  // Which of the route's cities are in doubt, and a "why?" that unfolds the reasons that apply.
  const doubts = batch.map(possibleNote).filter((n): n is string => n !== null);
  const why = $('possibleWhy');
  why.hidden = !doubts.length;
  if (doubts.length) {
    $('possibleCount').textContent = `${doubts.length} possibly looted ${doubts.length === 1 ? 'city' : 'cities'} in this route (marked ?)`;
    $('possibleReasons').replaceChildren(
      ...POSSIBLE_WHY.filter(([start]) => doubts.some((n) => n.startsWith(start))).map(([, text]) =>
        Object.assign(document.createElement('li'), { textContent: text }),
      ),
    );
  }
  $<HTMLButtonElement>('addOneUndo').disabled = !lastEdit(i);
  $<HTMLButtonElement>('routeRedo').disabled = !lastEdit(i, state.redo);
  // Nothing left to export from a route that is all looted: say so in place of the map-mod section.
  const complete = batch.length > 0 && batch.every((c) => tracker.has(c));
  $('routeDone').hidden = !complete;
  $('exportBox').hidden = complete;
  // Which city the two buttons below act on: the first one not looted yet.
  const at = batch.findIndex((c) => !tracker.has(c));
  const currentCity = $('currentCity');
  currentCity.hidden = at < 0;
  if (at >= 0) {
    currentCity.replaceChildren(
      Object.assign(document.createElement('strong'), { textContent: `Current city: ${waypointName(i, at)}` }),
      Object.assign(document.createElement('span'), { textContent: `${at + 1} of ${batch.length} · ${xzText(batch[at])}` }),
    );
  }
  ($('nextCity') as HTMLButtonElement).disabled = batch.every((c) => tracker.has(c));
  ($('nextCityAlready') as HTMLButtonElement).disabled = batch.every((c) => tracker.has(c));
  const orderedKey = orderKey(i);
  $('orderReset').hidden = isCustom(i) || !orderedKey || !state.orders?.[orderedKey];
  renderStars(batch, color(i));
  let longest = 0;
  batch.forEach((c, k) => {
    if (k) longest = Math.max(longest, Math.hypot(c.x - batch[k - 1].x, c.z - batch[k - 1].z));
  });
  // The line says what matters at a glance; the breakdown is there on hover.
  const reach = batch.length ? Math.hypot(batch[0].x - startPoint().x, batch[0].z - startPoint().z) : 0;
  const hundreds = (blocks: number) => fmt(Math.round(blocks / 100) * 100);
  $('detailMeta').textContent =
    `${batch.length} cities · ${looted(batch)} looted · about ${hundreds(length + reach)} blocks` +
    (!isCustom(i) && batch.length < usedBatchSize ? ' · short route' : '') +
    (isCustom(i) && !batch.length ? ' · right-click a city on the map to add it' : '');
  $('detailMeta').title = batch.length
    ? `${hundreds(reach)} blocks to reach the first city, then ${hundreds(length)} along the route. Longest flight between cities: ${fmt(Math.round(longest))}.`
    : '';

  $('cities').replaceChildren(
    ...batch.map((c, k) => {
      const li = document.createElement('li');
      li.classList.toggle('looted', tracker.has(c));
      li.classList.toggle('hot', c === hot);
      // The first city not looted yet is where the player is up to: the "current city" circle on the map.
      li.classList.toggle('current', c === batch.find((x) => !tracker.has(x)));
      const label = document.createElement('label');
      label.title = waypointName(i, k);
      const unsure = uncertainShips.has(cityId(c));
      if (unsure) label.title += ' · ship uncertain: it is a tight fit in this city and may not have generated';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = tracker.has(c);
      const maybeNote = possibleNote(c);
      const maybe = maybeNote !== null;
      if (maybeNote) label.title += ` · ${maybeNote}`;
      const already = tracker.showsAlready(c);
      li.classList.toggle('already', already);
      if (already) label.title += ' · looted by someone else';
      if (tracker.isShared(c)) {
        // On the shared list: looted for everyone, so it can't be unticked here.
        box.disabled = true;
        label.title += ' · on the shared looted list';
      }
      box.addEventListener('change', () => {
        recordMarks([c]);
        tracker.set(c, box.checked);
        render();
      });
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = String(k + 1);
      const xz = document.createElement('span');
      xz.className = 'xz';
      // Two halves that each stay whole: in a narrow panel the z drops to a second line, never cut off,
      // and the marks stay with it.
      const half = (text: string) => Object.assign(document.createElement('span'), { textContent: text });
      xz.append(half(`x: ${c.x},`), ' ', half(`z: ${c.z}` + (unsure || maybe ? ' ?' : '') + (already ? ' !' : '')));
      const hop = document.createElement('span');
      hop.className = 'hop';
      hop.textContent = k ? `+${fmt(Math.round(Math.hypot(c.x - batch[k - 1].x, c.z - batch[k - 1].z)))}` : 'start';
      if (!k) hop.classList.add('start');
      const chat = document.createElement('button');
      chat.type = 'button';
      chat.className = 'chat';
      chat.textContent = 'copy';
      chat.title = 'Copy this city as a chat line: paste it into Minecraft chat to make its waypoint';
      chat.classList.toggle('was-copied', copiedLines.has(copiedKey(c)));
      chat.addEventListener('click', async (e) => {
        // Inside the row's label: don't let the click tick the looted box.
        e.preventDefault();
        e.stopPropagation();
        const ok = await copyText(cityChatLine(c, i, k));
        chat.textContent = ok ? 'copied' : 'failed';
        if (ok) {
          copiedLines.add(copiedKey(c));
          chat.classList.add('was-copied');
        }
        // Lights up, then fades back while the word is showing.
        chat.classList.toggle('flash', ok);
        // The longer word takes the distance's place for a moment, so the coordinates do not move.
        hop.hidden = true;
        setTimeout(() => {
          chat.textContent = 'copy';
          chat.classList.remove('flash');
          hop.hidden = false;
        }, 1500);
      });
      // Rows can be dragged into a new order. Nothing is drawn for it until a drag is under way.
      li.draggable = batch.length > 1;
      li.addEventListener('dragstart', (e) => {
        dragFrom = k;
        e.dataTransfer?.setData('text/plain', xzText(c));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      const clearDrop = () => li.classList.remove('drop-before', 'drop-after');
      li.addEventListener('dragover', (e) => {
        if (dragFrom === null) return;
        e.preventDefault();
        const box = li.getBoundingClientRect();
        const after = e.clientY > box.top + box.height / 2;
        li.classList.toggle('drop-before', !after);
        li.classList.toggle('drop-after', after);
      });
      li.addEventListener('dragleave', clearDrop);
      li.addEventListener('dragend', () => (dragFrom = null));
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        const after = li.classList.contains('drop-after');
        clearDrop();
        const from = dragFrom;
        dragFrom = null;
        if (from === null || from === k) return;
        // Taking the row out first shifts everything after it up by one.
        const to = (after ? k + 1 : k) - (from < k ? 1 : 0);
        moveCity(i, from, to);
      });
      label.append(box, n, xz, hop, chat);
      // The same menu as right-clicking the city's dot on the map.
      const menuAt = (x: number, y: number) => {
        const city: MapCity = { city: c, batch: i, order: k, color: color(i), visited: tracker.has(c), possible: possible(c) };
        openMenu(city, x, y, c);
      };
      label.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        menuAt(e.clientX, e.clientY);
      });
      // No right-click under a finger: there, each row carries a small button for the same menu.
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'chat touch-only';
      more.textContent = '⋯';
      more.setAttribute('aria-label', 'Options for this city');
      more.addEventListener('click', (e) => {
        // Inside the row's label: don't let the tap tick the looted box.
        e.preventDefault();
        e.stopPropagation();
        const at = more.getBoundingClientRect();
        menuAt(at.left, at.bottom);
      });
      label.append(more);
      label.addEventListener('mouseenter', () => setHot(c));
      label.addEventListener('mouseleave', () => setHot(null));
      li.append(label);
      return li;
    }),
  );
}

/** Easter egg: sketch the constellation this batch most resembles over its cities. */
function renderStars(batch: City[], batchColor: string): void {
  // Matching against a few hundred figures takes a moment, so reuse the answer while the batch is unchanged.
  const key = batch.map(cityId).join(';');
  if (showStars && starCache?.key !== key) starCache = { key, match: lookalike(batch, skyFigures ?? []) };
  const match = showStars ? starCache!.match : null;
  $('stars').hidden = !match;
  if (!match) return;
  const source = document.createElement('a');
  source.href = match.source;
  source.target = '_blank';
  source.rel = 'noopener';
  source.textContent = 'source';
  $('starText').replaceChildren(`If you squint, this route looks like ${match.name} (${match.from}). `, source);
  // Some cultures add a permission that applies to Stellarium's own apps only; it says nothing about this one.
  const licence = match.license
    ?.split(' · ')
    .filter((part) => !/special permission/i.test(part))
    .join(' · ');
  $('starCredit').textContent = licence
    ? `Figure from the Stellarium sky cultures collection (licence: ${licence}). Star positions from the HYG database (CC BY-SA 4.0).`
    : 'Figure sketched by hand; not real star positions.';
  const canvas = $<HTMLCanvasElement>('starCanvas');
  const ctx = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  const all = [...match.points, ...match.stars];
  const reach = Math.max(...all.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y)))) || 1;
  const k = (Math.min(w, h) / 2 - 10) / reach;
  const at = ([x, y]: [number, number]): [number, number] => [w / 2 + x * k, h / 2 + y * k];
  ctx.fillStyle = batchColor;
  ctx.globalAlpha = 0.7;
  for (const p of match.points) {
    ctx.beginPath();
    ctx.arc(...at(p), 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#ece7f5';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [a, b] of match.lines) {
    ctx.moveTo(...at(match.stars[a]));
    ctx.lineTo(...at(match.stars[b]));
  }
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  for (const s of match.stars) {
    ctx.beginPath();
    ctx.arc(...at(s), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function render(): void {
  renderBatches();
  renderDetail();
  renderMap();
  showSurvey();
}

function setHot(c: City | null): void {
  if (hot === c) return;
  hot = c;
  renderMap();
}

function select(i: number | null, zoom = false): void {
  // Opening a batch, from the list or the map, puts the help away.
  if (i !== null) helpOpen = false;
  // Leaving a finished route is the moment to regroup what is left. The routes are numbered afresh,
  // so the one being opened is found again by one of its cities.
  if (i !== selected && retireFinished(i)) {
    const target = i !== null && batches[i].length ? cityId(batches[i][0]) : null;
    rebuild(() => {
      const at = target === null ? -1 : batches.findIndex((b) => b.some((c) => cityId(c) === target));
      selected = at < 0 ? null : at;
      if (zoom && selected !== null) map.fit(batches[selected], state.filters.maxDist);
    });
    render();
    return;
  }
  selected = i;
  render();
  if (zoom && i !== null) map.fit(batches[i], state.filters.maxDist);
}

// ---------- search ----------

const form = $<HTMLFormElement>('search');
const seedInput = $<HTMLInputElement>('seed');
const modeRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="searchMode"]')];
const aroundX = $<HTMLInputElement>('aroundX');
const aroundZ = $<HTMLInputElement>('aroundZ');
/** The position typed into the two coordinate fields, or null while either is empty. */
function aroundPosition(): { x: number; z: number } | null {
  if (aroundX.value.trim() === '' || aroundZ.value.trim() === '') return null;
  const [x, z] = [Number(aroundX.value), Number(aroundZ.value)];
  return Number.isFinite(x) && Number.isFinite(z) ? { x: Math.round(x), z: Math.round(z) } : null;
}
function setAroundPosition(pos: { x: number; z: number }): void {
  aroundX.value = String(pos.x);
  aroundZ.value = String(pos.z);
  aroundX.setCustomValidity('');
}
const nearX = $<HTMLInputElement>('nearX');
const nearZ = $<HTMLInputElement>('nearZ');
const aroundRadius = $<HTMLInputElement>('aroundRadius');
/** Whether the form is set to search around a position rather than outward from 0,0. */
const aroundMode = () => modeRadios.some((r) => r.checked && r.value === 'around');
function showSearchMode(): void {
  for (const r of modeRadios) r.parentElement!.classList.toggle('on', r.checked);
  document.body.classList.toggle('around-mode', aroundMode());
}
const minInput = $<HTMLInputElement>('minDist');
const maxInput = $<HTMLInputElement>('maxDist');
const diagInput = $<HTMLInputElement>('diag');
const angleFromSelect = $<HTMLSelectElement>('angleFrom');
const quadBoxes = [...document.querySelectorAll<HTMLInputElement>('#quadrants input')];
const findBtn = $<HTMLButtonElement>('find');
const progress = $<HTMLProgressElement>('progress');

function fillForm(): void {
  seedInput.value = state.seed;
  showSeedReset();
  for (const r of modeRadios) r.checked = (r.value === 'around') === !!state.filters.around;
  if (state.filters.around) {
    setAroundPosition(state.filters.around);
    aroundRadius.value = String(state.filters.around.radius);
  }
  showSearchMode();
  minInput.value = String(state.filters.minDist);
  maxInput.value = String(state.filters.maxDist);
  diagInput.value = String(state.filters.diagonalDeg);
  angleFromSelect.value = state.filters.angleFrom ?? 'diagonal';
  for (const b of quadBoxes) b.checked = state.filters.quadrants.includes(b.value as Quadrant);
  showDiag();
  showQuickSpawn();
}

/** The search as currently set in the form, applied or not. */
function formFilters(): Filters {
  const pos = aroundPosition();
  const radius = Number(aroundRadius.value);
  return {
    around: aroundMode() && pos && radius > 0 ? { x: pos.x, z: pos.z, radius } : undefined,
    minDist: Number(minInput.value),
    maxDist: Number(maxInput.value),
    diagonalDeg: Number(diagInput.value),
    angleFrom: angleFromSelect.value as Filters['angleFrom'],
    quadrants: quadBoxes.filter((b) => b.checked).map((b) => b.value as Quadrant),
  };
}

function showDiag(): void {
  const v = Number(diagInput.value);
  // At 45° every direction is within range of both, so the choice of lines no longer matters.
  $('diagOut').textContent = v >= 45 ? '45° (every direction)' : `${v}°`;
}
diagInput.addEventListener('input', showDiag);

/** Hide or show the parts of the page that only apply to the About Oliver server's world. */
function showSeedMode(): void {
  document.body.classList.toggle('other-seed', state.seed !== DEFAULT_SEED);
}
showSeedMode();

/** Zoom the map to the whole area a search covers. */
function fitSearch(f: Filters): void {
  const b = searchBounds(f);
  map.fit([{ x: b.x0, z: b.z0 }, { x: b.x1, z: b.z1 }], f.maxDist);
}

/** A custom route to open once the search under way has its routes: the survey's. */
let openCustomAfterSearch: number | null = null;

/** Take a finished search as the new state. Nothing changes until this runs, so a cancelled search leaves no trace. */
function applyResult(seed: string, filters: Filters, cities: FoundCity[]): void {
  const refit =
    seed !== state.seed ||
    filters.maxDist !== state.filters.maxDist ||
    JSON.stringify(filters.around) !== JSON.stringify(state.filters.around) ||
    !state.found.length;
  if (seed !== state.seed) {
    // Hand-added positions belong to the old world.
    state.imported = [];
    state.excluded = [];
    state.moved = {};
    state.appended = [];
    state.dropped = [];
    state.extra = [];
    state.orders = {};
    state.edits = [];
    state.redo = [];
    state.custom = [];
    tracker = new Tracker(seed);
    tracker.setShared(seed === DEFAULT_SEED ? sharedLooted : [], seed === DEFAULT_SEED ? sharedAlready : [], seed === DEFAULT_SEED ? sharedBy : {});
  }
  state.seed = seed;
  state.filters = filters;
  showSeedMode();
  state.found = cities;
  save();
  selected = null;
  fillForm();
  showExploredNote();
  if (refit) fitSearch(filters);
  if (foldWhenDone && cities.length) settings.open = false;
  foldWhenDone = false;
  rebuild(() => {
    if (openCustomAfterSearch !== null) {
      selected = generatedCount + openCustomAfterSearch < batches.length ? generatedCount + openCustomAfterSearch : null;
      openCustomAfterSearch = null;
    }
    if (!locateAfterSearch) return;
    const pos = locateAfterSearch;
    locateAfterSearch = null;
    if (!openNearest(pos, 'Searched around your position. ')) {
      locateNote.textContent = 'No route near your position. Try a larger radius or a longer flight limit.';
      renderMap();
    }
  });
  render();
}

/** Roughly how many ship cities a search covers, from its area alone. */
function estimateShips(f: Filters): number {
  if (f.around) return Math.round(Math.PI * f.around.radius ** 2 * SHIP_DENSITY);
  const band = 4 * (f.maxDist ** 2 - f.minDist ** 2);
  const angle = f.diagonalDeg >= 45 ? 1 : f.diagonalDeg / 45;
  return Math.round(band * (f.quadrants.length / 4) * angle * SHIP_DENSITY);
}

/**
 * Refuse a search that covers too many cities, explaining how to narrow it. The previous
 * result stays in place. Returns whether the search was refused.
 */
function tooBig(ships: number): boolean {
  const warning = $('searchWarning');
  if (ships <= MAX_SEARCH_CITIES) {
    warning.hidden = true;
    return false;
  }
  // The advice names the controls of whichever kind of search is in use.
  $('narrowBand').hidden = aroundMode();
  $('narrowAround').hidden = !aroundMode();
  $('searchWarningText').textContent =
    `That search covers about ${fmt(Math.round(ships / 1000) * 1000)} cities, more than the ` +
    `${fmt(MAX_SEARCH_CITIES)} that can be routed at once.`;
  warning.hidden = false;
  foldWhenDone = false;
  settings.open = true;
  return true;
}

function endSearch(): void {
  worker?.terminate();
  worker = null;
  findBtn.textContent = 'Find cities';
  findBtn.classList.remove('busy');
  progress.hidden = true;
}

const settings = $<HTMLDetailsElement>('settings');
/** Set when the search button itself was pressed, so the settings fold away once the results are in. */
let foldWhenDone = false;

form.addEventListener('submit', (e) => {
  e.preventDefault();
  // While a search is running the button cancels it; the previous results stay as they were.
  if (worker) {
    if (confirm('Cancel the search? The cities already shown will stay as they are.')) {
      endSearch();
      locateAfterSearch = null;
    }
    return;
  }
  // Changing a control re-runs an instant search with no submitter; only fold for a deliberate press.
  foldWhenDone = e.submitter !== null;
  const filters = formFilters();
  if (aroundMode() && !filters.around) {
    const field = aroundPosition() ? aroundRadius : aroundX.value.trim() === '' ? aroundX : aroundZ;
    field.setCustomValidity(field === aroundRadius ? 'Enter a radius in blocks.' : 'Enter both x and z.');
    field.reportValidity();
    return;
  }
  if (!filters.around && filters.maxDist <= filters.minDist) {
    maxInput.setCustomValidity('Must be larger than the starting distance.');
    maxInput.reportValidity();
    return;
  }
  if (!filters.around && !filters.quadrants.length) {
    // The quadrants are folded away under Fine tuning: open it so the message has somewhere to show.
    $<HTMLDetailsElement>('fineTuning').open = true;
    quadBoxes[0].setCustomValidity('Pick at least one quadrant.');
    quadBoxes[0].reportValidity();
    return;
  }
  const seed = seedInput.value.trim();
  if (!/^-?\d+$/.test(seed)) {
    // The field is inside a folded section; open it so the message can be shown.
    $<HTMLDetailsElement>('advanced').open = true;
    seedInput.setCustomValidity('A world seed is a whole number.');
    seedInput.reportValidity();
    return;
  }

  // Within the pre-generated range a search is just a filter.
  if (precomputed?.covers(seed, filters)) {
    const found = precomputed.search(filters);
    if (!tooBig(found.filter((c) => c[2]).length)) applyResult(seed, filters, found);
    return;
  }
  // A live search can take a long time, so judge its size from the area before starting it.
  if (tooBig(estimateShips(filters))) return;

  // The built worker is a plain script, which every browser can start. Only the dev server serves it as a module.
  worker = import.meta.env.DEV
    ? new Worker(new URL('./generation/worker.ts', import.meta.url), { type: 'module' })
    : new Worker(new URL('./generation/worker.ts', import.meta.url));
  findBtn.textContent = 'Cancel search';
  findBtn.classList.add('busy');
  progress.hidden = false;
  progress.value = 0;
  const finish = endSearch;
  worker.addEventListener('message', (ev: MessageEvent<FindResponse>) => {
    if (ev.data.type === 'progress') {
      progress.value = ev.data.fraction;
      return;
    }
    finish();
    if (!tooBig(ev.data.cities.filter((c) => c[2]).length)) applyResult(seed, filters, ev.data.cities);
  });
  worker.addEventListener('error', (ev) => {
    finish();
    $('stats').textContent = `Search failed: ${ev.message}`;
  });
  worker.postMessage({ seed, filters } satisfies FindRequest);
});
for (const el of [seedInput, maxInput, ...quadBoxes]) el.addEventListener('input', () => el.setCustomValidity(''));

// Back to the server's own world, searched straight away.
const seedReset = $<HTMLButtonElement>('seedReset');
const showSeedReset = () => (seedReset.disabled = seedInput.value.trim() === DEFAULT_SEED);
seedInput.addEventListener('input', showSeedReset);
seedReset.addEventListener('click', () => {
  seedInput.value = DEFAULT_SEED;
  seedInput.setCustomValidity('');
  showSeedReset();
  if (state.seed !== DEFAULT_SEED) form.requestSubmit();
});

// Redraw the shaded search area while a control is being moved, before anything is applied.
for (const el of [minInput, maxInput, diagInput, angleFromSelect, aroundX, aroundZ, aroundRadius, ...quadBoxes]) {
  el.addEventListener('input', renderMap);
}
// A typed number snaps to the nearest step its field accepts (500 blocks for distances and the radius,
// 250 for flight limits), so an in-between value never blocks the search. Listening in the capture
// phase means this runs before the handlers that read the value.
form.addEventListener(
  'change',
  (e) => {
    const field = e.target;
    if (!(field instanceof HTMLInputElement) || field.type !== 'number' || field.value.trim() === '') return;
    const step = Number(field.step) || 1;
    const min = field.min === '' ? -Infinity : Number(field.min);
    const max = field.max === '' ? Infinity : Number(field.max);
    const typed = Number(field.value);
    if (!Number.isFinite(typed)) return;
    field.value = String(Math.min(max, Math.max(min, Math.round(typed / step) * step)));
  },
  true,
);
for (const el of [aroundX, aroundZ, aroundRadius]) el.addEventListener('input', () => el.setCustomValidity(''));
for (const r of modeRadios) {
  r.addEventListener('change', () => {
    showSearchMode();
    // Starting an around-search with the position already given on the map saves typing it twice.
    if (aroundMode() && !aroundPosition() && you) setAroundPosition(you);
    renderMap();
    if (formCovered() && form.checkValidity() && (!aroundMode() || formFilters().around)) form.requestSubmit();
  });
}
$('aroundUseMap').addEventListener('click', () => {
  const pos = you ?? locatePosition();
  if (!pos) {
    aroundX.setCustomValidity('Type your position into the x and z boxes on the map first, or enter it here.');
    aroundX.reportValidity();
    return;
  }
  setAroundPosition(pos);
  renderMap();
  if (formCovered() && formFilters().around) form.requestSubmit();
});

// Instant searches are applied as the controls change; slow ones wait for the button.
function formCovered(): boolean {
  return !!precomputed && !worker && precomputed.covers(seedInput.value.trim(), previewFilters());
}
for (const el of [minInput, maxInput, diagInput, angleFromSelect, aroundX, aroundZ, aroundRadius, ...quadBoxes]) {
  el.addEventListener('change', () => {
    if (aroundMode() && !formFilters().around) return;
    if (formCovered() && form.checkValidity()) form.requestSubmit();
  });
}

const gotoBatch = $<HTMLInputElement>('gotoBatch');
gotoBatch.addEventListener('change', () => {
  const n = Math.round(Number(gotoBatch.value));
  gotoBatch.value = '';
  // Out-of-range numbers go to the nearest end of the list.
  if (Number.isFinite(n) && generatedCount) select(Math.min(generatedCount, Math.max(1, n)) - 1, true);
});

$('finishedToggle').addEventListener('click', () => {
  showFinished = !showFinished;
  renderBatches();
});
$<HTMLSelectElement>('pageSelect').addEventListener('change', (e) => {
  page = Number((e.target as HTMLSelectElement).value);
  renderBatches();
});

$('pagePrev').addEventListener('click', () => {
  page--;
  renderBatches();
});
$('pageNext').addEventListener('click', () => {
  page++;
  renderBatches();
});

$('starBtn').addEventListener('click', async () => {
  showStars = !showStars;
  if (showStars && !skyFigures) {
    skyFigures = await loadSkyFigures();
    starCache = null;
  }
  renderDetail();
});

// ---------- regroup ----------

/**
 * Finished routes are regrouped away without being asked: their looted cities leave the routes and the
 * cities that remain are grouped afresh. It waits while any other route is part-way through, since
 * regrouping would break that route up under the player. `keep` is a route being opened on purpose.
 * Returns whether there is anything to rebuild.
 */
function retireFinished(keep: number | null): boolean {
  const routes = batches.slice(0, generatedCount);
  const done = (b: City[]) => b.length > 0 && b.every((c) => tracker.has(c));
  const finished = routes.filter((b, i) => i !== keep && done(b));
  if (!finished.length) return false;
  if (routes.some((b) => !done(b) && b.some((c) => tracker.has(c)))) return false;
  state.excluded = [...new Set([...state.excluded, ...finished.flat().map(cityId)])];
  save();
  return true;
}

// ---------- locate ----------

const locateForm = $<HTMLFormElement>('locate');
const locateX = $<HTMLInputElement>('locateX');
const locateZ = $<HTMLInputElement>('locateZ');
/** The coordinates typed into the two boxes on the map, or null while either is empty. */
function locatePosition(): { x: number; z: number } | null {
  if (locateX.value.trim() === '' || locateZ.value.trim() === '') return null;
  const [x, z] = [Number(locateX.value), Number(locateZ.value)];
  return Number.isFinite(x) && Number.isFinite(z) ? { x: Math.round(x), z: Math.round(z) } : null;
}
function setLocate(pos: { x: number; z: number } | null): void {
  locateX.value = pos ? String(pos.x) : '';
  locateZ.value = pos ? String(pos.z) : '';
}

/**
 * Coordinates are entered as separate x and z boxes, but are often copied as one piece of text
 * ("x: 100, z: -200", "100 64 -200"). Pasting such text into either box of a pair fills both.
 */
function pasteIntoBoth(xBox: HTMLInputElement, zBox: HTMLInputElement): void {
  for (const box of [xBox, zBox]) {
    box.addEventListener('paste', (e) => {
      const pos = parseCoordinates(e.clipboardData?.getData('text') ?? '')[0];
      // A single number is left to paste normally into the box it was aimed at.
      if (!pos) return;
      e.preventDefault();
      xBox.value = String(pos.x);
      zBox.value = String(pos.z);
      // Tell anything watching the boxes that they changed.
      xBox.dispatchEvent(new Event('input', { bubbles: true }));
      zBox.dispatchEvent(new Event('input', { bubbles: true }));
      zBox.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
}
pasteIntoBoth(locateX, locateZ);
pasteIntoBoth(aroundX, aroundZ);
const locateNote = $('locateNote');

/** Open the batch holding the nearest city worth visiting. Returns false when there is none. */
function openNearest(pos: { x: number; z: number }, prefix = ''): boolean {
  // Prefer a city that is not looted; fall back to any city if everything is.
  let best: { batch: number; order: number; d: number } | null = null;
  for (const onlyFresh of [true, false]) {
    batches.forEach((batch, b) =>
      batch.forEach((c, k) => {
        if (onlyFresh && tracker.has(c)) return;
        const d = Math.hypot(c.x - pos.x, c.z - pos.z);
        if (!best || d < best.d) best = { batch: b, order: k, d };
      }),
    );
    if (best) break;
  }
  const hit = best as { batch: number; order: number; d: number } | null;
  if (!hit) return false;
  locateNote.textContent = `${prefix}Nearest: ${waypointName(hit.batch, hit.order)}, ${fmt(Math.round(hit.d))} blocks away.`;
  select(hit.batch);
  map.fit([...batches[hit.batch], pos], state.filters.maxDist);
  return true;
}

/** Set while a search around the player's position is running, so the nearest batch is opened once it lands. */
let locateAfterSearch: { x: number; z: number } | null = null;

locateForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const pos = locatePosition();
  if (!pos) {
    locateNote.textContent = 'Enter both x and z.';
    return;
  }
  you = { x: pos.x, z: pos.z };
  // Inside the area already searched, the nearest batch is among the ones on screen.
  if (passes(pos.x, pos.z, state.filters) && openNearest(you)) return;

  // Otherwise the current search does not cover where the player is: search around them instead.
  searchAround(you);
});

/** Search around a position and open the route nearest it, whatever the search was showing before. */
function searchAround(pos: { x: number; z: number }): void {
  you = { x: pos.x, z: pos.z };
  setLocate(you);
  for (const r of modeRadios) r.checked = r.value === 'around';
  showSearchMode();
  setAroundPosition(you);
  if (!(Number(aroundRadius.value) > 0)) aroundRadius.value = '10000';
  locateNote.textContent = 'Searching around your position…';
  locateAfterSearch = you;
  form.requestSubmit();
  // A refused or invalid search never reports back, so don't leave the request hanging.
  if (!worker && locateAfterSearch) {
    locateAfterSearch = null;
    locateNote.textContent = 'Could not search around that position. Check the search settings.';
    renderMap();
  }
}

// The other quick search: the band around End Spawn, as set under Search settings. Its label says how
// far out that is, since the default leaves out the picked-over first 10,000 blocks.
function showQuickSpawn(): void {
  const [from, to] = [Number(minInput.value), Number(maxInput.value)];
  const range = Number.isFinite(from) && Number.isFinite(to) && to > from ? `${fmt(from)}–${fmt(to)} blocks out` : '';
  $('quickSpawn').replaceChildren('Search near End Spawn', Object.assign(document.createElement('small'), { textContent: range }));
  // The obvious first thing to press, until there are routes to work through.
  $('quickSpawn').classList.toggle('primary', state.found.length === 0);
}
for (const el of [minInput, maxInput]) {
  el.addEventListener('input', showQuickSpawn);
  el.addEventListener('change', showQuickSpawn);
}
showQuickSpawn();
$('quickSpawn').addEventListener('click', () => {
  for (const r of modeRadios) r.checked = r.value === 'band';
  showSearchMode();
  renderMap();
  form.requestSubmit();
});

// "Search near me", always in reach under the search settings even while they are folded away.
// Its boxes show where the map's crosshair is and follow it as the map moves, until the player types
// coordinates of their own; emptying the boxes hands them back to the crosshair.
let nearTyped = false;
function showNearDefault(): void {
  if (nearTyped) return;
  nearX.value = String(viewCentre.x);
  nearZ.value = String(viewCentre.z);
}
for (const el of [nearX, nearZ]) {
  el.addEventListener('input', () => {
    nearX.setCustomValidity('');
    nearTyped = nearX.value.trim() !== '' || nearZ.value.trim() !== '';
    if (!nearTyped) showNearDefault();
  });
}
$<HTMLFormElement>('nearMe').addEventListener('submit', (e) => {
  e.preventDefault();
  const typed =
    nearX.value.trim() !== '' && nearZ.value.trim() !== '' && Number.isFinite(Number(nearX.value)) && Number.isFinite(Number(nearZ.value))
      ? { x: Math.round(Number(nearX.value)), z: Math.round(Number(nearZ.value)) }
      : null;
  if (!typed) {
    nearX.setCustomValidity('Enter an x and a z.');
    nearX.reportValidity();
    return;
  }
  // The search recentres the map, and the boxes go back to following the crosshair from there.
  nearTyped = false;
  searchAround(typed);
});

// Jump the map to typed coordinates, leaving the open route and the player's position as they are.
$('locateGo').addEventListener('click', () => {
  const pos = locatePosition();
  if (!pos) {
    locateNote.textContent = 'Enter both x and z.';
    return;
  }
  pin = { x: pos.x, z: pos.z };
  locateNote.textContent = '';
  renderMap();
  map.goTo(pos.x, pos.z);
});

// One reset for the map's coordinates row: the boxes, the markers they left, and the view back to 0,0.
$('locateClear').addEventListener('click', () => {
  you = null;
  pin = null;
  setLocate(null);
  locateNote.textContent = '';
  renderMap();
  map.centreOn(0, 0);
});

// ---------- webmap ----------

const sizeInput = $<HTMLInputElement>('batchSize');
sizeInput.max = String(MAX_BATCH_SIZE);
sizeInput.value = String(state.batchSize);
sizeInput.addEventListener('change', () => {
  const n = Math.round(Number(sizeInput.value));
  state.batchSize = Math.min(MAX_BATCH_SIZE, Math.max(1, Number.isFinite(n) ? n : BATCH_SIZE));
  sizeInput.value = String(state.batchSize);
  save();
  selected = null;
  rebuild();
  render();
});

const hopInput = $<HTMLInputElement>('maxHop');
hopInput.value = String(state.maxHop);
hopInput.addEventListener('change', () => {
  const n = Math.round(Number(hopInput.value));
  state.maxHop = Number.isFinite(n) && n > 0 ? n : 0;
  hopInput.value = String(state.maxHop);
  save();
  selected = null;
  rebuild();
  render();
});

const deviationInput = $<HTMLInputElement>('lineDeviation');
/** The sideways limit only means something for lines. */
function showDeviation(): void {
  $('lineDeviationBox').hidden = state.batchShape !== 'line';
}
deviationInput.value = String(state.lineDeviation);
deviationInput.addEventListener('change', () => {
  const n = Math.round(Number(deviationInput.value));
  state.lineDeviation = Number.isFinite(n) && n > 0 ? n : 0;
  deviationInput.value = String(state.lineDeviation);
  save();
  selected = null;
  rebuild();
  render();
});
showDeviation();

const shapeSelect = $<HTMLSelectElement>('batchShape');
shapeSelect.value = state.batchShape;
shapeSelect.addEventListener('change', () => {
  state.batchShape = shapeSelect.value as BatchShape;
  showDeviation();
  save();
  selected = null;
  rebuild();
  render();
});

const fingerBox = $<HTMLInputElement>('oneFingerMap');
fingerBox.checked = !!state.oneFingerMap;
map.oneFingerPan = fingerBox.checked;
fingerBox.addEventListener('change', () => {
  state.oneFingerMap = fingerBox.checked;
  map.oneFingerPan = fingerBox.checked;
  save();
  showBackToMap();
});

const mappedBox = $<HTMLInputElement>('includeMapped');
mappedBox.checked = !!state.includeMapped;
mappedBox.addEventListener('change', () => {
  state.includeMapped = mappedBox.checked;
  save();
  selected = null;
  rebuild();
  render();
  showExploredNote();
});

const possibleBox = $<HTMLInputElement>('skipPossible');
possibleBox.checked = !!state.skipPossible;
possibleBox.addEventListener('change', () => {
  state.skipPossible = possibleBox.checked;
  save();
  selected = null;
  rebuild();
  render();
});

// ---------- dev mode: the survey ----------
// Tools for working on the app, out of the way under Advanced. The survey picks a spread-out random
// sample of the ships near End Spawn and makes a custom route of them; what the hunter finds there
// says how many of the rest were looted before anyone kept a record.

/** How many cities a survey visits. */
const SURVEY_SIZE = 30;
const devBox = $<HTMLInputElement>('devMode');
devBox.checked = !!state.devMode;
$('devTools').hidden = !devBox.checked;
devBox.addEventListener('change', () => {
  state.devMode = devBox.checked;
  $('devTools').hidden = !devBox.checked;
  save();
  showSurvey();
});

/** How the survey stands: how many of its cities are checked, and what that says so far. */
function showSurvey(): void {
  const note = $('surveyNote');
  const survey = state.seed === DEFAULT_SEED ? state.survey : undefined;
  if (!survey?.ids.length) {
    note.textContent = '';
    return;
  }
  const at = survey.ids.map((id) => {
    const [x, z] = id.split(',').map(Number);
    return { x, z };
  });
  const checked = at.filter((c) => tracker.has(c));
  const already = checked.filter((c) => tracker.isAlready(c)).length;
  const est = surveyEstimate(checked.length, already, survey.frame);
  note.textContent =
    `${checked.length} of ${survey.ids.length} checked, picked from ${fmt(survey.frame)} ships.` +
    (est
      ? ` ${already} looted by someone else: ${Math.round(est.rate * 100)}%, give or take ${Math.round(est.margin * 100)}.`
      : '');
}

$('surveyMake').addEventListener('click', () => {
  const note = $('surveyNote');
  if (worker) return;
  const filters: Filters = { minDist: 0, maxDist: NEAR_SPAWN_BLOCKS, diagonalDeg: 45, quadrants: ['NE', 'NW', 'SE', 'SW'] };
  if (!precomputed?.covers(DEFAULT_SEED, filters)) {
    note.textContent = 'The list of cities has not loaded. Try again in a moment.';
    return;
  }
  if (state.survey?.ids.length && !confirm('Replace the current survey with a new one? Your looted marks are kept.')) return;
  const found = precomputed.search(filters);
  // Only ships nobody has an answer for yet: certain ones, off the webmap, not looted and not reported missing.
  const open = found
    .filter((c) => c[2] === 1)
    .map((c) => ({ x: c[0], z: c[1] }))
    .filter((c) => !tracker.has(c) && !shipReports.gone.has(cityId(c)) && !explored?.isMapped(c.x, c.z));
  const ids = surveySample(open, SURVEY_SIZE, NEAR_SPAWN_BLOCKS).map(cityId);
  if (!ids.length) {
    note.textContent = 'There are no unchecked ships left within 10,000 blocks of End Spawn.';
    return;
  }
  // The survey before this one gives up its route.
  const old = new Set(state.survey?.ids ?? []);
  state.custom = state.custom.filter((route) => !route.length || !route.every((id) => old.has(id)));
  state.custom.push(ids);
  state.survey = { ids, frame: open.length };
  openCustomAfterSearch = state.custom.length - 1;
  for (const r of modeRadios) r.checked = r.value === 'band';
  seedInput.value = DEFAULT_SEED;
  applyResult(DEFAULT_SEED, filters, found);
  showSearchMode();
});

// Put every search setting back to how a first-time visitor finds it, and search again.
$('searchReset').addEventListener('click', () => {
  if (worker) return;
  if (
    !confirm(
      'Reset all search settings to their defaults? Your looted marks are kept. Custom routes are kept too, unless the world seed had been changed.',
    )
  ) {
    return;
  }
  state.batchSize = BATCH_SIZE;
  state.batchShape = 'cluster';
  state.maxHop = DEFAULT_MAX_HOP;
  state.lineDeviation = DEFAULT_LINE_DEVIATION;
  state.skipPossible = false;
  possibleBox.checked = false;
  state.includeMapped = false;
  mappedBox.checked = false;
  showExploredNote();
  sizeInput.value = String(state.batchSize);
  shapeSelect.value = state.batchShape;
  hopInput.value = String(state.maxHop);
  deviationInput.value = String(state.lineDeviation);
  showDeviation();
  // Fill the form from the defaults without touching the applied search, so the search below sees a change.
  const applied = { seed: state.seed, filters: state.filters };
  state.seed = DEFAULT_SEED;
  state.filters = { ...DEFAULT_FILTERS, quadrants: [...DEFAULT_FILTERS.quadrants] };
  fillForm();
  state.seed = applied.seed;
  state.filters = applied.filters;
  $('searchWarning').hidden = true;
  save();
  form.requestSubmit();
  // If the search itself was already the default one, nothing re-ran, so regroup with the reset batch settings.
  selected = null;
  rebuild();
  render();
});

function showExploredNote(): void {
  const note = $('exploredNote');
  if (!explored) {
    note.textContent = 'No webmap data loaded, so cities already on the webmap could not be left out.';
    return;
  }
  // The data's own date only moves when the webmap changes. Where the time of the last check is known,
  // that is the one to show: the data was still right then.
  const changed = Date.parse(explored.fetchedAt);
  const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  note.textContent =
    `Cities already on the webmap are ${state.includeMapped ? 'included in' : 'left out of'} the routes. ` +
    (webmapChecked !== null ? `Webmap last checked ${when(Math.max(webmapChecked, changed))}.` : `Webmap data from ${when(changed)}.`);
}

/** When the webmap was last checked for changes, once that has been looked up. */
let webmapChecked: number | null = null;
// Asked of the published site only: a copy run from a checkout may hold older data than the last check saw.
if (!import.meta.env.DEV) {
  fetch(WEBMAP_CHECKS_URL)
    .then((res) => (res.ok ? res.json() : null))
    .then((list) => {
      const t = Date.parse(list?.workflow_runs?.[0]?.run_started_at ?? '');
      if (!Number.isFinite(t)) return;
      webmapChecked = t;
      showExploredNote();
    })
    .catch(() => {});
}

// ---------- export ----------

function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const selectedLines = (): string[] =>
  selected === null ? [] : waypointLines(batches[selected], selected, (c) => tracker.has(c));

$('download').addEventListener('click', () => {
  if (selected !== null) download(`end-cities-route-${selected + 1}.txt`, waypointFile(selectedLines()));
});

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Copy on click, with the button briefly reporting how it went. */
function copyButton(id: string, text: () => string): void {
  const btn = $(id);
  const label = btn.textContent;
  btn.addEventListener('click', async () => {
    btn.textContent = (await copyText(text())) ? 'Copied' : 'Copy failed';
    setTimeout(() => (btn.textContent = label), 1500);
  });
}

copyButton('copy', () => selectedLines().join('\n') + '\n');
/** City k of route i as a chat line the chosen map mod turns into a waypoint. */
function cityChatLine(c: City, i: number, k: number): string {
  const name = waypointName(i, k);
  return state.mapMod === 'xaero'
    ? shareLine(c, name, k < 99 ? String(k + 1) : 'EC', batchColor(i), state.chatName)
    : chatLine(c, name, state.chatName);
}
// Chat lines are copied a city at a time with the copy button on each row of the route's list, because
// Minecraft's chat sends a single message per paste. Rows already copied this visit are remembered,
// so the player can see how far down the list they have got.
const copiedLines = new Set<string>();
const copiedKey = (c: City) => `${state.mapMod}:${cityId(c)}`;

const modRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="mapMod"]')];
function showMapMod(): void {
  for (const r of modRadios) {
    r.checked = r.value === state.mapMod;
    // A class, not the CSS :has() selector, so the highlight also works in browsers from before 2023.
    r.parentElement!.classList.toggle('on', r.checked);
  }
  $('xaeroPanel').hidden = state.mapMod !== 'xaero';
  $('journeymapPanel').hidden = state.mapMod !== 'journeymap';
  $('chatModNote').textContent =
    state.mapMod === 'xaero'
      ? 'Press Add on the waypoint that appears in chat.'
      : 'Click the coordinates that appear in chat to make the waypoint.';
  showChatHint();
}
for (const r of modRadios) {
  r.addEventListener('change', () => {
    state.mapMod = r.value as Saved['mapMod'];
    save();
    showMapMod();
    renderDetail();
  });
}
showMapMod();

const chatNameInput = $<HTMLInputElement>('chatName');
function showChatHint(): void {
  $('chatHint').textContent =
    (state.chatName
      ? 'The lines are whispers to yourself: only you see them.'
      : 'Without a username the lines go to public chat, where everyone sees them.') + ' Looted cities are left out.';
}
chatNameInput.value = state.chatName;
// Once a username is in, the box gives way to one line saying who the lines go to.
function showChatName(editing = false): void {
  const set = !!state.chatName && !editing;
  $('chatNameField').hidden = set;
  $('chatNameLine').hidden = !set;
  $('chatNameShown').textContent = state.chatName;
}
chatNameInput.addEventListener('input', () => {
  state.chatName = cleanUsername(chatNameInput.value);
  if (chatNameInput.value !== state.chatName) chatNameInput.value = state.chatName;
  save();
  showChatHint();
});
// Done typing: leaving the box, or Enter.
chatNameInput.addEventListener('blur', () => showChatName());
chatNameInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  chatNameInput.blur();
});
$('chatNameChange').addEventListener('click', () => {
  showChatName(true);
  chatNameInput.focus();
});
showChatName();

// The whole "get it into your map mod" section folds away, and stays as the player left it.
const exportBox = $<HTMLDetailsElement>('exportBox');
exportBox.open = state.exportOpen ?? false;
exportBox.addEventListener('toggle', () => {
  state.exportOpen = exportBox.open;
  save();
});
showChatHint();

function markAll(v: boolean): void {
  if (selected === null) return;
  recordMarks(batches[selected]);
  for (const c of batches[selected]) tracker.set(c, v);
  render();
}
$('customDelete').addEventListener('click', () => {
  if (selected === null || !isCustom(selected)) return;
  if (!confirm(`Delete ${batchTitle(selected).toLowerCase()}? Its cities go back to where they were. Looted marks are kept.`)) return;
  state.custom.splice(selected - generatedCount, 1);
  save();
  selected = null;
  rebuild();
  render();
});

$('markAll').addEventListener('click', () => markAll(true));

// Adds the city nearest the route's last stop that has no route, at the end: a quick way to fly a little further.
// Marks the city the player is at as looted, which moves "current city" on to the next one.
// With `already`, as looted by someone else before the player got there.
function nextCity(already: boolean): void {
  if (selected === null) return;
  const batch = batches[selected];
  const at = batch.findIndex((c) => !tracker.has(c));
  if (at < 0) return;
  recordMarks([batch[at]]);
  if (already) tracker.setAlready(batch[at], true);
  else tracker.set(batch[at], true);
  render();
  // Bring the new current city into view in the list.
  const next = batch.findIndex((c) => !tracker.has(c));
  document.querySelectorAll('#cities li')[next < 0 ? at : next]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
$('nextCity').addEventListener('click', () => nextCity(false));
$('nextCityAlready').addEventListener('click', () => nextCity(true));

// Changes of a kind this version does not know (saved by another version) cannot be taken back: forget them.
if (state.edits) state.edits = state.edits.filter((e) => ['add', 'order', 'marks'].includes(e.kind));
if (state.redo) state.redo = state.redo.filter((e) => ['add', 'order', 'marks', 'readd'].includes(e.kind));
// Additions made before changes were kept track of can still be taken back.
if (!state.edits && state.appended?.length) state.edits = state.appended.map((id) => ({ kind: 'add', id }));
const addOneBtn = $('addOne');
addOneBtn.addEventListener('click', () => {
  if (selected === null) return;
  const batch = batches[selected];
  let best: City | null = null;
  let bestDist = Infinity;
  let beyond: FoundCity | null = null;
  for (const o of outside) {
    if (o.missing || tracker.has(o.city)) continue;
    // Left out on purpose as probably looted: not what an extra stop should be.
    if (o.note === MAPPED_NOTE || o.note.startsWith('possibly looted')) continue;
    const last = batch[batch.length - 1];
    if (!last) break;
    const d = Math.hypot(last.x - o.city.x, last.z - o.city.z);
    if (d < bestDist) [best, bestDist] = [o.city, d];
  }
  // A city just beyond the search area is taken when it is closer than anything inside it.
  const last = batch[batch.length - 1];
  if (last) {
    const known = new Set([...batches.flat(), ...outside.map((o) => o.city)].map(cityId));
    const aomc = state.seed === DEFAULT_SEED;
    for (const found of citiesAround(last, Math.min(bestDist, BEYOND_BLOCKS))) {
      const city: City = { x: found[0], z: found[1], source: 'seed' };
      const id = cityId(city);
      if (!found[2] || known.has(id) || tracker.has(city)) continue;
      if (aomc && (shipReports.gone.has(id) || (!state.includeMapped && explored?.isMapped(city.x, city.z)))) continue;
      if (state.skipPossible && possible(city)) continue;
      const d = Math.hypot(last.x - city.x, last.z - city.z);
      if (d < bestDist) {
        [best, bestDist] = [city, d];
        beyond = found;
      }
    }
  }
  if (beyond) state.extra = [...(state.extra ?? []), beyond];
  const say = (text: string) => {
    addOneBtn.textContent = text;
    setTimeout(() => (addOneBtn.textContent = 'Add +1 city to route'), 2000);
  };
  if (!best) return say(batch.length ? 'No city without a route' : 'Add a first city from the map');
  const id = cityId(best);
  undrop(id);
  state.appended = [...(state.appended ?? []).filter((x) => x !== id), id];
  pushEdit({ kind: 'add', id });
  if (isCustom(selected)) {
    const k = selected - generatedCount;
    state.custom[k].push(id);
    delete state.moved[id];
    save();
    rebuild(() => {
      selected = generatedCount + k < batches.length ? generatedCount + k : null;
    });
    render();
    return;
  }
  // Anchored to a city that belongs to the route of its own accord, so the move survives regrouping.
  const anchor = batch.find((x) => !(cityId(x) in state.moved));
  if (!anchor) return say('No city without a route');
  state.moved[id] = cityId(anchor);
  save();
  rebuildKeeping(cityId(anchor));
});

/**
 * Carry out a recorded change on the open route: put things back as the record says. Returns the
 * record of what it just replaced, which is what undoes it again (so undo and redo are the same act).
 */
function applyEdit(i: number, edit: RouteEdit): RouteEdit {
  const reopenCustom = (k: number) => {
    save();
    rebuild(() => {
      selected = generatedCount + k < batches.length ? generatedCount + k : null;
    });
    render();
  };
  if (edit.kind === 'order') {
    const now = isCustom(i) ? [...state.custom[i - generatedCount]] : (state.orders?.[edit.key] ?? null);
    writeOrder(i, edit.key, edit.before);
    return { kind: 'order', key: edit.key, before: now };
  }
  if (edit.kind === 'marks') {
    const cities = edit.before.map(([id]) => {
      const [x, z] = id.split(',').map(Number);
      return { x, z };
    });
    const now: RouteEdit = { kind: 'marks', before: cities.map((c) => [cityId(c), tracker.isAlready(c) ? 2 : tracker.has(c) ? 1 : 0]) };
    // Each city goes back to the mark it had. Marks on the shared list are not the player's to remove.
    edit.before.forEach(([, was], n) => {
      if (was === 2) tracker.setAlready(cities[n], true);
      else {
        tracker.set(cities[n], was === 1);
        if (was === 1) tracker.setAlready(cities[n], false);
      }
    });
    // Possibly-looted cities may be in or out of the routes again.
    if (state.skipPossible) rebuildKeeping(batches[i].length ? cityId(batches[i][0]) : null);
    else render();
    // Say so when a city could not go back to not looted.
    const stuck = edit.before.filter(([, was], n) => was === 0 && tracker.isShared(cities[n])).length;
    if (stuck) {
      const note = $('routeNote');
      note.textContent = `${stuck === 1 ? '1 city stays' : `${stuck} cities stay`} looted: on the shared looted list, which is the same for everyone.`;
      note.hidden = false;
      setTimeout(() => (note.hidden = true), 6000);
    }
    return now;
  }
  const id = edit.id;
  if (edit.kind === 'add') {
    // Take the added city back out, noting how it was held so it can be put back.
    const batch = batches[i];
    const extra = state.extra?.find((c) => `${c[0]},${c[1]}` === id);
    const back: RouteEdit = { kind: 'readd', id, anchor: state.moved[id], custom: isCustom(i) ? i - generatedCount : undefined, extra };
    state.appended = (state.appended ?? []).filter((x) => x !== id);
    // One brought in from beyond the search goes back out of sight.
    if (state.extra) state.extra = state.extra.filter((c) => c !== extra);
    if (isCustom(i)) {
      const k = i - generatedCount;
      state.custom[k] = state.custom[k].filter((x) => x !== id);
      reopenCustom(k);
      return back;
    }
    const keep = batch.find((x) => !(cityId(x) in state.moved));
    delete state.moved[id];
    save();
    rebuildKeeping(keep ? cityId(keep) : null);
    return back;
  }
  // Put a city that was taken back out into the route again, at the end.
  undrop(id);
  state.appended = [...(state.appended ?? []).filter((x) => x !== id), id];
  if (edit.extra) state.extra = [...(state.extra ?? []), edit.extra];
  if (edit.custom !== undefined && state.custom[edit.custom]) {
    state.custom[edit.custom].push(id);
    delete state.moved[id];
    reopenCustom(edit.custom);
  } else if (edit.anchor) {
    state.moved[id] = edit.anchor;
    save();
    rebuildKeeping(edit.anchor);
  }
  return { kind: 'add', id };
}

// Undo takes back the latest change made by hand to the open route; redo makes it again.
$('addOneUndo').addEventListener('click', () => {
  if (selected === null) return;
  const edit = lastEdit(selected);
  if (!edit) return;
  state.edits = state.edits!.filter((e) => e !== edit);
  state.redo = [...(state.redo ?? []), applyEdit(selected, edit)].slice(-100);
  save();
  renderDetail();
});
$('routeRedo').addEventListener('click', () => {
  if (selected === null) return;
  const edit = lastEdit(selected, state.redo);
  if (!edit) return;
  state.redo = state.redo!.filter((e) => e !== edit);
  // Straight onto the list of changes: a redo must not wipe the redos still waiting behind it.
  state.edits = [...(state.edits ?? []), applyEdit(selected, edit)].slice(-100);
  save();
  renderDetail();
});

// Back to the order the route was worked out in. Cities added by hand stay, at the end.
$('orderReset').addEventListener('click', () => {
  if (selected === null) return;
  const key = orderKey(selected);
  const before = key ? state.orders?.[key] : undefined;
  if (!key || !before) return;
  pushEdit({ kind: 'order', key, before });
  writeOrder(selected, key, null);
});
$('markNone').addEventListener('click', () => markAll(false));

$('citiesExport').addEventListener('click', () => {
  const rows = batches.flatMap((batch, b) =>
    batch.map((c, k) => `${c.x},${c.z},${b + 1},${k + 1},${tracker.has(c) ? 'yes' : 'no'}`),
  );
  download('end-cities.csv', ['x,z,route,stop,looted', ...rows].join('\n') + '\n');
});

$('visitedReset').addEventListener('click', () => {
  if (!tracker.count || !confirm(`Clear all ${tracker.count} of your looted marks? This cannot be undone: press Export looted first to keep a copy.`)) return;
  tracker.clear();
  state.excluded = [];
  save();
  selected = null;
  rebuild();
  render();
});

function showSharedNote(): void {
  $('sharedNote').textContent = tracker.sharedCount
    ? `${fmt(tracker.sharedCount)} cities on the shared list so far.`
    : 'The shared list is empty so far.';
}
showSharedNote();

// ---------- ship reports ----------

/** Whether the app's own layout marks this city's ship as a tight fit, whatever has been reported since. */
const wasUncertain = (city: City) => state.found.some((c) => c[0] === city.x && c[1] === city.z && c[2] === 2);

/** Send a player's report on whether a city's ship was there, for the maintainer to review. */
async function reportShip(city: City, result: 'found' | 'missing' | 'no-city'): Promise<void> {
  const where = xzText(city);
  if (!SUBMIT_URL) {
    // Without the relay, the report is filed by hand as a GitHub issue.
    const headline = { found: 'ship found', missing: 'no ship', 'no-city': 'no End City' }[result];
    window.open(`${ISSUES_URL}/new?title=${encodeURIComponent(`Ship report: ${headline} at ${where}`)}`, '_blank', 'noopener');
    return;
  }
  locateNote.textContent = 'Sending your report…';
  try {
    const res = await fetch(SUBMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'ship',
        city: cityId(city),
        result,
        name: state.chatName,
        // Lets the maintainer see whether the app had already flagged this ship as doubtful.
        uncertain: wasUncertain(city),
      }),
    });
    const body = await res.json().catch(() => ({}));
    locateNote.textContent = res.ok ? 'Report sent for review. Thank you!' : (body.error ?? 'That did not go through. Please try again later.');
  } catch {
    locateNote.textContent = 'Could not reach the report service. Please try again later.';
  }
}

// The little window for a report: pick what was found, give a username, then send.
const reportBox = $('reportBox');
const reportForm = $<HTMLFormElement>('reportForm');
const reportName = $<HTMLInputElement>('reportName');
let reportCity: City | null = null;
/** Open the window for a city. `found` asks about a ship being present; otherwise about something missing. */
/** Ask what the player found at a city. `missing` offers "no ship" and "no city"; `found` offers "the ship is here". */
function openReport(city: City, missing: boolean, found: boolean): void {
  reportCity = city;
  $('reportWhere').textContent = `At ${xzText(city)}`;
  reportForm.reset();
  // Only the choices that fit are offered, with the first of them selected.
  for (const row of reportForm.querySelectorAll<HTMLElement>('.report-missing')) row.hidden = !missing;
  for (const row of reportForm.querySelectorAll<HTMLElement>('.report-found')) row.hidden = !found;
  reportForm.querySelector<HTMLInputElement>(`input[value="${missing ? 'missing' : 'found'}"]`)!.checked = true;
  reportName.value = state.chatName;
  reportBox.hidden = false;
  reportName.focus();
}
const closeReport = () => {
  reportBox.hidden = true;
  reportCity = null;
};
$('reportCancel').addEventListener('click', closeReport);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !reportBox.hidden) closeReport();
});
reportName.addEventListener('input', () => {
  reportName.value = cleanUsername(reportName.value);
});
reportForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const city = reportCity;
  const kind = new FormData(reportForm).get('reportKind');
  // Remembered for next time, and shared with the other places a username is asked for.
  state.chatName = reportName.value;
  save();
  closeReport();
  if (city && (kind === 'missing' || kind === 'no-city' || kind === 'found')) void reportShip(city, kind);
});

async function loadShipReports(): Promise<{ missing?: string[]; found?: string[]; noCity?: string[] }> {
  try {
    const res = await fetch('./ship-reports.json');
    return res.ok ? await res.json() : {};
  } catch {
    return {};
  }
}

// ---------- submit looted ----------

const submitName = $<HTMLInputElement>('submitName');
const submitBtn = $<HTMLButtonElement>('submitLooted');
const submitNote = $('submitNote');
$('submitBox').hidden = !SUBMIT_URL;
$('submitFallback').hidden = !!SUBMIT_URL;
// The JourneyMap username is the same person: start with it.
submitName.value = state.chatName;
submitName.addEventListener('input', () => {
  submitName.value = cleanUsername(submitName.value);
});

submitBtn.addEventListener('click', async () => {
  if (state.seed !== DEFAULT_SEED) {
    submitNote.textContent = 'The shared list is only for the default server seed.';
    return;
  }
  const already = tracker.ownAlready();
  const cities = [...new Set([...tracker.ownNew(), ...already])];
  if (!cities.length) {
    submitNote.textContent = 'Nothing new to submit: mark some cities as looted first.';
    return;
  }
  if (!confirm(`Send ${fmt(cities.length)} looted ${cities.length === 1 ? 'city' : 'cities'} for review? Once accepted they show as looted for everyone.`)) return;
  submitBtn.disabled = true;
  submitNote.textContent = 'Sending…';
  try {
    const res = await fetch(SUBMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: submitName.value, cities, already }),
    });
    const body = await res.json().catch(() => ({}));
    submitNote.textContent = res.ok
      ? `Sent ${fmt(cities.length)} for review. They will show as looted for everyone once accepted.`
      : (body.error ?? 'That did not go through. Please try again later.');
  } catch {
    submitNote.textContent = 'Could not reach the submission service. Please try again later.';
  } finally {
    submitBtn.disabled = false;
  }
});

// Names of other parts of the page in the help text bring that part into view, wherever the layout has put it.
for (const link of document.querySelectorAll<HTMLElement>('.jump')) {
  link.addEventListener('click', () => {
    const section = $(link.dataset.target!);
    // Unfold whatever the target is tucked inside, and the target itself if it folds.
    for (let el: HTMLElement | null = section; el; el = el.parentElement) {
      if (el instanceof HTMLDetailsElement) el.open = true;
    }
    if (section instanceof HTMLDetailsElement) section.querySelector('summary')?.focus({ preventScroll: true });
    else section.querySelector<HTMLElement>('input, select')?.focus({ preventScroll: true });
    section.scrollIntoView({ block: 'center', behavior: 'smooth' });
    section.classList.add('flash');
    setTimeout(() => section.classList.remove('flash'), 1200);
  });
}

$('help').addEventListener('click', () => {
  helpOpen = selected !== null && !helpOpen;
  renderDetail();
  $('detail').scrollIntoView({ block: 'start', behavior: 'smooth' });
});
$('helpBack').addEventListener('click', () => {
  helpOpen = false;
  renderDetail();
});

$('visitedExport').addEventListener('click', () => download('end-cities-looted.csv', tracker.toCsv()));

const visitedFile = $<HTMLInputElement>('visitedFile');
$('visitedImport').addEventListener('click', () => visitedFile.click());
visitedFile.addEventListener('change', async () => {
  const file = visitedFile.files?.[0];
  if (!file) return;
  tracker.mergeCsv(await file.text());
  visitedFile.value = '';
  render();
});

// ---------- map interaction ----------

map.onHover = (c, px, py) => {
  setHot(c?.city ?? null);
  if (selected !== null) {
    document.querySelectorAll('#cities li').forEach((li, k) => {
      li.classList.toggle('hot', c?.batch === selected && c?.order === k);
    });
  }
  tooltip.hidden = !c;
  if (!c) return;
  // Every tip is laid out the same: the city on the first line, and anything to know about it, muted, on a second.
  const doubt = c.possible ? possibleNote(c.city) : null;
  const why = doubt ? POSSIBLE_WHY.find(([start]) => doubt.startsWith(start))?.[1] : undefined;
  const sentence = (text: string) => `${text[0].toUpperCase()}${text.slice(1)}`;
  const status = c.missing
    ? sentence(c.note ?? 'reported missing')
    : c.visited
      ? lootedText(c.city)
      : why
        ? `Possibly looted. ${why}`
        : c.batch < 0 && c.note
          ? `Not in a route: ${c.note}`
          : '';
  tooltip.replaceChildren(
    `${c.batch >= 0 ? `${waypointName(c.batch, c.order)} · ` : ''}${xzText(c.city)}`,
    ...(status ? [Object.assign(document.createElement('div'), { className: 'why', textContent: status })] : []),
  );
  // Kept inside the map: a tip hanging over its edge makes a scroll bar flicker in and out.
  const room = $('map').getBoundingClientRect();
  // Measured from the corner, where nothing squeezes it.
  tooltip.style.left = '0px';
  tooltip.style.top = '0px';
  const left = px + 14 + tooltip.offsetWidth > room.width ? px - 14 - tooltip.offsetWidth : px + 14;
  const top = py + 14 + tooltip.offsetHeight > room.height ? py - 14 - tooltip.offsetHeight : py + 14;
  tooltip.style.left = `${Math.max(4, left)}px`;
  tooltip.style.top = `${Math.max(4, top)}px`;
};
/** Who took a looted city's elytra, as far as is known. */
function lootedText(c: City): string {
  // Found empty on arrival: the looter is unknown, whoever it was that found it so.
  if (tracker.isAlready(c)) return 'Looted by an unknown hunter';
  const who = tracker.lootedBy(c);
  if (who) return `Looted by ${who}`;
  return tracker.isShared(c) ? 'Looted' : 'Looted by you';
}

/** One line about a city on the map: its name, where it is and anything known about it. */
const cityLine = (c: MapCity): string =>
  c.batch < 0
    ? c.missing
      ? `${xzText(c.city)} · ${c.note}`
      : `${xzText(c.city)} · not in a route: ${c.note}`
    : `${waypointName(c.batch, c.order)} · ${xzText(c.city)}${c.visited ? (tracker.showsAlready(c.city) ? ' · looted by someone else' : ' · looted') : ''}` +
      (c.possible ? ` · ${possibleNote(c.city) ?? POSSIBLE_NOTE}` : '') +
      (uncertainShips.has(cityId(c.city)) ? ' · ship uncertain' : '');

// The city last clicked stays described under the map, where a hover tip cannot (there is no hover under a finger).
let picked: City | null = null;
let pickedOn: MapCity | null = null;
function showPicked(c: MapCity): void {
  picked = c.city;
  pickedOn = c;
  const extra: string[] = [];
  if (c.batch >= 0) {
    extra.push(`stop ${c.order + 1} of ${batches[c.batch].length} in ${batchTitle(c.batch)}`);
    const prev = batches[c.batch][c.order - 1];
    if (prev) extra.push(`${fmt(Math.round(Math.hypot(c.city.x - prev.x, c.city.z - prev.z)))} blocks from the stop before`);
  }
  if (you) extra.push(`${fmt(Math.round(Math.hypot(c.city.x - you.x, c.city.z - you.z)))} blocks from your position`);
  $('pickedText').textContent = [cityLine(c), ...extra].join(' · ');
  $('picked').hidden = false;
}
$('pickedCopy').addEventListener('click', async () => {
  if (!picked) return;
  const btn = $('pickedCopy');
  btn.textContent = (await copyText(xzText(picked))) ? 'copied' : 'copy failed';
  setTimeout(() => (btn.textContent = 'copy coordinates'), 1500);
});

// The same menu as a right-click on the city: the way to it on a touch screen.
$('pickedMore').addEventListener('click', () => {
  if (!pickedOn) return;
  // The city as it stands now: it may have been looted, moved or regrouped since it was tapped.
  const id = cityId(pickedOn.city);
  let now: MapCity | null = null;
  batches.forEach((batch, b) =>
    batch.forEach((city, order) => {
      if (cityId(city) === id) now = { city, batch: b, order, color: color(b), visited: tracker.has(city), possible: possible(city) };
    }),
  );
  const out = outside.find((o) => cityId(o.city) === id);
  if (!now && out) now = { city: out.city, batch: -1, order: 0, color: OUTSIDE_COLOR, visited: tracker.has(out.city), note: out.note, missing: out.missing };
  if (!now) return;
  const at = $('pickedMore').getBoundingClientRect();
  openMenu(now, at.left, at.top, pickedOn.city);
});

map.onPick = (c) => {
  showPicked(c);
  if (c.batch < 0) return;
  // A city of the route that is already open leaves the map where it is.
  if (c.batch !== selected) select(c.batch, true);
  // Light up the city's row in the route's list, without moving the page or the list.
  document.querySelectorAll('#cities li')[c.order]?.classList.add('hot');
};

// ---------- right-click menu ----------

const menu = $('menu');
const closeMenu = () => (menu.hidden = true);
document.addEventListener('pointerdown', (e) => {
  if (!menu.contains(e.target as Node)) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
});
$('map').addEventListener('wheel', closeMenu);
// It does not follow the page, so it closes when something scrolls under it.
document.addEventListener('scroll', closeMenu, true);

/** Rebuild after a change, keeping the batch that holds this city selected. */
function rebuildKeeping(id: string | null): void {
  rebuild(() => {
    selected = id === null ? null : batches.findIndex((b) => b.some((c) => cityId(c) === id));
    if (selected !== null && selected < 0) selected = null;
  });
  render();
}

/** The right-click choices for a city: looted marks and batch membership. */
function addCityItems(c: MapCity, items: [string, () => void][]): void {
  if (c.missing) {
    // Nothing to loot or route here; the one useful thing is to say the report was wrong.
    if (state.seed === DEFAULT_SEED) items.push(['Report incorrect…', () => openReport(c.city, false, true)]);
    return;
  }
  const id = cityId(c.city);
  // After a change the batches are rebuilt; keep the same one open afterwards.
  const openCustom = selected !== null && isCustom(selected) ? selected - generatedCount : -1;
  const keep = selected !== null && openCustom < 0 && batches[selected].length ? cityId(batches[selected][0]) : null;
  const reselect = (custom = openCustom) => {
    if (custom < 0) return rebuildKeeping(keep);
    rebuild(() => {
      selected = generatedCount + custom < batches.length ? generatedCount + custom : null;
    });
    render();
  };

  if (tracker.isShared(c.city)) {
    items.push(['On the shared looted list. Wrong? Report it on GitHub', () => {
      window.open(ISSUES_URL, '_blank', 'noopener');
    }]);
  } else if (c.visited) {
    if (!tracker.isAlready(c.city)) items.push(['Mark as looted by someone else', () => {
      recordMarks([c.city]);
      tracker.setAlready(c.city, true);
      reselect();
    }]);
    items.push(['Mark as not looted', () => {
      if (!confirm(`Mark the city at ${xzText(c.city)} as not looted?`)) return;
      recordMarks([c.city]);
      tracker.set(c.city, false);
      state.excluded = state.excluded.filter((x) => x !== id);
      save();
      reselect();
    }]);
  } else {
    items.push(['Mark as looted', () => {
      recordMarks([c.city]);
      tracker.set(c.city, true);
      render();
    }]);
    // Someone got here first: the cities around it may well be looted too.
    items.push(['Mark as looted by someone else', () => {
      recordMarks([c.city]);
      tracker.setAlready(c.city, true);
      reselect();
    }]);
  }

  // Reports go to the maintainer for review; nothing changes for anyone until one is accepted.
  if (state.seed === DEFAULT_SEED) {
    items.push(['Report incorrect…', () => openReport(c.city, true, uncertainShips.has(id))]);
  }

  const inCustom = state.custom.findIndex((ids) => ids.includes(id));
  /** Put the city in custom batch k (a new one when k is past the end), taking it out of any other. */
  const addToCustom = (k: number) => {
    state.custom = state.custom.map((ids) => ids.filter((x) => x !== id));
    if (k >= state.custom.length) state.custom.push([]);
    state.custom[k].push(id);
    delete state.moved[id];
    undrop(id);
    save();
    reselect(k);
  };

  // A looted city has nothing left to collect, so it is never offered for a batch.
  if (!c.visited) {
    if (openCustom >= 0 && inCustom !== openCustom) {
      items.push([`Add to custom ${openCustom + 1}`, () => addToCustom(openCustom)]);
    } else if (selected !== null && openCustom < 0 && c.batch !== selected && inCustom < 0) {
      const target = selected;
      // Anchor the move to a city that belongs to the batch of its own accord, so it survives regrouping.
      const anchor = batches[target].find((x) => !(cityId(x) in state.moved));
      if (anchor) {
        items.push([`Add to route ${target + 1}`, () => {
          undrop(id);
          state.appended = [...(state.appended ?? []).filter((x) => x !== id), id];
          pushEdit({ kind: 'add', id });
          state.moved[id] = cityId(anchor);
          save();
          rebuildKeeping(cityId(anchor));
        }]);
      }
    }
    items.push(['Start a custom route with this city', () => addToCustom(state.custom.length)]);
  }
  // Its place in the open route.
  // With a mouse the rows can be dragged; these are for fingers.
  if (selected !== null && c.batch === selected && matchMedia('(pointer: coarse)').matches) {
    const open = selected;
    if (c.order > 0) items.push(['Move up', () => moveCity(open, c.order, c.order - 1)]);
    if (c.order < batches[open].length - 1) items.push(['Move down', () => moveCity(open, c.order, c.order + 1)]);
  }
  // Cities moved in by hand, or in a custom route, have their own way out below.
  if (c.batch >= 0 && inCustom < 0 && !(id in state.moved)) {
    items.push([`Remove from route ${c.batch + 1}`, () => {
      state.dropped = [...(state.dropped ?? []), id];
      save();
      // Stay on the route it was taken from, unless that was its last city.
      const stay = batches[c.batch].find((x) => cityId(x) !== id && !(cityId(x) in state.moved));
      rebuildKeeping(selected === c.batch ? (stay ? cityId(stay) : null) : keep);
    }]);
  }
  if (state.dropped?.includes(id) && c.batch < 0) {
    items.push(['Put back in its route', () => {
      undrop(id);
      save();
      reselect();
    }]);
  }
  if (inCustom >= 0) {
    items.push([`Remove from custom ${inCustom + 1}`, () => {
      state.custom[inCustom] = state.custom[inCustom].filter((x) => x !== id);
      save();
      reselect();
    }]);
  }
  if (id in state.moved && inCustom < 0) {
    items.push(['Return to its own route', () => {
      delete state.moved[id];
      save();
      rebuildKeeping(keep === id ? null : keep);
    }]);
  }
}

map.onMenu = (c, px, py, pos) => {
  const at = $('map').getBoundingClientRect();
  openMenu(c, at.left + px, at.top + py, pos);
};

/** The menu for a city, or for a bare spot on the map, opened at a place in the window. */
function openMenu(c: MapCity | null, px: number, py: number, pos: { x: number; z: number }): void {
  const items: [string, () => void][] = [];
  if (c) addCityItems(c, items);
  // On a city, "here" is the city itself rather than the exact pixel that was clicked.
  const here = c ? { x: c.city.x, z: c.city.z } : pos;
  items.push(['Copy coordinates', async () => {
    const text = xzText(here);
    const ok = await copyText(text);
    // The menu has closed by now, so the result is reported beside the position box.
    locateNote.textContent = ok ? `Copied ${text}` : `Could not copy. The coordinates are ${text}`;
    if (ok) {
      setTimeout(() => {
        if (locateNote.textContent === `Copied ${text}`) locateNote.textContent = '';
      }, 2500);
    }
  }]);
  items.push(['Set my position here', () => {
    you = here;
    setLocate(here);
    locateNote.textContent = '';
    renderMap();
  }]);

  // Every choice has a fixed place, so the menu reads the same whichever city it is opened on:
  // looted marks, coordinates, position, the city's place in its route, then reports.
  const places = [
    /^Mark as (looted|not looted)$/,
    /^Mark as looted by someone else$/,
    /^On the shared/,
    /^Copy coordinates$/,
    /^Set my position here$/,
    /^Move up$/,
    /^Move down$/,
    /^Add to /,
    /^Start a custom route/,
    /^(Remove from|Return to|Put back in)/,
    /^Report incorrect/,
  ];
  // The places fall into groups, parted by a line: marks, coordinates, the route, reports.
  const groupOf = (label: string) => {
    const at = place(label);
    return at <= 2 ? 0 : at <= 4 ? 1 : at <= 9 ? 2 : 3;
  };
  const place = (label: string) => {
    const at = places.findIndex((p) => p.test(label));
    return at < 0 ? places.length : at;
  };
  items.sort((p, q) => place(p[0]) - place(q[0]));

  const title = document.createElement('div');
  title.className = 'menu-title';
  title.textContent = c ? `${c.batch >= 0 ? waypointName(c.batch, c.order) + ' · ' : ''}${xzText(c.city)}` : xzText(pos);
  menu.replaceChildren(
    title,
    ...items.flatMap(([label, run], n) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        closeMenu();
        run();
      });
      const newGroup = n > 0 && groupOf(label) !== groupOf(items[n - 1][0]);
      return newGroup ? [Object.assign(document.createElement('div'), { className: 'menu-rule' }), btn] : [btn];
    }),
  );
  menu.hidden = false;
  tooltip.hidden = true;
  // Kept inside the window, whichever edge it was opened near.
  menu.style.left = `${Math.max(4, Math.min(px + 4, window.innerWidth - menu.offsetWidth - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(py + 4, window.innerHeight - menu.offsetHeight - 4))}px`;
}

// On narrow screens the route's list sits below the map: once the map has scrolled out of sight,
// offer a way back to it. (The button only ever shows at those widths; see the stylesheet.)
const backToMap = $('backToMap');
// And the way down: with one finger moving the map, a swipe on the map no longer scrolls the page, so
// while the map fills the view there is a button to the route's details below it.
const toRoute = $('toRoute');
const showBackToMap = () => {
  const mapBox = $('map').getBoundingClientRect();
  backToMap.hidden = mapBox.bottom > 0;
  toRoute.hidden = !state.oneFingerMap || mapBox.bottom <= 0 || $('detail').getBoundingClientRect().top < window.innerHeight * 0.6;
};
toRoute.addEventListener('click', () => $('detail').scrollIntoView({ block: 'start', behavior: 'smooth' }));
window.addEventListener('scroll', showBackToMap, { passive: true });
window.addEventListener('resize', showBackToMap);
showBackToMap();
backToMap.addEventListener('click', () => $('map').scrollIntoView({ block: 'start', behavior: 'smooth' }));

// The line under the map saying how to move it is for newcomers: once the map has been used, it goes for good.
const MAP_HINT_KEY = 'end-cities:map-hint-seen';
const hideMapHint = () => {
  for (const el of document.querySelectorAll<HTMLElement>('#mapbar .controls')) el.hidden = true;
};
try {
  if (localStorage.getItem(MAP_HINT_KEY)) hideMapHint();
} catch {
  // No storage: the hint just stays until the map is used.
}
for (const type of ['pointerdown', 'wheel'] as const) {
  $('map').addEventListener(type, () => {
    hideMapHint();
    try {
      localStorage.setItem(MAP_HINT_KEY, '1');
    } catch {
      // Hidden for this visit at least.
    }
  }, { once: true, passive: true });
}

const zoomSlider = $<HTMLInputElement>('zoomSlider');
let wasDetailed = map.detailed;
map.onZoom = (level) => {
  zoomSlider.value = String(Math.round(level * 1000));
  // Crossing the zoom at which the guesswork about earlier hunters appears: bring the legend and the note along.
  if (map.detailed !== wasDetailed) {
    wasDetailed = map.detailed;
    render();
  }
};
zoomSlider.addEventListener('input', () => map.setZoom(Number(zoomSlider.value) / 1000));
$('zoomOut').addEventListener('click', () => map.setZoom(map.zoom - 0.05));
$('zoomIn').addEventListener('click', () => map.setZoom(map.zoom + 0.05));

const cursor = $('cursor');
// The readout never goes blank, so the bar under the map keeps its shape: it shows the block under
// the pointer, or the centre of the view (the faint crosshair) when the pointer is not on the map.
let pointerAt: { x: number; z: number } | null = null;
let viewCentre = { x: 0, z: 0 };
const showCoords = () => {
  cursor.textContent = pointerAt ? xzText(pointerAt) : `centre ${xzText(viewCentre)}`;
};
map.onCursor = (pos) => {
  pointerAt = pos;
  showCoords();
};
map.onView = (centre) => {
  viewCentre = centre;
  showCoords();
  renderLegend();
  showNearDefault();
};

// ---------- resizable panels ----------

const LAYOUT_STORE = 'end-cities:layout';
const PANEL_MIN = 220;
const PANEL_DEFAULT = { left: 300, right: 350 };
type Side = keyof typeof PANEL_DEFAULT;

const panelWidth: Record<Side, number> = { ...PANEL_DEFAULT };
try {
  Object.assign(panelWidth, JSON.parse(localStorage.getItem(LAYOUT_STORE) ?? '{}'));
} catch {
  // Keep the defaults.
}

function setPanel(side: Side, width: number, persist = true): void {
  // Leave the map at least as much room as a panel's minimum.
  const max = Math.max(PANEL_MIN, window.innerWidth - panelWidth[side === 'left' ? 'right' : 'left'] - PANEL_MIN);
  panelWidth[side] = Math.round(Math.min(max, Math.max(PANEL_MIN, width)));
  document.body.style.setProperty(`--${side}`, `${panelWidth[side]}px`);
  if (!persist) return;
  try {
    localStorage.setItem(LAYOUT_STORE, JSON.stringify(panelWidth));
  } catch {
    // The size still applies for this visit.
  }
}

for (const handle of document.querySelectorAll<HTMLElement>('.resizer')) {
  const side = handle.dataset.side as Side;
  setPanel(side, panelWidth[side], false);
  const fromPointer = (e: PointerEvent) => (side === 'left' ? e.clientX : window.innerWidth - e.clientX);
  handle.addEventListener('pointerdown', (e) => {
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (handle.hasPointerCapture(e.pointerId)) setPanel(side, fromPointer(e));
  });
  handle.addEventListener('pointerup', () => handle.classList.remove('dragging'));
  handle.addEventListener('dblclick', () => setPanel(side, PANEL_DEFAULT[side]));
  handle.addEventListener('keydown', (e) => {
    // Arrow keys move the divider itself, whichever panel it belongs to.
    const step = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
    if (!step) return;
    e.preventDefault();
    setPanel(side, panelWidth[side] + (side === 'left' ? step : -step));
  });
}

// ---------- goose ----------

// The goose keeps count: click it to see every looted city at once, click again to put them away.
const gooseCredit = $('gooseCredit');
const gooseTally = $('gooseTally');
const showTally = () => {
  if (!showTrophies) return (gooseTally.textContent = '');
  const looted = lootedCities().length;
  const parts = [looted ? `${fmt(looted)} ${looted === 1 ? 'city' : 'cities'} looted so far (gold)` : 'nothing looted yet'];
  if (state.seed === DEFAULT_SEED && explored) {
    parts.push(webmapCities ? `${fmt(webmapCities.length)} more in areas on the webmap (green)` : 'counting the ones on the webmap…');
  }
  gooseTally.textContent = `Honk! ${parts.join(', ')}.`;
};
gooseCredit.addEventListener('click', async () => {
  showTrophies = !showTrophies;
  showTally();
  renderMap();
  if (!showTrophies) return;
  const fitAll = () => {
    const all = [...lootedCities(), ...(webmapCities ?? [])];
    if (all.length) map.fit(all, state.filters.maxDist);
  };
  fitAll();
  // The webmap's cities take a moment to work out the first time; they join the view when ready.
  if (!webmapCities && explored && state.seed === DEFAULT_SEED) {
    webmapCities = await findWebmapCities(explored);
    showTally();
    renderMap();
    if (showTrophies) fitAll();
  }
});


// The goose emoji only exists on systems from 2022 onwards; elsewhere it shows as an empty box.
// Those get the nearest bird their system does have: the swan (2018), then the duck (2016).
const GOOSE_STAND_INS = ['🦢', '🦆'];

/** Whether this system can draw the emoji in colour, as opposed to a blank or a monochrome box. */
function drawsEmoji(emoji: string): boolean {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return true;
    ctx.textBaseline = 'top';
    ctx.font = '24px sans-serif';
    ctx.fillText(emoji, 2, 2);
    const px = ctx.getImageData(0, 0, 32, 32).data;
    for (let i = 0; i < px.length; i += 4) {
      // A missing glyph is drawn in the text colour; a real emoji has coloured pixels.
      if (px[i + 3] > 0 && (Math.abs(px[i] - px[i + 1]) > 16 || Math.abs(px[i + 1] - px[i + 2]) > 16)) return true;
    }
    return false;
  } catch {
    // Can't tell (e.g. canvas reading blocked): leave the emoji alone.
    return true;
  }
}

if (!drawsEmoji('🪿')) {
  const bird = GOOSE_STAND_INS.find(drawsEmoji) ?? '';
  $('gooseEmoji').textContent = bird;
  const icon = $<HTMLLinkElement>('favicon');
  // With no bird at all, drop the icon rather than show an empty box in the tab.
  if (bird) icon.href = icon.href.replace(encodeURIComponent('🪿'), encodeURIComponent(bird)).replace('🪿', bird);
  else icon.remove();
}

// ---------- start ----------

fillForm();
rebuild();
render();
fitSearch(state.filters);
// With results from last time, start with the settings folded so the batches are in view.
// In the simplified layout the search buttons are outside the fold, so it starts closed.
settings.open = state.found.length === 0 && !document.body.classList.contains('simple-search');

/** Looted cities published with the site, for the default server's world only. */
let sharedLooted: string[] = [];
/** The ones among them that a player found already looted on arrival. */
let sharedAlready: string[] = [];
/** And who sent each one in, where a username was given. */
let sharedBy: Record<string, string[]> = {};
async function loadSharedLooted(): Promise<{ cities: string[]; already: string[]; by: Record<string, string[]> }> {
  try {
    const res = await fetch('./looted.json');
    const list = res.ok ? await res.json() : {};
    return { cities: list.cities ?? [], already: list.alreadyLooted ?? [], by: list.by ?? {} };
  } catch {
    return { cities: [], already: [], by: {} };
  }
}

Promise.all([Explored.load(), Precomputed.load(), loadSharedLooted(), loadShipReports()]).then(([e, p, looted, ships]) => {
  shipReports = {
    gone: new Map([
      ...(ships.missing ?? []).map((id): [string, 'missing'] => [id, 'missing']),
      ...(ships.noCity ?? []).map((id): [string, 'no-city'] => [id, 'no-city']),
    ]),
    found: new Set(ships.found ?? []),
  };
  // Results saved by an older version lack newer details (such as uncertain ships). Where the search is
  // one the pre-generated file answers instantly, refresh them from it.
  if (p?.covers(state.seed, state.filters) && state.found.length) {
    state.found = p.search(state.filters);
    save();
  }
  explored = e;
  precomputed = p;
  sharedLooted = looted.cities;
  sharedAlready = looted.already;
  sharedBy = looted.by;
  if (state.seed === DEFAULT_SEED) tracker.setShared(sharedLooted, sharedAlready, sharedBy);
  showSharedNote();
  showExploredNote();
  // Routes finished on an earlier visit are regrouped away once the routes are first worked out.
  rebuild(() => {
    if (retireFinished(null)) rebuild();
  });
  render();
  if (!state.found.length) form.requestSubmit();
});
