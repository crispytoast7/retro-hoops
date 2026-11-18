# Retro Hoops

A retro pixel-art basketball game: run the franchise as coach and GM, and play the big
possessions yourself. Everything (teams, players, art, sound) is original and generated.

**Play:** https://crispytoast7.github.io/retro-hoops/

Works on phone and desktop. Install it from the browser menu ("Add to Home Screen" on
iPhone) to play offline.

## Controls

| Action | Touch / mouse | Keyboard |
|---|---|---|
| Dribble, drive | Drag on the court | Arrows / WASD |
| Shoot | Hold the SHOOT button and release when the crosshair is over the rim (or touch your player and pull back from the basket) | Hold Space, release |
| Pump fake | Tap the SHOOT button | Tap Space |
| Putback | Press PUT BACK when it flashes after an offensive rebound near the rim | Space |
| Aimed pass, lead pass, lob | Touch your player, pull back away from the target, release | |
| Quick pass | Tap a teammate | 1-4 |
| Crossover, step-back | Quick flick | Shift (while moving) |
| Layup / dunk | Drive at the rim with a lane | same |

You play about a dozen key moments each game, each a different situation: fast break,
pick-and-roll, post-up, isolation, open look, late shot clock, free throws, the last shot.
Scoring in a moment starts a run for your team in the simulated play that follows; wasting
one hands the run to the opponent. Games are full length (12-minute quarters, scores around
110) and take three to four minutes to play.

## Features

- 16-team generated league, 2 conferences, 14-game season, 8-team single-game playoffs,
  endless seasons.
- A hands-on Practice tutorial (six guided drills with an on-court demo hand), a
  "getting started" checklist, and a hub that opens up over your first games with a short
  explainer each time something unlocks.
- Coach progression: XP and levels, perks you choose, 30 trophies that pay credits, and
  unlockable home-court floors.
- Arcade possessions: shot meter sized by Shooting, distance and defense; handles moves;
  interceptable passes; layups, dunks, and-ones, blocks, offensive rebounds; sped-up shot
  clock; crowd meter; buzzer-beaters; three difficulty levels.
- Possession-by-possession simulation with full box scores, season and career stats.
- Team Hub: roster, lineup, staff, facilities, finances, trades, scouting, standings,
  schedule, stats, history, news.
- Players: seven star ratings, age curve, contracts, morale, personality traits, injuries,
  a team captain. Your players earn XP in games and level up; you choose which rating
  improves. Star players are marked on the court and in every list.
- Adaptive difficulty: the court gets tougher when you keep scoring in your key moments.
- A different week every week: one move before each game from three options (train a player
  for good, buy an edge for this game, or look after the club), opponent intel and the
  playoff race on the hub, players who run hot and cold, a rival for every team, and a
  season-long sponsor deal with a safe, a solid and a bold target.
- Organization: a $150M salary cap (go over it only to re-sign your own players, for minimum
  deals and for draft picks) under a $190M hard limit, coordinators to hire (and lose), four upgradable
  facilities that wear down, credits economy, owner goals and approval, fan support,
  weekly events with choices, getting fired and taking a new job.
- Trades with AI teams that value age, contract, needs and picks; AI-to-AI trades; a
  mid-season deadline.
- Offseason: awards, Hall of Fame, retirements, re-signing, two-round draft with scouting,
  free-agency bidding, training camp.
- Playoffs you can follow: a real bracket (projected from the standings all season), a stop
  when the playoffs begin and after every round, a championship celebration, a Player of
  the Week, an awards night, a draft-lottery reveal, a summer progress report and a playable
  training-camp shootaround.
- A career that starts at the bottom and stays interesting: every new coach is handed the
  weakest roster (with an owner who cannot fire him in year one), opponents raise their game
  against champions and runaway leaders and ease off against a team at the bottom, the court
  adapts in both directions to how you are scoring, a rough game ends with concrete coach's
  notes, and a title brings an offer to do it again with the worst club in the league.
- Management without the busywork: a TO DO list with one-tap and Do-all chores (or an
  Assistant GM who does them every week), auto level-ups, a trade Shop that shows up to three
  offers for any player, a plain-language money screen, a few big decisions a season (a star
  wants a new deal, a rookie breaks out, a rival poaches your coach, deadline day), and a
  pixel-art picture of your club that grows with every upgrade, across six facilities: arena,
  training center, medical center, scouting office, team store and trophy room.
- Plays with touch, or with mouse and keyboard (WASD/arrows, Space to shoot or fake, 1-4 to
  pass, Shift for a crossover, Enter and Escape in the menus).
- Saves automatically on the device; export/import a save file in Settings.

## Run locally

Needs Node 20 or newer.

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # logic tests (sim, AI GM, seasons, calendar, org, progression)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

`http://localhost:5173/?arcade` (dev only) loops hand-played possessions for tuning the
on-court feel.

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml`: install, test, build, publish
`dist/` to GitHub Pages. The build uses a relative base path, so `dist/` can be served by
any static host without changes.

## iPhone app

The same game runs as a native iPhone app through a Capacitor shell (`ios/`). Saves live
inside the app, it works offline, and it has its own home-screen icon.

To put it on your own iPhone (needs a Mac with Xcode and your Apple ID added under
Xcode > Settings > Accounts):

1. Plug the iPhone into the Mac, unlock it and tap **Trust**.
2. On the iPhone, switch on **Developer Mode** (Settings > Privacy & Security > Developer
   Mode) and restart when asked.
3. Run `npm run ios:device`.
4. First time only, on the iPhone: Settings > General > VPN & Device Management > trust
   your developer certificate.

With a free Apple ID the app stops opening after 7 days; run step 3 again to renew it
(your save stays). A paid Apple Developer membership makes that one year. To work in
Xcode instead, run `npm run ios:sync` then `npm run ios:open` and press Run.

## How it is built

See [ARCHITECTURE.md](ARCHITECTURE.md). In short: Vite + TypeScript, Canvas 2D for the
court, Preact for menus, no backend. All game logic lives in `src/core` and is covered by
tests in `tests/`.
