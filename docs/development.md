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
list and republishes the site. For a file a player sends you directly, run
`npm run looted` on it, then commit and push.

`relay/` is a small Cloudflare Worker that lets players send things from the
app without a GitHub account (their looted cities, and reports on whether a
ship was there); it files each one as an issue, which `/merge` accepts.
`public/ship-reports.json` holds the accepted ship reports. Setup and handling are in [relay/README.md](../relay/README.md).

It is a static site: TypeScript, no framework, no backend. Pushing to `main`
builds and publishes it to GitHub Pages.
