import { lookalike, type Constellation } from './constellations';
import { Explored } from './explored';
import { endCityHasShip } from './generation/end-city-pieces';
import { END_CITY, candidateChunk, chunkToBlock } from './generation/end-cities';
import { EndTerrain } from './generation/end-terrain';
import { BATCH_SIZE, DEFAULT_MAX_HOP, makeBatchesOrSmaller, passes, route, type BatchJob, type BatchShape } from './filters';
import type { FindRequest, FindResponse, FoundCity } from './generation/worker';
import { parseCoordinates } from './import';
import { chatLine, chatLines, cleanUsername } from './journeymap';
import { EndMap, type MapCity } from './map';
import { Precomputed } from './precomputed';
import { loadSkyFigures } from './sky-cultures';
import { Tracker } from './tracker';
import { cityId, searchBounds, type City, type Filters, type Quadrant } from './types';
import { OUTSIDE_COLOR, XAERO_COLORS, batchColor, setBatchTags, waypointFile, waypointLines, waypointName } from './xaero';

const DEFAULT_SEED = '856461443495910397';
const ISSUES_URL = 'https://github.com/sh4sh/aomc-elytra-hunt/issues';
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
  skipMapped: boolean;
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
      const saved: Saved = { found: [], imported: [], skipMapped: true, shipsOnly: true, batchSize: BATCH_SIZE, batchShape: 'cluster', maxHop: DEFAULT_MAX_HOP, lineDeviation: DEFAULT_LINE_DEVIATION, excluded: [], moved: {}, custom: [], chatName: '', mapMod: 'xaero', ...s };
      // Fixed since the setting for it was removed.
      saved.shipsOnly = true;
      // Results saved before ships were tracked have no ship flag: search again.
      if (saved.found.some((c) => c.length < 3)) saved.found = [];
      return saved;
    }
  } catch {
    // Fall through to defaults.
  }
  return { seed: DEFAULT_SEED, filters: DEFAULT_FILTERS, found: [], imported: [], skipMapped: true, shipsOnly: true, batchSize: BATCH_SIZE, batchShape: 'cluster', maxHop: DEFAULT_MAX_HOP, lineDeviation: DEFAULT_LINE_DEVIATION, excluded: [], moved: {}, custom: [], chatName: '', mapMod: 'xaero' };
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
/** How many of `batches` were generated; the player's custom batches follow them. */
let generatedCount = 0;

