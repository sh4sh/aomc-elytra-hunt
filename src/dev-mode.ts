// Dev mode: tools for working on the app, out of the way under Advanced. The survey picks a spread-out
// random sample of the ships near End Spawn and makes a custom route of them; what the hunter finds
// there says how many of the rest were looted before anyone kept a record.

import { $, fmt } from './dom';
import type { FoundCity } from './generation/worker';
import type { Precomputed } from './precomputed';
import { DEFAULT_SEED, save, state } from './state';
import { NEAR_SPAWN_BLOCKS, surveyEstimate, surveySample } from './survey';
import type { Tracker } from './tracker';
import { cityId, type Filters } from './types';

/** What the survey needs from the rest of the app. */
export interface DevModeHost {
  tracker(): Tracker;
  /** Whether a search is running. */
  searching(): boolean;
  precomputed(): Precomputed | null;
  /** Whether a spot is on the community webmap. */
  isMapped(x: number, z: number): boolean;
  /** Whether a city has been reported as having no ship, or not being there. */
  reportedGone(id: string): boolean;
  /** Take these results as the current search, and open the custom route with this number once its routes are worked out. */
  showSearch(filters: Filters, found: FoundCity[], openCustom: number): void;
}

/** Wire up the Dev mode controls. Returns what redraws the survey's tally, to call whenever looted marks change. */
export function initDevMode(host: DevModeHost): { showSurvey(): void } {
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
    const checked = at.filter((c) => host.tracker().has(c));
    const already = checked.filter((c) => host.tracker().isAlready(c)).length;
    const est = surveyEstimate(checked.length, already, survey.frame);
    note.textContent =
      `${checked.length} of ${survey.ids.length} checked, picked from ${fmt(survey.frame)} ships.` +
      (est
        ? ` ${already} looted by someone else: ${Math.round(est.rate * 100)}%, give or take ${Math.round(est.margin * 100)}.`
        : '');
  }

  $('surveyMake').addEventListener('click', () => {
    const note = $('surveyNote');
    if (host.searching()) return;
    const filters: Filters = { minDist: 0, maxDist: NEAR_SPAWN_BLOCKS, diagonalDeg: 45, quadrants: ['NE', 'NW', 'SE', 'SW'] };
    const precomputed = host.precomputed();
    if (!precomputed?.covers(DEFAULT_SEED, filters)) {
      note.textContent = 'The list of ships has not loaded. Try again in a moment.';
      return;
    }
    if (state.survey?.ids.length && !confirm('Replace the current survey with a new one? Your looted marks are kept.')) return;
    const found = precomputed.search(filters);
    // Only ships nobody has an answer for yet: certain ones, off the webmap, not looted and not reported missing.
    const open = found
      .filter((c) => c[2] === 1)
      .map((c) => ({ x: c[0], z: c[1] }))
      .filter((c) => !host.tracker().has(c) && !host.reportedGone(cityId(c)) && !host.isMapped(c.x, c.z));
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
    host.showSearch(filters, found, state.custom.length - 1);
  });

  return { showSurvey };
}
