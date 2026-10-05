# Notes on the cubiomes End City differences

[Back to the README](../README.md) · written 4 October 2026, for review before anything is sent upstream.

## Short version

- The app's End City layout code was ported from [cubiomes](https://github.com/Cubitect/cubiomes) at `e61f905` (10 November 2024). That is still the newest version; there is nothing newer to move to.
- cubiomes gets some End ships wrong. We found this from a missing ship on the server and confirmed it with 16 checks in a single-player world.
- **The same problems are already reported upstream**, by someone else, a year before we found them: cubiomes issue 155, "Issues in End City Piece Generation" (`https://github.com/Cubitect/cubiomes/issues/155`), opened 2 October 2025, still open, no replies.
- So there is no new bug to report. The only thing we could add upstream is our in-game evidence that the report is right.

## What the upstream report says, and where we stand on each point

| # | Upstream report | In the app | Our evidence |
|---|---|---|---|
| 1 | In `genTower`, bridges are attached to `base` (the tower's top piece) when they should be attached to `floor` (the floor the tower picked) | Fixed | Strong. Found independently. 11 cities checked in game, all match the fix; 8 of them are wrong without it. |
| 2 | In `genBridge`, the ship is assigned to `base`, so the bridge's final end piece hangs off the ship when it should hang off the last bridge piece | Fixed, following the report | Two cities checked in game where it changes the answer, one each way; both match the fix. |
| 3 | `Piece.depth` is 8 bits, where the game uses a full int | Fixed (this one was already fixed in the app on 3 October) | Reasoning only: 4 cities in the webmap area differ, none visited. |

All three are in [`scripts/reference/cubiomes-fixes.patch`](../scripts/reference/cubiomes-fixes.patch), three changed lines in total.

One more difference is ours alone and is **not a cubiomes bug**: the game builds nothing more than 8 chunks from a structure's starting chunk, so some ships are cut off or missing. cubiomes lists a structure's pieces and makes no claim about what gets placed. Three cities checked in game, all match.

## How much each one matters (server seed, within 100,000 blocks, 34,409 cities)

| Correction | Ships lost | Ships gained |
|---|---|---|
| 1. Bridges from the chosen floor | 39 | 64 |
| 8-chunk reach (ours) | 157 | 0 |
| 2. Ship not taken as the bridge's last piece | 31 | 2 |
| All together | 225 | 64 |