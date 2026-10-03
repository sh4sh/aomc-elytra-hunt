// Fetches sky cultures for the batch lookalike easter egg into public/skycultures/.
//
//   npm run sky
//
// Each culture comes from the Stellarium sky cultures collection and is stored
// exactly as published, in its own folder with its own description (authors,
// references, licence). Nothing is merged or edited: the app reads the files
// and works out the figures in the browser. The cultures are under different
// licences (CC BY-SA, GNU GPL v2, CC BY-NC), so they must stay separate files.
//
// stars.json holds the positions of the stars those files refer to, taken from
// the HYG database (CC BY-SA 4.0).

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const REPO = 'Stellarium/stellarium-skycultures';
// Pinned so a refetch gives the same files.
const COMMIT = '014fbb5e59233d133c22f9811af96b67d05a95c9';
const HYG = 'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv';
const OUT = 'public/skycultures';

/** Culture folder -> how the tradition is described next to a name. */
const CULTURES = {
  anutan: 'Anuta, a Polynesian island in the Solomon Islands',
  aztec: 'Aztec tradition',
  blackfoot: 'Blackfoot tradition, North American Great Plains',
  boorong: 'Boorong people, Aboriginal Australia',
  bugis: 'Bugis sailors of Sulawesi, Indonesia',
  chinese: 'traditional Chinese astronomy',
  egyptian: 'late ancient Egyptian astronomy',
  hawaiian_starlines: 'Hawaiian star lines, used by the Polynesian Voyaging Society',
  indian: 'Indian astronomy',
  inuit: 'Inuit astronomy',
  japanese_moon_stations: 'the Japanese moon stations',
  korean: 'traditional Korean astronomy',
  lokono: 'Lokono (Arawak) people of the Guianas',
  mandar: 'Mandar sailors of Sulawesi, Indonesia',
  maori: 'Māori tradition',
  mongolian: 'Mongolian tradition',
  navajo: 'Navajo (Diné) astronomy',
  northern_andes: 'peoples of the northern Andes',
  sami: 'Sámi tradition',
  tongan: 'Tonga',
  tukano: 'Tukano people of the north-west Amazon',
  tupi: 'Tupi-Guarani peoples of South America',
};

const raw = (path) => `https://raw.githubusercontent.com/${REPO}/${COMMIT}/${path}`;
async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

rmSync(OUT, { recursive: true, force: true });
const manifest = [];
const wanted = new Set();
for (const [id, from] of Object.entries(CULTURES)) {
  const index = await get(raw(`${id}/index.json`));
  const description = await get(raw(`${id}/description.md`));
  mkdirSync(`${OUT}/${id}`, { recursive: true });
  // Written byte for byte as fetched.
  writeFileSync(`${OUT}/${id}/index.json`, index);
  writeFileSync(`${OUT}/${id}/description.md`, description);
  // The whole licence section: some cultures license text, lines and illustrations separately.
  const license = (description.match(/## License\s+([\s\S]*?)(\n## |$)/)?.[1] ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' · ');
  if (!license) throw new Error(`${id}: no licence stated`);
  manifest.push({ id, from, license, source: `https://github.com/${REPO}/blob/${COMMIT}/${id}/description.md` });
  for (const con of JSON.parse(index).constellations ?? []) {
    for (const path of con.lines ?? []) for (const v of path) if (typeof v === 'number') wanted.add(v);
  }
  console.log(`${id}: ${license}`);
}
writeFileSync(`${OUT}/cultures.json`, JSON.stringify(manifest, null, 1) + '\n');

console.log('Fetching star positions…');
const lines = (await get(HYG)).split('\n');
const head = lines[0].split(',').map((h) => h.replace(/"/g, ''));
const [iHip, iRa, iDec] = ['hip', 'ra', 'dec'].map((h) => head.indexOf(h));
if (iHip < 0 || iRa < 0 || iDec < 0) throw new Error('Unexpected star catalogue columns');
const stars = {};
for (const line of lines.slice(1)) {
  const f = line.split(',');
  const hip = Number(f[iHip]);
  // Right ascension converted from hours to degrees; declination is already in degrees.
  if (f[iHip] && wanted.has(hip)) stars[hip] = [Math.round(Number(f[iRa]) * 15 * 1e4) / 1e4, Math.round(Number(f[iDec]) * 1e4) / 1e4];
}
writeFileSync(
  `${OUT}/stars.json`,
  JSON.stringify({
    credit: 'Star positions (Hipparcos number -> right ascension, declination in degrees) from the HYG database, https://github.com/astronexus/HYG-Database, CC BY-SA 4.0. This file is licensed CC BY-SA 4.0.',
    stars,
  }) + '\n',
);

writeFileSync(
  `${OUT}/README.md`,
  `# Sky cultures

Each folder here is a sky culture from the Stellarium sky cultures collection
(https://github.com/${REPO}, commit ${COMMIT}), copied without changes.
Each is a separate work under its own licence, stated in its \`description.md\`
together with its authors and references:

${manifest.map((m) => `- \`${m.id}\`: ${m.license}`).join('\n')}

\`stars.json\` is an extract of the HYG database (CC BY-SA 4.0).

Regenerate with \`npm run sky\`.
`,
);
console.log(`${manifest.length} cultures, ${Object.keys(stars).length} of ${wanted.size} stars. Wrote ${OUT}/`);
