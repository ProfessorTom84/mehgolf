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
    rolled: 0, moveN: 0, moveKind: "roll", // roll|putt|driver|iron
    bigfootFound: false,
    wobble: null,              // seeded rng for hand-drawn jitter
    log: [],                   // shot history
    caddieKey: "", caddieText: ""
  };

  /* ---------------- helpers ---------------- */
  const g = () => S.course.holes[S.holeIdx];
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

  /* ---------------- board rendering ---------------- */
  function renderBoard() {
    const G = g();
    const w = G.cols * C, h = G.rows * C;
    const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, "aria-label": "golf hole map" });
    svg.id = "board";

    const defs = el("defs", {}, svg);
    const pat = el("pattern", { id: "sandhatch", width: 7, height: 7, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    el("rect", { width: 7, height: 7, fill: "#F0E8D2" }, pat);
    el("line", { x1: 0, y1: 0, x2: 0, y2: 7, stroke: "#D9CBA4", "stroke-width": 2 }, pat);

    const terr = el("g", {}, svg);
    const dots = el("g", {}, svg);
    const feat = el("g", {}, svg);

    for (let y = 0; y < G.rows; y++) for (let x = 0; x < G.cols; x++) {
      const c = cell(G, x, y), X = x * C, Y = y * C;
      if (c.t === T.FAIR) el("rect", { x: X - 1, y: Y - 1, width: C + 2, height: C + 2, rx: 9, fill: "#E4E2DA" }, terr);
      else if (c.t === T.WATER) el("rect", { x: X - 1, y: Y - 1, width: C + 2, height: C + 2, rx: 9, fill: "#969C9F" }, terr);
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
          el("circle", { cx: px(x), cy: px(y) - 3, r: 8.5, fill: "#3A3F3A" }, g0);
          el("rect", { x: px(x) - 1.8, y: px(y) + 4, width: 3.6, height: 6, fill: "#3A3F3A" }, g0);
        } else { // pine
          el("polygon", { points: `${px(x)},${px(y) - 11} ${px(x) + 9},${px(y) + 7} ${px(x) - 9},${px(y) + 7}`, fill: "#3A3F3A" }, g0);
          el("rect", { x: px(x) - 1.6, y: px(y) + 7, width: 3.2, height: 4, fill: "#3A3F3A" }, g0);
        }
      } else if (c.slope >= 0) {
        const a = el("g", { transform: `translate(${px(x)},${px(y)}) rotate(${c.slope * 45})`, opacity: .85 }, feat);
        el("polygon", { points: "0,-8 7,6 0,2.5 -7,6", fill: "#6B6F66" }, a);
      } else {
        const col = c.t === T.WATER ? "#EDEFEF" : c.t === T.FAIR ? "#A8A59A" : c.t === T.SAND ? "#CBBD97" : "#C6C2B8";
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
      el("ellipse", { cx: -3.5, cy: 1, rx: 3.2, ry: 5, fill: "#3A3F3A", transform: "rotate(-12)" }, bgf);
      el("ellipse", { cx: 3.5, cy: -2, rx: 3.2, ry: 5, fill: "#3A3F3A", transform: "rotate(12)" }, bgf);
      [[-5, -5], [-3.5, -6.2], [-2, -5.4], [2, -8.2], [3.5, -9], [5, -8]].forEach(p =>
        el("circle", { cx: p[0], cy: p[1], r: 1.1, fill: "#3A3F3A" }, bgf));
      bgf.addEventListener("click", onBigfoot);
    }

    // tee + cup
    el("circle", { cx: px(G.tee.x), cy: px(G.tee.y), r: 7.5, fill: "#FAF8F2", stroke: "#24262B", "stroke-width": 3 }, feat);
    el("circle", { cx: px(G.hole.x), cy: px(G.hole.y), r: 8, fill: "#24262B" }, feat);
    el("circle", { cx: px(G.hole.x) + 2.5, cy: px(G.hole.y) - 2.5, r: 1.8, fill: "#FAF8F2", opacity: .5 }, feat);

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
    fitBoard(true);
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

    const rngA = RNG.rngFor(S.seed + "|amb|" + S.holeIdx);
    // Half the holes get a bird heading the other way, so it doesn't feel like
    // the same loop every time.
    const eastbound = rngA() < 0.5;
    const x0 = eastbound ? -50 : w + 50;
    const x1 = eastbound ? w + 50 : -50;
    const yA = h * (0.10 + rngA() * 0.12);
    const yB = h * (0.05 + rngA() * 0.10);
    const yC = h * (0.12 + rngA() * 0.12);
    const at = (t, x, y) => `${t}% { transform: translate(${x.toFixed(1)}px, ${y.toFixed(1)}px); }`;

    const st = document.createElementNS("http://www.w3.org/2000/svg", "style");
    st.textContent = `
      /* One slow pass, then a long rest offscreen. The crossing takes ~40s of
         a 100s cycle, so the bird is an occasional visitor, not a metronome. */
      @keyframes mg-bird {
        0%   { transform: translate(${x0.toFixed(1)}px, ${yA.toFixed(1)}px); opacity: 0; }
        3%   { opacity: .7; }
        ${at(12, x0 + (x1 - x0) * 0.22, yB)}
        ${at(22, x0 + (x1 - x0) * 0.44, yA)}
        ${at(31, x0 + (x1 - x0) * 0.66, yC)}
        37%  { opacity: .7; }
        ${at(40, x1, yB)}
        40.1% { opacity: 0; }
        100% { transform: translate(${x1.toFixed(1)}px, ${yB.toFixed(1)}px); opacity: 0; }
      }
      /* Two lazy flaps, then a long glide. */
      @keyframes mg-flap {
        0%   { transform: scaleY(1); }
        5%   { transform: scaleY(.45); }
        11%  { transform: scaleY(1); }
        17%  { transform: scaleY(.5); }
        23%  { transform: scaleY(1); }
        100% { transform: scaleY(1); }
      }
      @keyframes mg-gust {
        0%   { transform: translate(${-90}px, 0); opacity: 0; }
        10%  { opacity: .42; }
        40%  { opacity: .42; }
        50%  { transform: translate(${(w + 90).toFixed(1)}px, ${(-h * 0.05).toFixed(1)}px); opacity: 0; }
        100% { transform: translate(${(w + 90).toFixed(1)}px, ${(-h * 0.05).toFixed(1)}px); opacity: 0; }
      }
      @keyframes mg-leaf {
        0%   { transform: translate(0,0) rotate(0deg); opacity: 0; }
        8%   { opacity: .65; }
        90%  { opacity: .2; }
        100% { transform: translate(${34}px, ${(h * 0.3).toFixed(1)}px) rotate(300deg); opacity: 0; }
      }
      .mg-bird { animation: mg-bird 100s linear infinite; }
      .mg-wing { animation: mg-flap 3.6s ease-in-out infinite; transform-origin: center; }
      .mg-gust { animation: mg-gust 46s linear infinite; }
      .mg-leaf { animation: mg-leaf 15s ease-in infinite; }
    `;
    svg.appendChild(st);

    const amb = el("g", { id: "ambience", "pointer-events": "none" }, svg);
    const rng = rngA;

    // two faint wind streaks at different heights and speeds
    for (let i = 0; i < 2; i++) {
      const y = h * (0.2 + rng() * 0.55);
      const g0 = el("g", { class: "mg-gust", style: `animation-delay:${(-rng() * 46).toFixed(1)}s; animation-duration:${(40 + rng() * 22).toFixed(1)}s` }, amb);
      el("path", {
        d: `M0 ${y.toFixed(1)} q 26 -7 52 0 t 52 0`,
        fill: "none", stroke: "#8FA08C", "stroke-width": 1.6,
        "stroke-linecap": "round", opacity: .5
      }, g0);
      el("path", {
        d: `M14 ${(y + 9).toFixed(1)} q 20 -5 40 0`,
        fill: "none", stroke: "#8FA08C", "stroke-width": 1.2,
        "stroke-linecap": "round", opacity: .35
      }, g0);
    }

    // a bird, wings flapping, crossing the page every so often
    const bird = el("g", { class: "mg-bird", style: `animation-delay:${(-rng() * 100).toFixed(1)}s` }, amb);
    const facing = el("g", { transform: eastbound ? "scale(1,1)" : "scale(-1,1)" }, bird);
    const wing = el("g", { class: "mg-wing" }, facing);
    el("path", {
      d: "M-9 0 q 4.5 -5 9 0 q 4.5 -5 9 0",
      fill: "none", stroke: "#4A5250", "stroke-width": 1.9,
      "stroke-linecap": "round", "stroke-linejoin": "round"
    }, wing);

    // leaves drifting off a few of the trees
    const trees = [];
    const G = g();
    for (let y = 0; y < G.rows; y++) for (let x = 0; x < G.cols; x++)
      if (cell(G, x, y).t === T.TREE) trees.push([x, y]);
    for (let i = 0; i < Math.min(3, trees.length); i++) {
      const [tx, ty] = trees[(rng() * trees.length) | 0];
      const lf = el("g", {
        class: "mg-leaf",
        style: `animation-delay:${(-rng() * 15).toFixed(1)}s; animation-duration:${(13 + rng() * 9).toFixed(1)}s;` +
               `transform-origin:${px(tx)}px ${px(ty)}px`
      }, amb);
      el("ellipse", {
        cx: px(tx) + 6, cy: px(ty), rx: 3.2, ry: 1.7,
        fill: "#6E7A63", opacity: .75,
        transform: `rotate(-25 ${px(tx) + 6} ${px(ty)})`
      }, lf);
    }
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
    if (!force && window.innerWidth === lastFitW && window.innerHeight === lastFitH) return;
    lastFitW = window.innerWidth; lastFitH = window.innerHeight;
    const vw = Number(svg.dataset.vw), vh = Number(svg.dataset.vh);
    if (!vw || !vh) return;

    const stacked = window.innerWidth <= 980;

    // Horizontal budget: measure what the columns actually leave us rather than
    // guessing with a vw fraction, so the side panels can never squeeze the board
    // off-screen.
    let maxW;
    if (stacked) {
      maxW = Math.min(window.innerWidth * 0.92, 560);
    } else {
      const felt = document.querySelector(".table-felt");
      const hist = document.querySelector(".side-left");
      const tray = document.querySelector(".side-right");
      const feltW = felt ? felt.clientWidth : window.innerWidth;
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
    const maxH = Math.max(200, window.innerHeight - top - belowH - 24);

    const scale = Math.min(maxW / vw, maxH / vh);
    const w = Math.floor(vw * scale), h = Math.floor(vh * scale);
    // Idempotence guard: writing identical values would still dirty layout and,
    // with any layout observer attached, could feed back into another fit.
    if (svg.style.width === w + "px" && svg.style.height === h + "px") return;
    svg.style.width = w + "px";
    svg.style.height = h + "px";
  }
  let fitTimer = null;
  const scheduleFit = () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitBoard, 80); };
  window.addEventListener("resize", scheduleFit);
  window.addEventListener("orientationchange", scheduleFit);
  // NOTE: deliberately no ResizeObserver here. Observing the layout that
  // contains the board means our own resize retriggers the observer, which
  // oscillates the board size. The side panels are fixed-width and scroll
  // internally, so window resize is the only signal we actually need.

  const jitter = () => (S.wobble() - 0.5) * 3.5;

  function drawTrails() {
    const t = $("#trails"); t.innerHTML = "";
    S.ps.forEach(p => {
      p.trail.forEach(seg => {
        el("line", {
          x1: px(seg.a.x) + seg.j1x, y1: px(seg.a.y) + seg.j1y,
          x2: px(seg.b.x) + seg.j2x, y2: px(seg.b.y) + seg.j2y,
          stroke: p.color, "stroke-width": 3, class: "stroke-line",
          opacity: seg.kind === "slope" ? .55 : .9,
          "stroke-dasharray": seg.kind === "slope" ? "2 6" : "none"
        }, t);
      });
      // A numbered node at the end of every struck shot. Without these, three
      // 2-dot hits in a row look identical to one 6-dot hit.
      let n = 0;
      p.trail.forEach(seg => {
        if (seg.kind === "slope") return;      // rolls aren't strokes
        n++;
        const cx = px(seg.b.x) + seg.j2x, cy = px(seg.b.y) + seg.j2y;
        const isLast = n === p.trail.filter(s => s.kind !== "slope").length;
        if (isLast && !p.holed) return;        // the live ball marker sits here
        el("circle", { cx, cy, r: 7.5, fill: "#FAF8F2", stroke: p.color, "stroke-width": 2, opacity: .95 }, t);
        el("text", {
          x: cx, y: cy + 3.4, "text-anchor": "middle", "font-size": 9,
          "font-family": "Courier New, monospace", "font-weight": "700",
          fill: p.color, class: "shot-num"
        }, t).textContent = n;
      });
    });
  }

  function drawBalls() {
    const b = $("#balls"); b.innerHTML = "";
    S.ps.forEach((p, i) => {
      if (p.holed) return;
      const grp = el("g", { class: "ball-current", id: "ball-" + i }, b);
      el("circle", { cx: px(p.pos.x), cy: px(p.pos.y), r: 7, fill: "#FAF8F2", stroke: p.color, "stroke-width": 3.2 }, grp);
      if (i === S.cur && (S.phase === "aim" || S.phase === "rolled"))
        el("circle", { cx: px(p.pos.x), cy: px(p.pos.y), r: 12, fill: "none", stroke: p.color, "stroke-width": 1.5, "stroke-dasharray": "3 4", opacity: .8 }, grp);
    });
  }

  /* ---------------- aim UI ---------------- */
  function showAim(n, kind) {
    const aim = $("#aim"); aim.innerHTML = "";
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
      el("circle", { class: "hit", cx: 0, cy: 0, r: 15 }, grp); // generous click/tap target
      el("polygon", { class: "head", points: "0,-11 8,7 0,3 -8,7" }, grp);
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
    const seg = {
      a, b, kind,
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
    const len = Math.hypot(px(b.x) - px(a.x), px(b.y) - px(a.y));
    if (kind !== "slope") {
      line.setAttribute("stroke-dasharray", len);
      line.setAttribute("stroke-dashoffset", len);
      line.style.transition = `stroke-dashoffset ${Math.min(0.45, len / 500)}s ease-out`;
      requestAnimationFrame(() => requestAnimationFrame(() => { line.setAttribute("stroke-dashoffset", 0); }));
    }
    setTimeout(done, kind === "slope" ? 220 : Math.min(480, len / 500 * 1000 + 60));
  }

  function commitMove(r, kind) {
    if (S.phase !== "aim") return;
    S.phase = "anim";
    $("#aim").innerHTML = ""; $("#preview").innerHTML = "";
    const p = P();
    p.strokes++;
    (kind === "putt" ? SFX.putt : SFX.hit)();
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

  function sink() {
    const p = P();
    p.holed = true;
    p.scores[S.holeIdx] = p.strokes;
    SFX.sink();
    const ball = $("#ball-" + S.cur);
    if (ball) ball.classList.add("sinking");
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
    S.moveN = n; S.moveKind = "roll";
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
    const c = $("#controls"); c.innerHTML = "";
    const p = P();
    if (!p || S.phase === "between" || S.phase === "over") return;
    const fromT = terrainAt(p.pos);

    if (S.mode === "dice") {
      if (S.phase === "roll") {
        c.appendChild(btn("Roll the die", "primary big", () => doRoll()));
      } else if (S.phase === "rolled" || S.phase === "aim") {
        const ro = document.createElement("div");
        ro.className = "roll-readout";
        ro.innerHTML = `<span class="num">${S.rolled || "?"}</span>
          <span class="calc">${fromT === T.FAIR ? "+1 fairway" : fromT === T.SAND ? "\u22121 sand" : "flat lie"}<br>moves ${S.moveN}</span>`;
        c.appendChild(ro);
        const row = document.createElement("div"); row.className = "row";
        row.appendChild(btn("Putt (1)", "", () => { enterAim(1, "putt"); renderControls(); }, S.moveN === 1 && S.moveKind !== "putt"));
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
  const LEGEND_ROWS = [
    [`<rect x="1" y="1" width="16" height="16" rx="5" fill="#E4E2DA"/>`, "Fairway", "+1 dot, flies trees"],
    [`<circle cx="9" cy="9" r="2" fill="#C6C2B8"/>`, "Rough", "no bonus"],
    [`<rect x="1" y="1" width="16" height="16" rx="5" fill="#F0E8D2"/><line x1="3" y1="15" x2="15" y2="3" stroke="#D9CBA4" stroke-width="2"/>`, "Sand", "\u22121 dot"],
    [`<rect x="1" y="1" width="16" height="16" rx="5" fill="#969C9F"/>`, "Water", "fly over, never land"],
    [`<polygon points="6,3 11,13 1,13" fill="#3A3F3A"/><circle cx="14" cy="7" r="4" fill="#3A3F3A"/>`, "Trees", "block unless from fairway"],
    [`<g transform="translate(9,9) rotate(45)"><polygon points="0,-5 4,4 0,1.5 -4,4" fill="#6B6F66"/></g>`, "Slope", "rolls ball 1 more"],
    [`<circle cx="9" cy="9" r="5" fill="#FAF8F2" stroke="#24262B" stroke-width="2.4"/>`, "Tee", "start of the hole"],
    [`<circle cx="9" cy="9" r="5.5" fill="#24262B"/>`, "Cup", "land on it, or 1 past"],
    [`<g opacity=".75"><ellipse cx="6" cy="10" rx="2.2" ry="3.4" fill="#3A3F3A"/><ellipse cx="12" cy="8" rx="2.2" ry="3.4" fill="#3A3F3A"/></g>`, "Bigfoot", "click for a mulligan"]
  ];

  function renderLegend() {
    const box = $("#legend-inline");
    if (!box) return;
    box.innerHTML = LEGEND_ROWS.map(([icon, name, note]) =>
      `<div class="lg-row"><svg viewBox="0 0 18 18" width="17" height="17">${icon}</svg>` +
      `<b>${name}</b><span>${note}</span></div>`).join("");
  }

  /* ---------------- live scorecard ---------------- */
  function renderScorecard() {
    const box = $("#scorecard-inline");
    if (!box) return;
    const ps = S.ps;
    let html = `<table class="sc-table"><thead><tr><th>Hole</th>` +
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
      return ["Slope \u2014 runs " + dn, "A ball landing here rolls one dot " + dn + ", and keeps rolling across any slope it meets."];
    }
    return TERRAIN_INFO[c.t] || null;
  }

  function wireHover(svg) {
    const tip = $("#board-tip");
    if (!tip) return;
    let cur = "";
    svg.addEventListener("mousemove", e => {
      const pt = svg.getBoundingClientRect();
      const sx = (e.clientX - pt.left) / pt.width * (Number(svg.dataset.vw) || 1);
      const sy = (e.clientY - pt.top) / pt.height * (Number(svg.dataset.vh) || 1);
      const x = Math.floor(sx / C), y = Math.floor(sy / C);
      const info = describeCell(x, y);
      const key = info ? x + "," + y : "";
      if (key === cur) return;
      cur = key;
      if (!info) { tip.classList.add("hidden"); return; }
      tip.innerHTML = `<b>${info[0]}</b><span>${info[1]}</span>`;
      tip.classList.remove("hidden");
    });
    svg.addEventListener("mouseleave", () => { cur = ""; $("#board-tip").classList.add("hidden"); });
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
    if (key !== S.caddieKey) {
      S.caddieKey = key;
      S.caddieText = Caddie.take(caddieBucket(p));
    }
    box.classList.remove("hidden");
    box.innerHTML = `<span class="caddie-label">Caddie</span><p>${S.caddieText}</p>`;
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
    // For dice golf record the raw die face AND the terrain modifier, so the
    // history explains why the ball travelled the distance it did.
    let roll = null;
    if (kind === "roll") {
      const fromT = terrainAt(from);
      roll = {
        die: S.rolled,
        mod: fromT === T.FAIR ? 1 : fromT === T.SAND ? -1 : 0,
        moved: S.moveN
      };
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
          const m = e.roll.mod > 0 ? ` <span class="h-mod up">+1 fairway</span>`
            : e.roll.mod < 0 ? ` <span class="h-mod dn">\u22121 sand</span>` : "";
          what = `${dieGlyph(e.roll.die, e.color)}${m} <span class="h-move">\u2192 ${e.roll.moved} ${e.dir}</span>`;
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
    mk("rect", { width: W, height: H, fill: "#FAF8F2" }, svg);
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
          T_(svg, tx, ry, 10, 700, e.roll.mod > 0 ? "#1F8A46" : "#B4762A",
            e.roll.mod > 0 ? "+1" : "\u22121");
          tx += 20;
        }
        T_(svg, tx, ry, 12, 700, "#24262B", `\u2192 ${e.roll.moved} ${e.dir}`);
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
    $("#foot-players").innerHTML = S.ps.map(p => {
      const pips = Array.from({ length: 6 }, (_, i) => `<span class="pip${i < Math.min(p.strokes, 6) ? " f" : ""}"></span>`).join("");
      return `<span class="foot-p" style="color:${p.color}">${p.name} ${pips}${p.strokes > 6 ? "+" + (p.strokes - 6) : ""}</span>`;
    }).join("");
  }

  function updateTurnCard() {
    const p = P();
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

  /* ---------------- menu / boot ---------------- */
  function readMenu() {
    // Seeds are restricted to a safe charset: they get interpolated into HTML,
    // a raw PDF byte stream, and a download filename.
    // Seeds are digits only: easy to read aloud, type on a phone, and safe to
    // interpolate into HTML, the PDF byte stream, and a download filename.
    const raw = $("#seed-input").value.replace(/[^0-9]/g, "").slice(0, 10);
    S.seed = raw || RNG.randSeedCode();
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
    $("#seed-chip").textContent = S.seed;
    $("#menu").classList.add("hidden");
    $("#game").classList.remove("hidden");
    SFX.page();
    setupHole();
  }

  function showMenu() {
    $("#game").classList.add("hidden");
    $("#menu").classList.remove("hidden");
  }

  function wireMenu() {
    $("#seed-input").value = RNG.randSeedCode();
    $("#shuffle-seed").addEventListener("click", () => {
      $("#seed-input").value = RNG.randSeedCode();
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
      PDF.downloadCoursePDF(course, ps, pc);
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
    $("#modal-close").addEventListener("click", () => $("#modal").classList.add("hidden"));
    $("#modal").addEventListener("click", e => { if (e.target.id === "modal") $("#modal").classList.add("hidden"); });
    $("#pdf-btn2").addEventListener("click", () => {
      PDF.downloadCoursePDF(S.course, 0, 18);
      SFX.page();
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") $("#modal").classList.add("hidden");
    });
  }

  wireMenu();
})();
