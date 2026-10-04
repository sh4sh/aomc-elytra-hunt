import type { Trajectory } from './trajectory';
import { waypointName } from './xaero';
import type { Explored } from './explored';
import type { City, Filters } from './types';

export interface MapCity {
  city: City;
  batch: number;
  /** Position within its batch's route. */
  order: number;
  color: string;
  visited: boolean;
  /** Set for cities shown outside the batches (batch is -1): why they were left out. */
  note?: string;
  /** A player reported the ship, or the whole city, missing here: crossed off like a looted city. */
  missing?: boolean;
  /** Found already looted by someone else on arrival: its cross is tan, not grey. */
  already?: boolean;
  /** Near a city someone found already looted, so possibly looted too: drawn hollow. */
  possible?: boolean;
  /** Drawn as a bright cross in the "everything explored so far" view: gold for looted, green for on the webmap. */
  trophy?: 'looted' | 'mapped';
}

export interface MapScene {
  cities: MapCity[];
  selectedBatch: number | null;
  hot: City | null;
  filters: Filters;
  /** The search to shade on the map: usually what the form currently says, applied or not. */
  searchArea: Filters;
  explored: Explored | null;
  /** Guessed flight paths of earlier hunters. */
  paths: Trajectory[];
  /** The player's position, if they entered one. */
  you: { x: number; z: number } | null;
  /** A spot the player jumped the map to, marked so it can be found again. */
  pin: { x: number; z: number } | null;
}

const HIT_RADIUS = 9;
/**
 * Everything to do with earlier hunters (cities they looted, cities they may have, where they flew) is a
 * muted tan: not for the taking, so it recedes like the faint diamonds, in a tone no route is drawn in.
 */
const ALREADY_COLOR = '#b3876a';
const POSSIBLE_COLOR = '#9d94b3';
/** The guesswork about earlier hunters is drawn when no more than this many blocks fit across the map. */
const PATHS_WITHIN_BLOCKS = 30000;
/** Cities looted in the ordinary way: done, and plain to see. */
const LOOTED_COLOR = '#6fdc8c';
// Pixels per block at the two ends of the zoom range.
const MIN_SCALE = 0.0005;
const MAX_SCALE = 2;

/** Pannable, zoomable top-down view of the End. North (-z) is up. */
export class EndMap {
  private readonly ctx: CanvasRenderingContext2D;
  private scene: MapScene | null = null;
  private cx = 0;
  private cz = 0;
  /** Pixels per block. */
  private scale = 0.01;
  private w = 0;
  private h = 0;
  onHover: (c: MapCity | null, px: number, py: number) => void = () => {};
  onPick: (c: MapCity) => void = () => {};
  /** Called with the zoom level, 0 (furthest out) to 1 (closest in), whenever it changes. */
  onZoom: (level: number) => void = () => {};
  /** Right-click on the map: the city under the pointer, if any, and the block position. */
  onMenu: (c: MapCity | null, px: number, py: number, pos: { x: number; z: number }) => void = () => {};
  /** Called with the block at the centre of the view whenever the view moves. */
  onView: (centre: { x: number; z: number }) => void = () => {};
  /** Block position under the cursor, or null when it leaves the map. */
  onCursor: (pos: { x: number; z: number } | null) => void = () => {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.bindInput();
    this.resize();
  }

  setScene(scene: MapScene): void {
    this.scene = scene;
    this.draw();
  }

