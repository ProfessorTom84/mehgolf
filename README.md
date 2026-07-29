# Meh Golf

A pencil-and-paper style golf game for the browser. Seeded courses, rolling dice, local pass-and-play multiplayer, synthesized sound, and a one-click printable PDF — all in a single static site with zero dependencies.

## Run it

```bash
docker build -t meh-golf .
docker run -d -p 8080:80 --name meh-golf meh-golf
# open http://localhost:8080
```

No build step, no npm, no CDN calls. You can also just open `index.html` directly in a browser for local testing.

## Features

- **Shot history** — a running log beside the board records every shot: the die face, the terrain modifier, distance, direction, and where the ball ended up. In multiplayer each line is tagged with the player's name and color.
- **Legend & scorecard** — always visible beside the board, no pop-ups: the map key sits under the shot history, the live scorecard under the turn card.
- **Breeze** — trees sway and water shimmers, each on its own seeded phase (disabled under `prefers-reduced-motion`).
- **Seeded courses** — the numeric seed code deterministically generates all 18 holes (terrain, slopes, even where the bigfoot hides). Share a seed to play identical courses on different machines.
- **Two rule sets** — Dice golf (roll a d6; fairway +1, sand −1) and Speed golf (driver 6 / iron 3 / putter 1).
- **Local multiplayer** — 1–4 players, pass-and-play. Solo uses the pocket 14×20 grid; 2+ players get the XL 18×26 grid. After tee-off, the player furthest from the cup always shoots next.
- **Physical dice** — a CSS-3D die tumbles and bounces across the notebook page with clatter sounds, then settles on the result.
- **Terrain rules** — fairway, rough, sand, water, trees (pines and broadleafs), chained slope arrows, exact-landing or overshoot-by-one sinking, tee re-rolls, and 6 mulligans per player per course.
- **Print & play PDF** — downloads a hand-built vector PDF (US Letter), **one hole per page** so each map is full size, and page 1 is always an illustrated how-to-play plus map key so a printed pack is playable on its own. No PDF library; the file is emitted byte-by-byte.
- **All-synthesized audio** — every sound effect is generated with the Web Audio API at runtime; there are no asset files anywhere in the project.

## Project layout

```
index.html        app shell (menu, game screen, modals)
css/style.css     paper-notebook aesthetic, dice cube, layout
js/rng.js         xmur3 + mulberry32 seeded PRNG
js/course.js      deterministic hole generation + solvability check
js/game.js        turn machine, SVG board rendering, UI
js/dice.js        3D tumbling dice animation
js/audio.js       synthesized SFX
js/pdf.js         raw vector PDF writer
Dockerfile        nginx static server
```

## House rules encoded

Par is 6 on every hole. A ball may fly over water but never land in it; trees block shots unless struck from the fairway (or with a driver). Slope arrows roll the ball one dot and chain until open ground — unless they point into trouble, in which case the ball stays put. Landing exactly on the cup sinks it, as does crossing the cup and stopping one dot past. Each player gets one free re-roll on every tee shot plus 6 mulligans per course. At 12 strokes the ball is picked up out of mercy. Spotting the hidden bigfoot (present in about a third of seeds) earns everyone a bonus mulligan.
