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
    const n = Math.max(1, Math.min(18 - start, count == null ? 6 : count));
    const streams = [];
    for (let i = 0; i < n; i++) streams.push(buildHolePage(course, start + i));

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
    a.download = n === 1
      ? `meh-golf-${course.seed}-hole-${start + 1}.pdf`
      : `meh-golf-${course.seed}-holes-${start + 1}-${start + n}.pdf`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  global.PDF = { downloadCoursePDF };
})(window);
