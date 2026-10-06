// What the open route's panel does: sending waypoints to a map mod, ticking ships off, adding and
// reordering them, plus the help links and the looted-list files.

import { BEYOND_BLOCKS, MAPPED_NOTE, RENUMBERED_NOTE } from './constants';
import { $, download, fmt } from './dom';
import type { FoundCity } from './generation/worker';
import { exportArea } from './export-areas';
import { chatLine, cleanUsername } from './journeymap';
import { rebuildKeeping } from './map-actions';
import { render, renderDetail } from './render';
import { batchTitle, citiesAround, isCustom, lastEdit, orderKey, possible, pushEdit, rebuild, recordMarks, undrop, writeOrder } from './routes';
import { session } from './session';
import { DEFAULT_SEED, onUsername, type RouteEdit, save, type Saved, setUsername, state } from './state';
import { initSubmissions } from './submissions';
import { type City, cityId } from './types';
import { batchColor, shareLine, waypointFile, waypointLines, waypointName } from './xaero';

// ---------- export ----------

const selectedLines = (): string[] =>
  session.selected === null ? [] : waypointLines(session.batches[session.selected], session.selected, (c) => session.tracker.has(c));

$('download').addEventListener('click', () => {
  if (session.selected !== null) download(`end-cities-route-${session.selected + 1}.txt`, waypointFile(selectedLines()));
});

export async function copyText(text: string): Promise<boolean> {
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
export function cityChatLine(c: City, i: number, k: number): string {
  const name = waypointName(i, k);
  return state.mapMod === 'xaero'
    ? shareLine(c, name, k < 99 ? String(k + 1) : 'EC', batchColor(i), state.chatName)
    : chatLine(c, name, state.chatName);
}
// Chat lines are copied a city at a time with the copy button on each row of the route's list, because
// Minecraft's chat sends a single message per paste. Rows already copied this visit are remembered,
// so the player can see how far down the list they have got.
export const copiedLines = new Set<string>();
export const copiedKey = (c: City) => `${state.mapMod}:${cityId(c)}`;

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
      : 'Without a username the lines go to public chat, where everyone sees them.') + ' Looted ships are left out.';
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
  setUsername(cleanUsername(chatNameInput.value));
  if (chatNameInput.value !== state.chatName) chatNameInput.value = state.chatName;
});
// The same name can be given under Share progress or in a report: show it here too.
onUsername(() => {
  if (document.activeElement !== chatNameInput) {
    chatNameInput.value = state.chatName;
    showChatName();
  }
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
  if (session.selected === null) return;
  recordMarks(session.batches[session.selected]);
  for (const c of session.batches[session.selected]) session.tracker.set(c, v);
  render();
}
$('customDelete').addEventListener('click', () => {
  if (session.selected === null || !isCustom(session.selected)) return;
  if (!confirm(`Delete ${batchTitle(session.selected).toLowerCase()}? Its ships go back to where they were. Looted marks are kept.`)) return;
  state.custom.splice(session.selected - session.generatedCount, 1);
  save();
  session.selected = null;
  rebuild();
  render();
});

// ---------- export for the webmap ----------

// The area to export from Xaero's World Map for the ships looted on the open route, given as two
// corners. Xaero shows no coordinates while an area is being selected, so each corner can be copied as
// a waypoint, the same way a ship is, to show on its map. Worked out only while the section is open.
export function renderWebmapExport(): void {
  const i = session.selected;
  if (i === null) return;
  // The path flown: the route's looted ships, in the order of the route.
  const area = exportArea(session.batches[i].filter((c) => session.tracker.has(c)));
  // Laid out like the rows of the ship list: a letter, the coordinates, and a button that copies the waypoint.
  const row = (letter: 'A' | 'B', x: number, z: number): HTMLLIElement => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat';
    btn.textContent = 'copy';
    btn.title = `Copy corner ${letter} as a chat line: paste it into Minecraft chat to make its waypoint`;
    btn.addEventListener('click', async () => {
      const at: City = { x, z, source: 'seed' };
      const name = `Export ${letter}`;
      const line = state.mapMod === 'xaero' ? shareLine(at, name, letter, 15, state.chatName) : chatLine(at, name, state.chatName);
      btn.textContent = (await copyText(line)) ? 'copied' : 'copy failed';
      setTimeout(() => (btn.textContent = 'copy'), 1500);
    });
    li.append(
      Object.assign(document.createElement('span'), { className: 'n', textContent: letter }),
      Object.assign(document.createElement('span'), { className: 'xz', textContent: `x: ${x}, z: ${z}` }),
      btn,
    );
    return li;
  };
  // The far corner is the last block inside the area, so both corners can be stood on.
  $('webmapCorners').replaceChildren(...(area ? [row('A', area.x0, area.z0), row('B', area.x1 - 1, area.z1 - 1)] : []));
  $('webmapCornersNote').textContent = area
    ? 'The corners take in the ships you have looted so far on this route.'
    : 'Mark a ship as looted first.';
}
$('webmapExport').addEventListener('toggle', () => {
  if ($<HTMLDetailsElement>('webmapExport').open) renderWebmapExport();
});

