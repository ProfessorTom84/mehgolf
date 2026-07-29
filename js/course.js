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

  function genHoleAttempt(seed, holeIdx, size, salt) {
    const rng = rngFor(seed + "|h" + holeIdx + "|s" + salt);
    const { cols, rows } = SIZES[size];
    const g = blank(cols, rows);

    // Tee near one end, cup near the other; flip half the time so play alternates up/down.
    const flip = rng() < 0.5;
    const tee = { x: ri(rng, 2, cols - 3), y: flip ? ri(rng, 1, 3) : rows - 1 - ri(rng, 1, 3) };
    const hole = { x: ri(rng, 2, cols - 3), y: flip ? rows - 1 - ri(rng, 1, 3) : ri(rng, 1, 3) };
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

    // Fairway islands along the line + the green around the cup.
    const nFair = ri(rng, 2, 4);
    for (let i = 0; i < nFair; i++) {
      const p = pick(rng, path.length ? path : [tee]);
      stampBlob(g, rng, p.x, p.y, ri(rng, 1, 3), T.FAIR, guardTight);
    }
    stampBlob(g, rng, hole.x, hole.y, 2, T.FAIR, null);

    // Water, sand, trees.
    const nWater = ri(rng, 0, 2);
    for (let i = 0; i < nWater; i++)
      stampBlob(g, rng, ri(rng, 2, cols - 3), ri(rng, 2, rows - 3), ri(rng, 1, 2), T.WATER, guardTeeHole);

    const nSand = ri(rng, 1, 3);
    for (let i = 0; i < nSand; i++)
      stampBlob(g, rng, ri(rng, 1, cols - 2), ri(rng, 1, rows - 2), ri(rng, 1, 2), T.SAND, guardTeeHole);

    const nClust = ri(rng, 3, 5);
    for (let i = 0; i < nClust; i++) {
      const kind = rng() < 0.6 ? 1 : 2; // 1 pine, 2 round
      let cx = ri(rng, 1, cols - 2), cy = ri(rng, 1, rows - 2);
      const n = ri(rng, 3, 9);
      for (let k = 0; k < n; k++) {
        if (inB(g, cx, cy) && !guardTeeHole(cx, cy)) {
          const c = cell(g, cx, cy);
          if (c.t === T.ROUGH || c.t === T.FAIR) { c.t = T.TREE; c.tree = kind; c.slope = -1; }
        }
        cx += ri(rng, -1, 1); cy += ri(rng, -1, 1);
      }
    }

    // Slopes on open ground.
    const nSlope = ri(rng, 1, 4);
    for (let i = 0; i < nSlope; i++) {
      const x = ri(rng, 1, cols - 2), y = ri(rng, 1, rows - 2);
      if (guardTeeHole(x, y)) continue;
      const c = cell(g, x, y);
      if (c.t === T.ROUGH || c.t === T.FAIR) c.slope = ri(rng, 0, 7);
    }

    // Keep the cup and tee themselves clean.
    cell(g, hole.x, hole.y).t = T.FAIR; cell(g, hole.x, hole.y).slope = -1;
    const tc = cell(g, tee.x, tee.y);
    if (tc.t === T.TREE || tc.t === T.WATER) tc.t = T.ROUGH;
    tc.slope = -1;

    return reachable(g, tee, hole) ? g : null;
  }

  function genHole(seed, holeIdx, size) {
    for (let salt = 0; salt < 40; salt++) {
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
