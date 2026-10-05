// The controls under Settings that are not about where to search: route options, the webmap, the
// world seed, restoring defaults and Dev mode.

import { MAX_BATCH_SIZE, WEBMAP_CHECKS_URL } from './constants';
import { initDevMode } from './dev-mode';
import { $ } from './dom';
import { BATCH_SIZE, type BatchShape, DEFAULT_MAX_HOP } from './filters';
import { showBackToMap } from './map-actions';
import { map } from './map-view';
import { render } from './render';
import { rebuild } from './routes';
import { applyResult, fillForm, form, showSearchFold } from './search';
import { session } from './session';
import { DEFAULT_FILTERS, DEFAULT_LINE_DEVIATION, DEFAULT_SEED, save, state } from './state';

// ---------- webmap ----------

const sizeInput = $<HTMLInputElement>('batchSize');
sizeInput.max = String(MAX_BATCH_SIZE);
sizeInput.value = String(state.batchSize);
sizeInput.addEventListener('change', () => {
  const n = Math.round(Number(sizeInput.value));
  state.batchSize = Math.min(MAX_BATCH_SIZE, Math.max(1, Number.isFinite(n) ? n : BATCH_SIZE));
  sizeInput.value = String(state.batchSize);
  save();
  session.selected = null;
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
  session.selected = null;
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
  session.selected = null;
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
  session.selected = null;
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
  session.selected = null;
  rebuild();
  render();
  showExploredNote();
});

const possibleBox = $<HTMLInputElement>('skipPossible');
possibleBox.checked = !!state.skipPossible;
possibleBox.addEventListener('change', () => {
  state.skipPossible = possibleBox.checked;
  save();
  session.selected = null;
  rebuild();
  render();
});

// ---------- dev mode: the survey ----------

export const { showSurvey } = initDevMode({
  tracker: () => session.tracker,
  searching: () => session.worker !== null,
  precomputed: () => session.precomputed,
  isMapped: (x, z) => !!session.explored?.isMapped(x, z),
  reportedGone: (id) => session.shipReports.gone.has(id),
  showSearch: (filters, found, openCustom) => {
    session.openCustomAfterSearch = openCustom;
    applyResult(DEFAULT_SEED, filters, found);
  },
});

// Put every search setting back to how a first-time visitor finds it, and search again.
$('searchReset').addEventListener('click', () => {
  if (session.worker) return;
  if (
    !confirm(
      'Restore the default settings? Your looted marks are kept. Custom routes are kept too, unless the world seed had been changed.',
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
  // Back to Find ships: the boxes under Search near me are put away.
  showSearchFold();
  state.seed = applied.seed;
  state.filters = applied.filters;
  $('searchWarning').hidden = true;
  save();
  form.requestSubmit();
  // If the search itself was already the default one, nothing re-ran, so regroup with the reset batch settings.
  session.selected = null;
  rebuild();
  render();
});

export function showExploredNote(): void {
  const note = $('exploredNote');
  if (!session.explored) {
    note.textContent = 'No webmap data loaded, so ships already on the webmap could not be left out.';
    return;
  }
  // The data's own date only moves when the webmap changes. Where the time of the last check is known,
  // that is the one to show: the data was still right then.
  const changed = Date.parse(session.explored.fetchedAt);
  const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  note.textContent =
    `Ships already on the webmap are ${state.includeMapped ? 'included in' : 'left out of'} the routes. ` +
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
