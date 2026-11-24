// Neon Bay — the 5-mission story. Rook, a getaway driver for the Bay Syndicate,
// works a chain of jobs across the city. Each mission has a target point, an
// optional timer, a reward, and a wanted level it sets when it starts.
(function (global) {
  'use strict';
  const NB = global.NB;
  const clamp = NB.clamp, dist = NB.dist;

  // Mission target points (all on roads / open ground).
  const SPOTS = {
    downtownBank: { x: 1600, y: 1440, name: 'Bay Central Bank' },
    harborDock: { x: 2880, y: 1760, name: 'Harbor Dock 7' },
    motel: { x: 640, y: 2240, name: 'Palm Motel' },
    park: { x: 1120, y: 1760, name: 'Central Park' },
    beachHouse: { x: 1600, y: 2970, name: 'Beach Safehouse' },
    suburbs: { x: 480, y: 480, name: 'Suburbs' },
  };

  function missionList() {
    return [
      {
        id: 1, title: 'HOT WHEELS',
        briefing: 'You need wheels. Steal any car on the street — press E next to one.',
        type: 'enterCar', target: null, timer: 0, reward: 500,
        onStart: function (game) { game.toast('Steal a car — press E near one'); },
      },
      {
        id: 2, title: 'THE DROP',
        briefing: 'Package in the trunk. Deliver it to Harbor Dock 7 before the clock runs out.',
        type: 'goto', target: SPOTS.harborDock, timer: 90, reward: 1500,
        wantedOnStart: 1,
        onStart: function (game) { game.toast('Deliver to the Harbor — 90 seconds'); },
      },
      {
        id: 3, title: 'LOSE THE HEAT',
        briefing: 'The cops are on you. Lay low until your wanted level drops to zero.',
        type: 'loseWanted', target: null, timer: 0, reward: 800,
        onStart: function (game) { game.toast('Lose the cops — stay clean'); },
      },
      {
        id: 4, title: 'THE PICKUP',
        briefing: 'Grab the case in Central Park, then get it to the Palm Motel. The heat is on.',
        type: 'pickupDeliver', target: SPOTS.park, deliver: SPOTS.motel, timer: 120, reward: 2500,
        wantedOnStart: 3,
        onStart: function (game) { game.toast('Grab the case in the park'); },
      },
      {
        id: 5, title: 'THE BIG SCORE',
        briefing: 'Hit Bay Central Bank, grab the cash, and escape to the Beach Safehouse. 4-star heat.',
        type: 'scoreEscape', target: SPOTS.downtownBank, deliver: SPOTS.beachHouse, timer: 150, reward: 5000,
        wantedOnStart: 4,
        onStart: function (game) { game.toast('Hit the bank — then run for the beach'); },
      },
    ];
  }

  function makeMissionState(save) {
    const list = missionList();
    const idx = save && typeof save.missionIdx === 'number' ? clamp(save.missionIdx, 0, list.length - 1) : 0;
    return {
      list: list,
      idx: idx,
      active: null,       // the running mission object (a copy)
      phase: 'go',        // go | deliver | escape
      timeLeft: 0,
      done: save && Array.isArray(save.completed) ? save.completed.slice() : [],
      finishedAll: !!(save && save.finishedAll),
    };
  }

  function startMission(game, idx) {
    const ms = game.missions;
    const def = ms.list[idx];
    if (!def) return;
    ms.active = {
      id: def.id, title: def.title, briefing: def.briefing,
      type: def.type, target: def.target, deliver: def.deliver || null,
      timer: def.timer, reward: def.reward,
      wantedOnStart: def.wantedOnStart || 0,
      onStart: def.onStart,
    };
    ms.phase = 'go';
    ms.timeLeft = def.timer || 0;
    if (ms.active.wantedOnStart > game.wanted) {
      game.setWanted(ms.active.wantedOnStart);
    }
    if (ms.active.onStart) ms.active.onStart(game);
    game.hudDirty = true;
  }

  function completeMission(game) {
    const ms = game.missions;
    const m = ms.active;
    if (!m) return;
    game.player.cash += m.reward;
    game.stats.earned += m.reward;
    game.stats.missions++;
    ms.done.push(m.id);
    ms.idx = Math.min(ms.idx + 1, ms.list.length - 1);
    game.toast('MISSION COMPLETE  +$' + m.reward);
    if (game.audio) game.audio.missionDone();
    NB.spawnParticles(game, game.player.x, game.player.y, '#ffd75e', 40, 4, 0.9);
    ms.active = null;
    game.save();
    if (ms.idx >= ms.list.length - 1 && ms.done.length >= ms.list.length) {
      ms.finishedAll = true;
      game.toast('YOU OWN NEON BAY');
      game.save();
      return;
    }
    startMission(game, ms.idx);
  }

  function failMission(game, reason) {
    const ms = game.missions;
    const m = ms.active;
    if (!m) return;
    game.toast('MISSION FAILED — ' + reason);
    ms.active = null;
    // Restart the same mission after a beat.
    game.missionRetryT = 2.0;
    game.missionRetryIdx = ms.idx;
  }

  function updateMissions(game, dt) {
    const ms = game.missions;
    if (game.missionRetryT > 0) {
      game.missionRetryT -= dt;
      if (game.missionRetryT <= 0) startMission(game, game.missionRetryIdx);
      return;
    }
    const m = ms.active;
    if (!m) return;
    const p = game.player;
    if (m.timer > 0) {
      ms.timeLeft -= dt;
      if (ms.timeLeft <= 0) {
        failMission(game, 'time ran out');
        return;
      }
    }
    const at = function (spot, r) { return dist(p.x, p.y, spot.x, spot.y) < (r || 70); };

    if (m.type === 'enterCar') {
      if (p.inCar) completeMission(game);
    } else if (m.type === 'goto') {
      if (at(m.target)) completeMission(game);
    } else if (m.type === 'loseWanted') {
      if (game.wanted <= 0) completeMission(game);
    } else if (m.type === 'pickupDeliver') {
      if (ms.phase === 'go' && at(m.target)) {
        ms.phase = 'deliver';
        game.toast('Case grabbed — get it to the Palm Motel');
        if (game.audio) game.audio.pickup();
      } else if (ms.phase === 'deliver' && at(m.deliver)) {
        completeMission(game);
      }
    } else if (m.type === 'scoreEscape') {
      if (ms.phase === 'go' && at(m.target)) {
        ms.phase = 'escape';
        game.toast('Cash grabbed — escape to the Beach Safehouse!');
        if (game.audio) game.audio.cash();
        game.setWanted(Math.max(game.wanted, 4));
      } else if (ms.phase === 'escape' && at(m.deliver)) {
        completeMission(game);
      }
    }
  }

  // Current objective text + target for the HUD / minimap / compass.
  function currentObjective(game) {
    const ms = game.missions;
    const m = ms.active;
    if (!m) return { text: 'Free roam — cause chaos or start the next job', target: null };
    if (m.type === 'enterCar') return { text: 'Steal any car (press E near one)', target: null };
    if (m.type === 'goto') return { text: 'Deliver to ' + m.target.name, target: m.target };
    if (m.type === 'loseWanted') return { text: 'Lose the cops — wanted level to zero', target: null };
    if (m.type === 'pickupDeliver') {
      if (ms.phase === 'go') return { text: 'Grab the case at ' + m.target.name, target: m.target };
      return { text: 'Deliver the case to ' + m.deliver.name, target: m.deliver };
    }
    if (m.type === 'scoreEscape') {
      if (ms.phase === 'go') return { text: 'Hit ' + m.target.name, target: m.target };
      return { text: 'Escape to ' + m.deliver.name, target: m.deliver };
    }
    return { text: m.briefing, target: m.target || null };
  }

  NB.SPOTS = SPOTS;
  NB.missionList = missionList;
  NB.makeMissionState = makeMissionState;
  NB.startMission = startMission;
  NB.completeMission = completeMission;
  NB.failMission = failMission;
  NB.updateMissions = updateMissions;
  NB.currentObjective = currentObjective;
})(typeof window !== 'undefined' ? window : globalThis);
