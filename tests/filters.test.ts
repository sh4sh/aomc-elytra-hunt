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
    expect(r).toEqual({ ok: true, value: { name: 'Steve_01', cities: ['10264,3864', '-500,9000'], already: [] } });
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
    const { title, body, labels } = issueFor({ name: 'Steve_01', cities: ['10264,3864', '-500,9000'], already: [] });
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

describe('found already looted', async () => {
  const { Tracker } = await import('../src/tracker');
  const { parseSubmission, issueFor } = await import('../relay/src/validate');

  it('flags the cities around one found already looted', () => {
    const t = new Tracker('test');
    t.setAlready({ x: 1000, z: 1000 }, true);
    expect(t.has({ x: 1000, z: 1000 })).toBe(true);
    expect(t.nearAlready({ x: 2500, z: 1000 }, 2000)).toBe(true);
    expect(t.nearAlready({ x: 4000, z: 1000 }, 2000)).toBe(false);
    // An intact city in between clears the one beyond it, but not one off to the side.
    t.set({ x: 1800, z: 1100 }, true);
    expect(t.nearAlready({ x: 2500, z: 1000 }, 2000)).toBe(false);
    expect(t.nearAlready({ x: 1000, z: 2500 }, 2000)).toBe(true);
    t.set({ x: 1800, z: 1100 }, false);
    expect(t.nearAlready({ x: 2500, z: 1000 }, 2000)).toBe(true);
    t.set({ x: 1000, z: 1000 }, false);
    expect(t.nearAlready({ x: 2500, z: 1000 }, 2000)).toBe(false);
    t.setShared(['0,0'], ['0,0']);
    expect(t.nearAlready({ x: 100, z: 100 }, 2000)).toBe(true);
    expect(t.ownAlready()).toEqual([]);
    // Shown as "looted by someone else" only while it is the visitor's own mark, off the shared list.
    t.setAlready({ x: 5000, z: 5000 }, true);
    expect(t.showsAlready({ x: 5000, z: 5000 })).toBe(true);
    expect(t.showsAlready({ x: 0, z: 0 })).toBe(false);
    t.setShared(['0,0', '5000,5000'], ['0,0', '5000,5000']);
    expect(t.showsAlready({ x: 5000, z: 5000 })).toBe(false);
    expect(t.isAlready({ x: 5000, z: 5000 })).toBe(true);
  });

  it('travels in a submission as marked rows', () => {
    const parsed = parseSubmission({ name: 'Steve', cities: ['1,2', '3,4'], already: ['3,4', '9,9', 'x'] });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.already).toEqual(['3,4']);
    expect(issueFor(parsed.value).body).toContain('1,2\n3,4,already\n');
  });
});

describe('earlier flight paths', async () => {
  const { findTrajectories, onTrajectory } = await import('../src/trajectory');
  const line = [0, 1, 2, 3, 4].map((i) => ({ x: 10000 + i * 2500, z: 5000 + i * 100 }));

  it('needs three cities found already looted in a line', () => {
    expect(findTrajectories(line.slice(0, 2), [])).toEqual([]);
    const [t] = findTrajectories([line[2], line[0], line[1]], []);
    expect(t.confidence).toBe('medium');
    expect(t.points).toEqual(line.slice(0, 3));
    expect(findTrajectories(line, [])[0].confidence).toBe('high');
  });

  it('ignores reports that are far apart or bunched together', () => {
    expect(findTrajectories([line[0], line[2], line[4]], [])).toEqual([]);
    const bunch = [{ x: 0, z: 0 }, { x: 2000, z: 0 }, { x: 1000, z: 1800 }];
    expect(findTrajectories(bunch, [])).toEqual([]);
  });

  it('thinks less of a path with intact cities along it', () => {
    const intact = [{ x: 11200, z: 5300 }, { x: 13700, z: 5000 }];
    // One intact city is taken for a miss by the earlier hunter.
    expect(findTrajectories(line, intact.slice(0, 1))[0]).toMatchObject({ confidence: 'high', intact: 1 });
    expect(findTrajectories(line, intact)[0]).toMatchObject({ confidence: 'medium', intact: 2 });
    expect(findTrajectories(line.slice(0, 3), intact)).toEqual([]);
    expect(findTrajectories(line, [{ x: 11200, z: 9000 }])[0].confidence).toBe('high');
  });

  it('covers cities beside the line and a little past its ends', () => {
    const [t] = findTrajectories(line, []);
    expect(onTrajectory(t, { x: 13000, z: 5900 })).toBe(true);
    expect(onTrajectory(t, { x: 21500, z: 5400 })).toBe(true);
    expect(onTrajectory(t, { x: 13000, z: 7000 })).toBe(false);
    expect(onTrajectory(t, { x: 24000, z: 5400 })).toBe(false);
  });
});

