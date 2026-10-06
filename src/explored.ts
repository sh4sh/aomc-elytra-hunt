// Areas players have already mapped, from the community webmap.
// public/explored.json is produced by `npm run explored`.

interface ExploredFile {
  blocksPerPixel: number;
  fetchedAt: string;
  /** Flat [row, runCount, start, length, ...] in pixel coordinates (block / blocksPerPixel). */
  runs: number[];
}

/**
 * A city counts as mapped only if its own spot and everything within this many pixels of it
 * (one pixel is one chunk, 16 blocks) is mapped. Terrain a player merely flew past, with the city just beyond
 * what their game had loaded, does not count: nobody has been to that city.
 */
const SURROUND_PX = 1;

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
    for (let j = pz - SURROUND_PX; j <= pz + SURROUND_PX; j++) {
      const runs = this.rows.get(j);
      if (!runs) return false;
      // The row must have one run covering the whole stretch either side of the city.
      let covered = false;
      for (let k = 0; k < runs.length && !covered; k += 2) {
        covered = runs[k] <= px - SURROUND_PX && runs[k] + runs[k + 1] > px + SURROUND_PX;
      }
      if (!covered) return false;
    }
    return true;
  }

  /**
   * Every square region of the given size (in blocks) that has mapped terrain in it, as
   * [regionX, regionZ]. Lets a caller look only where something could be mapped.
   */
  regions(regionBlocks: number): [number, number][] {
    const bpp = this.blocksPerPixel;
    // A mapped city sits on mapped terrain, so only regions that contain some need looking at.
    const margin = 0;
    const seen = new Set<string>();
    const out: [number, number][] = [];
    for (const [row, runs] of this.rows) {
      const rz0 = Math.floor((row * bpp - margin) / regionBlocks);
      const rz1 = Math.floor(((row + 1) * bpp + margin) / regionBlocks);
      for (let k = 0; k < runs.length; k += 2) {
        const rx0 = Math.floor((runs[k] * bpp - margin) / regionBlocks);
        const rx1 = Math.floor(((runs[k] + runs[k + 1]) * bpp + margin) / regionBlocks);
        for (let rz = rz0; rz <= rz1; rz++) {
          for (let rx = rx0; rx <= rx1; rx++) {
            const key = `${rx},${rz}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push([rx, rz]);
          }
        }
      }
    }
    return out;
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
