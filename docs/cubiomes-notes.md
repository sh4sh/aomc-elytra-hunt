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

## Things a person should check before saying anything upstream

1. **Read the game's own code.** Everything here rests on in-game checks and on recollection of the game's logic, not on reading it. Someone with a decompiled copy of `EndCityPieces` can confirm points 1 and 2 in a few minutes: which piece the tower's bridges are added to, and whether the ship is assigned to the variable the final `bridge_end` is added from.
2. **Point 2 in game: done.** x: 26008, z: -53384 has no ship and x: -37752, z: -26824 has a full one, as the fix predicts and published cubiomes does not.
3. **Decide whether to say anything at all.** The report exists. A comment there with our table of in-game results would support it; it is not needed for the app.

## What we would add, if anything

A short comment on the existing issue, not a new one:

> We hit point 1 independently while predicting End ships for a server (seed 856461443495910397, Java 26.2). In a single-player copy of the world, 8 cities where published cubiomes reports a ship have none, and all 11 cities we checked match once bridges are attached to `floor`. Table and coordinates: (link to docs/accuracy.md).

Nothing has been posted upstream. Note that a clickable link to the upstream issue from one of this repository's issues shows up on the upstream issue as a mention, so the links here and in our issues are written as plain text.

## Where the details are

- [accuracy.md](accuracy.md): the full table of in-game checks and what is still unproven.
- Issue #11 in this repository: the single-player check, with results.
- `tests/end-cities.test.ts`: the checked cities as automated tests.
