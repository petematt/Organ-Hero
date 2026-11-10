import { GameConfig } from '../config';
import { PlayerEntity, SongId, SongTarget, Team } from '../sim/types';

export interface SongDefinition {
  id: SongId;
  title: string;
  shortTitle: string;
  buttonTitle: string;
  shortDesc: string;
  keyHint: string;
  color: string;
  description: string;
  requiresPowerPlay?: boolean;
}

export const ALL_SONG_IDS: SongId[] = [
  'charge',
  'hold_the_line',
  'grudge_toccata',
  'power_play_polka',
  'kill_the_clock',
  'madeyalook',
  'underdog_draw',
  'second_wind',
  'tic_tac_toe',
  'the_fortress',
  'sirens_waltz',
  'overtime_overture',
];

export const SONGS: Record<SongId, SongDefinition> = {
  charge: {
    id: 'charge',
    title: 'CHARGE! FANFARE',
    shortTitle: 'Charge!',
    buttonTitle: 'CHARGE!',
    shortDesc: '+FOC +AGG (Offense)',
    keyHint: '1',
    color: '#f5b82e',
    description: 'Offense: +Focus & +Aggression for Possessing Team',
  },
  hold_the_line: {
    id: 'hold_the_line',
    title: 'HOLD THE LINE',
    shortTitle: 'Hold the Line',
    buttonTitle: 'HOLD THE LINE',
    shortDesc: '+DEF +GOALIE −AGG',
    keyHint: '2',
    color: '#2dd4bf',
    description: 'Defense/Goalie: +Focus, +Stamina, −Aggression for Defending Team',
  },
  grudge_toccata: {
    id: 'grudge_toccata',
    title: 'GRUDGE TOCCATA',
    shortTitle: 'Grudge Toccata',
    buttonTitle: 'GRUDGE TOCCATA',
    shortDesc: '++AGG −FOC (Brawl)',
    keyHint: '3',
    color: '#f43f5e',
    description: 'Chaos Brawl: ++Aggression, −Focus for BOTH Teams',
  },
  power_play_polka: {
    id: 'power_play_polka',
    title: 'POWER PLAY POLKA',
    shortTitle: 'Power Play Polka',
    buttonTitle: 'POWER PLAY POLKA',
    shortDesc: '++FOC ++AGG (PP Only)',
    keyHint: '4',
    color: '#a855f7',
    description: 'Power Play Offense: ++Focus & ++Aggression for Power Play Team (Power Play Only)',
    requiresPowerPlay: true,
  },
  kill_the_clock: {
    id: 'kill_the_clock',
    title: 'KILL THE CLOCK',
    shortTitle: 'Kill the Clock',
    buttonTitle: 'KILL THE CLOCK',
    shortDesc: '++PK DEF +GOALIE (PP Only)',
    keyHint: '5',
    color: '#38bdf8',
    description: 'Penalty Kill: ++Focus, +Stamina & −Aggression for Shorthanded Team (Power Play Only)',
    requiresPowerPlay: true,
  },
  madeyalook: {
    id: 'madeyalook',
    title: 'MADEYALOOK',
    shortTitle: 'Madeyalook',
    buttonTitle: 'MADEYALOOK',
    shortDesc: '−GOALIE FOCUS (Taunt)',
    keyHint: '6',
    color: '#84cc16',
    description: 'Goalie Distraction: −Focus for Defending Goalie (More Likely to Miss Shots)',
  },
  underdog_draw: {
    id: 'underdog_draw',
    title: 'UNDERDOG DRAW',
    shortTitle: 'Underdog Draw',
    buttonTitle: 'UNDERDOG',
    shortDesc: '+FACEOFF WIN',
    keyHint: '7',
    color: '#ea580c',
    description: 'Faceoff: Tilts puck drop draw chance toward the trailing or tied team.',
  },
  second_wind: {
    id: 'second_wind',
    title: 'SECOND WIND',
    shortTitle: 'Second Wind',
    buttonTitle: '2ND WIND',
    shortDesc: '+40% STAMINA REGEN',
    keyHint: '8',
    color: '#10b981',
    description: 'Oxygen Surge: Restores 40% stamina for active skaters and bench.',
  },
  tic_tac_toe: {
    id: 'tic_tac_toe',
    title: 'TIC-TAC-TOE POLKA',
    shortTitle: 'Tic-Tac-Toe',
    buttonTitle: 'TIC-TAC-TOE',
    shortDesc: '++PASS ACC & 1-TIMER',
    keyHint: '9',
    color: '#3b82f6',
    description: 'Passing: Boosts pass tendency and triggers rocket one-timer releases.',
  },
  the_fortress: {
    id: 'the_fortress',
    title: 'THE FORTRESS (GLOVE LOCK)',
    shortTitle: 'The Fortress',
    buttonTitle: 'FORTRESS',
    shortDesc: '100% GLOVE CATCH',
    keyHint: '0',
    color: '#6366f1',
    description: 'Rebound Lockdown: Goalie catches incoming shot cleanly with zero rebound spill.',
  },
  sirens_waltz: {
    id: 'sirens_waltz',
    title: "THE SIREN'S WALTZ",
    shortTitle: "Siren's Waltz",
    buttonTitle: "SIREN'S WALTZ",
    shortDesc: 'CARRIER PANIC / OWN GOAL',
    keyHint: '-',
    color: '#ec4899',
    description: 'Disorientation: Bewitches carrier to turn 180° and shoot an own goal!',
  },
  overtime_overture: {
    id: 'overtime_overture',
    title: 'OVERTIME OVERTURE',
    shortTitle: 'Overtime',
    buttonTitle: 'OVERTIME',
    shortDesc: 'CLUTCH SURGE (+35% LATE)',
    keyHint: '=',
    color: '#e11d48',
    description: 'Buzzer Drama: Constant speed boost that surges +35% in final 30 seconds.',
  },
};

