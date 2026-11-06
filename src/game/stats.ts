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
  totalGoals: number;
  savesAndStealsDuringHold: number;
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
  };
  let cueHits = 0;
  let stalePlays = 0;

  let goalsDuringCharge = 0;
  let savesAndStealsDuringHold = 0;
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
        if (ev.songId) {
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
  if (totalGoals > 0) {
    impactLines.push(
      `${goalsDuringCharge} of ${totalGoals} goal(s) were scored under your Charge! Fanfare.`
    );
  } else {
    impactLines.push(`No goals scored yet — play Charge! on breakaways to boost accuracy.`);
  }

  if (savesAndStealsDuringHold > 0) {
    impactLines.push(
      `Hold the Line directly boosted ${savesAndStealsDuringHold} defensive save(s) & steal(s).`
    );
  } else {
    impactLines.push(
      `Hold the Line contributed 0 boosted saves/steals — tap it when shots or rebounds fly.`
    );
  }

  if (fights > 0) {
    impactLines.push(
      `Grudge Toccata sparked ${fightsDuringGrudge} of ${fights} brawl(s) on the ice.`
    );
  } else {
    impactLines.push(
      `0 brawls broke out — unleash Grudge Toccata when tempers flare after a collision.`
    );
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
    totalGoals,
    savesAndStealsDuringHold,
    fightsDuringGrudge,
    impactLines,
  };
}
