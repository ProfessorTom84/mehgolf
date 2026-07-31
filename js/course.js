/* Deterministic course generation. A seed string produces the same 18 holes every time. */
(function (global) {
  "use strict";
  const { rngFor, pick, ri } = global.RNG;

  const T = { ROUGH: 0, FAIR: 1, SAND: 2, WATER: 3, TREE: 4 };
  const DIRS = [
    { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
    { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 }
  ];

  const SIZES = {
    pocket: { cols: 14, rows: 20, label: "Pocket 14\u00D720" },
    xl: { cols: 18, rows: 26, label: "XL 18\u00D726" }
  };

  const NAME_A = ["Great", "Misty", "Old", "Windy", "Quiet", "Broken", "Sleepy", "Hidden", "Crooked", "Sandy", "Foggy", "Lone", "Mossy", "Thorny", "Whistling", "Bent"];
  const NAME_B = ["River", "Pines", "Hollow", "Marsh", "Meadow", "Gulch", "Prairie", "Dunes", "Creek", "Ridge", "Thicket", "Knoll", "Fen", "Bluff", "Heath", "Glen"];

  function courseName(seed) {
    const r = rngFor(seed + "|name");
    return pick(r, NAME_A) + " " + pick(r, NAME_B);
  }

  /* A one-line history for a course that has never existed. Built from three
   * seeded fragments so the same code always tells the same story. */
  const BLURB_A = [
    "Laid out in 1931 by a man who had never played golf",
    "Built on the site of a failed sheep farm",
    "Designed over one long weekend and never revised",
    "Carved out of a wood that the locals still avoid",
    "Founded by two brothers who stopped speaking during construction",
    "Originally a racecourse, briefly",
    "Drawn up on the back of a menu and honoured ever since",
    "Opened to great excitement and immediately forgotten",
    "Planned by committee, which explains a great deal",
    "Built downhill from a reservoir, optimistically",
    "Established the year the river changed its mind",
    "Converted from an orchard nobody wanted",
    "Set out by a retired postman with a very long stride",
    "Reclaimed from marsh that has been quietly reclaiming it back",
    "Inherited, unwillingly, by the current owner",
    "Started as nine holes and doubled by accident",
    "Mapped by a surveyor who was, by his own admission, lost",
    "Occupies land three separate councils have disowned",
    "Assembled from two smaller courses that never got along",
    "Named after a horse"
  ];
  const BLURB_B = [
    "Famous for its stubborn bunkers",
    "Known chiefly for the wind",
    "Notable for having more water than the map suggests",
    "Remembered for one enormous tree",
    "Celebrated locally, tolerated regionally",
    "Best known for a green nobody can hold",
    "Respected for its fairways and feared for everything else",
    "Talked about mostly in the past tense",
    "Popular with people who enjoy walking",
    "Beloved by exactly the sort of person who would love it",
    "Renowned for a slope that has ended several friendships",
    "Distinguished by hedges of unusual determination",
    "Noted for excellent drainage in the wrong places",
    "Praised for its scenery by those not keeping score",
    "Recognised for a par nobody has verified",
    "Known for the quiet, which is not entirely natural"
  ];
  const BLURB_C = [
    "Bring a pencil and low expectations.",
    "The scorecard is a work of fiction by the third hole.",
    "Play it twice; the second round makes more sense.",
    "The members insist it is fair. The members are wrong.",
    "Nothing here is as far away as it looks.",
    "It rewards patience and punishes almost everything else.",
    "Locals recommend aiming somewhere else entirely.",
    "It has never once played the same way twice.",
    "Do not trust the flat bits.",
    "Every hole has a shortcut and every shortcut is a trap.",
    "The trees are closer together than they appear.",
    "It is a kind course, provided you keep your ambitions modest.",
    "Two hours of quiet walking, interrupted by golf.",
    "The bunkers are deeper than the architect intended.",
    "Somewhere out there is a par. Nobody has produced one yet.",
    "Wear sensible shoes and bring a spare ball."
  ];

  const BLURB_D = [
    "The signature hole is the seventh, for reasons nobody will explain",
    "The clubhouse is a shed with ambitions",
    "There is a bell on the twelfth. Ring it and someone will appear",
    "A former champion still walks the back nine, allegedly",
    "The course record has stood since 1968 and is widely disbelieved",
    "One bunker has never been raked and is now a listed feature",
    "The groundskeeper answers to no one",
    "Members speak of the fourth green only in whispers",
    "The scorecards are printed with a deliberate error nobody has corrected",
    "Wildlife has the run of the place after four o'clock",
    "There is a tree on the ninth older than the sport",
    "The eighteenth was moved twice and improved neither time",
    "Nobody has ever finished under par and left quietly",
    "The pond has claimed more balls than the rough, which is saying something",
    "A plaque near the tenth marks something the club would rather forget",
    "Two holes are widely believed to be the same hole"
  ];

  const MOTTOS = [
    "Aim well. Expect little.",
    "Every stroke counts, unfortunately.",
    "The wind giveth.",
    "Play it as it lies, and lie about it later.",
    "Patience, then arithmetic.",
    "We have seen worse. Rarely.",
    "Straight is a direction, not a promise.",
    "In sand we trust, for want of options.",
    "Slow play, faster excuses.",
    "The course always wins. Come anyway.",
    "Hit it, find it, hit it again.",
    "Dignity optional.",
    "Better players have wept here.",
    "Not the hardest course. Not the fairest either.",
    "Founded on optimism, sustained by denial.",
    "A good walk, occasionally spoiled."
  ];

  /** Seeded three-sentence description for a course. */
  function courseBlurb(seed) {
    const r = rngFor(seed + "|blurb");
    return `${pick(r, BLURB_A)}. ${pick(r, BLURB_B)}. ${pick(r, BLURB_C)}`;
  }

  /**
   * The full record for a course that has never existed: name, founding year,
   * a short history, a piece of local colour and the club motto. All seeded, so
   * a given code always tells the same story.
   */
  function courseCard(seed) {
    const r = rngFor(seed + "|card");
    const rb = rngFor(seed + "|blurb");
    return {
      name: courseName(seed),
      est: 1890 + ((r() * 86) | 0),
      history: `${pick(rb, BLURB_A)}.`,
      known: `${pick(rb, BLURB_B)}.`,
      warning: pick(rb, BLURB_C),
      colour: `${pick(r, BLURB_D)}.`,
      motto: pick(r, MOTTOS)
    };
  }

  function inB(g, x, y) { return x >= 0 && y >= 0 && x < g.cols && y < g.rows; }
  function cell(g, x, y) { return g.cells[y * g.cols + x]; }

  function blank(cols, rows) {
    const cells = new Array(cols * rows);
    for (let i = 0; i < cells.length; i++) cells[i] = { t: T.ROUGH, slope: -1, tree: 0, hill: 0 };   // hill: 0 none, 1 mound, 2 hollow
    return { cols, rows, cells };
  }

  /** Stamp a rounded blob of terrain around (cx,cy) with radius r. */
  function stampBlob(g, rng, cx, cy, r, type, guard) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (!inB(g, x, y)) continue;
        const dx = x - cx, dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= r - 0.2 + rng() * 0.9) {
          if (guard && guard(x, y)) continue;
          const c = cell(g, x, y);
          c.t = type; c.slope = -1; c.tree = 0;
        }
      }
    }
  }

  function near(a, x, y, d) { return Math.abs(a.x - x) <= d && Math.abs(a.y - y) <= d; }

  /** 8-way BFS across cells that a putt could pass through (no tree, no water). */
  function reachable(g, from, to) {
    const seen = new Uint8Array(g.cols * g.rows);
    const q = [from]; seen[from.y * g.cols + from.x] = 1;
    while (q.length) {
      const p = q.pop();
      if (p.x === to.x && p.y === to.y) return true;
      for (const d of DIRS) {
        const nx = p.x + d.x, ny = p.y + d.y;
        if (!inB(g, nx, ny) || seen[ny * g.cols + nx]) continue;
        const t = cell(g, nx, ny).t;
        if (t === T.TREE || t === T.WATER) continue;
        seen[ny * g.cols + nx] = 1;
        q.push({ x: nx, y: ny });
      }
    }
    return false;
  }

  /** Shortest 8-way step count avoiding trees/water, or Infinity. */
  function bfsDist(g, from, to) {
    const dist = new Int16Array(g.cols * g.rows).fill(-1);
    let q = [from];
    dist[from.y * g.cols + from.x] = 0;
    while (q.length) {
      const nq = [];
      for (const p of q) {
        const d0 = dist[p.y * g.cols + p.x];
        if (p.x === to.x && p.y === to.y) return d0;
        for (const d of DIRS) {
          const nx = p.x + d.x, ny = p.y + d.y;
          if (!inB(g, nx, ny) || dist[ny * g.cols + nx] >= 0) continue;
          const t = cell(g, nx, ny).t;
          if (t === T.TREE || t === T.WATER) continue;
          dist[ny * g.cols + nx] = d0 + 1;
          nq.push({ x: nx, y: ny });
        }
      }
      q = nq;
    }
    return Infinity;
  }

  const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

  /** True when the cup sits on one of the 8 rays out of the tee. */
  function onRay(a, b) {
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
    return dx === 0 || dy === 0 || dx === dy;
  }

  function genHoleAttempt(seed, holeIdx, size, salt) {
    const rng = rngFor(seed + "|h" + holeIdx + "|s" + salt);
    const { cols, rows } = SIZES[size];
    const g = blank(cols, rows);

    // Tee near one end, cup near the other; flip half the time so play alternates up/down.
    /* ---- how long is this hole? ----
     * Tee and cup used to sit at opposite ends of the page every single time,
     * which made every hole the same length. A round should breathe: a couple of
     * short ones you can genuinely attack, a majority of mid-length holes, and a
     * few long hauls. Par stays 6 throughout, so the short holes become birdie
     * chances and the long ones are where rounds are lost.
     */
    const span = Math.max(cols, rows) - 3;
    const lenRoll = rng();
    const cls = lenRoll < 0.24 ? "short" : lenRoll < 0.76 ? "mid" : "long";
    const wantRaw = cls === "short" ? span * (0.46 + rng() * 0.12)
      : cls === "mid" ? span * (0.62 + rng() * 0.18)
        : span * (0.88 + rng() * 0.12);
    // never so short that a hole is over before it starts
    const want = Math.max(8, Math.round(wantRaw));
    g.length = cls;

    const flip = rng() < 0.5;
    const hole = { x: ri(rng, 2, cols - 3), y: flip ? rows - 1 - ri(rng, 1, 3) : ri(rng, 1, 3) };

    // Put the tee at roughly the wanted distance from the cup, trying a spread
    // of bearings and keeping the best fit that stays on the page.
    let tee = null, bestErr = 1e9;
    for (let a = 0; a < 40; a++) {
      const ang = rng() * Math.PI * 2;
      const tx = Math.round(hole.x + Math.cos(ang) * want);
      const ty = Math.round(hole.y + Math.sin(ang) * want);
      if (tx < 2 || ty < 1 || tx > cols - 3 || ty > rows - 2) continue;
      const d = Math.max(Math.abs(tx - hole.x), Math.abs(ty - hole.y));
      const err = Math.abs(d - want);
      if (err < bestErr) { bestErr = err; tee = { x: tx, y: ty }; }
      if (err === 0) break;
    }
    // If no bearing fitted (common for the long ones), fall back to the far end
    // of the page, which is the longest the board allows.
    if (!tee || bestErr > 3) {
      tee = { x: ri(rng, 2, cols - 3), y: hole.y < rows / 2 ? rows - 1 - ri(rng, 1, 3) : ri(rng, 1, 3) };
    }

    // A hole you can finish by firing along one straight ray is no fun, so nudge
    // the cup sideways until it is off every one of the 8 lines out of the tee.
    let guard = 0;
    while (onRay(tee, hole) && guard++ < 24) {
      hole.x += rng() < 0.5 ? -1 : 1;
      hole.x = Math.max(2, Math.min(cols - 3, hole.x));
      if (guard > 12) hole.y += (flip ? -1 : 1);   // last resort: shift lengthwise
      hole.y = Math.max(1, Math.min(rows - 2, hole.y));
    }
    // Final guard: the nudge above can pull the cup closer, and a 4-dot hole is
    // over before it begins.
    if (Math.max(Math.abs(tee.x - hole.x), Math.abs(tee.y - hole.y)) < 7) {
      tee.y = hole.y < rows / 2 ? rows - 1 - ri(rng, 1, 3) : ri(rng, 1, 3);
      let g2 = 0;
      while (onRay(tee, hole) && g2++ < 12) {
        tee.x = Math.max(2, Math.min(cols - 3, tee.x + (rng() < 0.5 ? -1 : 1)));
      }
    }
    g.tee = tee; g.hole = hole;

    const guardTeeHole = (x, y) => near(tee, x, y, 1) || near(hole, x, y, 1);
    const guardTight = (x, y) => near(tee, x, y, 0) || near(hole, x, y, 0);

    // A wandering centerline from tee to cup guides fairway placement.
    const path = [];
    let px = tee.x, py = tee.y, tries = 0;
    while ((px !== hole.x || py !== hole.y) && tries++ < 400) {
      const sx = Math.sign(hole.x - px), sy = Math.sign(hole.y - py);
      const r = rng();
      if (r < 0.42 && sy) py += sy;
      else if (r < 0.7 && sx) px += sx;
      else { px += ri(rng, -1, 1); py += ri(rng, -1, 1); }
      px = Math.max(1, Math.min(cols - 2, px));
      py = Math.max(1, Math.min(rows - 2, py));
      path.push({ x: px, y: py });
    }

    // Feature counts scale with board area -- the XL grid is 67% larger than the
    // pocket one, so fixed counts left multiplayer boards looking half empty.
    // Slightly super-linear: counts alone did not keep pace because blob sizes
    // are fixed, so a bigger board still read as sparser.
    const K = Math.pow((cols * rows) / 280, 1.25);
    const scale = n => Math.max(1, Math.round(n * K));

    // Fairway islands along the line + the green around the cup.
    const nFair = scale(ri(rng, 2, 4));
    for (let i = 0; i < nFair; i++) {
      const p = pick(rng, path.length ? path : [tee]);
      stampBlob(g, rng, p.x, p.y, ri(rng, 1, 3), T.FAIR, guardTight);
    }
    stampBlob(g, rng, hole.x, hole.y, 2, T.FAIR, null);

    // Water, sand, trees.
    const nWater = Math.round(ri(rng, 0, 2) * K);
    for (let i = 0; i < nWater; i++)
      stampBlob(g, rng, ri(rng, 2, cols - 3), ri(rng, 2, rows - 3), ri(rng, 1, 2), T.WATER, guardTeeHole);

    const nSand = scale(ri(rng, 1, 3));
    for (let i = 0; i < nSand; i++)
      stampBlob(g, rng, ri(rng, 1, cols - 2), ri(rng, 1, rows - 2), ri(rng, 1, 2), T.SAND, guardTeeHole);

    const nClust = scale(ri(rng, 3, 5));
    for (let i = 0; i < nClust; i++) {
      const kind = rng() < 0.6 ? 1 : 2; // 1 pine, 2 round
      let cx = ri(rng, 1, cols - 2), cy = ri(rng, 1, rows - 2);
      const n = ri(rng, 3, 9) + (K > 1.3 ? 3 : 0);
      for (let k = 0; k < n; k++) {
        if (inB(g, cx, cy) && !guardTeeHole(cx, cy)) {
          const c = cell(g, cx, cy);
          if (c.t === T.ROUGH || c.t === T.FAIR) { c.t = T.TREE; c.tree = kind; c.slope = -1; }
        }
        cx += ri(rng, -1, 1); cy += ri(rng, -1, 1);
      }
    }

    // A deliberate obstacle across the middle of the route, so the hole bends
    // instead of running clean from tee to cup.
    if (rng() < 0.75 && path.length > 4) {
      const mid = path[Math.floor(path.length * (0.38 + rng() * 0.3))];
      const kind = rng() < 0.65 ? T.TREE : T.WATER;
      const r = ri(rng, 1, 2);
      if (kind === T.WATER) stampBlob(g, rng, mid.x, mid.y, r, T.WATER, guardTeeHole);
      else for (let y = mid.y - r; y <= mid.y + r; y++)
        for (let x = mid.x - r; x <= mid.x + r; x++) {
          if (!inB(g, x, y) || guardTeeHole(x, y)) continue;
          const c = cell(g, x, y);
          if (c.t === T.ROUGH || c.t === T.FAIR) { c.t = T.TREE; c.tree = rng() < 0.6 ? 1 : 2; c.slope = -1; }
        }
    }

    /* ---- coverage pass ----
     * Terrain clusters along the tee-to-cup corridor, which left whole corners
     * of the board as bare dots and made the playfield look off-centre. Sweep a
     * coarse zone grid and give anything that reads as dead space something to
     * look at. Fills are biased toward sand and fairway so they add interest
     * without often blocking the route.
     */
    const ZX = 3, ZY = 4;
    for (let zy = 0; zy < ZY; zy++) {
      for (let zx = 0; zx < ZX; zx++) {
        const zx0 = Math.floor(zx * cols / ZX), zx1 = Math.floor((zx + 1) * cols / ZX);
        const zy0 = Math.floor(zy * rows / ZY), zy1 = Math.floor((zy + 1) * rows / ZY);
        let feats = 0, count = 0;
        for (let y = zy0; y < zy1; y++) for (let x = zx0; x < zx1; x++) {
          count++;
          const c = cell(g, x, y);
          if (c.t !== T.ROUGH || c.slope >= 0) feats++;
        }
        if (!count || feats / count >= 0.12) continue;

        const cx0 = Math.max(1, Math.min(cols - 2, ri(rng, zx0 + 1, zx1 - 2)));
        const cy0 = Math.max(1, Math.min(rows - 2, ri(rng, zy0 + 1, zy1 - 2)));
        if (guardTeeHole(cx0, cy0)) continue;

        const roll = rng();
        if (roll < 0.26) {
          stampBlob(g, rng, cx0, cy0, ri(rng, 1, 2), T.SAND, guardTeeHole);
        } else if (roll < 0.66) {
          stampBlob(g, rng, cx0, cy0, ri(rng, 1, 2), T.FAIR, guardTight);
        } else if (roll < 0.93) {
          let tx2 = cx0, ty2 = cy0;
          const n2 = ri(rng, 3, 6), kind2 = rng() < 0.6 ? 1 : 2;
          for (let k = 0; k < n2; k++) {
            if (inB(g, tx2, ty2) && !guardTeeHole(tx2, ty2)) {
              const c = cell(g, tx2, ty2);
              if (c.t === T.ROUGH || c.t === T.FAIR) { c.t = T.TREE; c.tree = kind2; c.slope = -1; }
            }
            tx2 += ri(rng, -1, 1); ty2 += ri(rng, -1, 1);
          }
        } else {
          stampBlob(g, rng, cx0, cy0, 1, T.WATER, guardTeeHole);
        }
      }
    }

    /* ---- hills ----
     * A hill is a small SQUARE block of dots -- 2x2, 3x3 or 4x4. Land on a MOUND
     * and the ball rolls one dot away from the middle; land in a HOLLOW and it
     * rolls one dot toward the middle. Direction comes from the block's shape,
     * so it can be read in advance.
     *
     * A hill is only ever laid on plain rough where the WHOLE block is clear, so
     * it never sits on top of water, sand, trees or fairway. Each cell keeps a
     * plain 0-7 direction in `slope`, plus a `hill` tag for drawing.
     */
    const nHills = Math.max(1, Math.round(ri(rng, 1, 2) * K));
    g.hills = [];

    const spots = [];
    const seenSpot = new Uint8Array(cols * rows);
    for (const pt of path) {
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const x = pt.x + dx, y = pt.y + dy;
        if (!inB(g, x, y)) continue;
        const k = y * cols + x;
        if (seenSpot[k]) continue;
        seenSpot[k] = 1;
        spots.push({ x, y });
      }
    }
    for (let i = spots.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t2 = spots[i]; spots[i] = spots[j]; spots[j] = t2;
    }

    const dirOf = (dx, dy) => {
      const ang = Math.atan2(dx, -dy);            // 0 = North, clockwise
      return ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
    };

    for (const c0 of spots) {
      if (g.hills.length >= nHills) break;
      const roll = rng();
      const n = roll < 0.42 ? 2 : roll < 0.80 ? 3 : 4;      // 2x2 / 3x3 / 4x4
      const x0 = c0.x, y0 = c0.y;
      if (x0 < 1 || y0 < 1 || x0 + n > cols - 1 || y0 + n > rows - 1) continue;

      // The whole block, plus a one-dot margin, must be plain empty rough so the
      // hill can never overlap another feature.
      let clear = true;
      for (let y = y0 - 1; y <= y0 + n && clear; y++) {
        for (let x = x0 - 1; x <= x0 + n && clear; x++) {
          if (!inB(g, x, y)) continue;
          const cc = cell(g, x, y);
          const inside = x >= x0 && x < x0 + n && y >= y0 && y < y0 + n;
          if (inside && (cc.t !== T.ROUGH || cc.slope >= 0 || guardTeeHole(x, y))) clear = false;
          if (!inside && cc.hill) clear = false;                 // keep hills apart
        }
      }
      if (!clear) continue;
      // and not right on top of the cup
      if (Math.max(Math.abs(x0 + n / 2 - hole.x), Math.abs(y0 + n / 2 - hole.y)) < n) continue;

      const kind = rng() < 0.5 ? "mound" : "hollow";
      const midX = x0 + (n - 1) / 2, midY = y0 + (n - 1) / 2;
      const claimed = [];
      for (let y = y0; y < y0 + n; y++) {
        for (let x = x0; x < x0 + n; x++) {
          const dx = x - midX, dy = y - midY;
          let dir;
          if (dx === 0 && dy === 0) {
            // odd sizes have a true middle: a peak tips the ball off, a bottom holds it
            if (kind === "hollow") continue;
            dir = ri(rng, 0, 7);
          } else {
            dir = kind === "mound" ? dirOf(dx, dy) : dirOf(-dx, -dy);
          }
          const nx = x + DIRS[dir].x, ny = y + DIRS[dir].y;
          if (!inB(g, nx, ny)) continue;
          const nt = cell(g, nx, ny).t;
          if (nt === T.WATER || nt === T.TREE) continue;   // the rules cancel these
          claimed.push([x, y, dir]);
        }
      }
      if (claimed.length < n) continue;                    // too clipped to read
      const tag = kind === "mound" ? 1 : 2;
      for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) cell(g, x, y).hill = tag;
      claimed.forEach(([x, y, dir]) => { cell(g, x, y).slope = dir; });
      g.hills.push({ x: x0, y: y0, n, kind });
    }

    // The green stays clean around the cup.
    cell(g, hole.x, hole.y).t = T.FAIR; cell(g, hole.x, hole.y).slope = -1;

    /* A proper mown TEE BOX. Previously the tee sat on plain rough, so the
     * opening shot of every hole got no help at all. A teeing ground is cut
     * grass, so it counts as fairway: the drive runs a dot further and clears
     * trees, which is exactly how a tee shot ought to feel. */
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = tee.x + dx, y = tee.y + dy;
        if (!inB(g, x, y)) continue;
        if (Math.abs(dx) + Math.abs(dy) > 1 && rng() < 0.4) continue;   // ragged edge
        const c = cell(g, x, y);
        c.t = T.FAIR; c.slope = -1; c.tree = 0; c.hill = 0;
      }
    }

    if (!reachable(g, tee, hole)) return null;
    if (onRay(tee, hole)) return null;
    // The walk must be at least a little longer than the crow-flies distance,
    // which means something is genuinely in the way.
    if (bfsDist(g, tee, hole) < cheb(tee, hole) + 1) return null;
    return g;
  }

  function genHole(seed, holeIdx, size) {
    for (let salt = 0; salt < 200; salt++) {
      const g = genHoleAttempt(seed, holeIdx, size, salt);
      if (g) return g;
    }
    // Absolute fallback: empty field (deterministic and always solvable).
    const g = blank(SIZES[size].cols, SIZES[size].rows);
    g.tee = { x: 3, y: g.rows - 3 }; g.hole = { x: g.cols - 4, y: 2 };
    return g;
  }

  function genCourse(seed, size) {
    const holes = [];
    for (let i = 0; i < 18; i++) holes.push(genHole(seed, i, size));
    // Bigfoot hides in roughly a third of notebooks.
    const br = rngFor(seed + "|bigfoot");
    let bigfoot = null;
    if (br() < 1 / 3) {
      const hIdx = (br() * 18) | 0;
      const g = holes[hIdx];
      // deterministic open cell, away from tee/cup
      for (let t = 0; t < 200; t++) {
        const x = 1 + ((br() * (g.cols - 2)) | 0), y = 1 + ((br() * (g.rows - 2)) | 0);
        const c = cell(g, x, y);
        if (c.t === T.ROUGH && c.slope < 0 && !near(g.tee, x, y, 2) && !near(g.hole, x, y, 2)) {
          bigfoot = { hole: hIdx, x, y };
          break;
        }
      }
    }
    return { seed, size, name: courseName(seed), holes, bigfoot };
  }

  global.Course = { T, DIRS, SIZES, genCourse, genHole, courseName, courseBlurb, courseCard, cell, inB };
})(window);
