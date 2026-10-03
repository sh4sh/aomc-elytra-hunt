import { describe, expect, it } from 'vitest';
import { BATCH_SIZE, diagonalOffset, makeBatches, passes, quadrantOf } from '../src/filters';
import type { City, Filters } from '../src/types';

const all: Filters = { minDist: 10000, maxDist: 20000, diagonalDeg: 45, quadrants: ['NE', 'NW', 'SE', 'SW'] };

describe('filters', () => {
  it('measures distance along the longer axis', () => {
    expect(passes(10000, 2000, all)).toBe(true);
    expect(passes(9000, 9000, all)).toBe(false);
    expect(passes(-20001, 0, all)).toBe(false);
  });

  it('keeps only positions near a diagonal', () => {
    expect(diagonalOffset(100, -100)).toBeCloseTo(0);
    expect(diagonalOffset(0, 100)).toBeCloseTo(45);
    expect(passes(12000, 12000, { ...all, diagonalDeg: 10 })).toBe(true);
    expect(passes(12000, 2000, { ...all, diagonalDeg: 10 })).toBe(false);
  });

  it('can keep positions near an axis instead', () => {
    const nearAxis = { ...all, diagonalDeg: 10, angleFrom: 'axis' as const };
    expect(passes(12000, 1000, nearAxis)).toBe(true);
    expect(passes(-1000, -12000, nearAxis)).toBe(true);
    expect(passes(12000, 12000, nearAxis)).toBe(false);
    // 45 degrees keeps everything, whichever lines it is measured from.
    expect(passes(12000, 12000, { ...nearAxis, diagonalDeg: 45 })).toBe(true);
  });

  it('treats -z as north', () => {
    expect(quadrantOf(5, -5)).toBe('NE');
    expect(quadrantOf(-5, 5)).toBe('SW');
    expect(passes(12000, -12000, { ...all, quadrants: ['SW'] })).toBe(false);
  });
});

describe('makeBatches', () => {
  const cities: City[] = [];
  for (let i = 0; i < 100; i++) cities.push({ x: ((i * 7919) % 2000) * 10, z: ((i * 104729) % 1000) * 10, source: 'seed' });

  it('makes full batches with a single remainder and loses nothing', () => {
    const batches = makeBatches(cities);
    expect(batches.map((b) => b.length).sort((a, b) => b - a)).toEqual([BATCH_SIZE, BATCH_SIZE, BATCH_SIZE, 19]);
    expect(new Set(batches.flat()).size).toBe(100);
  });

  it('does not depend on input order', () => {
    expect(makeBatches([...cities].reverse())).toEqual(makeBatches(cities));
  });

  it('numbers batches outward from 0,0', () => {
    const centre = (b: City[]) => Math.hypot(b.reduce((t, c) => t + c.x, 0) / b.length, b.reduce((t, c) => t + c.z, 0) / b.length);
    const d = makeBatches(cities).map(centre);
    expect(d).toEqual([...d].sort((a, b) => a - b));
  });

  describe('with a longest hop', () => {
    const hops = (b: City[]) => b.slice(1).map((c, i) => Math.hypot(c.x - b[i].x, c.z - b[i].z));
    // A dense field, so full batches exist, plus one city far from everything.
    const field: City[] = [];
    for (let i = 0; i < 120; i++) field.push({ x: 10000 + ((i * 7919) % 97) * 90, z: ((i * 104729) % 89) * 90, source: 'seed' });
    const far: City = { x: 500000, z: 500000, source: 'seed' };

    for (const shape of ['cluster', 'line'] as const) {
      it(`makes only full batches with every flight within the limit (${shape})`, () => {
        const batches = makeBatches([...field, far], BATCH_SIZE, shape, 2000);
        expect(batches.length).toBeGreaterThan(0);
        for (const b of batches) expect(b.length).toBe(BATCH_SIZE);
        expect(new Set(batches.flat()).size).toBe(batches.flat().length);
        expect(Math.max(...batches.flatMap(hops))).toBeLessThanOrEqual(2000);
        expect(batches.flat()).not.toContain(far);
      });
    }

    it('does not depend on input order', () => {
      expect(makeBatches([...field].reverse(), BATCH_SIZE, 'cluster', 2000)).toEqual(makeBatches(field, BATCH_SIZE, 'cluster', 2000));
    });
  });

  describe('as lines', () => {
    // Two fans of cities either side of the +x axis, well apart in bearing.
    const fans: City[] = [];
    for (let i = 0; i < 40; i++) {
      const r = 10000 + i * 250;
      for (const deg of [40 + (i % 5), -50 + (i % 5)]) {
        const a = (deg * Math.PI) / 180;
        fans.push({ x: Math.round(r * Math.cos(a)), z: Math.round(r * Math.sin(a)), source: 'seed' });
      }
    }

    it('loses nothing and never mixes two fans in a batch', () => {
      const batches = makeBatches(fans, BATCH_SIZE, 'line');
      expect(new Set(batches.flat()).size).toBe(fans.length);
      for (const b of batches) expect(new Set(b.map((c) => Math.sign(c.z))).size).toBe(1);
      expect(batches.map((b) => b.length).sort((a, b) => b - a)).toEqual([20, 20, 20, 20]);
    });

    it('makes each batch narrower in bearing than a cluster', () => {
      const spread = (b: City[]) => {
        const deg = b.map((c) => (Math.atan2(c.z, c.x) * 180) / Math.PI);
        return Math.max(...deg) - Math.min(...deg);
      };
      const widest = (bs: City[][]) => Math.max(...bs.map(spread));
      expect(widest(makeBatches(fans, BATCH_SIZE, 'line'))).toBeLessThan(widest(makeBatches(fans, BATCH_SIZE)));
    });

    it('does not depend on input order', () => {
      expect(makeBatches([...fans].reverse(), BATCH_SIZE, 'line')).toEqual(makeBatches(fans, BATCH_SIZE, 'line'));
    });
  });
});

