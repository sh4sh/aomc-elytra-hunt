// Acting on the map: hovering and clicking ships, the line about the one picked, and the right-click menu.

import { MAP_HINT_KEY, POSSIBLE_NOTE, POSSIBLE_WHY, RENUMBERED_NOTE } from './constants';
import { $, fmt, xzText } from './dom';
import type { MapCity } from './map';
import { map } from './map-view';
import { render, renderLegend, renderMap, select, setHot } from './render';
import { copyText, openReport } from './route-panel';
import { batchTitle, color, isCustom, moveCity, possible, possibleNote, pushEdit, rebuild, recordMarks, tooltip, undrop } from './routes';
import { mapNote, setNear } from './search';
import { session } from './session';
import { DEFAULT_SEED, save, state } from './state';
import { ISSUES_URL } from './submissions';
import { type City, cityId } from './types';
import { OUTSIDE_COLOR, waypointName } from './xaero';

// ---------- map interaction ----------

map.onHover = (c, px, py) => {
  setHot(c?.city ?? null);
  if (session.selected !== null) {
    document.querySelectorAll('#cities li').forEach((li, k) => {
      li.classList.toggle('hot', c?.batch === session.selected && c?.order === k);
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
  if (session.tracker.isAlready(c)) return 'Looted by an unknown hunter';
  const who = session.tracker.lootedBy(c);
  if (who) return `Looted by ${who}`;
  return session.tracker.isShared(c) ? 'Looted' : 'Looted by you';
}

/** One line about a city on the map: its name, where it is and anything known about it. */
const cityLine = (c: MapCity): string =>
  c.batch < 0
    ? c.missing
      ? `${xzText(c.city)} · ${c.note}`
      : `${xzText(c.city)} · not in a route: ${c.note}`
    : `${waypointName(c.batch, c.order)} · ${xzText(c.city)}${c.visited ? (session.tracker.showsAlready(c.city) ? ' · looted by someone else' : ' · looted') : ''}` +
      (c.possible ? ` · ${possibleNote(c.city) ?? POSSIBLE_NOTE}` : '') +
      (session.uncertainShips.has(cityId(c.city)) ? ' · ship uncertain' : '');

// The city last clicked stays described under the map, where a hover tip cannot (there is no hover under a finger).
let picked: City | null = null;
let pickedOn: MapCity | null = null;
function showPicked(c: MapCity): void {
  picked = c.city;
  pickedOn = c;
  const extra: string[] = [];
  if (c.batch >= 0) {
    extra.push(`stop ${c.order + 1} of ${session.batches[c.batch].length} in ${batchTitle(c.batch)}`);
    const prev = session.batches[c.batch][c.order - 1];
    if (prev) extra.push(`${fmt(Math.round(Math.hypot(c.city.x - prev.x, c.city.z - prev.z)))} blocks from the stop before`);
  }
  if (session.you) extra.push(`${fmt(Math.round(Math.hypot(c.city.x - session.you.x, c.city.z - session.you.z)))} blocks from your position`);
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
  session.batches.forEach((batch, b) =>
    batch.forEach((city, order) => {
      if (cityId(city) === id) now = { city, batch: b, order, color: color(b), visited: session.tracker.has(city), possible: possible(city) };
    }),
  );
  const out = session.outside.find((o) => cityId(o.city) === id);
  if (!now && out) now = { city: out.city, batch: -1, order: 0, color: OUTSIDE_COLOR, visited: session.tracker.has(out.city), note: out.note, missing: out.missing };
  if (!now) return;
  const at = $('pickedMore').getBoundingClientRect();
  openMenu(now, at.left, at.top, pickedOn.city);
});

map.onPick = (c) => {
  showPicked(c);
  if (c.batch < 0) return;
  // A city of the route that is already open leaves the map where it is.
  if (c.batch !== session.selected) select(c.batch, true);
  // Light up the city's row in the route's list, without moving the page or the list.
  document.querySelectorAll('#cities li')[c.order]?.classList.add('hot');
};

// ---------- right-click menu ----------

const menu = $('menu');
/** What the open menu was opened on: the map, or a row of the route's list. */
let menuAnchor: Element = menu;
const closeMenu = () => (menu.hidden = true);
document.addEventListener('pointerdown', (e) => {
  if (!menu.contains(e.target as Node)) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
});
$('map').addEventListener('wheel', closeMenu);
// It does not follow the page, so it closes when what it was opened on scrolls away from under it.
// Scrolling somewhere else (another panel settling after a jump, say) leaves it open.
document.addEventListener(
  'scroll',
  (e) => {
    if (e.target === document || (e.target instanceof Node && e.target.contains(menuAnchor))) closeMenu();
  },
  true,
);

/** Rebuild after a change, keeping the batch that holds this city selected. */
export function rebuildKeeping(id: string | null): void {
  rebuild(() => {
    session.selected = id === null ? null : session.batches.findIndex((b) => b.some((c) => cityId(c) === id));
    if (session.selected !== null && session.selected < 0) session.selected = null;
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
  const openCustom = session.selected !== null && isCustom(session.selected) ? session.selected - session.generatedCount : -1;
  const keep = session.selected !== null && openCustom < 0 && session.batches[session.selected].length ? cityId(session.batches[session.selected][0]) : null;
  const reselect = (custom = openCustom) => {
    if (custom < 0) return rebuildKeeping(keep);
    rebuild(() => {
      session.selected = session.generatedCount + custom < session.batches.length ? session.generatedCount + custom : null;
    });
    render();
  };

  if (session.tracker.isShared(c.city)) {
    items.push(['On the shared looted list. Wrong? Report it on GitHub', () => {
      window.open(ISSUES_URL, '_blank', 'noopener');
    }]);
  } else if (c.visited) {
    if (!session.tracker.isAlready(c.city)) items.push(['Mark as looted by someone else', () => {
      recordMarks([c.city]);
      session.tracker.setAlready(c.city, true);
      reselect();
    }]);
    items.push(['Mark as not looted', () => {
      // Like unticking its box: no question asked, and undo takes it back.
      recordMarks([c.city]);
      session.tracker.set(c.city, false);
      // A looted ship that had been taken out of the routes goes back in, which regroups them.
      const regroups = state.excluded.includes(id);
      state.excluded = state.excluded.filter((x) => x !== id);
      save();
      reselect();
      if (regroups) $('mapNote').textContent = RENUMBERED_NOTE;
    }]);
  } else {
    items.push(['Mark as looted', () => {
      recordMarks([c.city]);
      session.tracker.set(c.city, true);
      render();
    }]);
    // Someone got here first: the cities around it may well be looted too.
    items.push(['Mark as looted by someone else', () => {
      recordMarks([c.city]);
      session.tracker.setAlready(c.city, true);
      reselect();
    }]);
  }

  // Reports go to the maintainer for review; nothing changes for anyone until one is accepted.
  if (state.seed === DEFAULT_SEED) {
    items.push(['Report incorrect…', () => openReport(c.city, true, session.uncertainShips.has(id))]);
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
    } else if (session.selected !== null && openCustom < 0 && c.batch !== session.selected && inCustom < 0) {
      const target = session.selected;
      // Anchor the move to a city that belongs to the batch of its own accord, so it survives regrouping.
      const anchor = session.batches[target].find((x) => !(cityId(x) in state.moved));
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
    items.push(['Start a custom route with this ship', () => addToCustom(state.custom.length)]);
  }
  // Its place in the open route.
  // With a mouse the rows can be dragged; these are for fingers.
  if (session.selected !== null && c.batch === session.selected && matchMedia('(pointer: coarse)').matches) {
    const open = session.selected;
    if (c.order > 0) items.push(['Move up', () => moveCity(open, c.order, c.order - 1)]);
    if (c.order < session.batches[open].length - 1) items.push(['Move down', () => moveCity(open, c.order, c.order + 1)]);
  }
  // Cities moved in by hand, or in a custom route, have their own way out below.
  if (c.batch >= 0 && inCustom < 0 && !(id in state.moved)) {
    items.push([`Remove from route ${c.batch + 1}`, () => {
      state.dropped = [...(state.dropped ?? []), id];
      save();
      // Stay on the route it was taken from, unless that was its last city.
      const stay = session.batches[c.batch].find((x) => cityId(x) !== id && !(cityId(x) in state.moved));
      rebuildKeeping(session.selected === c.batch ? (stay ? cityId(stay) : null) : keep);
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
export function openMenu(c: MapCity | null, px: number, py: number, pos: { x: number; z: number }, anchor: Element = $('map')): void {
  menuAnchor = anchor;
  const items: [string, () => void][] = [];
  if (c) addCityItems(c, items);
  // On a city, "here" is the city itself rather than the exact pixel that was clicked.
  const here = c ? { x: c.city.x, z: c.city.z } : pos;
  items.push(['Copy coordinates', async () => {
    const text = xzText(here);
    const ok = await copyText(text);
    // The menu has closed by now, so the result is reported beside the position box.
    mapNote.textContent = ok ? `Copied ${text}` : `Could not copy. The coordinates are ${text}`;
    if (ok) {
      setTimeout(() => {
        if (mapNote.textContent === `Copied ${text}`) mapNote.textContent = '';
      }, 2500);
    }
  }]);
  items.push(['Set my position here', () => {
    session.you = here;
    setNear(here);
    mapNote.textContent = '';
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
export const showBackToMap = () => {
  const mapBox = $('map').getBoundingClientRect();
  backToMap.hidden = mapBox.bottom > 0;
  toRoute.hidden = !state.oneFingerMap || mapBox.bottom <= 0 || $('detail').getBoundingClientRect().top < window.innerHeight * 0.6;
};
toRoute.addEventListener('click', () => $('detail').scrollIntoView({ block: 'start', behavior: 'smooth' }));
window.addEventListener('scroll', showBackToMap, { passive: true });
window.addEventListener('resize', showBackToMap);
showBackToMap();
backToMap.addEventListener('click', () => $('map').scrollIntoView({ block: 'start', behavior: 'smooth' }));
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
const showCoords = () => {
  cursor.textContent = pointerAt ? xzText(pointerAt) : `centre ${xzText(session.viewCentre)}`;
};
map.onCursor = (pos) => {
  pointerAt = pos;
  showCoords();
};
map.onView = (centre) => {
  session.viewCentre = centre;
  showCoords();
  renderLegend();
};
