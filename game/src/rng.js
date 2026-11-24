// Neon Bay — seeded random helpers (deterministic world + staged screenshots).
// The same seed always builds the same city, so screenshots are reproducible.
(function (global) {
  'use strict';

  // mulberry32: small fast seeded PRNG.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    const next = mulberry32(seed);
    return {
      next: next,
      range: function (lo, hi) { return lo + next() * (hi - lo); },
      int: function (lo, hi) { return Math.floor(lo + next() * (hi - lo + 1)); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      chance: function (p) { return next() < p; },
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1; return Math.sqrt(dx * dx + dy * dy); }
  function angDiff(a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function turnToward(a, target, maxStep) {
    const d = angDiff(a, target);
    if (Math.abs(d) <= maxStep) return target;
    return a + Math.sign(d) * maxStep;
  }

  global.NB = global.NB || {};
  global.NB.makeRng = makeRng;
  global.NB.clamp = clamp;
  global.NB.lerp = lerp;
  global.NB.dist = dist;
  global.NB.angDiff = angDiff;
  global.NB.turnToward = turnToward;
})(typeof window !== 'undefined' ? window : globalThis);
