// Neon Bay — main loop: input, driving / walking, combat, the wanted system,
// HUD + minimap, missions wiring, saving, and the menu / pause / game-over flow.
(function (global) {
  'use strict';
  const NB = global.NB;
  const clamp = NB.clamp, dist = NB.dist, turnToward = NB.turnToward;

  const SAVE_KEY = 'neonbay-save-v1';
  const SPAWN = { x: 1600, y: 1760 };

  const $ = function (id) { return document.getElementById(id); };
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const minimap = $('minimap');
  const mctx = minimap.getContext('2d');

  const game = {
    state: 'menu', // menu | playing | paused | over
    world: NB.buildWorld(1337),
    player: NB.makePlayer(SPAWN.x, SPAWN.y),
    cars: [], peds: [], particles: [], pickups: [], tracers: [],
    wanted: 0, wantedTimer: 0, crimeTimer: 0, threatT: 0,
    missions: null, stats: { earned: 0, missions: 0, stolen: 0, pedsDown: 0, copsDown: 0, shots: 0 },
    footCops: 0, autopilot: false, shotMode: false,
    cam: { x: 0, y: 0, w: 1280, h: 720 },
    time: 0, lastT: 0, toastT: 0, toastMsg: '',
    missionRetryT: 0, missionRetryIdx: 0,
    menuCamX: 1500, menuCamY: 1500, menuCamA: 0,
    bustT: 0, lastDamageBy: 'crash',
    spawnT: 0, pickupT: 12, policeT: 0,
    keys: {}, mouseX: 0, mouseY: 0, mouseDown: false,
    audio: new NB.AudioEngine(),
    hudDirty: true,
  };
  game.missions = NB.makeMissionState(null);

  // ---------- helpers attached to game (used by missions.js) ----------
  game.toast = function (msg) {
    game.toastMsg = msg;
    game.toastT = 2.4;
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
  };
  game.setWanted = function (n) {
    const old = game.wanted;
    game.wanted = clamp(Math.round(n), 0, 5);
    if (game.wanted > old) {
      game.toast('WANTED LEVEL ' + game.wanted + (game.wanted >= 3 ? ' — THE HEAT IS ON' : ''));
      if (game.wanted >= 1 && game.audio) game.audio.startSiren();
    }
    if (game.wanted === 0 && game.audio) game.audio.stopSiren();
    game.hudDirty = true;
  };
  game.addWanted = function (n, kind) {
    const now = game.time;
    game._crimeCd = game._crimeCd || {};
    if (game._crimeCd[kind] && now - game._crimeCd[kind] < 3) return;
    game._crimeCd[kind] = now;
    game.crimeTimer = 0;
    game.setWanted(game.wanted + n);
  };
  game.save = function () {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        cash: game.player.cash,
        missionIdx: game.missions.idx,
        completed: game.missions.done,
        finishedAll: game.missions.finishedAll,
        earned: game.stats.earned,
      }));
    } catch (e) {}
  };
  game.loadSave = function () {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };

  // ---------- population ----------
  function countKind(kind) {
    let n = 0;
    for (let i = 0; i < game.cars.length; i++) if (game.cars[i].kind === kind && !game.cars[i].dead) n++;
    return n;
  }
  function maintainPopulation(dt) {
    const p = game.player;
    game.spawnT -= dt;
    if (game.spawnT <= 0) {
      game.spawnT = 0.7;
      const rng = NB.makeRng((Math.random() * 1e9) | 0);
      if (countKind('traffic') < 14) {
        const c = NB.spawnTrafficCar(game, rng, p.x, p.y);
        if (c) game.cars.push(c);
      }
      if (game.peds.length < 22) {
        const ped = NB.spawnPed(game, rng, p.x, p.y);
        if (ped) game.peds.push(ped);
      }
      if (countKind('parked') < 6) {
        const c = NB.spawnParkedCar(game, rng);
        if (c) game.cars.push(c);
      }
    }
    // Remove far-away traffic / peds.
    for (let i = game.cars.length - 1; i >= 0; i--) {
      const c = game.cars[i];
      if ((c.kind === 'traffic' || c.kind === 'police') && !c.hold && dist(c.x, c.y, p.x, p.y) > 1100) {
        game.cars.splice(i, 1);
      }
    }
    for (let i = game.peds.length - 1; i >= 0; i--) {
      const ped = game.peds[i];
      if (ped.state !== 'dead' && dist(ped.x, ped.y, p.x, p.y) > 1100) game.peds.splice(i, 1);
    }
    // Cash / ammo / health pickups drift in.
    game.pickupT -= dt;
    if (game.pickupT <= 0) {
      game.pickupT = 22;
      const kinds = ['cash', 'cash', 'ammo', 'health'];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      const a = Math.random() * Math.PI * 2, d = 260 + Math.random() * 300;
      const x = clamp(p.x + Math.cos(a) * d, 60, NB.WORLD - 60);
      const y = clamp(p.y + Math.sin(a) * d, 60, NB.WORLD - 60);
      if (!NB.collideBuildings(game.world, x, y, 12)) {
        game.pickups.push(NB.makePickup(x, y, kind, kind === 'cash' ? 150 + Math.floor(Math.random() * 200) : kind === 'ammo' ? 12 : 30));
      }
    }
  }

  function maintainPolice(dt) {
    const p = game.player;
    const want = game.wanted === 0 ? 0 : Math.min(4, game.wanted + 1);
    let have = 0;
    for (let i = 0; i < game.cars.length; i++) if (game.cars[i].kind === 'police' && !game.cars[i].dead) have++;
    game.policeT -= dt;
    if (have < want && game.policeT <= 0) {
      game.policeT = 2.0;
      const rng = NB.makeRng((Math.random() * 1e9) | 0);
      const c = NB.spawnPoliceCar(game, rng, p.x, p.y);
      if (c) game.cars.push(c);
    }
    if (game.wanted === 0) {
      for (let i = game.cars.length - 1; i >= 0; i--) {
        const c = game.cars[i];
        if (c.kind === 'police' && dist(c.x, c.y, p.x, p.y) > 800) game.cars.splice(i, 1);
      }
    }
    // Count live foot cops.
    let cops = 0;
    for (let i = 0; i < game.peds.length; i++) if (game.peds[i].cop && game.peds[i].state !== 'dead') cops++;
    game.footCops = cops;
  }

  function wantedDecay(dt) {
    if (game.wanted <= 0) return;
    game.crimeTimer += dt;
    if (game.crimeTimer < 15) return;
    // Only decay when no police is near.
    let near = false;
    for (let i = 0; i < game.cars.length; i++) {
      const c = game.cars[i];
      if (c.kind === 'police' && dist(c.x, c.y, game.player.x, game.player.y) < 450) { near = true; break; }
    }
    if (near) return;
    game.wantedTimer += dt;
    if (game.wantedTimer > 10) {
      game.wantedTimer = 0;
      game.setWanted(game.wanted - 1);
    }
  }

  // ---------- player: on foot ----------
  function nearestCar(maxD) {
    const p = game.player;
    let best = null, bestD = maxD;
    for (let i = 0; i < game.cars.length; i++) {
      const c = game.cars[i];
      if (c.dead || c.kind === 'police') continue;
      const d = dist(p.x, p.y, c.x, c.y);
      if (d < bestD) { best = c; bestD = d; }
    }
    return best;
  }

  function nearestPed(maxD) {
    const p = game.player;
    let best = null, bestD = maxD;
    for (let i = 0; i < game.peds.length; i++) {
      const ped = game.peds[i];
      if (ped.state === 'dead') continue;
      const d = dist(p.x, p.y, ped.x, ped.y);
      if (d < bestD) { best = ped; bestD = d; }
    }
    return best;
  }

  function damagePlayer(amount, by) {
    const p = game.player;
    if (game.shotMode || game.state !== 'playing') return;
    p.hp -= amount;
    p.hurtT = 0.5;
    game.lastDamageBy = by || 'crash';
    if (p.hp <= 0) {
      p.hp = 0;
      endGame(game.lastDamageBy === 'cop' ? 'busted' : 'wasted');
    }
    game.hudDirty = true;
  }

  function shoot() {
    const p = game.player;
    if (p.inCar || p.reloadT > 0 || p.shootCd > 0) return;
    if (p.ammo <= 0) { game.toast('OUT OF AMMO — press R'); return; }
    p.ammo--;
    p.shootCd = 0.28;
    game.stats.shots++;
    game.audio.ensure(); game.audio.shot();
    game.threatT = 2.5;
    game.addWanted(1, 'shot');
    const mx = game.cam.x + game.mouseX, my = game.cam.y + game.mouseY;
    const aim = Math.atan2(my - p.y, mx - p.x);
    p.angle = aim;
    const range = 430;
    const tx = p.x + Math.cos(aim) * range, ty = p.y + Math.sin(aim) * range;
    game.tracers.push({ x1: p.x, y1: p.y, x2: tx, y2: ty, life: 0 });
    NB.spawnParticles(game, p.x + Math.cos(aim) * 20, p.y + Math.sin(aim) * 20, '#ffd75e', 4, 2, 0.15);
    // Hit-scan: nearest ped / cop / car along the ray.
    let best = null, bestD = range, bestKind = null;
    const fx = Math.cos(aim), fy = Math.sin(aim);
    for (let i = 0; i < game.peds.length; i++) {
      const ped = game.peds[i];
      if (ped.state === 'dead') continue;
      const dx = ped.x - p.x, dy = ped.y - p.y;
      const along = dx * fx + dy * fy;
      if (along < 0 || along > bestD) continue;
      const side = Math.abs(-dx * fy + dy * fx);
      if (side < 16) { best = ped; bestD = along; bestKind = 'ped'; }
    }
    for (let i = 0; i < game.cars.length; i++) {
      const c = game.cars[i];
      if (c.dead || c === p.inCar) continue;
      const dx = c.x - p.x, dy = c.y - p.y;
      const along = dx * fx + dy * fy;
      if (along < 0 || along > bestD) continue;
      const side = Math.abs(-dx * fy + dy * fx);
      if (side < 22) { best = c; bestD = along; bestKind = 'car'; }
    }
    if (best) {
      game.tracers[game.tracers.length - 1].x2 = p.x + fx * bestD;
      game.tracers[game.tracers.length - 1].y2 = p.y + fy * bestD;
      if (bestKind === 'ped') {
        best.hp -= 34;
        NB.spawnParticles(game, best.x, best.y, '#ff5b6a', 8, 3, 0.5);
        if (best.hp <= 0) {
          best.state = 'dead'; best.deadT = 0;
          game.addWanted(best.cop ? 2 : 1, best.cop ? 'copdown' : 'peddown');
          if (best.cop) game.stats.copsDown++; else game.stats.pedsDown++;
        } else if (!best.cop) { best.state = 'flee'; best.fleeT = 2; }
      } else {
        best.hp -= 20;
        NB.spawnParticles(game, best.x, best.y, '#ffb52e', 8, 3, 0.5);
        if (best.hp <= 0) explodeCar(best);
      }
    }
    game.hudDirty = true;
  }

  function punch() {
    const p = game.player;
    if (p.inCar || p.punchCd > 0) return;
    p.punchCd = 0.45;
    game.audio.ensure(); game.audio.punch();
    const ped = nearestPed(40);
    if (!ped) return;
    ped.hp -= 15;
    ped.x += Math.cos(p.angle) * 14; ped.y += Math.sin(p.angle) * 14;
    NB.spawnParticles(game, ped.x, ped.y, '#ffe27a', 6, 2.5, 0.4);
    if (ped.hp <= 0) {
      ped.state = 'dead'; ped.deadT = 0;
      game.addWanted(ped.cop ? 2 : 1, ped.cop ? 'copdown' : 'peddown');
      if (ped.cop) game.stats.copsDown++; else game.stats.pedsDown++;
    } else {
      ped.state = 'flee'; ped.fleeT = 1.6;
      if (!ped.cop) game.addWanted(1, 'assault');
    }
  }

  function enterCar(car) {
    const p = game.player;
    if (car.kind === 'traffic' && car.driver) {
      // Yank the driver out; they flee on foot.
      car.driver = false;
      const d = NB.makePed(car.x + 26, car.y, false);
      d.state = 'flee'; d.fleeT = 3;
      game.peds.push(d);
      game.stats.stolen++;
      game.addWanted(1, 'steal');
      game.toast('CAR STOLEN');
    }
    car.kind = 'player';
    p.inCar = car;
    p.x = car.x; p.y = car.y; p.angle = car.angle;
    game.audio.ensure(); game.audio.startEngine();
    game.hudDirty = true;
  }

  function exitCar() {
    const p = game.player;
    const car = p.inCar;
    if (!car) return;
    car.kind = 'parked';
    car.speed = 0;
    p.inCar = null;
    p.x = car.x + Math.cos(car.angle + Math.PI / 2) * 30;
    p.y = car.y + Math.sin(car.angle + Math.PI / 2) * 30;
    p.angle = car.angle;
    game.audio.stopEngine();
    game.hudDirty = true;
  }

  function explodeCar(car) {
    if (car.dead) return;
    car.dead = true;
    car.hp = 0;
    NB.spawnParticles(game, car.x, car.y, '#ff9f1a', 40, 6, 1.1);
    NB.spawnParticles(game, car.x, car.y, '#5a5a5a', 24, 3, 1.4);
    NB.spawnParticles(game, car.x, car.y, '#ffd75e', 20, 5, 0.6);
    game.audio.ensure(); game.audio.crash();
    game.threatT = 3;
    if (game.player.inCar === car) {
      game.player.inCar = null;
      game.audio.stopEngine();
      damagePlayer(25, 'crash');
      game.player.x = car.x + 40; game.player.y = car.y;
    }
    game.addWanted(1, 'explosion');
  }

  function updatePlayerOnFoot(dt) {
    const p = game.player;
    const k = game.keys;
    let mx = (k['KeyD'] || k['ArrowRight'] ? 1 : 0) - (k['KeyA'] || k['ArrowLeft'] ? 1 : 0);
    let my = (k['KeyS'] || k['ArrowDown'] ? 1 : 0) - (k['KeyW'] || k['ArrowUp'] ? 1 : 0);
    const sprint = !!(k['ShiftLeft'] || k['ShiftRight']);
    const speed = sprint ? 5.0 : 3.2;
    if (mx !== 0 || my !== 0) {
      const len = Math.hypot(mx, my);
      mx /= len; my /= len;
      p.x += mx * speed * dt * 60;
      p.y += my * speed * dt * 60;
      p.angle = Math.atan2(my, mx);
      p.walkPhase += dt * (sprint ? 14 : 9);
    }
    const hit = NB.collideBuildings(game.world, p.x, p.y, 12);
    if (hit) { p.x = hit.x; p.y = hit.y; }
    p.x = clamp(p.x, 20, NB.WORLD - 20);
    p.y = clamp(p.y, 20, NB.WORLD - 20);
    // Pickups.
    for (let i = game.pickups.length - 1; i >= 0; i--) {
      const pk = game.pickups[i];
      if (pk.taken) continue;
      if (dist(p.x, p.y, pk.x, pk.y) < 44) {
        pk.taken = true;
        game.pickups.splice(i, 1);
        if (pk.kind === 'cash') { p.cash += pk.amount; game.stats.earned += pk.amount; game.audio.cash(); game.toast('+$' + pk.amount); }
        if (pk.kind === 'ammo') { p.ammo += pk.amount; game.audio.pickup(); game.toast('AMMO +' + pk.amount); }
        if (pk.kind === 'health') { p.hp = Math.min(p.maxHp, p.hp + pk.amount); game.audio.pickup(); game.toast('HEALTH +' + pk.amount); }
        game.hudDirty = true;
      }
    }
    // Shooting / punching.
    if (game.mouseDown) shoot();
    p.shootCd -= dt; p.punchCd -= dt;
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) { p.ammo = 12; game.hudDirty = true; }
    }
    // Crosshair follows the mouse.
    const ch = $('crosshair');
    ch.style.left = game.mouseX + 'px';
    ch.style.top = game.mouseY + 'px';
    // Busted: a slow police car sits on top of you.
    if (game.wanted > 0) {
      let onTop = false;
      for (let i = 0; i < game.cars.length; i++) {
        const c = game.cars[i];
        if (c.kind === 'police' && c.speed < 1.6 && dist(c.x, c.y, p.x, p.y) < 34) { onTop = true; break; }
      }
      if (onTop) {
        game.bustT += dt;
        if (game.bustT > 1.2) endGame('busted');
      } else game.bustT = 0;
    }
  }

  function updatePlayerInCar(dt) {
    const p = game.player;
    const car = p.inCar;
    const k = game.keys;
    const throttle = (k['KeyW'] || k['ArrowUp'] ? 1 : 0) - (k['KeyS'] || k['ArrowDown'] ? 0.6 : 0);
    const steer = (k['KeyA'] || k['ArrowLeft'] ? 1 : 0) - (k['KeyD'] || k['ArrowRight'] ? 1 : 0);
    if (game.autopilot) {
      // Staged driving for the 'drive' screenshot: follow a waypoint loop
      // around one downtown block so the car stays on the roads, in traffic.
      const wps = game.autoWps;
      const wp = wps[game.autoWpIdx || 0];
      const want = Math.atan2(wp.y - car.y, wp.x - car.x);
      car.angle = turnToward(car.angle, want, 0.05 * dt * 60);
      car.speed = Math.min(car.speed + 0.06, 3.2);
      if (dist(car.x, car.y, wp.x, wp.y) < 50) {
        game.autoWpIdx = ((game.autoWpIdx || 0) + 1) % wps.length;
      }
    } else {
      if (throttle > 0) car.speed += 0.16 * dt * 60;
      else if (throttle < 0) car.speed -= 0.12 * dt * 60;
      else car.speed *= Math.pow(0.985, dt * 60);
      if (steer !== 0 && Math.abs(car.speed) > 0.3) {
        car.angle += steer * 0.045 * Math.sign(car.speed) * dt * 60 * Math.min(1, Math.abs(car.speed) / 4);
      }
      car.speed = clamp(car.speed, -3.2, 8.6);
    }
    const nx = car.x + Math.cos(car.angle) * car.speed * dt * 60;
    const ny = car.y + Math.sin(car.angle) * car.speed * dt * 60;
    const hit = NB.collideBuildings(game.world, nx, ny, 20);
    if (hit) {
      const impact = Math.abs(car.speed);
      if (impact > 4) {
        car.hp -= impact * 4;
        damagePlayer(Math.round(impact * 1.2), 'crash');
        game.audio.ensure(); game.audio.crash();
        NB.spawnParticles(game, nx, ny, '#ffb52e', 12, 3, 0.5);
      }
      car.speed *= 0.35;
      car.x = hit.x; car.y = hit.y;
    } else {
      car.x = nx; car.y = ny;
    }
    car.x = clamp(car.x, 30, NB.WORLD - 30);
    car.y = clamp(car.y, 30, NB.WORLD - 30);
    // Run over pedestrians.
    for (let i = 0; i < game.peds.length; i++) {
      const ped = game.peds[i];
      if (ped.state === 'dead') continue;
      if (dist(car.x, car.y, ped.x, ped.y) < 26 && Math.abs(car.speed) > 2.5) {
        ped.state = 'dead'; ped.deadT = 0;
        NB.spawnParticles(game, ped.x, ped.y, '#ff5b6a', 10, 3, 0.6);
        game.addWanted(ped.cop ? 2 : 1, ped.cop ? 'copdown' : 'peddown');
        if (ped.cop) game.stats.copsDown++; else game.stats.pedsDown++;
        car.speed *= 0.94;
      }
    }
    // Ram traffic cars.
    for (let i = 0; i < game.cars.length; i++) {
      const o = game.cars[i];
      if (o === car || o.dead) continue;
      const d = dist(car.x, car.y, o.x, o.y);
      if (d < 44 && d > 0.01) {
        const rel = Math.abs(car.speed - o.speed);
        const ux = (o.x - car.x) / d, uy = (o.y - car.y) / d;
        o.x += ux * 6; o.y += uy * 6;
        car.x -= ux * 3; car.y -= uy * 3;
        if (rel > 3) {
          car.hp -= rel * 2.5; o.hp -= rel * 3;
          game.audio.ensure(); game.audio.crash();
          NB.spawnParticles(game, (car.x + o.x) / 2, (car.y + o.y) / 2, '#ffb52e', 8, 3, 0.4);
          if (o.kind === 'police') game.addWanted(1, 'ramcop');
        }
        if (o.hp <= 0 && o.kind !== 'player') explodeCar(o);
        car.speed *= 0.8;
      }
    }
    if (car.hp <= 0) explodeCar(car);
    p.x = car.x; p.y = car.y; p.angle = car.angle;
    game.audio.setEngine(Math.abs(car.speed) / 8.6);
  }

  // ---------- render ----------
  function render() {
    const cam = game.cam;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0d16';
    ctx.fillRect(0, 0, cam.w, cam.h);
    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    NB.drawWorld(ctx, game.world, cam, game.time * 1000);
    // Mission beacon.
    const obj = NB.currentObjective(game);
    if (obj.target && game.state === 'playing') {
      const pulse = 1 + Math.sin(game.time * 4) * 0.15;
      ctx.save();
      ctx.translate(obj.target.x, obj.target.y);
      ctx.strokeStyle = '#ffd75e';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, 34 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,215,94,0.25)';
      ctx.beginPath(); ctx.arc(0, 0, 34 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd75e';
      ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(10, 6); ctx.lineTo(-10, 6); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // Pickups.
    for (let i = 0; i < game.pickups.length; i++) {
      if (!game.pickups[i].taken) NB.drawPickup(ctx, game.pickups[i], game.time * 1000);
    }
    // Cars (police last so their lights draw on top).
    for (let i = 0; i < game.cars.length; i++) {
      const c = game.cars[i];
      if (!c.dead && c.kind !== 'police') NB.drawCar(ctx, c, game.time * 1000);
    }
    for (let i = 0; i < game.cars.length; i++) {
      const c = game.cars[i];
      if (!c.dead && c.kind === 'police') NB.drawCar(ctx, c, game.time * 1000);
    }
    // Peds + player.
    for (let i = 0; i < game.peds.length; i++) NB.drawPed(ctx, game.peds[i], game.time * 1000);
    if (game.state !== 'menu' && !game.player.inCar) NB.drawPlayer(ctx, game.player, game.time * 1000);
    // Tracers.
    for (let i = 0; i < game.tracers.length; i++) {
      const t = game.tracers[i];
      ctx.globalAlpha = Math.max(0, 1 - t.life / 0.12);
      ctx.strokeStyle = '#ffe27a';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    NB.drawParticles(ctx, game.particles);
    // Hurt vignette.
    if (game.player.hurtT > 0) {
      ctx.fillStyle = 'rgba(255,40,60,' + (game.player.hurtT * 0.25) + ')';
      ctx.fillRect(cam.x, cam.y, cam.w, cam.h);
    }
    ctx.restore();
    drawMinimap();
  }

  function drawMinimap() {
    const s = 180 / NB.WORLD;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.fillStyle = '#0b0e18';
    mctx.fillRect(0, 0, 180, 180);
    // Water edges.
    mctx.fillStyle = '#1d5f8a';
    mctx.fillRect(0, 2970 * s, 180, (NB.WORLD - 2970) * s);
    mctx.fillRect(2970 * s, 0, (NB.WORLD - 2970) * s, 180);
    // Roads.
    mctx.strokeStyle = 'rgba(255,255,255,0.4)';
    mctx.lineWidth = 1.5;
    for (let k = 0; k <= NB.GRID; k++) {
      const c = NB.roadCenter(k) * s;
      mctx.beginPath(); mctx.moveTo(0, c); mctx.lineTo(180, c); mctx.stroke();
      mctx.beginPath(); mctx.moveTo(c, 0); mctx.lineTo(c, 180); mctx.stroke();
    }
    // Mission target.
    const obj = NB.currentObjective(game);
    if (obj.target && game.state === 'playing') {
      mctx.fillStyle = '#ffd75e';
      mctx.save();
      mctx.translate(obj.target.x * s, obj.target.y * s);
      mctx.rotate(Math.PI / 4);
      mctx.fillRect(-4, -4, 8, 8);
      mctx.restore();
    }
    // Pickups.
    mctx.fillStyle = '#2ecc71';
    for (let i = 0; i < game.pickups.length; i++) {
      if (!game.pickups[i].taken) mctx.fillRect(game.pickups[i].x * s - 1.5, game.pickups[i].y * s - 1.5, 3, 3);
    }
    // Traffic.
    mctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < game.cars.length; i++) {
      const c = game.cars[i];
      if (c.dead || c.kind === 'player') continue;
      mctx.fillRect(c.x * s - 1, c.y * s - 1, 2, 2);
    }
    // Police.
    mctx.fillStyle = '#ff3b4d';
    for (let i = 0; i < game.cars.length; i++) {
      const c = game.cars[i];
      if (c.dead || c.kind !== 'police') continue;
      mctx.beginPath(); mctx.arc(c.x * s, c.y * s, 3, 0, Math.PI * 2); mctx.fill();
    }
    // Player arrow.
    const p = game.player;
    mctx.save();
    mctx.translate(p.x * s, p.y * s);
    mctx.rotate(p.angle);
    mctx.fillStyle = '#fff';
    mctx.beginPath(); mctx.moveTo(6, 0); mctx.lineTo(-4, -4); mctx.lineTo(-4, 4); mctx.closePath(); mctx.fill();
    mctx.restore();
  }

  // ---------- HUD ----------
  function updateHUD() {
    const p = game.player;
    $('cash').textContent = '$' + p.cash.toLocaleString('en-US');
    $('healthfill').style.width = Math.max(0, p.hp) + '%';
    $('healthtext').textContent = Math.ceil(Math.max(0, p.hp));
    $('ammo-count').textContent = p.reloadT > 0 ? 'RELOADING…' : (p.ammo + ' / ∞');
    // Stars.
    let stars = '';
    for (let i = 0; i < 5; i++) {
      stars += i < game.wanted ? '★' : '<span class="off">★</span>';
    }
    $('stars').innerHTML = stars;
    // Mission.
    const obj = NB.currentObjective(game);
    const m = game.missions.active;
    $('mission-title').textContent = m ? ('MISSION ' + m.id + ' — ' + m.title) : 'FREE ROAM';
    $('mission-text').textContent = obj.text;
    $('mission-timer').textContent = (m && m.timer > 0) ? ('⏱ ' + Math.ceil(game.missions.timeLeft) + 's') : '';
    // Speedo.
    if (p.inCar) {
      $('speedo').classList.remove('hidden');
      $('speed-val').textContent = Math.round(Math.abs(p.inCar.speed) * 9);
    } else {
      $('speedo').classList.add('hidden');
    }
    // Compass to target.
    if (obj.target) {
      $('compass').classList.remove('hidden');
      const d = Math.round(dist(p.x, p.y, obj.target.x, obj.target.y) / 10);
      $('compass-dist').textContent = ' ' + d + 'm — ' + (obj.target.name || 'target');
      const a = Math.atan2(obj.target.y - p.y, obj.target.x - p.x);
      $('compass-arrow').style.display = 'inline-block';
      $('compass-arrow').style.transform = 'rotate(' + (a + Math.PI / 2) + 'rad)';
    } else {
      $('compass').classList.add('hidden');
    }
    // Context hint.
    let hint = '';
    if (!p.inCar) {
      const car = nearestCar(70);
      if (car) hint = car.kind === 'traffic' ? '[E] Steal car' : '[E] Enter car';
      else if (nearestPed(40)) hint = '[F] Punch';
    } else {
      hint = '[E] Exit car';
    }
    $('hint').textContent = hint;
    $('hint').style.display = hint ? 'block' : 'none';
    $('crosshair').style.display = (!p.inCar && game.state === 'playing') ? 'block' : 'none';
  }

  // ---------- flow ----------
  function showOnly(id) {
    const ids = ['menu', 'pause', 'end', 'hud', 'minimap'];
    for (let i = 0; i < ids.length; i++) {
      $(ids[i]).classList.toggle('hidden', ids[i] !== id && ids[i] !== 'hud' && ids[i] !== 'minimap');
    }
    if (id === 'hud') { $('hud').classList.remove('hidden'); $('minimap').classList.remove('hidden'); }
    else { $('hud').classList.add('hidden'); $('minimap').classList.add('hidden'); }
  }

  function startGame(fromSave) {
    const save = fromSave ? game.loadSave() : null;
    game.player = NB.makePlayer(SPAWN.x, SPAWN.y);
    game.cars.length = 0; game.peds.length = 0;
    game.particles.length = 0; game.pickups.length = 0; game.tracers.length = 0;
    game.wanted = 0; game.wantedTimer = 0; game.crimeTimer = 0; game.threatT = 0;
    game.stats = { earned: 0, missions: 0, stolen: 0, pedsDown: 0, copsDown: 0, shots: 0 };
    game.missions = NB.makeMissionState(save);
    if (save) {
      game.player.cash = save.cash || 0;
      game.stats.earned = save.earned || 0;
    }
    game.state = 'playing';
    game.autopilot = false;
    showOnly('hud');
    NB.startMission(game, game.missions.idx);
    game.save();
  }

  function endGame(kind) {
    if (game.state !== 'playing') return;
    game.state = 'over';
    game.audio.stopEngine(); game.audio.stopSiren();
    game.audio.busted();
    game.save();
    $('end-title').textContent = kind === 'busted' ? 'BUSTED' : 'WASTED';
    $('end-sub').textContent = kind === 'busted'
      ? 'The Neon Bay PD finally caught up with Rook.'
      : 'Rook did not survive the streets of Neon Bay.';
    const m = game.missions.active;
    $('end-stats').innerHTML =
      'Cash: <b>$' + game.player.cash.toLocaleString('en-US') + '</b> &nbsp;·&nbsp; Missions done: <b>' + game.stats.missions + '</b><br>' +
      'Cars stolen: <b>' + game.stats.stolen + '</b> &nbsp;·&nbsp; Cops taken down: <b>' + game.stats.copsDown + '</b><br>' +
      (m ? 'Next job: <b>' + m.title + '</b> — retry keeps your cash.' : 'All jobs complete. You own Neon Bay.');
    showOnly('end');
  }

  function toMenu() {
    game.state = 'menu';
    game.audio.stopEngine(); game.audio.stopSiren();
    game.save();
    const save = game.loadSave();
    if (save && (save.cash > 0 || save.missionIdx > 0 || (save.completed && save.completed.length))) {
      $('btn-continue').classList.remove('hidden');
      $('continue-info').textContent = 'Mission ' + (save.missionIdx + 1) + ' · $' + (save.cash || 0);
    } else {
      $('btn-continue').classList.add('hidden');
    }
    showOnly('menu');
  }

  // ---------- input ----------
  window.addEventListener('keydown', function (e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
    game.keys[e.code] = true;
    game.audio.ensure();
    if (e.code === 'KeyM') {
      game.audio.setMuted(!game.audio.muted);
      game.toast(game.audio.muted ? 'SOUND OFF' : 'SOUND ON');
      return;
    }
    if (game.state === 'menu' && (e.code === 'Enter' || e.code === 'Space')) { startGame(false); return; }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (game.state === 'playing') { game.state = 'paused'; showOnly('pause'); game.save(); }
      else if (game.state === 'paused') { game.state = 'playing'; showOnly('hud'); }
      return;
    }
    if (game.state !== 'playing' || game.shotMode) return;
    if (e.code === 'KeyE') {
      if (game.player.inCar) exitCar();
      else {
        const car = nearestCar(70);
        if (car) enterCar(car);
      }
    }
    if (e.code === 'KeyF') punch();
    if (e.code === 'KeyR' && !game.player.inCar && game.player.ammo < 12 && game.player.reloadT <= 0) {
      game.player.reloadT = 1.1;
      game.hudDirty = true;
    }
  });
  window.addEventListener('keyup', function (e) { game.keys[e.code] = false; });
  canvas.addEventListener('mousemove', function (e) {
    const r = canvas.getBoundingClientRect();
    game.mouseX = e.clientX - r.left;
    game.mouseY = e.clientY - r.top;
  });
  canvas.addEventListener('mousedown', function (e) {
    if (e.button === 0) { game.mouseDown = true; game.audio.ensure(); }
  });
  window.addEventListener('mouseup', function () { game.mouseDown = false; });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  $('btn-new').addEventListener('click', function () { game.audio.ensure(); startGame(false); });
  $('btn-continue').addEventListener('click', function () { game.audio.ensure(); startGame(true); });
  $('btn-resume').addEventListener('click', function () { game.state = 'playing'; showOnly('hud'); });
  $('btn-quit').addEventListener('click', function () { toMenu(); });
  $('btn-retry').addEventListener('click', function () {
    game.player.hp = game.player.maxHp;
    game.player.x = SPAWN.x; game.player.y = SPAWN.y;
    game.player.inCar = null;
    game.wanted = 0; game.bustT = 0;
    game.state = 'playing';
    showOnly('hud');
    NB.startMission(game, game.missions.idx);
  });
  $('btn-end-menu').addEventListener('click', function () { toMenu(); });

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = w; canvas.height = h;
    game.cam.w = w; game.cam.h = h;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- main loop ----------
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - game.lastT) / 1000 || 0.016);
    game.lastT = t;
    game.time += dt;

    if (game.state === 'menu') {
      // Ambient city behind the title screen.
      game.menuCamA += dt * 0.05;
      game.cam.x = clamp(1500 + Math.cos(game.menuCamA) * 500 - game.cam.w / 2, 0, NB.WORLD - game.cam.w);
      game.cam.y = clamp(1500 + Math.sin(game.menuCamA * 0.7) * 400 - game.cam.h / 2, 0, NB.WORLD - game.cam.h);
      NB.updateTraffic(game, dt);
      const punch = NB.updatePeds(game, dt, game.player);
      NB.updateParticles(game, dt);
      maintainPopulation(dt);
      render();
      return;
    }
    if (game.state !== 'playing') { render(); return; }

    const p = game.player;
    game.threatT = Math.max(0, game.threatT - dt);
    p.hurtT = Math.max(0, p.hurtT - dt);
    if (game.toastT > 0) {
      game.toastT -= dt;
      if (game.toastT <= 0) $('toast').classList.remove('show');
    }
    for (let i = game.tracers.length - 1; i >= 0; i--) {
      game.tracers[i].life += dt;
      if (game.tracers[i].life > 0.12) game.tracers.splice(i, 1);
    }

    if (!game.shotMode) {
      if (p.inCar) updatePlayerInCar(dt);
      else updatePlayerOnFoot(dt);
      NB.updateTraffic(game, dt);
      const punchEvt = NB.updatePeds(game, dt, p);
      if (punchEvt && punchEvt.punched) damagePlayer(8, 'cop');
      NB.updatePolice(game, dt, p);
      NB.updateParticles(game, dt);
      NB.updateMissions(game, dt);
      maintainPopulation(dt);
      maintainPolice(dt);
      wantedDecay(dt);
      game.audio.updateSiren(dt);
    } else {
      // Shot mode: ambient life continues, the staged scene holds.
      NB.updateTraffic(game, dt);
      NB.updatePeds(game, dt, p);
      NB.updateParticles(game, dt);
      if (game.autopilot && p.inCar) updatePlayerInCar(dt);
    }

    // Camera follows the player.
    game.cam.x = clamp(p.x - game.cam.w / 2, 0, Math.max(0, NB.WORLD - game.cam.w));
    game.cam.y = clamp(p.y - game.cam.h / 2, 0, Math.max(0, NB.WORLD - game.cam.h));

    render();
    updateHUD();
  }

  // ---------- boot / screenshot staging ----------
  const params = new URLSearchParams(window.location.search);
  const shot = params.get('shot');
  const seed = parseInt(params.get('seed') || '20261124', 10);
  if (shot) {
    // Staged scene for screenshots.
    game.player = NB.makePlayer(SPAWN.x, SPAWN.y);
    game.missions = NB.makeMissionState(null);
    NB.stageShot(game, shot, seed);
    if (shot === 'start') {
      showOnly('menu');
      $('btn-continue').classList.add('hidden');
    } else {
      showOnly('hud');
    }
    game.cam.w = canvas.width; game.cam.h = canvas.height;
  } else {
    toMenu();
  }
  requestAnimationFrame(frame);

  // Expose for debugging / tests.
  global.NB.game = game;
})(typeof window !== 'undefined' ? window : globalThis);
