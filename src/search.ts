// Searching: the settings form, the two search buttons, the coordinate boxes, and taking a finished
// search as the new state.

import { MAX_SEARCH_CITIES, SHIP_DENSITY } from './constants';
import { $, fmt } from './dom';
import type { FindRequest, FindResponse, FoundCity } from './generation/worker';
import { parseCoordinates } from './import';
import { map } from './map-view';
import { previewFilters, render, renderBatches, renderDetail, renderMap, select } from './render';
import { rebuild } from './routes';
import { session } from './session';
import { showExploredNote } from './settings';
import { loadSkyFigures } from './sky-cultures';
import { DEFAULT_SEED, save, state } from './state';
import { Tracker } from './tracker';
import { type City, cityId, type Filters, type Quadrant, searchBounds } from './types';
import { waypointName } from './xaero';

// ---------- search ----------

export const form = $<HTMLFormElement>('search');
const seedInput = $<HTMLInputElement>('seed');
const nearX = $<HTMLInputElement>('nearX');
const nearZ = $<HTMLInputElement>('nearZ');
const aroundRadius = $<HTMLInputElement>('aroundRadius');
/** Whether the form is set to search around a position rather than outward from 0,0. */
export const aroundMode = () => session.searchCentre !== null;
/** How far "Search near me" looks is only shown once it is the search in use: until then it is one thing less to read. */
function showRadius(): void {
  $('aroundBox').hidden = !aroundMode();
}
const minInput = $<HTMLInputElement>('minDist');
const maxInput = $<HTMLInputElement>('maxDist');
const diagInput = $<HTMLInputElement>('diag');
const angleFromSelect = $<HTMLSelectElement>('angleFrom');
const quadBoxes = [...document.querySelectorAll<HTMLInputElement>('#quadrants input')];
const findBtn = $<HTMLButtonElement>('find');
const progress = $<HTMLProgressElement>('progress');

/** Set the search controls to a search: where it looks, and how far. */
function fillSearch(f: Filters): void {
  session.searchCentre = f.around ? { x: f.around.x, z: f.around.z } : null;
  if (f.around) aroundRadius.value = String(f.around.radius);
  showRadius();
  minInput.value = String(f.minDist);
  maxInput.value = String(f.maxDist);
  diagInput.value = String(f.diagonalDeg);
  angleFromSelect.value = f.angleFrom ?? 'diagonal';
  for (const b of quadBoxes) b.checked = f.quadrants.includes(b.value as Quadrant);
  showDiag();
  showQuickSpawn();
  showSearchChoice();
}

export function fillForm(): void {
  seedInput.value = state.seed;
  showSeedReset();
  fillSearch(state.filters);
  // The way back to the search before this one, once there has been one.
  $('searchBack').hidden = !state.lastSearch;
}

