import { doesSongAffectTeam } from './songs';
import { MatchEvent, SongId } from '../sim/types';

export interface PeriodStatsSummary {
  period: number;
  homeGoals: number;
  awayGoals: number;
  homeShots: number;
  awayShots: number;
  homeSaves: number;
  awaySaves: number;
  fights: number;
  penaltyMinutes: number;
  songsPlayed: Record<SongId, number>;
  cueHits: number;
  stalePlays: number;
  avgCrowdVolume: number;
  crowdSparkline: number[];

  // Song impact attribution
  goalsDuringCharge: number;
  goalsDuringPolka: number;
  goalsDuringMadeyalook: number;
  totalGoals: number;
  savesAndStealsDuringHold: number;
  savesAndStealsDuringKillClock: number;
  fightsDuringGrudge: number;
  impactLines: string[];
}

export function buildStatsSummary(
  events: MatchEvent[],
  crowdSamples: { period: number; volume: number }[],
  periodFilter?: number
): PeriodStatsSummary {
  const filteredEvents =
    periodFilter !== undefined
      ? events.filter((e) => e.period === periodFilter)
      : events;

  const filteredCrowd =
    periodFilter !== undefined
      ? crowdSamples.filter((c) => c.period === periodFilter)
      : crowdSamples;

  let homeGoals = 0;
  let awayGoals = 0;
  let homeShots = 0;
  let awayShots = 0;
  let homeSaves = 0;
  let awaySaves = 0;
  let fights = 0;
  let penaltyMinutes = 0;
  const songsPlayed: Record<SongId, number> = {
    charge: 0,
    hold_the_line: 0,
    grudge_toccata: 0,
    power_play_polka: 0,
    kill_the_clock: 0,
    madeyalook: 0,
    underdog_draw: 0,
    second_wind: 0,
    tic_tac_toe: 0,
    the_fortress: 0,
    sirens_waltz: 0,
    overtime_overture: 0,
  };
  let cueHits = 0;
  let stalePlays = 0;

  let goalsDuringCharge = 0;
  let goalsDuringPolka = 0;
  let goalsDuringMadeyalook = 0;
  let savesAndStealsDuringHold = 0;
  let savesAndStealsDuringKillClock = 0;
  let fightsDuringGrudge = 0;

  for (const ev of filteredEvents) {
    switch (ev.type) {
      case 'GOAL':
        if (ev.team === 'home') homeGoals++;
        if (ev.team === 'away') awayGoals++;
        if (
          ev.activeSongId === 'charge' &&
          ev.team &&
          ev.activeSongTarget &&
          doesSongAffectTeam(ev.activeSongTarget, ev.team)
        ) {
          goalsDuringCharge++;
        } else if (
          ev.activeSongId === 'power_play_polka' &&
          ev.team &&
          ev.activeSongTarget &&
          doesSongAffectTeam(ev.activeSongTarget, ev.team)
        ) {
          goalsDuringPolka++;
        } else if (
          ev.activeSongId === 'madeyalook' &&
          ev.team &&
          ev.activeSongTarget &&
          !doesSongAffectTeam(ev.activeSongTarget, ev.team)
        ) {
          goalsDuringMadeyalook++;
        }
        break;
      case 'SHOT':
        if (ev.team === 'home') homeShots++;
        if (ev.team === 'away') awayShots++;
        break;
      case 'SAVE':
        if (ev.team === 'home') homeSaves++;
        if (ev.team === 'away') awaySaves++;
        if (
          ev.activeSongId === 'hold_the_line' &&
          ev.team &&
          ev.activeSongTarget &&
          doesSongAffectTeam(ev.activeSongTarget, ev.team)
        ) {
          savesAndStealsDuringHold++;
        } else if (
          ev.activeSongId === 'kill_the_clock' &&
          ev.team &&
          ev.activeSongTarget &&
          doesSongAffectTeam(ev.activeSongTarget, ev.team)
        ) {
          savesAndStealsDuringKillClock++;
        }
        break;
      case 'STEAL':
        if (
          ev.activeSongId === 'hold_the_line' &&
          ev.team &&
          ev.activeSongTarget &&
          doesSongAffectTeam(ev.activeSongTarget, ev.team)
        ) {
          savesAndStealsDuringHold++;
        } else if (
          ev.activeSongId === 'kill_the_clock' &&
          ev.team &&
          ev.activeSongTarget &&
          doesSongAffectTeam(ev.activeSongTarget, ev.team)
        ) {
          savesAndStealsDuringKillClock++;
        }
        break;
      case 'FIGHT':
        fights++;
        if (ev.activeSongId === 'grudge_toccata') {
          fightsDuringGrudge++;
        }
        break;
      case 'PENALTY':
        penaltyMinutes += 2; // 2 minor-penalty minutes per penalty box trip (30s sim clock)
        break;
      case 'SONG_PLAYED':
        if (ev.songId && songsPlayed[ev.songId] !== undefined) {
          songsPlayed[ev.songId]++;
        }
        if (ev.cueHit) cueHits++;
        if (ev.stale) stalePlays++;
        break;
    }
  }

  const totalGoals = homeGoals + awayGoals;
  const sparkline = filteredCrowd.map((c) => c.volume);
  const avgCrowdVolume =
    sparkline.length > 0
      ? sparkline.reduce((acc, v) => acc + v, 0) / sparkline.length
      : 50;

  const impactLines: string[] = [];

  // 1. Scoring songs (only if played)
  if (songsPlayed['charge'] > 0) {
    if (goalsDuringCharge > 0) {
      impactLines.push(
        `Charge! Fanfare boosted ${goalsDuringCharge} of ${totalGoals} goal(s) (${songsPlayed['charge']} play(s)).`
      );
    } else {
      impactLines.push(
        `Charge! Fanfare played ${songsPlayed['charge']} time(s) with 0 goals scored.`
      );
    }
  }
  if (songsPlayed['power_play_polka'] > 0) {
    if (goalsDuringPolka > 0) {
      impactLines.push(
        `Power Play Polka boosted ${goalsDuringPolka} goal(s) (${songsPlayed['power_play_polka']} play(s)).`
      );
    } else {
      impactLines.push(
        `Power Play Polka played ${songsPlayed['power_play_polka']} time(s) (0 power play goals).`
      );
    }
  }
  if (songsPlayed['madeyalook'] > 0) {
    if (goalsDuringMadeyalook > 0) {
      impactLines.push(
        `Madeyalook distraction created ${goalsDuringMadeyalook} goal(s) (${songsPlayed['madeyalook']} play(s)).`
      );
    } else {
      impactLines.push(
        `Madeyalook played ${songsPlayed['madeyalook']} time(s) with 0 goals resulting.`
      );
    }
  }

  // 2. Defensive songs (only if played)
  if (songsPlayed['hold_the_line'] > 0) {
    if (savesAndStealsDuringHold > 0) {
      impactLines.push(
        `Hold the Line directly boosted ${savesAndStealsDuringHold} defensive save(s) & steal(s).`
      );
    } else {
      impactLines.push(
        `Hold the Line played ${songsPlayed['hold_the_line']} time(s) (0 saves/steals during buff).`
      );
    }
  }
  if (songsPlayed['kill_the_clock'] > 0) {
    if (savesAndStealsDuringKillClock > 0) {
      impactLines.push(
        `Kill the Clock aided ${savesAndStealsDuringKillClock} shorthanded save(s) & steal(s).`
      );
    } else {
      impactLines.push(
        `Kill the Clock played ${songsPlayed['kill_the_clock']} time(s) (0 shorthanded stops).`
      );
    }
  }

  // 3. Brawl / Agitation song (only if played)
  if (songsPlayed['grudge_toccata'] > 0) {
    if (fightsDuringGrudge > 0) {
      impactLines.push(
        `Grudge Toccata sparked ${fightsDuringGrudge} of ${fights} brawl(s) on the ice.`
      );
    } else {
      impactLines.push(
        `Grudge Toccata played ${songsPlayed['grudge_toccata']} time(s) with 0 brawls ignited.`
      );
    }
  }

  // 4. Other campaign songs (only if played)
  if (songsPlayed['underdog_draw'] > 0) {
    impactLines.push(
      `Underdog Draw played ${songsPlayed['underdog_draw']} time(s) swinging faceoff win odds.`
    );
  }
  if (songsPlayed['second_wind'] > 0) {
    impactLines.push(
      `Second Wind played ${songsPlayed['second_wind']} time(s) reviving bench skater stamina.`
    );
  }
  if (songsPlayed['tic_tac_toe'] > 0) {
    impactLines.push(
      `Tic-Tac-Toe played ${songsPlayed['tic_tac_toe']} time(s) sharpening passing speed & precision.`
    );
  }
  if (songsPlayed['the_fortress'] > 0) {
    impactLines.push(
      `The Fortress played ${songsPlayed['the_fortress']} time(s) bolstering clutch goaltending saves.`
    );
  }
  if (songsPlayed['sirens_waltz'] > 0) {
    impactLines.push(
      `The Siren's Waltz played ${songsPlayed['sirens_waltz']} time(s) mesmerizing opponent puck carriers.`
    );
  }
  if (songsPlayed['overtime_overture'] > 0) {
    impactLines.push(
      `Overtime Overture played ${songsPlayed['overtime_overture']} time(s) surging late-game skating tempo.`
    );
  }

  if (impactLines.length === 0) {
    impactLines.push('No organ songs were played this period.');
  }

  return {
    period: periodFilter ?? 0,
    homeGoals,
    awayGoals,
    homeShots,
    awayShots,
    homeSaves,
    awaySaves,
    fights,
    penaltyMinutes,
    songsPlayed,
    cueHits,
    stalePlays,
    avgCrowdVolume,
    crowdSparkline: sparkline,
    goalsDuringCharge,
    goalsDuringPolka,
    goalsDuringMadeyalook,
    totalGoals,
    savesAndStealsDuringHold,
    savesAndStealsDuringKillClock,
    fightsDuringGrudge,
    impactLines,
  };
}

