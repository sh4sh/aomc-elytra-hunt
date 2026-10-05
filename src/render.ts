// Drawing the page from the session: the route list, the open route's panel, the map and its legend.

import { EXTRA_NOTE, MAPPED_NOTE, PAGE_SIZE, POSSIBLE_WHY, RENUMBERED_NOTE } from './constants';
import { lookalike } from './constellations';
import { $, fmt, xzText } from './dom';
import type { MapCity } from './map';
import { openMenu } from './map-actions';
import { map } from './map-view';
import { cityChatLine, copiedKey, copiedLines, copyText } from './route-panel';
import { batchTitle, batchWorker, color, earlierPaths, earlierStudy, isCustom, lastEdit, looted, lootedCities, moveCity, orderKey, possible, possibleNote, rebuild, recordMarks, routeLength, startPoint } from './routes';
import { aroundMode, formFilters, retireFinished, showClearPosition } from './search';
import { session } from './session';
import { showSurvey } from './settings';
import { DEFAULT_SEED, save, state } from './state';
import { describeTrajectory } from './trajectory';
import { type City, cityId, type Filters } from './types';
import { OUTSIDE_COLOR, waypointName } from './xaero';

// ---------- rendering ----------

/**
 * What to shade as the search area: the form's settings, so the shape follows the controls while
 * they are being changed, or the applied search if the form holds something unusable.
 */
export function previewFilters(): Filters {
  const f = formFilters();
  if (aroundMode()) return f.around ? f : state.filters;
  const usable = Number.isFinite(f.minDist) && Number.isFinite(f.maxDist) && f.minDist >= 0 && f.maxDist > f.minDist;
  return usable ? f : state.filters;
}

