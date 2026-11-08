import { GameConfig } from '../config';
import { clamp } from './rng';

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

