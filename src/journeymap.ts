import type { City } from './types';
import { WAYPOINT_Y, waypointName } from './xaero';

// JourneyMap turns a location written like this into something clickable when
// it appears in chat: clicking it creates a waypoint. Only x and z are
// required. The dimension is left out, so the waypoint lands in whichever
// dimension the player is in when they click, and names may not contain
// commas or quotes.

/**
 * The location as chat text. With a username it becomes a whisper to that
 * player, so pasting it does not show the coordinates to the whole server.
 */
export function chatLine(c: City, name: string, whisperTo = ''): string {
  const location = `[x:${c.x}, y:${WAYPOINT_Y}, z:${c.z}, name:${name.replace(/[,"\[\]]/g, ' ')}]`;
  return whisperTo ? `/msg ${whisperTo} ${location}` : location;
}

/** Minecraft usernames are letters, digits and underscores; anything else typed is dropped. */
export const cleanUsername = (text: string): string => text.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);

/** One chat line per city still worth visiting. */
export function chatLines(batch: City[], batchIndex: number, skip: (c: City) => boolean, whisperTo = ''): string[] {
  const lines: string[] = [];
  batch.forEach((c, i) => {
    if (!skip(c)) lines.push(chatLine(c, waypointName(batchIndex, i), whisperTo));
  });
  return lines;
}