/** The legend only explains marks that are in view on the map just now. */
export function renderLegend(): void {
  const seen = session.shownCities.filter((c) => map.inView(c.city.x, c.city.z));
  // Whether any of the shaded search area is in view: for a search around a position, its circle; for
  // Find ships, the band between its two distances (the quadrants and angle are not looked at).
  const f = previewFilters();
  const v = map.viewBounds();
  const area = f.around
    ? Math.hypot(Math.max(v.x0 - f.around.x, 0, f.around.x - v.x1), Math.max(v.z0 - f.around.z, 0, f.around.z - v.z1)) <= f.around.radius
    : v.x0 <= f.maxDist && v.x1 >= -f.maxDist && v.z0 <= f.maxDist && v.z1 >= -f.maxDist &&
      !(v.x0 > -f.minDist && v.x1 < f.minDist && v.z0 > -f.minDist && v.z1 < f.minDist);
  const legend = {
    route: seen.some((c) => c.batch >= 0 && !c.visited && !(c.possible && map.detailed)),
    looted: seen.some((c) => c.visited && !c.already && !c.trophy),
    // The goose's view has marks of its own.
    gold: seen.some((c) => c.trophy === 'looted'),
    mapped: seen.some((c) => c.trophy === 'mapped'),
    area,
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

export function renderMap(): void {
  showClearPosition();
  const cities: MapCity[] = [];
  session.batches.forEach((batch, b) =>
    batch.forEach((city, order) =>
      cities.push({
        city,
        batch: b,
        order,
        color: color(b),
        visited: session.tracker.has(city),
        already: session.tracker.showsAlready(city),
        possible: possible(city),
      }),
    ),
  );
  for (const o of session.outside) {
    cities.push({
      city: o.city,
      batch: -1,
      order: 0,
      color: OUTSIDE_COLOR,
      visited: session.tracker.has(o.city),
      already: session.tracker.showsAlready(o.city),
      note: o.note,
      missing: o.missing,
    });
  }
  if (session.showTrophies) {
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
    if (state.seed === DEFAULT_SEED) for (const city of session.webmapCities ?? []) mark(city, 'mapped', 'in an area on the webmap');
    for (const city of lootedCities()) mark(city, 'looted', 'looted');
  }
  session.shownCities = cities;
  map.setScene({
    cities,
    selectedBatch: session.selected,
    hot: session.hot,
    filters: state.filters,
    searchArea: previewFilters(),
    explored: state.seed === DEFAULT_SEED ? session.explored : null,
    paths: earlierPaths(),
    you: session.you,
    pin: session.pin,
  });
}

/**
 * One line on how the routes are made, shown while the settings are folded away. Where each search
 * looks is said on or beside its own button, so it is not repeated here.
 */
function renderSettingsSummary(): void {
  // Short enough to stay on one line at the sidebar's default width, even indented under Routes.
  const text = [
    `${state.batchShape === 'line' ? 'Lines' : 'Clusters'} of ${state.batchSize}`,
    state.maxHop ? `flights up to ${fmt(state.maxHop)}` : 'any flight length',
  ].join(' · ');
  // Under Settings while that is folded, and under Routes inside it, where these are changed.
  $('settingsSummary').textContent = text;
  $('routesSummary').textContent = text;
}

export function renderBatches(): void {
  renderSettingsSummary();
  // Every ship of the search that is the player's to deal with: in a route, without one, or looted and
  // taken out of its route. Counted this way the numbers stay put however the routes are cut. Ships left
  // out as on the webmap or reported missing, and ones brought in from beyond the search, are not in it.
  const counted = [
    ...session.batches.flat(),
    ...session.outside.filter((o) => !o.missing && o.note !== MAPPED_NOTE && o.note !== EXTRA_NOTE).map((o) => o.city),
  ];
  const total = counted.length;
  const done = looted(counted);
  const maybeCount = session.batches.flat().filter(possible).length;
  // Earlier flight paths get a line of their own, and only when one is drawn. Reports that nearly made
  // a path are not listed: they are the app's working, and came and went as the map was zoomed.
  const study = earlierStudy();
  const pathNote = $('pathNote');
  // Like the lines themselves, only once zoomed in.
  pathNote.hidden = !map.detailed || !study.paths.length;
  pathNote.replaceChildren(
    ...study.paths.map((t) => `Possible earlier flight path (${describeTrajectory(t)}).`).map(
      (text) => Object.assign(document.createElement('span'), { textContent: text }),
    ),
  );
  // The line itself says what a player acts on; the rest of the tally is there on hover.
  $('stats').title = total
    ? [
        session.shipless ? `${fmt(session.shipless)} End Cities without a ship left out` : '',
        session.skipped ? `${fmt(session.skipped)} left out as already on the webmap` : '',
        session.unbatched ? `${fmt(session.unbatched)} without a route (faint diamonds)` : '',
        session.uncertainShips.size ? `${fmt(session.uncertainShips.size)} with an uncertain ship (marked ?)` : '',
        maybeCount ? `${fmt(maybeCount)} possibly looted (marked ?)` : '',
        state.excluded.length ? `${fmt(state.excluded.length)} looted removed from routes` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  // While routes are being worked out again the old ones are still listed, and the counts wait with them.
  if (!batchWorker) $('stats').textContent = total
    ? `${fmt(total)} ships · ${fmt(session.batches.length)} routes · ${fmt(done)} looted` +
      (session.usedBatchSize < state.batchSize && session.generatedCount
        ? ` · no route of ${state.batchSize} fits here, so routes of ${session.usedBatchSize} were made`
        : '')
    : session.unbatched
      ? `No routes: ${fmt(session.unbatched)} ships, but no two are within the longest flight of each other. Raise the longest flight.`
      : 'No ships yet. Set a range and press Find ships.';


  // Finished routes drop out of the list, so what is left is what there is still to fly. The open
  // route stays while it is open, finished or not. Route numbers do not change: waypoints already in
  // the player's map mod keep matching.
  const finished = (b: City[]) => b.length > 0 && b.every((c) => session.tracker.has(c));
  const live: number[] = [];
  let hiddenCount = 0;
  for (let i = 0; i < session.generatedCount; i++) {
    if (finished(session.batches[i])) hiddenCount++;
    if (session.showFinished || i === session.selected || !finished(session.batches[i])) live.push(i);
  }
  const finishedNote = $('finishedNote');
  finishedNote.hidden = hiddenCount === 0;
  $('finishedCount').textContent = `${fmt(hiddenCount)} finished ${hiddenCount === 1 ? 'route' : 'routes'} ${session.showFinished ? 'shown' : 'hidden'}`;
  $('finishedToggle').textContent = session.showFinished ? 'hide' : 'show';

  const pages = Math.max(1, Math.ceil(live.length / PAGE_SIZE));
  // Jump to the selected batch's page when the selection changes, e.g. after clicking a city on the map.
  if (session.selected !== session.pageFollowed) {
    session.pageFollowed = session.selected;
    if (session.selected !== null && !isCustom(session.selected)) session.page = Math.floor(live.indexOf(session.selected) / PAGE_SIZE);
  }
  session.page = Math.max(0, Math.min(session.page, pages - 1));
  const onPage = live.slice(session.page * PAGE_SIZE, (session.page + 1) * PAGE_SIZE);
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
  pageSelect.value = String(session.page);
  $<HTMLButtonElement>('pagePrev').disabled = session.page === 0;
  $<HTMLButtonElement>('pageNext').disabled = session.page === pages - 1;
  $<HTMLInputElement>('gotoBatch').max = String(session.generatedCount);

  // Custom batches stay pinned above whichever page of generated batches is showing.
  const shown: number[] = [];
  for (let i = session.generatedCount; i < session.batches.length; i++) shown.push(i);
  shown.push(...onPage);

  const list = $('batches');
  list.replaceChildren(
    ...shown.map((i) => {
      const batch = session.batches[i];
      const li = document.createElement('li');
      li.classList.toggle('custom', isCustom(i));
      const n = looted(batch);
      li.classList.toggle('done', batch.length > 0 && n === batch.length);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-current', String(i === session.selected));
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
        ? `About ${round(reach + along)} blocks of flying in all: ${round(reach)} to reach the first ship, then ${round(along)} along the route`
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

export function renderDetail(): void {
  // Help sits over the batch without closing it, so the batch is still there to go back to.
  const showBatch = session.selected !== null && !session.helpOpen;
  $('detailEmpty').hidden = showBatch;
  $('detailBody').hidden = !showBatch;
  const back = $('helpBack');
  back.hidden = session.selected === null;
  if (session.selected !== null) back.textContent = `← Back to ${batchTitle(session.selected).toLowerCase()}`;
  // The help opens in the other panel, which the button says while there is something to open.
  const closing = session.selected !== null && session.helpOpen;
  $('helpLabel').textContent = closing ? 'Close help' : 'How to use';
  $('helpWhere').hidden = closing;
  if (session.selected === null) return;
  const batch = session.batches[session.selected];
  const i = session.selected;

  let length = 0;
  batch.forEach((c, k) => {
    if (k) length += Math.hypot(c.x - batch[k - 1].x, c.z - batch[k - 1].z);
  });
  $('detailTitle').textContent = batchTitle(i);
  $('customDelete').hidden = !isCustom(i);
  // Ending a route early only means something part-way through a route the app made. Like the undo
  // arrows, the button is always there and faded when it has nothing to do, so it can be found.
  const endRoute = $<HTMLButtonElement>('endRoute');
  endRoute.hidden = isCustom(i);
  endRoute.disabled = looted(batch) === 0 || looted(batch) === batch.length;
  endRoute.title = looted(batch) === 0
    ? 'Nothing to end yet: this is for stopping a route after looting some of its ships'
    : looted(batch) === batch.length
      ? 'This route is complete: every ship in it is looted'
      : 'Stop this route where it is: the ships you looted are put away, and the ones you did not reach are grouped into new routes';
  // Always there, faded when there is nothing to undo or redo, so they do not jump in and out.
  // Which of the route's cities are in doubt, and a "why?" that unfolds the reasons that apply.
  const doubts = batch.map(possibleNote).filter((n): n is string => n !== null);
  const why = $('possibleWhy');
  why.hidden = !doubts.length;
  if (doubts.length) {
    $('possibleCount').textContent = `${doubts.length} possibly looted ${doubts.length === 1 ? 'ship' : 'ships'} in this route (marked ?)`;
    $('possibleReasons').replaceChildren(
      ...POSSIBLE_WHY.filter(([start]) => doubts.some((n) => n.startsWith(start))).map(([, text]) =>
        Object.assign(document.createElement('li'), { textContent: text }),
      ),
    );
  }
  $<HTMLButtonElement>('addOneUndo').disabled = !lastEdit(i);
  $<HTMLButtonElement>('routeRedo').disabled = !lastEdit(i, state.redo);
  // Nothing left to export from a route that is all looted: say so in place of the map-mod section.
  const complete = batch.length > 0 && batch.every((c) => session.tracker.has(c));
  $('routeDone').hidden = !complete;
  $('exportBox').hidden = complete;
  // Which city the two buttons below act on: the first one not looted yet.
  const at = batch.findIndex((c) => !session.tracker.has(c));
  const currentCity = $('currentCity');
  currentCity.hidden = at < 0;
  if (at >= 0) {
    currentCity.replaceChildren(
      Object.assign(document.createElement('strong'), { textContent: `Current ship: ${waypointName(i, at)}` }),
      Object.assign(document.createElement('span'), { textContent: `${at + 1} of ${batch.length} · ${xzText(batch[at])}` }),
    );
  }
  ($('nextCity') as HTMLButtonElement).disabled = batch.every((c) => session.tracker.has(c));
  ($('nextCityAlready') as HTMLButtonElement).disabled = batch.every((c) => session.tracker.has(c));
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
    `${batch.length} ships · ${looted(batch)} looted · about ${hundreds(length + reach)} blocks` +
    (!isCustom(i) && batch.length < session.usedBatchSize ? ' · short route' : '') +
    (isCustom(i) && !batch.length ? ' · right-click a ship on the map to add it' : '');
  $('detailMeta').title = batch.length
    ? `${hundreds(reach)} blocks to reach the first ship, then ${hundreds(length)} along the route. Longest flight between ships: ${fmt(Math.round(longest))}.`
    : '';

  $('cities').replaceChildren(
    ...batch.map((c, k) => {
      const li = document.createElement('li');
      li.classList.toggle('looted', session.tracker.has(c));
      li.classList.toggle('hot', c === session.hot);
      // The first city not looted yet is where the player is up to: the "current city" circle on the map.
      li.classList.toggle('current', c === batch.find((x) => !session.tracker.has(x)));
      const label = document.createElement('label');
      label.title = waypointName(i, k);
      const unsure = session.uncertainShips.has(cityId(c));
      if (unsure) label.title += ' · ship uncertain: it is a tight fit in this city and may not have generated';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = session.tracker.has(c);
      const maybeNote = possibleNote(c);
      const maybe = maybeNote !== null;
      if (maybeNote) label.title += ` · ${maybeNote}`;
      const already = session.tracker.showsAlready(c);
      li.classList.toggle('already', already);
      if (already) label.title += ' · looted by someone else';
      if (session.tracker.isShared(c)) {
        // On the shared list: looted for everyone, so it can't be unticked here.
        box.disabled = true;
        label.title += ' · on the shared looted list';
      }
      box.addEventListener('change', () => {
        recordMarks([c]);
        session.tracker.set(c, box.checked);
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
      chat.title = 'Copy this ship as a chat line: paste it into Minecraft chat to make its waypoint';
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
        session.dragFrom = k;
        e.dataTransfer?.setData('text/plain', xzText(c));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      const clearDrop = () => li.classList.remove('drop-before', 'drop-after');
      li.addEventListener('dragover', (e) => {
        if (session.dragFrom === null) return;
        e.preventDefault();
        const box = li.getBoundingClientRect();
        const after = e.clientY > box.top + box.height / 2;
        li.classList.toggle('drop-before', !after);
        li.classList.toggle('drop-after', after);
      });
      li.addEventListener('dragleave', clearDrop);
      li.addEventListener('dragend', () => (session.dragFrom = null));
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        const after = li.classList.contains('drop-after');
        clearDrop();
        const from = session.dragFrom;
        session.dragFrom = null;
        if (from === null || from === k) return;
        // Taking the row out first shifts everything after it up by one.
        const to = (after ? k + 1 : k) - (from < k ? 1 : 0);
        moveCity(i, from, to);
      });
      label.append(box, n, xz, hop, chat);
      // The same menu as right-clicking the city's dot on the map.
      const menuAt = (x: number, y: number) => {
        const city: MapCity = { city: c, batch: i, order: k, color: color(i), visited: session.tracker.has(c), possible: possible(c) };
        openMenu(city, x, y, c, label);
      };
      label.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        menuAt(e.clientX, e.clientY);
      });
      // No right-click under a finger: there, each row carries a small button for the same menu.
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'chat more';
      more.textContent = '⋯';
      more.setAttribute('aria-label', 'Options for this ship');
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
  if (session.showStars && session.starCache?.key !== key) session.starCache = { key, match: lookalike(batch, session.skyFigures ?? []) };
  const match = session.showStars ? session.starCache!.match : null;
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

/**
 * What the open route is remembered by between visits: a ship in it, since routes are numbered afresh
 * whenever they are worked out, or a custom route's number.
 */
function openRouteKey(): string | undefined {
  const i = session.selected;
  if (i === null) return undefined;
  if (isCustom(i)) return `custom:${i - session.generatedCount}`;
  return session.batches[i]?.length ? cityId(session.batches[i][0]) : undefined;
}
/** Open the route that was open at the end of the last visit, if it is still there. */
export function reopen(): void {
  const key = state.openRoute;
  if (!key) return;
  const at = key.startsWith('custom:')
    ? session.generatedCount + Number(key.slice(7))
    : session.batches.findIndex((b) => b.some((c) => cityId(c) === key));
  session.selected = at >= 0 && at < session.batches.length ? at : null;
}

export function render(): void {
  if (!session.reopening && openRouteKey() !== state.openRoute) {
    state.openRoute = openRouteKey();
    save();
  }
  renderBatches();
  renderDetail();
  renderMap();
  showSurvey();
}

export function setHot(c: City | null): void {
  if (session.hot === c) return;
  session.hot = c;
  renderMap();
}

export function select(i: number | null, zoom = false): void {
  // The player has chosen for themselves: nothing left to reopen.
  session.reopening = false;
  // Opening a batch, from the list or the map, puts the help away.
  if (i !== null) session.helpOpen = false;
  // Leaving a finished route is the moment to regroup what is left. The routes are numbered afresh,
  // so the one being opened is found again by one of its cities.
  if (i !== session.selected && retireFinished(i)) {
    const target = i !== null && session.batches[i].length ? cityId(session.batches[i][0]) : null;
    rebuild(() => {
      const at = target === null ? -1 : session.batches.findIndex((b) => b.some((c) => cityId(c) === target));
      session.selected = at < 0 ? null : at;
      if (zoom && session.selected !== null) map.fit(session.batches[session.selected], state.filters.maxDist);
    });
    render();
    $('mapNote').textContent = RENUMBERED_NOTE;
    return;
  }
  session.selected = i;
  render();
  if (zoom && i !== null) map.fit(session.batches[i], state.filters.maxDist);
}
