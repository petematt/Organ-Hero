import { MatchEvent, PlayerEntity, Team } from '../sim/types';

export type TipScope = 'PERIOD_2' | 'PERIOD_3' | 'FULL_MATCH';
export type TipStatus = 'OFFERED' | 'ACCEPTED' | 'DECLINED' | 'PASSED' | 'FAILED';

export interface TipConditionContext {
  period: number;
  homeScore: number;
  awayScore: number;
  events: MatchEvent[];
  players: PlayerEntity[];
  isMatchOver: boolean;
  /** True while the game is sitting at a period-end intermission. */
  isPeriodEnd?: boolean;
}

export interface TipOffer {
  id: string;
  senderName: string;
  senderTitle: string;
  flavorText: string;
  bribePayout: number;
  unofficialRepDelta: number;
  conditionDescription: string;
  scope: TipScope;
  status: TipStatus;
  evaluatorId: string;
  liveProgressText: string;
  conflictsWithOfficial: boolean;
  acceptedAtPeriod?: number;
  /** Subject team for team-specific tips (e.g. Point Shaving). */
  targetTeam?: Team;
  /** Period a period-scoped tip applies to (e.g. Dead Puck Period). */
  targetPeriod?: 2 | 3;
}

export function evaluateTip(
  tip: TipOffer,
  ctx: TipConditionContext
): { status: TipStatus; progressText: string; passed: boolean } {
  if (tip.status !== 'ACCEPTED') {
    return { status: tip.status, progressText: tip.liveProgressText, passed: false };
  }

  const { homeScore, awayScore, events, players, isMatchOver, period } = ctx;

  switch (tip.evaluatorId) {
    case 'hat_trick': {
      // 3 consecutive unanswered goals by the same team
      const goalEvents = events.filter((e) => e.type === 'GOAL');
      let maxConsecutiveHome = 0;
      let maxConsecutiveAway = 0;
      let curHome = 0;
      let curAway = 0;

      for (const g of goalEvents) {
        if (g.team === 'home') {
          curHome++;
          curAway = 0;
        } else if (g.team === 'away') {
          curAway++;
          curHome = 0;
        }
        if (curHome > maxConsecutiveHome) maxConsecutiveHome = curHome;
        if (curAway > maxConsecutiveAway) maxConsecutiveAway = curAway;
      }

      const bestStreak = Math.max(maxConsecutiveHome, maxConsecutiveAway);
      const passed = bestStreak >= 3;

      if (isMatchOver) {
        return {
          status: passed ? 'PASSED' : 'FAILED',
          progressText: passed
            ? `Team hat trick achieved (${bestStreak} unanswered goals)!`
            : `Max unanswered streak was ${bestStreak}/3 goals.`,
          passed,
        };
      }

      return {
        status: passed ? 'PASSED' : 'ACCEPTED',
        progressText: passed
          ? `Hat trick locked! (${bestStreak} in a row)`
          : `Longest streak: ${bestStreak}/3 unanswered goals`,
        passed,
      };
    }

    case 'two_x_blowout': {
      // One team scores at least double the other team (e.g. 4-2, 6-3, 2-0; min 2 goals)
      const maxScore = Math.max(homeScore, awayScore);
      const minScore = Math.min(homeScore, awayScore);
      const passed = maxScore >= 2 && maxScore >= minScore * 2;

      if (isMatchOver) {
        return {
          status: passed ? 'PASSED' : 'FAILED',
          progressText: passed
            ? `Blowout confirmed (${maxScore} vs ${minScore} goals: ≥2x margin)!`
            : `Final margin was ${maxScore} vs ${minScore} (needed 2x or more).`,
          passed,
        };
      }

      return {
        status: 'ACCEPTED',
        progressText: `Score: ${homeScore}–${awayScore} (${maxScore >= minScore * 2 && maxScore >= 2 ? 'Currently 2x+' : 'Need 2x+'})`,
        passed,
      };
    }

    case 'penalty_box_congestion': {
      // 3 strikers in the penalty box at the very same time
      const inBox = players.filter(
        (p) => p.role === 'striker' && p.mode === 'PENALTY_BOX'
      ).length;

      // Check if this condition was satisfied in the past or right now
      if (inBox >= 3) {
        return {
          status: 'PASSED',
          progressText: 'Box congestion achieved (3 strikers in the box)!',
          passed: true,
        };
      }

      if (isMatchOver) {
        return {
          status: 'FAILED',
          progressText: 'Match ended without 3 strikers in the box simultaneously.',
          passed: false,
        };
      }

      return {
        status: 'ACCEPTED',
        progressText: `Strikers in box: ${inBox}/3 simultaneously`,
        passed: false,
      };
    }

    case 'over_under_5':
    case 'barnburner_8':
    case 'barnburner_12': {
      const needed =
        tip.evaluatorId === 'barnburner_12' ? 12 : tip.evaluatorId === 'barnburner_8' ? 8 : 6;
      const total = homeScore + awayScore;
      const passed = total >= needed;
      if (isMatchOver) {
        return {
          status: passed ? 'PASSED' : 'FAILED',
          progressText: passed
            ? `Over ${needed - 1} goals hit (${total} total goals)!`
            : `Total goals were ${total} (needed ${needed}+).`,
          passed,
        };
      }
      return {
        status: passed ? 'PASSED' : 'ACCEPTED',
        progressText: passed
          ? `Over ${needed - 1} locked (${total} goals)!`
          : `Combined goals: ${total}/${needed} needed`,
        passed,
      };
    }

    case 'bloody_period_3': {
      const p3Fights = events.filter(
        (e) => e.type === 'FIGHT' && e.period === 3
      ).length;
      const passed = p3Fights >= 2;

      if (isMatchOver) {
        return {
          status: passed ? 'PASSED' : 'FAILED',
          progressText: passed
            ? `${p3Fights} fights in Period 3 (target 2+)!`
            : `Only ${p3Fights}/2 fights occurred in Period 3.`,
          passed,
        };
      }

      return {
        status: passed ? 'PASSED' : 'ACCEPTED',
        progressText:
          period < 3
            ? 'Awaiting Period 3 brawl opportunity'
            : `Period 3 fights: ${p3Fights}/2`,
        passed,
      };
    }

    case 'shave_spread_1': {
      const team: Team = tip.targetTeam ?? 'home';
      const name = team === 'home' ? 'Home' : 'Away';
      const diff = team === 'home' ? homeScore - awayScore : awayScore - homeScore;
      const passed = diff === 1;

      if (isMatchOver) {
        return {
          status: passed ? 'PASSED' : 'FAILED',
          progressText: passed
            ? `Exact 1-goal ${name} victory (${homeScore}–${awayScore})! Vegas is pleased.`
            : `${name} margin was ${diff > 0 ? '+' : ''}${diff} (needed EXACTLY +1).`,
          passed,
        };
      }

      return {
        status: 'ACCEPTED',
        progressText: `Current ${name} margin: ${diff > 0 ? '+' : ''}${diff} (target: +1)`,
        passed,
      };
    }

    case 'mobsters_tie': {
      const passed = homeScore === awayScore;

      if (isMatchOver) {
        return {
          status: passed ? 'PASSED' : 'FAILED',
          progressText: passed
            ? `Match tied ${homeScore}–${awayScore}! The syndicate cashes in.`
            : `Game ended ${homeScore}–${awayScore} (not tied).`,
          passed,
        };
      }

      return {
        status: 'ACCEPTED',
        progressText: `Score ${homeScore}–${awayScore} (${passed ? 'Tied' : 'Not Tied'})`,
        passed,
      };
    }

    case 'goalie_saves_10': {
      let homeSaves = 0;
      let awaySaves = 0;
      for (const e of events) {
        if (e.type === 'SAVE') {
          if (e.team === 'home') homeSaves++;
          else if (e.team === 'away') awaySaves++;
        }
      }
      const best = Math.max(homeSaves, awaySaves);
      const passed = best >= 10;
      if (passed) {
        return {
          status: 'PASSED',
          progressText: `Goalie clinic complete (${best} saves)!`,
          passed: true,
        };
      }
      if (isMatchOver) {
        return {
          status: 'FAILED',
          progressText: `Best goalie only made ${best}/10 saves.`,
          passed: false,
        };
      }
      return {
        status: 'ACCEPTED',
        progressText: `Saves — Home ${homeSaves} / Away ${awaySaves} (need 10 by one goalie)`,
        passed: false,
      };
    }

    case 'scoreless_period': {
      const target = tip.targetPeriod ?? 2;
      const goalsInPeriod = events.filter(
        (e) => e.type === 'GOAL' && e.period === target
      ).length;
      if (goalsInPeriod > 0) {
        return {
          status: 'FAILED',
          progressText: `${goalsInPeriod} goal(s) scored in Period ${target}.`,
          passed: false,
        };
      }
      const targetOver =
        period > target || (period === target && (!!ctx.isPeriodEnd || isMatchOver));
      if (targetOver) {
        return {
          status: 'PASSED',
          progressText: `Period ${target} finished scoreless!`,
          passed: true,
        };
      }
      return {
        status: 'ACCEPTED',
        progressText:
          period < target
            ? `Waiting for Period ${target} to begin (must stay 0–0)`
            : `Period ${target} still scoreless...`,
        passed: false,
      };
    }

    case 'all_strikers_fighting': {
      const strikers = players.filter((p) => p.role === 'striker');
      const fightingNow = strikers.filter((p) => p.mode === 'FIGHTING').length;
      const sinceP = tip.acceptedAtPeriod ?? 1;
      const lineBrawl =
        (strikers.length > 0 && fightingNow === strikers.length) ||
        events.some((e) => e.type === 'FIGHT' && e.isLineBrawl && e.period >= sinceP);
      if (lineBrawl) {
        return {
          status: 'PASSED',
          progressText: 'Full line brawl! Every skater is throwing hands!',
          passed: true,
        };
      }
      if (isMatchOver) {
        return {
          status: 'FAILED',
          progressText: 'Never got every striker fighting at once.',
          passed: false,
        };
      }
      return {
        status: 'ACCEPTED',
        progressText: `Strikers fighting now: ${fightingNow}/${strikers.length || 4}`,
        passed: false,
      };
    }

    case 'power_play_goals_2': {
      const ppGoals = events.filter(
        (e) => e.type === 'GOAL' && e.isPowerPlayGoal
      ).length;
      const passed = ppGoals >= 2;
      if (isMatchOver) {
        return {
          status: passed ? 'PASSED' : 'FAILED',
          progressText: passed
            ? `${ppGoals} power play goals scored!`
            : `Only ${ppGoals}/2 power play goals.`,
          passed,
        };
      }
      return {
        status: passed ? 'PASSED' : 'ACCEPTED',
        progressText: passed
          ? `Special teams locked (${ppGoals} PP goals)!`
          : `Power play goals: ${ppGoals}/2`,
        passed,
      };
    }

    default:
      return { status: 'ACCEPTED', progressText: 'Active', passed: false };
  }
}

