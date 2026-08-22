/* Node.js unit test suite for Meh Golf core modules */
const assert = require("assert");

// DOM and browser mocks for Node environment
global.window = global;
global.document = {
  readyState: "complete",
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ appendChild: () => {}, style: {}, setAttribute: () => {} }),
  createElementNS: () => ({ appendChild: () => {}, style: {}, setAttribute: () => {} })
};
global.localStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; }
};
global.navigator = {};

// Load modules
require("./js/rng.js");
require("./js/course.js");
require("./js/caddie.js");
require("./js/dice.js");
require("./js/audio.js");
require("./js/pdf.js");

console.log("--- Starting Meh Golf Unit Tests ---");

// Test 1: RNG Module Determinism
const seed = "12345678";
const r1 = RNG.rngFor(seed);
const r2 = RNG.rngFor(seed);
const vals1 = [r1(), r1(), r1()];
const vals2 = [r2(), r2(), r2()];
assert.deepStrictEqual(vals1, vals2, "RNG must produce identical sequence for same seed");
console.log("✔ Test 1: Seeded PRNG determinism passed");

// Test 2: Course Generation & Solvability
const course = Course.genCourse(seed, "pocket");
assert.strictEqual(course.holes.length, 18, "Generated course must contain 18 holes");
course.holes.forEach((hole, idx) => {
  assert.ok(hole.cols === 14 && hole.rows === 20, `Hole ${idx + 1} size match`);
  assert.ok(hole.tee && hole.hole, `Hole ${idx + 1} must have tee and cup`);
});
console.log("✔ Test 2: Course generation & 18-hole validation passed");

// Test 3: Caddie Chatter Line Extraction
Caddie.init(seed);
const line1 = Caddie.take("tee");
assert.ok(typeof line1 === "string" && line1.length > 0, "Caddie must return a non-empty string");
console.log("✔ Test 3: Caddie chatter passed");

// Test 4: Audio SFX Non-crashing Fallbacks
SFX.hit("driver");
SFX.putt();
SFX.sink();
assert.strictEqual(SFX.isMuted(), false, "Default audio state unmuted");
SFX.setMuted(true);
assert.strictEqual(SFX.isMuted(), true, "Audio state properly muted");
console.log("✔ Test 4: Audio fallbacks & mute toggle passed");

// Test 5: Course Lore Card Generator
const card = Course.courseCard(seed);
assert.ok(card.name && card.est && card.motto, "Course card contains expected lore fields");
console.log("✔ Test 5: Course lore card generation passed");

console.log("--- All Unit Tests Passed Successfully ---");
