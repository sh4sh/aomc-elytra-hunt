// Constellation figures from sky cultures around the world, for the batch
// lookalike easter egg.
//
// public/skycultures/ holds each culture exactly as published in the Stellarium
// sky cultures collection, each a separate work under its own licence (see the
// README there). They are read and turned into flat figures here, in the
// browser; nothing derived from them is stored or shipped.

import type { Constellation } from './constellations';

interface Culture {
  id: string;
  /** How the tradition is described next to a name. */
  from: string;
  license: string;
  /** The culture's own write-up: background, references, authors, licence. */
  source: string;
}

interface CommonName {
  english?: string;
  native?: string;
  pronounce?: string;
}

interface CultureIndex {
  constellations?: { lines?: (number | string)[][]; common_name?: CommonName }[];
}

/** Hipparcos number -> [right ascension, declination] in degrees. */
type Stars = Record<string, [number, number]>;

// A figure needs enough stars to have a shape, and few enough to compare with a batch.
const MIN_STARS = 4;
const MAX_STARS = 16;
/** Figures spanning more of the sky than this (degrees from their centre) distort too much when flattened. */
const MAX_RADIUS_DEG = 40;

type Vec = [number, number, number];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec): Vec => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

function displayName(cn: CommonName): string | undefined {
  const own = cn.native && cn.pronounce ? `${cn.pronounce} (${cn.native})` : cn.native || cn.pronounce;
  if (own && cn.english && own !== cn.english) return `${own}, ${cn.english}`;
  return own || cn.english;
}

/** Turn one culture's constellations into flat stick figures. */
export function buildFigures(culture: Culture, index: CultureIndex, stars: Stars): Constellation[] {
  const out: Constellation[] = [];
  for (const con of index.constellations ?? []) {
    const name = con.common_name && displayName(con.common_name);
    if (!name || !con.lines?.length) continue;
    // Lines are paths of Hipparcos star numbers, optionally prefixed with a weight such as "thin".
    const ids: number[] = [];
    const lines: [number, number][] = [];
    for (const path of con.lines) {
      const hips = path.filter((v): v is number => typeof v === 'number');
      for (const hip of hips) if (!ids.includes(hip)) ids.push(hip);
      for (let i = 1; i < hips.length; i++) lines.push([ids.indexOf(hips[i - 1]), ids.indexOf(hips[i])]);
    }
    if (ids.length < MIN_STARS || ids.length > MAX_STARS || ids.some((hip) => !stars[hip])) continue;

    const vecs = ids.map((hip): Vec => {
      const ra = (stars[hip][0] * Math.PI) / 180;
      const dec = (stars[hip][1] * Math.PI) / 180;
      return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
    });
    const centre = unit(vecs.reduce((s, v): Vec => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]));
    if (vecs.some((v) => dot(v, centre) < Math.cos((MAX_RADIUS_DEG * Math.PI) / 180))) continue;
    // Flatten onto the plane touching the sky at the figure's centre, north up, as seen from the ground.
    const pole: Vec = Math.abs(centre[2]) > 0.999 ? [1, 0, 0] : [0, 0, 1];
    const east = unit(cross(pole, centre));
    const north = cross(centre, east);
    out.push({
      names: [{ name, from: culture.from, source: culture.source, license: culture.license }],
      stars: vecs.map((v): [number, number] => [-dot(v, east) / dot(v, centre), -dot(v, north) / dot(v, centre)]),
      lines,
    });
  }
  return out;
}

/** Fetch every culture and build its figures. Cultures that fail to load are skipped. */
export async function loadSkyFigures(): Promise<Constellation[]> {
  const base = './skycultures';
  const json = async (path: string) => {
    const res = await fetch(`${base}/${path}`);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  };
  try {
    const [cultures, starFile]: [Culture[], { stars: Stars }] = await Promise.all([json('cultures.json'), json('stars.json')]);
    const perCulture = await Promise.all(
      cultures.map((c) =>
        json(`${c.id}/index.json`)
          .then((index: CultureIndex) => buildFigures(c, index, starFile.stars))
          .catch(() => []),
      ),
    );
    return perCulture.flat();
  } catch {
    return [];
  }
}
