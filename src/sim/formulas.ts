import { GameConfig } from '../config';
import { CENTER_Y, RINK_HEIGHT, RINK_WIDTH } from './physics';
import { clamp } from './rng';
import { Vec2 } from './types';

/**
 * Computes effective stat = clamp(baseline + moodOffset + songModifier, 0, 1).
 */
export function composeEffectiveStat(
  baseline: number,
  moodOffset: number,
  songModifier: number
): number {
  return clamp(baseline + moodOffset + songModifier, 0, 1);
}

/**
 * Exponentially decays a mood offset toward 0 with the configured half-life.
 */
export function decayMoodOffset(
  offset: number,
  dtSec: number,
  halfLifeSec: number
): number {
  if (Math.abs(offset) < 1e-4) return 0;
  if (halfLifeSec <= 0) return 0;
  const factor = Math.pow(0.5, dtSec / halfLifeSec);
  return offset * factor;
}

/**
 * goalie_block_chance = G * focus * stamina
 */
export function computeGoalieBlockChance(
  focus: number,
  stamina: number,
  cfg: GameConfig
): number {
  return clamp(cfg.G_goalieBlock * clamp(focus, 0, 1) * clamp(stamina, 0, 1), 0, 1);
}

/**
 * shooter_accuracy = A * focus
 */
export function computeShooterAccuracy(focus: number, cfg: GameConfig): number {
  return clamp(cfg.A_shooterAccuracy * clamp(focus, 0, 1), 0, 1);
}

/**
 * goal_chance = clamp(shooter_accuracy - goalie_block_chance, minGoalChance, maxGoalChance)
 */
export function computeGoalChance(
  shooterAccuracy: number,
  goalieBlockChance: number,
  cfg: GameConfig
): number {
  return clamp(
    shooterAccuracy - goalieBlockChance,
    cfg.minGoalChance,
    cfg.maxGoalChance
  );
}

/**
 * skate_speed = S * (minStaminaSpeedFactor + (1 - minStaminaSpeedFactor) * stamina) * (0.35 + 0.65 * aggression)
 */
export function computeSkateSpeed(
  stamina: number,
  aggression: number,
  cfg: GameConfig
): number {
  const stamFactor =
    cfg.minStaminaSpeedFactor +
    (1 - cfg.minStaminaSpeedFactor) * clamp(stamina, 0, 1);
  const aggFactor = 0.35 + 0.65 * clamp(aggression, 0, 1);
  return cfg.S_skateSpeed * stamFactor * aggFactor;
}

/**
 * redirect_latency = max(0.15, R * (1 - focus) * aggression)
 */
export function computeRedirectLatency(
  focus: number,
  aggression: number,
  cfg: GameConfig
): number {
  const raw =
    cfg.R_redirectLatency * (1 - clamp(focus, 0, 1)) * clamp(aggression, 0, 1);
  return Math.max(0.15, raw);
}

/**
 * fight_chance = F * (1 - focus) * aggression
 */
export function computeFightChance(
  focus: number,
  aggression: number,
  cfg: GameConfig
): number {
  return clamp(
    cfg.F_fightChance * (1 - clamp(focus, 0, 1)) * clamp(aggression, 0, 1),
    0,
    1
  );
}

/**
 * steal_chance = T * focus * aggression
 */
export function computeStealChance(
  focus: number,
  aggression: number,
  cfg: GameConfig
): number {
  return clamp(
    cfg.T_stealChance * clamp(focus, 0, 1) * clamp(aggression, 0, 1),
    0,
    1
  );
}

/**
 * pass_tendency = P_tendency * focus * (1 - 0.5 * aggression)
 * High focus and lower aggression encourage team play and passing to open teammates.
 */
export function computePassTendency(
  focus: number,
  aggression: number,
  cfg: GameConfig
): number {
  return clamp(
    cfg.P_passTendency *
      clamp(focus, 0, 1) *
      (1 - 0.5 * clamp(aggression, 0, 1)),
    0,
    1
  );
}

/**
 * pass_accuracy = P_acc * focus * (0.5 + 0.5 * stamina)
 */
export function computePassAccuracy(
  focus: number,
  stamina: number,
  cfg: GameConfig
): number {
  return clamp(
    cfg.P_passAccuracy *
      clamp(focus, 0, 1) *
      (0.5 + 0.5 * clamp(stamina, 0, 1)),
    0,
    1
  );
}

/**
 * crit_save_chance = C_crit * focus * stamina
 * Determines the probability that a saved shot is cleanly caught in the goalie's glove
 * (forcing opposing strikers to retreat while the goalie sets up an outlet pass).
 */
export function computeCritSaveChance(
  focus: number,
  stamina: number,
  cfg: GameConfig
): number {
  return clamp(
    cfg.C_critSaveChance * clamp(focus, 0, 1) * clamp(stamina, 0, 1),
    0,
    1
  );
}

/**
 * Computes the probability [0.08, 0.88] that a secondary defender abandons man-marking
 * to recklessly swarm the puck carrier. High aggression elevates swarm probability;
 * high focus increases discipline.
 */
export function computeSwarmTendency(aggression: number, focus: number): number {
  return clamp(
    clamp(aggression, 0, 1) * 0.95 - clamp(focus, 0, 1) * 0.35 + 0.10,
    0.08,
    0.88
  );
}

/**
 * Computes an open-ice supporting position for an off-puck offensive teammate.
 * Spreads to the weak-side wing/flank or trailing slot opposite the puck carrier.
 * Lower aggression maintains wider spacing and patient pass-readiness;
 * higher aggression pulls the player closer to the slot for net drives.
 */
export function computeOffensiveSpreadTarget(
  carrierPos: Vec2,
  oppGoalPos: Vec2,
  aggression: number,
  setupTarget?: Vec2
): Vec2 {
  if (setupTarget) {
    return { ...setupTarget };
  }

  const isCarrierTop = carrierPos.y < CENTER_Y;
  // Position on the opposite side of the rink (weak side)
  const baseWeakSideY = isCarrierTop ? CENTER_Y + 95 : CENTER_Y - 95;
  // Aggression pulls slightly toward center slot (for net crashing/rebounds) vs staying wide
  const targetY = clamp(
    baseWeakSideY * (1 - 0.25 * clamp(aggression, 0, 1)) + CENTER_Y * (0.25 * clamp(aggression, 0, 1)),
    45,
    RINK_HEIGHT - 45
  );

  // X position: advance alongside or slightly behind the attack rush
  const dirX = oppGoalPos.x > carrierPos.x ? 1 : -1;
  const advanceDist = 70 + (1 - clamp(aggression, 0, 1)) * 40;
  const targetX = clamp(
    carrierPos.x + dirX * advanceDist * 0.65,
    55,
    RINK_WIDTH - 55
  );

  return { x: targetX, y: targetY };
}

/**
 * Computes the defensive coverage position for the secondary defender.
 * Shadows the off-puck offensive player, positioning between that player and own goal / pass lane.
 */
export function computeDefensiveCoverTarget(
  offPuckAttackerPos: Vec2,
  ownGoalPos: Vec2
): Vec2 {
  // Shadow off-puck attacker, biased 65% toward the attacker and 35% toward protecting own goal line
  return {
    x: clamp(offPuckAttackerPos.x * 0.65 + ownGoalPos.x * 0.35, 45, RINK_WIDTH - 45),
    y: clamp(offPuckAttackerPos.y * 0.85 + CENTER_Y * 0.15, 45, RINK_HEIGHT - 45),
  };
}

