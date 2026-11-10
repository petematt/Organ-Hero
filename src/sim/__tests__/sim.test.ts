import { describe, expect, it } from 'vitest';
import { cloneConfig, DEFAULT_CONFIG } from '../../config';
import { evaluateOrder } from '../../game/orders';
import { resolveSongTarget } from '../../game/songs';
import { buildStatsSummary } from '../../game/stats';
import { OrganSynth } from '../../audio/organSynth';
import {
  composeEffectiveStat,
  computeCritSaveChance,
  computeFightChance,
  computeGoalChance,
  computeGoalieBlockChance,
  computePassAccuracy,
  computePassTendency,
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

    // Unbuffed Sniper (0.55 focus) vs Away Goalie (0.70 focus, 0.85 stamina) -> clamped at 5%
    const unbuffedAcc = computeShooterAccuracy(0.55, cfg);
    const goalieBlock = computeGoalieBlockChance(0.70, 0.85, cfg);
    const unbuffedGoalChance = computeGoalChance(unbuffedAcc, goalieBlock, cfg);
    expect(unbuffedGoalChance).toBeCloseTo(cfg.minGoalChance);

    // Charge! Cue Hit Sniper (1.00 focus) vs same Goalie -> >7x higher goal chance (~35.6%)
    const buffedAcc = computeShooterAccuracy(1.0, cfg);
    const buffedGoalChance = computeGoalChance(buffedAcc, goalieBlock, cfg);
    expect(buffedGoalChance).toBeGreaterThan(unbuffedGoalChance * 7);
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

  it('only includes song impact for songs actually played in the period', () => {
    // Case 1: No songs played at all
    const noSongsSummary = buildStatsSummary(
      [
        {
          type: 'GOAL',
          period: 1,
          timeRemainingSec: 150,
          team: 'home',
          activeSongId: null,
          activeSongTarget: null,
        },
      ],
      [{ period: 1, volume: 50 }],
      1
    );
    expect(noSongsSummary.impactLines).toEqual(['No organ songs were played this period.']);

    // Case 2: Only Charge! played, Grudge Toccata never played
    const chargeOnlySummary = buildStatsSummary(
      [
        {
          type: 'SONG_PLAYED',
          period: 1,
          timeRemainingSec: 200,
          songId: 'charge',
          cueHit: true,
          stale: false,
          activeSongId: null,
          activeSongTarget: null,
        },
        {
          type: 'GOAL',
          period: 1,
          timeRemainingSec: 195,
          team: 'home',
          activeSongId: 'charge',
          activeSongTarget: 'home',
        },
      ],
      [{ period: 1, volume: 60 }],
      1
    );

    // Charge! should be reported
    expect(chargeOnlySummary.impactLines.some((l) => l.includes('Charge!'))).toBe(true);
    // Unplayed songs should NOT be mentioned
    expect(chargeOnlySummary.impactLines.some((l) => l.includes('Grudge Toccata'))).toBe(false);
    expect(chargeOnlySummary.impactLines.some((l) => l.includes('Hold the Line'))).toBe(false);
    expect(chargeOnlySummary.impactLines.some((l) => l.includes('Power Play Polka'))).toBe(false);

    // Case 3: Grudge Toccata played
    const grudgeSummary = buildStatsSummary(
      [
        {
          type: 'SONG_PLAYED',
          period: 1,
          timeRemainingSec: 100,
          songId: 'grudge_toccata',
          cueHit: true,
          stale: false,
          activeSongId: null,
          activeSongTarget: null,
        },
        {
          type: 'FIGHT',
          period: 1,
          timeRemainingSec: 95,
          team: 'home',
          activeSongId: 'grudge_toccata',
          activeSongTarget: 'both',
        },
      ],
      [{ period: 1, volume: 75 }],
      1
    );
    expect(grudgeSummary.impactLines.some((l) => l.includes('Grudge Toccata sparked 1 of 1 brawl(s)'))).toBe(true);
    expect(grudgeSummary.impactLines.some((l) => l.includes('Charge!'))).toBe(false);
  });

  it('triggers audio hooks for pass, shot, steal, fight impact, penalty whistle, and period buzzer', () => {
    const cfg = cloneConfig();
    const sim = new MatchSimulation(cfg, 101);

    const puckActions: string[] = [];
    let fightImpacts = 0;
    let penaltyWhistles = 0;
    let periodBuzzers = 0;

    sim.audioHooks = {
      onPuckAction: (t) => puckActions.push(t),
      onFightImpact: () => fightImpacts++,
      onPenaltyWhistle: () => penaltyWhistles++,
      onPeriodBuzzer: () => periodBuzzers++,
    };

    const homePlayers = sim.players.filter((p) => p.team === 'home');
    const passer = homePlayers[0];
    const receiver = homePlayers[1];
    sim.passPuck(passer, receiver);
    expect(puckActions).toContain('pass');

    sim.shootPuck(passer);
    expect(puckActions).toContain('shot');

    const awayStriker = sim.players.find((p) => p.role === 'striker' && p.team === 'away')!;
    sim.startFight(passer, awayStriker);
    expect(fightImpacts).toBe(1);
    const homeBrawlCallout = sim.callouts.find((c) => c.text.includes('BRAWL'));
    expect(homeBrawlCallout?.text).toBe('🥊 BRAWL! (HOME PENALTY) 🥊');
    expect(homeBrawlCallout?.color).toBe('#38bdf8');

    // Also verify Away instigator brawl callout
    sim.callouts = [];
    sim.startFight(awayStriker, passer);
    const awayBrawlCallout = sim.callouts.find((c) => c.text.includes('BRAWL'));
    expect(awayBrawlCallout?.text).toBe('🥊 BRAWL! (AWAY PENALTY) 🥊');
    expect(awayBrawlCallout?.color).toBe('#f43f5e');

    // Simulate penalty box arrival after brawl
    sim.phase = 'PLAYING';
    passer.mode = 'FIGHTING';
    passer.isFightInstigator = true;
    passer.stateTimer = 0.05;
    sim.step(0.1);
    expect(passer.mode).toBe('PENALTY_BOX');
    expect(penaltyWhistles).toBe(1);

    // Period end buzzer
    sim.periodTimeRemainingSec = 0.01;
    sim.step(0.05);
    expect(periodBuzzers).toBe(1);
    expect(sim.phase).toBe('PERIOD_END');
  });

  it('allows invoking OrganSynth SFX methods without throwing', () => {
    const synth = new OrganSynth();
    expect(() => {
      synth.playPuckClick('pass');
      synth.playPuckClick('shot');
      synth.playPuckClick('steal');
      synth.playFightImpact();
      synth.playPenaltyWhistle();
      synth.playPeriodBuzzer();
    }).not.toThrow();
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

describe('Passing Mechanics, Disable Passing Option & Goalie Critical Saves', () => {
  it('computes pass tendency, pass accuracy, and critical save chance from Focus, Aggression, and Stamina', () => {
    const cfg = DEFAULT_CONFIG;
    // Higher focus and lower aggression increase pass tendency
    const playmakerPass = computePassTendency(0.8, 0.2, cfg);
    const hotheadPass = computePassTendency(0.3, 0.9, cfg);
    expect(playmakerPass).toBeGreaterThan(hotheadPass);

    // Higher focus and stamina increase pass accuracy
    expect(computePassAccuracy(0.8, 1.0, cfg)).toBeGreaterThan(
      computePassAccuracy(0.4, 0.3, cfg)
    );

    // Goalie crit save scales with focus and stamina
    expect(computeCritSaveChance(0.8, 1.0, cfg)).toBeCloseTo(
      cfg.C_critSaveChance * 0.8
    );
  });

  it('passes to an open better-positioned teammate when enablePassing is true, and never passes when enablePassing is false', () => {
    const cfg = cloneConfig();
    cfg.P_passTendency = 10; // guarantee pass roll
    cfg.P_passAccuracy = 10; // guarantee accurate pass
    cfg.enablePassing = false;

    const simDisabled = new MatchSimulation(cfg, 404);
    simDisabled.phase = 'PLAYING';
    const homeS1 = simDisabled.players.find((p) => p.id === 'home-s1')!;
    const homeS2 = simDisabled.players.find((p) => p.id === 'home-s2')!;
    // Move opponents away
    for (const p of simDisabled.players) {
      if (p.team === 'away' && p.role === 'striker') {
        p.pos = { x: 200, y: 380 };
      }
    }
    homeS1.pos = { x: 400, y: CENTER_Y };
    homeS2.pos = { x: 620, y: CENTER_Y - 70 }; // closer to away goal and open
    simDisabled.gainPossession(homeS1);
    homeS1.possessionTimer = 0.5;
    homeS1.passCheckTimer = 0;

    // With enablePassing = false, tryPassPuck must return false and emit no PASS event
    expect(simDisabled.tryPassPuck(homeS1)).toBe(false);
    expect(simDisabled.events.some((e) => e.type === 'PASS')).toBe(false);

    // Now enable passing -> striker passes to open teammate and receiver gets focus bonus on reception
    cfg.enablePassing = true;
    const simEnabled = new MatchSimulation(cfg, 404);
    simEnabled.phase = 'PLAYING';
    const s1 = simEnabled.players.find((p) => p.id === 'home-s1')!;
    const s2 = simEnabled.players.find((p) => p.id === 'home-s2')!;
    for (const p of simEnabled.players) {
      if (p.team === 'away' && p.role === 'striker') {
        p.pos = { x: 200, y: 380 };
      }
    }
    s1.pos = { x: 400, y: CENTER_Y };
    s2.pos = { x: 540, y: CENTER_Y - 50 };
    simEnabled.gainPossession(s1);
    s1.possessionTimer = 0.5;
    s1.passCheckTimer = 0;

    expect(simEnabled.tryPassPuck(s1)).toBe(true);
    expect(simEnabled.events.some((e) => e.type === 'PASS')).toBe(true);
    expect(simEnabled.puck.inFlightPassToId).toBe(s2.id);

    const prevOffset = s2.moodFocusOffset;
    // Step until s2 receives the pass
    for (let i = 0; i < 45; i++) {
      simEnabled.step(1 / 60);
      if (simEnabled.puck.carrierId === s2.id) break;
    }
    expect(simEnabled.puck.carrierId).toBe(s2.id);
    expect(s2.moodFocusOffset).toBeGreaterThan(prevOffset);
    expect(s2.possessionTimer).toBeGreaterThanOrEqual(cfg.maxPossessionSec * 0.45);
  });

  it('catches the puck on a critical save, forces attacking strikers to retreat, and outlets a pass to a teammate', () => {
    const cfg = cloneConfig();
    cfg.A_shooterAccuracy = 0;
    cfg.G_goalieBlock = 10;
    cfg.minGoalChance = 0; // guarantee save
    cfg.C_critSaveChance = 10; // guarantee critical glove save
    cfg.goalieHoldDurationSec = 1.0;

    const sim = new MatchSimulation(cfg, 777);
    sim.phase = 'PLAYING';

    const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;
    const homeS2 = sim.players.find((p) => p.id === 'home-s2')!;
    const awayG = sim.players.find((p) => p.id === 'away-g')!;

    // Place Home strikers deep in Away zone (near x = 780)
    homeS1.pos = { x: 780, y: CENTER_Y - 20 };
    homeS2.pos = { x: 760, y: CENTER_Y + 40 };

    const initialGoalieStamina = awayG.stamina;
    sim.gainPossession(homeS1);
    sim.shootPuck(homeS1);

    // Step until the shot reaches the Away goalie crease and triggers the critical save
    for (let i = 0; i < 60; i++) {
      sim.step(1 / 60);
      if (awayG.mode === 'HOLDING_PUCK') break;
    }

    expect(awayG.mode).toBe('HOLDING_PUCK');
    expect(sim.puck.carrierId).toBe(awayG.id);
    expect(awayG.stamina).toBeLessThanOrEqual(initialGoalieStamina - cfg.goalieSaveStaminaDrain + 1e-6);
    expect(sim.events.some((e) => e.type === 'SAVE' && e.isCritSave === true)).toBe(true);

    const s1XAtCatch = homeS1.pos.x;
    const s2XAtCatch = homeS2.pos.x;

    // Step 0.5s while goalie holds the puck -> Home strikers must retreat toward neutral ice (decreasing X)
    for (let i = 0; i < 30; i++) {
      sim.step(1 / 60);
    }
    expect(homeS1.pos.x).toBeLessThan(s1XAtCatch - 30);
    expect(homeS2.pos.x).toBeLessThan(s2XAtCatch - 30);

    // Step past the remaining hold duration -> Goalie releases outlet pass to a teammate
    for (let i = 0; i < 40; i++) {
      sim.step(1 / 60);
    }
    expect(awayG.mode).toBe('DEFENDING');
    expect(
      sim.events.some((e) => e.type === 'PASS' && e.playerId === awayG.id)
    ).toBe(true);
  });

  it('tracks global song cooldown state and counts down with simulation steps', () => {
    const cfg = cloneConfig();
    const sim = new MatchSimulation(cfg, 123);
    sim.phase = 'PLAYING';

    expect(sim.isOnCooldown()).toBe(false);
    expect(sim.getSongCooldownRemainingSec()).toBe(0);

    const activeSong = sim.playSong('charge');
    expect(activeSong).not.toBeNull();
    expect(sim.isOnCooldown()).toBe(true);
    expect(sim.getSongCooldownRemainingSec()).toBeCloseTo(cfg.songActiveDurationSec);

    // Step 2 seconds
    for (let i = 0; i < 120; i++) {
      sim.step(1 / 60);
    }
    expect(sim.isOnCooldown()).toBe(true);
    expect(sim.getSongCooldownRemainingSec()).toBeCloseTo(cfg.songActiveDurationSec - 2.0, 1);

    // Step through remainder of cooldown
    const remainingSteps = Math.ceil((cfg.songActiveDurationSec - 2.0) * 60) + 10;
    for (let i = 0; i < remainingSteps; i++) {
      sim.step(1 / 60);
    }
    expect(sim.isOnCooldown()).toBe(false);
    expect(sim.getSongCooldownRemainingSec()).toBe(0);
  });
});