// Stop a route where it stands. The ships looted so far are put away for good and the ones not reached
// go back to be grouped afresh. Unlike finishing a route, nothing more is marked as looted.
$('endRoute').addEventListener('click', () => {
  const i = session.selected;
  if (i === null || isCustom(i)) return;
  const done = session.batches[i].filter((c) => session.tracker.has(c));
  const left = session.batches[i].length - done.length;
  if (
    !confirm(
      `End ${batchTitle(i).toLowerCase()} here after looting ${done.length} ${done.length === 1 ? 'ship' : 'ships'}?\n\nThe other ${left} will turn into new routes.\n\nMap waypoints will no longer match after this point.`,
    )
  ) {
    return;
  }
  state.excluded = [...new Set([...state.excluded, ...done.map(cityId)])];
  save();
  session.selected = null;
  rebuild();
  render();
  $('mapNote').textContent = RENUMBERED_NOTE;
});

$('markAll').addEventListener('click', () => markAll(true));

// Adds the city nearest the route's last stop that has no route, at the end: a quick way to fly a little further.
// Marks the city the player is at as looted, which moves "current city" on to the next one.
// With `already`, as looted by someone else before the player got there.
function nextCity(already: boolean): void {
  if (session.selected === null) return;
  const batch = session.batches[session.selected];
  const at = batch.findIndex((c) => !session.tracker.has(c));
  if (at < 0) return;
  recordMarks([batch[at]]);
  if (already) session.tracker.setAlready(batch[at], true);
  else session.tracker.set(batch[at], true);
  render();
  // Bring the new current city into view in the list.
  const next = batch.findIndex((c) => !session.tracker.has(c));
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
  if (session.selected === null) return;
  const batch = session.batches[session.selected];
  let best: City | null = null;
  let bestDist = Infinity;
  let beyond: FoundCity | null = null;
  for (const o of session.outside) {
    if (o.missing || session.tracker.has(o.city)) continue;
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
    const known = new Set([...session.batches.flat(), ...session.outside.map((o) => o.city)].map(cityId));
    const aomc = state.seed === DEFAULT_SEED;
    for (const found of citiesAround(last, Math.min(bestDist, BEYOND_BLOCKS))) {
      const city: City = { x: found[0], z: found[1], source: 'seed' };
      const id = cityId(city);
      if (!found[2] || known.has(id) || session.tracker.has(city)) continue;
      if (aomc && (session.shipReports.gone.has(id) || (!state.includeMapped && session.explored?.isMapped(city.x, city.z)))) continue;
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
    setTimeout(() => (addOneBtn.textContent = 'Add +1 ship to route'), 2000);
  };
  if (!best) return say(batch.length ? 'No ship without a route' : 'Add a first ship from the map');
  const id = cityId(best);
  undrop(id);
  state.appended = [...(state.appended ?? []).filter((x) => x !== id), id];
  pushEdit({ kind: 'add', id });
  if (isCustom(session.selected)) {
    const k = session.selected - session.generatedCount;
    state.custom[k].push(id);
    delete state.moved[id];
    save();
    rebuild(() => {
      session.selected = session.generatedCount + k < session.batches.length ? session.generatedCount + k : null;
    });
    render();
    return;
  }
  // Anchored to a city that belongs to the route of its own accord, so the move survives regrouping.
  const anchor = batch.find((x) => !(cityId(x) in state.moved));
  if (!anchor) return say('No ship without a route');
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
      session.selected = session.generatedCount + k < session.batches.length ? session.generatedCount + k : null;
    });
    render();
  };
  if (edit.kind === 'order') {
    const now = isCustom(i) ? [...state.custom[i - session.generatedCount]] : (state.orders?.[edit.key] ?? null);
    writeOrder(i, edit.key, edit.before);
    return { kind: 'order', key: edit.key, before: now };
  }
  if (edit.kind === 'marks') {
    const cities = edit.before.map(([id]) => {
      const [x, z] = id.split(',').map(Number);
      return { x, z };
    });
    const now: RouteEdit = { kind: 'marks', before: cities.map((c) => [cityId(c), session.tracker.isAlready(c) ? 2 : session.tracker.has(c) ? 1 : 0]) };
    // Each city goes back to the mark it had. Marks on the shared list are not the player's to remove.
    edit.before.forEach(([, was], n) => {
      if (was === 2) session.tracker.setAlready(cities[n], true);
      else {
        session.tracker.set(cities[n], was === 1);
        if (was === 1) session.tracker.setAlready(cities[n], false);
      }
    });
    // Possibly-looted cities may be in or out of the routes again.
    if (state.skipPossible) rebuildKeeping(session.batches[i].length ? cityId(session.batches[i][0]) : null);
    else render();
    // Say so when a city could not go back to not looted.
    const stuck = edit.before.filter(([, was], n) => was === 0 && session.tracker.isShared(cities[n])).length;
    if (stuck) {
      const note = $('routeNote');
      note.textContent = `${stuck === 1 ? '1 ship stays' : `${stuck} ships stay`} looted: on the shared looted list, which is the same for everyone.`;
      note.hidden = false;
      setTimeout(() => (note.hidden = true), 6000);
    }
    return now;
  }
  const id = edit.id;
  if (edit.kind === 'add') {
    // Take the added city back out, noting how it was held so it can be put back.
    const batch = session.batches[i];
    const extra = state.extra?.find((c) => `${c[0]},${c[1]}` === id);
    const back: RouteEdit = { kind: 'readd', id, anchor: state.moved[id], custom: isCustom(i) ? i - session.generatedCount : undefined, extra };
    state.appended = (state.appended ?? []).filter((x) => x !== id);
    // One brought in from beyond the search goes back out of sight.
    if (state.extra) state.extra = state.extra.filter((c) => c !== extra);
    if (isCustom(i)) {
      const k = i - session.generatedCount;
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
  if (session.selected === null) return;
  const edit = lastEdit(session.selected);
  if (!edit) return;
  state.edits = state.edits!.filter((e) => e !== edit);
  state.redo = [...(state.redo ?? []), applyEdit(session.selected, edit)].slice(-100);
  save();
  renderDetail();
});
$('routeRedo').addEventListener('click', () => {
  if (session.selected === null) return;
  const edit = lastEdit(session.selected, state.redo);
  if (!edit) return;
  state.redo = state.redo!.filter((e) => e !== edit);
  // Straight onto the list of changes: a redo must not wipe the redos still waiting behind it.
  state.edits = [...(state.edits ?? []), applyEdit(session.selected, edit)].slice(-100);
  save();
  renderDetail();
});

