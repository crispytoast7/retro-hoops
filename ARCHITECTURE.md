# Retro Hoops: architecture

## Stack

| Choice | Why |
|---|---|
| **Static site, no backend** | The whole game (sim, saves, management) runs in the browser. That makes offline play and home-screen install work with no server to depend on, and there is nothing to keep running or pay for. Cloud saves and leaderboards are left out for now; `src/state/save.ts` is the single place a sync backend would plug in later. |
| **Vite + TypeScript** | Fast builds, strict types across a large amount of game logic. |
| **Canvas 2D, no game engine** | The court is about ten sprites and a ball. An engine would add hundreds of KB and help with none of the menu half of the game. Sprites are drawn in code onto a low-resolution canvas and scaled up by whole numbers so pixels stay crisp. |
| **Preact** for the hub and menus | The management side is tables, lists and forms, where components pay off. Preact is a few KB. |
| **vite-plugin-pwa (Workbox)** | Precaches the app so it installs and plays offline. Updates are prompted, never forced mid-game. |
| **Vitest** | Tests for the pure logic: sim, cap maths, contracts, trades. |
| **GitHub Pages + GitHub Actions** | Every push to `main` runs tests, builds, and publishes. The build uses a relative base path, so it can move to any static host (Cloudflare, Vercel, Netlify) without changes. |

## Folder structure

```
src/
  core/        Pure game logic. No DOM, no canvas, no storage. All testable.
    types.ts     Every saved data shape (League, Team, Player, ...)
    rng.ts       Seeded random numbers
    ratings.ts   Overall-by-position, stars
    gen/         League, team and player generation
    sim/         Possession-by-possession game simulation, box scores
    season/      Calendar (14 or 82 games), schedule, standings, playoff series, day/week advance
    gm/          AI general managers: trade value, free agency, draft
    org/         Finances, contracts, staff, facilities, morale, owner, events,
                 coach progression (levels, perks, trophies, feature unlocks)
    offseason/   Awards, retirements, re-signing, draft, free agency, camp
  data/        Name lists, cities, team names, event and news text
  game/        The arcade part: court renderer, sprites, input, shot meter,
               defender AI, possession flow. Reads ratings, returns results.
  audio/       Sound effects synthesised with WebAudio (no audio files)
  state/       Store (current save in memory), persistence, migrations
  ui/          Preact screens: title, hub tabs, game wrapper, post-game
  main.tsx     Boot
tests/         Vitest tests for src/core
scripts/       One-off tools (icon generation)
```

Rule: `core/` never imports from `game/`, `ui/`, `state/` or `audio/`. The UI and the
arcade game call into `core/` and hand results back to the store.

## How a game is played

A game is a list of possessions. `core/sim` simulates each one from ratings. For about 16
of the user's offensive possessions, the sim pauses and `game/` lets the player play the
possession on the court; the result (points, who shot, assists, rebounds, turnovers) is
fed back into the same box score. Everything else is shown as quick score updates.

## Data and saves

- One **save object** holds the entire franchise: league, teams, players, schedule,
  history, coach career, settings. It is plain JSON with a `version` number.
- **IndexedDB** is the main store, written after every meaningful action (auto-save).
  A copy is also kept in **localStorage** when it fits, as a fallback if IndexedDB fails.
- On load, the newer valid copy wins, then `state/migrations.ts` upgrades old versions
  step by step.
- The app asks the browser for persistent storage. iOS Safari can still clear data for
  sites that are not installed and go unused for a week, and that clears both stores.
  So **export/import** (a JSON file) is a first-class feature in Settings, and the game
  nudges iPhone players to add it to the home screen, where that limit does not apply.
- All randomness goes through a seeded generator stored in the save, so the sim is
  reproducible in tests.