interface TipCandidate {
  evaluatorId: string;
  senderName: string;
  senderTitle: string;
  flavorText: string;
  conditionDescription: string;
  scope: TipScope;
  basePayout: number;
  conflictsWith: string[];
  minStreetCred?: number;
  maxStreetCred?: number;
  targetTeam?: Team;
  targetPeriod?: 2 | 3;
}

/** Official directives that require the subject team to win. */
const TEAM_WIN_ORDERS = ['clean_sheet', 'no_repeat_songs', 'comeback_win'];

export function generateIntermissionTips(
  period: 1 | 2,
  streetCredLevel: number,
  officialOrderId: string,
  seed: number,
  excludeEvaluatorIds: string[] = [],
  officialTargetTeam: Team = 'home'
): TipOffer[] {
  const shaveTeam: Team = (((seed >> 1) + period) & 1) === 0 ? 'home' : 'away';
  const shaveName = shaveTeam === 'home' ? 'Home' : 'Away';
  const nextPeriod = (period + 1) as 2 | 3;

  const shaveConflicts = ['blowout'];
  if (shaveTeam === 'away') shaveConflicts.push('home_wins');
  if (shaveTeam !== officialTargetTeam) shaveConflicts.push(...TEAM_WIN_ORDERS);

  // Candidate pool of tips
  const allCandidates: TipCandidate[] = [
    {
      evaluatorId: 'hat_trick',
      senderName: 'Sal from Section 104',
      senderTitle: 'Die-Hard Arena Regular',
      flavorText:
        'Hey Maestro! We want to see fireworks! Give us three unanswered goals in a row and I\'ll slip you a fat roll of twenties!',
      conditionDescription: 'One team must score 3 consecutive unanswered goals.',
      scope: 'FULL_MATCH',
      basePayout: 550,
      conflictsWith: [],
    },
    {
      evaluatorId: 'two_x_blowout',
      senderName: 'Vegas Bookie "Two-Pad" Tony',
      senderTitle: 'Syndicate Oddsmaker',
      flavorText:
        'I laid heavy action on an absolute rout. Make sure one team scores double the other, capiche?',
      conditionDescription: 'Either team must finish with at least double the other team\'s goals.',
      scope: 'FULL_MATCH',
      basePayout: 600,
      conflictsWith: [],
    },
    {
      evaluatorId: 'penalty_box_congestion',
      senderName: 'Rink Rat Jimmy',
      senderTitle: 'Equipment Room Informant',
      flavorText:
        'Ref\'s arm is itching! If you can bait enough scraps to pack 3 strikers in the penalty box at once, the pot is yours.',
      conditionDescription: 'Have at least 3 strikers locked in the penalty box simultaneously.',
      scope: 'FULL_MATCH',
      basePayout: 700,
      conflictsWith: ['clean_sheet'],
    },
    {
      evaluatorId: 'over_under_5',
      senderName: 'The High-Stakes VIP',
      senderTitle: 'Luxury Suite Patron',
      flavorText:
        'Defense is boring! Play something with tempo so we get a barnburner! Over 5 combined goals gets you paid.',
      conditionDescription: 'Both teams combine for more than 5 total goals.',
      scope: 'FULL_MATCH',
      basePayout: 500,
      conflictsWith: [],
      maxStreetCred: 2,
    },
    {
      evaluatorId: 'barnburner_8',
      senderName: 'The High-Stakes VIP',
      senderTitle: 'Luxury Suite Patron',
      flavorText:
        'Now that you\'ve got a reputation, let\'s raise the stakes. I want a shootout — 8 combined goals and the suite pays handsomely!',
      conditionDescription: 'Both teams combine for 8 or more total goals.',
      scope: 'FULL_MATCH',
      basePayout: 750,
      conflictsWith: [],
      minStreetCred: 3,
      maxStreetCred: 4,
    },
    {
      evaluatorId: 'barnburner_12',
      senderName: 'The High-Stakes VIP',
      senderTitle: 'Luxury Suite Patron',
      flavorText:
        'You\'re a legend in the loft. Give me pure pandemonium — TWELVE combined goals — and I\'ll make it worth your while!',
      conditionDescription: 'Both teams combine for 12 or more total goals.',
      scope: 'FULL_MATCH',
      basePayout: 1100,
      conflictsWith: [],
      minStreetCred: 5,
    },
    {
      evaluatorId: 'bloody_period_3',
      senderName: 'Sully "The Enforcer" (Ret.)',
      senderTitle: 'Old-School Alumni',
      flavorText:
        'Hockey was meant to be played with bruised knuckles. Trigger two brawls in the final period and show these rookies what time it is!',
      conditionDescription: 'Provoke at least 2 fights in Period 3 specifically.',
      scope: 'PERIOD_3',
      basePayout: 650,
      conflictsWith: ['clean_sheet'],
    },
    {
      evaluatorId: 'shave_spread_1',
      senderName: 'Shady Sam',
      senderTitle: 'Underground Bookmaker',
      flavorText: `Keep it close, kid. ${shaveName} needs to win by EXACTLY one goal. Don\'t let \'em run away with it!`,
      conditionDescription: `${shaveName} Team must win by EXACTLY 1 goal.`,
      scope: 'FULL_MATCH',
      basePayout: 750,
      conflictsWith: shaveConflicts,
      targetTeam: shaveTeam,
    },
    {
      evaluatorId: 'mobsters_tie',
      senderName: 'Don Moretti',
      senderTitle: 'VIP Lounge Speculator',
      flavorText:
        'A tie pays 10-to-1 in my parlor today. End this match in a deadlock and you won\'t need management\'s paycheck.',
      conditionDescription: 'Game must finish in a regulation tie (neither team wins).',
      scope: 'FULL_MATCH',
      basePayout: 1200,
      conflictsWith: ['home_wins', 'blowout', 'clean_sheet', 'no_repeat_songs', 'comeback_win'],
    },
    {
      evaluatorId: 'goalie_saves_10',
      senderName: 'Gus "Iron Pads" Petrov',
      senderTitle: 'Retired Crease Guru',
      flavorText:
        'Show me a clinic between the pipes! If either tendy stones 10 shots tonight, there\'s cash in your coat pocket.',
      conditionDescription: 'Either goalie must make at least 10 saves.',
      scope: 'FULL_MATCH',
      basePayout: 600,
      conflictsWith: [],
    },
    {
      evaluatorId: 'scoreless_period',
      senderName: 'Under-Betting Ursula',
      senderTitle: 'Offshore Sharp',
      flavorText: `Too much lamp-lighting ruins my under ticket! Lock it down so nobody scores a single goal in Period ${nextPeriod}!`,
      conditionDescription: `Neither team scores a goal in Period ${nextPeriod}.`,
      scope: nextPeriod === 2 ? 'PERIOD_2' : 'PERIOD_3',
      basePayout: 700,
      conflictsWith: nextPeriod === 3 ? ['comeback_win'] : [],
      targetPeriod: nextPeriod,
    },
    {
      evaluatorId: 'all_strikers_fighting',
      senderName: 'Mad Dog Kowalski',
      senderTitle: 'Tabloid Photojournalist',
      flavorText:
        'I need a front-page photo of pure pandemonium! Spark a full line brawl with every skater throwing haymakers at once!',
      conditionDescription: 'All 4 strikers must be fighting at the same time.',
      scope: 'FULL_MATCH',
      basePayout: 900,
      conflictsWith: ['clean_sheet'],
    },
    {
      evaluatorId: 'power_play_goals_2',
      senderName: '"Special Teams" Stevie',
      senderTitle: 'Press Box Scout',
      flavorText:
        'Cash in on the man advantage! Give me at least 2 power-play goals across the match and we split the syndicate bonus.',
      conditionDescription: 'Score at least 2 goals while on a Power Play.',
      scope: 'FULL_MATCH',
      basePayout: 650,
      conflictsWith: [],
    },
  ];
  const candidates = allCandidates.filter(
    (c) =>
      (c.minStreetCred === undefined || streetCredLevel >= c.minStreetCred) &&
      (c.maxStreetCred === undefined || streetCredLevel <= c.maxStreetCred)
  );

  // Exclude propositions that were already offered or accepted in this game
  const available = candidates.filter(
    (c) => !excludeEvaluatorIds.includes(c.evaluatorId)
  );
  const pool = available.length > 0 ? available : candidates;

  // Pick 1 or 2 tips deterministically based on seed + period
  const count = Math.min(streetCredLevel >= 3 ? 2 : 1, pool.length);
  const picked: TipOffer[] = [];
  const pickedEvaluatorIds = new Set<string>();
  const offset = (seed + period * 7) % pool.length;

  for (let step = 0; step < pool.length && picked.length < count; step++) {
    const idx = (offset + step * 3) % pool.length;
    const item = pool[idx];
    if (pickedEvaluatorIds.has(item.evaluatorId)) continue;
    pickedEvaluatorIds.add(item.evaluatorId);

    const payoutMultiplier = 1.0 + (streetCredLevel - 1) * 0.15;
    const conflicts = item.conflictsWith.includes(officialOrderId);

    picked.push({
      id: `tip_${period}_${picked.length}_${seed}`,
      senderName: item.senderName,
      senderTitle: item.senderTitle,
      flavorText: item.flavorText,
      bribePayout: Math.round(item.basePayout * payoutMultiplier),
      unofficialRepDelta: 1,
      conditionDescription: item.conditionDescription,
      scope: item.scope,
      status: 'OFFERED',
      evaluatorId: item.evaluatorId,
      liveProgressText: 'Pending acceptance',
      conflictsWithOfficial: conflicts,
      targetTeam: item.targetTeam,
      targetPeriod: item.targetPeriod,
    });
  }

  return picked;
}
