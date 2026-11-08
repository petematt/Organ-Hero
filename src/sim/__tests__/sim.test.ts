import { describe, expect, it } from 'vitest';
import { cloneConfig, DEFAULT_CONFIG } from '../../config';
import { evaluateOrder } from '../../game/orders';
import { resolveSongTarget } from '../../game/songs';
import { buildStatsSummary } from '../../game/stats';
import {
  composeEffectiveStat,
  computeFightChance,
  computeGoalChance,
  computeGoalieBlockChance,
  computeRedirectLatency,
  computeShooterAccuracy,
  computeSkateSpeed,
  computeStealChance,
  decayMoodOffset,
} from '../formulas';
import { MatchSimulation } from '../match';
import {
  applyPuckFriction,
  CENTER_Y,
  collidePuckWithBoards,
  computeReboundVelocity,
} from '../physics';
import { SeededRNG } from '../rng';

describe('SeededRNG & rollAgainst', () => {
  it('produces identical sequences for the same seed', () => {
    const a = new SeededRNG(42);
    const b = new SeededRNG(42);
    for (let i = 0; i < 50; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('respects rollAgainst clamping and statistical distribution over 10k samples', () => {
    const rng = new SeededRNG(999);
    expect(rng.rollAgainst(0)).toBe(false);
    expect(rng.rollAgainst(-0.5)).toBe(false);
    expect(rng.rollAgainst(1)).toBe(true);
    expect(rng.rollAgainst(1.5)).toBe(true);

    let hits = 0;
    const N = 10000;
    for (let i = 0; i < N; i++) {
      if (rng.rollAgainst(0.35)) hits++;
    }
    const ratio = hits / N;
    expect(ratio).toBeGreaterThan(0.33);
    expect(ratio).toBeLessThan(0.37);
  });
});

describe('Simulation Formulas & Mood Drift', () => {
  const cfg = DEFAULT_CONFIG;

  it('clamps goal_chance between minGoalChance and maxGoalChance and makes Charge! buffs dramatically boost goal chance', () => {
    // High block chance > shooter accuracy -> clamped to minGoalChance (0.02)
    expect(computeGoalChance(0.1, 0.8, cfg)).toBeCloseTo(cfg.minGoalChance);
    // High accuracy - 0 block -> clamped to maxGoalChance (0.90)
    expect(computeGoalChance(0.99, 0.0, cfg)).toBeCloseTo(cfg.maxGoalChance);
    // Normal range
    expect(computeGoalChance(0.65, 0.35, cfg)).toBeCloseTo(0.30);

    // Unbuffed Sniper (0.55 focus) vs Away Goalie (0.70 focus, 0.85 stamina) -> clamped at 2%
    const unbuffedAcc = computeShooterAccuracy(0.55, cfg);
    const goalieBlock = computeGoalieBlockChance(0.70, 0.85, cfg);
    const unbuffedGoalChance = computeGoalChance(unbuffedAcc, goalieBlock, cfg);
    expect(unbuffedGoalChance).toBeCloseTo(cfg.minGoalChance);

    // Charge! Cue Hit Sniper (1.00 focus) vs same Goalie -> >8x higher goal chance
    const buffedAcc = computeShooterAccuracy(1.0, cfg);
    const buffedGoalChance = computeGoalChance(buffedAcc, goalieBlock, cfg);
    expect(buffedGoalChance).toBeGreaterThan(unbuffedGoalChance * 8);
  });

  it('prevents zero skate_speed when stamina or aggression hits 0', () => {
    const speedAtZero = computeSkateSpeed(0, 0, cfg);
    expect(speedAtZero).toBeGreaterThan(10);
    expect(speedAtZero).toBeCloseTo(
      cfg.S_skateSpeed * cfg.minStaminaSpeedFactor * 0.35
    );
  });

  it('computes goalie block, shooter accuracy, steal, fight, and redirect latency', () => {
    expect(computeGoalieBlockChance(0.8, 0.5, cfg)).toBeCloseTo(cfg.G_goalieBlock * 0.4);
    expect(computeShooterAccuracy(0.8, cfg)).toBeCloseTo(cfg.A_shooterAccuracy * 0.8);
    expect(computeStealChance(0.6, 0.5, cfg)).toBeCloseTo(cfg.T_stealChance * 0.3);
    expect(computeFightChance(0.2, 0.8, cfg)).toBeCloseTo(cfg.F_fightChance * 0.8 * 0.8);
    expect(computeRedirectLatency(1.0, 1.0, cfg)).toBeCloseTo(0.15); // floor
  });

  it('decays mood offset by half after 1 half-life', () => {
    const initial = 0.4;
    const afterOneHalfLife = decayMoodOffset(initial, 8, 8);
    expect(afterOneHalfLife).toBeCloseTo(0.2, 5);
    expect(composeEffectiveStat(0.7, 0.5, 0.2)).toBe(1.0);
    expect(composeEffectiveStat(0.2, -0.5, 0)).toBe(0.0);
  });
});

describe('Rink Physics & 60-Degree Rebound Vector', () => {
  const cfg = DEFAULT_CONFIG;

  it('reflects puck off boards with restitution 0.6', () => {
    const res = collidePuckWithBoards(
      { x: 2, y: 200 },
      { x: -100, y: 50 },
      5,
      0.6
    );
    expect(res.bounced).toBe(true);
    expect(res.pos.x).toBe(5);
    expect(res.vel.x).toBeCloseTo(60);
    expect(res.vel.y).toBeCloseTo(50);
  });

  it('bounces puck off rounded rink corners', () => {
    const res = collidePuckWithBoards(
      { x: 8, y: 8 },
      { x: -120, y: -120 },
      5,
      0.6
    );
    expect(res.bounced).toBe(true);
    expect(res.vel.x).toBeGreaterThan(0);
    expect(res.vel.y).toBeGreaterThan(0);
  });

  it('decays puck velocity via exponential friction', () => {
    const v0 = { x: 300, y: 0 };
    const v1 = applyPuckFriction(v0, 1.0, cfg);
    expect(v1.x).toBeCloseTo(300 * Math.exp(-cfg.puckFrictionPerSec));
  });

  it('redirects blocked shots at 60 degrees from the goal line toward the horizontal center line', () => {
    const rng = new SeededRNG(10);
    // Puck above center line (y = 150 < 212.5) saved by Home goalie -> should move +X and +Y (toward 212.5)
    const vAbove = computeReboundVelocity('home', 150, 500, cfg, rng);
    expect(vAbove.x).toBeGreaterThan(0);
    expect(vAbove.y).toBeGreaterThan(0);
    const angleFromGoalLine = Math.atan2(Math.abs(vAbove.x), Math.abs(vAbove.y));
    expect((angleFromGoalLine * 180) / Math.PI).toBeCloseTo(60, 2);

    // Puck below center line (y = 280 > 212.5) saved by Away goalie -> should move -X and -Y (toward 212.5)
    const vBelow = computeReboundVelocity('away', 280, 500, cfg, rng);
    expect(vBelow.x).toBeLessThan(0);
    expect(vBelow.y).toBeLessThan(0);
  });
});

describe('Striker State Machine, Fights, Uncapped Penalty Box & Shots', () => {
  it('steal pass transfers possession and stuns victim', () => {
    const cfg = cloneConfig();
    cfg.T_stealChance = 10; // guarantee steal roll = 1.0
    const sim = new MatchSimulation(cfg, 123);
    sim.phase = 'PLAYING';
    const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;
    const awayS1 = sim.players.find((p) => p.id === 'away-s1')!;

    sim.gainPossession(homeS1);
    sim.handleCarrierCollision(awayS1, homeS1);

    expect(sim.puck.carrierId).toBe(awayS1.id);
    expect(awayS1.mode).toBe('POSSESSING');
    expect(homeS1.mode).toBe('STUNNED');
  });

  it('steal fail + fight pass locks both in 6s brawl, then sends instigator to 30s penalty box', () => {
    const cfg = cloneConfig();
    cfg.T_stealChance = 0; // steal always fails
    cfg.F_fightChance = 10; // fight always succeeds
    const sim = new MatchSimulation(cfg, 123);
    sim.phase = 'PLAYING';

    const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;
    const awayS1 = sim.players.find((p) => p.id === 'away-s1')!;
    sim.gainPossession(homeS1);
    sim.handleCarrierCollision(awayS1, homeS1);

    expect(awayS1.mode).toBe('FIGHTING');
    expect(homeS1.mode).toBe('FIGHTING');
    expect(awayS1.isFightInstigator).toBe(true);
    expect(sim.puck.carrierId).toBeNull();

    // Advance 6.1 game seconds to finish brawl
    for (let i = 0; i < 62; i++) {
      sim.step(0.1);
    }
    expect(awayS1.mode).toBe('PENALTY_BOX');
    expect(awayS1.stateTimer).toBeGreaterThan(28);
    expect(homeS1.mode).not.toBe('PENALTY_BOX');

    // Advance 30 playing game seconds so instigator leaves box
    let playingElapsed = 0;
    while (playingElapsed < 30.2) {
      if (sim.phase !== 'PLAYING') {
        sim.phase = 'PLAYING';
      }
      sim.step(0.1);
      playingElapsed += 0.1;
    }
    expect(awayS1.mode).toBe('DEFENDING');
  });

  it('allows both strikers of a team into the penalty box simultaneously (no cap) and clears all penalties when a new period starts', () => {
    const sim = new MatchSimulation(cloneConfig(), 123);
    sim.phase = 'PLAYING';
    const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;
    const homeS2 = sim.players.find((p) => p.id === 'home-s2')!;
    const awayS1 = sim.players.find((p) => p.id === 'away-s1')!;
    const awayS2 = sim.players.find((p) => p.id === 'away-s2')!;

    sim.startFight(awayS1, homeS1);
    sim.startFight(awayS2, homeS2);

    for (let i = 0; i < 65; i++) {
      sim.step(0.1);
    }
    expect(awayS1.mode).toBe('PENALTY_BOX');
    expect(awayS2.mode).toBe('PENALTY_BOX');

    // Start Period 2 -> all penalties must be cleared and players returned to DEFENDING at their faceoff spots
    sim.startNextPeriod();
    expect(sim.period).toBe(2);
    expect(awayS1.mode).toBe('DEFENDING');
    expect(awayS2.mode).toBe('DEFENDING');
    expect(awayS1.stateTimer).toBe(0);
    expect(awayS2.stateTimer).toBe(0);
    expect(awayS1.pos).toEqual(awayS1.homeSpot);
    expect(awayS2.pos).toEqual(awayS2.homeSpot);
  });

  it('shoots when possession_timer exceeds max_possession or within min_shot_distance', () => {
    const sim = new MatchSimulation(cloneConfig(), 555);
    sim.phase = 'PLAYING';
    const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;
    // Move away strikers far away so no collision interrupts
    for (const p of sim.players) {
      if (p.team === 'away' && p.role === 'striker') {
        p.pos = { x: 100, y: 390 };
      }
    }
    homeS1.pos = { x: 200, y: CENTER_Y };
    sim.gainPossession(homeS1);

    // Step past maxPossessionSec (4.0s)
    for (let i = 0; i < 45; i++) {
      sim.step(0.1);
    }
    expect(sim.events.some((e) => e.type === 'SHOT')).toBe(true);
  });

  it('pre-rolls scoring shots on launch and only registers a GOAL once the puck crosses into the net', () => {
    const cfg = cloneConfig();
    cfg.A_shooterAccuracy = 10;
    cfg.G_goalieBlock = 0;
    cfg.maxGoalChance = 1.0;
    const sim = new MatchSimulation(cfg, 888);
    sim.phase = 'PLAYING';
    const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;
    for (const p of sim.players) {
      if (p.team === 'away' && p.role === 'striker') {
        p.pos = { x: 100, y: 390 };
      }
    }
    homeS1.pos = { x: 560, y: CENTER_Y };
    sim.gainPossession(homeS1);
    sim.shootPuck(homeS1);

    // Immediately after shot release: isScoringShot is true, shotStartPos recorded, score is still 0
    expect(sim.puck.isScoringShot).toBe(true);
    expect(sim.puck.shotStartPos).not.toBeNull();
    expect(sim.homeScore).toBe(0);

    // Step in small increments: while puck is at the outer crease (x < 953), goal must NOT be registered yet
    let sawInCreaseBeforeGoal = false;
    for (let i = 0; i < 90; i++) {
      sim.step(1 / 120);
      if (sim.puck.pos.x > 900 && sim.puck.pos.x < 953 && sim.homeScore === 0) {
        sawInCreaseBeforeGoal = true;
      }
      if (sim.homeScore === 1) {
        expect(sim.puck.pos.x).toBeGreaterThanOrEqual(953);
        break;
      }
    }
    expect(sawInCreaseBeforeGoal).toBe(true);
    expect(sim.homeScore).toBe(1);
    expect(sim.phase).toBe('GOAL_CELEBRATION');
  });

  it('keeps skaters out of creases, stuns players who get too close to the opposing goalie, and prevents stunned players from picking up the puck', () => {
    const sim = new MatchSimulation(cloneConfig(), 919);
    sim.phase = 'PLAYING';
    const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;
    const awayS1 = sim.players.find((p) => p.id === 'away-s1')!;

    // Place Home striker right at the Away crease/goalie (AWAY_GOAL_X = 945)
    homeS1.pos = { x: 928, y: CENTER_Y };
    // Place Away striker inside their own Away crease
    awayS1.pos = { x: 925, y: CENTER_Y - 10 };

    // Place the loose puck right where homeS1 gets knocked back
    sim.puck.carrierId = null;
    sim.puck.pos = { x: 894, y: CENTER_Y };
    sim.puck.vel = { x: 0, y: 0 };

    sim.step(1 / 60);

    // Home striker touched opposing crease/goalie -> knocked outside crease and STUNNED
    expect(homeS1.mode).toBe('STUNNED');
    expect(homeS1.stateTimer).toBeGreaterThan(1.0);
    expect(Math.hypot(homeS1.pos.x - 945, homeS1.pos.y - CENTER_Y)).toBeGreaterThanOrEqual(
      sim.cfg.creaseRadius + sim.cfg.skaterRadius
    );

    // Away striker in their own crease -> pushed outside crease without being stunned
    expect(awayS1.mode).not.toBe('STUNNED');
    expect(Math.hypot(awayS1.pos.x - 945, awayS1.pos.y - CENTER_Y)).toBeGreaterThanOrEqual(
      sim.cfg.creaseRadius + sim.cfg.skaterRadius - 1e-3
    );

    // Stunned player directly on top of a loose puck must NOT pick it up or trigger gainPossession
    sim.puck.carrierId = null;
    sim.currentPossessor = null;
    awayS1.mode = 'DEFENDING';
    awayS1.pos = { x: 200, y: 100 };
    sim.puck.pos = { ...homeS1.pos };
    sim.gainPossession(homeS1);
    expect(sim.puck.carrierId).toBeNull();
    sim.step(1 / 60);
    expect(sim.puck.carrierId).toBeNull();
  });
});

describe('Possession Targeting, Songs & Crowd Volume', () => {
  it('resolves song target from current possessor or last possessor when loose, and locks on tap', () => {
    expect(resolveSongTarget('charge', 'home', 'away')).toBe('home');
    expect(resolveSongTarget('charge', null, 'away')).toBe('away');
    expect(resolveSongTarget('hold_the_line', null, 'away')).toBe('home');
    expect(resolveSongTarget('grudge_toccata', 'home', 'home')).toBe('both');

    const sim = new MatchSimulation(cloneConfig(), 77);
    sim.phase = 'PLAYING';
    const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;
    const awayS1 = sim.players.find((p) => p.id === 'away-s1')!;

    sim.gainPossession(awayS1);
    // Drop puck loose -> lastPossessor is still 'away'
    sim.puck.carrierId = null;
    sim.currentPossessor = null;

    const active = sim.playSong('charge');
    expect(active.target).toBe('away');

    // Now flip possession to 'home' mid-song -> active song target stays locked to 'away'!
    sim.gainPossession(homeS1);
    sim.step(0.5);
    expect(sim.activeSong?.target).toBe('away');
  });

  it('doubles effect and boosts crowd +15% on cue hit, halves effect and drops crowd -10% on stale repeat', () => {
    const sim = new MatchSimulation(cloneConfig(), 88);
    sim.phase = 'PLAYING';
    const startCrowd = sim.crowdVolume;

    sim.triggerCue('BREAKAWAY', 'charge', 'home', 'BREAKAWAY!');
    const firstPlay = sim.playSong('charge');
    expect(firstPlay.cueHit).toBe(true);
    expect(firstPlay.stale).toBe(false);
    expect(firstPlay.multiplier).toBe(2.0);
    expect(sim.crowdVolume).toBe(startCrowd + 15);

    // Repeat same song immediately -> stale!
    const secondPlay = sim.playSong('charge');
    expect(secondPlay.stale).toBe(true);
    expect(secondPlay.multiplier).toBe(0.5);
    expect(sim.crowdVolume).toBe(startCrowd + 15 - 10);
  });

  it('decays crowd volume after 12 game seconds of silence', () => {
    const cfg = cloneConfig();
    cfg.goalCrowdBoost = 0;
    cfg.fightCrowdBoost = 0;
    const sim = new MatchSimulation(cfg, 99);
    sim.phase = 'PLAYING';
    const initial = sim.crowdVolume;
    for (let i = 0; i < 150; i++) {
      sim.step(0.1); // 15 game seconds
    }
    expect(sim.crowdVolume).toBeLessThan(initial);
  });
});

describe('Official Orders & Tie Handling', () => {
  it('evaluates all 5 orders and fails win-based orders on a tie', () => {
    expect(
      evaluateOrder('home_wins', {
        homeGoals: 2,
        awayGoals: 2,
        totalFights: 0,
        averageCrowdVolume: 70,
        isMatchOver: true,
      }).passed
    ).toBe(false);

    expect(
      evaluateOrder('clean_sheet', {
        homeGoals: 3,
        awayGoals: 3,
        totalFights: 0,
        averageCrowdVolume: 70,
        isMatchOver: true,
      }).passed
    ).toBe(false);

    expect(
      evaluateOrder('clean_sheet', {
        homeGoals: 3,
        awayGoals: 1,
        totalFights: 1,
        averageCrowdVolume: 50,
        isMatchOver: true,
      }).passed
    ).toBe(true);

    expect(
      evaluateOrder('blood_on_ice', {
        homeGoals: 0,
        awayGoals: 0,
        totalFights: 3,
        averageCrowdVolume: 50,
        isMatchOver: true,
      }).passed
    ).toBe(true);

    expect(
      evaluateOrder('blowout', {
        homeGoals: 4,
        awayGoals: 2,
        totalFights: 2,
        averageCrowdVolume: 50,
        isMatchOver: true,
      }).passed
    ).toBe(true);

    expect(
      evaluateOrder('bring_the_noise', {
        homeGoals: 0,
        awayGoals: 2,
        totalFights: 0,
        averageCrowdVolume: 65,
        isMatchOver: true,
      }).passed
    ).toBe(true);
  });
});

describe('Determinism & Breakdown Attribution', () => {
  it('reproduces identical match event logs for the same seed and song inputs', () => {
    const runMatch = (seed: number) => {
      const sim = new MatchSimulation(cloneConfig(), seed);
      for (let tick = 0; tick < 1200; tick++) {
        if (tick === 60) sim.playSong('charge');
        if (tick === 300) sim.playSong('grudge_toccata');
        if (tick === 600) sim.playSong('hold_the_line');
        sim.step(1 / 30);
      }
      return {
        homeScore: sim.homeScore,
        awayScore: sim.awayScore,
        events: sim.events,
        puckPos: sim.puck.pos,
      };
    };

    const m1 = runMatch(2026);
    const m2 = runMatch(2026);
    expect(m1).toEqual(m2);
  });

  it('attributes goals, saves/steals, and fights to active songs accurately', () => {
    const summary = buildStatsSummary(
      [
        {
          type: 'GOAL',
          period: 1,
          timeRemainingSec: 200,
          team: 'home',
          activeSongId: 'charge',
          activeSongTarget: 'home',
        },
        {
          type: 'SAVE',
          period: 1,
          timeRemainingSec: 180,
          team: 'away',
          activeSongId: 'hold_the_line',
          activeSongTarget: 'away',
        },
        {
          type: 'FIGHT',
          period: 1,
          timeRemainingSec: 150,
          team: 'home',
          activeSongId: 'grudge_toccata',
          activeSongTarget: 'both',
        },
      ],
      [{ period: 1, volume: 70 }],
      1
    );

    expect(summary.goalsDuringCharge).toBe(1);
    expect(summary.savesAndStealsDuringHold).toBe(1);
    expect(summary.fightsDuringGrudge).toBe(1);
  });

  it('limits active song loadout to maxSongSlots (default 3) and supports configuring slots & songs', () => {
    const cfg = cloneConfig();
    expect(cfg.maxSongSlots).toBe(3);

    const sim = new MatchSimulation(cfg, 42);
    expect(sim.getActiveSongLoadout()).toEqual([
      'charge',
      'hold_the_line',
      'grudge_toccata',
    ]);

    sim.cfg.maxSongSlots = 6;
    expect(sim.getActiveSongLoadout()).toEqual([
      'charge',
      'hold_the_line',
      'grudge_toccata',
      'power_play_polka',
      'kill_the_clock',
      'madeyalook',
    ]);

    sim.cfg.maxSongSlots = 3;
    sim.cfg.equippedSongs = ['power_play_polka', 'kill_the_clock', 'madeyalook'];
    expect(sim.getActiveSongLoadout()).toEqual([
      'power_play_polka',
      'kill_the_clock',
      'madeyalook',
    ]);
  });

  it('enforces that Power Play Polka and Kill the Clock effects are only valid during power plays', () => {
    const sim = new MatchSimulation(cloneConfig(), 55);
    sim.phase = 'PLAYING';
    const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;
    const awayS1 = sim.players.find((p) => p.id === 'away-s1')!;
    const awayG = sim.players.find((p) => p.id === 'away-g')!;

    // 1. Even strength (no one in PENALTY_BOX): Power Play Polka and Kill the Clock have NO effect
    const baseHomeFocus = homeS1.baseFocus;
    const baseAwayGoalieFocus = awayG.baseFocus;

    const evenPlay = sim.playSong('power_play_polka');
    expect(evenPlay.multiplier).toBe(0);
    expect(homeS1.focus).toBeCloseTo(baseHomeFocus, 5);

    const evenKill = sim.playSong('kill_the_clock');
    expect(evenKill.multiplier).toBe(0);
    expect(awayG.focus).toBeCloseTo(baseAwayGoalieFocus, 5);

    // 2. Put Away striker in PENALTY_BOX -> Home is on Power Play, Away is on Penalty Kill
    awayS1.mode = 'PENALTY_BOX';
    awayS1.stateTimer = 30;

    const ppPlay = sim.playSong('power_play_polka');
    expect(ppPlay.target).toBe('home');
    expect(ppPlay.multiplier).toBeGreaterThan(0);
    expect(homeS1.focus).toBeCloseTo(baseHomeFocus + sim.cfg.polkaFocusBonus, 5);

    // If penalty ends mid-song, power play effect immediately stops
    awayS1.mode = 'DEFENDING';
    sim.step(1 / 60);
    expect(homeS1.focus).toBeCloseTo(baseHomeFocus, 5);

    // 3. Re-enable Away penalty -> test Kill the Clock buffs Away (PK) goalie & remaining striker
    awayS1.mode = 'PENALTY_BOX';
    awayG.stamina = 0.6;
    const pkPlay = sim.playSong('kill_the_clock');
    expect(pkPlay.target).toBe('away');
    expect(pkPlay.multiplier).toBeGreaterThan(0);
    expect(awayG.focus).toBeCloseTo(
      Math.min(1, baseAwayGoalieFocus + sim.cfg.killClockGoalieFocusBonus),
      5
    );
    expect(awayG.stamina).toBeCloseTo(0.6 + sim.cfg.killClockGoalieStaminaInstant, 5);
  });

  it('debuffs the defending goalie focus when Madeyalook is played', () => {
    const sim = new MatchSimulation(cloneConfig(), 66);
    sim.phase = 'PLAYING';
    const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;
    const awayG = sim.players.find((p) => p.id === 'away-g')!;

    sim.gainPossession(homeS1);
    const baseGoalieFocus = awayG.baseFocus;

    const active = sim.playSong('madeyalook');
    expect(active.target).toBe('away');
    expect(awayG.focus).toBeCloseTo(
      baseGoalieFocus + sim.cfg.madeyalookGoalieFocusDelta,
      5
    );
    expect(awayG.focus).toBeLessThan(baseGoalieFocus);
  });
});

