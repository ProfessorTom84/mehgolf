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

  /** Build and download a one-page PDF for holes [start..start+5] of a course. */
  function downloadCoursePDF(course, start) {
    const d = makeOps();
    const M = 36;

    // header
    d.fillG(0.05);
    d.text(M, 44, 20, "MEH GOLF", true);
    d.text(M + 118, 44, 11, "--  " + course.name);
    d.text(M, 60, 8, "Seed: " + course.seed + "   Par 6 every hole   O = tee, solid dot = cup.   Print, grab a pencil and a d6, play.");
    d.strokeG(0.05); d.lw(1.4); d.line(M, 68, PW - M, 68);

    const g0 = course.holes[0];
    const gridW = (PW - M * 2 - 24) / 2;         // two columns
    const gridH = (PH - 96 - M - 2 * 16) / 3;    // three rows
    const cs = Math.min(gridW / g0.cols, (gridH - 16) / g0.rows);

    for (let i = 0; i < 6; i++) {
      const hIdx = start + i;
      const g = course.holes[hIdx];
      const col = i % 2, row = (i / 2) | 0;
      const x0 = M + col * (gridW + 24) + (gridW - cs * g.cols) / 2;
      const y0 = 80 + row * (gridH + 16);
      drawHoleMap(d, g, x0, y0, cs);
      d.fillG(0.05);
      d.text(x0, y0 + cs * g.rows + 11, 9, `Hole ${hIdx + 1}   Strokes: ____ /6   Total: ____`, true);
      if (course.bigfoot && course.bigfoot.hole === hIdx) {
        // he's printed too — a tiny pair of footprints
        const bx = x0 + course.bigfoot.x * cs + cs / 2, by = y0 + course.bigfoot.y * cs + cs / 2;
        d.fillG(0.1);
        d.circle(bx - cs * 0.12, by, cs * 0.12);
        d.circle(bx + cs * 0.12, by - cs * 0.1, cs * 0.12);
      }
    }
    d.text(M, PH - 22, 7, "meh golf -- seeded course " + course.seed + " -- holes " + (start + 1) + "-" + (start + 6));

    const content = d.ops.join("\n");
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>"
    ];

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
    a.download = `meh-golf-${course.seed}-holes-${start + 1}-${start + 6}.pdf`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  global.PDF = { downloadCoursePDF };
})(window);
