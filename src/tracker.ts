import { distanceToSegment } from './trajectory';
import { cityId } from './types';

/** An intact city this close to the straight line between two others counts as lying between them. */
const BETWEEN_BLOCKS = 500;

/**
 * Which cities have been looted. A visitor's own marks are kept in localStorage
 * per world seed. On top of those sits the shared list published with the
 * site, which counts as looted for everyone and cannot be unticked locally.
 */
export class Tracker {
  private visited = new Map<string, string>();
  private shared = new Set<string>();
  /** Cities this visitor found already looted by someone else on arrival. Each is in `visited` too. */
  private already = new Set<string>();
  private sharedAlready = new Set<string>();
  /** Every already-looted city as [x, z], worked out when first asked for. */
  private priorPoints: [number, number][] | null = null;
  /** Every city looted the ordinary way (so found with its elytra) as [x, z], worked out when first asked for. */
  private intactPoints: [number, number][] | null = null;
  /** Goes up whenever a mark changes, so anything worked out from the marks knows to start again. */
  version = 0;
  private readonly key: string;
  private readonly alreadyKey: string;

  constructor(seed: string) {
    this.key = `end-cities:visited:${seed}`;
    this.alreadyKey = `end-cities:found-looted:${seed}`;
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) this.visited = new Map(Object.entries(JSON.parse(raw)));
      const found = localStorage.getItem(this.alreadyKey);
      if (found) this.already = new Set(JSON.parse(found));
    } catch {
      // Storage unavailable or corrupt: start empty.
    }
  }

  private save(): void {
    this.priorPoints = null;
    this.intactPoints = null;
    this.version++;
    try {
      localStorage.setItem(this.key, JSON.stringify(Object.fromEntries(this.visited)));
      localStorage.setItem(this.alreadyKey, JSON.stringify([...this.already]));
    } catch {
      // Still works for this session.
    }
  }

  has(c: { x: number; z: number }): boolean {
    return this.visited.has(cityId(c)) || this.shared.has(cityId(c));
  }

  /** Looted according to the shared list, whatever this visitor has marked. */
  isShared(c: { x: number; z: number }): boolean {
    return this.shared.has(cityId(c));
  }

  setShared(ids: string[], already: string[] = []): void {
    this.shared = new Set(ids);
    this.sharedAlready = new Set(already);
    this.priorPoints = null;
    this.intactPoints = null;
    this.version++;
  }

  /** Found already looted on arrival, by this visitor or according to the shared list. */
  isAlready(c: { x: number; z: number }): boolean {
    return this.already.has(cityId(c)) || this.sharedAlready.has(cityId(c));
  }

  /** Mark a city as found already looted (which also marks it looted), or take that back and leave it looted. */
  setAlready(c: { x: number; z: number }, found: boolean): void {
    if (found) {
      if (!this.visited.has(cityId(c))) this.visited.set(cityId(c), new Date().toISOString());
      this.already.add(cityId(c));
    } else this.already.delete(cityId(c));
    this.save();
  }

  /** Every city found already looted, the visitor's own and the shared list's, as "x,z". */
  alreadyAll(): string[] {
    return [...new Set([...this.already, ...this.sharedAlready])];
  }

  /** This visitor's own "found already looted" marks that are not on the shared list yet, as "x,z". */
  ownAlready(): string[] {
    return [...this.already].filter((id) => !this.sharedAlready.has(id));
  }

  /**
   * Whether a city found already looted lies within this many blocks: a sign someone hunted here before.
   * One with an intact city in between does not count: whoever looted it did not come this way.
   */
  nearAlready(c: { x: number; z: number }, radius: number): boolean {
    this.priorPoints ??= [...new Set([...this.already, ...this.sharedAlready])].map((id) => {
      const [x, z] = id.split(',').map(Number);
      return [x, z];
    });
    this.intactPoints ??= this.all()
      .filter((id) => !this.already.has(id) && !this.sharedAlready.has(id))
      .map((id) => {
        const [x, z] = id.split(',').map(Number);
        return [x, z];
      });
    const intact = this.intactPoints;
    return this.priorPoints.some(
      ([x, z]) =>
        Math.hypot(x - c.x, z - c.z) <= radius &&
        !intact.some(([ix, iz]) => distanceToSegment({ x: ix, z: iz }, { x, z }, c) <= BETWEEN_BLOCKS),
    );
  }

  /** This visitor's own marks that are not on the shared list yet, as "x,z". */
  ownNew(): string[] {
    return [...this.visited.keys()].filter((id) => !this.shared.has(id));
  }

  /** Every looted city known here, the visitor's own and the shared list's, as "x,z". */
  all(): string[] {
    return [...new Set([...this.visited.keys(), ...this.shared])];
  }

  get sharedCount(): number {
    return this.shared.size;
  }

  set(c: { x: number; z: number }, visited: boolean): void {
    if (visited) this.visited.set(cityId(c), new Date().toISOString());
    else {
      this.visited.delete(cityId(c));
      this.already.delete(cityId(c));
    }
    this.save();
  }

  clear(): void {
    this.visited.clear();
    this.already.clear();
    this.save();
  }

  get count(): number {
    return this.visited.size;
  }

  /** Rows of x,z,visited_at. */
  toCsv(): string {
    const rows = [...this.visited].map(([id, at]) => `${id},${at}`);
    return ['x,z,visited_at', ...rows].join('\n') + '\n';
  }

  /** Merge visited positions from CSV (as exported above; only x and z are required). Returns how many were added. */
  mergeCsv(text: string): number {
    let added = 0;
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(-?\d+)\s*,\s*(-?\d+)\s*(?:,\s*(.+))?$/);
      if (!m) continue;
      const id = `${Number(m[1])},${Number(m[2])}`;
      if (!this.visited.has(id)) {
        this.visited.set(id, m[3]?.trim() || new Date().toISOString());
        added++;
      }
    }
    this.save();
    return added;
  }
}
