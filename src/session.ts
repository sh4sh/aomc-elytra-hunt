// What the app holds for this visit only: the routes as last worked out, what is open and under the
// pointer, the data loaded at start, and the player's place on the map. Nothing here is saved; what is
// remembered between visits is in state.ts. The parts of the app all read and change this one object.

import type { Constellation, lookalike } from './constellations';
import type { Explored } from './explored';
import { BATCH_SIZE } from './filters';
import type { MapCity } from './map';
import type { Precomputed } from './precomputed';
import { state } from './state';
import { Tracker } from './tracker';
import type { Trajectory } from './trajectory';
import type { City } from './types';

export const session = {
  /** The player's looted marks for the world being shown. Replaced when the seed changes. */
  tracker: new Tracker(state.seed),
  /** The routes, generated ones first, then the player's custom ones. */
  batches: [] as City[][],
  /** Which route is open, by its place in `batches`. */
  selected: null as number | null,
  /** The city under the pointer, on the map or in the list. */
  hot: null as City | null,
  /** The search in progress, if a slow one is running. */
  worker: null as Worker | null,
  /** Areas on the community webmap, once loaded. */
  explored: null as Explored | null,
  /** The pre-generated list of cities, once loaded. */
  precomputed: null as Precomputed | null,
  /** Where the player says they are. */
  you: null as { x: number; z: number } | null,
  /** A spot the map was jumped to with "Go to coordinates". It is only a marker: it does not count as the player's position. */
  pin: null as { x: number; z: number } | null,
  showStars: false,
  /** Hidden extra, toggled by the goose: show every looted city on the map. */
  showTrophies: false,
  /** Ship cities in areas on the webmap, worked out the first time the hidden view is opened. */
  webmapCities: null as City[] | null,
  /** Whether the instructions are showing in place of the open batch. */
  helpOpen: false,
  /** Figures from the world's sky cultures, fetched the first time the sketch is opened. */
  skyFigures: null as Constellation[] | null,
  starCache: null as { key: string; match: ReturnType<typeof lookalike> } | null,
  page: 0,
  /** Whether routes that are all looted are listed after all. */
  showFinished: false,
  /** The selection the list last jumped to, so paging by hand isn't undone on the next redraw. */
  pageFollowed: null as number | null,
  /** Cities left out because they are already on the webmap. */
  skipped: 0,
  /** Cities left out because they have no ship. */
  shipless: 0,
  /** Cities per batch actually used: the setting, or fewer when no batch that large could be made. */
  usedBatchSize: BATCH_SIZE,
  /**
   * Players' reports, published with the site. `gone` holds cities to keep out of routes, with what was
   * reported: found with no ship, or no End City there at all. `found` holds ships confirmed present.
   */
  shipReports: { gone: new Map<string, 'missing' | 'no-city'>(), found: new Set<string>() },
  /**
   * Cities whose ship is a tight fit against another part of the city, and so may not have generated.
   * A confirmed report clears the doubt.
   */
  uncertainShips: new Set<string>(),
  /** Guessed flight paths of earlier hunters, worked out again whenever a looted mark changes. */
  pathsFor: null as { tracker: Tracker; version: number; mapped: City[]; paths: Trajectory[]; near: string[] } | null,
  /** Ship cities of the current search that are on the webmap: another player has been there. Set by each rebuild. */
  webmapShips: [] as City[],
  /** How many of `batches` were generated; the player's custom batches follow them. */
  generatedCount: 0,
  /** Cities that could not be fitted into a full batch within the longest-flight limit. */
  unbatched: 0,
  /** Cities kept out of the batches but still drawn on the map, with the reason. */
  outside: [] as { city: City; note: string; missing?: boolean }[],
  /** The cities last handed to the map, for the legend to look through. */
  shownCities: [] as MapCity[],
  /** Where the search set in the form is centred: a position, for a search around the player, or null for the band around End Spawn. */
  searchCentre: null as { x: number; z: number } | null,
  /** A custom route to open once the search under way has its routes: the survey's. */
  openCustomAfterSearch: null as number | null,
  /** Set while a search around the player's position is running, so the nearest batch is opened once it lands. */
  locateAfterSearch: null as { x: number; z: number } | null,
  /** The block at the middle of the map. */
  viewCentre: { x: 0, z: 0 },
  /** Looted cities published with the site, for the default server's world only. */
  sharedLooted: [] as string[],
  /** The ones among them that a player found already looted on arrival. */
  sharedAlready: [] as string[],
  /** And who sent each one in, where a username was given. */
  sharedBy: {} as Record<string, string[]>,
};
