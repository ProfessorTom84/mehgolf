/* A CSS-3D die that tumbles and bounces across the notebook page, then settles on the result. */
(function (global) {
  "use strict";

  // pip layouts on a 3x3 grid (cell indices 0..8)
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  // final cube rotation that shows each face to the camera
  const FACE_ROT = {
    1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180]
  };

  function buildDie(color) {
    const die = document.createElement("div");
    die.className = "die";
    for (let f = 1; f <= 6; f++) {
      const face = document.createElement("div");
      face.className = "face f" + f;
      for (let i = 0; i < 9; i++) {
        const c = document.createElement("div");
        if (PIPS[f].includes(i)) { c.className = "pip"; if (color) c.style.background = color; }
        face.appendChild(c);
      }
      die.appendChild(face);
    }
    return die;
  }

  const easeOut = t => 1 - Math.pow(1 - t, 3);

  /**
   * Roll the die across `stage`. Resolves with nothing once settled (value chosen by caller).
   * @param {HTMLElement} stage overlay element
   * @param {number} value 1..6 final face
   * @param {string} color pip color
   */
  function roll(stage, value, color) {
    return new Promise(resolve => {
      stage.innerHTML = "";
      const W = stage.clientWidth, H = stage.clientHeight;
      const die = buildDie(color);
      const shadow = document.createElement("div");
      shadow.className = "die-shadow";
      stage.appendChild(shadow);
      stage.appendChild(die);

      // random entry edge -> random landing spot in middle band
      const fromLeft = Math.random() < 0.5;
      const x0 = fromLeft ? -80 : W + 30;
      const y0 = H * (0.15 + Math.random() * 0.3);
      const x1 = W * (0.25 + Math.random() * 0.5);
      const y1 = H * (0.45 + Math.random() * 0.3);

      const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const DUR = calm ? 420 : 1250 + Math.random() * 750;
      const bounces = calm ? 1 : 2 + ((Math.random() * 3) | 0);
      const [fx, fy] = FACE_ROT[value];

      // The die rotates ONCE, continuously, to an orientation that is exactly
      // the target face plus a whole number of turns. Because the final
      // orientation is baked into the very first frame's trajectory, the face
      // that appears as it slows down is the face it lands on — there is no
      // separate "settle" phase that could visibly flip it to another number.
      // Spin count varies widely so no two throws look alike: sometimes it barely
      // turns over, sometimes it tumbles half a dozen times.
      const turnsX = (1 + ((Math.random() * 5) | 0)) * (Math.random() < 0.5 ? 1 : -1);
      const turnsY = (1 + ((Math.random() * 5) | 0)) * (Math.random() < 0.5 ? 1 : -1);
      const endRX = turnsX * 360 + fx;
      const endRY = turnsY * 360 + fy;
      const hop = calm ? 18 : 90 + Math.random() * 50;

      let start = null, ticked = new Set();
      let skipped = false;
      let frameId = null;

      stage.style.pointerEvents = "auto";
      const skip = () => {
        if (skipped) return;
        skipped = true;
        if (frameId) cancelAnimationFrame(frameId);
        stage.removeEventListener("click", skip);

        die.style.transform =
          `translate(${x1 - 27}px, ${y1 - 27}px) rotateX(${endRX}deg) rotateY(${endRY}deg)`;
        shadow.style.transform = `translate(${x1 - 27}px, ${y1 + 22}px) scale(1)`;
        shadow.style.opacity = "0.7";
        SFX.diceTick(0, 0.3);                        // final settle

        setTimeout(() => {
          die.style.transition = "opacity .2s"; shadow.style.transition = "opacity .2s";
          die.style.opacity = "0"; shadow.style.opacity = "0";
          setTimeout(() => {
            stage.innerHTML = "";
            stage.style.pointerEvents = "";
            resolve();
          }, 200);
        }, 300);
      };

      stage.addEventListener("click", skip);

      function frame(ts) {
        if (skipped) return;
        if (!start) start = ts;
        const el = ts - start;

        if (el <= DUR) {
          const t = el / DUR, e = easeOut(t);
          const x = x0 + (x1 - x0) * e;
          const y = y0 + (y1 - y0) * e;
          // bounce height decays to exactly 0 at t=1 so it comes to rest flat
          const b = Math.abs(Math.sin(t * Math.PI * bounces)) * hop * (1 - t) * (1 - t);
          const phase = Math.floor(t * bounces * 2);
          if (b < 6 && !ticked.has(phase)) {
            ticked.add(phase);
            SFX.diceTick(0, Math.max(0.25, 1 - t));   // later bounces land softer
          }
          die.style.transform =
            `translate(${x - 27}px, ${y - 27 - b}px) rotateX(${endRX * e}deg) rotateY(${endRY * e}deg)`;
          shadow.style.transform = `translate(${x - 27}px, ${y + 22}px) scale(${1 - b / 260})`;
          shadow.style.opacity = String(0.7 - b / 300);
          frameId = requestAnimationFrame(frame);
        } else {
          // pin to the exact final orientation (guards against float drift)
          die.style.transform =
            `translate(${x1 - 27}px, ${y1 - 27}px) rotateX(${endRX}deg) rotateY(${endRY}deg)`;
          shadow.style.transform = `translate(${x1 - 27}px, ${y1 + 22}px) scale(1)`;
          shadow.style.opacity = "0.7";
          SFX.diceTick(0, 0.3);                        // final settle
          stage.removeEventListener("click", skip);
          setTimeout(() => {
            die.style.transition = "opacity .35s"; shadow.style.transition = "opacity .35s";
            die.style.opacity = "0"; shadow.style.opacity = "0";
            setTimeout(() => {
              stage.innerHTML = "";
              stage.style.pointerEvents = "";
              resolve();
            }, 380);
          }, 700);
        }
      }
      frameId = requestAnimationFrame(frame);
    });
  }

  global.Dice = { roll };
})(window);
