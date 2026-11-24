// Neon Bay — the city. A 3200x3200 world on a road grid: downtown, old town,
// suburbs, harbor docks and a beachfront. Buildings, parks, parking lots and
// the road network are generated from a fixed seed so every run matches.
// Seed 1337 was verified: the mission park really is a park, and every
// mission target sits on a road or open ground, never inside a building.
(function (global) {
  'use strict';
  const NB = global.NB;
  const clamp = NB.clamp;

  const WORLD = 3200;          // world is WORLD x WORLD
  const BLOCK = 320;           // distance between road centerlines
  const ROAD_HALF = 36;        // half road width
  const GRID = 9;              // road centerlines at 0, 320, ..., 2880
  const LAND_EDGE = 2970;      // where beach / harbor water begins

  // District rectangles (for palette + naming).
  const DISTRICTS = [
    { name: 'Downtown', x: 960, y: 960, w: 1280, h: 1280, kind: 'downtown' },
    { name: 'Old Town', x: 0, y: 960, w: 960, h: 1280, kind: 'oldtown' },
    { name: 'Suburbs', x: 0, y: 0, w: 3200, h: 960, kind: 'suburbs' },
    { name: 'Harbor', x: 2240, y: 960, w: 960, h: 1280, kind: 'harbor' },
    { name: 'Beachfront', x: 0, y: 2240, w: 3200, h: 960, kind: 'beach' },
  ];

  const PALETTES = {
    downtown: ['#3a4a6b', '#4a3f66', '#2f4a5e', '#5e3a4a', '#46586e', '#37506b'],
    oldtown: ['#7a5a44', '#6b5a44', '#5e4a3a', '#8a6a4a', '#71563e'],
    suburbs: ['#8a7a6a', '#7a8a6a', '#9a8a7a', '#6a7a8a', '#a08a6a'],
    harbor: ['#4a5a6a', '#3f4a55', '#55606a', '#45525e'],
    beach: ['#c9a86a', '#b89a6a', '#d9b87a', '#a8905a'],
  };
  const ROOF_COLORS = ['#2a2f3a', '#33302a', '#232830', '#3a2f2a', '#2f332a'];

  function districtAt(x, y) {
    for (let i = 0; i < DISTRICTS.length; i++) {
      const d = DISTRICTS[i];
      if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) return d;
    }
    return DISTRICTS[0];
  }

  function roadCenter(k) { return k * BLOCK; }

  // True when the point lies on a road (either axis).
  function isRoad(x, y) {
    const mx = ((x % BLOCK) + BLOCK) % BLOCK;
    const my = ((y % BLOCK) + BLOCK) % BLOCK;
    const nearX = Math.min(mx, BLOCK - mx) <= ROAD_HALF;
    const nearY = Math.min(my, BLOCK - my) <= ROAD_HALF;
    return nearX || nearY;
  }

  // Nearest point on the road network to (x, y).
  function snapToRoad(x, y) {
    const kx = Math.round(x / BLOCK) * BLOCK;
    const ky = Math.round(y / BLOCK) * BLOCK;
    const dx = Math.abs(x - kx), dy = Math.abs(y - ky);
    if (dx <= dy) return { x: kx, y: y, axis: 'v' };
    return { x: x, y: ky, axis: 'h' };
  }

  // The direction of the road under (x, y): 'h', 'v' or 'x' (intersection).
  function roadAxis(x, y) {
    const mx = ((x % BLOCK) + BLOCK) % BLOCK;
    const my = ((y % BLOCK) + BLOCK) % BLOCK;
    const onX = Math.min(mx, BLOCK - mx) <= ROAD_HALF;
    const onY = Math.min(my, BLOCK - my) <= ROAD_HALF;
    if (onX && onY) return 'x';
    if (onX) return 'v';
    if (onY) return 'h';
    return null;
  }

  function buildWorld(seed) {
    const rng = NB.makeRng(seed || 1337);
    const buildings = [];
    const parks = [];
    const lots = [];
    const trees = [];
    const lamps = [];

    for (let bi = 0; bi < GRID; bi++) {
      for (let bj = 0; bj < GRID; bj++) {
        const bx = bi * BLOCK + ROAD_HALF;
        const by = bj * BLOCK + ROAD_HALF;
        const bw = BLOCK - ROAD_HALF * 2;
        const bh = BLOCK - ROAD_HALF * 2;
        const cx = bx + bw / 2, cy = by + bh / 2;
        const d = districtAt(cx, cy);
        const roll = rng.next();

        if (d.kind === 'beach' && bj >= 7) {
          // South beach blocks stay open sand with palms.
          for (let t = 0; t < 5; t++) {
            trees.push({ x: bx + rng.range(20, bw - 20), y: by + rng.range(20, bh - 20), palm: true });
          }
          continue;
        }
        if (roll < 0.12) {
          parks.push({ x: bx, y: by, w: bw, h: bh });
          for (let t = 0; t < 7; t++) {
            trees.push({ x: bx + rng.range(16, bw - 16), y: by + rng.range(16, bh - 16), palm: false });
          }
          continue;
        }
        if (roll < 0.22) {
          lots.push({ x: bx, y: by, w: bw, h: bh });
          continue;
        }
        // One or two buildings per block.
        const pal = PALETTES[d.kind] || PALETTES.downtown;
        const n = (d.kind === 'downtown' && rng.chance(0.6)) ? 2 : 1;
        for (let b = 0; b < n; b++) {
          const mw = n === 2 ? bw / 2 - 14 : bw - 24;
          const mh = bh - 24;
          const ox = n === 2 ? bx + 8 + b * (bw / 2) : bx + 12;
          const oy = by + 12;
          const tall = d.kind === 'downtown' ? rng.range(10, 26) : rng.range(4, 12);
          buildings.push({
            x: ox, y: oy, w: mw, h: mh,
            color: rng.pick(pal),
            roof: rng.pick(ROOF_COLORS),
            height: tall,
          });
        }
        // Street lamps at block corners.
        lamps.push({ x: bx - 8, y: by - 8 });
        lamps.push({ x: bx + bw + 8, y: by - 8 });
      }
    }

    return {
      seed: seed || 1337,
      buildings: buildings,
      parks: parks,
      lots: lots,
      trees: trees,
      lamps: lamps,
    };
  }

  // AABB vs building collision. Returns the push-out for a circle, or null.
  function collideBuildings(world, x, y, r) {
    for (let i = 0; i < world.buildings.length; i++) {
      const b = world.buildings[i];
      const nx = clamp(x, b.x, b.x + b.w);
      const ny = clamp(y, b.y, b.y + b.h);
      const dx = x - nx, dy = y - ny;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 0.001;
        return { x: nx + (dx / d) * r, y: ny + (dy / d) * r, hit: true };
      }
    }
    return null;
  }

  function drawWorld(ctx, world, cam, time) {
    const x0 = Math.max(0, cam.x - 80), y0 = Math.max(0, cam.y - 80);
    const x1 = Math.min(WORLD, cam.x + cam.w + 80), y1 = Math.min(WORLD, cam.y + cam.h + 80);

    // Ground base.
    ctx.fillStyle = '#232833';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

    // Blocks (sidewalk grey).
    ctx.fillStyle = '#3d4454';
    for (let bi = 0; bi < GRID; bi++) {
      for (let bj = 0; bj < GRID; bj++) {
        const bx = bi * BLOCK + ROAD_HALF, by = bj * BLOCK + ROAD_HALF;
        const bw = BLOCK - ROAD_HALF * 2, bh = BLOCK - ROAD_HALF * 2;
        if (bx + bw < x0 || bx > x1 || by + bh < y0 || by > y1) continue;
        ctx.fillRect(bx, by, bw, bh);
      }
    }
    // Lane dashes along road centerlines.
    ctx.strokeStyle = 'rgba(255,220,120,0.55)';
    ctx.lineWidth = 3;
    ctx.setLineDash([26, 30]);
    ctx.beginPath();
    for (let k = 0; k <= GRID; k++) {
      const c = roadCenter(k);
      if (c >= y0 && c <= y1) { ctx.moveTo(x0, c); ctx.lineTo(x1, c); }
      if (c >= x0 && c <= x1) { ctx.moveTo(c, y0); ctx.lineTo(c, y1); }
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Beach sand + ocean (south) and harbor water (east).
    ctx.fillStyle = '#c9a86a';
    ctx.fillRect(x0, LAND_EDGE, x1 - x0, WORLD - LAND_EDGE);
    ctx.fillStyle = '#1d5f8a';
    ctx.fillRect(x0, 3050, x1 - x0, WORLD - 3050);
    ctx.fillRect(LAND_EDGE, y0, WORLD - LAND_EDGE, y1 - y0);
    // Animated water shimmer.
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 10; i++) {
      const wy = 3060 + ((i * 53 + Math.floor(time / 900) * 7) % 130);
      if (wy >= y0 && wy <= y1) ctx.fillRect(x0, wy, x1 - x0, 3);
    }
    // Harbor piers.
    ctx.fillStyle = '#6a5a44';
    for (let p = 0; p < 3; p++) {
      const py = 1150 + p * 620;
      if (py >= y0 - 60 && py <= y1 + 60) ctx.fillRect(2900, py, 260, 44);
    }

    // Parks.
    for (let i = 0; i < world.parks.length; i++) {
      const p = world.parks[i];
      if (p.x + p.w < x0 || p.x > x1 || p.y + p.h < y0 || p.y > y1) continue;
      ctx.fillStyle = '#2e6b34';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = '#357a3b';
      ctx.fillRect(p.x + 10, p.y + 10, p.w - 20, p.h - 20);
    }
    // Parking lots.
    for (let i = 0; i < world.lots.length; i++) {
      const p = world.lots[i];
      if (p.x + p.w < x0 || p.x > x1 || p.y + p.h < y0 || p.y > y1) continue;
      ctx.fillStyle = '#2b2f38';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 2;
      for (let s = 0; s < 5; s++) {
        const sx = p.x + 24 + s * 44;
        ctx.strokeRect(sx, p.y + 16, 34, 62);
        ctx.strokeRect(sx, p.y + p.h - 78, 34, 62);
      }
    }

    // Buildings with pseudo-3D shadow + roof + windows.
    for (let i = 0; i < world.buildings.length; i++) {
      const b = world.buildings[i];
      if (b.x + b.w < x0 || b.x > x1 || b.y + b.h < y0 || b.y > y1) continue;
      const h = b.height;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(b.x + h * 0.55, b.y + h * 0.55, b.w, b.h);
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = b.roof;
      ctx.fillRect(b.x + 6, b.y + 6, b.w - 12, b.h - 12);
      ctx.fillStyle = 'rgba(255,230,140,0.75)';
      const cols = Math.max(2, Math.floor(b.w / 34));
      const rows = Math.max(2, Math.floor(b.h / 34));
      for (let cx = 0; cx < cols; cx++) {
        for (let cy = 0; cy < rows; cy++) {
          if ((cx * 7 + cy * 3 + i) % 4 === 0) {
            ctx.fillRect(b.x + 12 + cx * 30, b.y + 12 + cy * 30, 12, 12);
          }
        }
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
    }

    // Trees.
    for (let i = 0; i < world.trees.length; i++) {
      const t = world.trees[i];
      if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1) continue;
      ctx.fillStyle = t.palm ? '#3f7a3a' : '#2c5e2e';
      ctx.beginPath(); ctx.arc(t.x, t.y, t.palm ? 13 : 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4a8a3f';
      ctx.beginPath(); ctx.arc(t.x - 3, t.y - 3, 6, 0, Math.PI * 2); ctx.fill();
    }

    // Street lamps.
    ctx.fillStyle = 'rgba(255,220,130,0.9)';
    for (let i = 0; i < world.lamps.length; i++) {
      const l = world.lamps[i];
      if (l.x < x0 || l.x > x1 || l.y < y0 || l.y > y1) continue;
      ctx.beginPath(); ctx.arc(l.x, l.y, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  NB.WORLD = WORLD;
  NB.BLOCK = BLOCK;
  NB.ROAD_HALF = ROAD_HALF;
  NB.GRID = GRID;
  NB.LAND_EDGE = LAND_EDGE;
  NB.DISTRICTS = DISTRICTS;
  NB.districtAt = districtAt;
  NB.roadCenter = roadCenter;
  NB.isRoad = isRoad;
  NB.snapToRoad = snapToRoad;
  NB.roadAxis = roadAxis;
  NB.buildWorld = buildWorld;
  NB.collideBuildings = collideBuildings;
  NB.drawWorld = drawWorld;
})(typeof window !== 'undefined' ? window : globalThis);