describe('earlier flight paths with webmap cities', async () => {
  const { studyTrajectories, describeTrajectory } = await import('../src/trajectory');
  const line = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 10000 + i * 2500, z: 5000 }));

  it('lets a webmap city support a path that players\' reports began', () => {
    const { paths } = studyTrajectories(line.slice(0, 2), [], [line[2]]);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatchObject({ confidence: 'medium', mapped: 1 });
    expect(describeTrajectory(paths[0])).toContain('3 ships in a line (2 looted by someone else, 1 on the webmap)');
  });

  it('never makes a path out of the webmap alone, or mostly', () => {
    // A webmap trail is that player's own flight, which is already known.
    expect(studyTrajectories([], [], line)).toEqual({ paths: [], near: [] });
    expect(studyTrajectories([line[0]], [], line.slice(1)).paths).toEqual([]);
    // Two reports with four webmap cities close by and in line: only two of those are counted.
    const close = [13500, 14500, 15500, 16000].map((x) => ({ x, z: 5000 }));
    const [t] = studyTrajectories(line.slice(0, 2), [], close).paths;
    expect(t.points).toHaveLength(4);
    expect(t).toMatchObject({ confidence: 'medium', mapped: 2 });
    // Webmap cities further than a flight's reach from any report are left out altogether.
    expect(studyTrajectories(line.slice(0, 2), [], line.slice(3)).paths).toEqual([]);
  });

  it('ignores webmap cities off the line the reports make', () => {
    const { paths, near } = studyTrajectories(line.slice(0, 2), [], [{ x: 11000, z: 8000 }]);
    expect(paths).toEqual([]);
    expect(near[0]).toContain('a third in line with them would make a path');
  });
});

describe('relay cap on issues filed', async () => {
  const { overCap, MAX_PER_HOUR, MAX_PER_DAY } = await import('../relay/src/validate');
  const now = Date.parse('2026-10-05T12:00:00Z');
  const issue = (minutesAgo: number, label = 'map-submission') => ({
    created_at: new Date(now - minutesAgo * 60_000).toISOString(),
    labels: [{ name: label }],
  });

  it('lets submissions through below the caps', () => {
    expect(overCap([], now)).toBeNull();
    expect(overCap(Array.from({ length: MAX_PER_HOUR - 1 }, () => issue(5)), now)).toBeNull();
  });

  it('stops at the hourly and daily caps, counting both kinds of submission', () => {
    const lastHour = [...Array.from({ length: MAX_PER_HOUR - 1 }, () => issue(5)), issue(10, 'ship-report')];
    expect(overCap(lastHour, now)).toBe('hour');
    expect(overCap(Array.from({ length: MAX_PER_DAY }, (_, k) => issue(90 + k)), now)).toBe('day');
  });

  it('ignores other issues and old ones', () => {
    const others = Array.from({ length: 80 }, () => issue(5, 'bug'));
    const old = Array.from({ length: 100 }, () => issue(60 * 30));
    expect(overCap([...others, ...old, { created_at: new Date(now).toISOString(), labels: [] }], now)).toBeNull();
  });
});

describe('who looted a shared city', async () => {
  const { Tracker } = await import('../src/tracker');

  it('knows the player who sent a city in, where they gave a name', () => {
    const t = new Tracker('test-by');
    t.setShared(['1,2', '3,4'], [], { Steve_01: ['1,2'] });
    expect(t.lootedBy({ x: 1, z: 2 })).toBe('Steve_01');
    expect(t.lootedBy({ x: 3, z: 4 })).toBeNull();
    t.setShared(['1,2']);
    expect(t.lootedBy({ x: 1, z: 2 })).toBeNull();
  });
});

