// Imported for its effect: swaps the goose for a bird the visitor's system can draw.

import { $ } from './dom';

// The goose emoji only exists on systems from 2022 onwards; elsewhere it shows as an empty box.
// Those get the nearest bird their system does have: the swan (2018), then the duck (2016).
const GOOSE_STAND_INS = ['🦢', '🦆'];

/** Whether this system can draw the emoji in colour, as opposed to a blank or a monochrome box. */
function drawsEmoji(emoji: string): boolean {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return true;
    ctx.textBaseline = 'top';
    ctx.font = '24px sans-serif';
    ctx.fillText(emoji, 2, 2);
    const px = ctx.getImageData(0, 0, 32, 32).data;
    for (let i = 0; i < px.length; i += 4) {
      // A missing glyph is drawn in the text colour; a real emoji has coloured pixels.
      if (px[i + 3] > 0 && (Math.abs(px[i] - px[i + 1]) > 16 || Math.abs(px[i + 1] - px[i + 2]) > 16)) return true;
    }
    return false;
  } catch {
    // Can't tell (e.g. canvas reading blocked): leave the emoji alone.
    return true;
  }
}

if (!drawsEmoji('🪿')) {
  const bird = GOOSE_STAND_INS.find(drawsEmoji) ?? '';
  $('gooseEmoji').textContent = bird;
  const icon = $<HTMLLinkElement>('favicon');
  // With no bird at all, drop the icon rather than show an empty box in the tab.
  if (bird) icon.href = icon.href.replace(encodeURIComponent('🪿'), encodeURIComponent(bird)).replace('🪿', bird);
  else icon.remove();
}
