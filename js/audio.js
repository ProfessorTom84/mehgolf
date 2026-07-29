/* All sound is synthesized on the fly with the Web Audio API — no asset files. */
(function (global) {
  "use strict";

  let ctx = null, master = null, muted = false;

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

  const SFX = {
    /** wooden clack of the die hitting the page */
    diceTick(when) { noise(0.05, 2200, 0.35, when); blip(190 + Math.random() * 60, 0.05, "square", 0.12, when); },
    /** ball struck */
    hit() { noise(0.06, 1400, 0.3); blip(150, 0.1, "sine", 0.5); },
    putt() { noise(0.04, 1000, 0.18); blip(210, 0.07, "sine", 0.28); },
    /** rolling down a slope */
    slope() { for (let i = 0; i < 4; i++) noise(0.03, 900 - i * 120, 0.14, i * 0.07); },
    /** ball drops in the cup */
    sink() {
      blip(660, 0.12, "triangle", 0.35, 0);
      blip(880, 0.12, "triangle", 0.35, 0.09);
      blip(1320, 0.25, "triangle", 0.4, 0.18);
      noise(0.05, 800, 0.2, 0.02);
    },
    /** page turn */
    page() { noise(0.28, 3000, 0.22); },
    /** invalid choice */
    nope() { blip(120, 0.12, "square", 0.2); },
    /** bigfoot spotted */
    growl() { blip(70, 0.35, "sawtooth", 0.3); blip(55, 0.4, "sawtooth", 0.25, 0.05); },
    fanfare() { [523, 659, 784, 1047].forEach((f, i) => blip(f, 0.18, "triangle", 0.32, i * 0.12)); },
    unlock() { ensure(); },
    setMuted(m) { muted = m; },
    isMuted() { return muted; }
  };

  global.SFX = SFX;
})(window);
