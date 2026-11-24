# Neon Bay — Open World Crime

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/Szeven/gta6-01-r7/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/Szeven/gta6-01-r7/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Neon Bay** is a complete original open-world crime game for the make.fun
gta6-01 bounty ("Make GTA 6"). You play Rook, a getaway driver for the Bay
Syndicate, working a 5-mission story across a living 3200×3200 city.

## The city

A seeded open world with five districts — Downtown, Old Town, Suburbs,
Harbor docks and a Beachfront — on a full road grid with lane markings,
parks, parking lots, street lamps and palms. Traffic cars follow the roads
(right-hand lanes, braking for the car ahead), pedestrians walk the
sidewalks and flee from gunfire and speeding cars.

## Systems

- **On foot & by car** — sprint, punch, shoot (mouse aim, hit-scan pistol
  with reload), enter / exit cars, and steal any traffic car (the driver
  bails out and runs).
- **Wanted level 0–5 stars** — crimes raise the heat; police cars chase and
  ram you, foot cops chase and punch you down, and a slow police car sitting
  on you gets you BUSTED. Lay low and the heat decays.
- **Combat** — pistol, fists, car ramming, run-overs, explosions, car
  damage and smoke.
- **5 story missions** — Hot Wheels, The Drop, Lose the Heat, The Pickup,
  The Big Score — with timers, map markers, a compass, and cash rewards.
- **HUD + minimap** — cash, health, ammo, wanted stars, mission objective
  with timer, speedometer, live minimap (player, police, traffic, mission
  marker), contextual hints and toasts.
- **Start screen, pause, Busted / Wasted** — plus saving to localStorage
  (cash, mission progress, best run) with Continue.
- **Synthesized sound** — engine hum, two-tone siren, gunshots, crashes and
  mission jingles, all generated with WebAudio. No audio files.

## Play

Open `game/index.html` in a desktop browser (or `node serve.ts` and visit
http://localhost:8080). No build step, no network, no libraries. The game is
fully offline: every script, style and sound is local.

- **WASD / Arrows** move / drive · **Shift** sprint · **E** enter / exit /
  steal car · **Mouse** aim, **Click** shoot · **F** punch · **R** reload ·
  **Esc / P** pause · **M** mute.

## Files

- `game/index.html`, `game/style.css` — shell + HUD.
- `game/src/rng.js` — seeded random helpers.
- `game/src/world.js` — city generation + rendering.
- `game/src/audio.js` — WebAudio synth SFX.
- `game/src/entities.js` — player, traffic, police, pedestrians, particles.
- `game/src/missions.js` — the 5-mission story.
- `game/src/shots.js` — staged screenshot scenes (`?shot=start|drive|chase|mission`).
- `game/src/main.js` — game loop, input, wanted system, HUD, minimap, saves.
- `main.ts` — copies `game/` + `screenshots/` to `/output` and writes
  `dossier.json` (see `vendor/makefun-game.ts`).

## Screenshots

1. `1-start.png` — title screen over the living city.
2. `2-drive.png` — cruising downtown, 2-star heat, traffic + pedestrians.
3. `3-chase.png` — 4-star police chase at an intersection.
4. `4-mission.png` — on foot at the park pickup, 3-star heat.

---

Built for the make.fun gta6-01 bounty: https://make.fun/bounty/gta6-01
