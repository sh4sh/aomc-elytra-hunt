// Areas players have already mapped, from the community webmap.
// public/explored.json is produced by `npm run explored`.

interface ExploredFile {
  blocksPerPixel: number;
  fetchedAt: string;
  /** Flat [row, runCount, start, length, ...] in pixel coordinates (block / blocksPerPixel). */
  runs: number[];
}

/** A city counts as mapped if any mapped pixel lies within this many pixels (about 100 blocks) of it. */
const NEAR_PX = 3;

export class Explored {
  /** Mapped pixel runs per row, as [start, length, start, length, ...]. Mapped terrain is sparse: mostly flight trails. */
  private readonly rows = new Map<number, number[]>();
  readonly blocksPerPixel: number;
  readonly fetchedAt: string;

  private constructor(file: ExploredFile) {
    this.blocksPerPixel = file.blocksPerPixel;
    this.fetchedAt = file.fetchedAt;
    const r = file.runs;
    for (let i = 0; i < r.length; ) {
      const count = r[i + 1];
      this.rows.set(r[i], r.slice(i + 2, i + 2 + count * 2));
      i += 2 + count * 2;
    }
  }

  /** Resolves to null when no data has been fetched. */
  static async load(): Promise<Explored | null> {
    try {
      const res = await fetch('./explored.json');
      return res.ok ? new Explored(await res.json()) : null;
    } catch {
      return null;
    }
  }

  isMapped(x: number, z: number): boolean {
    const px = Math.floor(x / this.blocksPerPixel);
    const pz = Math.floor(z / this.blocksPerPixel);
    for (let j = pz - NEAR_PX; j <= pz + NEAR_PX; j++) {
      const runs = this.rows.get(j);
      if (!runs) continue;
      for (let k = 0; k < runs.length; k += 2) {
        if (runs[k] <= px + NEAR_PX && runs[k] + runs[k + 1] > px - NEAR_PX) return true;
      }
    }
    return false;
  }

  /** Paint the mapped areas. sx/sy convert block coordinates to canvas pixels. */
  draw(ctx: CanvasRenderingContext2D, sx: (x: number) => number, sy: (z: number) => number, w: number, h: number): void {
    const bpp = this.blocksPerPixel;
    const cell = Math.max(1, sx(bpp) - sx(0));
    ctx.fillStyle = 'rgba(110, 190, 150, 0.55)';
    for (const [row, runs] of this.rows) {
      const y = sy(row * bpp);
      if (y + cell < 0 || y > h) continue;
      for (let k = 0; k < runs.length; k += 2) {
        const x = sx(runs[k] * bpp);
        const len = Math.max(1, runs[k + 1] * (sx(bpp) - sx(0)));
        if (x + len < 0 || x > w) continue;
        ctx.fillRect(x, y, len, cell);
      }
    }
  }
}
