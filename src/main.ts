import { $, fmt } from './dom';
import { Explored } from './explored';
import { map } from './map-view';
import { Precomputed } from './precomputed';
import { render, renderMap } from './render';
import { showSharedNote } from './route-panel';
import { findWebmapCities, lootedCities, rebuild } from './routes';
import { fillForm, fitSearch, form, retireFinished, showPosition, showSearchFold } from './search';
import { session } from './session';
import { showExploredNote } from './settings';
import { DEFAULT_SEED, save, state } from './state';
import { loadShipReports } from './submissions';
import './goose-emoji';
import './panels';
import './map-actions';

// ---------- goose ----------

// The goose keeps count: click it to see every looted city at once, click again to put them away.
const gooseCredit = $('gooseCredit');
const gooseTally = $('gooseTally');
const showTally = () => {
  if (!session.showTrophies) return (gooseTally.textContent = '');
  const looted = lootedCities().length;
  const parts = [looted ? `${fmt(looted)} ${looted === 1 ? 'ship' : 'ships'} looted so far (gold ×)` : 'nothing looted yet'];
  if (state.seed === DEFAULT_SEED && session.explored) {
    parts.push(session.webmapCities ? `${fmt(session.webmapCities.length)} more in areas on the webmap (green +)` : 'counting the ones on the webmap…');
  }
  gooseTally.textContent = `Honk! ${parts.join(', ')}.`;
};
gooseCredit.addEventListener('click', async () => {
  session.showTrophies = !session.showTrophies;
  showTally();
  renderMap();
  if (!session.showTrophies) return;
  const fitAll = () => {
    const all = [...lootedCities(), ...(session.webmapCities ?? [])];
    if (all.length) map.fit(all, state.filters.maxDist);
  };
  fitAll();
  // The webmap's cities take a moment to work out the first time; they join the view when ready.
  if (!session.webmapCities && session.explored && state.seed === DEFAULT_SEED) {
    session.webmapCities = await findWebmapCities(session.explored);
    showTally();
    renderMap();
    if (session.showTrophies) fitAll();
  }
});


// ---------- start ----------

fillForm();
showSearchFold();
// A search near a position comes back after a reload with its position still on show.
if (state.filters.around) showPosition(state.filters.around);
rebuild();
render();
fitSearch(state.filters);
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
  session.shipReports = {
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
  session.explored = e;
  session.precomputed = p;
  session.sharedLooted = looted.cities;
  session.sharedAlready = looted.already;
  session.sharedBy = looted.by;
  if (state.seed === DEFAULT_SEED) session.tracker.setShared(session.sharedLooted, session.sharedAlready, session.sharedBy);
  showSharedNote();
  showExploredNote();
  // Routes finished on an earlier visit are regrouped away once the routes are first worked out.
  rebuild(() => {
    const settled = () => {
      session.reopening = false;
    };
    if (retireFinished(null)) rebuild(settled);
    else settled();
  });
  render();
  if (!state.found.length) form.requestSubmit();
});
