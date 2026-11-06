import { GameConfig } from '../config';
import { SongId, SongTarget, Team } from '../sim/types';

export interface SongDefinition {
  id: SongId;
  title: string;
  shortTitle: string;
  keyHint: string;
  color: string;
  description: string;
}

export const SONGS: Record<SongId, SongDefinition> = {
  charge: {
    id: 'charge',
    title: 'CHARGE! FANFARE',
    shortTitle: 'Charge!',
    keyHint: '1',
    color: '#f5b82e',
    description: 'Offense: +Focus & +Aggression for Possessing Team',
  },
  hold_the_line: {
    id: 'hold_the_line',
    title: 'HOLD THE LINE',
    shortTitle: 'Hold the Line',
    keyHint: '2',
    color: '#2dd4bf',
    description: 'Defense/Goalie: +Focus, +Stamina, −Aggression for Defending Team',
  },
  grudge_toccata: {
    id: 'grudge_toccata',
    title: 'GRUDGE TOCCATA',
    shortTitle: 'Grudge Toccata',
    keyHint: '3',
    color: '#f43f5e',
    description: 'Chaos Brawl: ++Aggression, −Focus for BOTH Teams',
  },
};

export function oppositeTeam(team: Team): Team {
  return team === 'home' ? 'away' : 'home';
}

/**
 * Resolves which team a song targets at the moment it is tapped.
 * - If a team currently possesses the puck, that team is the reference possessor.
 * - If the puck is loose, the last team that possessed it is the reference possessor
 *   (falling back to 'home' at the opening drop if nobody has touched it yet).
 * - Charge! targets the reference possessor.
 * - Hold the Line targets the opposite (defending) team.
 * - Grudge Toccata targets 'both'.
 */
export function resolveSongTarget(
  songId: SongId,
  currentPossessor: Team | null,
  lastPossessor: Team | null
): SongTarget {
  if (songId === 'grudge_toccata') {
    return 'both';
  }
  const effectivePossessor: Team = currentPossessor ?? lastPossessor ?? 'home';
  if (songId === 'charge') {
    return effectivePossessor;
  }
  // hold_the_line targets the defending team
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
  cfg: GameConfig
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

  // grudge_toccata
  if (playerRole === 'striker') {
    return {
      focusDelta: cfg.grudgeFocusDelta * multiplier,
      aggressionDelta: cfg.grudgeAggressionBonus * multiplier,
    };
  }

  return { focusDelta: 0, aggressionDelta: 0 };
}
