# Design rules

[Back to the README](../README.md)

How the app's interface is put together. Before adding something, find the
pattern below that fits and reuse it. If nothing fits, add the new pattern here
in the same change, so there is still only one way to do each thing.

## Layout

- **Collapsible sections:** a plain `<details>`. It gets a rule above and a
  bold title; while open, a rule below shows where it ends. No outlines or
  bars. The base `details` and `summary` styles do all of this: do not restyle
  a section by id. A section inside another is
  indented, with a lighter title, so the levels are told apart.
- **Groups of settings:** each group is its own collapsible section, named
  for what uses it, with a one-line hint saying so. Groups are equals: none is
  left permanently open above the others.
- **Cards:** a bordered box is for a choice between ways of doing something
  (as in Share progress). The recommended one has the accent border, the
  others a plain one.
- **Spacing:** containers space their children with `gap: 8px`. Do not add
  margins on top of it.
- **Fields:** stacked by default. Put two in a `.row` to share a line.
- **Buttons in a group:** two even columns, not a ragged wrap.

## Emphasis

- **Accent colour:** one thing per panel, the action or card a newcomer should
  pick. Everything else is neutral, and turns accent on hover.
- **Fields and buttons:** a field is sunk into the panel (the page's dark
  background); a button stands out from it (lighter). The panel's main action
  is outlined in the accent colour over a faint wash of it, never a solid
  block.
- **Destructive actions:** `button.danger`, on a line of its own under a rule,
  with a hint saying what is lost. Its confirmation says it cannot be undone.
- **Colours:** only the variables at the top of `src/style.css`.

## Words

- **Hints:** one short sentence under the thing it explains. Say what happens,
  not how it works.
- **Titles:** a few plain words.
- **One name per thing:** a button is called the same in the app, the help and
  the guide.

## Features

- **One way to do each thing.** If a new control repeats an existing one,
  remove the old one or do not add the new one.
- **Rare settings** go under Advanced. Tools for working on the app go under
  Dev mode, and are not documented for players.
- **When a control is added, renamed or removed,** update the in-app help
  (`index.html`) and `docs/guide.md` in the same change.
