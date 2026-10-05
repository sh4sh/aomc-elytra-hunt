// The dividers either side of the map: drag one, or use the arrow keys on it, to resize its panel.
// Imported for its effect; the widths are remembered between visits.

const LAYOUT_STORE = 'end-cities:layout';
const PANEL_MIN = 220;
const PANEL_DEFAULT = { left: 300, right: 350 };
type Side = keyof typeof PANEL_DEFAULT;

const panelWidth: Record<Side, number> = { ...PANEL_DEFAULT };
try {
  Object.assign(panelWidth, JSON.parse(localStorage.getItem(LAYOUT_STORE) ?? '{}'));
} catch {
  // Keep the defaults.
}

function setPanel(side: Side, width: number, persist = true): void {
  // Leave the map at least as much room as a panel's minimum.
  const max = Math.max(PANEL_MIN, window.innerWidth - panelWidth[side === 'left' ? 'right' : 'left'] - PANEL_MIN);
  panelWidth[side] = Math.round(Math.min(max, Math.max(PANEL_MIN, width)));
  document.body.style.setProperty(`--${side}`, `${panelWidth[side]}px`);
  if (!persist) return;
  try {
    localStorage.setItem(LAYOUT_STORE, JSON.stringify(panelWidth));
  } catch {
    // The size still applies for this visit.
  }
}

for (const handle of document.querySelectorAll<HTMLElement>('.resizer')) {
  const side = handle.dataset.side as Side;
  setPanel(side, panelWidth[side], false);
  const fromPointer = (e: PointerEvent) => (side === 'left' ? e.clientX : window.innerWidth - e.clientX);
  handle.addEventListener('pointerdown', (e) => {
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (handle.hasPointerCapture(e.pointerId)) setPanel(side, fromPointer(e));
  });
  handle.addEventListener('pointerup', () => handle.classList.remove('dragging'));
  handle.addEventListener('dblclick', () => setPanel(side, PANEL_DEFAULT[side]));
  handle.addEventListener('keydown', (e) => {
    // Arrow keys move the divider itself, whichever panel it belongs to.
    const step = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
    if (!step) return;
    e.preventDefault();
    setPanel(side, panelWidth[side] + (side === 'left' ? step : -step));
  });
}
