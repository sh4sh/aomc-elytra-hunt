# AOMC Elytra Hunt

Find Elytra on the About Oliver Minecraft Server.

**Use it here: https://sh4sh.github.io/aomc-elytra-hunt/**

A web app for hunting elytra on a Minecraft Java server. It works out where
every End City is from the world seed, keeps the ones that have a ship, and
groups them into batches that you can load into Xaero's Minimap, JourneyMap,
or another map mod as waypoints.

## Using it

The same steps are in the app under **How to use**.

1. **Pick a batch.** Batches are in the batch list, numbered outward from 0,0.
   Pick one there, select any city on the map, or type your position into the
   box on the map and press **Nearest batch**. **Go to batch #** jumps to a batch by number.
2. **Get the waypoints into your map mod.** With a batch open, choose one:
   - **Xaero's Minimap:** press **Download waypoints**, close Minecraft, and
     paste the lines at the end of the waypoint file in
     `.minecraft/xaero/minimap/<your server>/dim%1/`. Back that file up first.
   - **JourneyMap / Other:** enter your username, press **Copy all chat lines**,
     and paste them into chat one at a time while in the End. They are whispers
     to yourself, and JourneyMap makes each one clickable. If you also have
     Xaero's waypoints for the server, JourneyMap's Waypoint Manager can import
     them with **Import External**. Other map mods that read coordinates from
     chat may pick the lines up too; that is untested.
3. **Tick cities off as you loot them**, with the checkboxes in the batch or by
   right-clicking a city on the map. Looted cities are left out of exports.
4. **Share what you looted.** Your ticks are saved in your browser only. To mark
   them for everyone, open **Share progress** and send them in (or, until the
   submit button is switched on, press **Export looted** and attach the file to
   a [GitHub issue](https://github.com/sh4sh/aomc-elytra-hunt/issues)). Once
   accepted onto the shared list, those cities show as looted for all players.
   You can also send the file to a friend, who can **Import looted**.

### Changing the search

**Search settings** (fold it open) controls which cities are
considered and how they are grouped:

- **Out from 0,0 / Around a position:** search a band around the centre of the
  End, or a circle of a chosen radius around coordinates you enter.
- **From / To:** how far from 0,0 to look, measured along the longer axis. A search
  covering more than 25,000 cities is refused with a prompt to narrow it.
- **Quadrants:** which quarters of the map to search.
- **Cities per batch:** 27 fills one shulker box.
- **Batch shape:** compact clusters, or lines heading outward. For lines you can also set
  how far a line may stray to either side of straight.
- **Longest flight between cities:** no hop inside a batch is longer than this.
  Cities that can't be reached in a full batch are left unbatched.
- **Leave out cities already on the webmap.**
- **Advanced → Angle:** stay near the diagonals or near the axes, or search
  every direction (the default).
- **Advanced → World seed:** for using the app with another world. Everything
  specific to the About Oliver server (the webmap filter and shading, the shared
  looted list and submitting to it) is hidden for other seeds.

Only cities with a ship are ever shown, since only ships hold elytra.

### On the map

- Filled dots are cities in a batch, coloured by batch.
- An × is a looted city.
- A small faint diamond is a city with a ship that is not in any batch.
  Right-click it to add it to the batch you have open.
- Green shading is terrain already on the community webmap.
- Drag to pan; scroll, pinch or use the slider to zoom. On a wide screen, drag the
  dividers either side of the map to resize the panels.
- Right-click a city for options; on a touch screen, press and hold.

**Re-batch without looted** regroups the remaining cities into fresh batches
once some have been looted.

**Custom batches:** right-click any city and choose **Start a custom batch with
this city**, then right-click others to add them to it. Custom batches are listed
above the generated ones and export the same way.

## Things to know

- Positions and ships are checked against [cubiomes](https://github.com/Cubitect/cubiomes)
  using Minecraft 1.21 rules. If a later version changes End generation, results
  may be off; spot-check a city before a long trip.
- "On the webmap" means someone's client loaded those chunks, not that the ship
  was looted.
- With a longest flight set, only full batches are made, and cities that can't
  be reached that way stay unbatched.

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
npm run explored   # public/explored.json: areas already on the webmap
npm run sky        # public/skycultures/: sky cultures for the constellation easter egg
npm run looted -- file.csv   # add a player's exported looted cities to public/looted.json
```

`public/looted.json` is the shared looted list every visitor gets. When a player
sends an exported file, run `npm run looted` on it, then commit and push.

`relay/` is a small Cloudflare Worker that lets players submit their looted
cities from the app without a GitHub account; it files each submission as an
issue. Setup and handling are in [relay/README.md](relay/README.md).

It is a static site: TypeScript, no framework, no backend. Pushing to `main`
builds and publishes it to GitHub Pages.

## Credits

Built with Claude Code.

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
