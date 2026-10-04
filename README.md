# AOMC Elytra Hunt

Find Elytra on the About Oliver Minecraft Server.

**Use it here: https://sh4sh.github.io/aomc-elytra-hunt/**

A web app for hunting elytra on a Minecraft Java server. It works out where
every End City is from the world seed, keeps the ones that have a ship, and
groups them into routes that you can load into Xaero's Minimap, JourneyMap,
or another map mod as waypoints.

## Using it

The same steps are in the app under **How to use**.

1. **Pick a route.** Routes are in the route list, numbered outward from 0,0.
   Pick one there, select any city on the map, or type your position into the
   x and z boxes on the map and press **Nearest route**. **Go to route #** jumps to a route by number.
2. **Get the waypoints into your map mod.** With a route open, choose one:
   - **Xaero's Minimap:** press **Copy waypoints**, close Minecraft, and paste
     at the end of the waypoint file in
     `.minecraft/xaero/minimap/<your server>/dim%1/`. Back that file up first.
     If the folder has no waypoint file yet, use **Download one** instead.
     Or, without closing Minecraft, add them through chat: enter your username
     and press the copy button once per line, pasting each into chat while in
     the End. Xaero's Minimap shows each as a shared waypoint with an Add
     button.
   - **JourneyMap / Other:** enter your username, then press the copy button
     once per line, pasting each into chat while in the End (Minecraft's chat
     takes one message at a time). They are whispers
     to yourself, and JourneyMap makes each one clickable. If you also have
     Xaero's waypoints for the server, JourneyMap's Waypoint Manager can import
     them with **Import External**. Other map mods that read coordinates from
     chat may pick the lines up too; that is untested.
3. **Tick cities off as you loot them**, with the checkboxes in the route or by
   right-clicking a city on the map or in the route's list. Looted cities are left out of exports.
