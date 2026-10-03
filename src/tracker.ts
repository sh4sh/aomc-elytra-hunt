import { cityId } from './types';

/** Which cities have been looted, kept in localStorage per world seed. */
export class Tracker {
  private visited = new Map<string, string>();
  private readonly key: string;

  constructor(seed: string) {
    this.key = `end-cities:visited:${seed}`;
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) this.visited = new Map(Object.entries(JSON.parse(raw)));
    } catch {
      // Storage unavailable or corrupt: start empty.
    }
  }

  private save(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(Object.fromEntries(this.visited)));
    } catch {
      // Still works for this session.
    }
  }

  has(c: { x: number; z: number }): boolean {
    return this.visited.has(cityId(c));
  }

  set(c: { x: number; z: number }, visited: boolean): void {
    if (visited) this.visited.set(cityId(c), new Date().toISOString());
    else this.visited.delete(cityId(c));
    this.save();
  }

  clear(): void {
    this.visited.clear();
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
