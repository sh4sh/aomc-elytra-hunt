import type { City } from './types';

// Xaero's Minimap waypoint line:
// waypoint:name:initials:x:y:z:color:disabled:type:set:rotate_on_tp:tp_yaw:visibility_type:destination
// Colour is an index into the 16 Minecraft chat colours.

export const XAERO_COLORS = [
  '#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#ffaa00', '#aaaaaa',
  '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff',
];
// Skip black and dark grey (unreadable against the End sky) and light grey, which reads as "switched off".
const USABLE = [9, 10, 11, 12, 13, 14, 6, 2, 3, 5, 4, 15, 1];

/** Map colour for cities that are not in any batch: the interface's muted text colour, so they recede. */
export const OUTSIDE_COLOR = '#9d94b3';

export const batchColor = (batchIndex: number): number => USABLE[batchIndex % USABLE.length];

/** End Cities sit on top of the islands; this is a sensible height to aim for when flying in. */
export const WAYPOINT_Y = 70;

const pad = (n: number): string => String(n).padStart(2, '0');

/** Short tag per batch used in waypoint names: its number, or "C1", "C2"… for a player's custom batches. */
let batchTags: string[] = [];
export function setBatchTags(tags: string[]): void {
  batchTags = tags;
}

export const waypointName = (batchIndex: number, i: number): string =>
  `EC ${batchTags[batchIndex] ?? batchIndex + 1}-${pad(i + 1)}`;

export function waypointLines(batch: City[], batchIndex: number, skip: (c: City) => boolean): string[] {
  const color = batchColor(batchIndex);
  const lines: string[] = [];
  batch.forEach((c, i) => {
    if (skip(c)) return;
    lines.push(
      `waypoint:${waypointName(batchIndex, i)}:${i + 1}:${c.x}:${WAYPOINT_Y}:${c.z}:${color}:false:0:gui.xaero_default:false:0:0:false`,
    );
  });
  return lines;
}

/** A complete waypoint file. Its lines can also be appended to an existing one. */
export function waypointFile(lines: string[]): string {
  return (
    [
      '#',
      '#waypoint:name:initials:x:y:z:color:disabled:type:set:rotate_on_tp:tp_yaw:visibility_type:destination',
      '#',
      ...lines,
    ].join('\n') + '\n'
  );
}
