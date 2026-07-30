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

  function inB(g, x, y) { return x >= 0 && y >= 0 && x < g.cols && y < g.rows; }
  function cell(g, x, y) { return g.cells[y * g.cols + x]; }

  function blank(cols, rows) {
    const cells = new Array(cols * rows);
    for (let i = 0; i < cells.length; i++) cells[i] = { t: T.ROUGH, slope: -1, tree: 0 };
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
    const flip = rng() < 0.5;
    const tee = { x: ri(rng, 2, cols - 3), y: flip ? ri(rng, 1, 3) : rows - 1 - ri(rng, 1, 3) };
    const hole = { x: ri(rng, 2, cols - 3), y: flip ? rows - 1 - ri(rng, 1, 3) : ri(rng, 1, 3) };

    // A hole you can finish by firing along one straight ray is no fun, so nudge
    // the cup sideways until it is off every one of the 8 lines out of the tee.
    let guard = 0;
    while (onRay(tee, hole) && guard++ < 24) {
      hole.x += rng() < 0.5 ? -1 : 1;
      hole.x = Math.max(2, Math.min(cols - 3, hole.x));
      if (guard > 12) hole.y += (flip ? -1 : 1);   // last resort: shift lengthwise
      hole.y = Math.max(1, Math.min(rows - 2, hole.y));
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

    /* ---- hills ----
     * A hill is an AREA with a shape, not a scattered arrow. Land on a MOUND and
     * the ball rolls one dot directly away from its peak; land in a HOLLOW and it
     * rolls one dot toward the bottom. Direction comes from geometry, so a player
     * can read it in advance and plan around it -- a hollow near the cup is worth
     * aiming at, a mound beside water is a genuine hazard.
     *
     * Each cell inside a hill still carries a plain 0-7 direction in `slope`, so
     * everything downstream (rolling, chaining, printing) is unchanged.
     */
    const nHills = Math.max(1, Math.round(ri(rng, 1, 2) * K));
    g.hills = [];

    // candidate centres: near the route so the ball actually meets them
    const spots = [];
    const seenSpot = new Uint8Array(cols * rows);
    for (const pt of path) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = pt.x + dx, y = pt.y + dy;
        if (!inB(g, x, y) || guardTeeHole(x, y)) continue;
        const k = y * cols + x;
        if (seenSpot[k]) continue;
        const c = cell(g, x, y);
        if (c.t !== T.ROUGH && c.t !== T.FAIR) continue;
        seenSpot[k] = 1;
        spots.push({ x, y });
      }
    }
    for (let i = spots.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t2 = spots[i]; spots[i] = spots[j]; spots[j] = t2;
    }

    const dirOf = (dx, dy) => {
      // snap a vector to one of the 8 compass directions in DIRS order
      const ang = Math.atan2(dx, -dy);                 // 0 = North, clockwise
      let k = Math.round(ang / (Math.PI / 4));
      return ((k % 8) + 8) % 8;
    };

    for (const c0 of spots) {
      if (g.hills.length >= nHills) break;
      // weighted toward the smaller sizes: a board of nothing but big hills
      // means no shot ever finishes where you aimed it
      const rRoll = rng();
      const r = rRoll < 0.52 ? 1 : rRoll < 0.86 ? 2 : 3;   // small / medium / large
      // don't overlap an existing hill or crowd the cup
      let clash = false;
      for (const h of g.hills)
        if (Math.max(Math.abs(h.x - c0.x), Math.abs(h.y - c0.y)) <= h.r + r + 1) clash = true;
      if (clash) continue;
      if (Math.max(Math.abs(c0.x - hole.x), Math.abs(c0.y - hole.y)) <= r + 1) continue;

      const kind = rng() < 0.5 ? "mound" : "hollow";
      let touched = 0;
      const claimed = [];

      for (let y = c0.y - r; y <= c0.y + r; y++) {
        for (let x = c0.x - r; x <= c0.x + r; x++) {
          const dx = x - c0.x, dy = y - c0.y;
          if (Math.hypot(dx, dy) > r + 0.35) continue;   // round-ish footprint
          if (!inB(g, x, y) || guardTeeHole(x, y)) continue;
          const cc = cell(g, x, y);
          if (cc.t !== T.ROUGH && cc.t !== T.FAIR) continue;
          if (cc.slope >= 0) continue;

          let dir;
          if (dx === 0 && dy === 0) {
            // The peak of a mound cannot hold a ball, so it tips a seeded way.
            // The bottom of a hollow is exactly where a ball wants to sit.
            if (kind === "hollow") { claimed.push([x, y, -1]); touched++; continue; }
            dir = ri(rng, 0, 7);
          } else {
            dir = kind === "mound" ? dirOf(dx, dy) : dirOf(-dx, -dy);
          }

          // a roll that ends in water or trees is cancelled by the rules, so it
          // would be a decoration rather than a hazard -- skip those cells
          const nx = x + DIRS[dir].x, ny = y + DIRS[dir].y;
          if (!inB(g, nx, ny)) continue;
          const nt = cell(g, nx, ny).t;
          if (nt === T.WATER || nt === T.TREE) continue;
          claimed.push([x, y, dir]);
          touched++;
        }
      }
      if (touched < (r === 1 ? 3 : 5)) continue;         // too chewed up to read
      claimed.forEach(([x, y, dir]) => { if (dir >= 0) cell(g, x, y).slope = dir; });
      g.hills.push({ x: c0.x, y: c0.y, r, kind });
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

    // Keep the cup and tee themselves clean.
    cell(g, hole.x, hole.y).t = T.FAIR; cell(g, hole.x, hole.y).slope = -1;
    const tc = cell(g, tee.x, tee.y);
    if (tc.t === T.TREE || tc.t === T.WATER) tc.t = T.ROUGH;
    tc.slope = -1;

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

  global.Course = { T, DIRS, SIZES, genCourse, genHole, courseName, cell, inB };
})(window);