describe('constellation lookalike', async () => {
  const { lookalike } = await import('../src/constellations');

  it('recognises a W of cities as Cassiopeia, however it is turned', () => {
    const w = [[-2, -0.5], [-1, 0.5], [0, -0.2], [1, 0.6], [2, -0.6]];
    // Rotated a quarter turn, scaled up and moved far from the origin.
    const cities = w.map(([x, y]) => ({ x: 12000 - y * 900, z: -15000 + x * 900 }));
    expect(lookalike(cities)?.figure).toBe('Cassiopeia');
  });

  it('always gives the same answer for the same batch, in any order', () => {
    const cities = Array.from({ length: 27 }, (_, i) => ({ x: ((i * 7919) % 500) * 16, z: ((i * 104729) % 400) * 16 }));
    expect(lookalike([...cities].reverse())?.name).toBe(lookalike(cities)?.name);
  });

  it('has no opinion about a handful of cities', () => {
    expect(lookalike([{ x: 0, z: 0 }, { x: 5, z: 5 }])).toBeNull();
  });
});

describe('sky culture figures', async () => {
  const { existsSync, readFileSync } = await import('node:fs');
  const { buildFigures } = await import('../src/sky-cultures');
  const { lookalike } = await import('../src/constellations');
  const dir = 'public/skycultures';

  // The files are fetched by `npm run sky`.
  it.skipIf(!existsSync(`${dir}/cultures.json`))('builds usable figures from every culture', () => {
    const cultures = JSON.parse(readFileSync(`${dir}/cultures.json`, 'utf8'));
    const { stars } = JSON.parse(readFileSync(`${dir}/stars.json`, 'utf8'));
    const all = [];
    for (const c of cultures) {
      const figures = buildFigures(c, JSON.parse(readFileSync(`${dir}/${c.id}/index.json`, 'utf8')), stars);
      expect(figures.length, c.id).toBeGreaterThan(0);
      for (const f of figures) {
        expect(f.stars.flat().every(Number.isFinite)).toBe(true);
        expect(f.names[0].license).toBe(c.license);
      }
      all.push(...figures);
    }
    const cities = Array.from({ length: 27 }, (_, i) => ({ x: ((i * 7919) % 500) * 16, z: ((i * 104729) % 400) * 16 }));
    expect(lookalike(cities, all)).not.toBeNull();
  });
});

describe('JourneyMap chat lines', async () => {
  const { chatLine, chatLines, cleanUsername } = await import('../src/journeymap');
  const a: City = { x: 12040, z: -11832, source: 'seed' };
  const b: City = { x: -500, z: 9000, source: 'seed' };

  it('writes a location JourneyMap can pick out of chat', () => {
    expect(chatLine(a, 'EC 3-07')).toBe('[x:12040, y:70, z:-11832, name:EC 3-07]');
  });

  it('keeps commas, quotes and brackets out of the name, since they would break the format', () => {
    expect(chatLine(a, 'my "base", [old]')).not.toMatch(/name:.*[,"\[]/);
  });

  it('becomes a whisper when a username is given', () => {
    expect(chatLine(a, 'EC 3-07', 'Steve_01')).toBe('/msg Steve_01 [x:12040, y:70, z:-11832, name:EC 3-07]');
    expect(chatLines([a, b], 2, () => false, 'Steve_01')[1]).toBe('/msg Steve_01 [x:-500, y:70, z:9000, name:EC 3-02]');
  });

  it('drops characters a username cannot contain', () => {
    expect(cleanUsername(' Steve 01; /op me')).toBe('Steve01opme');
  });

  it('leaves out cities to skip but keeps the route numbering', () => {
    expect(chatLines([a, b], 2, (c) => c === a)).toEqual(['[x:-500, y:70, z:9000, name:EC 3-02]']);
  });
});

describe('shared looted list', async () => {
  const { Tracker } = await import('../src/tracker');

  it('counts as looted for everyone, on top of a visitor\'s own marks', () => {
    const tracker = new Tracker('test-seed');
    const shared = { x: 10264, z: 3864 };
    const other = { x: -500, z: 9000 };
    expect(tracker.has(shared)).toBe(false);
    tracker.setShared(['10264,3864']);
    expect(tracker.has(shared)).toBe(true);
    expect(tracker.isShared(shared)).toBe(true);
    expect(tracker.has(other)).toBe(false);
    // Unticking locally does not remove a city from the shared list.
    tracker.set(shared, false);
    expect(tracker.has(shared)).toBe(true);
  });
});
