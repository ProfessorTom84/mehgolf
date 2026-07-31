/* All sound is synthesized on the fly with the Web Audio API — no asset files. */
(function (global) {
  "use strict";

  let ctx = null, master = null, muted = false;
  try {
    muted = localStorage.getItem("mehgolf.muted") === "true";
  } catch (e) {
    // safe fallback
  }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function env(node, t0, a, peak, d) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.exponentialRampToValueAtTime(peak, t0 + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  function noiseBuf(dur) {
    const n = Math.max(1, (ctx.sampleRate * dur) | 0);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function blip(freq, dur, type, vol, when) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "sine"; o.frequency.setValueAtTime(freq, t);
    env(g, t, 0.005, vol || 0.4, dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(dur, band, vol, when) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime + (when || 0);
    const s = ctx.createBufferSource(); s.buffer = noiseBuf(dur);
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = band; f.Q.value = 0.9;
    const g = ctx.createGain(); env(g, t, 0.004, vol || 0.35, dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.05);
  }

  /** Short pitch-swept tone — the body of a struck-object sound. */
  function thump(f0, f1, dur, type, vol, when) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.002);   // near-instant attack
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /** Filtered noise burst with a falling cutoff — the "crack" of an impact. */
  function crack(band0, band1, dur, vol, when, q) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime + (when || 0);
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(dur);
    const f = ctx.createBiquadFilter();
    f.type = "bandpass"; f.Q.value = q || 1.2;
    f.frequency.setValueAtTime(band0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(80, band1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  const rnd = (a, b) => a + Math.random() * (b - a);

  function vibrate(pattern) {
    if (typeof navigator !== "undefined" && navigator.vibrate && !muted) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        // Safe catch-all
      }
    }
  }

  const SFX = {
    /**
     * A die tumbling on paper. Every clatter is a fresh roll of pitch,
     * brightness, length and level, so no two touchdowns sound alike -- and a
     * heavier landing (force 0..1) sounds heavier.
     */
    diceTick(when, force) {
      const f = force == null ? rnd(0.5, 1) : force;
      const dur = rnd(0.028, 0.06);
      crack(rnd(1700, 3400), rnd(500, 1100), dur, 0.16 + f * 0.24, when, rnd(0.8, 2.2));
      thump(rnd(150, 320), rnd(70, 130), dur * 1.5, "triangle", 0.05 + f * 0.11, when);
      if (Math.random() < 0.45) {                       // occasional second edge
        crack(rnd(2200, 4200), rnd(700, 1400), rnd(0.012, 0.026), 0.06 + f * 0.09,
              (when || 0) + rnd(0.012, 0.03), 2.4);
      }
      if (!when || when === 0) {
        vibrate(10);
      }
    },

    /**
     * Club on ball. A real strike is a very fast, bright crack with almost no
     * sustain -- a tiny transient, a metallic ping that falls away instantly,
     * and a soft low thud for the body of the ball.
     */
    hit(club) {
      const heavy = club === "driver" || club == null;
      const v = heavy ? 1 : 0.8;
      crack(rnd(4200, 6200), rnd(900, 1500), 0.022, 0.34 * v, 0, 0.9);   // the crack
      thump(rnd(1500, 2100), rnd(300, 460), 0.05, "triangle", 0.2 * v, 0.001); // metallic ping
      thump(rnd(120, 175), rnd(55, 80), heavy ? 0.16 : 0.11, "sine", 0.36 * v, 0.002); // body
      crack(rnd(700, 1000), 200, 0.07, 0.09 * v, 0.004, 0.7);            // air
      vibrate(heavy ? 40 : 30);
    },

    /** Putter: softer, duller, no ping. */
    putt() {
      crack(rnd(1800, 2600), rnd(500, 800), 0.018, 0.16, 0, 1.1);
      thump(rnd(210, 280), rnd(90, 130), 0.09, "sine", 0.22, 0.001);
      vibrate(15);
    },

    /** Iron: between the two, with a shorter ring. */
    iron() {
      crack(rnd(3200, 4600), rnd(800, 1200), 0.02, 0.26, 0, 1.0);
      thump(rnd(1100, 1500), rnd(280, 400), 0.04, "triangle", 0.14, 0.001);
      thump(rnd(150, 200), rnd(70, 95), 0.12, "sine", 0.3, 0.002);
      vibrate(25);
    },
    /** rolling down a slope */
    slope() {
      const n = 3 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) {
        crack(rnd(900, 1500) - i * 90, rnd(300, 500), rnd(0.02, 0.04), rnd(0.07, 0.14), i * rnd(0.05, 0.09), 1.4);
      }
      vibrate([10, 30, 10]);
    },
    /** ball drops in the cup */
    sink() {
      blip(660, 0.12, "triangle", 0.35, 0);
      blip(880, 0.12, "triangle", 0.35, 0.09);
      blip(1320, 0.25, "triangle", 0.4, 0.18);
      noise(0.05, 800, 0.2, 0.02);
      vibrate([50, 50, 100, 50, 150]);
    },
    /** page turn */
    page() { noise(0.28, 3000, 0.22); },
    /** invalid choice */
    nope() {
      blip(120, 0.12, "square", 0.2);
      vibrate([30, 50, 30]);
    },
    /** bigfoot spotted */
    growl() {
      blip(70, 0.35, "sawtooth", 0.3); blip(55, 0.4, "sawtooth", 0.25, 0.05);
      vibrate([60, 40, 60]);
    },
    fanfare() { [523, 659, 784, 1047].forEach((f, i) => blip(f, 0.18, "triangle", 0.32, i * 0.12)); },
    unlock() { ensure(); },
    setMuted(m) {
      muted = m;
      try {
        localStorage.setItem("mehgolf.muted", m);
      } catch (e) {
        // safe fallback
      }
    },
    isMuted() { return muted; }
  };

  global.SFX = SFX;

  // Global user-gesture interaction unlocker for reliable Web Audio on iOS/Safari/Android
  function initUnlocker() {
    const unlock = () => {
      const c = ensure();
      if (c) {
        if (c.state === "suspended") {
          c.resume().then(() => {
            const events = ["click", "touchstart", "touchend", "keydown"];
            events.forEach(e => document.removeEventListener(e, unlock));
          }).catch(e => {
            // ignore
          });
        } else if (c.state === "running") {
          const events = ["click", "touchstart", "touchend", "keydown"];
          events.forEach(e => document.removeEventListener(e, unlock));
        }

        // Also play a short silent buffer to force-unlock iOS Audio Graph
        try {
          const buffer = c.createBuffer(1, 1, 22050);
          const source = c.createBufferSource();
          source.buffer = buffer;
          source.connect(c.destination);
          source.start(0);
        } catch (e) {
          // safe catch
        }
      }
    };
    const events = ["click", "touchstart", "touchend", "keydown"];
    events.forEach(e => document.addEventListener(e, unlock, { passive: true }));
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initUnlocker);
    } else {
      initUnlocker();
    }
  }
})(window);
