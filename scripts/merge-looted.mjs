// Adds looted cities to public/looted.json, the list every visitor gets.
//
//   npm run looted -- someone-looted.csv another.csv
//   npm run looted -- --issue 12
//
// Each file is a "looted" export from the app (rows of x,z,visited_at). With
// --issue, the rows are read from that GitHub issue instead, as filed by the
// relay in relay/. Cities already on the list are kept. Commit and push the
// result to publish it.

import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'public/looted.json';
const REPO = 'sh4sh/aomc-elytra-hunt';
const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage: npm run looted -- <exported csv> [more csv files]\n       npm run looted -- --issue <number>');
  process.exit(1);
}

/** [label, text] for each source named on the command line. */
const sources = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--issue') {
    const number = args[++i];
    const res = await fetch(`https://api.github.com/repos/${REPO}/issues/${number}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'aomc-merge-looted',
        // Signed in when a token is around (as in GitHub Actions), which avoids the anonymous request limit.
        ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`Issue ${number}: HTTP ${res.status}`);
    sources.push([`issue ${number}`, (await res.json()).body ?? '']);
  } else {
    sources.push([args[i], readFileSync(args[i], 'utf8')]);
  }
}

const list = JSON.parse(readFileSync(FILE, 'utf8'));
const cities = new Set(list.cities);
// Cities a player found already looted by someone else: the app warns about the cities around them.
const already = new Set(list.alreadyLooted ?? []);
const before = cities.size;
for (const [file, text] of sources) {
  let rows = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(-?\d+)\s*,\s*(-?\d+)\s*(?:,\s*(already)\s*$)?/);
    if (!m) continue; // Header or blank line.
    cities.add(`${Number(m[1])},${Number(m[2])}`);
    if (m[3]) already.add(`${Number(m[1])},${Number(m[2])}`);
    rows++;
  }
  console.log(`${file}: ${rows} cities`);
}

const byPosition = (a, b) => {
  const [ax, az] = a.split(',').map(Number);
  const [bx, bz] = b.split(',').map(Number);
  return ax - bx || az - bz;
};
const sorted = [...cities].sort(byPosition);
writeFileSync(
  FILE,
  JSON.stringify({ updatedAt: new Date().toISOString(), cities: sorted, alreadyLooted: [...already].sort(byPosition) }) + '\n',
);
if (already.size) console.log(`${already.size} found already looted.`);
console.log(`${cities.size - before} new, ${cities.size} on the shared list. Wrote ${FILE}`);
