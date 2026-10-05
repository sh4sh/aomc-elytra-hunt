// What the app remembers between visits: the last search and its results, the route settings, and the
// changes a player has made to routes by hand. Kept in the browser's local storage.

import { BATCH_SIZE, DEFAULT_MAX_HOP, type BatchShape } from './filters';
import type { FoundCity } from './generation/worker';
import type { Filters } from './types';

export const DEFAULT_SEED = '856461443495910397';
/** How far a line batch may stray to either side of straight, in blocks, unless the player changes it. */
export const DEFAULT_LINE_DEVIATION = 1000;
export const DEFAULT_FILTERS: Filters = { minDist: 10000, maxDist: 50000, diagonalDeg: 45, quadrants: ['NE', 'NW', 'SE', 'SW'] };
const STORE = 'end-cities:state';

export interface Saved {
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
  /** The search that was showing before the current one, to go back to. */
  lastSearch?: Filters;
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

export const state = load();

/** A change made by hand to a route: a city added to it, or its order changed (`before` being the order it had, if any). */
export type RouteEdit =
  | { kind: 'add'; id: string }
  | { kind: 'order'; key: string; before: string[] | null }
  // Looted marks changed: what each city's mark was before (0 not looted, 1 looted, 2 looted by someone else).
  | { kind: 'marks'; before: [string, 0 | 1 | 2][] }
  // Only ever waiting to be redone: a city that undo took back out, and how it had been held in its route.
  | { kind: 'readd'; id: string; anchor?: string; custom?: number; extra?: FoundCity };

export const save = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    // Not fatal: the search can be rerun.
  }
};

/**
 * The player's Minecraft username is asked for in three places (map-mod lines, Share progress and
 * ship reports) and remembered once. Each place shows it and hears when another changes it.
 */
const usernameWatchers: (() => void)[] = [];
export function onUsername(changed: () => void): void {
  usernameWatchers.push(changed);
}
export function setUsername(name: string): void {
  if (name === state.chatName) return;
  state.chatName = name;
  save();
  for (const changed of usernameWatchers) changed();
}
