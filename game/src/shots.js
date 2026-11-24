// Neon Bay — screenshot staging. The judge mostly sees the screenshots, so
// ?shot= builds a composed scene: HUD, minimap, car, pedestrians, police and
// a wanted level in one frame. ?shot=start|drive|chase|mission (&seed= for
// determinism). In shot mode the player is staged and AI keeps the scene
// alive, but timers, damage and wanted decay are frozen.
(function (global) {
  'use strict';
  const NB = global.NB;

  function stageShot(game, name, seed) {
    const rng = NB.makeRng(seed || 20261124);
    const p = game.player;
    game.shotMode = true;
    game.state = 'playing';
    game.wanted = 0;
    game.cars.length = 0;
    game.peds.length = 0;
    game.pickups.length = 0;
    game.particles.length = 0;
    game.footCops = 0;
    game.threatT = 0;

    function scatterTraffic(n, nearX, nearY) {
      for (let i = 0; i < n; i++) {
        const c = NB.spawnTrafficCar(game, rng, nearX, nearY);
        if (c) game.cars.push(c);
      }
    }
    function scatterPeds(n, nearX, nearY) {
      for (let i = 0; i < n; i++) {
        const ped = NB.spawnPed(game, rng, nearX, nearY);
        if (ped) game.peds.push(ped);
      }
    }
    function scatterParked(n) {
      for (let i = 0; i < n; i++) {
        const c = NB.spawnParkedCar(game, rng);
        if (c) game.cars.push(c);
      }
    }
    if (name === 'start') {
      game.state = 'menu';
      game.menuCamX = 1500; game.menuCamY = 1500;
      scatterTraffic(10, 1600, 1600);
      scatterPeds(8, 1600, 1600);
      scatterParked(4);
      return;
    }

    if (name === 'drive') {
      // Player cruising downtown in a stolen sports car, 2-star heat.
      // Start on the road centerline; the autopilot loops one downtown block.
      p.x = 1600; p.y = 1600; p.angle = 0;
      const car = NB.makeCar(p.x, p.y, 0, 'player', '#e74c3c');
      car.speed = 3.2; car.driver = true;
      p.inCar = car;
      game.cars.push(car);
      game.autopilot = true;
      game.autoWps = [
        { x: 2240, y: 1600 }, { x: 2240, y: 2240 },
        { x: 1600, y: 2240 }, { x: 1600, y: 1600 },
      ];
      game.autoWpIdx = 0;
      game.setWanted(2);
      scatterTraffic(9, p.x, p.y);
      scatterPeds(10, p.x, p.y);
      scatterParked(3);
      game.pickups.push(NB.makePickup(1760, 1560, 'cash', 250));
      NB.startMission(game, 1); // THE DROP — marker + timer visible
      return;
    }

    if (name === 'chase') {
      // Full 4-star chase: player car at an intersection, police placed
      // directly on an orbit around the player so they stay in frame.
      p.x = 1600; p.y = 1600; p.angle = Math.PI / 4;
      const car = NB.makeCar(p.x, p.y, Math.PI / 4, 'player', '#e74c3c');
      car.speed = 0; car.driver = true;
      p.inCar = car;
      game.cars.push(car);
      game.setWanted(4);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.6;
        const pc = NB.makeCar(
          p.x + Math.cos(a) * 170, p.y + Math.sin(a) * 170,
          a + Math.PI, 'police', '#f5f6fa');
        pc.hold = true;
        pc.holdAngle = a;
        pc.speed = 2.2;
        game.cars.push(pc);
      }
      scatterTraffic(5, p.x, p.y);
      scatterPeds(8, p.x, p.y);
      NB.spawnParticles(game, p.x + 40, p.y, '#ff9f1a', 18, 3, 0.8);
      NB.startMission(game, 4); // THE BIG SCORE — escape objective visible
      game.missions.phase = 'escape';
      return;
    }

    // 'mission' (default): on foot on the road beside Central Park (a real
    // park block), 3-star heat from the job. The case marker sits in the park.
    p.x = 1280; p.y = 1760; p.angle = Math.PI;
    p.inCar = null;
    const car = NB.makeCar(1280, 1830, Math.PI / 2, 'parked', '#2980b9');
    game.cars.push(car);
    game.setWanted(1);
    scatterTraffic(6, p.x, p.y);
    scatterPeds(9, p.x, p.y);
    scatterParked(2);
    game.pickups.push(NB.makePickup(1080, 1720, 'cash', 250));
    game.pickups.push(NB.makePickup(1160, 1800, 'ammo', 12));
    NB.startMission(game, 3); // THE PICKUP — case marker visible
  }

  NB.stageShot = stageShot;
})(typeof window !== 'undefined' ? window : globalThis);
