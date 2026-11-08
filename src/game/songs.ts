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
];

export const SONGS: Record<SongId, SongDefinition> = {
  charge: {
    id: 'charge',
    title: 'CHARGE! FANFARE',
    shortTitle: 'Charge!',
    buttonTitle: '♪ CHARGE!',
    shortDesc: '+FOC +AGG (Offense)',
    keyHint: '1',
    color: '#f5b82e',
    description: 'Offense: +Focus & +Aggression for Possessing Team',
  },
  hold_the_line: {
    id: 'hold_the_line',
    title: 'HOLD THE LINE',
    shortTitle: 'Hold the Line',
    buttonTitle: '♫ HOLD THE LINE',
    shortDesc: '+DEF +GOALIE −AGG',
    keyHint: '2',
    color: '#2dd4bf',
    description: 'Defense/Goalie: +Focus, +Stamina, −Aggression for Defending Team',
  },
  grudge_toccata: {
    id: 'grudge_toccata',
    title: 'GRUDGE TOCCATA',
    shortTitle: 'Grudge Toccata',
    buttonTitle: '♬ GRUDGE TOCCATA',
    shortDesc: '++AGG −FOC (Brawl)',
    keyHint: '3',
    color: '#f43f5e',
    description: 'Chaos Brawl: ++Aggression, −Focus for BOTH Teams',
  },
  power_play_polka: {
    id: 'power_play_polka',
    title: 'POWER PLAY POLKA',
    shortTitle: 'Power Play Polka',
    buttonTitle: '🪗 POWER PLAY POLKA',
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
    buttonTitle: '⏱ KILL THE CLOCK',
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
    buttonTitle: '👀 MADEYALOOK',
    shortDesc: '−GOALIE FOCUS (Taunt)',
    keyHint: '6',
    color: '#84cc16',
    description: 'Goalie Distraction: −Focus for Defending Goalie (More Likely to Miss Shots)',
  },
};

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
  if (songId === 'grudge_toccata') {
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

  if (songId === 'charge') {
    return effectivePossessor;
  }

  // hold_the_line and madeyalook target the defending team
  return oppositeTeam(effectivePossessor);
}

export function doesSongAffectTeam(target: SongTarget, team: Team): boolean {
  return target === 'both' || target === team;
}

/**
 * Computes the stat modifiers (focusDelta, aggressionDelta) applied to a player
 * while a song is active.
 * Note: Power play song effects (Power Play Polka & Kill the Clock) are ONLY valid
 * while an active power play exists on the ice for that team.
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

  return { focusDelta: 0, aggressionDelta: 0 };
}

