# Guide

[Back to the README](../README.md)

Everything the app can do, in more detail than the quick start.

## Search settings

- **Near End Spawn / Near my coordinates:** search a band around 0,0, or a
  circle around coordinates you enter.
- **From / To:** how far from 0,0 to look, measured along the longer axis. A
  search covering more than 25,000 cities is refused with a prompt to narrow it.

**Fine tuning (optional)**, applied straight away:

- **Cities per route:** 27 fills one shulker box; 1 to 500 works.
- **Route shape:** compact clusters, or lines heading outward. For lines you can
  set how far a line may stray from straight.
- **Longest flight between cities:** no hop in a route is longer than this.
  Cities that can't be reached in a full route are left without a route. If no
  route of the chosen size fits, smaller ones are made, down to 2 cities.
- **Quadrants:** which quarters of the map to search (Near End Spawn only).
- **Leave out cities that are possibly looted.**

**Advanced:**

- **Angle:** stay near the diagonals or the axes, or search every direction.
- **Include cities already on the webmap:** normally left out, since someone
  has been there.
- **Move the map with one finger:** for touch screens. Normally two fingers
  move the map and one scrolls the page.
- **World seed:** for another world. Everything specific to the About Oliver
  server (webmap, shared looted list) is hidden for other seeds.

## Routes

Routes are ordered by total flying: from 0,0 (or your coordinates, in a search
near them) to the route's first city, plus the route itself.

### Getting a route into your map mod

- **Chat, one city at a time:** in the End, press **copy** beside a city, paste
  into chat and send. Xaero's Minimap shows a shared waypoint with an Add
  button; JourneyMap makes the coordinates clickable. With your username
  entered the lines are whispers only you see. A **copy** button stays lit once
  used.
- **Xaero's waypoint file, all at once:** open **Upload all at once, with the
  waypoint file**, press **Copy waypoints**, close Minecraft, and paste at the
  end of the file in `.minecraft/xaero/minimap/<your server>/dim%1/`. Back the
  file up first. No file there yet? Use **Download one**.
- **JourneyMap** can import Xaero's waypoints with **Import External**. Other
  mods that read coordinates from chat may work; that is untested.

### Working through a route

- **Next city** marks the city you are at as looted and moves on. **Looted by
  someone else** does the same when the elytra was already gone.
- The checkboxes, **Mark all looted** and **Clear all** work too.
- The undo and redo arrows cover looted marks, cities added and changes of
  order, for the open route.
- A finished route drops out of the list when you leave it, and the remaining
  cities are regrouped by themselves. This waits while another route is
  part-way through, so that one is never broken up.

### Changing a route

- **Add +1 city to route** adds the nearest city without a route to the end.
  It looks up to 4,000 blocks past the search area (2,500 with another seed or
  beyond 100,000 blocks out), and skips cities left out as on the webmap or
  possibly looted.
- Right-click a city for **Add to route**, **Remove from route** and **Put back
  in its route**.
- Drag a city up or down the list to reorder; on a touch screen use **Move up**
  and **Move down** from its **⋯** menu. **Original order** undoes reordering
  and keeps cities you added, at the end.
- **Custom routes:** right-click a city and choose **Start a custom route with
  this city**, then add others. They sit above the generated routes.

## Looted by someone else, and possibly looted

Mark a city **looted by someone else** when its elytra was gone before you got
there. These marks are sent with **Share progress**.

A city is **possibly looted** (a small grey ring on the map) when it is within
2,000 blocks of one of those. The flag is lifted if a city between the two (within 500 blocks of the line
joining them) was looted the ordinary way: the earlier hunter did not come that
way.

**Earlier flight path.** When three or more cities looted by someone else lie
in a line, a dashed tan line is drawn through them and 2,000 blocks past each
end. Cities within 1,000 blocks of it count as possibly looted.

- The cities must each be within 4,000 blocks of another, and stray from the
  line by no more than a fifth of its length.
- At least two must be cities a player marked as looted by someone else. Up to
  two cities on the community webmap can then count as well, if they sit on
  the same line within 4,000 blocks of a marked city. The webmap alone never
  makes a path: its players' flights are already known, and the guess is about
  hunters who did not share a map.
- Confidence is **medium** for three or four cities, **high** for five or more.
- One city found intact along the line is ignored. Two or more lower the
  confidence a step, and the line is dropped below medium, or when intact
  cities number half the already-looted ones.
- The line, the rings and the note about them only show once you zoom in
  (about 30,000 blocks across or closer). The `?` in a route's list always
  shows.
- These are rules of thumb, not measured probabilities.

## Sharing

- **Webmap:** areas on the [community webmap](https://map.diorite.xyz/?dim=the_end)
  are left out of the routes once the app's copy of it refreshes (hourly).
- **Looted list:** **Submit looted for everyone** sends your marks for review;
  once accepted they show as looted for all players. **Export looted** and
  **Import looted** move them between browsers or friends.
- **Reports:** right-click a city and choose **Report incorrect…** if it has no
  ship, there is no city, or a doubtful ship was there after all. Accepted
  reports apply to everyone.

## The map

- Drag to pan; scroll or use the slider to zoom. On a touch screen, two fingers
  move the map and one finger scrolls the page.
- On a wide screen, drag the dividers either side of the map to resize the
  panels; double-click one to reset it.
