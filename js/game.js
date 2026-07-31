/* Meh Golf — game state, SVG board, turn machine, UI wiring. */
(function () {
  "use strict";
  const { T, DIRS, SIZES, genCourse, cell, inB } = window.Course;
  const $ = s => document.querySelector(s);

  const C = 34;                 // svg cell size
  const NS = "http://www.w3.org/2000/svg";
  const PCOLORS = ["#D93A2B", "#2B55D9", "#1F8A46", "#8A3DB8"];
  const PNAMES = ["Red", "Blue", "Green", "Purple"];
  const STROKE_CAP = 12;

  const S = {
    seed: "", players: 1, mode: "dice", size: "pocket",
    course: null, holeIdx: 0,
    ps: [],                    // player state
    cur: 0,
    phase: "idle",             // roll | rolled | aim | anim | between | over
    rolled: 0, moveN: 0, moveKind: "roll", rollMoveN: 0, // roll|putt|driver|iron
    bigfootFound: false,
    wobble: null,              // seeded rng for hand-drawn jitter
    log: [],                   // shot history
    caddieKey: "", caddieText: "", lastShooter: -1,
    theme: "colour"           // "colour" | "ink"
  };

  /* ---------------- helpers ---------------- */
  const g = () => S.course.holes[S.holeIdx];

  /* ---------------- palettes ----------------
   * "ink" reproduces the original pencil-and-paper notebook; "colour" is the
   * same board with real terrain colours. Every fill on the board comes from
   * here, so switching is a re-render and nothing else -- and because the
   * values land on the SVG as plain attributes, saved PNGs pick them up too.
   */
  const PALETTES = {
    ink: {
      paper: "#FAF8F2", fairway: "#E4E2DA", water: "#969C9F",
      sand: "#F0E8D2", sandHatch: "#D9CBA4",
      tree: "#3A3F3A", treeAlt: "#3A3F3A", trunk: "#3A3F3A",
      slope: "#6B6F66", mound: "#5F6355", hollow: "#6B6F66", green: "#DAD8CE",
      roughDot: "#C6C2B8", fairwayDot: "#A8A59A", sandDot: "#CBBD97", waterDot: "#EDEFEF",
      tee: "#24262B", cup: "#24262B", bigfoot: "#3A3F3A",
      boost: "#5A5F58", penalty: "#8A8272"
    },
    colour: {
      paper: "#FAF8F2", fairway: "#CFE3AE", water: "#7FB6DC",
      sand: "#F6E7B2", sandHatch: "#E0C77E",
      tree: "#2F6B3A", treeAlt: "#3E7C46", trunk: "#6B4E31",
      slope: "#8A7BB5", mound: "#C4703A", hollow: "#5B7FBF", green: "#B4D98C",
      roughDot: "#B6BFA4", fairwayDot: "#7FA05C", sandDot: "#C9A94F", waterDot: "#DCEEF8",
      tee: "#24262B", cup: "#24262B", bigfoot: "#4A3F35",
      boost: "#1F8A46", penalty: "#C08528"
    }
  };
  const theme = () => PALETTES[S.theme] || PALETTES.ink;
  const coarse = () => window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const P = () => S.ps[S.cur];
  const terrainAt = p => cell(g(), p.x, p.y).t;
  const isHole = p => p.x === g().hole.x && p.y === g().hole.y;
  const dist = p => Math.hypot(p.x - g().hole.x, p.y - g().hole.y);
  const lieName = t => t === T.FAIR ? "the fairway" : t === T.SAND ? "a sand trap" : "the rough";
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const px = v => v * C + C / 2;

  /* ---------------- move legality ---------------- */
  /**
   * Try a straight hit of n cells in direction d.
   * Returns {ok, cells, land, holed, reason}
   */
  function tryMove(pos, dirIdx, n, opts) {
    const d = DIRS[dirIdx], hole = g().hole;
    const cells = [];
    let x = pos.x, y = pos.y;
    for (let i = 1; i <= n; i++) {
      x += d.x; y += d.y;
      if (!inB(g(), x, y)) return { ok: false, reason: "out of bounds" };
      cells.push({ x, y });
    }
    const holeAt = cells.findIndex(c => c.x === hole.x && c.y === hole.y);

    // trees along the way block, unless struck from the fairway (or a driver).
    // Checked BEFORE the sink checks: a tree between ball and cup stops the shot
    // even when the distance is exact. Cells past the cup don't matter for a sink
    // (the ball drops in and never travels on).
    const canFly = opts.overTrees;
    const sinks = holeAt >= 0 && holeAt >= cells.length - 2;
    const pathEnd = sinks ? holeAt : cells.length - 1;
    for (let i = 0; i < pathEnd; i++) {
      if (terrainAt(cells[i]) === T.TREE && !canFly) return { ok: false, reason: "trees in the way" };
    }

    if (holeAt === cells.length - 1) return { ok: true, cells, land: cells[cells.length - 1], holed: true };
    if (holeAt >= 0 && holeAt === cells.length - 2) // crossed the cup, stopped one past: counts
      return { ok: true, cells, land: hole, holed: true, overshoot: true };
    const land = cells[cells.length - 1];
    const lt = terrainAt(land);
    if (lt === T.TREE) return { ok: false, reason: "can't land in trees" };
    if (lt === T.WATER) return { ok: false, reason: "can't land in water" };
    return { ok: true, cells, land, holed: false };
  }

  function moveOpts(kind, fromT) {
    // who may fly over trees: any dice/putt hit from fairway; drivers always (fairway-only club)
    if (kind === "driver") return { overTrees: true };
    if (kind === "iron") return { overTrees: false };
    return { overTrees: fromT === T.FAIR };
  }

  function legalDirs(pos, n, kind) {
    const fromT = terrainAt(pos);
    const o = moveOpts(kind, fromT);
    const out = [];
    for (let i = 0; i < 8; i++) out.push(tryMove(pos, i, n, o));
    return out;
  }

  /** ball rolls down slope arrows after landing */
  function resolveSlopes(pos) {
    const steps = [];
    let p = { ...pos }, holed = false;
    for (let i = 0; i < 24; i++) {
      const c = cell(g(), p.x, p.y);
      if (c.slope < 0) break;
      const d = DIRS[c.slope];
      const np = { x: p.x + d.x, y: p.y + d.y };
      if (!inB(g(), np.x, np.y)) break;
      const nt = terrainAt(np);
      if (nt === T.WATER || nt === T.TREE) break; // slope into trouble: ball stays put
      steps.push(np);
      if (isHole(np)) { holed = true; p = np; break; }
      const nc = cell(g(), np.x, np.y);
      if (nc.slope >= 0 && (nc.slope + 4) % 8 === c.slope) { p = np; break; } // facing arrows
      p = np;
    }
    return { steps, end: p, holed };
  }

  /** Dots gained (+) or lost (-) on a shot, derived from what actually happened. */
  function segMod(seg) {
    if (seg.kind !== "roll" || seg.die == null) return 0;
    return seg.dist - seg.die;
  }

  /* ---------------- board rendering ---------------- */
  function renderBoard() {
    const G = g();
    const w = G.cols * C, h = G.rows * C;
    const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, "aria-label": "golf hole map" });
    svg.id = "board";

    const TH = theme();
    const defs = el("defs", {}, svg);
    const pat = el("pattern", { id: "sandhatch", width: 7, height: 7, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    el("rect", { width: 7, height: 7, fill: TH.sand }, pat);
    el("line", { x1: 0, y1: 0, x2: 0, y2: 7, stroke: TH.sandHatch, "stroke-width": 2 }, pat);

    const terr = el("g", {}, svg);
    const dots = el("g", {}, svg);
    const feat = el("g", {}, svg);
    for (let y = 0; y < G.rows; y++) for (let x = 0; x < G.cols; x++) {
      const c = cell(G, x, y), X = x * C, Y = y * C;
      if (c.t === T.FAIR) el("rect", { x: X - 1, y: Y - 1, width: C + 2, height: C + 2, rx: 9, fill: TH.fairway }, terr);
      else if (c.t === T.WATER) el("rect", { x: X - 1, y: Y - 1, width: C + 2, height: C + 2, rx: 9, fill: TH.water }, terr);
      else if (c.t === T.SAND) el("rect", { x: X - 1, y: Y - 1, width: C + 2, height: C + 2, rx: 9, fill: "url(#sandhatch)" }, terr);

      // grid dots / features
      if (c.t === T.TREE) {
        // Each tree is its own group so it can sway from the base. The phase is
        // seeded off the cell, so a given course always breathes the same way
        // and neighbouring trees never move in lockstep.
        const swayR = RNG.rngFor(S.seed + "|breeze|" + S.holeIdx + "|" + x + "," + y);
        const g0 = el("g", {
          class: "tree-sway",
          style: `transform-origin:${px(x)}px ${px(y) + 9}px; ` +
                 `animation-delay:${(-swayR() * 5).toFixed(2)}s; ` +
                 `animation-duration:${(3.2 + swayR() * 1.9).toFixed(2)}s`
        }, feat);
        if (c.tree === 2) { // round tree
          el("circle", { cx: px(x), cy: px(y) - 3, r: 8.5, fill: TH.treeAlt }, g0);
          el("rect", { x: px(x) - 1.8, y: px(y) + 4, width: 3.6, height: 6, fill: TH.trunk }, g0);
        } else { // pine
          el("polygon", { points: `${px(x)},${px(y) - 11} ${px(x) + 9},${px(y) + 7} ${px(x) - 9},${px(y) + 7}`, fill: TH.tree }, g0);
          el("rect", { x: px(x) - 1.6, y: px(y) + 7, width: 3.2, height: 4, fill: TH.trunk }, g0);
        }
      } else if (c.slope >= 0) {
        // Shaft plus head, so the direction is unmistakable. A MOUND gets a
        // solid head, a HOLLOW an open one -- which reads the same in colour or
        // in plain ink, and needs no shading behind it to compete with the
        // terrain underneath.
        const isHill = c.hill > 0;
        const col = c.hill === 1 ? TH.mound : c.hill === 2 ? TH.hollow : TH.slope;
        const a = el("g", { class: "terrain-arrow", transform: `translate(${px(x)},${px(y)}) rotate(${c.slope * 45})`, opacity: .95 }, feat);
        el("line", {
          x1: 0, y1: 8, x2: 0, y2: -2,
          stroke: col, "stroke-width": isHill ? 3.2 : 3, "stroke-linecap": "round"
        }, a);
        if (c.hill === 2) {
          el("polygon", {
            points: "0,-11 6.5,-1 -6.5,-1", fill: TH.paper,
            stroke: col, "stroke-width": 2, "stroke-linejoin": "round"
          }, a);
        } else {
          el("polygon", { points: "0,-11 6.5,-1 -6.5,-1", fill: col }, a);
        }
      } else {
        const col = c.t === T.WATER ? TH.waterDot : c.t === T.FAIR ? TH.fairwayDot
          : c.t === T.SAND ? TH.sandDot : TH.roughDot;
        const dot = el("circle", { cx: px(x), cy: px(y), r: 2, fill: col }, dots);
        if (c.t === T.WATER) {
          dot.setAttribute("class", "water-shimmer");
          dot.setAttribute("style", `animation-delay:${(-((x * 7 + y * 3) % 40) / 10).toFixed(1)}s`);
        }
      }
    }

    // bigfoot (until found)
    const bf = S.course.bigfoot;
    if (bf && bf.hole === S.holeIdx && !S.bigfootFound) {
      const bgf = el("g", { class: "bigfoot", transform: `translate(${px(bf.x)},${px(bf.y)})`, opacity: .55 }, feat);
      el("title", {}, bgf).textContent = "…did something just move?";
      el("ellipse", { cx: -3.5, cy: 1, rx: 3.2, ry: 5, fill: TH.bigfoot, transform: "rotate(-12)" }, bgf);
      el("ellipse", { cx: 3.5, cy: -2, rx: 3.2, ry: 5, fill: TH.bigfoot, transform: "rotate(12)" }, bgf);
      [[-5, -5], [-3.5, -6.2], [-2, -5.4], [2, -8.2], [3.5, -9], [5, -8]].forEach(p =>
        el("circle", { cx: p[0], cy: p[1], r: 1.1, fill: TH.bigfoot }, bgf));
      bgf.addEventListener("click", onBigfoot);
    }

    // tee + cup
    el("circle", { cx: px(G.tee.x), cy: px(G.tee.y), r: 7.5, fill: TH.paper, stroke: TH.tee, "stroke-width": 3 }, feat);
    el("circle", { cx: px(G.hole.x), cy: px(G.hole.y), r: 8, fill: TH.cup }, feat);
    el("circle", { cx: px(G.hole.x) + 2.5, cy: px(G.hole.y) - 2.5, r: 1.8, fill: TH.paper, opacity: .5 }, feat);

    buildAmbience(svg, w, h);
    el("g", { id: "trails" }, svg);
    el("g", { id: "balls" }, svg);
    el("g", { id: "aim" }, svg);
    el("g", { id: "preview" }, svg);

    const wrap = $("#board-wrap");
    wrap.innerHTML = "";
    wrap.appendChild(svg);
    svg.dataset.vw = w; svg.dataset.vh = h;
    wireHover(svg);
    fitBoardSettled(true);
    drawTrails(); drawBalls();
  }

  /**
   * Decorative layer: a breeze that crosses the page, a bird that flies over
   * now and then, and a few leaves drifting down. Everything is pure CSS
   * animation inside the SVG, so it costs no JS frames and cannot affect
   * layout. Keyframes are written per board because they need the real width.
   */
  function buildAmbience(svg, w, h) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const rng = RNG.rngFor(S.seed + "|amb|" + S.holeIdx);

    // Nothing but wind. It reads as weather rather than as anything you are
    // meant to interpret, which matters on a board where every dot is a square
    // you can land on.
    const st = document.createElementNS("http://www.w3.org/2000/svg", "style");
    st.textContent = `
      @keyframes mg-gust {
        0%   { transform: translate(${(-120).toFixed(1)}px, 0); opacity: 0; }
        12%  { opacity: var(--gust-o, .4); }
        62%  { opacity: var(--gust-o, .4); }
        78%  { transform: translate(${(w + 120).toFixed(1)}px, ${(-h * 0.05).toFixed(1)}px); opacity: 0; }
        100% { transform: translate(${(w + 120).toFixed(1)}px, ${(-h * 0.05).toFixed(1)}px); opacity: 0; }
      }
      .mg-gust { animation-name: mg-gust; animation-timing-function: linear; animation-iteration-count: infinite; }
    `;
    svg.appendChild(st);

    const amb = el("g", { id: "ambience", "pointer-events": "none" }, svg);

    // Five streaks spread down the page: different heights, lengths, speeds and
    // weights, so it never looks like one shape on a loop.
    const bands = [0.12, 0.29, 0.46, 0.63, 0.82];
    bands.forEach((band, i) => {
      const y = h * (band + (rng() - 0.5) * 0.06);
      const len = 46 + rng() * 54;              // curl length
      const dur = 34 + rng() * 30;              // slow drift
      const op = 0.26 + rng() * 0.22;
      const sw = 1.1 + rng() * 0.8;
      const g0 = el("g", {
        class: "mg-gust",
        style: `--gust-o:${op.toFixed(2)}; animation-delay:${(-rng() * dur).toFixed(1)}s; ` +
               `animation-duration:${dur.toFixed(1)}s`
      }, amb);

      // a long curl plus a shorter trailing wisp
      el("path", {
        d: `M0 ${y.toFixed(1)} q ${(len / 2).toFixed(1)} ${(-6 - rng() * 5).toFixed(1)} ${len.toFixed(1)} 0 ` +
           `t ${len.toFixed(1)} 0`,
        fill: "none", stroke: "#8FA08C", "stroke-width": sw.toFixed(2), "stroke-linecap": "round"
      }, g0);
      el("path", {
        d: `M${(len * 0.3).toFixed(1)} ${(y + 8 + rng() * 5).toFixed(1)} q ${(len * 0.45).toFixed(1)} ${(-4 - rng() * 4).toFixed(1)} ${(len * 0.9).toFixed(1)} 0`,
        fill: "none", stroke: "#8FA08C", "stroke-width": (sw * 0.7).toFixed(2),
        "stroke-linecap": "round", opacity: .6
      }, g0);
      // occasional little eddy on the leading edge
      if (i % 2 === 0) {
        el("path", {
          d: `M${(len * 1.6).toFixed(1)} ${y.toFixed(1)} a 5 5 0 1 1 -4 -3`,
          fill: "none", stroke: "#8FA08C", "stroke-width": (sw * 0.8).toFixed(2),
          "stroke-linecap": "round", opacity: .5
        }, g0);
      }
    });
  }

  // Size the board svg to whatever space is actually available, instead of
  // just capping its width and letting a tall grid overflow the viewport.
  let lastFitW = 0, lastFitH = 0;
  function fitBoard(force) {
    const svg = document.getElementById("board");
    if (!svg) return;
    // Nothing but a real viewport change (or a fresh board) may trigger a
    // resize. This makes it structurally impossible for hover text, the shot
    // history growing, or any other DOM update to nudge the board's size.
    const vpH = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    const vpW = (window.visualViewport && window.visualViewport.width) || window.innerWidth;
    if (!force && vpW === lastFitW && vpH === lastFitH) return;
    lastFitW = vpW; lastFitH = vpH;
    const vw = Number(svg.dataset.vw), vh = Number(svg.dataset.vh);
    if (!vw || !vh) return;

    // Matches the CSS: narrow screens stack, but a short wide one (a phone held
    // sideways) keeps its columns and fits the board to the height.
    const shortWide = vpH <= 540 && vpW >= 620;
    const stacked = vpW <= 980 && !shortWide;

    // Horizontal budget: measure what the columns actually leave us rather than
    // guessing with a vw fraction, so the side panels can never squeeze the board
    // off-screen.
    let maxW;
    if (stacked) {
      maxW = Math.min(vpW * 0.94, 560);
    } else {
      const felt = document.querySelector(".table-felt");
      const hist = document.querySelector(".side-left");
      const tray = document.querySelector(".side-right");
      const feltW = felt ? felt.clientWidth : vpW;
      const sideW = (hist ? hist.getBoundingClientRect().width : 0)
        + (tray ? tray.getBoundingClientRect().width : 0);
      maxW = Math.min(feltW - sideW - 66, 560); // 66 = column gaps + page padding
    }
    maxW = Math.max(200, maxW);

    // Vertical budget: from the board's top down to the bottom of the viewport,
    // minus EVERYTHING that sits below the board inside the page (the hover
    // inspector and the footer strip) plus a little breathing room. Missing one
    // of these pushes the footer off-screen.
    const top = $("#board-wrap").getBoundingClientRect().top;
    let belowH = 0;
    [".board-slot", ".page-foot"].forEach(sel => {
      const n = document.querySelector(sel);
      if (n) belowH += n.getBoundingClientRect().height;
    });
    /* On a phone, measure the space the flex layout has ALREADY allocated rather
     * than the window. Safari's URL bar slides in and out as you touch the
     * screen, changing innerHeight -- which was making the board jump about
     * while playing. The container is sized in dvh, so it holds still. */
    let maxH;
    if (typeof phoneQ === "function" && phoneQ()) {
      const felt = document.querySelector(".table-felt");
      const tray = document.querySelector(".side-right");
      const feltH = felt ? felt.clientHeight : (vpH - top);
      const trayH = tray ? tray.getBoundingClientRect().height : 0;
      maxH = Math.max(150, feltH - trayH - belowH - 12);
    } else {
      maxH = Math.max(150, vpH - top - belowH - 20);
    }

    const scale = Math.min(maxW / vw, maxH / vh);
    const w = Math.floor(vw * scale), h = Math.floor(vh * scale);
    // Idempotence guard: writing identical values would still dirty layout and,
    // with any layout observer attached, could feed back into another fit.
    if (svg.style.width === w + "px" && svg.style.height === h + "px") return;
    svg.style.width = w + "px";
    svg.style.height = h + "px";

    // The paper must hug the board. Left to itself the page sizes to its widest
    // child, and the footer strip grows with the player count -- which is why a
    // four-player board sat in the top-left of an over-wide sheet.
    const book = document.querySelector(".notebook");
    const page = document.querySelector(".page");
    if (book && page) {
      const cs = getComputedStyle(page);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      book.style.width = (w + padX) + "px";
    }
  }

  /**
   * Fit, then fit again. Narrowing the page can make the footer strip wrap onto
   * another line, which changes the height available to the board; a second pass
   * settles that in the same frame.
   */
  function fitBoardSettled(force) {
    fitBoard(force);
    fitBoard(true);
  }
  let fitTimer = null;
  const scheduleFit = () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => fitBoardSettled(false), 80); };
  window.addEventListener("resize", scheduleFit);
  window.addEventListener("orientationchange", () => setTimeout(() => fitBoardSettled(true), 220));
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleFit);
  }
  // NOTE: deliberately no ResizeObserver here. Observing the layout that
  // contains the board means our own resize retriggers the observer, which
  // oscillates the board size. The side panels are fixed-width and scroll
  // internally, so window resize is the only signal we actually need.

  const jitter = () => (S.wobble() - 0.5) * 3.5;

  function drawTrails() {
    const t = $("#trails"); t.innerHTML = "";
    const TH = theme();

    S.ps.forEach(p => {
      p.trail.forEach(seg => {
        const x1 = px(seg.a.x) + seg.j1x, y1 = px(seg.a.y) + seg.j1y;
        const x2 = px(seg.b.x) + seg.j2x, y2 = px(seg.b.y) + seg.j2y;
        const mod = segMod(seg);

        // the shot itself
        el("line", {
          x1, y1, x2, y2,
          stroke: p.color, "stroke-width": 3, class: "stroke-line",
          opacity: seg.kind === "slope" ? .55 : .9,
          "stroke-dasharray": seg.kind === "slope" ? "2 6" : "none"
        }, t);

        // a tick at every dot crossed, so the length is countable
        if (seg.kind !== "slope" && seg.dist > 1) {
          const dx = (x2 - x1) / seg.dist, dy = (y2 - y1) / seg.dist;
          const L = Math.hypot(dx, dy) || 1;
          const nx = -dy / L * 3.6, ny = dx / L * 3.6;
          for (let k = 1; k < seg.dist; k++) {
            const cx = x1 + dx * k, cy = y1 + dy * k;
            el("line", {
              x1: cx - nx, y1: cy - ny, x2: cx + nx, y2: cy + ny,
              stroke: p.color, "stroke-width": 1.7, opacity: .85
            }, t);
          }
        }

        if (!mod) return;
        const ux = (x2 - x1) / (seg.dist || 1), uy = (y2 - y1) / (seg.dist || 1);

        if (mod > 0) {
          // The dot the fairway GAVE you: the last stretch of the shot, redrawn
          // thick and green with an arrowhead, so you can see the shot reach
          // one dot further than the die alone would have carried it.
          const gx = x2 - ux * mod, gy = y2 - uy * mod;
          el("line", {
            x1: gx, y1: gy, x2, y2,
            stroke: TH.boost, "stroke-width": 6, "stroke-linecap": "round", opacity: .9
          }, t);
          const ang = Math.atan2(uy, ux) * 180 / Math.PI;
          el("polygon", {
            points: "0,-4.5 8,0 0,4.5", fill: TH.boost,
            transform: `translate(${x2.toFixed(1)},${y2.toFixed(1)}) rotate(${ang.toFixed(1)})`
          }, t);
        } else {
          // The dot sand TOOK: a ghost stub past where the ball stopped, dashed
          // and open-ended so it plainly is not part of the shot.
          const lx = x2 - ux * mod, ly = y2 - uy * mod;   // mod is negative
          el("line", {
            x1: x2, y1: y2, x2: lx, y2: ly,
            stroke: TH.penalty, "stroke-width": 2.4, "stroke-dasharray": "3 4",
            "stroke-linecap": "round", opacity: .95
          }, t);
          el("circle", {
            cx: lx, cy: ly, r: 4, fill: "none",
            stroke: TH.penalty, "stroke-width": 2, opacity: .95
          }, t);
        }
      });

      // Numbered node at the end of each struck shot, plus a pill spelling out
      // the arithmetic whenever the ground changed the distance.
      const struck = p.trail.filter(s2 => s2.kind !== "slope");
      struck.forEach((seg, i) => {
        const cx = px(seg.b.x) + seg.j2x, cy = px(seg.b.y) + seg.j2y;
        const last = i === struck.length - 1 && !p.holed;
        if (!last) {
          el("circle", { cx, cy, r: 7.5, fill: TH.paper, stroke: p.color, "stroke-width": 2, opacity: .95 }, t);
          el("text", {
            x: cx, y: cy + 3.4, "text-anchor": "middle", "font-size": 9,
            "font-family": "Courier New, monospace", "font-weight": "700",
            fill: p.color, class: "shot-num"
          }, t).textContent = i + 1;
        }

        const mod = segMod(seg);
        if (!mod) return;
        const col = mod > 0 ? TH.boost : TH.penalty;
        const label = `${seg.die}${mod > 0 ? "+" : "\u2212"}${Math.abs(mod)}=${seg.dist}`;
        const mx = (px(seg.a.x) + cx) / 2, my = (px(seg.a.y) + cy) / 2;
        const wpx = label.length * 5.6 + 10;
        const gp = el("g", { class: "shot-num" }, t);
        el("rect", {
          x: mx - wpx / 2, y: my - 19, width: wpx, height: 14, rx: 7,
          fill: TH.paper, stroke: col, "stroke-width": 1.6
        }, gp);
        el("text", {
          x: mx, y: my - 8.6, "text-anchor": "middle", "font-size": 9.2,
          "font-family": "Courier New, monospace", "font-weight": "700", fill: col
        }, gp).textContent = label;
      });
    });
  }

  function drawBalls() {
    const b = $("#balls"); b.innerHTML = "";
    S.ps.forEach((p, i) => {
      if (p.holed) return;
      const grp = el("g", { class: "ball-current", id: "ball-" + i }, b);
      el("circle", { cx: px(p.pos.x), cy: px(p.pos.y), r: 7, fill: theme().paper, stroke: p.color, "stroke-width": 3.2 }, grp);
      // The player about to shoot gets a pulsing halo for the whole turn, so
      // the board itself says who is up -- not just the side panel.
      if (i === S.cur && S.phase !== "between" && S.phase !== "over") {
        el("circle", {
          cx: px(p.pos.x), cy: px(p.pos.y), r: 12, fill: "none",
          stroke: p.color, "stroke-width": 2, "stroke-dasharray": "3 4",
          opacity: .85, class: S.ps.length > 1 ? "ball-halo" : ""
        }, grp);
      }
    });
  }

  /* ---------------- aim UI ---------------- */
  function showAim(n, kind) {
    const aim = $("#aim"); aim.innerHTML = "";
    const bd = document.getElementById("board");
    if (bd) bd.classList.add("aiming");
    $("#preview").innerHTML = "";
    const p = P();
    const results = legalDirs(p.pos, n, kind);
    let any = false;
    results.forEach((r, i) => {
      const d = DIRS[i];
      const ax = px(p.pos.x) + d.x * C * 0.95;
      const ay = px(p.pos.y) + d.y * C * 0.95;
      const grp = el("g", {
        class: "aim-arrow" + (r.ok ? "" : " blocked"),
        transform: `translate(${ax},${ay}) rotate(${i * 45})`,
        tabindex: r.ok ? 0 : -1, role: "button",
        "aria-label": r.ok ? "hit " + n : (r.reason || "blocked")
      }, aim);
      /* These have to be obviously CONTROLS, not map symbols. The board is
       * already full of arrows -- mounds, hollows, wind -- so a plain triangle
       * reads as terrain. Each aim target is a solid disc in the player's own
       * colour with a white chevron inside: a different shape language, tied to
       * whoever is shooting, and legible on any terrain underneath. */
      // Fingers need a bigger target than a mouse pointer does.
      const touch = coarse();
      const HR = touch ? 25 : 17, CR = touch ? 15 : 11, HS = touch ? 1.35 : 1;
      el("circle", { class: "hit", cx: 0, cy: 0, r: HR }, grp);
      if (r.ok) {
        el("circle", { class: "chip-sh", cx: 0, cy: 1.5, r: CR }, grp);          // drop shadow
        el("circle", { class: "chip", cx: 0, cy: 0, r: CR, fill: p.color }, grp);
        el("polygon", {
          class: "head",
          points: [[0, -5.5], [4.6, 2.4], [0, 0.4], [-4.6, 2.4]]
            .map(q => `${(q[0] * HS).toFixed(2)},${(q[1] * HS).toFixed(2)}`).join(" ")
        }, grp);
      } else {
        el("circle", { class: "chip blocked-chip", cx: 0, cy: 0, r: CR * 0.82 }, grp);
        const k = 4 * HS;
        el("line", { class: "no1", x1: -k, y1: -k, x2: k, y2: k }, grp);
        el("line", { class: "no1", x1: k, y1: -k, x2: -k, y2: k }, grp);
      }
      el("title", {}, grp).textContent = r.ok ? `Hit ${n} this way` : (r.reason || "blocked");
      if (r.ok) {
        any = true;
        grp.addEventListener("mouseenter", () => preview(p.pos, r));
        grp.addEventListener("mouseleave", () => { $("#preview").innerHTML = ""; });
        grp.addEventListener("focus", () => preview(p.pos, r));
        grp.addEventListener("blur", () => { $("#preview").innerHTML = ""; });
        const go = () => commitMove(r, kind);
        grp.addEventListener("click", go);
        grp.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      } else {
        grp.addEventListener("click", () => { SFX.nope(); msg(`Not that way \u2014 ${r.reason}.`); });
      }
    });
    return any;
  }

  function preview(from, r) {
    const pv = $("#preview"); pv.innerHTML = "";
    el("line", {
      x1: px(from.x), y1: px(from.y), x2: px(r.land.x), y2: px(r.land.y),
      stroke: P().color, "stroke-width": 2.5, "stroke-dasharray": "5 6", opacity: .65, class: "preview-line"
    }, pv);
    el("circle", { cx: px(r.land.x), cy: px(r.land.y), r: 6.5, fill: "none", stroke: P().color, "stroke-width": 2, "stroke-dasharray": "2 3", opacity: .8, class: "preview-line" }, pv);
  }

  /* ---------------- executing a shot ---------------- */
  function animateSegment(a, b, kind, color, done) {
    const t = $("#trails");
    const fromT = terrainAt(a);
    const travelled = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    const seg = {
      a, b, kind,
      // The die face and the dots actually travelled. The modifier is DERIVED
      // from these two rather than from the terrain, because effMove() clamps to
      // 1..7 -- rolling a 1 out of sand still travels 1 dot, so the terrain says
      // "-1" while nothing was actually lost. Putts always move 1 and are never
      // modified, so they carry no die at all.
      die: kind === "roll" ? S.rolled : null,
      dist: travelled,
      j1x: jitter(), j1y: jitter(), j2x: jitter(), j2y: jitter()
    };
    P().trail.push(seg);
    const line = el("line", {
      x1: px(a.x) + seg.j1x, y1: px(a.y) + seg.j1y,
      x2: px(b.x) + seg.j2x, y2: px(b.y) + seg.j2y,
      stroke: color, "stroke-width": 3, class: "stroke-line",
      opacity: kind === "slope" ? .55 : .9,
      "stroke-dasharray": kind === "slope" ? "2 6" : "none"
    }, t);
    const ax = px(a.x) + seg.j1x, ay = px(a.y) + seg.j1y;
    const bx = px(b.x) + seg.j2x, by = px(b.y) + seg.j2y;
    const len = Math.hypot(bx - ax, by - ay);
    const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Reduced motion (or a slope trickle) keeps the old quick line draw.
    if (calm) {
      if (kind !== "slope") {
        line.setAttribute("stroke-dasharray", len);
        line.setAttribute("stroke-dashoffset", len);
        line.style.transition = "stroke-dashoffset .18s linear";
        requestAnimationFrame(() => requestAnimationFrame(() => line.setAttribute("stroke-dashoffset", 0)));
      }
      setTimeout(done, kind === "slope" ? 140 : 220);
      return;
    }

    /* The ball is struck and flies: it lifts off the paper (drawn as growing,
     * with its shadow sliding out and shrinking), then lands, bounces twice and
     * settles. The trail is drawn exactly in step with it, so the line is the
     * ball's path rather than a separate effect. */
    line.setAttribute("stroke-dasharray", len);
    line.setAttribute("stroke-dashoffset", len);

    const rolling = kind === "slope";
    const FLIGHT = rolling ? 190 : Math.max(300, Math.min(660, 240 + len * 1.15));
    const SETTLE = rolling ? 90 : 200;
    const PEAK = rolling ? 3 : Math.min(16, 7 + len * 0.055);

    const live = document.getElementById("ball-" + S.cur);
    if (live) live.style.opacity = "0";

    const fly = el("g", { "pointer-events": "none" }, t);
    const shadow = el("ellipse", { cx: ax, cy: ay, rx: 5, ry: 3.2, fill: "#1c1f1a", opacity: .2 }, fly);
    const bob = el("circle", { cx: ax, cy: ay, r: 6, fill: color, stroke: "#FAF8F2", "stroke-width": 1.6 }, fly);
    let ring = null;

    const ease = u => 1 - Math.pow(1 - u, 2);        // decelerating flight
    let t0 = null;

    function step(ts) {
      if (t0 == null) t0 = ts;
      const el2 = ts - t0;

      if (el2 <= FLIGHT) {
        const u = el2 / FLIGHT, e = rolling ? u : ease(u);
        const x = ax + (bx - ax) * e, y = ay + (by - ay) * e;
        const lift = Math.sin(Math.PI * u) * PEAK;
        bob.setAttribute("cx", x); bob.setAttribute("cy", y - lift);
        bob.setAttribute("r", (6 + lift * 0.09).toFixed(2));
        shadow.setAttribute("cx", x + lift * 0.18);
        shadow.setAttribute("cy", y + 1.5);
        shadow.setAttribute("rx", (5 - lift * 0.07).toFixed(2));
        shadow.setAttribute("ry", (3.2 - lift * 0.05).toFixed(2));
        shadow.setAttribute("opacity", (0.2 - lift * 0.006).toFixed(3));
        line.setAttribute("stroke-dashoffset", len * (1 - e));
        requestAnimationFrame(step);

      } else if (el2 <= FLIGHT + SETTLE) {
        const u = (el2 - FLIGHT) / SETTLE;
        if (!ring && !rolling) {
          ring = el("circle", { cx: bx, cy: by, r: 3, fill: "none", stroke: color, "stroke-width": 2, opacity: .55 }, fly);
        }
        // two decaying hops on the spot
        const hop = Math.abs(Math.sin(Math.PI * 2 * u)) * (rolling ? 2 : 5) * (1 - u);
        bob.setAttribute("cx", bx); bob.setAttribute("cy", by - hop);
        bob.setAttribute("r", (6 - (hop < 0.4 ? 0.7 : 0)).toFixed(2));   // squash on contact
        shadow.setAttribute("cx", bx); shadow.setAttribute("cy", by + 1.5);
        shadow.setAttribute("rx", 5); shadow.setAttribute("ry", 3.2);
        shadow.setAttribute("opacity", 0.2);
        line.setAttribute("stroke-dashoffset", 0);
        if (ring) {
          ring.setAttribute("r", (3 + u * 12).toFixed(1));
          ring.setAttribute("opacity", (0.55 * (1 - u)).toFixed(3));
        }
        requestAnimationFrame(step);

      } else {
        line.setAttribute("stroke-dashoffset", 0);
        fly.remove();
        if (live) live.style.opacity = "";
        done();
      }
    }
    requestAnimationFrame(step);
  }

  function commitMove(r, kind) {
    if (S.phase !== "aim") return;
    S.phase = "anim";
    $("#aim").innerHTML = ""; $("#preview").innerHTML = "";
    const bdc = document.getElementById("board");
    if (bdc) bdc.classList.remove("aiming");
    const p = P();
    p.strokes++;
    // each club has its own strike
    if (kind === "putt") SFX.putt();
    else if (kind === "iron") SFX.iron();
    else SFX.hit(kind === "driver" ? "driver" : "swing");
    const from = { ...p.pos };
    logShot(p, kind, from, r);
    animateSegment(from, r.land, kind, p.color, () => {
      p.pos = { ...r.land };
      drawBalls();
      if (r.holed) return sink();
      // slopes
      const sl = resolveSlopes(p.pos);
      if (sl.steps.length) {
        SFX.slope();
        let i = 0, prev = { ...p.pos };
        const step = () => {
          if (i >= sl.steps.length) {
            p.pos = { ...sl.end }; drawBalls();
            if (sl.holed) return sink();
            return endOfShot();
          }
          const nxt = sl.steps[i++];
          animateSegment(prev, nxt, "slope", p.color, () => { prev = nxt; p.pos = { ...nxt }; drawBalls(); step(); });
        };
        step();
      } else endOfShot();
    });
  }

  /**
   * Celebration at the cup: a confetti burst plus an expanding ring. Rendered as
   * an absolutely-positioned overlay inside the board wrapper with
   * pointer-events off, so it cannot touch layout or be captured in a saved
   * image. Scales with how good the score was.
   */
  function celebrate(p, strokes) {
    const host = $("#board-wrap");
    const svg = document.getElementById("board");
    if (!host || !svg) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const G = g();
    const r = svg.getBoundingClientRect(), h = host.getBoundingClientRect();
    const vw = Number(svg.dataset.vw) || 1, vh = Number(svg.dataset.vh) || 1;
    const cxp = (r.left - h.left) + (px(G.hole.x) / vw) * r.width;
    const cyp = (r.top - h.top) + (px(G.hole.y) / vh) * r.height;

    const layer = document.createElement("div");
    layer.className = "party";
    layer.style.left = cxp + "px";
    layer.style.top = cyp + "px";

    // a hole-in-one deserves noticeably more than a bogey
    const under = 6 - strokes;
    const count = strokes === 1 ? 46 : under >= 2 ? 34 : under >= 0 ? 24 : 14;
    const TH = theme();
    const palette = [p.color, TH.boost, TH.slope, "#E8C15A", TH.cup];

    const ring = document.createElement("div");
    ring.className = "party-ring";
    ring.style.borderColor = p.color;
    layer.appendChild(ring);

    for (let i = 0; i < count; i++) {
      const bit = document.createElement("i");
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const dist2 = 42 + Math.random() * (strokes === 1 ? 120 : 78);
      bit.className = "confetti";
      bit.style.background = palette[(Math.random() * palette.length) | 0];
      bit.style.setProperty("--dx", (Math.cos(ang) * dist2).toFixed(1) + "px");
      bit.style.setProperty("--dy", (Math.sin(ang) * dist2 - 26).toFixed(1) + "px");
      bit.style.setProperty("--rot", ((Math.random() * 720) - 360).toFixed(0) + "deg");
      bit.style.setProperty("--del", (Math.random() * 0.12).toFixed(2) + "s");
      bit.style.setProperty("--dur", (0.85 + Math.random() * 0.55).toFixed(2) + "s");
      if (Math.random() < 0.4) bit.style.borderRadius = "50%";
      const sz = 4 + Math.random() * 4;
      bit.style.width = sz.toFixed(1) + "px";
      bit.style.height = (sz * (0.5 + Math.random() * 0.8)).toFixed(1) + "px";
      layer.appendChild(bit);
    }
    host.appendChild(layer);
    setTimeout(() => layer.remove(), 1900);
  }

  function sink() {
    const p = P();
    p.holed = true;
    p.scores[S.holeIdx] = p.strokes;
    SFX.sink();
    const ball = $("#ball-" + S.cur);
    if (ball) ball.classList.add("sinking");
    celebrate(p, p.strokes);
    const par = 6, diff = p.strokes - par;
    const word = p.strokes === 1 ? "HOLE IN ONE!" :
      diff <= -3 ? "Albatross!" : diff === -2 ? "Eagle!" : diff === -1 ? "Birdie!" :
      diff === 0 ? "Par." : diff === 1 ? "Bogey." : diff === 2 ? "Double bogey." : "In the book.";
    setTimeout(() => {
      msg(`${p.name} sinks it in ${p.strokes} \u2014 ${word}`);
      endOfShot(true);
    }, 550);
  }

  function endOfShot(justHoled) {
    drawTrails(); drawBalls();   // repaint so the numbered shot markers appear
    updateFoot();
    renderScorecard();
    if (S.ps.every(p => p.holed)) return holeComplete();
    nextPlayer();
    startTurn(justHoled);
  }

  function nextPlayer() {
    // tee order first, then furthest-from-the-cup shoots next
    const waiting = S.ps.findIndex(p => !p.holed && p.strokes === 0);
    if (waiting >= 0) { S.cur = waiting; return; }
    let best = -1, bd = -1;
    S.ps.forEach((p, i) => { if (!p.holed) { const d = dist(p.pos); if (d > bd) { bd = d; best = i; } } });
    S.cur = best;
  }

  /** Brief overlay naming the next shooter, on player change in multiplayer. */
  function turnToast(p) {
    if (S.ps.length < 2) return;
    const host = $("#board-wrap");
    if (!host) return;
    const old2 = host.querySelector(".turn-toast");
    if (old2) old2.remove();
    const el2 = document.createElement("div");
    el2.className = "turn-toast";
    el2.style.setProperty("--turn", p.color);
    el2.innerHTML = `<span class="tt-dot"></span>${p.name}'s turn`;
    host.appendChild(el2);
    setTimeout(() => el2.remove(), 1500);
  }

  /* ---------------- turn machine ---------------- */
  function startTurn(quiet) {
    const p = P();
    // pickup cap so a cursed hole can't go forever
    if (p.strokes >= STROKE_CAP) {
      p.holed = true; p.scores[S.holeIdx] = STROKE_CAP;
      msg(`${p.name} picks up at ${STROKE_CAP}. Next time.`);
      if (S.ps.every(q => q.holed)) return holeComplete();
      nextPlayer();
      return startTurn(true);
    }
    if (S.lastShooter !== S.cur) { turnToast(P()); S.lastShooter = S.cur; }
    S.phase = "roll";
    S.rolled = 0;
    updateTurnCard(); updateMulligans(); drawBalls();
    if (!quiet) msg(S.mode === "dice"
      ? `${p.name}, roll the die.`
      : `${p.name}, pick a club.`);
    renderControls();
  }

  function effMove(rolled, fromT) {
    let n = rolled + (fromT === T.FAIR ? 1 : 0) + (fromT === T.SAND ? -1 : 0);
    return Math.max(1, Math.min(7, n));
  }

  async function doRoll() {
    if (S.phase === "anim") return; // re-entry guard
    const p = P();
    S.phase = "anim";
    renderControls();
    const v = 1 + ((Math.random() * 6) | 0);
    msg("The die is out\u2026");
    await Dice.roll($("#dice-stage"), v, p.color);
    S.rolled = v;
    S.phase = "rolled";
    const fromT = terrainAt(p.pos);
    const n = effMove(v, fromT);
    S.moveN = n; S.moveKind = "roll"; S.rollMoveN = n;
    const mod = fromT === T.FAIR ? " +1 fairway" : fromT === T.SAND ? " \u22121 sand" : "";
    msg(`Rolled ${v}${mod} \u2192 the ball will travel ${n}. Pick a direction${n > 1 ? ", or putt instead" : ""}.`);
    enterAim(n, "roll");
    renderControls();
  }

  function enterAim(n, kind) {
    S.phase = "aim";
    S.moveN = n; S.moveKind = kind;
    drawBalls();
    const any = showAim(n, kind);
    if (!any) {
      // nowhere to go at this distance
      if (kind !== "putt" && legalDirs(P().pos, 1, "putt").some(r => r.ok)) {
        msg(`No clear line for ${n}. Try a putt${S.mode === "dice" ? " or spend a mulligan" : ""}.`);
        S.phase = "rolled";
      } else if (kind !== "putt") {
        msg(S.mode === "dice"
          ? "Completely boxed in \u2014 take a free re-roll."
          : "Completely boxed in \u2014 try another club.");
        S.phase = "rolled";
      } else {
        msg(`Even the putt is blocked. Unplayable: +1 stroke, ${S.mode === "dice" ? "roll" : "swing"} again.`);
        P().strokes++;
        updateFoot();
        if (P().strokes >= STROKE_CAP) return startTurn(); // cap check → forced pickup
        S.phase = "roll";
      }
      renderControls();
    }
  }

  /* ---------------- controls panel ---------------- */
  function btn(label, cls, fn, disabled) {
    const b = document.createElement("button");
    b.className = "btn " + (cls || "");
    b.innerHTML = label;
    if (disabled) b.disabled = true;
    b.addEventListener("click", fn);
    return b;
  }

  function renderControls() {
    const hint = $("#roll-hint");
    if (hint) hint.classList.toggle("hidden", !(S.phase === "roll" && phoneQ()));
    const c = $("#controls"); c.innerHTML = "";
    const p = P();
    if (!p || S.phase === "between" || S.phase === "over") return;
    const fromT = terrainAt(p.pos);

    if (S.mode === "dice") {
      if (S.phase === "roll") {
        c.appendChild(btn("Roll the die", "primary big", () => doRoll()));
      } else if (S.phase === "rolled" || S.phase === "aim") {
        const rollN = S.rollMoveN || S.moveN;
        const putting = S.moveKind === "putt";
        const ro = document.createElement("div");
        ro.className = "roll-readout" + (putting ? " putting" : "");
        ro.innerHTML = `<span class="num">${putting ? 1 : (S.rolled || "?")}</span>
          <span class="calc">${putting
            ? `putting instead<br>of the ${rollN}`
            : `${fromT === T.FAIR ? "+1 fairway" : fromT === T.SAND ? "\u22121 sand" : "flat lie"}<br>moves ${S.moveN}`}</span>`;
        c.appendChild(ro);
        const row = document.createElement("div"); row.className = "row";
        // The choice between the roll and a putt is a TOGGLE. Previously picking
        // "Putt" threw the roll away with no way back.
        if (putting) {
          row.appendChild(btn(`Use the ${rollN}`, "", () => {
            enterAim(rollN, "roll"); renderControls();
          }, rollN === 1));
        } else {
          row.appendChild(btn("Putt (1)", "", () => {
            enterAim(1, "putt"); renderControls();
          }, rollN === 1));
        }
        const isTee = p.strokes === 0;
        if (isTee && !p.teeRerollUsed) {
          row.appendChild(btn("Tee re-roll", "", () => { p.teeRerollUsed = true; doRoll(); }));
        } else {
          row.appendChild(btn(`Mulligan (${p.mulligans})`, "", () => {
            if (p.mulligans <= 0) return; p.mulligans--; updateMulligans(); doRoll();
          }, p.mulligans <= 0));
        }
        c.appendChild(row);
      }
    } else { // speed golf
      if (S.phase === "roll" || S.phase === "rolled" || S.phase === "aim") {
        const row = document.createElement("div"); row.className = "row";
        row.appendChild(btn("Driver&nbsp;6", "", () => { enterAim(6, "driver"); markClub(row, 0); },
          fromT !== T.FAIR));
        row.appendChild(btn("Iron&nbsp;" + (fromT === T.SAND ? 2 : 3), "", () => { enterAim(fromT === T.SAND ? 2 : 3, "iron"); markClub(row, 1); }));
        row.appendChild(btn("Putter&nbsp;1", "", () => { enterAim(1, "putt"); markClub(row, 2); }));
        c.appendChild(row);
        const hint = document.createElement("div");
        hint.className = "hint";
        hint.textContent = fromT === T.FAIR ? "Driver flies over trees." : fromT === T.SAND ? "Sand: iron only carries 2." : "From the rough: iron or putter.";
        c.appendChild(hint);
      }
    }
  }
  function markClub(row, i) {
    [...row.children].forEach((b, k) => b.classList.toggle("primary", k === i));
  }

  /* ---------------- inline legend ---------------- */
  /** Legend rows, built from the live palette so they always match the board. */
  function legendRows() {
    const T2 = theme();
    const sw = (inner) => inner;
    return [
      [`<rect x="1" y="1" width="16" height="16" rx="5" fill="${T2.fairway}"/>`, "Fairway", "+1 dot, flies trees"],
      [`<circle cx="9" cy="9" r="2" fill="${T2.roughDot}"/>`, "Rough", "no bonus"],
      [`<rect x="1" y="1" width="16" height="16" rx="5" fill="${T2.sand}"/><line x1="3" y1="15" x2="15" y2="3" stroke="${T2.sandHatch}" stroke-width="2"/>`, "Sand", "\u22121 dot"],
      [`<rect x="1" y="1" width="16" height="16" rx="5" fill="${T2.water}"/>`, "Water", "fly over, never land"],
      [`<polygon points="6,3 11,13 1,13" fill="${T2.tree}"/><circle cx="14" cy="7" r="4" fill="${T2.treeAlt}"/>`, "Trees", "block unless from fairway"],
      [`<g transform="translate(9,9) rotate(135)">` +
       `<line x1="0" y1="6" x2="0" y2="-1" stroke="${T2.mound}" stroke-width="2.2" stroke-linecap="round"/>` +
       `<polygon points="0,-7.5 4.5,-0.5 -4.5,-0.5" fill="${T2.mound}"/></g>`,
       "Mound", "solid arrows \u2014 roll 1 dot AWAY from the middle"],
      [`<g transform="translate(9,9) rotate(-45)">` +
       `<line x1="0" y1="6" x2="0" y2="-1" stroke="${T2.hollow}" stroke-width="2.2" stroke-linecap="round"/>` +
       `<polygon points="0,-7.5 4.5,-0.5 -4.5,-0.5" fill="${T2.paper}" stroke="${T2.hollow}" stroke-width="1.5"/></g>`,
       "Hollow", "open arrows \u2014 roll 1 dot TOWARD the middle"],
      [`<circle cx="9" cy="9" r="5" fill="${T2.paper}" stroke="${T2.tee}" stroke-width="2.4"/>`, "Tee", "start of the hole"],
      [`<circle cx="9" cy="9" r="5.5" fill="${T2.cup}"/>`, "Cup", "land on it, or 1 past"],
      [`<g opacity=".75"><ellipse cx="6" cy="10" rx="2.2" ry="3.4" fill="${T2.bigfoot}"/><ellipse cx="12" cy="8" rx="2.2" ry="3.4" fill="${T2.bigfoot}"/></g>`, "Bigfoot", "click for a mulligan"],
      // --- how a shot is marked up ---
      [`<line x1="1" y1="13" x2="9" y2="7" stroke="#8a8d84" stroke-width="2"/>` +
       `<line x1="9" y1="7" x2="17" y2="2" stroke="${T2.boost}" stroke-width="4.5" stroke-linecap="round"/>`,
       "+1 gained", "thick green = the dot the fairway added"],
      [`<line x1="1" y1="13" x2="10" y2="7" stroke="#8a8d84" stroke-width="2"/>` +
       `<line x1="10" y1="7" x2="15" y2="4" stroke="${T2.penalty}" stroke-width="2" stroke-dasharray="3 2"/>` +
       `<circle cx="16" cy="3" r="2.4" fill="none" stroke="${T2.penalty}" stroke-width="1.5"/>`,
       "\u22121 lost", "dashed ring = the dot sand took away"],
      [`<line x1="2" y1="14" x2="16" y2="4" stroke="#8a8d84" stroke-width="1.8"/>` +
       `<line x1="6.5" y1="8.5" x2="10.5" y2="11.5" stroke="#8a8d84" stroke-width="1.6"/>`,
       "Tick marks", "one per dot travelled"]
    ];
  }

  function renderLegend() {
    const box = $("#legend-inline");
    if (!box) return;
    box.innerHTML = legendRows().map(([icon, name, note]) =>
      `<div class="lg-row"><svg viewBox="0 0 18 18" width="17" height="17">${icon}</svg>` +
      `<b>${name}</b><span>${note}</span></div>`).join("");
  }

  /* ---------------- live scorecard ---------------- */
  function renderScorecard() {
    const box = $("#scorecard-inline");
    if (!box) return;
    const ps = S.ps;
    const cc = window.Course.courseCard(S.seed);
    let html = `<div class="sc-head">` +
      `<b>${cc.name}</b> <span class="cb-est">est. ${cc.est}</span>` +
      `<p class="sc-motto">&ldquo;${cc.motto}&rdquo;</p>` +
      `<p class="sc-colour">${cc.colour}</p></div>` +
      `<table class="sc-table"><thead><tr><th>Hole</th>` +
      ps.map(p => `<th style="color:${p.color}">${p.name.slice(0, 4)}</th>`).join("") +
      `</tr></thead><tbody>`;
    for (let h = 0; h < 18; h++) {
      const now = h === S.holeIdx ? " class=\"now\"" : "";
      html += `<tr${now}><td>${h + 1}</td>` + ps.map(p => {
        const v = p.scores[h];
        if (v == null) return `<td>${h === S.holeIdx && !p.holed ? p.strokes || "\u00B7" : "\u00B7"}</td>`;
        const cls = v < 6 ? "sc-under" : v > 6 ? "sc-over" : "";
        return `<td class="${cls}">${v}</td>`;
      }).join("") + `</tr>`;
    }
    const par = (S.holeIdx + (S.ps.some(p => p.holed) ? 1 : 0)) * 6;
    html += `<tr class="tot"><td>Total</td>` + ps.map(p => {
      const t = total(p);
      const rel = t - par;
      const tag = par > 0 ? ` <span class="${rel < 0 ? "sc-under" : rel > 0 ? "sc-over" : ""}">${rel > 0 ? "+" + rel : rel || "E"}</span>` : "";
      return `<td>${t}${tag}</td>`;
    }).join("") + `</tr></tbody></table>`;
    box.innerHTML = html;
    // keep the hole being played in view
    const cur = box.querySelector("tr.now");
    if (cur && box.scrollHeight > box.clientHeight) {
      const t = cur.offsetTop - box.clientHeight / 2;
      box.scrollTop = Math.max(0, t);
    }
  }

  /* ---------------- hover inspector ---------------- */
  const TERRAIN_INFO = {
    [T.ROUGH]: ["Rough", "Plain ground. No bonus, no penalty."],
    [T.FAIR]:  ["Fairway", "Hit from here and the ball travels 1 dot further \u2014 and flies over trees."],
    [T.SAND]:  ["Sand trap", "Hit from here and the ball travels 1 dot shorter. An iron only carries 2."],
    [T.WATER]: ["Water", "You may fly over it, but never land in it."],
    [T.TREE]:  ["Tree", "Blocks the shot and can never be landed on \u2014 unless you strike from the fairway or use a driver."]
  };

  function describeCell(x, y) {
    const G = g();
    if (!inB(G, x, y)) return null;
    const c = cell(G, x, y);
    if (G.hole.x === x && G.hole.y === y)
      return ["The cup", "Land exactly here, or cross it and stop one dot past, to sink the ball."];
    if (G.tee.x === x && G.tee.y === y)
      return ["The tee", "Where this hole starts. Your first shot may be re-rolled once for free."];
    const bf = S.course.bigfoot;
    if (bf && bf.hole === S.holeIdx && !S.bigfootFound && bf.x === x && bf.y === y)
      return ["Something in the grass\u2026", "Click it. You might be glad you did."];
    for (const p of S.ps) {
      if (p.pos.x === x && p.pos.y === y && !p.holed)
        return [p.name + "'s ball", "Currently lying on " + lieName(c.t) + "."];
    }
    if (c.slope >= 0) {
      const dn = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][c.slope];
      const h = (G.hills || []).find(hh =>
        x >= hh.x && x < hh.x + hh.n && y >= hh.y && y < hh.y + hh.n);
      const size = h ? `${h.n}\u00D7${h.n}` : "";
      if (h) {
        return [
          `${size} ${h.kind} \u2014 rolls ${dn}`,
          h.kind === "mound"
            ? "A mound sheds the ball: it rolls one dot away from the peak, and keeps rolling across anything it meets."
            : "A hollow gathers the ball: it rolls one dot toward the bottom, and keeps rolling across anything it meets."
        ];
      }
      return ["Slope \u2014 runs " + dn, "A ball landing here rolls one dot " + dn + ", and keeps rolling."];
    }
    return TERRAIN_INFO[c.t] || null;
  }

  function wireHover(svg) {
    const tip = $("#board-tip");
    if (!tip) return;
    let cur = "";

    /** Describe whatever square is under this screen point. */
    function inspectAt(clientX, clientY, force) {
      const pt = svg.getBoundingClientRect();
      const sx = (clientX - pt.left) / pt.width * (Number(svg.dataset.vw) || 1);
      const sy = (clientY - pt.top) / pt.height * (Number(svg.dataset.vh) || 1);
      const x = Math.floor(sx / C), y = Math.floor(sy / C);
      const info = describeCell(x, y);
      const key = info ? x + "," + y : "";
      if (key === cur && !force) return;
      cur = key;
      if (!info) { tip.classList.add("hidden"); return; }
      tip.innerHTML = `<b>${info[0]}</b><span>${info[1]}</span>`;
      tip.classList.remove("hidden");
      if (phoneQ()) {                       // it floats over the board and fades
        clearTimeout(tipTimer);
        tipTimer = setTimeout(() => { cur = ""; tip.classList.add("hidden"); }, 2600);
      }
    }
    let tipTimer = null;

    svg.addEventListener("mousemove", e => inspectAt(e.clientX, e.clientY));
    svg.addEventListener("mouseleave", () => { cur = ""; tip.classList.add("hidden"); });

    /* Touch has no hover, so a tap on the board reads out the square instead.
     * Taps that land on an aim target are left alone -- those take the shot. */
    svg.addEventListener("pointerdown", e => {
      if (e.pointerType === "mouse") return;
      if (e.target.closest && e.target.closest(".aim-arrow")) return;
      // On a phone the page IS the roll button -- there is no room for a
      // separate one, and flicking the paper is how you'd do it for real.
      if (S.phase === "roll" && phoneQ()) { doRoll(); return; }
      inspectAt(e.clientX, e.clientY, true);
    }, { passive: true });
  }

  /* ---------------- caddie chatter ---------------- */

  function nearWater(pos) {
    const G = g();
    for (const d of DIRS) {
      const x = pos.x + d.x, y = pos.y + d.y;
      if (inB(G, x, y) && cell(G, x, y).t === T.WATER) return true;
    }
    return false;
  }

  /** Which pool of lines fits this player's situation right now. */
  function caddieBucket(p) {
    const G = g();
    const dist = Math.max(Math.abs(p.pos.x - G.hole.x), Math.abs(p.pos.y - G.hole.y));
    const lie = terrainAt(p.pos);

    if (p.strokes === 0) {
      if (S.holeIdx === 17) return "final";
      // In a multiplayer round, comment on the standings at the tee.
      if (S.ps.length > 1 && S.holeIdx > 0) {
        const totals = S.ps.map(q => total(q));
        const mine = total(p);
        const best = Math.min(...totals), worst = Math.max(...totals);
        if (mine === best && worst - mine >= 2) return "lead";
        if (mine === worst && mine - best >= 2) return "behind";
      }
      return "tee";
    }
    if (p.strokes >= 7) return "deep";
    if (dist <= 2) return "close";
    if (lie === T.SAND) return "sand";
    if (nearWater(p.pos)) return "water";
    if (lie === T.FAIR) return "fairway";
    if (dist >= 12) return "trouble";
    return "rough";
  }

  function updateCaddie() {
    const box = $("#caddie");
    if (!box) return;
    if (S.phase === "over") { box.classList.add("hidden"); return; }
    const p = P();
    // One line per turn: the card re-renders several times per shot, and each
    // render must not burn another line off the deck.
    const key = `${S.holeIdx}|${S.cur}|${p.strokes}`;
    let fresh = false;
    if (key !== S.caddieKey) {
      S.caddieKey = key;
      S.caddieText = Caddie.take(caddieBucket(p));
      fresh = true;
    }
    box.classList.remove("hidden");
    box.innerHTML = `<span class="caddie-label">Caddie</span><p>${S.caddieText}</p>`;
    if (fresh && typeof phoneQ === "function" && phoneQ()) caddieToast(S.caddieText);
  }

  /** On a phone the caddie has no room to live permanently, so it drops in. */
  let caddieTimer = null;
  function caddieToast(text) {
    const host = $("#board-wrap");
    if (!host) return;
    const prev = host.querySelector(".caddie-toast");
    if (prev) prev.remove();
    const t = document.createElement("div");
    t.className = "caddie-toast";
    t.textContent = text;
    host.appendChild(t);
    clearTimeout(caddieTimer);
    caddieTimer = setTimeout(() => t.remove(), 4200);
  }

  /* ---------------- shot history ---------------- */
  const DIR_NAMES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

  function dirName(from, to) {
    const dx = Math.sign(to.x - from.x), dy = Math.sign(to.y - from.y);
    const i = window.Course.DIRS.findIndex(d => d.x === dx && d.y === dy);
    return i >= 0 ? DIR_NAMES[i] : "";
  }

  function logShot(p, kind, from, r) {
    const clubName = kind === "driver" ? "Driver" : kind === "iron" ? "Iron"
      : kind === "putt" ? "Putt" : "Hit";
    // Record the die face and the dots actually travelled; the modifier is the
    // difference between them, so the history can never claim a bonus or
    // penalty that the shot did not really receive.
    let roll = null;
    if (kind === "roll") {
      roll = { die: S.rolled, moved: S.moveN, mod: S.moveN - S.rolled };
    }
    S.log.push({
      hole: S.holeIdx,
      pi: S.cur,
      name: p.name,
      color: p.color,
      stroke: p.strokes,
      club: clubName,
      roll,
      dir: dirName(from, r.land),
      dist: Math.max(Math.abs(r.land.x - from.x), Math.abs(r.land.y - from.y)),
      lie: lieName(terrainAt(r.land)),
      holed: !!r.holed,
      note: r.overshoot ? "rattled in from one past" : ""
    });
    renderHistory();
  }

  // A little inline die showing the exact face that was rolled.
  const DIE_PIPS = { 1:[[8,8]], 2:[[4,4],[12,12]], 3:[[4,4],[8,8],[12,12]],
    4:[[4,4],[12,4],[4,12],[12,12]], 5:[[4,4],[12,4],[8,8],[4,12],[12,12]],
    6:[[4,4],[12,4],[4,8],[12,8],[4,12],[12,12]] };
  function dieGlyph(v, color) {
    const pips = (DIE_PIPS[v] || []).map(([x, y]) =>
      `<circle cx="${x}" cy="${y}" r="1.6" fill="${color || "#24262B"}"/>`).join("");
    return `<svg class="h-die" viewBox="0 0 16 16" width="15" height="15" aria-label="rolled ${v}">` +
      `<rect x="0.8" y="0.8" width="14.4" height="14.4" rx="3.2" fill="#FAF8F2" stroke="#24262B" stroke-width="1.3"/>` +
      pips + `</svg>`;
  }

  function renderHistory() {
    const box = $("#history-list");
    if (!box) return;
    if (!S.log.length) {
      box.innerHTML = `<p class="history-empty">Every shot you take gets written down here.</p>`;
      return;
    }
    const multi = S.ps.length > 1;
    let html = "", lastHole = -1;
    // newest hole first so the current action is always visible without scrolling
    const byHole = new Map();
    S.log.forEach(e => {
      if (!byHole.has(e.hole)) byHole.set(e.hole, []);
      byHole.get(e.hole).push(e);
    });
    [...byHole.keys()].sort((a, b) => b - a).forEach(h => {
      html += `<div class="history-hole"><div class="history-hole-h">Hole ${h + 1}</div>`;
      byHole.get(h).slice().reverse().forEach(e => {
        const who = multi
          ? `<span class="h-who" style="color:${e.color}">\u25CF ${e.name}</span> `
          : "";
        let what;
        if (e.roll) {
          const md = e.roll.mod;
          const sum = md
            ? ` <span class="h-mod ${md > 0 ? "up" : "dn"}">${md > 0 ? "+" : "\u2212"}${Math.abs(md)} ${md > 0 ? "fairway" : "sand"}</span>` +
              ` <span class="h-eq">= ${e.roll.moved}</span>`
            : "";
          what = `${dieGlyph(e.roll.die, e.color)}${sum} <span class="h-move">\u2192 ${md ? "" : e.roll.moved + " "}${e.dir}</span>`;
        } else {
          what = `<span class="h-club">${e.club}</span> <span class="h-move">\u2192 ${e.dist} ${e.dir}</span>`;
        }
        const tail = e.holed
          ? ` <span class="h-sunk">sunk in ${e.stroke}</span>`
          : ` <span class="h-lie">\u2192 ${e.lie}</span>`;
        html += `<div class="history-row">${who}<span class="h-n">${e.stroke}.</span> ${what}${tail}${e.note ? ` <i>(${e.note})</i>` : ""}</div>`;
      });
      html += `</div>`;
    });
    box.innerHTML = html;
    box.scrollTop = 0;
  }

  /* ---------------- board snapshot download ---------------- */
  function boardSnapshotSVG() {
    const live = document.getElementById("board");
    if (!live) return null;
    const vw = Number(live.dataset.vw), vh = Number(live.dataset.vh);
    const NS = "http://www.w3.org/2000/svg";
    const mk = (tag, attrs, parent, txt) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      if (txt != null) n.textContent = txt;
      if (parent) parent.appendChild(n);
      return n;
    };
    const MONO = "Courier New, Courier, monospace";
    const T_ = (p_, x, y, size, weight, fill, str, anchor) =>
      mk("text", { x, y, "font-family": MONO, "font-size": size, "font-weight": weight,
        fill, "text-anchor": anchor || "start" }, p_, str);

    // ---- geometry ----
    const PAD = 26, GAP = 22, PANEL = 320;
    const HEAD = 92, FOOT = 40;
    const bodyH = Math.max(vh, 300);
    const W = PAD + vw + GAP + PANEL + PAD;
    const H = PAD + HEAD + bodyH + FOOT + PAD;

    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("xmlns", NS);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", W); svg.setAttribute("height", H);

    // paper + dot grid + border
    mk("rect", { width: W, height: H, fill: theme().paper }, svg);
    const defs = mk("defs", {}, svg);
    const pat = mk("pattern", { id: "snapdots", width: 26, height: 26, patternUnits: "userSpaceOnUse" }, defs);
    mk("circle", { cx: 13, cy: 13, r: 1, fill: "#DCD8CC" }, pat);
    mk("rect", { width: W, height: H, fill: "url(#snapdots)" }, svg);
    mk("rect", { x: 8, y: 8, width: W - 16, height: H - 16, fill: "none",
      stroke: "#24262B", "stroke-width": 2, rx: 10 }, svg);

    // ---- header ----
    const hx = PAD, hy = PAD;
    T_(svg, hx, hy + 26, 30, 700, "#24262B", "MEH GOLF");
    T_(svg, hx + 200, hy + 26, 15, 400, "#5b5e57", "\u00B7  " + S.course.name);
    T_(svg, hx, hy + 50, 15, 700, "#24262B", `HOLE ${S.holeIdx + 1} OF 18`);
    T_(svg, hx + 150, hy + 50, 13, 400, "#6a6d64", "Par 6");
    const blurb = window.Course.courseBlurb(S.seed);
    const per = Math.floor((W - PAD * 2 - 210) / 5.4);
    T_(svg, hx, hy + 68, 10, 400, "#8a8d84", blurb.length > per ? blurb.slice(0, per - 1) + "\u2026" : blurb);

    // seed badge, right aligned
    const badgeW = 190, badgeX = W - PAD - badgeW;
    mk("rect", { x: badgeX, y: hy + 4, width: badgeW, height: 46, rx: 8,
      fill: "#24262B" }, svg);
    T_(svg, badgeX + badgeW / 2, hy + 22, 9, 700, "#FAF8F2", "COURSE CODE", "middle");
    T_(svg, badgeX + badgeW / 2, hy + 42, 20, 700, "#FAF8F2", S.seed, "middle");

    mk("line", { x1: PAD, y1: hy + HEAD - 16, x2: W - PAD, y2: hy + HEAD - 16,
      stroke: "#24262B", "stroke-width": 2 }, svg);

    // ---- board ----
    const bx = PAD, by = PAD + HEAD;
    const clone = live.cloneNode(true);
    clone.removeAttribute("id"); clone.removeAttribute("style"); clone.removeAttribute("aria-label");
    ["aim", "preview", "ambience"].forEach(id => { const n = clone.querySelector("#" + id); if (n) n.remove(); });
    const st = clone.querySelector("style"); if (st) st.remove();   // animation keyframes
    clone.setAttribute("x", bx); clone.setAttribute("y", by);
    clone.setAttribute("width", vw); clone.setAttribute("height", vh);
    clone.setAttribute("viewBox", `0 0 ${vw} ${vh}`);
    mk("rect", { x: bx - 6, y: by - 6, width: vw + 12, height: vh + 12, rx: 8,
      fill: "#fff", stroke: "#E2DED2", "stroke-width": 1 }, svg);
    svg.appendChild(clone);

    // ---- side panel ----
    const px0 = PAD + vw + GAP, pw = PANEL;
    let cy = by;

    // scores block
    mk("rect", { x: px0, y: cy, width: pw, height: 26 + S.ps.length * 22, rx: 8,
      fill: "#F1EEE5", stroke: "#24262B", "stroke-width": 1.5 }, svg);
    T_(svg, px0 + 12, cy + 17, 10, 700, "#6a6d64", "THIS HOLE");
    S.ps.forEach((p, i) => {
      const ry = cy + 38 + i * 22;
      mk("circle", { cx: px0 + 18, cy: ry - 4, r: 5, fill: p.color }, svg);
      T_(svg, px0 + 32, ry, 13, 700, "#24262B", p.name);
      const sc = p.scores[S.holeIdx];
      T_(svg, px0 + pw - 12, ry, 13, 700, "#24262B",
        (sc == null ? p.strokes + " so far" : sc + " strokes"), "end");
    });
    cy += 26 + S.ps.length * 22 + 16;

    // history
    T_(svg, px0 + 2, cy + 10, 10, 700, "#6a6d64", "SHOT HISTORY");
    mk("line", { x1: px0, y1: cy + 18, x2: px0 + pw, y2: cy + 18,
      stroke: "#24262B", "stroke-width": 1.5 }, svg);
    cy += 34;

    const rows = S.log.filter(e => e.hole === S.holeIdx);
    const ROW = 26, avail = by + bodyH - cy - 6;
    const maxRows = Math.max(1, Math.floor(avail / ROW));
    const shown = rows.slice(0, maxRows);
    const multi = S.ps.length > 1;

    shown.forEach((e, i) => {
      const ry = cy + i * ROW;
      if (i % 2 === 0) mk("rect", { x: px0 - 4, y: ry - 13, width: pw + 8, height: ROW,
        fill: "#F5F2EA", rx: 4 }, svg);
      let tx = px0 + 2;
      T_(svg, tx, ry, 11, 700, "#A8A59A", e.stroke + ".");
      tx += 20;
      if (e.roll) {
        // draw the actual die face
        const dg = mk("g", { transform: `translate(${tx},${ry - 13})` }, svg);
        mk("rect", { width: 17, height: 17, rx: 4, fill: "#fff",
          stroke: "#24262B", "stroke-width": 1.4 }, dg);
        (DIE_PIPS[e.roll.die] || []).forEach(([qx, qy]) =>
          mk("circle", { cx: qx * 17 / 16, cy: qy * 17 / 16, r: 1.8, fill: e.color }, dg));
        tx += 24;
        if (e.roll.mod) {
          const md = e.roll.mod;
          T_(svg, tx, ry, 10.5, 700, md > 0 ? "#1F8A46" : "#B4762A",
            `${md > 0 ? "+" : "\u2212"}${Math.abs(md)}`);
          tx += 20;
          T_(svg, tx, ry, 11, 700, "#5b5e57", `= ${e.roll.moved}`);
          tx += 34;
        }
        T_(svg, tx, ry, 12, 700, "#24262B", `\u2192 ${e.roll.mod ? "" : e.roll.moved + " "}${e.dir}`);
      } else {
        T_(svg, tx, ry, 11, 700, "#24262B", e.club);
        tx += 52;
        T_(svg, tx, ry, 12, 700, "#24262B", `\u2192 ${e.dist} ${e.dir}`);
      }
      const tail = e.holed ? "sunk" : e.lie;
      T_(svg, px0 + pw - 2, ry, 11, e.holed ? 700 : 400,
        e.holed ? "#1F8A46" : "#8a8d84", tail, "end");
      if (multi) {
        mk("circle", { cx: px0 + pw - 4, cy: ry - 15, r: 3, fill: e.color }, svg);
      }
    });
    if (!rows.length) {
      T_(svg, px0 + 2, cy + 4, 12, 400, "#a3a096", "No shots recorded.");
    } else if (rows.length > shown.length) {
      T_(svg, px0 + 2, cy + shown.length * ROW + 6, 11, 400, "#8a8d84",
        `+ ${rows.length - shown.length} more shots`);
    }

    // ---- footer ----
    const fy = PAD + HEAD + bodyH + 24;
    mk("line", { x1: PAD, y1: fy - 16, x2: W - PAD, y2: fy - 16,
      stroke: "#C6C2B8", "stroke-width": 1.5 }, svg);
    T_(svg, PAD, fy + 2, 12, 700, "#24262B", "Play this exact course:");
    T_(svg, PAD + 210, fy + 2, 12, 400, "#5b5e57", `enter code ${S.seed} on the title screen`);
    T_(svg, W - PAD, fy + 2, 10, 400, "#a3a096", "meh golf", "end");
    return svg;
  }

  function downloadBoardImage() {
    const svg = boardSnapshotSVG();
    if (!svg) return;
    const W = Number(svg.getAttribute("width")), H = Number(svg.getAttribute("height"));
    const xml = new XMLSerializer().serializeToString(svg);
    const svg64 = btoa(unescape(encodeURIComponent(xml)));
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = W * scale; canvas.height = H * scale;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#FAF8F2"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `meh-golf-${S.seed}-hole-${S.holeIdx + 1}.png`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, "image/png");
    };
    img.src = "data:image/svg+xml;base64," + svg64;
  }

  /* ---------------- hole / course flow ---------------- */
  function holeComplete() {
    S.phase = "between";
    renderControls();
    const last = S.holeIdx === 17;
    const rows = S.ps.map(p =>
      `<p><span style="color:${p.color}">\u25CF</span> ${p.name}: <b>${p.scores[S.holeIdx]}</b> &nbsp; total ${total(p)}</p>`).join("");
    banner(`<h2>Hole ${S.holeIdx + 1} complete</h2>${rows}`,
      last ? "See final scorecard" : "Next hole \u2192",
      () => { last ? courseComplete() : nextHole(); },
      true);
  }

  function nextHole() {
    hideBanner();
    S.holeIdx++;
    SFX.page();
    setupHole();
  }

  function courseComplete() {
    hideBanner();
    S.phase = "over";
    SFX.fanfare();
    const ranked = [...S.ps].sort((a, b) => total(a) - total(b));
    const list = ranked.map((p, i) =>
      `<p>${i === 0 ? "\u{1F3C6}" : (i + 1) + "."} <span style="color:${p.color}">\u25CF</span> ${p.name} \u2014 <b>${total(p)}</b> (${fmtToPar(total(p))})</p>`).join("");
    banner(`<h2>Course complete</h2><p><i>${S.course.name}</i> \u00B7 seed ${S.seed}</p>${list}`,
      "Back to the clubhouse", () => { hideBanner(); showMenu(); }, true);
    openScorecard();
  }

  const total = p => p.scores.reduce((a, b) => a + (b || 0), 0);
  const fmtToPar = t => {
    const par = 6 * (S.holeIdx + 1), d = t - par;
    return d === 0 ? "even" : d > 0 ? "+" + d : String(d);
  };

  function setupHole() {
    const G = g();
    S.wobble = RNG.rngFor(S.seed + "|wobble" + S.holeIdx);
    S.ps.forEach(p => {
      p.pos = { ...G.tee }; p.strokes = 0; p.holed = false; p.teeRerollUsed = false; p.trail = [];
    });
    S.cur = 0;
    renderBoard();
    $("#hole-label").textContent = `Hole ${S.holeIdx + 1} / 18`;
    $("#foot-hole").textContent = `Hole ${S.holeIdx + 1}`;
    updateFoot();
    startTurn();
  }

  function updateFoot() {
    const compact = S.ps.length > 2;
    $("#foot-players").innerHTML = S.ps.map(p => {
      const pips = Array.from({ length: 6 }, (_, i) => `<span class="pip${i < Math.min(p.strokes, 6) ? " f" : ""}"></span>`).join("");
      const label = compact ? `<span class="dotc"></span>` : p.name + " ";
      return `<span class="foot-p" style="color:${p.color}" title="${p.name}">${label}${pips}${p.strokes > 6 ? "+" + (p.strokes - 6) : ""}</span>`;
    }).join("");
  }

  function updateTurnCard() {
    const p = P();
    const multi = S.ps.length > 1;
    // In multiplayer the whole panel takes the active player's colour, and the
    // heading names them, so it is hard to shoot for the wrong person.
    const tray = document.querySelector(".tray");
    if (tray) {
      tray.style.setProperty("--turn", p.color);
      tray.classList.toggle("multi", multi);
    }
    const head = document.querySelector(".tray .panel-head");
    if (head) head.textContent = multi ? `${p.name}'s turn` : "Now shooting";
    const bar = $("#turn-chip");
    if (bar) {
      bar.textContent = multi ? p.name : "";
      bar.style.background = p.color;
      bar.classList.toggle("hidden", !multi);
    }
    $("#turn-player .dot").style.background = p.color;
    $("#turn-player .nm").textContent = p.name;
    $("#turn-lie").textContent = p.strokes === 0 ? "teeing off" : "on " + lieName(terrainAt(p.pos)) + ` \u00B7 stroke ${p.strokes + 1}`;
    updateCaddie();
    renderScorecard();
  }

  function updateMulligans() {
    const p = P();
    $("#mulligan-count").innerHTML = "Mulligans: " +
      Array.from({ length: 6 }, (_, i) => `<span class="mull-pip${i < 6 - p.mulligans ? " used" : ""}"></span>`).join("");
  }

  function onBigfoot(e) {
    if (S.bigfootFound) return;
    S.bigfootFound = true;
    e.currentTarget.classList.add("bigfoot-found");
    SFX.growl();
    S.ps.forEach(p => p.mulligans++);
    updateMulligans();
    if (S.phase === "rolled" || S.phase === "aim") renderControls(); // un-disable the mulligan button
    msg("You spotted the bigfoot! Everyone pockets a bonus mulligan.");
    setTimeout(() => e.currentTarget.style.opacity = "0.2", 600);
  }

  /* ---------------- overlays ---------------- */
  function msg(t) { $("#msg").textContent = t; }
  function banner(html, btnLabel, fn, showSave) {
    const b = $("#banner");
    b.classList.remove("hidden");
    b.innerHTML = `<div class="banner-card">${html}</div>`;
    const card = b.querySelector(".banner-card");
    const acts = document.createElement("div");
    acts.className = "banner-actions";
    card.appendChild(acts);
    const button = btn(btnLabel, "primary", fn);
    acts.appendChild(button);                     // primary action first
    if (showSave) acts.appendChild(btn("\u2193 Save this hole (image)", "", downloadBoardImage));
    button.focus();
  }
  function hideBanner() { $("#banner").classList.add("hidden"); }

  function openScorecard() {
    const body = $("#modal-body");
    let html = `<table class="score-table"><tr><th></th>`;
    for (let h = 0; h < 18; h++) html += `<th>${h + 1}</th>`;
    html += `<th class="tot">TOT</th></tr>`;
    S.ps.forEach(p => {
      html += `<tr><th style="color:${p.color}">${p.name}</th>`;
      for (let h = 0; h < 18; h++) {
        const v = p.scores[h];
        html += `<td class="${h === S.holeIdx ? "now" : ""}">${v == null ? "" : v}</td>`;
      }
      html += `<td class="tot">${total(p)}</td></tr>`;
    });
    html += "</table><p class='hint'>Par is 6 on every hole.</p>";
    body.innerHTML = html;
    $("#modal").classList.remove("hidden");
  }

  const THEME_HINTS = {
    colour: "Green fairways, blue water, sandy bunkers.",
    ink: "Pencil-and-paper greys, like the original notebook."
  };
  const PDF_HINTS = {
    colour: "Prints in colour. Switch to Ink for a black-and-white pack that is kinder to printers.",
    ink: "Prints in black and white \u2014 easy on ink, and it looks like the real notebook."
  };
  const THEME_LABEL = { colour: "Ink", ink: "Colour" };   // button offers the OTHER one

  /**
   * Switch palette everywhere at once: menu picker, hints, the in-game button,
   * and (if a round is live) the board, legend and trails. Every fill is a plain
   * SVG attribute, so a re-render is all that's needed and saved PNGs inherit
   * the colours too.
   */
  function applyTheme(t) {
    S.theme = (t === "colour" || t === "ink") ? t : "colour";
    const pick = $("#theme-picker");
    if (pick) [...pick.children].forEach(c => c.classList.toggle("on", c.dataset.t === S.theme));
    const th = $("#theme-hint"), ph = $("#pdf-theme-hint");
    if (th) th.textContent = THEME_HINTS[S.theme];
    if (ph) ph.textContent = PDF_HINTS[S.theme];
    const btn = $("#theme-btn");
    if (btn) btn.textContent = THEME_LABEL[S.theme];
    try { localStorage.setItem("mehgolf.theme", S.theme); } catch (e) { /* private mode */ }
    if (S.course && !$("#game").classList.contains("hidden")) {
      renderBoard();
      renderLegend();
    }
  }

  /** Opening titles: the course introduces itself before the first tee shot. */
  function showCourseCard(onDone) {
    const c = window.Course.courseCard(S.seed);
    banner(
      `<div class="course-card">
         <div class="cc-est">Established ${c.est}</div>
         <h2 class="cc-name">${c.name}</h2>
         <div class="cc-rule"></div>
         <p class="cc-hist">${c.history} ${c.known} ${c.warning}</p>
         <p class="cc-colour">${c.colour}</p>
         <p class="cc-motto">&ldquo;${c.motto}&rdquo;</p>
         <div class="cc-code">Course code ${S.seed} \u00B7 18 holes \u00B7 par 6</div>
       </div>`,
      "Play the first hole",
      () => { hideBanner(); if (onDone) onDone(); },
      false);
  }

  /** Show the made-up history of whatever course code is currently typed in. */
  function refreshBlurb() {
    const box = $("#course-blurb"), inp = $("#seed-input");
    if (!box || !inp) return;
    const code = inp.value.replace(/[^0-9]/g, "").slice(0, 10);
    if (!code) { box.textContent = ""; return; }
    const c = window.Course.courseCard(code);
    box.innerHTML = `<b>${c.name}</b> <span class="cb-est">est. ${c.est}</span><br>` +
      `${c.history} ${c.known} ${c.warning}<br><i>&ldquo;${c.motto}&rdquo;</i>`;
  }

  /* ---------------- phone layout ---------------- */
  const phoneQ = () => window.matchMedia("(max-width:700px) and (min-height:541px)").matches;
  let sheetHome = null;

  /**
   * On a phone the board plus the controls is all that fits in one screen, so
   * the reference panels (history, scorecard, legend) move into a slide-up
   * sheet. On anything larger they go back to their columns.
   */
  function syncLayout() {
    const sheet = $("#sheet");
    if (sheet && !document.getElementById("sheet-tools")) {
      const t = document.createElement("div");
      t.id = "sheet-tools"; t.className = "sheet-tools";
      sheet.appendChild(t);
    }
    const left = document.querySelector(".side-left");
    const legend = document.querySelector(".legend-panel");
    if (!sheet || !left || !legend) return;
    if (!sheetHome) sheetHome = { leftParent: left.parentNode, legendParent: legend.parentNode };

    const acts = document.querySelector(".game-bar-actions");
    const tools = $("#sheet-tools");
    if (phoneQ()) {
      if (left.parentNode !== sheet) sheet.appendChild(left);
      if (legend.parentNode !== sheet) sheet.appendChild(legend);
      // Print & Play / Save / Ink are rarely used mid-round; they were forcing
      // the bar onto a second line, so they move into the sheet.
      if (tools) ["pdf-btn2", "save-btn", "theme-btn"].forEach(id => {
        const b = document.getElementById(id);
        if (b && b.parentNode !== tools) tools.appendChild(b);
      });
    } else {
      document.body.classList.remove("sheet-open");
      if (left.parentNode !== sheetHome.leftParent) sheetHome.leftParent.insertBefore(left, sheetHome.leftParent.firstChild);
      if (legend.parentNode !== sheetHome.legendParent) sheetHome.legendParent.appendChild(legend);
      if (acts) ["pdf-btn2", "save-btn", "theme-btn"].forEach(id => {
        const b = document.getElementById(id);
        if (b && b.parentNode !== acts) acts.insertBefore(b, acts.firstChild);
      });
    }
    fitBoardSettled(true);
  }

  /* ---------------- menu / boot ---------------- */
  function readMenu() {
    // Seeds are restricted to a safe charset: they get interpolated into HTML,
    // a raw PDF byte stream, and a download filename.
    // Seeds are digits only: easy to read aloud, type on a phone, and safe to
    // interpolate into HTML, the PDF byte stream, and a download filename.
    const raw = $("#seed-input").value.replace(/[^0-9]/g, "").slice(0, 10);
    S.seed = raw || RNG.randSeedCode();
    const tsel = document.querySelector("#theme-picker .on");
    if (tsel) S.theme = tsel.dataset.t;   // picker is kept in sync by applyTheme
    $("#seed-input").value = S.seed;
    S.size = S.players === 1 ? "pocket" : "xl";
  }

  function startGame() {
    readMenu();
    SFX.unlock();
    S.course = genCourse(S.seed, S.size);
    S.holeIdx = 0;
    S.bigfootFound = false;
    S.log = [];
    S.caddieKey = ""; S.caddieText = "";
    Caddie.init(S.seed);
    renderHistory();
    renderLegend();
    renderScorecard();
    S.ps = Array.from({ length: S.players }, (_, i) => ({
      name: S.players === 1 ? "You" : PNAMES[i],
      color: PCOLORS[i],
      pos: { x: 0, y: 0 }, strokes: 0, holed: false,
      mulligans: 6, teeRerollUsed: false, trail: [],
      scores: Array(18).fill(null)
    }));
    $("#course-name").textContent = S.course.name;
    $("#course-name").title = window.Course.courseBlurb(S.seed);
    $("#seed-chip").textContent = S.seed;
    $("#menu").classList.add("hidden");
    $("#game").classList.remove("hidden");
    SFX.page();
    setupHole();
    // Hold play until the course has introduced itself.
    S.phase = "between"; renderControls();
    showCourseCard(() => { S.phase = "roll"; renderControls(); updateTurnCard(); });
  }

  function showMenu() {
    $("#game").classList.add("hidden");
    $("#menu").classList.remove("hidden");
  }

  function wireMenu() {
    $("#seed-input").value = RNG.randSeedCode();
    $("#shuffle-seed").addEventListener("click", () => {
      $("#seed-input").value = RNG.randSeedCode(); refreshBlurb();
      SFX.diceTick();
    });
    $("#player-picker").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      [...$("#player-picker").children].forEach(x => x.classList.toggle("on", x === b));
      S.players = +b.dataset.n;
      $("#size-hint").textContent = S.players === 1
        ? "Solo \u2192 pocket notebook (14\u00D720)"
        : `${S.players} players \u2192 XL notebook (18\u00D726), pass-and-play`;
    });
    $("#mode-picker").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      [...$("#mode-picker").children].forEach(x => x.classList.toggle("on", x === b));
      S.mode = b.dataset.m;
      $("#mode-hint").textContent = S.mode === "dice"
        ? "Roll a die each shot. Fairway +1, sand \u22121."
        : "No die: choose driver, iron, or putter each shot.";
    });
    $("#start-btn").addEventListener("click", startGame);
    $("#pdf-btn").addEventListener("click", () => {
      readMenu();
      const course = genCourse(S.seed, S.size);
      const [ps, pc] = $("#pdf-range").value.split(":").map(Number);
      PDF.downloadCoursePDF(course, ps, pc, S.theme === "colour");
      SFX.page();
    });

    const syncMute = () => {
      const m = SFX.isMuted();
      $("#mute-btn").textContent = "Sound: " + (m ? "off" : "on");
      $("#mute-btn2").style.opacity = m ? ".4" : "1";
    };
    const toggleMute = () => { SFX.setMuted(!SFX.isMuted()); syncMute(); };
    $("#mute-btn").addEventListener("click", toggleMute);
    $("#mute-btn2").addEventListener("click", toggleMute);

    $("#exit-btn").addEventListener("click", () => {
      if (S.phase === "over" || confirm("Leave this round and head back to the menu?")) showMenu();
    });
    $("#save-btn").addEventListener("click", downloadBoardImage);
    $("#seed-input").addEventListener("input", refreshBlurb);
    $("#roll-hint").addEventListener("click", e => { e.stopPropagation(); doRoll(); });
    $("#sheet-btn").addEventListener("click", () => {
      document.body.classList.toggle("sheet-open");
      SFX.page();
    });
    $("#sheet").addEventListener("click", e => {
      if (e.target.id === "sheet") document.body.classList.remove("sheet-open");
    });
    syncLayout();
    window.addEventListener("resize", () => { clearTimeout(window.__lay); window.__lay = setTimeout(syncLayout, 120); });
    refreshBlurb();

    $("#theme-picker").addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      [...$("#theme-picker").children].forEach(c => c.classList.toggle("on", c === b));
      applyTheme(b.dataset.t);
    });

    // Same switch, reachable mid-round without going back to the menu.
    $("#theme-btn").addEventListener("click", () => {
      applyTheme(S.theme === "colour" ? "ink" : "colour");
      SFX.page();
    });
    let saved = null;
    try { saved = localStorage.getItem("mehgolf.theme"); } catch (e) { /* private mode */ }
    applyTheme(saved || S.theme);
    $("#modal-close").addEventListener("click", () => $("#modal").classList.add("hidden"));
    $("#modal").addEventListener("click", e => { if (e.target.id === "modal") $("#modal").classList.add("hidden"); });
    $("#pdf-btn2").addEventListener("click", () => {
      PDF.downloadCoursePDF(S.course, 0, 18, S.theme === "colour");
      SFX.page();
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") $("#modal").classList.add("hidden");
    });
  }

  wireMenu();
})();
