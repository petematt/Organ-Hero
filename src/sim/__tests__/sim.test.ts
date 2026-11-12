import { describe, expect, it } from 'vitest';
import { cloneConfig, DEFAULT_CONFIG } from '../../config';
import {
  evaluateOrder,
  getOrderById,
  getOrderDisplay,
  resolveOrderTargetTeam,
} from '../../game/orders';
import { resolveSongTarget } from '../../game/songs';
import { buildStatsSummary } from '../../game/stats';
import { OrganSynth } from '../../audio/organSynth';
import {
  composeEffectiveStat,
  computeCritSaveChance,
  computeDefensiveCoverTarget,
  computeFightChance,
  computeGoalChance,
  computeGoalieBlockChance,
  computeOffensiveSpreadTarget,
  computePassAccuracy,
  computePassTendency,
  computeRedirectLatency,
  computeShooterAccuracy,
  computeSkateSpeed,
  computeStealChance,
  computeSwarmTendency,
  decayMoodOffset,
} from '../formulas';
import { MatchSimulation } from '../match';
import { OpposingOrganistController } from '../opposingOrganist';
import {
  applyPuckFriction,
  applySkaterSteering,
  AWAY_GOAL_X,
  CENTER_Y,
  collidePuckWithBoards,
  collidePuckWithGoalNets,
  collidePuckWithGoalPosts,
  collideSkaterWithGoalNets,
  computeReboundVelocity,
  createAttackRoute,
  GOAL_HALF_WIDTH,
  HOME_GOAL_X,
  BLUE_LINE_HOME_X,
  BLUE_LINE_AWAY_X,
  isBehindOwnBlueLine,
  NET_DEPTH,
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

  it('redirects blocked shots into corners/boards or straight up/down away from the center line', () => {
    // Collect a sample of rebounds to verify both straight up/down and corner deflections occur
    let sawVerticalRebound = false;
    let sawCornerRebound = false;

    for (let seed = 1; seed <= 30; seed++) {
      const rng = new SeededRNG(seed);
      // Puck above center line (y = 150 < 212.5) saved by Home goalie -> should move +X (away from net) and -Y (toward top boards)
      const vAbove = computeReboundVelocity('home', 150, 500, cfg, rng);
      expect(vAbove.x).toBeGreaterThan(0);
      expect(vAbove.y).toBeLessThan(0);
      const angleAbove = (Math.atan2(Math.abs(vAbove.x), Math.abs(vAbove.y)) * 180) / Math.PI;

      if (angleAbove <= 15) {
        sawVerticalRebound = true;
      } else if (angleAbove >= 30 && angleAbove <= 50) {
        sawCornerRebound = true;
      }

      // Puck below center line (y = 280 > 212.5) saved by Away goalie -> should move -X (away from net) and +Y (toward bottom boards)
      const vBelow = computeReboundVelocity('away', 280, 500, cfg, rng);
      expect(vBelow.x).toBeLessThan(0);
      expect(vBelow.y).toBeGreaterThan(0);
    }

    expect(sawVerticalRebound).toBe(true);
    expect(sawCornerRebound).toBe(true);
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

    // Step in small increments: while puck is at the outer crease (x < AWAY_GOAL_X + 8), goal must NOT be registered yet
    let sawInCreaseBeforeGoal = false;
    for (let i = 0; i < 90; i++) {
      sim.step(1 / 120);
      if (sim.puck.pos.x > AWAY_GOAL_X - sim.cfg.creaseRadius && sim.puck.pos.x < AWAY_GOAL_X + 8 && sim.homeScore === 0) {
        sawInCreaseBeforeGoal = true;
      }
      if (sim.homeScore === 1) {
        expect(sim.puck.pos.x).toBeGreaterThanOrEqual(AWAY_GOAL_X + 8);
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

    // Place Home striker in front of the Away crease/goalie
    homeS1.pos = { x: AWAY_GOAL_X - 17, y: CENTER_Y };
    // Place Away striker inside their own Away crease in front of net
    awayS1.pos = { x: AWAY_GOAL_X - 20, y: CENTER_Y - 10 };

    // Place the loose puck right where homeS1 gets knocked back
    sim.puck.carrierId = null;
    sim.puck.pos = { x: AWAY_GOAL_X - 51, y: CENTER_Y };
    sim.puck.vel = { x: 0, y: 0 };

    sim.step(1 / 60);

    // Home striker touched opposing crease/goalie -> knocked outside crease and STUNNED
    expect(homeS1.mode).toBe('STUNNED');
    expect(homeS1.stateTimer).toBeGreaterThan(1.0);
    expect(Math.hypot(homeS1.pos.x - AWAY_GOAL_X, homeS1.pos.y - CENTER_Y)).toBeGreaterThanOrEqual(
      sim.cfg.creaseRadius + sim.cfg.skaterRadius
    );

    // Away striker in their own crease -> pushed outside crease without being stunned
    expect(awayS1.mode).not.toBe('STUNNED');
    expect(Math.hypot(awayS1.pos.x - AWAY_GOAL_X, awayS1.pos.y - CENTER_Y)).toBeGreaterThanOrEqual(
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

  it('knocks a crease-stunned striker away from the goalie and prevents repeat stun loops when puck is in crease', () => {
    const sim = new MatchSimulation(cloneConfig(), 920);
    sim.phase = 'PLAYING';
    const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;
    const awayGoalie = sim.players.find((p) => p.role === 'goalie' && p.team === 'away')!;

    // Move other strikers far away so they don't interfere
    for (const p of sim.players) {
      if (p.role === 'striker' && p.id !== 'home-s1') {
        p.pos = { x: 150, y: 100 };
      }
    }

    // Place loose puck sitting inside the Away crease so homeS1 wants it
    sim.puck.carrierId = null;
    sim.puck.pos = { x: AWAY_GOAL_X - 15, y: CENTER_Y };
    sim.puck.vel = { x: 0, y: 0 };

    // Intrude into the front of the Away crease
    homeS1.pos = { x: AWAY_GOAL_X - 20, y: CENTER_Y };
    homeS1.mode = 'DEFENDING';

    sim.step(1 / 60);
    expect(homeS1.mode).toBe('STUNNED');
    const posRightAfterStun = homeS1.pos.x;
    expect(posRightAfterStun).toBeLessThan(
      AWAY_GOAL_X - (sim.cfg.creaseRadius + sim.cfg.skaterRadius + 10)
    );

    // Step through the stun duration: knockback velocity should slide homeS1 even further away from the goalie
    for (let i = 0; i < 90; i++) {
      sim.step(1 / 60);
    }
    expect(homeS1.pos.x).toBeLessThan(posRightAfterStun - 20);
    expect(Math.hypot(homeS1.pos.x - awayGoalie.pos.x, homeS1.pos.y - awayGoalie.pos.y)).toBeGreaterThan(70);

    // Wait until stun fully expires and step another 1.5s while the puck is STILL inside the crease:
    // striker must hover outside the crease without getting stunned a second time!
    while ((homeS1.mode as string) === 'STUNNED') {
      sim.step(1 / 60);
    }
    for (let i = 0; i < 90; i++) {
      sim.puck.pos = { x: AWAY_GOAL_X - 15, y: CENTER_Y };
      sim.puck.vel = { x: 0, y: 0 };
      sim.step(1 / 60);
      expect(homeS1.mode).not.toBe('STUNNED');
    }
  });

  it('shooter follow-through collision cooldown prevents immediate re-grab of own rebound', () => {
    const sim = new MatchSimulation(cloneConfig(), 456);
    sim.phase = 'PLAYING';
    const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;
    for (const p of sim.players) {
      if (p.team === 'away' && p.role === 'striker') {
        p.pos = { x: 50, y: 50 };
      }
    }
    homeS1.pos = { x: 750, y: CENTER_Y };
    sim.gainPossession(homeS1);
    sim.shootPuck(homeS1);

    expect(homeS1.collisionCooldown).toBeCloseTo(0.55, 2);
    expect(sim.puck.shooterId).toBe(homeS1.id);

    // Simulate puck bouncing off goalie into a rebound (non-critical save)
    const awayGoalie = sim.players.find((p) => p.role === 'goalie' && p.team === 'away')!;
    sim.puck.pos = { ...awayGoalie.pos };
    (sim as any).resolveGoalieSave(awayGoalie);

    // ShooterId should still be preserved on non-critical rebound
    expect(sim.puck.shooterId).toBe(homeS1.id);

    // Place the rebound right on the shooter while shooter cooldown > 0
    sim.puck.pos = { ...homeS1.pos };
    sim.puck.vel = { x: 0, y: 0 };
    sim.step(1 / 60);

    // Shooter should NOT have vacuumed up the puck
    expect(sim.puck.carrierId).toBeNull();
    expect(homeS1.mode).toBe('DEFENDING');
  });

  it('defending skaters gain slot clearance speed boost when puck is loose in defensive zone', () => {
    const sim = new MatchSimulation(cloneConfig(), 789);
    sim.phase = 'PLAYING';
    const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;

    // Puck loose in home defensive slot (HOME_GOAL_X = 100, dist < 240)
    sim.puck.carrierId = null;
    sim.puck.pos = { x: 120, y: CENTER_Y };
    sim.puck.vel = { x: 0, y: 0 };

    homeS1.pos = { x: 200, y: CENTER_Y };
    homeS1.mode = 'DEFENDING';

    // Step across frames to allow smooth momentum steering to accelerate to boosted speed
    for (let i = 0; i < 60; i++) {
      sim.step(1 / 60);
    }

    // Expected speed should be boosted by 1.25x with current stamina
    const expectedSpeed = computeSkateSpeed(homeS1.stamina, homeS1.aggression, sim.cfg) * 1.25;
    const currentSpeed = Math.hypot(homeS1.vel.x, homeS1.vel.y);
    expect(currentSpeed).toBeCloseTo(expectedSpeed, 1);
  });

  it('defenders prioritize breakout pass when recovering puck in defensive slot', () => {
    const sim = new MatchSimulation(cloneConfig(), 321);
    sim.phase = 'PLAYING';
    const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;
    const homeS2 = sim.players.find((p) => p.id === 'home-s2')!;

    // Position homeS1 in own defensive zone (x = 100) and homeS2 up-ice (x = 400)
    homeS1.pos = { x: 100, y: CENTER_Y };
    homeS2.pos = { x: 400, y: CENTER_Y + 80 };
    homeS2.mode = 'DEFENDING';

    // Move away strikers away so there is a clean passing lane
    for (const p of sim.players) {
      if (p.team === 'away' && p.role === 'striker') {
        p.pos = { x: 800, y: 50 };
      }
    }

    sim.gainPossession(homeS1);
    expect(homeS1.mode).toBe('POSSESSING');

    // Step just 0.1s - well below normal 0.25s passing threshold, but enough for defensive breakout
    sim.step(0.1);

    // A breakout pass should have been initiated to homeS2
    const passEvent = sim.events.find((e) => e.type === 'PASS');
    expect(passEvent).toBeDefined();
    expect(passEvent?.playerId).toBe(homeS1.id);
    expect(sim.puck.inFlightPassFromId).toBe(homeS1.id);
    expect(sim.puck.inFlightPassToId).toBe(homeS2.id);
  });

  it('defending players behind their blue line clear the puck out of territory in varied down-range angles and chase it down', () => {
    const sim = new MatchSimulation(cloneConfig(), 55);
    sim.phase = 'PLAYING';
    const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;

    // Position homeS1 behind Home's blue line (BLUE_LINE_HOME_X = 340)
    expect(BLUE_LINE_HOME_X).toBe(340);
    expect(BLUE_LINE_AWAY_X).toBe(660);
    homeS1.pos = { x: 220, y: CENTER_Y };
    homeS1.mode = 'DEFENDING';
    expect(isBehindOwnBlueLine(homeS1.pos, homeS1.team)).toBe(true);

    sim.gainPossession(homeS1);
    expect(homeS1.mode).toBe('POSSESSING');

    // Execute clearance (default away strikers are at x = 595, closer to Away goal than homeS1)
    const cleared = sim.tryClearPuck(homeS1);
    expect(cleared).toBe(true);

    // Puck should now be loose and flying forward with a meaningful off-axis lateral component (not straight down the ice)
    expect(sim.puck.carrierId).toBeNull();
    expect(sim.puck.vel.x).toBeGreaterThan(250);
    const angleOffHorizontalDeg =
      (Math.atan2(Math.abs(sim.puck.vel.y), Math.abs(sim.puck.vel.x)) * 180) / Math.PI;
    expect(angleOffHorizontalDeg).toBeGreaterThanOrEqual(12 - 1e-3);
    expect(angleOffHorizontalDeg).toBeLessThanOrEqual(52 + 1e-3);

    // Clearance event should be recorded
    const clearEvent = sim.events.find((e) => e.type === 'CLEAR');
    expect(clearEvent).toBeDefined();
    expect(clearEvent?.playerId).toBe(homeS1.id);

    // Clearing player should have transitioned to DEFENDING with brief cooldown to chase it down
    expect(homeS1.mode).toBe('DEFENDING');
    expect(homeS1.collisionCooldown).toBeLessThanOrEqual(0.25);

    // Stepping simulation: players actively chase the loose puck down-ice
    sim.step(1 / 60);
    expect(homeS1.vel.x).toBeGreaterThan(0);

    // Verify variety of up/down down-range angles across seeds
    let sawUpwardClear = false;
    let sawDownwardClear = false;
    for (let s = 1; s <= 25; s++) {
      const sSim = new MatchSimulation(cloneConfig(), s * 17);
      sSim.phase = 'PLAYING';
      const carrier = sSim.players.find((p) => p.id === 'home-s1')!;
      carrier.pos = { x: 220, y: CENTER_Y };
      sSim.gainPossession(carrier);
      expect(sSim.tryClearPuck(carrier)).toBe(true);
      if (sSim.puck.vel.y < -80) sawUpwardClear = true;
      if (sSim.puck.vel.y > 80) sawDownwardClear = true;
    }
    expect(sawUpwardClear).toBe(true);
    expect(sawDownwardClear).toBe(true);
  });

  it('does not clear the puck if no opposing strikers are active or if the carrier is already closest to the opposing goal', () => {
    // Case 1: Both opposing strikers in the penalty box -> do NOT clear
    const simNoOpp = new MatchSimulation(cloneConfig(), 101);
    simNoOpp.phase = 'PLAYING';
    const homeS1 = simNoOpp.players.find((p) => p.id === 'home-s1')!;
    homeS1.pos = { x: 220, y: CENTER_Y };
    for (const p of simNoOpp.players) {
      if (p.team === 'away' && p.role === 'striker') {
        p.mode = 'PENALTY_BOX';
        p.stateTimer = 25;
      }
    }
    simNoOpp.gainPossession(homeS1);
    expect(simNoOpp.tryClearPuck(homeS1)).toBe(false);
    expect(simNoOpp.puck.carrierId).toBe(homeS1.id);

    // Case 2: Opposing strikers active, but carrier is already the player closest to the opposing goal -> do NOT clear
    const simClosest = new MatchSimulation(cloneConfig(), 102);
    simClosest.phase = 'PLAYING';
    const carrier = simClosest.players.find((p) => p.id === 'home-s1')!;
    carrier.pos = { x: 310, y: CENTER_Y }; // behind Home blue line (340), dist to Away goal (900) = 590
    for (const p of simClosest.players) {
      if (p.role === 'striker' && p.id !== carrier.id) {
        // All other strikers are deeper in Home's zone (further from Away goal than carrier)
        p.pos = { x: 180, y: p.team === 'home' ? 120 : 300 };
        p.mode = 'DEFENDING';
      }
    }
    simClosest.gainPossession(carrier);
    expect(simClosest.tryClearPuck(carrier)).toBe(false);
    expect(simClosest.puck.carrierId).toBe(carrier.id);
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
    let groanCount = 0;
    sim.audioHooks.onCrowdGroan = () => {
      groanCount++;
    };
    sim.phase = 'PLAYING';
    const startCrowd = sim.crowdVolume;

    sim.triggerCue('BREAKAWAY', 'charge', 'home', 'BREAKAWAY!');
    const firstPlay = sim.playSong('charge');
    expect(firstPlay.cueHit).toBe(true);
    expect(firstPlay.stale).toBe(false);
    expect(firstPlay.multiplier).toBe(2.0);
    expect(sim.crowdVolume).toBe(startCrowd + 15);
    expect(groanCount).toBe(0);

    // Repeat same song immediately -> stale!
    const secondPlay = sim.playSong('charge');
    expect(secondPlay.stale).toBe(true);
    expect(secondPlay.multiplier).toBe(0.5); // Halved effectiveness
    expect(sim.crowdVolume).toBe(startCrowd + 15 - 10); // Crowd reduced
    expect(groanCount).toBe(1);

    // Callout verifies crowd reduced callout is spawned
    const staleCallout = sim.callouts.find((c) => c.text === 'CROWD REDUCED! (STALE)');
    expect(staleCallout).toBeDefined();

    // Verify there is NO callout for halved song effectiveness
    const halvedCallout = sim.callouts.find(
      (c) => c.text.includes('0.5') || c.text.toLowerCase().includes('half')
    );
    expect(halvedCallout).toBeUndefined();
  });

  it('halves multiplier and reduces crowd -10% when playing a stale song on an active cue hit', () => {
    const sim = new MatchSimulation(cloneConfig(), 88);
    sim.phase = 'PLAYING';
    sim.playSong('charge'); // First play -> sets lastPlayedSongId = 'charge'
    const crowdAfterFirst = sim.crowdVolume;

    // Now trigger cue matching 'charge' and replay 'charge' -> stale cue hit!
    sim.triggerCue('BREAKAWAY', 'charge', 'home', 'BREAKAWAY!');
    const staleCuePlay = sim.playSong('charge');

    expect(staleCuePlay.stale).toBe(true);
    expect(staleCuePlay.cueHit).toBe(true);
    // Effectiveness is halved: 2.0 (cue) * 0.5 (stale) = 1.0
    expect(staleCuePlay.multiplier).toBe(1.0);
    // Crowd is penalized (-10%), NOT boosted (+15%)
    expect(sim.crowdVolume).toBe(crowdAfterFirst - 10);

    // Verify callouts: has crowd reduced callout, and does NOT claim '2x EFFECT!'
    expect(sim.callouts.some((c) => c.text === 'CROWD REDUCED! (STALE)')).toBe(true);
    expect(sim.callouts.some((c) => c.text.includes('2x EFFECT'))).toBe(false);
    expect(sim.callouts.some((c) => c.text === '★ CUE HIT! ★')).toBe(true);
  });

  it('penalizes crowd and spawns CROWD REDUCED! (STALE) even when song is invalid on ice', () => {
    const sim = new MatchSimulation(cloneConfig(), 88);
    sim.phase = 'PLAYING';
    // Power Play Polka without power play is invalid on ice
    sim.playSong('power_play_polka');
    const crowdAfterFirst = sim.crowdVolume;

    // Replay power_play_polka -> stale and invalid on ice
    const stalePlay = sim.playSong('power_play_polka');
    expect(stalePlay.stale).toBe(true);
    expect(stalePlay.multiplier).toBe(0.0);
    expect(sim.crowdVolume).toBe(crowdAfterFirst - 10);
    expect(sim.callouts.some((c) => c.text === 'NO POWER PLAY! (NO EFFECT)')).toBe(true);
    expect(sim.callouts.some((c) => c.text === 'CROWD REDUCED! (STALE)')).toBe(true);
  });

  it('awards standard crowd boost and 1.0 multiplier when switching to a different (fresh) song', () => {
    const sim = new MatchSimulation(cloneConfig(), 88);
    sim.phase = 'PLAYING';
    sim.playSong('charge');
    const crowdAfterCharge = sim.crowdVolume;

    // Play a different song -> fresh play!
    const freshPlay = sim.playSong('hold_the_line');
    expect(freshPlay.stale).toBe(false);
    expect(freshPlay.multiplier).toBe(1.0);
    expect(sim.crowdVolume).toBe(crowdAfterCharge + sim.cfg.songBaseCrowdBoost);
    expect(sim.callouts.some((c) => c.text.includes('STALE'))).toBe(false);
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
        totalFights: 5,
        averageCrowdVolume: 50,
        isMatchOver: true,
      }).passed
    ).toBe(true);

    expect(
      evaluateOrder('blowout', {
        homeGoals: 5,
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
        averageCrowdVolume: 80,
        isMatchOver: true,
      }).passed
    ).toBe(true);
  });
});

describe('Updated Official Directives', () => {
  const snap = (over: Partial<Parameters<typeof evaluateOrder>[1]>) => ({
    homeGoals: 0,
    awayGoals: 0,
    totalFights: 0,
    averageCrowdVolume: 50,
    isMatchOver: true,
    ...over,
  });

  it('uses new thresholds for fights, blowout margin and crowd volume', () => {
    expect(evaluateOrder('blood_on_ice', snap({ totalFights: 4 })).passed).toBe(false);
    expect(evaluateOrder('blood_on_ice', snap({ totalFights: 5 })).passed).toBe(true);
    expect(evaluateOrder('blowout', snap({ homeGoals: 4, awayGoals: 2 })).passed).toBe(false);
    expect(evaluateOrder('blowout', snap({ homeGoals: 4, awayGoals: 1 })).passed).toBe(true);
    expect(evaluateOrder('bring_the_noise', snap({ averageCrowdVolume: 79 })).passed).toBe(false);
    expect(evaluateOrder('bring_the_noise', snap({ averageCrowdVolume: 80 })).passed).toBe(true);
    expect(getOrderById('clean_sheet').title).toBe('Family Night');
  });

  it('home_wins is always Home; team directives honor targetTeam', () => {
    expect(
      evaluateOrder('home_wins', snap({ homeGoals: 1, awayGoals: 2, targetTeam: 'away' })).passed
    ).toBe(false);
    expect(
      evaluateOrder('blowout', snap({ homeGoals: 0, awayGoals: 3, targetTeam: 'away' })).passed
    ).toBe(true);
    expect(
      evaluateOrder('clean_sheet', snap({ homeGoals: 0, awayGoals: 2, targetTeam: 'away' })).passed
    ).toBe(true);
    expect(
      evaluateOrder('clean_sheet', snap({ homeGoals: 2, awayGoals: 0, targetTeam: 'away' })).passed
    ).toBe(false);
  });

  it('resolveOrderTargetTeam is deterministic, Home for home_wins, and mixes teams otherwise', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(resolveOrderTargetTeam('home_wins', seed)).toBe('home');
      expect(resolveOrderTargetTeam('blood_on_ice', seed)).toBe('home');
      expect(resolveOrderTargetTeam('blowout', seed)).toBe(resolveOrderTargetTeam('blowout', seed));
    }
    for (const id of ['clean_sheet', 'blowout', 'no_repeat_songs', 'comeback_win'] as const) {
      const teams = new Set(Array.from({ length: 60 }, (_, s) => resolveOrderTargetTeam(id, s)));
      expect(teams.has('home')).toBe(true);
      expect(teams.has('away')).toBe(true);
    }
    expect(getOrderDisplay('blowout', 'away').description).toContain('Away Team');
  });

  it('no_repeat_songs fails immediately on a repeat and requires a win', () => {
    expect(
      evaluateOrder('no_repeat_songs', snap({ homeGoals: 2, awayGoals: 1, stalePlays: 0 })).passed
    ).toBe(true);
    const live = evaluateOrder(
      'no_repeat_songs',
      snap({ homeGoals: 2, awayGoals: 1, stalePlays: 1, isMatchOver: false })
    );
    expect(live.liveStatus).toBe('FAILED');
    expect(
      evaluateOrder('no_repeat_songs', snap({ homeGoals: 1, awayGoals: 1 })).passed
    ).toBe(false);
  });

  it('comeback_win needs a deficit after P2 and a win by the end', () => {
    const base = { period: 3, homeGoalsAfterP2: 0, awayGoalsAfterP2: 1 };
    expect(
      evaluateOrder('comeback_win', snap({ ...base, homeGoals: 2, awayGoals: 1 })).passed
    ).toBe(true);
    expect(
      evaluateOrder('comeback_win', snap({ ...base, homeGoals: 1, awayGoals: 1 })).passed
    ).toBe(false);
    // Led after P2 -> never a comeback, even with a win
    expect(
      evaluateOrder(
        'comeback_win',
        snap({ period: 3, homeGoalsAfterP2: 1, awayGoalsAfterP2: 0, homeGoals: 2, awayGoals: 0 })
      ).passed
    ).toBe(false);
    // Live in P1/P2
    expect(
      evaluateOrder('comeback_win', snap({ period: 2, isMatchOver: false, homeGoals: 0, awayGoals: 1 })).liveStatus
    ).toBe('ON_TRACK');
    expect(
      evaluateOrder('comeback_win', snap({ period: 2, isMatchOver: false, homeGoals: 1, awayGoals: 1 })).liveStatus
    ).toBe('AT_RISK');
    // Away target
    expect(
      evaluateOrder(
        'comeback_win',
        snap({ period: 3, targetTeam: 'away', homeGoalsAfterP2: 2, awayGoalsAfterP2: 1, homeGoals: 2, awayGoals: 3 })
      ).passed
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
    expect(grudgeSummary.impactLines.some((l) => l.includes('Grudge Toccata sparked 1 of 1 brawl on the ice.'))).toBe(true);
    expect(grudgeSummary.impactLines.some((l) => l.includes('(s)'))).toBe(false);
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
    expect(homeBrawlCallout?.text).toBe('🥊 BRAWL! 🥊');
    expect(homeBrawlCallout?.color).toBe('#38bdf8');

    // Also verify Away instigator brawl callout
    sim.callouts = [];
    sim.startFight(awayStriker, passer);
    const awayBrawlCallout = sim.callouts.find((c) => c.text.includes('BRAWL'));
    expect(awayBrawlCallout?.text).toBe('🥊 BRAWL! 🥊');
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
      synth.triggerCrowdSurge('shot');
      synth.triggerCrowdSurge('goal');
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

  it('triggers onFightImpact periodically while players are fighting', () => {
    const cfg = cloneConfig();
    cfg.brawlDurationSec = 3.0;
    const sim = new MatchSimulation(cfg, 456);
    sim.phase = 'PLAYING';

    let punchCount = 0;
    sim.audioHooks = {
      onFightImpact: () => {
        punchCount++;
      },
    };

    const s1 = sim.players.find((p) => p.team === 'home' && p.role === 'striker')!;
    const s2 = sim.players.find((p) => p.team === 'away' && p.role === 'striker')!;

    sim.startFight(s1, s2);
    expect(punchCount).toBe(1); // initial fight impact

    // Step 2 seconds during the fight
    for (let i = 0; i < 120; i++) {
      sim.step(1 / 60);
    }
    // Punches should have landed repeatedly throughout the brawl
    expect(punchCount).toBeGreaterThanOrEqual(3);
  });

  it('triggers onPuckAction on pass, shot, steal, and possession gain', () => {
    const cfg = cloneConfig();
    const sim = new MatchSimulation(cfg, 789);
    sim.phase = 'PLAYING';

    const actions: string[] = [];
    sim.audioHooks = {
      onPuckAction: (type) => {
        actions.push(type);
      },
    };

    const homeS1 = sim.players.find((p) => p.team === 'home' && p.role === 'striker')!;
    const homeS2 = sim.players.find((p) => p.team === 'home' && p.id !== homeS1.id && p.role === 'striker')!;
    const awayS = sim.players.find((p) => p.team === 'away' && p.role === 'striker')!;

    sim.gainPossession(homeS1);
    expect(actions).toContain('pass'); // gain possession stick trap

    actions.length = 0;
    sim.passPuck(homeS1, homeS2);
    expect(actions).toContain('pass');

    actions.length = 0;
    sim.gainPossession(homeS1);
    sim.shootPuck(homeS1);
    expect(actions).toContain('shot');

    actions.length = 0;
    cfg.T_stealChance = 10;
    sim.gainPossession(homeS1);
    sim.handleCarrierCollision(awayS, homeS1);
    expect(actions).toContain('steal');
  });

  it('travels to the penalty box along a smooth cosmetic curve without game interaction while penalty timer ticks immediately', () => {
    const cfg = cloneConfig();
    const sim = new MatchSimulation(cfg, 404);
    sim.phase = 'PLAYING';

    const instigator = sim.players.find((p) => p.id === 'home-s1')!;
    const victim = sim.players.find((p) => p.id === 'away-s1')!;
    const startFightPos = { x: 405, y: 340 };
    instigator.pos = { ...startFightPos };
    victim.pos = { x: 425, y: 340 };

    sim.startFight(instigator, victim);
    // Advance right past the end of the brawl so instigator is sent to the box
    instigator.stateTimer = 0.02;
    victim.stateTimer = 0.02;
    sim.step(0.05);

    expect(instigator.mode).toBe('PENALTY_BOX');
    expect(instigator.penaltyTravelPath).toBeTruthy();

    // Did NOT teleport straight to y=28 on the first frame
    const boxSeat = sim.getPenaltyBoxPos(instigator.team, instigator.id);
    expect(Math.hypot(instigator.pos.x - startFightPos.x, instigator.pos.y - startFightPos.y)).toBeLessThan(30);
    expect(Math.hypot(instigator.pos.x - boxSeat.x, instigator.pos.y - boxSeat.y)).toBeGreaterThan(250);

    // Penalty timer ticks down immediately while skating along the curve
    const timerAtStart = instigator.stateTimer;
    let maxCurveBowX = 0;
    for (let i = 0; i < 6; i++) {
      // Place loose puck directly on top of the traveling penalized skater to verify zero interaction
      sim.puck.carrierId = null;
      sim.puck.pos = { ...instigator.pos };
      sim.puck.vel = { x: 0, y: 0 };
      sim.step(0.1);
      expect(sim.puck.carrierId).not.toBe(instigator.id);
      maxCurveBowX = Math.max(maxCurveBowX, Math.abs(instigator.pos.x - startFightPos.x));
    }

    expect(instigator.stateTimer).toBeCloseTo(timerAtStart - 0.6, 5);
    // Path curves naturally rather than moving on a straight vertical line (startFightPos.x === boxSeat.x === 405)
    expect(maxCurveBowX).toBeGreaterThan(6);

    // Advance until travel completes (~2.5s max) -> arrives cleanly at penalty box seat
    for (let i = 0; i < 25; i++) {
      sim.step(0.1);
    }
    expect(instigator.penaltyTravelPath).toBeNull();
    expect(instigator.pos.x).toBeCloseTo(boxSeat.x, 2);
    expect(instigator.pos.y).toBeCloseTo(boxSeat.y, 2);
  });

  it('formats singular and plural counts without any "(s)" in stats and order summaries', () => {
    const summary1 = buildStatsSummary(
      [
        { type: 'SONG_PLAYED', period: 1, timeRemainingSec: 100, songId: 'charge', activeSongId: 'charge', activeSongTarget: 'home' },
        { type: 'GOAL', period: 1, timeRemainingSec: 98, team: 'home', activeSongId: 'charge', activeSongTarget: 'home' },
        { type: 'SONG_PLAYED', period: 1, timeRemainingSec: 80, songId: 'hold_the_line', activeSongId: 'hold_the_line', activeSongTarget: 'home' },
        { type: 'SAVE', period: 1, timeRemainingSec: 78, team: 'home', activeSongId: 'hold_the_line', activeSongTarget: 'home' },
      ],
      [{ period: 1, volume: 60 }],
      1
    );
    expect(summary1.impactLines).toContain('Charge! Fanfare boosted 1 of 1 goal (1 play).');
    expect(summary1.impactLines).toContain('Hold the Line directly boosted 1 defensive save.');

    const summary2 = buildStatsSummary(
      [
        { type: 'SONG_PLAYED', period: 1, timeRemainingSec: 100, songId: 'charge', activeSongId: 'charge', activeSongTarget: 'home' },
        { type: 'SONG_PLAYED', period: 1, timeRemainingSec: 70, songId: 'charge', activeSongId: 'charge', activeSongTarget: 'home' },
        { type: 'GOAL', period: 1, timeRemainingSec: 98, team: 'home', activeSongId: 'charge', activeSongTarget: 'home' },
        { type: 'GOAL', period: 1, timeRemainingSec: 68, team: 'home', activeSongId: 'charge', activeSongTarget: 'home' },
        { type: 'SONG_PLAYED', period: 1, timeRemainingSec: 50, songId: 'hold_the_line', activeSongId: 'hold_the_line', activeSongTarget: 'home' },
        { type: 'SAVE', period: 1, timeRemainingSec: 48, team: 'home', activeSongId: 'hold_the_line', activeSongTarget: 'home' },
        { type: 'SAVE', period: 1, timeRemainingSec: 47, team: 'home', activeSongId: 'hold_the_line', activeSongTarget: 'home' },
        { type: 'STEAL', period: 1, timeRemainingSec: 46, team: 'home', activeSongId: 'hold_the_line', activeSongTarget: 'home' },
      ],
      [{ period: 1, volume: 60 }],
      1
    );
    expect(summary2.impactLines).toContain('Charge! Fanfare boosted 2 of 2 goals (2 plays).');
    expect(summary2.impactLines).toContain('Hold the Line directly boosted 2 defensive saves & 1 steal.');
    expect(summary2.impactLines.every((l) => !l.includes('(s)'))).toBe(true);

    const order1 = evaluateOrder('clean_sheet', {
      homeGoals: 2,
      awayGoals: 1,
      totalFights: 1,
      averageCrowdVolume: 65,
      isMatchOver: true,
    });
    expect(order1.reason).toBe('Home won 2–1 with only 1 fight.');
    const order0 = evaluateOrder('clean_sheet', {
      homeGoals: 2,
      awayGoals: 1,
      totalFights: 0,
      averageCrowdVolume: 65,
      isMatchOver: true,
    });
    expect(order0.reason).toBe('Home won 2–1 with only 0 fights.');
  });

  describe('Failed-Shot Juice & Goalpost Collisions', () => {
    it('detects puck collisions against goalposts and reflects velocity', () => {
      // Test top post of away goal (AWAY_GOAL_X, CENTER_Y - GOAL_HALF_WIDTH)
      const topPostY = CENTER_Y - GOAL_HALF_WIDTH;
      const puckPos = { x: AWAY_GOAL_X - 6, y: topPostY };
      const puckVel = { x: 300, y: 0 }; // flying into the post from left

      const res = collidePuckWithGoalPosts(puckPos, puckVel, 5);
      expect(res.hit).toBe(true);
      expect(res.postPos).not.toBeNull();
      expect(res.postPos?.x).toBe(AWAY_GOAL_X);
      expect(res.postPos?.y).toBe(topPostY);
      expect(res.vel.x).toBeLessThan(0); // reflected backward into rink

      // Test bottom post of home goal (HOME_GOAL_X, CENTER_Y + GOAL_HALF_WIDTH)
      const botPostY = CENTER_Y + GOAL_HALF_WIDTH;
      const homePuckPos = { x: HOME_GOAL_X + 6, y: botPostY };
      const homePuckVel = { x: -300, y: 0 }; // flying into home post from right
      const homeRes = collidePuckWithGoalPosts(homePuckPos, homePuckVel, 5);
      expect(homeRes.hit).toBe(true);
      expect(homeRes.postPos?.x).toBe(HOME_GOAL_X);
      expect(homeRes.postPos?.y).toBe(botPostY);
      expect(homeRes.vel.x).toBeGreaterThan(0); // reflected forward into rink

      // Test puck in center ice - no hit
      const centerRes = collidePuckWithGoalPosts({ x: 500, y: 200 }, { x: 100, y: 0 }, 5);
      expect(centerRes.hit).toBe(false);
      expect(centerRes.postPos).toBeNull();
    });

    it('manages time dilation during in-flight shots and hitstop micro-freeze', () => {
      const cfg = cloneConfig();
      const sim = new MatchSimulation(cfg, 42);
      sim.phase = 'PLAYING';

      // Initially at normal speed
      expect(sim.getTimeDilation()).toBe(1.0);

      // In-flight shot heading towards away goal (AWAY_GOAL_X = 945)
      sim.puck.inFlightShotFrom = 'home';
      sim.puck.pos = { x: 880, y: CENTER_Y }; // near away goal

      // Step time dilation with real elapsed time
      for (let i = 0; i < 20; i++) {
        sim.updateTimeDilation(1 / 60);
      }
      expect(sim.getTimeDilation()).toBeLessThan(0.70); // slowed down into bullet-time!

      // Trigger hitstop on save / post hit
      sim.triggerHitstop(0.065);
      expect(sim.getTimeDilation()).toBe(0.05);

      // After hitstop timer expires and shot ends, dilation recovers toward 1.0
      sim.puck.inFlightShotFrom = null;
      for (let i = 0; i < 60; i++) {
        sim.updateTimeDilation(1 / 60);
      }
      expect(sim.getTimeDilation()).toBeGreaterThan(0.85);
    });

    it('emits post hit event, triggers hitstop, and calls onPostHit & crowd groan', () => {
      const cfg = cloneConfig();
      const sim = new MatchSimulation(cfg, 123);
      sim.phase = 'PLAYING';

      let postHitHookCalled = false;
      let crowdGroanCalled = false;
      let visualPostHitCalled = false;

      sim.audioHooks = {
        onPostHit: () => {
          postHitHookCalled = true;
        },
        onCrowdGroan: () => {
          crowdGroanCalled = true;
        },
      };

      sim.visualHooks = {
        onPostHit: () => {
          visualPostHitCalled = true;
        },
      };

      // Set puck heading right into the top post of the away goal
      const topPostY = CENTER_Y - GOAL_HALF_WIDTH;
      sim.puck.inFlightShotFrom = 'home';
      sim.puck.isScoringShot = false;
      sim.puck.pos = { x: AWAY_GOAL_X - 8, y: topPostY };
      sim.puck.vel = { x: 250, y: 0 };

      sim.step(1 / 60);

      expect(postHitHookCalled).toBe(true);
      expect(crowdGroanCalled).toBe(true);
      expect(visualPostHitCalled).toBe(true);
      expect(sim.hitstopTimerSec).toBeGreaterThan(0);
      expect(sim.puck.inFlightShotFrom).toBeNull(); // shot state resolved

      const postEvents = sim.events.filter((e) => e.type === 'POST_HIT');
      expect(postEvents.length).toBe(1);
      expect(postEvents[0].team).toBe('home');
    });

    it('emits onGoalieSave and onCrowdGroan when a home shot is stopped by goalie', () => {
      const cfg = cloneConfig();
      const sim = new MatchSimulation(cfg, 456);
      sim.phase = 'PLAYING';

      let saveHookCalled = false;
      let groanHookCalled = false;
      let visualSaveCalled = false;

      sim.audioHooks = {
        onGoalieSave: () => {
          saveHookCalled = true;
        },
        onCrowdGroan: () => {
          groanHookCalled = true;
        },
      };

      sim.visualHooks = {
        onGoalieSave: () => {
          visualSaveCalled = true;
        },
      };

      const awayGoalie = sim.players.find((p) => p.role === 'goalie' && p.team === 'away')!;
      sim.puck.inFlightShotFrom = 'home';
      sim.puck.isScoringShot = false;
      sim.puck.pos = { x: awayGoalie.pos.x - 5, y: awayGoalie.pos.y };
      sim.puck.vel = { x: 100, y: 0 };

      sim.step(1 / 60);

      expect(saveHookCalled).toBe(true);
      expect(groanHookCalled).toBe(true);
      expect(visualSaveCalled).toBe(true);
      expect(sim.hitstopTimerSec).toBeGreaterThan(0);
    });
  });

  describe('Behind-The-Net Play, Net Cage Collisions & Skater Momentum', () => {
    it('allows skaters to skate behind the goal line without triggering crease stun', () => {
      const sim = new MatchSimulation(cloneConfig(), 501);
      sim.phase = 'PLAYING';
      const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;

      // Position home striker directly behind the away goal net (AWAY_GOAL_X = 900, behind is x > 900)
      homeS1.pos = { x: AWAY_GOAL_X + 45, y: CENTER_Y };
      homeS1.vel = { x: 0, y: -100 };
      homeS1.mode = 'DEFENDING';

      sim.step(1 / 60);

      // Must remain in normal defending state without being stunned or knocked back
      expect(homeS1.mode).toBe('DEFENDING');
      expect(homeS1.stateTimer).toBe(0);
    });

    it('prevents skaters from clipping through the solid back of the net cage', () => {
      // Home net back is at x = HOME_GOAL_X - NET_DEPTH = 100 - 24 = 76
      const skaterRadius = 14;
      const initialPos = { x: 74, y: CENTER_Y };
      const vel = { x: 150, y: 0 }; // skating directly toward the back of the home net

      const res = collideSkaterWithGoalNets(initialPos, vel, skaterRadius);

      // Skater position should be clamped outside the back of the net
      expect(res.pos.x).toBeLessThanOrEqual(HOME_GOAL_X - NET_DEPTH - skaterRadius);
      expect(res.vel.x).toBeLessThanOrEqual(0); // forward velocity canceled
    });

    it('bounces loose pucks off the back of the goal net cage', () => {
      const puckRadius = 5;
      const initialPos = { x: 73, y: CENTER_Y };
      const vel = { x: 200, y: 0 }; // loose puck flying into the back of the home net

      const res = collidePuckWithGoalNets(initialPos, vel, puckRadius, 0.6);

      expect(res.bounced).toBe(true);
      expect(res.vel.x).toBeLessThan(0); // reflected backward away from the net
      expect(res.pos.x).toBeLessThanOrEqual(HOME_GOAL_X - NET_DEPTH - puckRadius);
    });

    it('generates BEHIND_NET_LOOP attack route with waypoints circling behind the goal', () => {
      const rng = new SeededRNG(1234);
      // High focus favors wrap-around
      let foundLoop = false;
      for (let i = 0; i < 20; i++) {
        const route = createAttackRoute({ x: 500, y: 100 }, 'home', rng, 0.9, 0.2);
        if (route.archetype === 'BEHIND_NET_LOOP') {
          foundLoop = true;
          expect(route.waypoints.length).toBeGreaterThanOrEqual(3);
          // For home team attacking away goal (AWAY_GOAL_X = 900), the loop apex must be behind the goal (x > 900)
          const behindNetWaypoint = route.waypoints.find((wp) => wp.x > AWAY_GOAL_X);
          expect(behindNetWaypoint).toBeDefined();
          expect(behindNetWaypoint?.x).toBeGreaterThan(AWAY_GOAL_X + 25);
          expect(route.shotTriggerDist).toBeLessThanOrEqual(100);
          break;
        }
      }
      expect(foundLoop).toBe(true);
    });

    it('preserves skater momentum and applies steering acceleration rather than instant velocity flipping', () => {
      const currentVel = { x: 200, y: 0 };
      const desiredVel = { x: -200, y: 0 }; // complete 180-degree turn
      const dt = 1 / 60; // 16.6ms

      const nextVel = applySkaterSteering(currentVel, desiredVel, dt, 8.5);

      // Must NOT immediately flip to -200
      expect(nextVel.x).toBeGreaterThan(0); // Still moving forward in the first frame!
      expect(nextVel.x).toBeLessThan(200); // Decelerating toward target
    });
  });

  describe('Anti-Swarming Tactics & Role Partitioning', () => {
    it('spreads the supporting offensive striker out across the ice when teammate has possession', () => {
      const sim = new MatchSimulation(cloneConfig(), 444);
      sim.phase = 'PLAYING';
      const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;
      const homeS2 = sim.players.find((p) => p.id === 'home-s2')!;

      // Position carrier homeS1 on the top wing
      homeS1.pos = { x: 500, y: 100 };
      sim.gainPossession(homeS1);

      // Position supporting striker homeS2
      homeS2.pos = { x: 450, y: 150 };
      homeS2.mode = 'DEFENDING';

      // Step simulation
      sim.step(1 / 60);

      // Supporting striker must steer toward the opposite/weak-side flank (y > CENTER_Y)
      expect(homeS2.vel.y).toBeGreaterThan(0);

      // Step more frames: spacing between teammates must widen, not cluster
      for (let i = 0; i < 60; i++) {
        sim.step(1 / 60);
      }
      const separation = Math.hypot(homeS2.pos.x - homeS1.pos.x, homeS2.pos.y - homeS1.pos.y);
      expect(separation).toBeGreaterThan(120);
      expect(homeS2.pos.y).toBeGreaterThan(CENTER_Y);
    });

    it('partitions defenders: closest defender pressures carrier while secondary defender covers off-puck striker', () => {
      const sim = new MatchSimulation(cloneConfig(), 101);
      sim.phase = 'PLAYING';

      const awayS1 = sim.players.find((p) => p.id === 'away-s1')!;
      const awayS2 = sim.players.find((p) => p.id === 'away-s2')!;
      const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;
      const homeS2 = sim.players.find((p) => p.id === 'home-s2')!;

      // Away S1 has puck at top wing
      awayS1.pos = { x: 400, y: 80 };
      sim.gainPossession(awayS1);

      // Away S2 is off-puck attacker on bottom wing
      awayS2.pos = { x: 350, y: 340 };
      awayS2.mode = 'DEFENDING';

      // Home S1 is closer to Away S1 (primary presser)
      homeS1.pos = { x: 300, y: 90 };
      homeS1.mode = 'DEFENDING';

      // Home S2 is disciplined (low aggression, high focus) and positioned lower down (secondary cover)
      homeS2.pos = { x: 250, y: 300 };
      homeS2.mode = 'DEFENDING';
      homeS2.baseAggression = 0.05;
      homeS2.aggression = 0.05;
      homeS2.baseFocus = 0.95;
      homeS2.focus = 0.95;

      sim.step(1 / 60);

      // Primary presser (homeS1) targets carrier (awayS1 at top wing, y ≈ 80)
      expect(homeS1.vel.x).toBeGreaterThan(0); // moving toward x=400
      expect(homeS1.vel.y).toBeLessThanOrEqual(5);

      // Secondary defender (homeS2) covers off-puck attacker (awayS2 at bottom wing, y ≈ 340), NOT the carrier at y=80
      expect(homeS2.vel.y).toBeGreaterThan(0); // moving toward y=340
      expect(homeS2.pos.y).toBeGreaterThan(200);
    });

    it('increases swarm probability with high aggression', () => {
      const disciplinedSwarm = computeSwarmTendency(0.10, 0.90);
      const aggressiveSwarm = computeSwarmTendency(0.90, 0.10);

      expect(disciplinedSwarm).toBeLessThan(0.20);
      expect(aggressiveSwarm).toBeGreaterThan(0.70);
    });

    it('spaces out secondary teammate on loose pucks when disciplined', () => {
      const sim = new MatchSimulation(cloneConfig(), 888);
      sim.phase = 'PLAYING';

      const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;
      const homeS2 = sim.players.find((p) => p.id === 'home-s2')!;

      // Puck loose near center ice top
      sim.puck.carrierId = null;
      sim.puck.pos = { x: 500, y: 90 };
      sim.puck.vel = { x: 0, y: 0 };

      // Home S1 is closer (x=450, y=95) -> primary chaser
      homeS1.pos = { x: 450, y: 95 };
      homeS1.mode = 'DEFENDING';

      // Home S2 is disciplined (low aggression, high focus)
      homeS2.pos = { x: 380, y: 120 };
      homeS2.mode = 'DEFENDING';
      homeS2.baseAggression = 0.05;
      homeS2.aggression = 0.05;
      homeS2.baseFocus = 0.95;
      homeS2.focus = 0.95;

      sim.step(1 / 60);

      // Primary chaser heads directly for puck at y=90
      expect(homeS1.vel.x).toBeGreaterThan(0);

      // Disciplined secondary teammate fans out to the weak side (y > CENTER_Y) rather than crowding top
      expect(homeS2.vel.y).toBeGreaterThan(0);
    });

    it('computeOffensiveSpreadTarget positions supporting striker on weak side with wide spacing', () => {
      const carrierTop = { x: 500, y: 100 };
      const oppGoal = { x: 760, y: 200 };
      const target = computeOffensiveSpreadTarget(carrierTop, oppGoal, 0.2);
      expect(target.y).toBeGreaterThan(CENTER_Y);
      expect(target.x).toBeGreaterThan(carrierTop.x);

      // Setup target override
      const setup = { x: 620, y: 280 };
      expect(computeOffensiveSpreadTarget(carrierTop, oppGoal, 0.5, setup)).toEqual(setup);
    });

    it('computeDefensiveCoverTarget positions secondary defender between attacker and goal', () => {
      const attacker = { x: 550, y: 320 };
      const ownGoal = { x: 40, y: 200 };
      const cover = computeDefensiveCoverTarget(attacker, ownGoal);
      // Cover position should be between attacker and goal along X
      expect(cover.x).toBeLessThan(attacker.x);
      expect(cover.x).toBeGreaterThan(ownGoal.x);
    });
  });

  describe('Period End Song Clean-up (Issue #3)', () => {
    it('clears active song, cooldown, and stat buffs when period 1 ends', () => {
      const sim = new MatchSimulation(cloneConfig());
      sim.periodTimeRemainingSec = 2.0;
      sim.phase = 'PLAYING';

      // Record baseline focus before song
      const homeStriker = sim.players.find((p) => p.team === 'home' && p.role === 'striker')!;
      const baselineFocus = homeStriker.focus;

      // Play 'charge' (duration 8s) with only 2s left in period 1
      const active = sim.playSong('charge');
      expect(active).not.toBeNull();
      expect(sim.activeSong).not.toBeNull();
      expect(sim.isOnCooldown()).toBe(true);
      expect(sim.getSongCooldownRemainingSec()).toBeGreaterThan(5);
      expect(homeStriker.focus).toBeGreaterThan(baselineFocus);
      expect(homeStriker.reactionTimer).toBeGreaterThan(0);

      // Step simulation past period end
      sim.step(2.5);

      expect(sim.phase).toBe('PERIOD_END');
      expect(sim.periodTimeRemainingSec).toBe(0);
      expect(sim.activeSong).toBeNull();
      expect(sim.isOnCooldown()).toBe(false);
      expect(sim.getSongCooldownRemainingSec()).toBe(0);
      expect(homeStriker.focus).toBe(baselineFocus);
      expect(homeStriker.reactionTimer).toBe(0);
    });

    it('starts next period with no carryover song buffs or cooldown locks (1 -> 2)', () => {
      const sim = new MatchSimulation(cloneConfig());
      sim.periodTimeRemainingSec = 1.0;
      sim.phase = 'PLAYING';

      const homeStriker = sim.players.find((p) => p.team === 'home' && p.role === 'striker')!;
      const baselineFocus = homeStriker.focus;

      sim.playSong('charge');
      sim.step(1.5);
      expect(sim.phase).toBe('PERIOD_END');

      // Intermission ends, period 2 starts
      sim.startNextPeriod();
      expect(sim.period).toBe(2);
      expect(sim.activeSong).toBeNull();
      expect(sim.isOnCooldown()).toBe(false);
      expect(sim.getSongCooldownRemainingSec()).toBe(0);
      expect(homeStriker.focus).toBe(baselineFocus);
      expect(homeStriker.reactionTimer).toBe(0);

      // Player can immediately play a fresh song in period 2
      const p2Song = sim.playSong('charge');
      expect(p2Song).not.toBeNull();
      expect(sim.activeSong?.songId).toBe('charge');
      expect(sim.isOnCooldown()).toBe(true);
    });

    it('clears active song and prevents carryover between period 2 and period 3', () => {
      const sim = new MatchSimulation(cloneConfig());
      // Advance to period 2 with away team possessing puck so hold_the_line targets defending home team
      sim.period = 2;
      sim.periodTimeRemainingSec = 1.5;
      sim.phase = 'PLAYING';
      sim.currentPossessor = 'away';

      const homeGoalie = sim.players.find((p) => p.team === 'home' && p.role === 'goalie')!;
      const baselineFocus = homeGoalie.focus;

      sim.playSong('hold_the_line');
      expect(sim.activeSong?.songId).toBe('hold_the_line');
      expect(homeGoalie.focus).toBeGreaterThan(baselineFocus);

      // Step past end of period 2
      sim.step(2.0);
      expect(sim.phase).toBe('PERIOD_END');
      expect(sim.activeSong).toBeNull();
      expect(sim.isOnCooldown()).toBe(false);
      expect(homeGoalie.focus).toBe(baselineFocus);

      // Advance to period 3
      sim.startNextPeriod();
      expect(sim.period).toBe(3);
      expect(sim.activeSong).toBeNull();
      expect(sim.isOnCooldown()).toBe(false);
      expect(homeGoalie.focus).toBe(baselineFocus);
    });

    it('clears opposing organist active song when period ends', () => {
      const sim = new MatchSimulation(cloneConfig());
      const controller = new OpposingOrganistController({
        name: 'Rival Ray',
        title: 'Visiting Booth Virtuoso',
        avatarColor: '#f43f5e',
        playIntervalSec: 10,
        favoredSongs: ['charge'],
        tauntMessage: 'Loves loud fanfares.',
      });
      sim.opposingOrganist = controller;
      controller.activeSongId = 'charge';
      controller.songRemainingSec = 7.5;

      sim.periodTimeRemainingSec = 0.5;
      sim.phase = 'PLAYING';
      sim.step(0.8);

      expect(sim.phase).toBe('PERIOD_END');
      expect(controller.activeSongId).toBeNull();
      expect(controller.songRemainingSec).toBe(0);
    });

    it('clears active situational cues when period ends', () => {
      const sim = new MatchSimulation(cloneConfig());
      sim.triggerCue('TEMPER_FLARING', 'grudge_toccata', 'both', 'FIGHT!');
      expect(sim.activeCue).not.toBeNull();

      sim.periodTimeRemainingSec = 0.5;
      sim.phase = 'PLAYING';
      sim.step(0.8);

      expect(sim.phase).toBe('PERIOD_END');
      expect(sim.activeCue).toBeNull();
    });

    it('endActiveSong resets activeSong, activeCue, rival song, and player stats immediately', () => {
      const sim = new MatchSimulation(cloneConfig());
      sim.phase = 'PLAYING';
      sim.playSong('charge');
      sim.triggerCue('TEMPER_FLARING', 'grudge_toccata', 'both', 'FIGHT!');

      const homeStriker = sim.players.find((p) => p.team === 'home' && p.role === 'striker')!;
      expect(sim.activeSong).not.toBeNull();
      expect(sim.activeCue).not.toBeNull();
      expect(homeStriker.reactionTimer).toBeGreaterThan(0);

      sim.endActiveSong();

      expect(sim.activeSong).toBeNull();
      expect(sim.activeCue).toBeNull();
      expect(sim.isOnCooldown()).toBe(false);
      expect(homeStriker.reactionTimer).toBe(0);
    });
  });

  describe('faceoff natural movement and fight cancellation', () => {
    it('moves players naturally to faceoff locations without teleporting on mid-game faceoff', () => {
      const sim = new MatchSimulation(cloneConfig(), 8888);
      sim.phase = 'PLAYING';

      const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;
      const awayS1 = sim.players.find((p) => p.id === 'away-s1')!;

      // Position skaters far from their homeSpots (e.g. following goal mouth scramble)
      homeS1.pos = { x: 120, y: 380 };
      awayS1.pos = { x: 680, y: 80 };

      const homeStartPos = { ...homeS1.pos };
      const awayStartPos = { ...awayS1.pos };

      sim.setupFaceoff();

      // Skaters must NOT have instantly teleported to their homeSpot
      expect(homeS1.pos.x).toBeCloseTo(homeStartPos.x, 1);
      expect(homeS1.pos.y).toBeCloseTo(homeStartPos.y, 1);
      expect(awayS1.pos.x).toBeCloseTo(awayStartPos.x, 1);
      expect(awayS1.pos.y).toBeCloseTo(awayStartPos.y, 1);

      expect(homeS1.faceoffTravelPath).toBeTruthy();
      expect(awayS1.faceoffTravelPath).toBeTruthy();

      // Advance through part of the countdown: players move smoothly toward spots
      sim.step(0.4);
      expect(homeS1.pos.x).not.toBeCloseTo(homeStartPos.x, 0);
      expect(homeS1.pos.x).not.toBeCloseTo(homeS1.homeSpot.x, 0);
      // Velocity is non-zero during the glide
      expect(Math.hypot(homeS1.vel.x, homeS1.vel.y)).toBeGreaterThan(0);

      expect(sim.phase).toBe('FACEOFF_COUNTDOWN');
      while ((sim.phase as string) === 'FACEOFF_COUNTDOWN') {
        sim.step(0.1);
      }

      expect(sim.phase).toBe('PLAYING');
      expect(homeS1.pos.x).toBeCloseTo(homeS1.homeSpot.x, 2);
      expect(homeS1.pos.y).toBeCloseTo(homeS1.homeSpot.y, 2);
      expect(homeS1.vel.x).toBe(0);
      expect(homeS1.vel.y).toBe(0);
      expect(homeS1.faceoffTravelPath).toBeNull();
    });

    it('cancels any fight in progress when faceoff is initiated', () => {
      const sim = new MatchSimulation(cloneConfig(), 8888);
      sim.phase = 'PLAYING';

      const awayS1 = sim.players.find((p) => p.id === 'away-s1')!;
      const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;

      awayS1.pos = { x: 300, y: 200 };
      homeS1.pos = { x: 310, y: 205 };

      sim.startFight(awayS1, homeS1);
      expect(awayS1.mode).toBe('FIGHTING');
      expect(homeS1.mode).toBe('FIGHTING');
      expect(awayS1.fightPartnerId).toBe(homeS1.id);
      expect(homeS1.fightPartnerId).toBe(awayS1.id);
      expect(awayS1.isFightInstigator).toBe(true);

      // Trigger faceoff while fight is actively underway
      sim.setupFaceoff();

      // Fight is cancelled: modes reset to DEFENDING, partner cleared, no penalty served
      expect(awayS1.mode).toBe('DEFENDING');
      expect(homeS1.mode).toBe('DEFENDING');
      expect(awayS1.fightPartnerId).toBeNull();
      expect(homeS1.fightPartnerId).toBeNull();
      expect(awayS1.isFightInstigator).toBe(false);
      expect(awayS1.fightPunchCooldown).toBeUndefined();

      // Both players travel smoothly from their brawl spot to their faceoff spots
      expect(awayS1.faceoffTravelPath).toBeTruthy();
      expect(homeS1.faceoffTravelPath).toBeTruthy();
    });

    it('cancels fight in progress immediately when period ends', () => {
      const sim = new MatchSimulation(cloneConfig(), 9999);
      sim.phase = 'PLAYING';

      const awayS1 = sim.players.find((p) => p.id === 'away-s1')!;
      const homeS1 = sim.players.find((p) => p.id === 'home-s1')!;
      sim.startFight(awayS1, homeS1);
      expect(awayS1.mode).toBe('FIGHTING');

      sim.periodTimeRemainingSec = 0.05;
      sim.step(0.1);

      expect(sim.phase).toBe('PERIOD_END');
      expect(awayS1.mode).toBe('DEFENDING');
      expect(homeS1.mode).toBe('DEFENDING');
      expect(awayS1.fightPartnerId).toBeNull();
      expect(homeS1.fightPartnerId).toBeNull();
    });

    it('does not move penalized players in penalty box to faceoff spots', () => {
      const sim = new MatchSimulation(cloneConfig(), 1234);
      sim.phase = 'PLAYING';

      const penalized = sim.players.find((p) => p.id === 'away-s1')!;
      penalized.mode = 'PENALTY_BOX';
      penalized.stateTimer = 25;
      const boxPos = sim.getPenaltyBoxPos(penalized.team, penalized.id);
      penalized.pos = { ...boxPos };

      sim.setupFaceoff();

      // Penalized player remains in the box and does NOT glide to faceoff spot
      expect(penalized.mode).toBe('PENALTY_BOX');
      expect(penalized.faceoffTravelPath).toBeFalsy();
      expect(penalized.pos.x).toBeCloseTo(boxPos.x, 2);
      expect(penalized.pos.y).toBeCloseTo(boxPos.y, 2);
    });
  });
});




