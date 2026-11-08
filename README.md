# Organ MVP ("Organ Hero") — An Ice Hockey Journey

Play as **The Organist**, perched above a 3v3 ice hockey rink. You don't control the skaters directly—instead, read who has possession, watch player moods (`Focus`, `Stamina`, `Aggression`), and play stadium pipe organ classics at the right moments to sway the game and complete management's **Official Orders**.

## Features (Phase 1 MVP)

- **Deterministic 3v3 Hockey Simulation**:
  - **1 Goalie + 2 Strikers** per team (Home vs. Away) running at a fixed 60 Hz simulation step.
  - **Baseline Personalities & Event-Driven Moods**: Players have baseline Focus & Aggression stats that shift dynamically on robberies, hits, saves, and goals, drifting back toward baseline with an 8-game-second half-life.
  - **Rink Physics**: Rounded boards with restitution, exponential puck friction, quadratic Bézier attack paths, and $\pm 60^\circ$ goalie block rebounds directed toward the horizontal center line.
  - **Brawls & Uncapped Penalty Box**: Failed steals can spark a 6-game-second (3s real time at `2x`) dust-cloud brawl, sending the instigator to the Penalty Box for 30 game seconds.
- **Possession-Based Organ Console**:
  - Live **Possession Indicator** (`● HOME POSSESSION` when carried, `◌ AWAY — LAST TOUCH` when loose) and per-song target labels.
  - Target team locks at the moment of the tap for the song's full 10-game-second (5s real time at `2x`) duration.
  - **Configurable Song Slot Limit & Loadout**:
    - Defaults to `3` active song slots (`maxSongSlots: 3`, configurable from `1` to `6` in `GameConfig` and the Live Debug Panel) with customizable per-slot song selection (`equippedSongs`).
  - **6 Synthesized Pipe Organ Classics**:
    1. **Charge! Fanfare** (`charge`) — Boosts `Focus` & `Aggression` for the possessing (or last-touch) team.
    2. **Hold the Line** (`hold_the_line`) — Boosts Goalie & Defense (`+Focus`, `+Stamina`, `-Aggression`) for the defending team.
    3. **Grudge Toccata** (`grudge_toccata`) — Spikes `Aggression` and drops `Focus` for **both** teams to provoke brawls.
    4. **Power Play Polka** (`power_play_polka`) — Boosts `Focus` & `Aggression` for the team on the Power Play (**valid only during power plays**).
    5. **Kill the Clock** (`kill_the_clock`) — Boosts Goalie (`+Focus`, `+Stamina`) & shorthanded defense (`+Focus`, `-Aggression`) for the Penalty Kill team (**valid only during power plays**).
    6. **Madeyalook** (`madeyalook`) — Taunts the defending team's goalie (`-Focus`), making them more likely to miss a shot.
  - **Situational Cue Windows & Stale Penalty**: Playing the matching song during a cue window doubles its effect (`2x`) and boosts Crowd Volume (`+15%`). Repeating the same song back-to-back halves its effect and bores the crowd (`-10%`).
- **Period & Game Breakdowns**:
  - Full telemetry after every period and at the final buzzer, including a Crowd Volume sparkline and **Song Impact Attribution**.
- **Live Debug & Tuning Panel (`⚙` or `` ` ``)**:
  - Edit `maxSongSlots` (`1–6`), per-slot song loadouts, every formula constant, timing, baseline stat, and deterministic RNG seed live in the browser.

## Development

```bash
npm install
npm test        # Run Vitest unit test suite
npm run dev     # Start local dev server
npm run build   # Type-check and build production bundle to dist/
```
