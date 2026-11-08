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
  const totalOrganGoals = goalsDuringCharge + goalsDuringPolka + goalsDuringMadeyalook;
  if (totalGoals > 0) {
    if (goalsDuringPolka > 0 || goalsDuringMadeyalook > 0) {
      impactLines.push(
        `${totalOrganGoals} of ${totalGoals} goal(s) scored under Organ buffs (Charge: ${goalsDuringCharge}, Polka: ${goalsDuringPolka}, Madeyalook: ${goalsDuringMadeyalook}).`
      );
    } else {
      impactLines.push(
        `${goalsDuringCharge} of ${totalGoals} goal(s) were scored under your Charge! Fanfare.`
      );
    }
  } else {
    impactLines.push(`No goals scored yet — play Charge!, Polka, or Madeyalook to boost scoring.`);
  }

  const totalOrganDef = savesAndStealsDuringHold + savesAndStealsDuringKillClock;
  if (totalOrganDef > 0) {
    if (savesAndStealsDuringKillClock > 0) {
      impactLines.push(
        `Organ defense boosted ${totalOrganDef} save(s) & steal(s) (Hold: ${savesAndStealsDuringHold}, Kill Clock: ${savesAndStealsDuringKillClock}).`
      );
    } else {
      impactLines.push(
        `Hold the Line directly boosted ${savesAndStealsDuringHold} defensive save(s) & steal(s).`
      );
    }
  } else {
    impactLines.push(
      `Hold the Line / Kill the Clock contributed 0 boosted saves/steals — tap when shots fly.`
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
    goalsDuringPolka,
    goalsDuringMadeyalook,
    totalGoals,
    savesAndStealsDuringHold,
    savesAndStealsDuringKillClock,
    fightsDuringGrudge,
    impactLines,
  };
}