// Back to the order the route was worked out in. Cities added by hand stay, at the end.
$('orderReset').addEventListener('click', () => {
  if (session.selected === null) return;
  const key = orderKey(session.selected);
  const before = key ? state.orders?.[key] : undefined;
  if (!key || !before) return;
  pushEdit({ kind: 'order', key, before });
  writeOrder(session.selected, key, null);
});
$('markNone').addEventListener('click', () => markAll(false));

$('citiesExport').addEventListener('click', () => {
  const rows = session.batches.flatMap((batch, b) =>
    batch.map((c, k) => `${c.x},${c.z},${b + 1},${k + 1},${session.tracker.has(c) ? 'yes' : 'no'}`),
  );
  download('end-cities.csv', ['x,z,route,stop,looted', ...rows].join('\n') + '\n');
});

$('visitedReset').addEventListener('click', () => {
  if (!session.tracker.count || !confirm(`Clear all ${session.tracker.count} of your looted marks? This cannot be undone: press Export looted first to keep a copy.`)) return;
  session.tracker.clear();
  state.excluded = [];
  // The marks that undo and redo would put back are gone with the rest.
  state.edits = (state.edits ?? []).filter((e) => e.kind !== 'marks');
  state.redo = (state.redo ?? []).filter((e) => e.kind !== 'marks');
  save();
  session.selected = null;
  rebuild();
  render();
});

export function showSharedNote(): void {
  $('sharedNote').textContent = session.tracker.sharedCount
    ? `${fmt(session.tracker.sharedCount)} ships on the shared list so far.`
    : 'The shared list is empty so far.';
}
showSharedNote();

// ---------- ship reports and looted submissions ----------

export const { openReport } = initSubmissions({ tracker: () => session.tracker });

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
  session.helpOpen = session.selected !== null && !session.helpOpen;
  renderDetail();
  const panel = $('detail');
  panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
  // The button is in one panel and the help in another: outline the other for a moment so the eye finds it.
  if (!$('detailEmpty').hidden) {
    panel.classList.add('flash');
    setTimeout(() => panel.classList.remove('flash'), 1200);
  }
});
$('helpBack').addEventListener('click', () => {
  session.helpOpen = false;
  renderDetail();
});

$('visitedExport').addEventListener('click', () => download('end-cities-looted.csv', session.tracker.toCsv()));

const visitedFile = $<HTMLInputElement>('visitedFile');
$('visitedImport').addEventListener('click', () => visitedFile.click());
visitedFile.addEventListener('change', async () => {
  const file = visitedFile.files?.[0];
  if (!file) return;
  session.tracker.mergeCsv(await file.text());
  visitedFile.value = '';
  render();
});
