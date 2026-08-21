/* Automated Node.js unit tests for Meh Golf */
const assert = require("assert");

console.log("Loading JS modules in Node...");
require("./js/rng.js");
require("./js/course.js");
require("./js/dice.js");
require("./js/pdf.js");
require("./js/audio.js");
require("./js/caddie.js");

const RNG = globalThis.RNG;
const Course = globalThis.Course;
const Caddie = globalThis.Caddie;
const SFX = globalThis.SFX;

assert(RNG, "RNG module should be loaded");
assert(Course, "Course module should be loaded");
assert(Caddie, "Caddie module should be loaded");
assert(SFX, "SFX module should be loaded");

console.log("Testing RNG & Course PRNG determinism...");
const seed = "84729103";
const course1 = Course.genCourse(seed, "pocket");
const course2 = Course.genCourse(seed, "pocket");

assert.strictEqual(course1.name, course2.name, "Course names must match for identical seed");
assert.strictEqual(course1.holes.length, 18, "Course must generate 18 holes");
assert.strictEqual(course2.holes.length, 18, "Course 2 must generate 18 holes");

for (let i = 0; i < 18; i++) {
  assert.strictEqual(course1.holes[i].cols, course2.holes[i].cols, `Hole ${i} cols mismatch`);
  assert.strictEqual(course1.holes[i].rows, course2.holes[i].rows, `Hole ${i} rows mismatch`);
  assert.strictEqual(course1.holes[i].tee.x, course2.holes[i].tee.x, `Hole ${i} tee.x mismatch`);
  assert.strictEqual(course1.holes[i].tee.y, course2.holes[i].tee.y, `Hole ${i} tee.y mismatch`);
  assert.strictEqual(course1.holes[i].hole.x, course2.holes[i].hole.x, `Hole ${i} cup.x mismatch`);
  assert.strictEqual(course1.holes[i].hole.y, course2.holes[i].hole.y, `Hole ${i} cup.y mismatch`);
}

console.log("Testing Course card & lore blurb...");
const card = Course.courseCard(seed);
assert(card.name, "Card must have name");
assert(card.est >= 1890 && card.est <= 1976, "Card established year in expected range");
assert(card.motto, "Card must have motto");

const blurb = Course.courseBlurb(seed);
assert(blurb && blurb.length > 20, "Course blurb generated");

console.log("Testing Caddie chatter deck...");
Caddie.init(seed);
const drawnLines = new Set();
for (let i = 0; i < 10; i++) {
  const line = Caddie.take("tee");
  assert(line, "Caddie must return a line");
  assert(!drawnLines.has(line), `Caddie line repeated prematurely: "${line}"`);
  drawnLines.add(line);
}

console.log("Testing SFX mute state...");
SFX.setMuted(true);
assert.strictEqual(SFX.isMuted(), true, "SFX muted state set");
SFX.setMuted(false);
assert.strictEqual(SFX.isMuted(), false, "SFX unmuted state set");

console.log("All Node.js unit tests passed successfully!");
