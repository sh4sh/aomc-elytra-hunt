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

  it('can search a circle around a position, ignoring the band settings', () => {
    const around = { ...all, quadrants: [], around: { x: 100000, z: 200000, radius: 5000 } };
    expect(passes(100000, 200000, around)).toBe(true);
    expect(passes(103000, 204000, around)).toBe(true);
    expect(passes(104000, 204000, around)).toBe(false);
    expect(passes(12000, 12000, around)).toBe(false);
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

    it('builds and numbers routes outward from the given start point', () => {
      const from = { x: 18000, z: 6000 };
      const centre = (b: City[]) =>
        Math.hypot(b.reduce((t, c) => t + c.x, 0) / b.length - from.x, b.reduce((t, c) => t + c.z, 0) / b.length - from.z);
      const batches = makeBatches(field, 9, 'cluster', 2000, 0, from);
      expect(batches.length).toBeGreaterThan(2);
      const d = batches.map(centre);
      expect(d).toEqual([...d].sort((a, b) => a - b));
      // Each route sets off from its end nearer the start point.
      for (const b of batches) {
        expect(Math.hypot(b[0].x - from.x, b[0].z - from.z)).toBeLessThanOrEqual(
          Math.hypot(b[b.length - 1].x - from.x, b[b.length - 1].z - from.z),
        );
      }
    });

    it('keeps a line within the allowed distance of straight', () => {
      // A string of cities close to the +x axis, with others well off to one side.
      const along: City[] = [];
      for (let i = 0; i < 40; i++) {
        along.push({ x: 10000 + i * 500, z: ((i * 37) % 3) * 100 - 100, source: 'seed' });
        if (i % 4 === 0) along.push({ x: 10000 + i * 500, z: 1500, source: 'seed' });
      }
      const limit = 600;
      const batches = makeBatches(along, 9, 'line', 2000, limit);
      expect(batches.length).toBeGreaterThan(0);
      for (const b of batches) {
        // The line runs from 0,0 through the city the batch was grown from, which is one of its members.
        const fits = b.some((s) => b.every((c) => Math.abs(c.x * s.z - c.z * s.x) / Math.hypot(s.x, s.z) <= limit + 1e-6));
        expect(fits).toBe(true);
        // So a batch never mixes the string along the axis with the cities 1,500 blocks off it.
        expect(new Set(b.map((c) => c.z === 1500)).size).toBe(1);
      }
      // Without the limit, at least as many cities are batched.
      expect(makeBatches(along, 9, 'line', 2000).flat().length).toBeGreaterThanOrEqual(batches.flat().length);
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

describe('looted submission relay', async () => {
  const { parseSubmission, issueFor, MAX_CITIES } = await import('../relay/src/validate');

  it('accepts coordinates and a username, dropping duplicates', () => {
    const r = parseSubmission({ name: 'Steve_01', cities: ['10264,3864', '-500,9000', '10264,3864'] });
    expect(r).toEqual({ ok: true, value: { name: 'Steve_01', cities: ['10264,3864', '-500,9000'] } });
  });

  it('refuses anything that is not plain coordinates', () => {
    for (const cities of [['1,2; drop'], ['[link](http://x)'], ['1,2,3'], [12], [], 'nope']) {
      expect(parseSubmission({ name: 'x', cities }).ok).toBe(false);
    }
    expect(parseSubmission({ cities: Array.from({ length: MAX_CITIES + 1 }, (_, i) => `${i},0`) }).ok).toBe(false);
  });

  it('strips a name down to username characters, so it cannot carry markup or mentions', () => {
    const r = parseSubmission({ name: '@everyone **hi** <script>', cities: ['1,2'] });
    expect(r.ok && r.value.name).toBe('everyonehiscript');
    expect(parseSubmission({ cities: ['1,2'] })).toMatchObject({ value: { name: 'anonymous' } });
  });

  it('writes an issue the merge script can read back', () => {
    const { title, body, labels } = issueFor({ name: 'Steve_01', cities: ['10264,3864', '-500,9000'] });
    expect(title).toBe('Looted cities from Steve_01 (2)');
    expect(labels).toEqual(['map-submission']);
    const rows = body.split('\n').filter((l) => /^\s*-?\d+\s*,\s*-?\d+/.test(l));
    expect(rows).toEqual(['10264,3864', '-500,9000']);
  });
});

describe('waypoint names', async () => {
  const { setBatchTags, waypointName } = await import('../src/xaero');

  it('numbers generated batches and tags custom ones', () => {
    setBatchTags([]);
    expect(waypointName(2, 6)).toBe('EC 3-07');
    setBatchTags(['1', '2', 'C1']);
    expect(waypointName(1, 0)).toBe('EC 2-01');
    expect(waypointName(2, 11)).toBe('EC C1-12');
    setBatchTags([]);
  });
});

describe('typed coordinates', async () => {
  const { parseCoordinates } = await import('../src/import');
  const at = (text: string) => {
    const p = parseCoordinates(text)[0];
    return p && [p.x, p.z];
  };

  it('reads x: and z: labels, with or without spaces, in either order', () => {
    expect(at('x:100000, z:200000')).toEqual([100000, 200000]);
    expect(at('x: 100000, z: -200000')).toEqual([100000, -200000]);
    expect(at('z: -200 x: 100')).toEqual([100, -200]);
    expect(at('X=12 Y=64 Z=-34')).toEqual([12, -34]);
  });

  it('reads bare numbers, treating a middle number as y', () => {
    expect(at('100000,200000')).toEqual([100000, 200000]);
    expect(at('100000, -200000')).toEqual([100000, -200000]);
    expect(at('-5 70 9')).toEqual([-5, 9]);
  });

  it('rejects text without two numbers', () => {
    expect(at('hello')).toBeUndefined();
    expect(at('x: 5')).toBeUndefined();
  });
});

describe('webmap coverage', async () => {
  const { existsSync, readFileSync } = await import('node:fs');
  const { Explored } = await import('../src/explored');

  it.skipIf(!existsSync('public/explored.json'))('only counts a city as mapped when it sits inside mapped terrain', async () => {
    const file = JSON.parse(readFileSync('public/explored.json', 'utf8'));
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, json: async () => file })) as unknown as typeof fetch;
    const mask = (await Explored.load())!;
    globalThis.fetch = realFetch;

    // Take a mapped run at least 5 pixels long with mapped rows above and below its middle.
    const bpp = file.blocksPerPixel;
    const rows = new Map<number, number[]>();
    for (let i = 0; i < file.runs.length; ) {
      rows.set(file.runs[i], file.runs.slice(i + 2, i + 2 + file.runs[i + 1] * 2));
      i += 2 + file.runs[i + 1] * 2;
    }
    const on = (px: number, pz: number) => {
      const r = rows.get(pz) ?? [];
      for (let k = 0; k < r.length; k += 2) if (r[k] <= px && px < r[k] + r[k + 1]) return true;
      return false;
    };
    let inside: [number, number] | null = null;
    let edge: [number, number] | null = null;
    for (const [pz, r] of rows) {
      for (let k = 0; k < r.length && !(inside && edge); k += 2) {
        const px = r[k] + Math.floor(r[k + 1] / 2);
        const surrounded = [-1, 0, 1].every((dz) => [-1, 0, 1].every((dx) => on(px + dx, pz + dz)));
        if (surrounded && !inside) inside = [px, pz];
        // Just off the end of a run: next to mapped terrain, but not on it.
        if (!on(r[k] - 1, pz) && !edge) edge = [r[k] - 1, pz];
      }
    }
    expect(inside && edge).toBeTruthy();
    expect(mask.isMapped(inside![0] * bpp + bpp / 2, inside![1] * bpp + bpp / 2)).toBe(true);
    expect(mask.isMapped(edge![0] * bpp + bpp / 2, edge![1] * bpp + bpp / 2)).toBe(false);
    // The city a player reported: just outside the mapped corridor.
    expect(mask.isMapped(-591320, -2808)).toBe(false);
  });
});

describe('falling back to smaller batches', async () => {
  const { makeBatchesOrSmaller } = await import('../src/filters');
  // A string of 12 cities 1,000 blocks apart: with flights capped at 2,000 the longest possible batch is 12.
  const line: City[] = Array.from({ length: 12 }, (_, i) => ({ x: 10000 + i * 1000, z: 0, source: 'seed' as const }));

  it('keeps the wanted size when it fits', () => {
    const made = makeBatchesOrSmaller({ cities: line, size: 6, shape: 'cluster', maxHop: 2000, lineDeviation: 0 });
    expect(made.size).toBe(6);
    expect(made.batches.map((b) => b.length)).toEqual([6, 6]);
  });

  it('settles for the largest size that gives a batch', () => {
    const made = makeBatchesOrSmaller({ cities: line, size: 500, shape: 'cluster', maxHop: 2000, lineDeviation: 0 });
    expect(made.size).toBe(12);
    expect(made.batches.map((b) => b.length)).toEqual([12]);
  });

  it('gives nothing when no two cities are within reach', () => {
    const far = line.map((c, i) => ({ ...c, x: 10000 + i * 5000 }));
    expect(makeBatchesOrSmaller({ cities: far, size: 27, shape: 'cluster', maxHop: 2000, lineDeviation: 0 }).batches).toEqual([]);
  });
});

describe('ship reports through the relay', async () => {
  const { parseShipReport, issueForShip } = await import('../relay/src/validate');

  it('accepts a city and one of the three things a player can find', () => {
    for (const result of ['found', 'missing', 'no-city'] as const) {
      expect(parseShipReport({ kind: 'ship', city: '-554792,8712', result, name: 'Steve_01' })).toEqual({
        ok: true,
        value: { name: 'Steve_01', city: '-554792,8712', result, uncertain: false },
      });
    }
  });

  it('carries whether the app had marked the ship as uncertain', () => {
    const r = parseShipReport({ city: '1,2', result: 'missing', uncertain: true });
    expect(r.ok && r.value.uncertain).toBe(true);
  });

  it('refuses anything else', () => {
    for (const bad of [{ city: '1,2' }, { city: '1,2,3', result: 'found' }, { city: 'x', result: 'missing' }, { city: '1,2', result: 'maybe' }, null]) {
      expect(parseShipReport(bad).ok).toBe(false);
    }
  });

  it('writes an issue the merge script can read back', () => {
    const line = /^ship-report: (missing|found|no-city) (-?\d+,-?\d+)$/gm;
    const noShip = issueForShip({ name: 'Steve_01', city: '-554792,8712', result: 'missing', uncertain: true });
    expect(noShip.body).toContain('had marked this ship as uncertain');
    expect(noShip.title).toBe('Ship report: no ship at x: -554792, z: 8712');
    expect(noShip.labels).toEqual(['ship-report']);
    expect([...noShip.body.matchAll(line)].map((m) => [m[1], m[2]])).toEqual([['missing', '-554792,8712']]);
    const noCity = issueForShip({ name: 'Steve_01', city: '30000,-4000', result: 'no-city', uncertain: false });
    expect(noCity.body).toContain('had **not** marked this ship as uncertain');
    expect(noCity.title).toBe('Ship report: no End City at x: 30000, z: -4000');
    expect([...noCity.body.matchAll(line)].map((m) => [m[1], m[2]])).toEqual([['no-city', '30000,-4000']]);
  });
});

describe("Xaero's Minimap chat lines", async () => {
  const { shareLine } = await import('../src/xaero');
  const a: City = { x: 12040, z: -11832, source: 'seed' };

  it('writes a waypoint the mod can pick out of chat', () => {
    expect(shareLine(a, 'EC 3-07', '7', 11)).toBe('xaero-waypoint:EC 3-07:7:12040:70:-11832:11:false:0:Internal-the-end-waypoints');
  });

  it('whispers to the player when given a username', () => {
    expect(shareLine(a, 'EC 3-07', '7', 11, 'Steve_01')).toMatch(/^\/msg Steve_01 xaero-waypoint:EC 3-07:7:/);
  });

  it('keeps the fields intact', () => {
    expect(shareLine(a, 'a:b', '123', 11).split(':')).toHaveLength(10);
    expect(shareLine(a, 'a:b', '123', 11)).toContain(':a b:12:');
  });
});
