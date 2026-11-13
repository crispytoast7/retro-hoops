# Retro Hoops

A retro pixel-art basketball game: run the franchise as coach and GM, and play the big
possessions yourself. Everything (teams, players, art, sound) is original and generated.

**Play:** https://crispytoast7.github.io/retro-hoops/

Works on phone and desktop. Install it from the browser menu ("Add to Home Screen" on
iPhone) to play offline.

## Controls

| Action | Touch / mouse | Keyboard |
|---|---|---|
| Dribble, drive | Drag anywhere | Arrows / WASD |
| Crossover or spin | Quick flick | Shift (while moving) |
| Pass | Tap a teammate, or drag from him | 1-4 |
| Shoot | Press and hold still, release in the green | Hold Space |
| Layup / dunk | Drive at the rim with a lane | same |

You play about a dozen of your team's possessions each game; defense and the rest are
simulated from ratings.

## Features

- 16-team generated league, 2 conferences, 14-game season, 8-team playoffs, endless seasons.
- Arcade possessions: shot meter sized by Shooting, distance and defense; handles moves;
  interceptable passes; layups, dunks, and-ones, blocks, offensive rebounds; sped-up shot
  clock; crowd meter; buzzer-beaters; three difficulty levels.
- Possession-by-possession simulation with full box scores, season and career stats.
- Team Hub: roster, lineup, staff, facilities, finances, trades, scouting, standings,
  schedule, stats, history, news.
- Players: seven star ratings, age curve, contracts, morale, personality traits, injuries,
  credit-funded rating upgrades, a team captain.
- Organization: hard salary cap, coordinators to hire (and lose), four upgradable
  facilities that wear down, credits economy, owner goals and approval, fan support,
  weekly events with choices, getting fired and taking a new job.
- Trades with AI teams that value age, contract, needs and picks; AI-to-AI trades; a
  mid-season deadline.
- Offseason: awards, Hall of Fame, retirements, re-signing, two-round draft with scouting,
  free-agency bidding, training camp.
- Saves automatically on the device; export/import a save file in Settings.

## Run locally

Needs Node 20 or newer.

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # logic tests (sim, AI GM, seasons, org)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

`http://localhost:5173/?arcade` (dev only) loops hand-played possessions for tuning the
on-court feel.

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml`: install, test, build, publish
`dist/` to GitHub Pages. The build uses a relative base path, so `dist/` can be served by
any static host without changes.

## How it is built

See [ARCHITECTURE.md](ARCHITECTURE.md). In short: Vite + TypeScript, Canvas 2D for the
court, Preact for menus, no backend. All game logic lives in `src/core` and is covered by
tests in `tests/`.