export function getSongTooltip(
  songId: SongId,
  masteryLevel: 'UNKNOWN' | 'FAMILIAR' | 'MASTERED'
): string {
  const base = SONGS[songId];
  if (masteryLevel === 'UNKNOWN') {
    switch (songId) {
      case 'charge':
        return 'Seems to make players skate faster and chase loose pucks with more pep.';
      case 'hold_the_line':
        return 'The goalie seems more alert and defenders stay closer to the net.';
      case 'grudge_toccata':
        return 'The crowd gets rowdy and tempers boil over quickly.';
      case 'power_play_polka':
        return 'Lively march that gets forwards buzzing when they have a skater advantage.';
      case 'kill_the_clock':
        return 'A defensive hymn that helps shorthanded players survive penalties.';
      case 'madeyalook':
        return 'A mocking melody that appears to distract the opposing netminder.';
      case 'underdog_draw':
        return 'A spirited rally song rumored to help underdogs win faceoff drops.';
      case 'second_wind':
        return 'A refreshing waltz that helps exhausted skaters catch their breath.';
      case 'tic_tac_toe':
        return 'Rhythmic cadence that encourages players to share the puck.';
      case 'the_fortress':
        return 'Stately anthem that inspires goalies to snag pucks cleanly in their glove.';
      case 'sirens_waltz':
        return 'An eerie, hypnotic waltz that causes opposing puck carriers to hesitate.';
      case 'overtime_overture':
        return 'An intense countdown overture that quickens pulses as time runs down.';
    }
  }

  if (masteryLevel === 'FAMILIAR') {
    return `${base.title}: ${base.description} (2x multiplier when played on active cue).`;
  }

  // Mastered
  switch (songId) {
    case 'charge':
      return 'MASTERED: +28% Focus, +20% Aggression. On-cue: 2x skate speed & shot accuracy.';
    case 'hold_the_line':
      return 'MASTERED: +30% Goalie Focus, +15% Stamina, -20% Striker Aggression. On-cue: 2x save chance.';
    case 'grudge_toccata':
      return 'MASTERED: +30% Aggression, -20% Focus. On-cue: 100% brawl trigger within 2 seconds.';
    case 'power_play_polka':
      return 'MASTERED: +35% Focus & +25% Aggression during Power Play. On-cue: 2x one-timer release speed.';
    case 'kill_the_clock':
      return 'MASTERED: +35% Goalie Focus & +20% Stamina on PK. On-cue: clears puck down full ice.';
    case 'madeyalook':
      return 'MASTERED: -35% Opposing Goalie Focus. On-cue: cuts block chance in half.';
    case 'underdog_draw':
      return 'MASTERED: +50% Faceoff win chance for underdog. On-cue: guaranteed faceoff possession.';
    case 'second_wind':
      return 'MASTERED: +40% Instant stamina restoration across all active skaters and bench.';
    case 'tic_tac_toe':
      return 'MASTERED: +35% Pass Tendency, +30% Pass Accuracy, +40% One-Timer Rocket Speed.';
    case 'the_fortress':
      return 'MASTERED: 100% Critical Glove Catch on next shot. Completely eliminates rebounds.';
    case 'sirens_waltz':
      return 'MASTERED: -50% Carrier Focus. Critical Bewitchment: turns 180° to shoot on own net!';
    case 'overtime_overture':
      return 'MASTERED: Constant +12% Speed/Focus. Final 30s: Massive +35% Speed & Aggression surge!';
  }
}