4. **Share where you have been.** The best way is to upload your map of the End
   to the [community webmap](https://map.diorite.xyz/?dim=the_end) with its
   upload button: areas on the webmap are left out of the routes
   once the app's webmap data is refreshed. Your looted ticks are saved in your
   browser only; you can also send them in from **Share progress**, and once
   accepted those cities show as looted for all players. Or send the exported
   file to a friend, who can **Import looted**.

### Changing the search

**Search settings** (fold it open) controls which cities are
considered and how they are grouped:

- **Near End Spawn / Near my coordinates:** search a band around the centre of the
  End, or a circle of a chosen radius around coordinates you enter.
- **From / To:** how far from 0,0 to look, measured along the longer axis. A search
  covering more than 25,000 cities is refused with a prompt to narrow it.
- **Quadrants:** which quarters of the map to search.
- **Cities per route:** 27 fills one shulker box; anything from 1 to 500 works.
- **Route shape:** compact clusters, or lines heading outward. For lines you can also set
  how far a line may stray to either side of straight.
- **Longest flight between cities:** no hop inside a route is longer than this.
  Cities that can't be reached in a full route are left without a route. If no route of the
  chosen size fits at all, smaller routes are made, down to 2 cities.
- **Advanced → Angle:** stay near the diagonals or near the axes, or search
  every direction (the default).
- **Advanced → Include cities already on the webmap:** cities in areas on the
  community webmap are normally left out of the routes, since someone has been
  there. Tick this to route them anyway.
- **Advanced → World seed:** for using the app with another world. Everything
  specific to the About Oliver server (the webmap filter and shading, the shared
  looted list and submitting to it) is hidden for other seeds.

Only cities with a ship are ever shown, since only ships hold elytra.

### On the map

- Filled dots are cities in a route, coloured by route.
- An × is a looted city, or one where a player reported the ship or the whole
  city missing; hover over it to see which.
- An amber ×, and a `!` after a city's coordinates in a route, is a city a
  player found already looted by someone else.
- A hollow dot, and a `?` after a city's coordinates in a route, means the city
  is possibly looted: it is within 2,000 blocks of a city a player found
  already looted, so an earlier hunt probably passed through. It is a guess. The flag is
  lifted when a city between the two (within 500 blocks of the straight line
  joining them) has been looted the ordinary way: the earlier hunter did not
  come that way.
  When you arrive to an empty ship, right-click the city and choose **Mark as
  found already looted**; these marks are sent along with **Share progress**.
  **Leave out cities that are possibly looted** keeps them out of the routes.
- A dashed amber line is a possible earlier flight path: a guess at where a
  previous hunter flew, drawn when three or more cities found already looted
  lie in a line (within 4,000 blocks of one another, and not straying from the
  line by more than a fifth of its length). It is carried on 2,000 blocks past
  each end, and cities within 1,000 blocks of it count as possibly looted. Its
  label states the confidence: **medium** for three or four cities, **high**
  for five or more. One city found intact (looted the ordinary way) within 1,000 blocks
  of the line is ignored, since any hunter can miss one. Two or more lower the
  confidence a step, and the line is dropped if that takes it below medium or
  the intact cities number half the already-looted ones. These levels are rules of thumb, not measured probabilities.
- A `?` can also mean the city's ship is uncertain (see "How do we know the
  positions are right?" below). Hover over the city to see which it is.
  Right-click a city to report whether its ship was there.
- A small faint diamond is a city with a ship that is not in any route.
  Right-click it to add it to the route you have open.
- Green shading is terrain already on the community webmap.
- Drag to pan; scroll or use the slider to zoom. On a touch screen, use two
  fingers to move the map and pinch to zoom; one finger scrolls the page. On a wide screen, drag the
  dividers either side of the map to resize the panels.
- Right-click a city for options; on a touch screen, press and hold.

Right-click a city (on the map or in the route's list) and choose **Remove
from route** to take it out; it stays on the map as a faint diamond, and
**Put back in its route** on the same menu returns it.

**+1 city**, in an open route, adds the city nearest the route's last stop that
is not in any route, as the new last stop. It also looks up to 4,000 blocks
from that last stop, past the edge of the search area, and takes a city from
there if that one is closer (2,500 blocks with another seed or beyond 100,000
blocks out, where cities are generated on the spot). 

Cities added to a route by hand, with **+1 city** or **Add to route**, go at the
end of it. To change a route's order, drag a city up or down its list, or
right-click it and choose **Move up** or **Move down**. The **↶** button takes
back the latest change to the open route, whether a city added or a change of
order. **Original order** puts the route back in the order it was worked out
in; cities you added stay, at the end.

**Rebuild routes without looted** regroups the remaining cities into fresh routes
once some have been looted.

**Custom routes:** right-click any city and choose **Start a custom route with
this city**, then right-click others to add them to it. Custom routes are listed
above the generated ones and export the same way.

## Things to know

- For Minecraft **Java Edition**, not Bedrock. The generator follows the
  1.19–1.21 world generation rules and is in use on a 26.2 server. Worlds from
  before 1.19 place some cities differently.
- Positions and ships are checked against [cubiomes](https://github.com/Cubitect/cubiomes)
  using Minecraft 1.21 rules. If a later version changes End generation, results
  may be off; spot-check a city before a long trip.
- "On the webmap" means someone's client loaded those chunks, not that the ship
  was looted.
- With a longest flight set, only full routes are made, and cities that can't
  be reached that way stay without a route.

<details>
<summary><strong>How do we know the positions are right?</strong></summary>

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

### What it was checked against

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

### Where the app and cubiomes differ

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

### A ship that wasn't there

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

### What has not been proven

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

### Checking it yourself

`scripts/reference/end-cities-ref.c` is the small program used to get cubiomes'
answers; build instructions are at the top of the file. It prints
`chunkX chunkZ hasShip` for every city in a range of regions, which can be
compared with what the app finds for the same area. A city's block coordinates
are its chunk coordinates times 16, plus 8.

### Sources

- [cubiomes](https://github.com/Cubitect/cubiomes) by Cubitect, MIT licence:
  the reference implementation the generator was ported from and tested
  against.
- [End City](https://minecraft.wiki/w/End_City) and
  [Elytra](https://minecraft.wiki/w/Elytra) on the Minecraft Wiki, for how
  cities, ships and elytra work in the game.
- The tests in `tests/end-cities.test.ts` and the reference data in
  `tests/fixtures/`.

</details>

## Development

```
npm install
npm run dev        # run locally
npm test           # run the tests
npm run build      # build the static site into dist/
```

Data files, regenerate when needed:

```
npm run precompute # public/cities.json: every End City for the seed, out to 100,000 blocks
npm run explored   # public/explored.json: areas already on the webmap (also runs hourly on GitHub)
npm run sky        # public/skycultures/: sky cultures for the constellation easter egg
npm run looted -- file.csv   # add a player's exported looted cities to public/looted.json
```

`public/looted.json` is the shared looted list every visitor gets. Submissions
from the app arrive as GitHub issues; replying `/merge` on one adds it to the
list and republishes the site. For a file a player sends you directly, run
`npm run looted` on it, then commit and push.

`relay/` is a small Cloudflare Worker that lets players send things from the
app without a GitHub account (their looted cities, and reports on whether a
ship was there); it files each one as an issue, which `/merge` accepts.
`public/ship-reports.json` holds the accepted ship reports. Setup and handling are in [relay/README.md](relay/README.md).

It is a static site: TypeScript, no framework, no backend. Pushing to `main`
builds and publishes it to GitHub Pages.

## Credits

Built with Claude Code.

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
