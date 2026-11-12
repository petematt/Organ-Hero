export type Team = 'home' | 'away';
export type SongId =
  | 'charge'
  | 'hold_the_line'
  | 'grudge_toccata'
  | 'power_play_polka'
  | 'kill_the_clock'
  | 'madeyalook'
  | 'underdog_draw'
  | 'second_wind'
  | 'tic_tac_toe'
  | 'the_fortress'
  | 'sirens_waltz'
  | 'overtime_overture';
export type SongTarget = 'home' | 'away' | 'both';

export type SkaterMode =
  | 'DEFENDING'
  | 'POSSESSING'
  | 'HOLDING_PUCK'
  | 'STUNNED'
  | 'FIGHTING'
  | 'PENALTY_BOX';

export type CueType =
  | 'BREAKAWAY'
  | 'SHOT_OR_REBOUND'
  | 'TEMPER_FLARING'
  | 'POWER_PLAY'
  | 'PENALTY_KILL'
  | 'GOALIE_TAUNT'
  | 'FACEOFF_DRAW'
  | 'EXHAUSTION'
  | 'OPEN_PASS_LANE'
  | 'DANGER_SLOT_SHOT'
  | 'CARRIER_TRAPPED'
  | 'FINAL_30_SECONDS'
  | 'RIVAL_ORGANIST_ATTACK';

export interface Vec2 {
  x: number;
  y: number;
}

export interface BezierPath {
  p0: Vec2;
  p1: Vec2;
  p2: Vec2;
}

export interface PlayerEntity {
  id: string;
  name: string;
  number: number;
  team: Team;
  role: 'striker' | 'goalie';

  // Position & velocity
  pos: Vec2;
  vel: Vec2;
  homeSpot: Vec2;

  // Baseline stats
  baseFocus: number;
  baseAggression: number;

  // Dynamic mood offsets (drift toward 0)
  moodFocusOffset: number;
  moodAggressionOffset: number;

  // Current stamina [0, 1]
  stamina: number;

  // Effective stats [0, 1] (computed each tick from baseline + moodOffset + activeSong)
  focus: number;
  aggression: number;

  // State machine
  mode: SkaterMode;
  stateTimer: number; // used for STUNNED, FIGHTING, PENALTY_BOX, HOLDING_PUCK
  possessionTimer: number;
  passCheckTimer: number;
  fightPartnerId: string | null;
  isFightInstigator: boolean;
  fightPunchCooldown?: number;
  collisionCooldown: number;
  attackPath: BezierPath | null;
  penaltyTravelPath?: BezierPath | null;
  penaltyTravelProg?: number;
  penaltyTravelDurationSec?: number;

  // Visual reaction timer on song tap
  reactionTimer: number;
  reactionColor: string;
}

export interface PuckState {
  pos: Vec2;
  vel: Vec2;
  carrierId: string | null;
  inFlightShotFrom: Team | null;
  isScoringShot: boolean;
  shotStartPos: Vec2 | null;
  shooterAccuracy: number;
  shooterId: string | null;
  inFlightPassToId: string | null;
  inFlightPassFromId: string | null;
  trail: Vec2[];
}

export interface ActiveSongState {
  songId: SongId;
  target: SongTarget;
  remainingSec: number;
  durationSec: number;
  multiplier: number; // 1.0 normal, 2.0 cueHit, 0.5 stale (or combined)
  cueHit: boolean;
  stale: boolean;
}

export interface ActiveCueState {
  type: CueType;
  matchingSong: SongId;
  recommendedTarget: SongTarget;
  bannerText: string;
  remainingSec: number;
}

export interface CalloutBadge {
  id: number;
  text: string;
  pos: Vec2;
  color: string;
  remainingSec: number;
  totalSec: number;
}

export type MatchEventType =
  | 'GOAL'
  | 'SHOT'
  | 'SAVE'
  | 'PASS'
  | 'CLEAR'
  | 'STEAL'
  | 'FIGHT'
  | 'PENALTY'
  | 'SONG_PLAYED'
  | 'POST_HIT';

export interface MatchEvent {
  type: MatchEventType;
  period: number;
  timeRemainingSec: number;
  team?: Team;
  playerId?: string;
  targetPlayerId?: string;
  isCritSave?: boolean;
  postPos?: Vec2;
  activeSongId: SongId | null;
  activeSongTarget: SongTarget | null;
  songId?: SongId;
  cueHit?: boolean;
  stale?: boolean;
}

export type MatchPhase =
  | 'FACEOFF_COUNTDOWN'
  | 'PLAYING'
  | 'GOAL_CELEBRATION'
  | 'PERIOD_END'
  | 'MATCH_OVER';

export type OrderId =
  | 'home_wins'
  | 'blood_on_ice'
  | 'clean_sheet'
  | 'blowout'
  | 'bring_the_noise';