describe('survey of the cities near End Spawn', async () => {
  const { stratum, surveySample, surveyEstimate } = await import('../src/survey');
  // 400 cities, crowded towards the south-east, as a real ring of cities is uneven.
  const cities = Array.from({ length: 400 }, (_, k) => ({ x: ((k * 37) % 190) * 100 - 9000, z: ((k * 53) % 170) * 100 - 7000 })).filter(
    (c) => Math.max(Math.abs(c.x), Math.abs(c.z)) < 10000,
  );
  // A fixed sequence in place of chance, so the test picks the same cities every time.
  const dice = () => {
    let n = 0;
    return () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648);
  };

  it('picks the number asked for, no city twice, each piece of the area giving its share', () => {
    const picked = surveySample(cities, 40, 10000, dice());
    expect(picked).toHaveLength(40);
    expect(new Set(picked).size).toBe(40);
    const count = (list: typeof cities) => {
      const by = new Map<string, number>();
      for (const c of list) by.set(stratum(c, 10000), (by.get(stratum(c, 10000)) ?? 0) + 1);
      return by;
    };
    const all = count(cities);
    const got = count(picked);
    for (const [key, size] of all) {
      const share = (40 * size) / cities.length;
      expect(Math.abs((got.get(key) ?? 0) - share)).toBeLessThan(1);
    }
  });

  it('takes every city when asked for more than there are', () => {
    expect(surveySample(cities.slice(0, 5), 30, 10000, dice())).toHaveLength(5);
    expect(surveySample([], 30, 10000)).toEqual([]);
  });

  it('estimates the share looted, more surely as more are checked', () => {
    expect(surveyEstimate(0, 0, 150)).toBeNull();
    const few = surveyEstimate(10, 6, 150)!;
    const many = surveyEstimate(30, 18, 150)!;
    expect(few.rate).toBeCloseTo(0.6);
    expect(many.margin).toBeLessThan(few.margin);
    // With every city in the area checked there is nothing left to guess.
    expect(surveyEstimate(150, 90, 150)!.margin).toBe(0);
  });
});

describe('areas to export for the webmap', async () => {
  const { exportAreas } = await import('../src/export-areas');
  type Area = { x0: number; z0: number; x1: number; z1: number };
  /** A webmap with terrain in the given 16-block cells. */
  const webmap = (cells: [number, number][]) => ({
    eachMapped(a: Area, visit: (x: number, z: number) => boolean | void) {
      for (const [x, z] of cells) if (x >= a.x0 && x < a.x1 && z >= a.z0 && z < a.z1 && visit(x, z)) return;
    },
  });
  const within = (a: Area, x: number, z: number) => x >= a.x0 && x < a.x1 && z >= a.z0 && z < a.z1;
  const fromPath = (path: { x: number; z: number }[], x: number, z: number) =>
    Math.min(
      ...path.slice(1).map((b, k) => {
        const a = path[k];
        const [dx, dz] = [b.x - a.x, b.z - a.z];
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
        return Math.hypot(x - (a.x + t * dx), z - (a.z + t * dz));
      }),
    );

  it('is one rectangle around the path, with room for what was explored, when the webmap has nothing there', () => {
    const { areas, leftOut } = exportAreas([{ x: 1000, z: 1000 }, { x: 5000, z: 1000 }, { x: 5000, z: 4000 }], webmap([]));
    expect(leftOut).toBe(0);
    expect(areas).toHaveLength(1);
    expect(areas[0].x0).toBeLessThanOrEqual(1000 - 168);
    expect(areas[0].x1).toBeGreaterThanOrEqual(5000 + 168);
    expect(areas[0].z1).toBeGreaterThanOrEqual(4000 + 168);
    expect(areas[0].x0 % 16).toBe(0);
  });

  it('splits round terrain the webmap already has, so that none of it is exported blank', () => {
    // An L-shaped path, with someone else's terrain in the corner of the L's rectangle that the path never goes near.
    const path = [{ x: 1000, z: 1000 }, { x: 5000, z: 1000 }, { x: 5000, z: 5000 }];
    const cells: [number, number][] = [];
    for (let x = 1500; x < 2500; x += 16) for (let z = 3500; z < 4500; z += 16) cells.push([x + 8, z + 8]);
    const { areas, leftOut } = exportAreas(path, webmap(cells));
    expect(leftOut).toBe(0);
    expect(areas.length).toBeGreaterThan(1);
    for (const [x, z] of cells) expect(areas.some((a) => within(a, x, z))).toBe(false);
  });

  it('leaves out the stretch that crosses another trail, and exports the rest', () => {
    const path = [{ x: 0, z: 0 }, { x: 8000, z: 0 }];
    // A trail 320 blocks wide running north to south across the path at x = 4000.
    const cells: [number, number][] = [];
    for (let x = 3840; x < 4160; x += 16) for (let z = -3000; z < 3000; z += 16) cells.push([x + 8, z + 8]);
    const { areas, leftOut } = exportAreas(path, webmap(cells));
    expect(leftOut).toBeGreaterThan(0);
    expect(leftOut).toBeLessThan(2000);
    expect(areas.length).toBe(2);
    // Whatever of the trail falls inside an exported rectangle is under the path, where the export has terrain of its own.
    for (const [x, z] of cells) if (areas.some((a) => within(a, x, z))) expect(fromPath(path, x, z)).toBeLessThanOrEqual(144);
  });

  it('keeps an export to a size Xaero can write', () => {
    const { areas } = exportAreas([{ x: 0, z: 0 }, { x: 20000, z: 0 }, { x: 40000, z: 300 }], webmap([]));
    expect(areas.length).toBeGreaterThan(1);
    for (const a of areas) expect(Math.max(a.x1 - a.x0, a.z1 - a.z0)).toBeLessThanOrEqual(20000 + 400);
  });
});