export function oppositeTeam(team: Team): Team {
  return team === 'home' ? 'away' : 'home';
}

export interface PowerPlayState {
  isPowerPlay: boolean;
  powerPlayTeam: Team | null;
  penaltyKillTeam: Team | null;
}

/**
 * Determines if a Power Play is currently active on the ice.
 * A Power Play exists when one team has more strikers in PENALTY_BOX than the other.
 */
export function getPowerPlayState(
  players: Pick<PlayerEntity, 'team' | 'role' | 'mode'>[] = []
): PowerPlayState {
  let homePenalized = 0;
  let awayPenalized = 0;

  for (const p of players) {
    if (p.role === 'striker' && p.mode === 'PENALTY_BOX') {
      if (p.team === 'home') homePenalized++;
      else awayPenalized++;
    }
  }

  if (awayPenalized > homePenalized) {
    return {
      isPowerPlay: true,
      powerPlayTeam: 'home',
      penaltyKillTeam: 'away',
    };
  }
  if (homePenalized > awayPenalized) {
    return {
      isPowerPlay: true,
      powerPlayTeam: 'away',
      penaltyKillTeam: 'home',
    };
  }

  return {
    isPowerPlay: false,
    powerPlayTeam: null,
    penaltyKillTeam: null,
  };
}

/**
 * Returns whether a song is currently valid to apply its effects on the ice.
 * Power Play songs (Power Play Polka & Kill the Clock) are only valid during power plays.
 */
export function isSongValidOnIce(
  songId: SongId,
  players: Pick<PlayerEntity, 'team' | 'role' | 'mode'>[] = []
): boolean {
  if (SONGS[songId].requiresPowerPlay) {
    return getPowerPlayState(players).isPowerPlay;
  }
  return true;
}

/**
 * Resolves which team a song targets at the moment it is tapped.
 * - If a team currently possesses the puck, that team is the reference possessor.
 * - If the puck is loose, the last team that possessed it is the reference possessor
 *   (falling back to 'home' at the opening drop if nobody has touched it yet).
 * - Charge! targets the reference possessor.
 * - Hold the Line and Madeyalook target the opposite (defending) team.
 * - Grudge Toccata targets 'both'.
 * - Power Play Polka targets the team on the Power Play (or reference possessor if no PP).
 * - Kill the Clock targets the team on the Penalty Kill (or defending team if no PP).
 */
export function resolveSongTarget(
  songId: SongId,
  currentPossessor: Team | null,
  lastPossessor: Team | null,
  players: Pick<PlayerEntity, 'team' | 'role' | 'mode'>[] = []
): SongTarget {
  if (songId === 'grudge_toccata' || songId === 'overtime_overture') {
    return 'both';
  }
  const effectivePossessor: Team = currentPossessor ?? lastPossessor ?? 'home';

  if (songId === 'power_play_polka') {
    const pp = getPowerPlayState(players);
    return pp.powerPlayTeam ?? effectivePossessor;
  }

  if (songId === 'kill_the_clock') {
    const pp = getPowerPlayState(players);
    return pp.penaltyKillTeam ?? oppositeTeam(effectivePossessor);
  }

  if (
    songId === 'charge' ||
    songId === 'underdog_draw' ||
    songId === 'second_wind' ||
    songId === 'tic_tac_toe'
  ) {
    return effectivePossessor;
  }

  // hold_the_line, madeyalook, the_fortress, sirens_waltz target the defending team
  return oppositeTeam(effectivePossessor);
}

export function doesSongAffectTeam(target: SongTarget, team: Team): boolean {
  return target === 'both' || target === team;
}

