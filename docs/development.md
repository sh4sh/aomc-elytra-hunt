# Development

[Back to the README](../README.md)

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
list and republishes the site. The submitter's username, if they gave one, is
kept with their cities and shown on the map; reply `/merge anonymous` to leave
it off. For a file a player sends you directly, run
`npm run looted` on it, then commit and push.

`relay/` is a small Cloudflare Worker that lets players send things from the
app without a GitHub account (their looted cities, and reports on whether a
ship was there); it files each one as an issue, which `/merge` accepts.
`public/ship-reports.json` holds the accepted ship reports. Setup and handling are in [relay/README.md](../relay/README.md).

## Where things are

The page is `index.html` and `src/style.css`. The code behind it is in `src/`:

| File | What it holds |
|---|---|
| `main.ts` | Start-up: loads the data, then draws the page. Also the goose |
| `state.ts` | What is remembered between visits (search, settings, hand-made route changes) |
| `session.ts` | What is held for this visit only (the routes, what is open, loaded data) |
| `search.ts` | The two search buttons, the coordinate boxes, and applying a search |
| `routes.ts` | Working out the routes, "possibly looted", and undo for changes made by hand |
| `render.ts` | Drawing the route list, the open route and the map from the session |
| `route-panel.ts` | The open route's buttons: map-mod lines, ticking ships off, adding and reordering |
| `map-actions.ts` | Hovering and clicking the map, and the right-click menu |
| `settings.ts` | Route options, the webmap, the world seed, restoring defaults |
| `submissions.ts` | Ship reports and looted lists sent to the relay |
| `export-areas.ts` | The rectangle to export from Xaero for the webmap after a route |
| `dev-mode.ts`, `survey.ts` | Dev mode and its survey |
| `map.ts`, `map-view.ts` | The map's drawing code, and the one map on the page |
| `filters.ts`, `trajectory.ts`, `tracker.ts` | Route maths, flight-path guesses, looted marks |
| `generation/` | Where End Cities and ships generate, from the seed |
| `xaero.ts`, `journeymap.ts` | Waypoint formats |
| `dom.ts`, `constants.ts` | Small helpers and fixed numbers |

Several of these files import each other. That is fine as long as a file only
uses another's functions when something happens (a click, a finished search),
not while the page is first loading; anything needed at load time belongs in
`constants.ts`, `state.ts`, `session.ts` or `map-view.ts`, which import none
of the others.

It is a static site: TypeScript, no framework, no backend. Pushing to `main`
builds and publishes it to GitHub Pages.
