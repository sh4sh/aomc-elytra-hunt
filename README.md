# End City Runs

A web app for hunting elytra on a Minecraft Java server. It works out where
every End City is from the world seed, keeps the ones that have a ship, and
groups them into batches of 27 (one shulker box of loot per run) that you can
load into Xaero's Minimap as waypoints.

## Using it

1. Set how far out to search and how close to the diagonals to stay. Cities
   that are already on the community webmap are left out.
2. Pick a batch from the list, or type your position and press **Nearest batch**.
3. Press **Download waypoints**, close Minecraft, and paste the lines at the end
   of the waypoint file in `.minecraft/xaero/minimap/<your server>/dim%1/`.
   Back that file up first.
4. Tick cities off as you loot them. Right-click a city on the map to mark it,
   or to add it to the batch you have open.

Progress is saved in your browser. **Share progress** exports it as a file that
others can import.

On the map, filled dots are cities in a batch, an × is a looted city, a small
faint diamond is a city that is not in any batch, and green shading is terrain
already on the webmap.

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
```

It is a static site: TypeScript, no framework, no backend. Pushing to `main`
builds and publishes it to GitHub Pages.

## Credits

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
