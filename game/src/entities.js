// Neon Bay — entities: the player, traffic cars, police, pedestrians,
// particles and pickups, plus their AI and drawing.
(function (global) {
  'use strict';
  const NB = global.NB;
  const clamp = NB.clamp, dist = NB.dist, turnToward = NB.turnToward;

  const CAR_COLORS = ['#c0392b', '#2980b9', '#f39c12', '#27ae60', '#8e44ad', '#e67e22', '#1abc9c', '#dfe6e9', '#e84393', '#6c5ce7'];
  const PED_SHIRTS = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71', '#9b59b6', '#e67e22', '#ecf0f1', '#fd79a8', '#00cec9', '#fab1a0'];
  const DIRS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

  function makePlayer(x, y) {
    return {
      x: x, y: y, angle: -Math.PI / 2, hp: 100, maxHp: 100,
      speed: 0, inCar: null, cash: 0, ammo: 12, ammoReserve: 999,
      punchCd: 0, shootCd: 0, reloadT: 0, hurtT: 0, dead: false,
      walkPhase: 0, crimes: 0,
    };
  }

  function makeCar(x, y, angle, kind, color) {
    return {
      kind: kind || 'traffic', // traffic | police | parked | player
      x: x, y: y, angle: angle, speed: 0,
      maxSpeed: kind === 'police' ? 7.2 : 4.6,
      hp: 100, color: color || CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
      driver: kind !== 'parked', dead: false, brake: 0,
      turnCd: 0, hold: false, holdAngle: 0, smokeT: 0,
      width: 22, length: 46,
    };
  }

  function makePed(x, y, cop) {
    return {
      x: x, y: y, angle: Math.random() * Math.PI * 2,
      speed: cop ? 3.4 : 1.1, hp: cop ? 60 : 30,
      cop: !!cop, state: 'walk', // walk | flee | dead
      shirt: cop ? '#1f3a93' : PED_SHIRTS[Math.floor(Math.random() * PED_SHIRTS.length)],
      fleeT: 0, punchCd: 0, deadT: 0, phase: Math.random() * 10,
      tx: x, ty: y,
    };
  }

  function makePickup(x, y, kind, amount) {
    return { x: x, y: y, kind: kind, amount: amount, taken: false, bob: Math.random() * 6 };
  }

  function spawnParticles(game, x, y, color, n, speed, life) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (speed || 3) * (0.4 + Math.random() * 0.8);
      game.particles.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0, maxLife: (life || 0.6) * (0.6 + Math.random() * 0.8),
        color: color, size: 2 + Math.random() * 3,
      });
    }
  }

  function updateParticles(game, dt) {
    const ps = game.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life += dt;
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      p.vx *= 0.94; p.vy *= 0.94;
      if (p.life >= p.maxLife) ps.splice(i, 1);
    }
  }

  // --- Traffic ---
  function spawnTrafficCar(game, rng, nearX, nearY) {
    // Pick a road point 200-700px from the anchor, on a road.
    for (let tries = 0; tries < 20; tries++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(220, 700);
      const x = clamp(nearX + Math.cos(a) * d, 60, NB.WORLD - 60);
      const y = clamp(nearY + Math.sin(a) * d, 60, NB.WORLD - 60);
      const axis = NB.roadAxis(x, y);
      if (!axis) continue;
      const snap = NB.snapToRoad(x, y);
      const ang = axis === 'h' ? (rng.chance(0.5) ? 0 : Math.PI) : (rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2);
      const car = makeCar(snap.x, snap.y, ang, 'traffic');
      car.speed = rng.range(2.2, 4.2);
      return car;
    }
    return null;
  }

  function spawnParkedCar(game, rng) {
    const lot = rng.pick(game.world.lots);
    if (!lot) return null;
    const car = makeCar(
      lot.x + rng.range(30, lot.w - 30),
      lot.y + rng.range(30, lot.h - 30),
      rng.pick(DIRS), 'parked');
    car.speed = 0;
    return car;
  }

  function carAhead(game, car, range) {
    const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
    let best = null, bestD = range;
    const all = game.cars;
    for (let i = 0; i < all.length; i++) {
      const o = all[i];
      if (o === car || o.dead) continue;
      const dx = o.x - car.x, dy = o.y - car.y;
      const along = dx * fx + dy * fy;
      if (along < 0 || along > bestD) continue;
      const side = Math.abs(-dx * fy + dy * fx);
      if (side < 26 && along < bestD) { best = o; bestD = along; }
    }
    return best;
  }

  function updateTraffic(game, dt) {
    const cars = game.cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c.dead || c.kind !== 'traffic') continue;
      if (c.hold) continue; // staged for screenshots
      c.turnCd -= dt;
      // Decide turns at intersections.
      const axis = NB.roadAxis(c.x, c.y);
      if (axis === 'x' && c.turnCd <= 0) {
        c.turnCd = 1.2;
        const r = Math.random();
        const cur = ((c.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const idx = Math.round(cur / (Math.PI / 2)) % 4;
        if (r < 0.22) c.angle = DIRS[(idx + 1) % 4];
        else if (r < 0.44) c.angle = DIRS[(idx + 3) % 4];
      }
      // Brake for the car ahead.
      const ahead = carAhead(game, c, 80);
      const target = ahead ? 0 : c.maxSpeed * (0.75 + ((i * 37) % 10) / 40);
      c.speed += clamp(target - c.speed, -0.25, 0.12) * dt * 60;
      c.speed = Math.max(0, c.speed);
      const nx = c.x + Math.cos(c.angle) * c.speed * dt * 60;
      const ny = c.y + Math.sin(c.angle) * c.speed * dt * 60;
      // Stay on roads: if the next step leaves the road network, turn around.
      if (!NB.isRoad(nx, ny)) {
        c.angle += Math.PI;
        c.x += Math.cos(c.angle) * 4; c.y += Math.sin(c.angle) * 4;
      } else {
        c.x = nx; c.y = ny;
      }
      // Nudge toward the right lane.
      const snap = NB.snapToRoad(c.x, c.y);
      const lane = 15;
      if (snap.axis === 'h') {
        const want = snap.y + (Math.sin(c.angle) > 0 ? lane : -lane) * 0 + (Math.cos(c.angle) > 0 ? lane : -lane);
        c.y += clamp(want - c.y, -0.5, 0.5) * dt * 60;
      } else {
        const want = snap.x + (Math.sin(c.angle) > 0 ? -lane : lane);
        c.x += clamp(want - c.x, -0.5, 0.5) * dt * 60;
      }
      c.x = clamp(c.x, 30, NB.WORLD - 30);
      c.y = clamp(c.y, 30, NB.WORLD - 30);
    }
    // Gentle separation so traffic does not stack.
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        if (a.dead || b.dead) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 0.01 && d < 44) {
          const push = (44 - d) / 2;
          const ux = dx / d, uy = dy / d;
          a.x -= ux * push * 0.5; a.y -= uy * push * 0.5;
          b.x += ux * push * 0.5; b.y += uy * push * 0.5;
          if (a.kind === 'traffic' && b.kind === 'traffic') { a.speed *= 0.9; b.speed *= 0.9; }
        }
      }
    }
  }

  // --- Pedestrians ---
  function spawnPed(game, rng, nearX, nearY) {
    for (let tries = 0; tries < 12; tries++) {
      const x = clamp(nearX + rng.range(-420, 420), 50, NB.WORLD - 50);
      const y = clamp(nearY + rng.range(-420, 420), 50, NB.WORLD - 50);
      if (NB.isRoad(x, y)) continue; // peds stay on sidewalks / blocks
      if (NB.collideBuildings(game.world, x, y, 10)) continue;
      return makePed(x, y, false);
    }
    return null;
  }

  function updatePeds(game, dt, player) {
    const peds = game.peds;
    for (let i = peds.length - 1; i >= 0; i--) {
      const p = peds[i];
      if (p.state === 'dead') {
        p.deadT += dt;
        if (p.deadT > 12) peds.splice(i, 1);
        continue;
      }
      p.punchCd -= dt;
      p.phase += dt * 6;
      const pd = dist(p.x, p.y, player.x, player.y);
      // Flee from a fast car or a gunshot nearby.
      if (p.state !== 'flee' && game.threatT > 0 && pd < 260) {
        p.state = 'flee'; p.fleeT = 2.2;
      }
      if (p.state === 'flee') {
        p.fleeT -= dt;
        const a = Math.atan2(p.y - player.y, p.x - player.x);
        p.angle = turnToward(p.angle, a, 0.25);
        const sp = p.cop ? 3.4 : 3.6;
        p.x += Math.cos(p.angle) * sp * dt * 60;
        p.y += Math.sin(p.angle) * sp * dt * 60;
        if (p.fleeT <= 0) p.state = 'walk';
      } else if (p.cop) {
        // Foot cop chases the player on foot.
        if (!player.inCar && pd < 520 && game.wanted > 0) {
          const a = Math.atan2(player.y - p.y, player.x - p.x);
          p.angle = turnToward(p.angle, a, 0.2);
          p.x += Math.cos(p.angle) * p.speed * dt * 60;
          p.y += Math.sin(p.angle) * p.speed * dt * 60;
          if (pd < 28 && p.punchCd <= 0) {
            p.punchCd = 0.9;
            return { punched: true, ped: p };
          }
        } else {
          // Wander back toward a road.
          p.x += Math.cos(p.angle) * 0.8 * dt * 60;
          p.y += Math.sin(p.angle) * 0.8 * dt * 60;
          if (Math.random() < 0.01) p.angle = Math.random() * Math.PI * 2;
        }
      } else {
        // Wander the sidewalks.
        p.x += Math.cos(p.angle) * p.speed * dt * 60;
        p.y += Math.sin(p.angle) * p.speed * dt * 60;
        const hit = NB.collideBuildings(game.world, p.x, p.y, 9);
        if (hit) { p.x = hit.x; p.y = hit.y; p.angle += Math.PI / 2 + (Math.random() - 0.5); }
        if (Math.random() < 0.008) p.angle += (Math.random() - 0.5) * 1.6;
        p.x = clamp(p.x, 30, NB.WORLD - 30);
        p.y = clamp(p.y, 30, NB.WORLD - 30);
      }
    }
    return null;
  }

  // --- Police cars ---
  function spawnPoliceCar(game, rng, nearX, nearY) {
    for (let tries = 0; tries < 16; tries++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(420, 700);
      const x = clamp(nearX + Math.cos(a) * d, 60, NB.WORLD - 60);
      const y = clamp(nearY + Math.sin(a) * d, 60, NB.WORLD - 60);
      if (!NB.isRoad(x, y)) continue;
      const snap = NB.snapToRoad(x, y);
      const car = makeCar(snap.x, snap.y, 0, 'police', '#f5f6fa');
      car.speed = 4;
      return car;
    }
    return null;
  }

  function updatePolice(game, dt, player) {
    const cars = game.cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c.dead || c.kind !== 'police') continue;
      if (c.hold) {
        // Staged orbit for screenshots: circle the player at ~170px.
        c.holdAngle += dt * 0.5;
        const tx = player.x + Math.cos(c.holdAngle) * 170;
        const ty = player.y + Math.sin(c.holdAngle) * 170;
        c.angle = turnToward(c.angle, Math.atan2(ty - c.y, tx - c.x), 0.12);
        c.speed = 2.2;
        c.x += Math.cos(c.angle) * c.speed * dt * 60;
        c.y += Math.sin(c.angle) * c.speed * dt * 60;
        continue;
      }
      const d = dist(c.x, c.y, player.x, player.y);
      const want = Math.atan2(player.y - c.y, player.x - c.x);
      c.angle = turnToward(c.angle, want, 0.055 * dt * 60);
      const target = d > 700 ? c.maxSpeed : (d > 120 ? c.maxSpeed * 0.85 : 4.5);
      c.speed += clamp(target - c.speed, -0.3, 0.15) * dt * 60;
      const nx = c.x + Math.cos(c.angle) * c.speed * dt * 60;
      const ny = c.y + Math.sin(c.angle) * c.speed * dt * 60;
      // Police cut corners off-road to chase.
      const hit = NB.collideBuildings(game.world, nx, ny, 20);
      if (hit) { c.x = hit.x; c.y = hit.y; c.speed *= 0.6; }
      else { c.x = nx; c.y = ny; }
      c.x = clamp(c.x, 30, NB.WORLD - 30);
      c.y = clamp(c.y, 30, NB.WORLD - 30);
      // Drop a foot cop when close to a player on foot.
      if (!player.inCar && d < 130 && game.footCops < 2 && Math.random() < 0.01) {
        const cop = makePed(c.x + 24, c.y, true);
        game.peds.push(cop);
        game.footCops++;
      }
    }
  }

  // --- Drawing ---
  function drawCar(ctx, car, time) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    const L = car.length, W = car.width;
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-L / 2 + 3, -W / 2 + 4, L, W);
    // Wheels.
    ctx.fillStyle = '#0c0d10';
    ctx.fillRect(-L / 2 + 4, -W / 2 - 3, 10, 5);
    ctx.fillRect(-L / 2 + 4, W / 2 - 2, 10, 5);
    ctx.fillRect(L / 2 - 14, -W / 2 - 3, 10, 5);
    ctx.fillRect(L / 2 - 14, W / 2 - 2, 10, 5);
    // Body.
    ctx.fillStyle = car.color;
    ctx.beginPath();
    const r = 7;
    ctx.moveTo(-L / 2 + r, -W / 2);
    ctx.lineTo(L / 2 - r, -W / 2);
    ctx.quadraticCurveTo(L / 2, -W / 2, L / 2, -W / 2 + r);
    ctx.lineTo(L / 2, W / 2 - r);
    ctx.quadraticCurveTo(L / 2, W / 2, L / 2 - r, W / 2);
    ctx.lineTo(-L / 2 + r, W / 2);
    ctx.quadraticCurveTo(-L / 2, W / 2, -L / 2, W / 2 - r);
    ctx.lineTo(-L / 2, -W / 2 + r);
    ctx.quadraticCurveTo(-L / 2, -W / 2, -L / 2 + r, -W / 2);
    ctx.fill();
    // Police livery.
    if (car.kind === 'police') {
      ctx.fillStyle = '#14161c';
      ctx.fillRect(-6, -W / 2, 12, W);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('POLICE', 0, 3);
      // Light bar.
      const on = Math.floor(time / 280) % 2 === 0;
      ctx.fillStyle = on ? '#ff2d3f' : '#2d7bff';
      ctx.fillRect(-4, -W / 2 - 2, 8, 5);
      ctx.fillStyle = on ? '#2d7bff' : '#ff2d3f';
      ctx.fillRect(-4, W / 2 - 3, 8, 5);
    }
    // Windshield + roof.
    ctx.fillStyle = 'rgba(20,28,40,0.85)';
    ctx.fillRect(L / 2 - 18, -W / 2 + 4, 8, W - 8);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(-8, -W / 2 + 4, 14, W - 8);
    // Headlights.
    ctx.fillStyle = '#ffe9a3';
    ctx.fillRect(L / 2 - 2, -W / 2 + 3, 3, 5);
    ctx.fillRect(L / 2 - 2, W / 2 - 8, 3, 5);
    // Damage smoke.
    if (car.hp < 45) {
      ctx.fillStyle = 'rgba(120,120,120,0.5)';
      ctx.beginPath(); ctx.arc(-L / 4, 0, 5 + Math.sin(time / 120) * 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawPed(ctx, p, time) {
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.state === 'dead') {
      ctx.rotate(p.angle + Math.PI / 2);
      ctx.fillStyle = p.shirt;
      ctx.beginPath(); ctx.ellipse(0, 0, 11, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8b98a';
      ctx.beginPath(); ctx.arc(12, 0, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    const bob = Math.sin(p.phase) * 1.5;
    ctx.rotate(p.angle);
    // Body.
    ctx.fillStyle = p.shirt;
    ctx.fillRect(-6, -5, 12, 10);
    // Head.
    ctx.fillStyle = p.cop ? '#1f3a93' : '#e8b98a';
    ctx.beginPath(); ctx.arc(9, 0, 5.5, 0, Math.PI * 2); ctx.fill();
    if (p.cop) {
      ctx.fillStyle = '#0d1f4d';
      ctx.fillRect(5, -6, 8, 3);
    }
    // Walking legs.
    ctx.fillStyle = '#22242c';
    ctx.fillRect(-9, -5 + bob, 4, 3);
    ctx.fillRect(-9, 2 - bob, 4, 3);
    ctx.restore();
  }

  function drawPlayer(ctx, player, time) {
    const p = player;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(2, 3, 12, 8, 0, 0, Math.PI * 2); ctx.fill();
    const bob = Math.sin(p.walkPhase) * 1.5;
    // Legs.
    ctx.fillStyle = '#1d2a4a';
    ctx.fillRect(-9, -5 + bob, 5, 3);
    ctx.fillRect(-9, 2 - bob, 5, 3);
    // Jacket (player is the one in the yellow jacket).
    ctx.fillStyle = '#ffd75e';
    ctx.fillRect(-7, -6, 13, 12);
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(-7, -6, 13, 3);
    // Head.
    ctx.fillStyle = '#e8b98a';
    ctx.beginPath(); ctx.arc(9, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(8, 0, 6, Math.PI * 0.9, Math.PI * 2.1); ctx.fill();
    // Pistol in hand when aiming.
    if (p.aiming) {
      ctx.fillStyle = '#14161c';
      ctx.fillRect(12, -2, 9, 4);
    }
    ctx.restore();
  }

  function drawPickup(ctx, pk, time) {
    const bobY = Math.sin(time / 300 + pk.bob) * 3;
    ctx.save();
    ctx.translate(pk.x, pk.y + bobY);
    if (pk.kind === 'cash') {
      ctx.fillStyle = '#2ecc71';
      ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0d5c2e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('$', 0, 1);
    } else if (pk.kind === 'ammo') {
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(-11, -7, 22, 14);
      ctx.strokeStyle = '#7a5c00'; ctx.lineWidth = 2; ctx.strokeRect(-11, -7, 22, 14);
      ctx.fillStyle = '#222';
      ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('AMMO', 0, 1);
    } else {
      ctx.fillStyle = '#fff';
      ctx.fillRect(-10, -10, 20, 20);
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(-3, -8, 6, 16);
      ctx.fillRect(-8, -3, 16, 6);
    }
    ctx.restore();
  }

  function drawParticles(ctx, particles) {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      ctx.globalAlpha = 1 - p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  NB.CAR_COLORS = CAR_COLORS;
  NB.PED_SHIRTS = PED_SHIRTS;
  NB.makePlayer = makePlayer;
  NB.makeCar = makeCar;
  NB.makePed = makePed;
  NB.makePickup = makePickup;
  NB.spawnParticles = spawnParticles;
  NB.updateParticles = updateParticles;
  NB.spawnTrafficCar = spawnTrafficCar;
  NB.spawnParkedCar = spawnParkedCar;
  NB.spawnPed = spawnPed;
  NB.spawnPoliceCar = spawnPoliceCar;
  NB.updateTraffic = updateTraffic;
  NB.updatePeds = updatePeds;
  NB.updatePolice = updatePolice;
  NB.drawCar = drawCar;
  NB.drawPed = drawPed;
  NB.drawPlayer = drawPlayer;
  NB.drawPickup = drawPickup;
  NB.drawParticles = drawParticles;
})(typeof window !== 'undefined' ? window : globalThis);
