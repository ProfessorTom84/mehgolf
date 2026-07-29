/* Seeded PRNG: xmur3 string hash feeding mulberry32. Same seed => same course everywhere. */
(function (global) {
  "use strict";

  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Deterministic RNG for a seed string. Returns fn() -> [0,1) */
  function rngFor(seedStr) {
    const h = xmur3(String(seedStr));
    return mulberry32(h());
  }

  function randSeedCode() {
    // Purely numeric so it's easy to read aloud, type on a phone, or write in
    // a notebook margin: an 8-digit code, e.g. "40217593".
    let s = "";
    for (let i = 0; i < 8; i++) s += (Math.random() * 10) | 0;
    return s;
  }

  const pick = (rng, arr) => arr[(rng() * arr.length) | 0];
  const ri = (rng, min, max) => min + ((rng() * (max - min + 1)) | 0); // inclusive int

  global.RNG = { rngFor, randSeedCode, pick, ri };
})(window);