/** The search as currently set in the form, applied or not. */
export function formFilters(): Filters {
  const radius = Number(aroundRadius.value);
  return {
    around: session.searchCentre && radius > 0 ? { ...session.searchCentre, radius } : undefined,
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
export function fitSearch(f: Filters): void {
  const b = searchBounds(f);
  map.fit([{ x: b.x0, z: b.z0 }, { x: b.x1, z: b.z1 }], f.maxDist);
}


/** Take a finished search as the new state. Nothing changes until this runs, so a cancelled search leaves no trace. */
export function applyResult(seed: string, filters: Filters, cities: FoundCity[]): void {
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
    // The survey's route went with them.
    state.survey = undefined;
    session.tracker = new Tracker(seed);
    session.tracker.setShared(seed === DEFAULT_SEED ? session.sharedLooted : [], seed === DEFAULT_SEED ? session.sharedAlready : [], seed === DEFAULT_SEED ? session.sharedBy : {});
  }
  // Moving to a search somewhere else (not just adjusting this one) leaves the old one to go back to.
  const place = (f: Filters) => (f.around ? `${f.around.x},${f.around.z}` : 'band');
  if (seed !== state.seed) state.lastSearch = undefined;
  else if (state.found.length && place(filters) !== place(state.filters)) state.lastSearch = state.filters;
  state.seed = seed;
  state.filters = filters;
  showSeedMode();
  state.found = cities;
  save();
  session.selected = null;
  // The ship picked out under the map, and any menu left open, belonged to the routes this search replaces.
  $('picked').hidden = true;
  $('menu').hidden = true;
  fillForm();
  showExploredNote();
  if (refit) fitSearch(filters);
  if (foldWhenDone && cities.length) settings.open = false;
  foldWhenDone = false;
  rebuild(() => {
    if (session.openCustomAfterSearch !== null) {
      session.selected = session.generatedCount + session.openCustomAfterSearch < session.batches.length ? session.generatedCount + session.openCustomAfterSearch : null;
      session.openCustomAfterSearch = null;
    }
    if (!session.locateAfterSearch) return;
    const pos = session.locateAfterSearch;
    session.locateAfterSearch = null;
    if (!openNearest(pos, 'Searched around your position. ')) {
      mapNote.textContent = 'No route near your position. Try a larger radius or a longer flight limit.';
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
    `That search covers about ${fmt(Math.round(ships / 1000) * 1000)} ships, more than the ` +
    `${fmt(MAX_SEARCH_CITIES)} that can be routed at once.`;
  warning.hidden = false;
  foldWhenDone = false;
  settings.open = true;
  return true;
}

function endSearch(): void {
  session.worker?.terminate();
  session.worker = null;
  findBtn.textContent = 'Find ships';
  findBtn.classList.remove('busy');
  progress.hidden = true;
}

const settings = $<HTMLDetailsElement>('settings');
const bandFold = $<HTMLDetailsElement>('bandBox');
const nearPanel = $('nearPanel');
const nearToggle = $<HTMLButtonElement>('nearToggle');
/** Show or put away the coordinate boxes under "Search near me". */
function showNearPanel(open: boolean): void {
  nearPanel.hidden = !open;
  nearToggle.setAttribute('aria-expanded', String(open));
}
nearToggle.addEventListener('click', () => {
  showNearPanel(nearPanel.hidden);
  if (!nearPanel.hidden) nearX.focus();
});
/** Show which of the two searches is in use: its button marked, and the boxes under "Search near me" out or away. */
export function showSearchFold(): void {
  // The two search buttons are equals: the one whose search is showing carries the accent. The boxes
  // under "Search near me" stay out while it is the search in use, and are put away for Find ships.
  showNearPanel(aroundMode());
  showSearchChoice();
  showRadius();
}
/** Set when the search button itself was pressed, so the settings fold away once the results are in. */
let foldWhenDone = false;

form.addEventListener('submit', (e) => {
  e.preventDefault();
  // While a search is running the button cancels it; the previous results stay as they were.
  if (session.worker) {
    if (confirm('Cancel the search? The ships already shown will stay as they are.')) {
      endSearch();
      session.locateAfterSearch = null;
      // The search that was cancelled may have been for another world: the box goes back to the one on show.
      seedInput.value = state.seed;
      showSeedReset();
    }
    return;
  }
  // Changing a control re-runs an instant search with no submitter; only fold for a deliberate press.
  foldWhenDone = e.submitter !== null;
  const filters = formFilters();
  if (aroundMode() && !filters.around) {
    aroundRadius.setCustomValidity('Enter a radius in blocks.');
    aroundRadius.reportValidity();
    return;
  }
  if (!filters.around && filters.maxDist <= filters.minDist) {
    settings.open = true;
    bandFold.open = true;
    maxInput.setCustomValidity('Must be larger than the starting distance.');
    maxInput.reportValidity();
    return;
  }
  if (!filters.around && !filters.quadrants.length) {
    // The quadrants are under the settings, which may be folded: open them so the message has somewhere to show.
    settings.open = true;
    bandFold.open = true;
    quadBoxes[0].setCustomValidity('Pick at least one quadrant.');
    quadBoxes[0].reportValidity();
    return;
  }
  const seed = seedInput.value.trim();
  if (!/^-?\d+$/.test(seed)) {
    // The field is inside a folded section; open it so the message can be shown.
    settings.open = true;
    $<HTMLDetailsElement>('advanced').open = true;
    seedInput.setCustomValidity('A world seed is a whole number.');
    seedInput.reportValidity();
    return;
  }
  // Another world has other ships: routes made or changed by hand do not carry over.
  const byHand =
    state.custom.some((r) => r.length) ||
    Object.keys(state.moved).length ||
    state.dropped?.length ||
    state.extra?.length ||
    Object.keys(state.orders ?? {}).length;
  if (
    seed !== state.seed &&
    byHand &&
    !confirm('Change the world seed? Your custom routes and the changes you made to routes by hand belong to this world, and will be lost. Looted marks are kept for each world.')
  ) {
    seedInput.value = state.seed;
    showSeedReset();
    return;
  }

  // Within the pre-generated range a search is just a filter.
  if (session.precomputed?.covers(seed, filters)) {
    const found = session.precomputed.search(filters);
    if (!tooBig(found.filter((c) => c[2]).length)) applyResult(seed, filters, found);
    return;
  }
  // A live search can take a long time, so judge its size from the area before starting it.
  if (tooBig(estimateShips(filters))) return;

  // The built worker is a plain script, which every browser can start. Only the dev server serves it as a module.
  session.worker = import.meta.env.DEV
    ? new Worker(new URL('./generation/worker.ts', import.meta.url), { type: 'module' })
    : new Worker(new URL('./generation/worker.ts', import.meta.url));
  findBtn.textContent = 'Cancel search';
  findBtn.classList.add('busy');
  progress.hidden = false;
  progress.value = 0;
  const finish = endSearch;
  session.worker.addEventListener('message', (ev: MessageEvent<FindResponse>) => {
    if (ev.data.type === 'progress') {
      progress.value = ev.data.fraction;
      return;
    }
    finish();
    if (!tooBig(ev.data.cities.filter((c) => c[2]).length)) applyResult(seed, filters, ev.data.cities);
  });
  session.worker.addEventListener('error', (ev) => {
    finish();
    $('stats').textContent = `Search failed: ${ev.message}`;
  });
  session.worker.postMessage({ seed, filters } satisfies FindRequest);
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
for (const el of [minInput, maxInput, diagInput, angleFromSelect, aroundRadius, ...quadBoxes]) {
  el.addEventListener('input', renderMap);
}
// A typed number snaps to the nearest step its field accepts (500 blocks for distances and the radius,
// 250 for flight limits), so an in-between value never blocks the search. Listening in the capture
// phase means this runs before the handlers that read the value.
const snapToStep = (e: Event) => {
  const field = e.target;
  if (!(field instanceof HTMLInputElement) || field.type !== 'number' || field.value.trim() === '') return;
  const step = Number(field.step) || 1;
  const min = field.min === '' ? -Infinity : Number(field.min);
  const max = field.max === '' ? Infinity : Number(field.max);
  const typed = Number(field.value);
  if (!Number.isFinite(typed)) return;
  field.value = String(Math.min(max, Math.max(min, Math.round(typed / step) * step)));
};
form.addEventListener('change', snapToStep, true);
// The radius sits beside "Search near me", outside the settings form.
$('nearMe').addEventListener('change', snapToStep, true);
aroundRadius.addEventListener('input', () => aroundRadius.setCustomValidity(''));

// Instant searches are applied as the controls change; slow ones wait for the button.
function formCovered(): boolean {
  return !!session.precomputed && !session.worker && session.precomputed.covers(seedInput.value.trim(), previewFilters());
}
for (const el of [minInput, maxInput, diagInput, angleFromSelect, aroundRadius, ...quadBoxes]) {
  el.addEventListener('change', () => {
    if (aroundMode() && !formFilters().around) return;
    if (formCovered() && form.checkValidity()) form.requestSubmit();
  });
}

$('finishedToggle').addEventListener('click', () => {
  session.showFinished = !session.showFinished;
  renderBatches();
});
$<HTMLSelectElement>('pageSelect').addEventListener('change', (e) => {
  session.page = Number((e.target as HTMLSelectElement).value);
  renderBatches();
});

$('pagePrev').addEventListener('click', () => {
  session.page--;
  renderBatches();
});
$('pageNext').addEventListener('click', () => {
  session.page++;
  renderBatches();
});

$('starBtn').addEventListener('click', async () => {
  session.showStars = !session.showStars;
  if (session.showStars && !session.skyFigures) {
    session.skyFigures = await loadSkyFigures();
    session.starCache = null;
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
export function retireFinished(keep: number | null): boolean {
  const routes = session.batches.slice(0, session.generatedCount);
  const done = (b: City[]) => b.length > 0 && b.every((c) => session.tracker.has(c));
  const finished = routes.filter((b, i) => i !== keep && done(b));
  if (!finished.length) return false;
  if (routes.some((b) => !done(b) && b.some((c) => session.tracker.has(c)))) return false;
  state.excluded = [...new Set([...state.excluded, ...finished.flat().map(cityId)])];
  save();
  return true;
}

// ---------- locate ----------

/**
 * The position "Search near me" works from: the coordinates in its two boxes, or 0,0 (End Spawn)
 * while both are empty. Null, with a message beside the boxes, when only one is filled in.
 */
function nearPosition(): { x: number; z: number } | null {
  if (nearX.value.trim() === '' && nearZ.value.trim() === '') return { x: 0, z: 0 };
  const [x, z] = [Number(nearX.value), Number(nearZ.value)];
  if (nearX.value.trim() !== '' && nearZ.value.trim() !== '' && Number.isFinite(x) && Number.isFinite(z)) {
    return { x: Math.round(x), z: Math.round(z) };
  }
  nearX.setCustomValidity('Enter both x and z, or leave both empty for 0,0.');
  nearX.reportValidity();
  return null;
}
/** Show a search near a position as the player's own: the marker on the map, and the coordinates in the boxes. */
export function showPosition(pos: { x: number; z: number }): void {
  session.you = { x: pos.x, z: pos.z };
  // A search from the empty boxes was around 0,0, and they are empty again for it.
  if (pos.x !== 0 || pos.z !== 0) return setNear(pos);
  nearX.value = '';
  nearZ.value = '';
}
/** "Clear position" is offered whenever there is one to clear: a marker on the map, or coordinates in the boxes. */
export function showClearPosition(): void {
  $('mapReset').hidden = !session.you && !session.pin && nearX.value.trim() === '' && nearZ.value.trim() === '';
}
/** Put a position in those boxes, to stay there until the player changes it. */
export function setNear(pos: { x: number; z: number }): void {
  showNearPanel(true);
  nearX.value = String(pos.x);
  nearZ.value = String(pos.z);
  showClearPosition();
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
pasteIntoBoth(nearX, nearZ);
export const mapNote = $('mapNote');

/** Open the batch holding the nearest city worth visiting. Returns false when there is none. */
function openNearest(pos: { x: number; z: number }, prefix = ''): boolean {
  // Prefer a city that is not looted; fall back to any city if everything is.
  let best: { batch: number; order: number; d: number } | null = null;
  for (const onlyFresh of [true, false]) {
    session.batches.forEach((batch, b) =>
      batch.forEach((c, k) => {
        if (onlyFresh && session.tracker.has(c)) return;
        const d = Math.hypot(c.x - pos.x, c.z - pos.z);
        if (!best || d < best.d) best = { batch: b, order: k, d };
      }),
    );
    if (best) break;
  }
  const hit = best as { batch: number; order: number; d: number } | null;
  if (!hit) return false;
  mapNote.textContent = `${prefix}Nearest: ${waypointName(hit.batch, hit.order)}, ${fmt(Math.round(hit.d))} blocks away.`;
  select(hit.batch);
  map.fit([...session.batches[hit.batch], pos], state.filters.maxDist);
  return true;
}


/** Search around a position and open the route nearest it, whatever the search was showing before. */
function searchAround(pos: { x: number; z: number }): void {
  session.you = { x: pos.x, z: pos.z };
  session.searchCentre = session.you;
  showSearchFold();
  if (!(Number(aroundRadius.value) > 0)) aroundRadius.value = '10000';
  mapNote.textContent = 'Searching around your position…';
  session.locateAfterSearch = session.you;
  form.requestSubmit();
  // A refused or invalid search never reports back, so don't leave the request hanging.
  if (!session.worker && session.locateAfterSearch) {
    session.locateAfterSearch = null;
    mapNote.textContent = 'Could not search around that position. Check the settings.';
    renderMap();
  }
}

// The main search button: the band around End Spawn, as set under Settings. Its label says how
// far out that is, since the default leaves out the picked-over first 10,000 blocks.
/** Under "Search near me": where its search is centred while one is showing, or what it will ask for. */
function showNearLabel(): void {
  const text = session.searchCentre ? `around x: ${session.searchCentre.x}, z: ${session.searchCentre.z}` : 'around your coordinates';
  nearToggle.replaceChildren('Search near me', Object.assign(document.createElement('small'), { textContent: text }));
}
/** Mark which of the two search buttons has its search showing. */
function showSearchChoice(): void {
  $('quickSpawn').classList.toggle('primary', !aroundMode());
  nearToggle.classList.toggle('primary', aroundMode());
  showNearLabel();
}
function showQuickSpawn(): void {
  const [from, to] = [Number(minInput.value), Number(maxInput.value)];
  const range = Number.isFinite(from) && Number.isFinite(to) && to > from ? `around End Spawn, ${fmt(from)}–${fmt(to)} blocks` : 'around End Spawn';
  $('quickSpawn').replaceChildren('Find ships', Object.assign(document.createElement('small'), { textContent: range }));
}
for (const el of [minInput, maxInput]) {
  el.addEventListener('input', showQuickSpawn);
  el.addEventListener('change', showQuickSpawn);
}
showQuickSpawn();
$('quickSpawn').addEventListener('click', () => {
  session.searchCentre = null;
  showSearchFold();
  // Whatever the map last said was about the search this one replaces.
  mapNote.textContent = '';
  renderMap();
  form.requestSubmit();
});

// "Search near me", above the settings.
for (const el of [nearX, nearZ]) {
  el.addEventListener('input', () => {
    nearX.setCustomValidity('');
    showClearPosition();
  });
}
$<HTMLFormElement>('nearMe').addEventListener('submit', (e) => {
  e.preventDefault();
  const typed = nearPosition();
  if (!typed) return;
  searchAround(typed);
});

// Back to the search before this one. That search then becomes the one to come back to, so the link
// goes to and fro between the two.
$('searchBack').addEventListener('click', () => {
  const back = state.lastSearch;
  if (session.worker || !back) return;
  // A search near a position only remembers where it was: the Find cities settings stay as they are now.
  fillSearch(back.around ? { ...formFilters(), around: back.around } : back);
  if (back.around) showPosition(back.around);
  showSearchFold();
  mapNote.textContent = '';
  form.requestSubmit();
});

// Look at a place without searching there: the map jumps to the coordinates in the boxes and marks them,
// leaving the open route and the player's position as they are.
$('showOnMap').addEventListener('click', () => {
  const pos = nearPosition();
  if (!pos) return;
  session.pin = pos;
  mapNote.textContent = '';
  renderMap();
  map.goTo(pos.x, pos.z);
});

// The other way round: the coordinates at the map's crosshair go into the boxes, once. They do not follow
// the map afterwards.
$('useCentre').addEventListener('click', () => {
  setNear(session.viewCentre);
  nearX.setCustomValidity('');
});

// Clear the boxes and the markers those two leave, and put the view back at 0,0.
$('mapReset').addEventListener('click', () => {
  session.you = null;
  session.pin = null;
  nearX.value = '';
  nearZ.value = '';
  nearX.setCustomValidity('');
  mapNote.textContent = '';
  renderMap();
  map.centreOn(0, 0);
});