  /** Centre and zoom so that the given cities (or the whole search area) fill the view. */
  fit(cities: { x: number; z: number }[], fallbackRadius: number): void {
    let x0 = -fallbackRadius, x1 = fallbackRadius, z0 = -fallbackRadius, z1 = fallbackRadius;
    if (cities.length) {
      x0 = Math.min(...cities.map((c) => c.x));
      x1 = Math.max(...cities.map((c) => c.x));
      z0 = Math.min(...cities.map((c) => c.z));
      z1 = Math.max(...cities.map((c) => c.z));
    }
    this.cx = (x0 + x1) / 2;
    this.cz = (z0 + z1) / 2;
    const span = Math.max(x1 - x0, z1 - z0, 500);
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (Math.min(this.w, this.h) * 0.8) / span));
    this.draw();
    this.onZoom(this.zoom);
  }

  /** Centre the view on a spot, zooming in if the view is too wide for it to be easy to see. */
  goTo(x: number, z: number): void {
    this.cx = x;
    this.cz = z;
    // At least close enough that about 6,000 blocks fit across the smaller side.
    this.scale = Math.min(MAX_SCALE, Math.max(this.scale, Math.min(this.w, this.h) / 6000));
    this.draw();
    this.onZoom(this.zoom);
  }

  /** Zoomed in far enough for the guesswork about earlier hunters (their paths, the possibly-looted rings) to be shown. */
  get detailed(): boolean {
    return this.w / this.scale <= PATHS_WITHIN_BLOCKS;
  }

  /** Zoom level from 0 (furthest out) to 1 (closest in). Each step along it multiplies the scale by the same amount. */
  get zoom(): number {
    return Math.log(this.scale / MIN_SCALE) / Math.log(MAX_SCALE / MIN_SCALE);
  }

  /** Zoom about the centre of the view. */
  setZoom(level: number): void {
    const t = Math.min(1, Math.max(0, level));
    this.scale = MIN_SCALE * (MAX_SCALE / MIN_SCALE) ** t;
    this.draw();
    this.onZoom(this.zoom);
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  /** Whether a block position is within the part of the world the map is showing. */
  inView(x: number, z: number): boolean {
    const px = this.sx(x), py = this.sy(z);
    return px >= 0 && px <= this.w && py >= 0 && py <= this.h;
  }

  private sx = (x: number) => (x - this.cx) * this.scale + this.w / 2;
  private sy = (z: number) => (z - this.cz) * this.scale + this.h / 2;

  /** Block coordinates under a point on the canvas. */
  private blockAt(px: number, py: number): { x: number; z: number } {
    return {
      x: Math.round((px - this.w / 2) / this.scale + this.cx),
      z: Math.round((py - this.h / 2) / this.scale + this.cz),
    };
  }

  private cityAt(px: number, py: number): MapCity | null {
    if (!this.scene) return null;
    let best: MapCity | null = null;
    let bestD = HIT_RADIUS * HIT_RADIUS;
    for (const c of this.scene.cities) {
      const d = (this.sx(c.city.x) - px) ** 2 + (this.sy(c.city.z) - py) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private bindInput(): void {
    const el = this.canvas;
    let drag: { x: number; y: number; moved: boolean } | null = null;

    // Pressing and holding used to open the menu on touch screens, but went off by accident too easily;
    // there the menu is reached from a city's details under the map instead. Nothing sets this now.
    let hold: ReturnType<typeof setTimeout> | undefined;
    const cancelHold = () => clearTimeout(hold);

    // On a touch screen, one finger is left to the browser so the page can still be scrolled past the
    // map; two fingers move and zoom the map. That gesture is read from touch events, because they can
    // be claimed or left alone per gesture, which pointer events cannot.
    const twoFingers = (e: TouchEvent) => {
      const box = el.getBoundingClientRect();
      const [a, b] = [e.touches[0], e.touches[1]].map((t) => ({ x: t.clientX - box.left, y: t.clientY - box.top }));
      return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    let pinch: ReturnType<typeof twoFingers> | null = null;
    el.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length !== 2) return;
        e.preventDefault();
        cancelHold();
        // Neither finger should go on to count as a tap on a city.
        drag = null;
        pinch = twoFingers(e);
      },
      { passive: false },
    );
    el.addEventListener(
      'touchmove',
      (e) => {
        if (!pinch || e.touches.length !== 2) return;
        if (e.cancelable) e.preventDefault();
        const now = twoFingers(e);
        // The block that was between the fingers stays between them as they move, spread or close.
        const wx = (pinch.x - this.w / 2) / this.scale + this.cx;
        const wz = (pinch.y - this.h / 2) / this.scale + this.cz;
        this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * (now.dist / pinch.dist)));
        this.cx = wx - (now.x - this.w / 2) / this.scale;
        this.cz = wz - (now.y - this.h / 2) / this.scale;
        pinch = now;
        this.draw();
        this.onZoom(this.zoom);
        this.onHover(null, 0, 0);
      },
      { passive: false },
    );
    const endPinch = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    el.addEventListener('touchend', endPinch);
    el.addEventListener('touchcancel', endPinch);

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const touch = e.pointerType === 'touch';
      drag = { x: e.offsetX, y: e.offsetY, moved: false };
      // A finger is not captured: if it turns into a page scroll, the browser takes it over.
      if (!touch) el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (drag) {
        const dx = e.offsetX - drag.x;
        const dy = e.offsetY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) cancelHold();
        // One finger never moves the map; it only stops being a tap once it has moved.
        if (e.pointerType === 'touch') return;
        if (drag.moved) {
          el.classList.add('dragging');
          this.cx -= dx / this.scale;
          this.cz -= dy / this.scale;
          drag.x = e.offsetX;
          drag.y = e.offsetY;
          this.draw();
          this.onHover(null, 0, 0);
          return;
        }
      }
      if (e.pointerType === 'touch') return;
      this.onHover(this.cityAt(e.offsetX, e.offsetY), e.offsetX, e.offsetY);
      this.onCursor({
        x: Math.round((e.offsetX - this.w / 2) / this.scale + this.cx),
        z: Math.round((e.offsetY - this.h / 2) / this.scale + this.cz),
      });
    });
    el.addEventListener('pointercancel', () => {
      cancelHold();
      drag = null;
    });
    el.addEventListener('pointerup', (e) => {
      cancelHold();
      el.classList.remove('dragging');
      if (drag && !drag.moved) {
        const hit = this.cityAt(e.offsetX, e.offsetY);
        if (hit) this.onPick(hit);
      }
      drag = null;
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.onMenu(this.cityAt(e.offsetX, e.offsetY), e.offsetX, e.offsetY, this.blockAt(e.offsetX, e.offsetY));
    });
    el.addEventListener('pointerleave', () => {
      this.onHover(null, 0, 0);
      this.onCursor(null);
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const k = Math.exp(-e.deltaY * 0.0015);
        // Keep the block under the cursor fixed while zooming.
        const wx = (e.offsetX - this.w / 2) / this.scale + this.cx;
        const wz = (e.offsetY - this.h / 2) / this.scale + this.cz;
        this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * k));
        this.cx = wx - (e.offsetX - this.w / 2) / this.scale;
        this.cz = wz - (e.offsetY - this.h / 2) / this.scale;
        this.draw();
        this.onZoom(this.zoom);
      },
      { passive: false },
    );
  }

  /** Coordinate grid with labelled lines, spaced at a round number of blocks that suits the zoom. */
  private drawGrid(): void {
    const { ctx, w, h } = this;
    // Smallest of 1, 2, 5 x 10^n blocks that keeps lines at least ~90px apart.
    const target = 90 / this.scale;
    const pow = 10 ** Math.floor(Math.log10(target));
    const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= target)!;
    const x0 = this.cx - w / 2 / this.scale;
    const z0 = this.cz - h / 2 / this.scale;

    ctx.lineWidth = 1;
    ctx.strokeStyle = '#1d182c';
    ctx.fillStyle = '#7d7494';
    ctx.font = '11px system-ui, sans-serif';
    ctx.beginPath();
    const xs: number[] = [];
    const zs: number[] = [];
    for (let x = Math.ceil(x0 / step) * step; this.sx(x) <= w; x += step) {
      xs.push(x);
      ctx.moveTo(Math.round(this.sx(x)) + 0.5, 0);
      ctx.lineTo(Math.round(this.sx(x)) + 0.5, h);
    }
    for (let z = Math.ceil(z0 / step) * step; this.sy(z) <= h; z += step) {
      zs.push(z);
      ctx.moveTo(0, Math.round(this.sy(z)) + 0.5);
      ctx.lineTo(w, Math.round(this.sy(z)) + 0.5);
    }
    ctx.stroke();
    // Labels along the bottom (x) and left (z) edges.
    for (const x of xs) ctx.fillText(`x: ${x}`, this.sx(x) + 4, h - 6);
    for (const z of zs) if (this.sy(z) < h - 22 && this.sy(z) > 60) ctx.fillText(`z: ${z}`, 6, this.sy(z) - 4);
  }

  /** Shade where the search looks: the band between the two distances, narrowed by angle and quadrant. */
  private drawSearchArea(f: Filters): void {
    const { ctx } = this;
    if (f.around) {
      // A circle around the chosen position.
      ctx.beginPath();
      ctx.arc(this.sx(f.around.x), this.sy(f.around.z), f.around.radius * this.scale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(197, 139, 255, 0.09)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(197, 139, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
      return;
    }
    const ox = this.sx(0);
    const oy = this.sy(0);
    const outer = f.maxDist * this.scale;
    const inner = f.minDist * this.scale;
    if (!(outer > inner) || !f.quadrants.length) return;

    ctx.save();
    // The band between the two squares.
    ctx.beginPath();
    ctx.rect(ox - outer, oy - outer, 2 * outer, 2 * outer);
    ctx.rect(ox - inner, oy - inner, 2 * inner, 2 * inner);
    ctx.clip('evenodd');
    // The chosen quadrants. North is up, so north is the top half.
    ctx.beginPath();
    for (const q of f.quadrants) ctx.rect(q[1] === 'E' ? ox : ox - outer, q[0] === 'S' ? oy : oy - outer, outer, outer);
    ctx.clip();

    ctx.beginPath();
    if (f.diagonalDeg >= 45) {
      ctx.rect(ox - outer, oy - outer, 2 * outer, 2 * outer);
    } else {
      // A wedge either side of each diagonal or axis, drawn well past the outer square.
      const reach = 3 * outer;
      const spread = (f.diagonalDeg * Math.PI) / 180;
      for (let k = 0; k < 4; k++) {
        const mid = (k * Math.PI) / 2 + (f.angleFrom === 'axis' ? 0 : Math.PI / 4);
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + reach * Math.cos(mid - spread), oy + reach * Math.sin(mid - spread));
        ctx.lineTo(ox + reach * Math.cos(mid + spread), oy + reach * Math.sin(mid + spread));
        ctx.closePath();
      }
    }
    ctx.fillStyle = 'rgba(197, 139, 255, 0.09)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(197, 139, 255, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  private draw(): void {
    const { ctx, w, h } = this;
    ctx.fillStyle = '#0f0c17';
    ctx.fillRect(0, 0, w, h);
    this.onView({ x: Math.round(this.cx), z: Math.round(this.cz) });
    if (!this.scene) return;
    const { cities, selectedBatch, hot, explored, you, pin, searchArea } = this.scene;
    // Distances and angle are drawn for the search being set up, so they follow the controls live.
    const filters = searchArea;
    const ox = this.sx(0);
    const oy = this.sy(0);

    // Areas already on the community webmap.
    if (explored) explored.draw(ctx, this.sx, this.sy, w, h);

    this.drawGrid();
    this.drawSearchArea(searchArea);

    // Axes and diagonals.
    // The axes reach as far as the search does, wherever it is centred.
    const reach =
      (filters.around
        ? Math.max(Math.abs(filters.around.x), Math.abs(filters.around.z)) + filters.around.radius
        : filters.maxDist) * this.scale;
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#2a2340';
    ctx.beginPath();
    ctx.moveTo(ox - reach, oy); ctx.lineTo(ox + reach, oy);
    ctx.moveTo(ox, oy - reach); ctx.lineTo(ox, oy + reach);
    ctx.stroke();
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(ox - reach, oy - reach); ctx.lineTo(ox + reach, oy + reach);
    ctx.moveTo(ox - reach, oy + reach); ctx.lineTo(ox + reach, oy - reach);
    ctx.stroke();
    ctx.setLineDash([]);

    // Search band: the squares at the minimum and maximum distance.
    ctx.fillStyle = '#7d7494';
    ctx.font = '11px system-ui, sans-serif';
    if (filters.around) {
      const { x, z, radius } = filters.around;
      ctx.fillText(`${radius.toLocaleString()} around x: ${x}, z: ${z}`, this.sx(x) + 4, this.sy(z) - radius * this.scale - 4);
    } else {
      for (const d of [filters.minDist, filters.maxDist]) {
        const r = d * this.scale;
        ctx.strokeStyle = '#3d3360';
        ctx.strokeRect(ox - r, oy - r, 2 * r, 2 * r);
        ctx.fillText(`${d.toLocaleString()} out`, ox + 4, oy - r - 4);
      }
    }
    ctx.fillText('N (−z)', ox + 4, oy - reach - 18);

    // Where an earlier hunter may have flown: dashed, since it is a guess, and fainter past the ends.
    // Only once zoomed in: from far out they would be a scatter of lines over the whole search.
    for (const t of this.detailed ? this.scene.paths : []) {
      ctx.strokeStyle = ALREADY_COLOR;
      ctx.lineWidth = t.confidence === 'high' ? 2 : 1.5;
      ctx.setLineDash(t.confidence === 'high' ? [8, 4] : [3, 5]);
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      t.points.forEach((p, i) => {
        if (i) ctx.lineTo(this.sx(p.x), this.sy(p.z)); else ctx.moveTo(this.sx(p.x), this.sy(p.z));
      });
      ctx.stroke();
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      const first = t.points[0], last = t.points[t.points.length - 1];
      ctx.moveTo(this.sx(t.before.x), this.sy(t.before.z)); ctx.lineTo(this.sx(first.x), this.sy(first.z));
      ctx.moveTo(this.sx(last.x), this.sy(last.z)); ctx.lineTo(this.sx(t.after.x), this.sy(t.after.z));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = ALREADY_COLOR;
      ctx.fillText(`earlier flight path? ${t.confidence} confidence`, this.sx(t.after.x) + 6, this.sy(t.after.z) + 4);
      ctx.globalAlpha = 1;
    }

    // Flight path of the selected batch.
    const route = cities.filter((c) => c.batch === selectedBatch).sort((a, b) => a.order - b.order);
    if (route.length) {
      ctx.strokeStyle = route[0].color;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      route.forEach((c, i) => {
        const x = this.sx(c.city.x), y = this.sy(c.city.z);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (const c of cities) {
      const x = this.sx(c.city.x), y = this.sy(c.city.z);
      if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
      const selected = c.batch === selectedBatch;
      const outside = c.batch < 0;
      const dimmed = selectedBatch !== null && !selected && !outside;
      const r = selected ? 4.5 : 3;
      ctx.globalAlpha = dimmed ? 0.3 : 1;
      ctx.beginPath();
      if (outside) {
        // Small, thin and muted: available, but not part of the plan. A diamond so shape alone tells them apart.
        const d = 3.5;
        ctx.moveTo(x, y - d);
        ctx.lineTo(x + d, y);
        ctx.lineTo(x, y + d);
        ctx.lineTo(x - d, y);
        ctx.closePath();
      } else {
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      if (c.visited || c.missing) {
        // Looted, or reported missing: crossed off, whether or not it is in a batch.
        const d = selected ? 4 : 3;
        ctx.beginPath();
        ctx.moveTo(x - d, y - d);
        ctx.lineTo(x + d, y + d);
        ctx.moveTo(x + d, y - d);
        ctx.lineTo(x - d, y + d);
        if (outside) ctx.globalAlpha = 0.6;
        // Green for a city the player looted, tan for one someone else got to first, grey for a missing one.
        ctx.strokeStyle = c.already ? ALREADY_COLOR : c.visited ? LOOTED_COLOR : '#8a8299';
        // Only the player's own looted cities are drawn boldly; the rest recede like the faint diamonds.
        const own = c.visited && !c.already;
        ctx.lineWidth = own ? 2 : 1.5;
        if (own) ctx.globalAlpha = dimmed ? 0.5 : 1;
        else if (c.already) ctx.globalAlpha = dimmed ? 0.4 : 0.85;
        if (c.trophy) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = c.trophy === 'looted' ? '#ffd24a' : '#7fe0b0';
          ctx.lineWidth = 2;
        }
        ctx.stroke();
      } else if (outside) {
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = c.color;
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (c.possible && this.detailed) {
        // Possibly looted: a small grey ring, in the same quiet grey as the diamonds of cities without a
        // route, around a dot in the route's own colour.
        ctx.strokeStyle = POSSIBLE_COLOR;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = c.color;
        ctx.fill();
      } else {
        ctx.fillStyle = c.color;
        ctx.fill();
      }
      if (c.city === hot) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    if (pin) {
      const x = this.sx(pin.x), y = this.sy(pin.z);
      ctx.strokeStyle = '#c58bff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.moveTo(x - 14, y); ctx.lineTo(x - 4, y);
      ctx.moveTo(x + 4, y); ctx.lineTo(x + 14, y);
      ctx.moveTo(x, y - 14); ctx.lineTo(x, y - 4);
      ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 14);
      ctx.stroke();
      ctx.fillStyle = '#c58bff';
      ctx.fillText(`x: ${pin.x}, z: ${pin.z}`, x + 16, y + 16);
    }

    if (you) {
      const x = this.sx(you.x), y = this.sy(you.z);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y);
      ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText('you', x + 10, y - 6);
    }

    // Where the player is up to in the open route: its first city that is not looted yet.
    const current = route.find((c) => !c.visited);
    if (current) {
      const x = this.sx(current.city.x), y = this.sy(current.city.z);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = 'bold 11px system-ui, sans-serif';
      const label = `${current === route[0] ? 'Start here' : 'Current city'}: ${waypointName(current.batch, current.order)}`;
      const width = ctx.measureText(label).width;
      // A dark plate behind the words keeps them readable over other cities.
      ctx.fillStyle = 'rgba(15, 12, 23, 0.85)';
      ctx.fillRect(x + 11, y - 22, width + 8, 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, x + 15, y - 10);
      ctx.font = '11px system-ui, sans-serif';
    }

    // Route numbers once there is room for them.
    if (route.length && this.scale > 0.04) {
      ctx.fillStyle = '#ece7f5';
      for (const c of route) ctx.fillText(String(c.order + 1), this.sx(c.city.x) + 7, this.sy(c.city.z) + 4);
    }

    // A faint crosshair at the centre of the view: the spot the coordinates under the map refer to
    // whenever the pointer is elsewhere (and always, on a touch screen).
    ctx.strokeStyle = 'rgba(236, 231, 245, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(w / 2) + 0.5, h / 2 - 7); ctx.lineTo(Math.round(w / 2) + 0.5, h / 2 + 7);
    ctx.moveTo(w / 2 - 7, Math.round(h / 2) + 0.5); ctx.lineTo(w / 2 + 7, Math.round(h / 2) + 0.5);
    ctx.stroke();
  }
}
