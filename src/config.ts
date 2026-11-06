export interface PlayerBaselineConfig {
  id: string;
  name: string;
  number: number;
  team: 'home' | 'away';
  role: 'striker' | 'goalie';
  focus: number;
  aggression: number;
}

export interface GameConfig {
  // Formula constants
  G_goalieBlock: number;
  S_skateSpeed: number;
  R_redirectLatency: number;
  A_shooterAccuracy: number;
  F_fightChance: number;
  T_stealChance: number;

  // Stat clamps & floors
  minGoalChance: number;
  maxGoalChance: number;
  minStaminaSpeedFactor: number;

  // Timings (in game seconds)
  periodDurationSec: number;
  songActiveDurationSec: number;
  cueWindowDurationSec: number;
  brawlDurationSec: number;
  penaltyDurationSec: number;
  silenceDecayThresholdSec: number;
  moodHalfLifeSec: number;
  maxPossessionSec: number;
  faceoffCountdownRealSec: number;

  // Physics constants
  minShotDistance: number;
  pushStrength: number;
  puckFrictionPerSec: number;
  boardRestitution: number;
  shotBaseSpeed: number;
  reboundSpeedRatio: number;
  skaterRadius: number;
  puckRadius: number;
  creaseRadius: number;

  // Stamina drain & recovery
  strikerStaminaDrainPerSec: number;
  strikerCollisionStaminaDrain: number;
  goalieStaminaDrainPerSec: number;
  goalieSaveStaminaDrain: number;
  penaltyBoxStaminaRecoveryPerSec: number;
  brawlLoserStaminaHit: number;

  // Mood event shifts
  moodRobbedAggression: number;
  moodRobbedFocus: number;
  moodStealFocus: number;
  moodPushedAggression: number;
  moodGoalScorerFocus: number;
  moodGoalTeamAggression: number;
  moodConcedeGoalieFocus: number;
  moodConcedeTeamAggression: number;
  moodSaveGoalieFocus: number;
  moodLeaveBoxAggression: number;

  // Song modifiers
  chargeFocusBonus: number;
  chargeAggressionBonus: number;
  holdGoalieFocusBonus: number;
  holdGoalieStaminaInstant: number;
  holdStrikerFocusBonus: number;
  holdStrikerAggressionDelta: number;
  grudgeAggressionBonus: number;
  grudgeFocusDelta: number;

  // Crowd Volume parameters
  initialCrowdVolume: number;
  songBaseCrowdBoost: number;
  cueHitCrowdBoost: number;
  staleCrowdPenalty: number;
  silenceCrowdDecayPerSec: number;
  goalCrowdBoost: number;
  fightCrowdBoost: number;

  // Baseline roster
  roster: PlayerBaselineConfig[];
}

export const DEFAULT_CONFIG: GameConfig = {
  G_goalieBlock: 0.75,
  S_skateSpeed: 220,
  R_redirectLatency: 1.4,
  A_shooterAccuracy: 0.85,
  F_fightChance: 0.65,
  T_stealChance: 0.55,

  minGoalChance: 0.05,
  maxGoalChance: 0.90,
  minStaminaSpeedFactor: 0.20,

  periodDurationSec: 240,
  songActiveDurationSec: 10,
  cueWindowDurationSec: 5,
  brawlDurationSec: 6,
  penaltyDurationSec: 30,
  silenceDecayThresholdSec: 12,
  moodHalfLifeSec: 8,
  maxPossessionSec: 4.0,
  faceoffCountdownRealSec: 1.5,

  minShotDistance: 220,
  pushStrength: 40,
  puckFrictionPerSec: 0.6,
  boardRestitution: 0.6,
  shotBaseSpeed: 700,
  reboundSpeedRatio: 0.6,
  skaterRadius: 14,
  puckRadius: 5,
  creaseRadius: 34,

  strikerStaminaDrainPerSec: 0.004,
  strikerCollisionStaminaDrain: 0.02,
  goalieStaminaDrainPerSec: 0.0015,
  goalieSaveStaminaDrain: 0.04,
  penaltyBoxStaminaRecoveryPerSec: 0.01,
  brawlLoserStaminaHit: 0.10,

  moodRobbedAggression: 0.15,
  moodRobbedFocus: -0.05,
  moodStealFocus: 0.05,
  moodPushedAggression: 0.05,
  moodGoalScorerFocus: 0.10,
  moodGoalTeamAggression: 0.05,
  moodConcedeGoalieFocus: -0.15,
  moodConcedeTeamAggression: 0.10,
  moodSaveGoalieFocus: 0.10,
  moodLeaveBoxAggression: -0.10,

  chargeFocusBonus: 0.20,
  chargeAggressionBonus: 0.20,
  holdGoalieFocusBonus: 0.25,
  holdGoalieStaminaInstant: 0.10,
  holdStrikerFocusBonus: 0.20,
  holdStrikerAggressionDelta: -0.20,
  grudgeAggressionBonus: 0.30,
  grudgeFocusDelta: -0.20,

  initialCrowdVolume: 50,
  songBaseCrowdBoost: 5,
  cueHitCrowdBoost: 15,
  staleCrowdPenalty: -10,
  silenceCrowdDecayPerSec: 1.0,
  goalCrowdBoost: 10,
  fightCrowdBoost: 8,

  roster: [
    {
      id: 'home-s1',
      name: 'Sniper',
      number: 9,
      team: 'home',
      role: 'striker',
      focus: 0.70,
      aggression: 0.40,
    },
    {
      id: 'home-s2',
      name: 'Grinder',
      number: 24,
      team: 'home',
      role: 'striker',
      focus: 0.45,
      aggression: 0.65,
    },
    {
      id: 'home-g',
      name: 'Wall',
      number: 1,
      team: 'home',
      role: 'goalie',
      focus: 0.65,
      aggression: 0.20,
    },
    {
      id: 'away-s1',
      name: 'Hothead',
      number: 13,
      team: 'away',
      role: 'striker',
      focus: 0.40,
      aggression: 0.75,
    },
    {
      id: 'away-s2',
      name: 'Playmaker',
      number: 77,
      team: 'away',
      role: 'striker',
      focus: 0.65,
      aggression: 0.45,
    },
    {
      id: 'away-g',
      name: 'Brick',
      number: 30,
      team: 'away',
      role: 'goalie',
      focus: 0.60,
      aggression: 0.20,
    },
  ],
};

const STORAGE_KEY = 'organ_hero_config_v1';

export function cloneConfig(cfg: GameConfig = DEFAULT_CONFIG): GameConfig {
  return JSON.parse(JSON.stringify(cfg));
}

export function loadConfig(): GameConfig {
  try {
    if (typeof localStorage === 'undefined') return cloneConfig();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneConfig();
    const parsed = JSON.parse(raw);
    return {
      ...cloneConfig(),
      ...parsed,
      roster: Array.isArray(parsed.roster) ? parsed.roster : cloneConfig().roster,
    };
  } catch {
    return cloneConfig();
  }
}

export function saveConfig(cfg: GameConfig): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // ignore storage errors
  }
}

export function resetConfigStorage(): GameConfig {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore
  }
  return cloneConfig();
}
