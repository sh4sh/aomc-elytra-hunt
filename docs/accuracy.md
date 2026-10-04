# How do we know the positions are right?

[Back to the README](../README.md)

The app does not look End Cities up anywhere. It works them out from the world
seed, using the same steps the game does, in code ported from
[cubiomes](https://github.com/Cubitect/cubiomes), an open-source C library that
reimplements Minecraft's world generation. Three things have to be right for a
city to show up in a route.

**1. Where a city can be.** The End is divided into regions of 20 by 20 chunks.
Each region has one candidate chunk, chosen from the seed. (cubiomes:
`getStructurePos` and the End City entry in `finders.c`.)

**2. Whether a city actually generates there.** The candidate must be in the
End midlands or highlands, and the ground under the city must be at least
y = 60, which depends on the island shapes, the terrain noise and which way the
city is rotated. (cubiomes: `isViableStructurePos`, `isViableEndCityTerrain`,
and `getEndHeightNoise` / `sampleNoiseColumnEnd` in `biomenoise.c`.)

**3. Whether it has a ship.** Elytra only generate in End ships, and not every
city has one. The app builds each city's layout piece by piece and checks
whether a ship is part of it. (cubiomes: `getEndCityPieces`.)

## What it was checked against

The app's results were compared with cubiomes (version
`e61f905`, Minecraft 1.21 rules) city by city:

| Area | Seed | End Cities | Result |
|---|---|---|---|
| Within about 22,400 blocks of 0,0 | the server's | 1,735 | positions and ships identical |
| Within about 12,800 blocks of 0,0 | two unrelated seeds | 593 and 594 | positions and ships identical |
| Around 96,000 blocks out | the server's | 39 | positions and ships identical |
| Everything the community webmap covers, out to about 600,000 blocks west | the server's | 36,419 | positions identical; ships identical except 4 cities, explained below |

The first three, and a strip from the far end of the last, are kept as
automated tests (`npm test`), so a change that breaks the maths is caught.

## Where the app and cubiomes differ

- **Four ships.** cubiomes stores one internal value (a tag used to decide
  whether overlapping pieces of a city are allowed) in 8 bits, where the game
  uses a full 32-bit number. In 4 of the 36,419 cities above that shortcut lets
  a ship through that the game would reject. The app keeps the full number, and
  agrees with cubiomes on all 36,419 once cubiomes is built with the same
  width. Those cities are at x: -246328, z: -21064; x: -526984, z: 9000;
  x: -211720, z: 22456; and x: -305848, z: 27528. The app says they have no
  ship. This rests on reading how the game stores that value, not on visiting
  them.
- **Rounding.** Far from 0,0, a few results depend on doing arithmetic in
  32-bit floats exactly as Java does. cubiomes has to be built with
  `-ffp-contract=off` to match; the app rounds explicitly.

## A ship that wasn't there

One city so far has been found in game with no ship where the app, and cubiomes,
both say there is one: x: -554792, z: 8712. The city itself was there.

**We do not know why.** What we can say:

- In the layout the app computes for that city, the ship sits directly above
  another part of the city (a tower top) with 3 blocks of clearance. That is
  unusual: about 0.3% of ships are within 4 blocks of another part.
- The game discards a ship if it overlaps another part of the city. The piece
  sizes used by cubiomes, and so by the app, are simplified. One possible
  explanation is that the game saw an overlap there that this code does not.
- That is a guess from a single case. It has not been tested against the
  game's own code, and the real cause could be something else entirely.

What the app does about it, as a precaution and not as a fix:

- That city is recorded as having no ship. It stays on the map as a grey ×
  labelled "End Ship reported missing", and is left out of routes.
- Every ship within 4 blocks of another part of its city is marked **ship
  uncertain** (a `?` in the route, and a note when you hover over it). These
  cities stay in the routes. The mark means "we have one reason to doubt this
  kind of ship", not "this ship is probably missing". Most of them may be fine.
- Right-click a city to report that its ship was there, that the city had no
  ship, or that there was no End City there at all.
  Reports are reviewed before they change anything; enough of them would show
  whether the doubt is justified, and the mark would be removed or widened to
  match.

## What has not been proven

- **Minecraft 26.x.** The comparison is against cubiomes' 1.21 rules. Nothing
  is known to have changed in End generation since, but that has not been
  confirmed beyond a handful of in-game checks on the server, including one
  city the app correctly reported as having no ship (x: -1208, z: 10312).
- **Beyond the webmap's area.** The same code runs further out, and it accounts
  for the rings of empty void the End has beyond about 370,000 blocks, but
  nothing past roughly 600,000 blocks has been compared.
- **Every ship.** See "A ship that wasn't there" above: at least one predicted
  ship did not exist in game, for a reason that is not understood.
- **Looted or not.** The app knows where ships generate, not whether someone
  has already taken the elytra.

## Checking it yourself

[`scripts/reference/end-cities-ref.c`](../scripts/reference/end-cities-ref.c) is the small program used to get cubiomes'
answers; build instructions are at the top of the file. It prints
`chunkX chunkZ hasShip` for every city in a range of regions, which can be
compared with what the app finds for the same area. A city's block coordinates
are its chunk coordinates times 16, plus 8.

## Sources

- [cubiomes](https://github.com/Cubitect/cubiomes) by Cubitect, MIT licence:
  the reference implementation the generator was ported from and tested
  against.
- [End City](https://minecraft.wiki/w/End_City) and
  [Elytra](https://minecraft.wiki/w/Elytra) on the Minecraft Wiki, for how
  cities, ships and elytra work in the game.
- The tests in `tests/end-cities.test.ts` and the reference data in
  `tests/fixtures/`.