/**
 * Computes the stat modifiers (focusDelta, aggressionDelta) applied to a player
 * while a song is active.
 */
export function getSongStatModifiers(
  songId: SongId,
  target: SongTarget,
  multiplier: number,
  playerTeam: Team,
  playerRole: 'striker' | 'goalie',
  cfg: GameConfig,
  players: Pick<PlayerEntity, 'team' | 'role' | 'mode'>[] = []
): { focusDelta: number; aggressionDelta: number } {
  if (!doesSongAffectTeam(target, playerTeam)) {
    return { focusDelta: 0, aggressionDelta: 0 };
  }

  if (songId === 'charge') {
    if (playerRole === 'striker') {
      return {
        focusDelta: cfg.chargeFocusBonus * multiplier,
        aggressionDelta: cfg.chargeAggressionBonus * multiplier,
      };
    }
    return { focusDelta: 0, aggressionDelta: 0 };
  }

  if (songId === 'hold_the_line') {
    if (playerRole === 'goalie') {
      return {
        focusDelta: cfg.holdGoalieFocusBonus * multiplier,
        aggressionDelta: 0,
      };
    }
    return {
      focusDelta: cfg.holdStrikerFocusBonus * multiplier,
      aggressionDelta: cfg.holdStrikerAggressionDelta * multiplier,
    };
  }

  if (songId === 'grudge_toccata') {
    if (playerRole === 'striker') {
      return {
        focusDelta: cfg.grudgeFocusDelta * multiplier,
        aggressionDelta: cfg.grudgeAggressionBonus * multiplier,
      };
    }
    return { focusDelta: 0, aggressionDelta: 0 };
  }

  if (songId === 'power_play_polka') {
    const pp = getPowerPlayState(players);
    if (!pp.isPowerPlay || pp.powerPlayTeam !== playerTeam) {
      return { focusDelta: 0, aggressionDelta: 0 };
    }
    if (playerRole === 'striker') {
      return {
        focusDelta: cfg.polkaFocusBonus * multiplier,
        aggressionDelta: cfg.polkaAggressionBonus * multiplier,
      };
    }
    return { focusDelta: 0, aggressionDelta: 0 };
  }

  if (songId === 'kill_the_clock') {
    const pp = getPowerPlayState(players);
    if (!pp.isPowerPlay || pp.penaltyKillTeam !== playerTeam) {
      return { focusDelta: 0, aggressionDelta: 0 };
    }
    if (playerRole === 'goalie') {
      return {
        focusDelta: cfg.killClockGoalieFocusBonus * multiplier,
        aggressionDelta: 0,
      };
    }
    return {
      focusDelta: cfg.killClockStrikerFocusBonus * multiplier,
      aggressionDelta: cfg.killClockStrikerAggressionDelta * multiplier,
    };
  }

  if (songId === 'madeyalook') {
    if (playerRole === 'goalie') {
      return {
        focusDelta: cfg.madeyalookGoalieFocusDelta * multiplier,
        aggressionDelta: 0,
      };
    }
    return { focusDelta: 0, aggressionDelta: 0 };
  }

  if (songId === 'underdog_draw') {
    return {
      focusDelta: 0.25 * multiplier,
      aggressionDelta: 0.15 * multiplier,
    };
  }

  if (songId === 'second_wind') {
    return {
      focusDelta: 0.20 * multiplier,
      aggressionDelta: 0.10 * multiplier,
    };
  }

  if (songId === 'tic_tac_toe') {
    if (playerRole === 'striker') {
      return {
        focusDelta: 0.35 * multiplier,
        aggressionDelta: -0.15 * multiplier,
      };
    }
    return { focusDelta: 0, aggressionDelta: 0 };
  }

  if (songId === 'the_fortress') {
    if (playerRole === 'goalie') {
      return {
        focusDelta: 0.40 * multiplier,
        aggressionDelta: 0,
      };
    }
    return { focusDelta: 0, aggressionDelta: 0 };
  }

  if (songId === 'sirens_waltz') {
    return {
      focusDelta: -0.45 * multiplier,
      aggressionDelta: -0.20 * multiplier,
    };
  }

  if (songId === 'overtime_overture') {
    return {
      focusDelta: 0.25 * multiplier,
      aggressionDelta: 0.30 * multiplier,
    };
  }

  return { focusDelta: 0, aggressionDelta: 0 };
}