describe('checking an export against the webmap', async () => {
  const { exportImagePlace, wouldOverwrite } = await import('../src/export-areas');
  const { crc32, zipStore } = await import('../src/zip');
  type Area = { x0: number; z0: number; x1: number; z1: number };
  const webmap = (cells: [number, number][]) => ({
    eachMapped(a: Area, visit: (x: number, z: number) => boolean | void) {
      for (const [x, z] of cells) if (x >= a.x0 && x < a.x1 && z >= a.z0 && z < a.z1 && visit(x, z)) return;
    },
  });
  /** A 64 by 64 image at 1,024, 2,048, explored (grey) in its left half and black in its right. */
  const image = () => {
    const data = new Uint8Array(64 * 64 * 4);
    for (let z = 0; z < 64; z++) for (let x = 0; x < 32; x++) data.set([120, 120, 120, 255], (z * 64 + x) * 4);
    return { x0: 1024, z0: 2048, width: 64, height: 64, data };
  };

  it('reads where an image sits from its name', () => {
    expect(exportImagePlace('3_1_x-3184_z8816.png')).toEqual({ x0: -3184, z0: 8816 });
    expect(exportImagePlace('notes.png')).toBeNull();
  });

  it('is safe where the webmap has nothing, or only what the image also has', () => {
    expect(wouldOverwrite(image(), webmap([]))).toBe(false);
    expect(wouldOverwrite(image(), webmap([[1024 + 8, 2048 + 8]]))).toBe(false);
    // Terrain beside the image, not in it.
    expect(wouldOverwrite(image(), webmap([[1024 + 64 + 8, 2048 + 8]]))).toBe(false);
  });

  it('would overwrite where the image is black and the webmap is not', () => {
    expect(wouldOverwrite(image(), webmap([[1024 + 40, 2048 + 8]]))).toBe(true);
  });

  it('bundles files into a zip that lists them all', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
    const bytes = zipStore([
      { name: 'a.png', data: new Uint8Array([1, 2, 3]) },
      { name: 'b.png', data: new Uint8Array([4, 5]) },
    ]);
    const all = new Uint8Array(bytes.reduce((n, b) => n + b.length, 0));
    bytes.reduce((at, b) => (all.set(b, at), at + b.length), 0);
    const view = new DataView(all.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = all.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    // The list of files starts where the end record says it does.
    expect(view.getUint32(view.getUint32(end + 16, true), true)).toBe(0x02014b50);
  });
});
