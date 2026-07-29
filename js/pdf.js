/* Hand-rolled single-page vector PDF (US Letter) — six holes, ready to print and play.
   No libraries: we emit raw PDF objects and a content stream of drawing operators. */
(function (global) {
  "use strict";
  const { T, cell } = global.Course;

  const PW = 612, PH = 792; // points
  const K = 0.5523; // bezier circle constant

  function n(v) { return (Math.round(v * 100) / 100).toString(); }

  function makeOps() {
    const ops = [];
    const Y = y => PH - y; // flip to top-left coords
    return {
      ops,
      fillG(g) { ops.push(n(g) + " g"); },
      strokeG(g) { ops.push(n(g) + " G"); },
      lw(w) { ops.push(n(w) + " w"); },
      rect(x, y, w, h, mode) { ops.push(`${n(x)} ${n(Y(y) - h)} ${n(w)} ${n(h)} re ${mode || "f"}`); },
      line(x1, y1, x2, y2) { ops.push(`${n(x1)} ${n(Y(y1))} m ${n(x2)} ${n(Y(y2))} l S`); },
      poly(pts, mode) {
        ops.push(pts.map((p, i) => `${n(p[0])} ${n(Y(p[1]))} ${i ? "l" : "m"}`).join(" ") + " h " + (mode || "f"));
      },
      circle(cx, cy, r, mode) {
        const y = Y(cy), k = K * r;
        ops.push(
          `${n(cx + r)} ${n(y)} m ` +
          `${n(cx + r)} ${n(y + k)} ${n(cx + k)} ${n(y + r)} ${n(cx)} ${n(y + r)} c ` +
          `${n(cx - k)} ${n(y + r)} ${n(cx - r)} ${n(y + k)} ${n(cx - r)} ${n(y)} c ` +
          `${n(cx - r)} ${n(y - k)} ${n(cx - k)} ${n(y - r)} ${n(cx)} ${n(y - r)} c ` +
          `${n(cx + k)} ${n(y - r)} ${n(cx + r)} ${n(y - k)} ${n(cx + r)} ${n(y)} c h ${mode || "f"}`
        );
      },
      text(x, y, size, str, bold) {
        // Printable ASCII only: the writer computes /Length and xref offsets in
        // JS string chars, which only equals bytes when everything is ASCII.
        const esc = str.replace(/[^\x20-\x7E]/g, "?")
          .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
        ops.push(`BT /${bold ? "F2" : "F1"} ${n(size)} Tf ${n(x)} ${n(Y(y))} Td (${esc}) Tj ET`);
      }
    };
  }

  const SLOPE_PTS = [ // unit arrow per direction index (matches Course.DIRS)
    [[0, -1], [0.8, 0.7], [-0.8, 0.7]],       // N
    [[0.8, -0.8], [0.5, 0.9], [-0.9, -0.5]],  // NE
    [[1, 0], [-0.7, 0.8], [-0.7, -0.8]],      // E
    [[0.8, 0.8], [-0.9, 0.5], [0.5, -0.9]],   // SE
    [[0, 1], [-0.8, -0.7], [0.8, -0.7]],      // S
    [[-0.8, 0.8], [-0.5, -0.9], [0.9, 0.5]],  // SW
    [[-1, 0], [0.7, -0.8], [0.7, 0.8]],       // W
    [[-0.8, -0.8], [0.9, -0.5], [-0.5, 0.9]]  // NW
  ];

  function drawHoleMap(d, g, x0, y0, cs) {
    const cx = (x, y) => [x0 + x * cs + cs / 2, y0 + y * cs + cs / 2];

    // terrain fills first
    for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) {
      const c = cell(g, x, y), [px, py] = cx(x, y), h = cs / 2;
      if (c.t === T.FAIR) { d.fillG(0.88); d.rect(px - h, py - h, cs, cs); }
      else if (c.t === T.WATER) { d.fillG(0.58); d.rect(px - h, py - h, cs, cs); }
      else if (c.t === T.SAND) {
        d.fillG(0.93); d.rect(px - h, py - h, cs, cs);
        d.strokeG(0.6); d.lw(0.4);
        d.line(px - h, py + h, px + h, py - h);
      }
    }
    // dots + features
    for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) {
      const c = cell(g, x, y), [px, py] = cx(x, y);
      if (c.t === T.TREE) {
        d.fillG(0.15);
        if (c.tree === 2) { d.circle(px, py - cs * 0.08, cs * 0.28); d.rect(px - cs * 0.06, py + cs * 0.18, cs * 0.12, cs * 0.16); }
        else d.poly([[px, py - cs * 0.34], [px + cs * 0.3, py + cs * 0.3], [px - cs * 0.3, py + cs * 0.3]]);
      } else if (c.t === T.WATER) { d.fillG(1); d.circle(px, py, cs * 0.09); }
      else if (c.slope >= 0) {
        d.fillG(0.35);
        d.poly(SLOPE_PTS[c.slope].map(p => [px + p[0] * cs * 0.3, py + p[1] * cs * 0.3]));
      } else { d.fillG(c.t === T.FAIR ? 0.62 : 0.72); d.circle(px, py, cs * 0.07); }
    }
    // tee & cup on top
    const [tx, ty] = cx(g.tee.x, g.tee.y);
    d.strokeG(0.05); d.lw(Math.max(0.9, cs * 0.12)); d.fillG(1);
    d.circle(tx, ty, cs * 0.32, "B");
    const [hx2, hy2] = cx(g.hole.x, g.hole.y);
    d.fillG(0.05); d.circle(hx2, hy2, cs * 0.34);
  }

  /** Word-wrap a string to a pixel width at a Courier size (0.6 em per char). */
  function wrap(str, size, width) {
    const per = Math.floor(width / (size * 0.6));
    const words = str.split(" ");
    const lines = [];
    let line = "";
    for (const w of words) {
      if (!line.length) line = w;
      else if ((line + " " + w).length <= per) line += " " + w;
      else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    return lines;
  }

  /**
   * Page 1 of every download: how to play, plus the map key. Written to be
   * followed by a kid with a pencil and one die, no screen required.
   */
  function buildIntroPage(course) {
    const d = makeOps();
    const M = 44;
    const colW = (PW - M * 2 - 26) / 2;
    const L = M, R = M + colW + 26;

    // friendly masthead
    d.fillG(0.94); d.rect(M - 14, 30, PW - (M - 14) * 2, 74);
    d.fillG(0.05);
    d.text(M, 62, 30, "MEH GOLF", true);
    d.text(M, 84, 12, "Eighteen holes of pencil-and-paper golf. All you need is a die.");
    d.strokeG(0.05); d.lw(2); d.line(M - 14, 104, PW - M + 14, 104);

    d.text(M, 124, 11, "Course: " + course.name + "        Course code: " + course.seed, true);
    d.fillG(0.35);
    d.text(M, 138, 9, "Type that code into the game to play these exact holes on screen.");

    /* ---------------- left column: how to play ---------------- */
    let y = 168;
    d.fillG(0.05);
    d.text(L, y, 15, "HOW TO PLAY", true); y += 8;
    d.strokeG(0.05); d.lw(1.2); d.line(L, y, L + colW, y); y += 18;

    const steps = [
      ["1. Start at the tee.", "The little circle is where your ball begins. The solid dot is the cup. Get from one to the other in as few shots as you can."],
      ["2. Roll the die.", "The number you roll is how many dots your ball travels. Roll a 4, move 4 dots."],
      ["3. Pick a direction.", "Straight up, down, left, right, or any diagonal - eight choices. The ball travels in a straight line and stops."],
      ["4. Mark it down.", "Draw a line from where the ball was to where it landed. Add one stroke to your score."],
      ["5. Sink it.", "Land exactly on the cup and you are in. If your line goes over the cup and stops just one dot past, that counts too!"]
    ];
    steps.forEach(([head, body]) => {
      d.fillG(0.05);
      d.text(L, y, 11, head, true); y += 13;
      d.fillG(0.25);
      wrap(body, 9.5, colW).forEach(ln => { d.text(L + 8, y, 9.5, ln); y += 11.5; });
      y += 7;
    });

    y += 4;
    d.fillG(0.05);
    d.text(L, y, 12, "THE THREE RULES THAT MATTER", true); y += 8;
    d.strokeG(0.05); d.line(L, y, L + colW, y); y += 16;
    const rules = [
      "Fairway is friendly. Hit from the light grey area and your ball goes 1 dot FURTHER, and it flies right over trees.",
      "Sand is grumpy. Hit from a striped patch and your ball goes 1 dot SHORTER.",
      "You get do-overs. Your first shot on each hole can be re-rolled once for free. You also get 6 mulligans for the whole round - use one any time you hate your roll."
    ];
    rules.forEach(r => {
      d.fillG(0.05); d.circle(L + 3, y - 3, 2);
      d.fillG(0.25);
      wrap(r, 9.5, colW - 12).forEach((ln, i) => { d.text(L + 12, y, 9.5, ln); y += 11.5; });
      y += 5;
    });

    /* ---------------- right column: map key ---------------- */
    let ry = 168;
    d.fillG(0.05);
    d.text(R, ry, 15, "MAP KEY", true); ry += 8;
    d.strokeG(0.05); d.line(R, ry, R + colW, ry); ry += 20;

    const sw = 26;                                    // icon swatch size
    const key = [
      ["fair",  "Fairway",  "Hit from here: go 1 dot further, and fly over trees."],
      ["rough", "Rough",    "Plain ground. No help, no harm."],
      ["sand",  "Sand",     "Hit from here: go 1 dot shorter."],
      ["water", "Water",    "You may fly over it. You may never land in it."],
      ["tree",  "Trees",    "Blocked - unless you are hitting from the fairway."],
      ["slope", "Slope",    "Land here and roll 1 more dot the way the arrow points."],
      ["tee",   "Tee",      "Where the hole starts."],
      ["cup",   "Cup",      "Land on it, or stop one dot past, to sink the ball."],
      ["foot",  "Bigfoot",  "He hides in some courses. Finding him earns a mulligan."]
    ];
    key.forEach(([kind, name, note]) => {
      const cx = R + sw / 2, cy = ry - 6;
      if (kind === "fair")  { d.fillG(0.88); d.rect(R, ry - 18, sw, sw - 6); }
      if (kind === "sand")  { d.fillG(0.93); d.rect(R, ry - 18, sw, sw - 6);
                              d.strokeG(0.82); d.lw(1.2);
                              d.line(R + 2, ry - 4, R + sw - 2, ry - 16); }
      if (kind === "water") { d.fillG(0.62); d.rect(R, ry - 18, sw, sw - 6); }
      if (kind === "rough") { d.fillG(0.78); d.circle(cx, cy, 2); }
      if (kind === "tree")  { d.fillG(0.2);
                              d.poly([[cx - 7, cy + 7], [cx, cy - 8], [cx + 7, cy + 7]]);
                              d.rect(cx - 1.2, cy + 10, 2.4, 3); }
      if (kind === "slope") { d.fillG(0.42); d.poly([[cx, cy - 7], [cx + 5, cy + 5], [cx, cy + 2], [cx - 5, cy + 5]]); }
      if (kind === "tee")   { d.strokeG(0.05); d.lw(2); d.circle(cx, cy, 6, "S"); }
      if (kind === "cup")   { d.fillG(0.05); d.circle(cx, cy, 6); }
      if (kind === "foot")  { d.fillG(0.2); d.circle(cx - 3.5, cy + 2, 2.6); d.circle(cx + 3.5, cy - 1, 2.6); }
      d.fillG(0.05);
      d.text(R + sw + 10, ry - 8, 10.5, name, true);
      d.fillG(0.3);
      const lines = wrap(note, 8.8, colW - sw - 12);
      lines.forEach((ln, i) => d.text(R + sw + 10, ry + 3 + i * 10, 8.8, ln));
      ry += Math.max(sw + 4, 16 + lines.length * 10);
    });

    // a warm sign-off box
    ry += 6;
    d.strokeG(0.55); d.lw(1.2);
    d.rect(R, ry - 10, colW, 62, "S");
    d.fillG(0.05);
    d.text(R + 10, ry + 8, 10.5, "PLAYING WITH FRIENDS?", true);
    d.fillG(0.28);
    wrap("Everyone tees off in turn. After that, whoever is furthest from the cup shoots next. Lowest total after 18 holes wins.", 8.8, colW - 20)
      .forEach((ln, i) => d.text(R + 10, ry + 22 + i * 10, 8.8, ln));

    d.fillG(0.4);
    d.text(M, PH - 34, 9, "Par is 6 on every hole. Have fun, and don't take the sand personally.");
    return d.ops.join("\n");
  }

  /** Draw one full page for a single hole. Returns the page's content stream. */
  function buildHolePage(course, hIdx) {
    const d = makeOps();
    const M = 40;
    const g = course.holes[hIdx];

    // header
    d.fillG(0.05);
    d.text(M, 46, 22, "MEH GOLF", true);
    d.text(M + 132, 46, 12, "--  " + course.name);
    d.text(M, 64, 9, "Seed: " + course.seed + "     Par 6     O = tee, solid dot = cup");
    d.strokeG(0.05); d.lw(1.4); d.line(M, 72, PW - M, 72);

    // big hole number + scorebox on one line under the rule
    d.fillG(0.05);
    d.text(M, 100, 26, "HOLE " + (hIdx + 1), true);
    d.text(M + 150, 100, 12, "Strokes: ______ / 6      Running total: ______");

    // the map gets the whole rest of the page
    const availW = PW - M * 2;
    const top = 118, bottom = PH - 52;
    const availH = bottom - top;
    const cs = Math.min(availW / g.cols, availH / g.rows);
    const x0 = M + (availW - cs * g.cols) / 2;
    const y0 = top + (availH - cs * g.rows) / 2;
    drawHoleMap(d, g, x0, y0, cs);

    if (course.bigfoot && course.bigfoot.hole === hIdx) {
      const bx = x0 + course.bigfoot.x * cs + cs / 2, by = y0 + course.bigfoot.y * cs + cs / 2;
      d.fillG(0.1);
      d.circle(bx - cs * 0.12, by, cs * 0.12);
      d.circle(bx + cs * 0.12, by - cs * 0.1, cs * 0.12);
    }

    d.fillG(0.35);
    d.text(M, PH - 30, 8, "meh golf -- seed " + course.seed + " -- hole " + (hIdx + 1) + " of 18");
    return d.ops.join("\n");
  }

  /**
   * Build and download a PDF with ONE HOLE PER PAGE.
   * @param {object} course
   * @param {number} start first hole index
   * @param {number} count how many holes/pages (default 6)
   */
  function downloadCoursePDF(course, start, count) {
    const holes = Math.max(1, Math.min(18 - start, count == null ? 6 : count));
    // Page 1 is always the instructions + map key, so a printed pack is
    // playable on its own without anyone needing to explain the rules.
    const streams = [buildIntroPage(course)];
    for (let i = 0; i < holes; i++) streams.push(buildHolePage(course, start + i));
    const n = streams.length;

    // object ids: 1 catalog, 2 pages, then n page objects, then n content
    // objects, then the two fonts.
    const pageId = i => 3 + i;
    const contId = i => 3 + n + i;
    const fontA = 3 + 2 * n, fontB = fontA + 1;

    const objects = [];
    objects.push("<< /Type /Catalog /Pages 2 0 R >>");
    objects.push(`<< /Type /Pages /Kids [${streams.map((_, i) => pageId(i) + " 0 R").join(" ")}] /Count ${n} >>`);
    for (let i = 0; i < n; i++) {
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Contents ${contId(i)} 0 R ` +
        `/Resources << /Font << /F1 ${fontA} 0 R /F2 ${fontB} 0 R >> >> >>`);
    }
    for (let i = 0; i < n; i++) {
      objects.push(`<< /Length ${streams[i].length} >>\nstream\n${streams[i]}\nendstream`);
    }
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>");

    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((o, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

    const blob = new Blob([pdf], { type: "application/pdf" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = holes === 1
      ? `meh-golf-${course.seed}-hole-${start + 1}.pdf`
      : `meh-golf-${course.seed}-holes-${start + 1}-${start + holes}.pdf`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  global.PDF = { downloadCoursePDF };
})(window);