const isCustom = (i: number) => i >= generatedCount;
/** Display name of a batch, which players see as a route: "Route 12", or "Custom 1" for one they made. */
const batchTitle = (i: number) => (isCustom(i) ? `Custom ${i - generatedCount + 1}` : `Route ${i + 1}`);
/** Cities that could not be fitted into a full batch within the longest-flight limit. */
let unbatched = 0;
/** Cities kept out of the batches but still drawn on the map, with the reason. */
let outside: { city: City; note: string }[] = [];

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
  const mapped = state.skipMapped && explored && state.seed === DEFAULT_SEED ? explored : null;
  // Only ships hold elytra, so cities without one are never offered.
  const withShip = state.found.filter((c) => c[2]);
  shipless = state.found.length - withShip.length;
  skipped = 0;

  // Every city worth showing, with the reason it is kept out of the batches, if any.
  const pool = new Map<string, { city: City; note?: string }>();
  const seen = new Set<string>();
  const excluded = new Set(state.excluded);
  const add = (x: number, z: number, source: City['source'], ship: boolean) => {
    // One city per chunk, whichever source it came from.
    const key = `${x >> 4},${z >> 4}`;
    if (seen.has(key)) return;
    seen.add(key);
    const city: City = { x, z, source };
    let note: string | undefined;
    // Only while still looted: unticking a city puts it back.
    if (excluded.has(cityId(city)) && tracker.has(city)) note = 'looted, removed from routes';
    else if (source === 'seed' && mapped?.isMapped(x, z)) {
      skipped++;
      // Ships near mapped terrain may still be unlooted, so keep them visible.
      if (!ship) return;
      note = 'has a ship, but already on the webmap';
    }
    pool.set(cityId(city), { city, note });
  };
  for (const [x, z, ship] of withShip) add(x, z, 'seed', !!ship);

  outside = [];
  const cities: City[] = [];
  for (const entry of pool.values()) {
    if (entry.note) outside.push({ city: entry.city, note: entry.note });
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

/** Second half of a rebuild: take the generated batches and apply hand-made moves and custom batches. */
function finishRebuild(
  made: { batches: City[][]; size: number },
  pool: Map<string, { city: City; note?: string }>,
  cities: City[],
): void {
  batches = made.batches;
  usedBatchSize = made.size;
  // Hand-made moves are applied after batching, so adding a city to a batch never reshuffles the others.
  // A move holds while both cities still exist and its target is in a batch of its own accord.
  const batchOf = new Map<string, number>();
  batches.forEach((batch, b) => batch.forEach((c) => batchOf.set(cityId(c), b)));
  const moved = new Set<string>();
  const touched = new Set<number>();
  for (const [id, anchor] of Object.entries(state.moved)) {
    const to = batchOf.get(anchor);
    if (!pool.has(id) || to === undefined || anchor in state.moved) continue;
    const from = batchOf.get(id);
    if (from === to) continue;
    if (from !== undefined) batches[from] = batches[from].filter((c) => cityId(c) !== id);
    batches[to].push(pool.get(id)!.city);
    moved.add(id);
    touched.add(to);
  }
  for (const b of touched) batches[b] = route(batches[b], startPoint());

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

function renderMap(): void {
  const cities: MapCity[] = [];
  batches.forEach((batch, b) =>
    batch.forEach((city, order) => cities.push({ city, batch: b, order, color: color(b), visited: tracker.has(city) })),
  );
  for (const o of outside) {
    cities.push({ city: o.city, batch: -1, order: 0, color: OUTSIDE_COLOR, visited: tracker.has(o.city), note: o.note });
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
  map.setScene({
    cities,
    selectedBatch: selected,
    hot,
    filters: state.filters,
    searchArea: previewFilters(),
    explored: state.seed === DEFAULT_SEED ? explored : null,
    you,
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
  $('stats').textContent = total
    ? `${fmt(total)} cities · ${fmt(batches.length)} routes · ${fmt(done)} looted` +
      (shipless ? ` · ${fmt(shipless)} without a ship left out` : '') +
      (skipped ? ` · ${fmt(skipped)} left out as already mapped` : '') +
      (usedBatchSize < state.batchSize && generatedCount
        ? ` · no route of ${state.batchSize} fits here, so routes of ${usedBatchSize} were made`
        : '') +
      (unbatched ? ` · ${fmt(unbatched)} without a route` : '') +
      (state.excluded.length ? ` · ${fmt(state.excluded.length)} looted removed from routes` : '')
    : unbatched
      ? `No routes: ${fmt(unbatched)} cities, but no two are within the longest flight of each other. Raise the longest flight.`
      : 'No cities yet. Set a range and press Find cities.';

  $<HTMLButtonElement>('regroup').disabled = done === 0;
  $<HTMLButtonElement>('regroupUndo').hidden = state.excluded.length === 0;

  const pages = Math.max(1, Math.ceil(generatedCount / PAGE_SIZE));
  // Jump to the selected batch's page when the selection changes, e.g. after clicking a city on the map.
  if (selected !== pageFollowed) {
    pageFollowed = selected;
    if (selected !== null && !isCustom(selected)) page = Math.floor(selected / PAGE_SIZE);
  }
  page = Math.min(page, pages - 1);
  const first = page * PAGE_SIZE;
  const last = Math.min(first + PAGE_SIZE, generatedCount);
  $('pager').hidden = pages === 1;
  // One entry per page, named by the batches on it, so any page is one pick away.
  const pageSelect = $<HTMLSelectElement>('pageSelect');
  if (pageSelect.options.length !== pages || pageSelect.dataset.total !== String(generatedCount)) {
    pageSelect.dataset.total = String(generatedCount);
    pageSelect.replaceChildren(
      ...Array.from({ length: pages }, (_, p) => {
        const from = p * PAGE_SIZE + 1;
        return new Option(`Routes ${from}–${Math.min(from + PAGE_SIZE - 1, generatedCount)} of ${generatedCount}`, String(p));
      }),
    );
  }
  pageSelect.value = String(page);
  $<HTMLButtonElement>('pagePrev').disabled = page === 0;
  $<HTMLButtonElement>('pageNext').disabled = page === pages - 1;
  $<HTMLInputElement>('gotoBatch').max = String(generatedCount);

  // Custom batches stay pinned above whichever page of generated batches is showing.
  const shown: number[] = [];
  for (let i = generatedCount; i < batches.length; i++) shown.push(i);
  for (let i = first; i < last; i++) shown.push(i);

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
      btn.append(sw, name, count);
      btn.addEventListener('click', () => select(i, true));
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
  renderStars(batch, color(i));
  let longest = 0;
  batch.forEach((c, k) => {
    if (k) longest = Math.max(longest, Math.hypot(c.x - batch[k - 1].x, c.z - batch[k - 1].z));
  });
  $('detailMeta').textContent =
    `${batch.length} cities · ${looted(batch)} looted · about ${fmt(Math.round(length / 100) * 100)} blocks of flying` +
    ` · longest flight ${fmt(Math.round(longest))}` +
    (!isCustom(i) && batch.length < usedBatchSize ? ' · short route' : '') +
    (isCustom(i) && !batch.length ? ' · right-click a city on the map to add it' : '');

  $('cities').replaceChildren(
    ...batch.map((c, k) => {
      const li = document.createElement('li');
      li.classList.toggle('looted', tracker.has(c));
      li.classList.toggle('hot', c === hot);
      const label = document.createElement('label');
      label.title = waypointName(i, k);
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = tracker.has(c);
      if (tracker.isShared(c)) {
        // On the shared list: looted for everyone, so it can't be unticked here.
        box.disabled = true;
        label.title += ' · on the shared looted list';
      }
      box.addEventListener('change', () => {
        tracker.set(c, box.checked);
        render();
      });
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = String(k + 1);
      const xz = document.createElement('span');
      xz.className = 'xz';
      xz.textContent = xzText(c);
      const hop = document.createElement('span');
      hop.className = 'hop';
      hop.textContent = k ? `+${fmt(Math.round(Math.hypot(c.x - batch[k - 1].x, c.z - batch[k - 1].z)))}` : 'start here';
      if (!k) hop.classList.add('start');
      const chat = document.createElement('button');
      chat.type = 'button';
      chat.className = 'chat';
      chat.textContent = 'chat';
      chat.title = 'Copy this city as a JourneyMap chat location';
      chat.addEventListener('click', async (e) => {
        // Inside the row's label: don't let the click tick the looted box.
        e.preventDefault();
        e.stopPropagation();
        chat.textContent = (await copyText(chatLine(c, waypointName(i, k), state.chatName))) ? 'copied' : 'failed';
        setTimeout(() => (chat.textContent = 'chat'), 1500);
      });
      label.append(box, n, xz, hop);
      if (state.mapMod === 'journeymap') label.append(chat);
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
}

function setHot(c: City | null): void {
  if (hot === c) return;
  hot = c;
  renderMap();
}

function select(i: number | null, zoom = false): void {
  selected = i;
  // Opening a batch, from the list or the map, puts the help away.
  if (i !== null) helpOpen = false;
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
    state.custom = [];
    tracker = new Tracker(seed);
    tracker.setShared(seed === DEFAULT_SEED ? sharedLooted : []);
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
// Somewhere to explore, picked at random from anywhere within a million blocks of 0,0, at least
// 10,000 out. Spots already on the webmap are passed over, and so are the rings of empty void that
// the End has far out, where there is nothing to find.
const RANDOM_REACH = 1_000_000;
/** Whether the game leaves this spot as void: beyond about 370,000 blocks, land and void alternate in rings. */
const inVoidRing = (x: number, z: number) => {
  const [cx, cz] = [Math.floor(x / 8), Math.floor(z / 8)];
  return ((cx * cx + cz * cz) | 0) < 0;
};
$('aroundRandom').addEventListener('click', () => {
  const roll = () => Math.round(((Math.random() * 2 - 1) * RANDOM_REACH) / 100) * 100;
  let pos = { x: roll(), z: roll() };
  for (let tries = 0; tries < 200; tries++) {
    const farEnough = Math.max(Math.abs(pos.x), Math.abs(pos.z)) >= 10000;
    const fresh = !(explored && state.seed === DEFAULT_SEED && explored.isMapped(pos.x, pos.z));
    if (farEnough && fresh && !inVoidRing(pos.x, pos.z)) break;
    pos = { x: roll(), z: roll() };
  }
  setAroundPosition(pos);
  if (!(Number(aroundRadius.value) > 0)) aroundRadius.value = '10000';
  renderMap();
  form.requestSubmit();
});

$('aroundUseMap').addEventListener('click', () => {
  const pos = you ?? parseCoordinates(locateInput.value)[0];
  if (!pos) {
    aroundX.setCustomValidity('Type your position into the box on the map first, or enter it here.');
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

$('regroup').addEventListener('click', () => {
  const ids = new Set(state.excluded);
  for (const c of batches.flat()) if (tracker.has(c)) ids.add(cityId(c));
  state.excluded = [...ids];
  save();
  selected = null;
  rebuild();
  render();
});

$('regroupUndo').addEventListener('click', () => {
  state.excluded = [];
  save();
  selected = null;
  rebuild();
  render();
});

// ---------- locate ----------

const locateForm = $<HTMLFormElement>('locate');
const locateInput = $<HTMLInputElement>('locateInput');
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
  const pos = parseCoordinates(locateInput.value)[0];
  if (!pos) {
    locateNote.textContent = 'Enter your position, like x: 100000, z: 200000.';
    return;
  }
  you = { x: pos.x, z: pos.z };
  // Inside the area already searched, the nearest batch is among the ones on screen.
  if (passes(pos.x, pos.z, state.filters) && openNearest(you)) return;

  // Otherwise the current search does not cover where the player is: search around them instead.
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
});

$('locateClear').addEventListener('click', () => {
  you = null;
  locateInput.value = '';
  locateNote.textContent = '';
  renderMap();
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

const skipBox = $<HTMLInputElement>('skipMapped');
skipBox.checked = state.skipMapped;
skipBox.addEventListener('change', () => {
  state.skipMapped = skipBox.checked;
  save();
  selected = null;
  rebuild();
  render();
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
  state.skipMapped = true;
  sizeInput.value = String(state.batchSize);
  shapeSelect.value = state.batchShape;
  hopInput.value = String(state.maxHop);
  deviationInput.value = String(state.lineDeviation);
  skipBox.checked = true;
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
    note.textContent = 'No webmap data loaded. Run "npm run explored" to fetch it.';
    skipBox.disabled = true;
    return;
  }
  note.textContent = `Webmap data from ${new Date(explored.fetchedAt).toLocaleDateString()}.`;
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
copyButton('copyChat', () =>
  selected === null ? '' : chatLines(batches[selected], selected, (c) => tracker.has(c), state.chatName).join('\n') + '\n',
);

const modRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="mapMod"]')];
function showMapMod(): void {
  for (const r of modRadios) {
    r.checked = r.value === state.mapMod;
    // A class, not the CSS :has() selector, so the highlight also works in browsers from before 2023.
    r.parentElement!.classList.toggle('on', r.checked);
  }
  $('xaeroPanel').hidden = state.mapMod !== 'xaero';
  $('journeymapPanel').hidden = state.mapMod !== 'journeymap';
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
  const example = chatLine({ x: 12040, z: -11832, source: 'seed' }, 'EC 1-01', state.chatName);
  $('chatHint').replaceChildren(
    state.chatName
      ? 'Lines are whispers to you, so only you see them: '
      : 'Without a username the lines go to public chat, where everyone sees them: ',
    Object.assign(document.createElement('code'), { textContent: example }),
  );
}
chatNameInput.value = state.chatName;
chatNameInput.addEventListener('input', () => {
  state.chatName = cleanUsername(chatNameInput.value);
  if (chatNameInput.value !== state.chatName) chatNameInput.value = state.chatName;
  save();
  showChatHint();
});
showChatHint();

function markAll(v: boolean): void {
  if (selected === null) return;
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
$('markNone').addEventListener('click', () => markAll(false));

$('citiesExport').addEventListener('click', () => {
  const rows = batches.flatMap((batch, b) =>
    batch.map((c, k) => `${c.x},${c.z},${b + 1},${k + 1},${tracker.has(c) ? 'yes' : 'no'}`),
  );
  download('end-cities.csv', ['x,z,route,stop,looted', ...rows].join('\n') + '\n');
});

$('visitedReset').addEventListener('click', () => {
  if (!tracker.count || !confirm(`Mark all ${tracker.count} looted cities as not looted?`)) return;
  tracker.clear();
  state.excluded = [];
  save();
  selected = null;
  rebuild();
  render();
});

function showSharedNote(): void {
  $('sharedNote').textContent = tracker.sharedCount
    ? `${fmt(tracker.sharedCount)} cities are on the shared list and show as looted for everyone.`
    : 'The shared list is empty so far.';
}
showSharedNote();

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
  const cities = tracker.ownNew();
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
      body: JSON.stringify({ name: submitName.value, cities }),
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
  tooltip.textContent =
    c.batch < 0
      ? `${xzText(c.city)} · not in a route: ${c.note}`
      : `${waypointName(c.batch, c.order)} · ${xzText(c.city)}${c.visited ? ' · looted' : ''}`;
  tooltip.style.left = `${px + 14}px`;
  tooltip.style.top = `${py + 14}px`;
};
map.onPick = (c) => {
  if (c.batch >= 0) select(c.batch, true);
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
    items.push(['Mark as not looted', () => {
      if (!confirm(`Mark the city at ${xzText(c.city)} as not looted?`)) return;
      tracker.set(c.city, false);
      state.excluded = state.excluded.filter((x) => x !== id);
      save();
      reselect();
    }]);
  } else {
    items.push(['Mark as looted', () => {
      tracker.set(c.city, true);
      render();
    }]);
  }

  const inCustom = state.custom.findIndex((ids) => ids.includes(id));
  /** Put the city in custom batch k (a new one when k is past the end), taking it out of any other. */
  const addToCustom = (k: number) => {
    state.custom = state.custom.map((ids) => ids.filter((x) => x !== id));
    if (k >= state.custom.length) state.custom.push([]);
    state.custom[k].push(id);
    delete state.moved[id];
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
          state.moved[id] = cityId(anchor);
          save();
          rebuildKeeping(cityId(anchor));
        }]);
      }
    }
    items.push(['Start a custom route with this city', () => addToCustom(state.custom.length)]);
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
    locateInput.value = xzText(here);
    locateNote.textContent = '';
    renderMap();
  }]);

  const title = document.createElement('div');
  title.className = 'menu-title';
  title.textContent = c ? `${c.batch >= 0 ? waypointName(c.batch, c.order) + ' · ' : ''}${xzText(c.city)}` : xzText(pos);
  menu.replaceChildren(
    title,
    ...items.map(([label, run]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        closeMenu();
        run();
      });
      return btn;
    }),
  );
  menu.hidden = false;
  tooltip.hidden = true;
  menu.style.left = `${px + 4}px`;
  menu.style.top = `${py + 4}px`;
};

const zoomSlider = $<HTMLInputElement>('zoomSlider');
map.onZoom = (level) => {
  zoomSlider.value = String(Math.round(level * 1000));
};
zoomSlider.addEventListener('input', () => map.setZoom(Number(zoomSlider.value) / 1000));
$('zoomOut').addEventListener('click', () => map.setZoom(map.zoom - 0.05));
$('zoomIn').addEventListener('click', () => map.setZoom(map.zoom + 0.05));

const cursor = $('cursor');
map.onCursor = (pos) => {
  cursor.textContent = pos ? xzText(pos) : '';
};

// ---------- resizable panels ----------

const LAYOUT_STORE = 'end-cities:layout';
const PANEL_MIN = 220;
const PANEL_DEFAULT = { left: 300, right: 320 };
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
settings.open = state.found.length === 0;

/** Looted cities published with the site, for the default server's world only. */
let sharedLooted: string[] = [];
async function loadSharedLooted(): Promise<string[]> {
  try {
    const res = await fetch('./looted.json');
    return res.ok ? ((await res.json()).cities ?? []) : [];
  } catch {
    return [];
  }
}

Promise.all([Explored.load(), Precomputed.load(), loadSharedLooted()]).then(([e, p, looted]) => {
  explored = e;
  precomputed = p;
  sharedLooted = looted;
  if (state.seed === DEFAULT_SEED) tracker.setShared(sharedLooted);
  showSharedNote();
  showExploredNote();
  rebuild();
  render();
  if (!state.found.length) form.requestSubmit();
});
