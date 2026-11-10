import { MatchEvent, PlayerEntity } from '../sim/types';

export type TipScope = 'PERIOD_2' | 'PERIOD_3' | 'FULL_MATCH';
export type TipStatus = 'OFFERED' | 'ACCEPTED' | 'DECLINED' | 'PASSED' | 'FAILED';

export interface TipConditionContext {
  period: number;
  homeScore: number;
  awayScore: number;
  events: MatchEvent[];
  players: PlayerEntity[];
  isMatchOver: boolean;
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

    case 'over_under_5': {
      const total = homeScore + awayScore;
      const passed = total > 5;
      if (isMatchOver) {
        return {
          status: passed ? 'PASSED' : 'FAILED',
          progressText: passed
            ? `Over 5 goals hit (${total} total goals)!`
            : `Total goals were ${total} (needed > 5).`,
          passed,
        };
      }
      return {
        status: passed ? 'PASSED' : 'ACCEPTED',
        progressText: passed
          ? `Over 5 locked (${total} goals)!`
          : `Combined goals: ${total}/6 needed`,
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
      const diff = homeScore - awayScore;
      const passed = diff === 1;

      if (isMatchOver) {
        return {
          status: passed ? 'PASSED' : 'FAILED',
          progressText: passed
            ? `Exact 1-goal victory (${homeScore}–${awayScore})! Vegas is pleased.`
            : `Margin was ${diff > 0 ? '+' : ''}${diff} (needed EXACTLY +1).`,
          passed,
        };
      }

      return {
        status: 'ACCEPTED',
        progressText: `Current Home margin: ${diff > 0 ? '+' : ''}${diff} (target: +1)`,
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

    default:
      return { status: 'ACCEPTED', progressText: 'Active', passed: false };
  }
}

export function generateIntermissionTips(
  period: 1 | 2,
  streetCredLevel: number,
  officialOrderId: string,
  seed: number,
  excludeEvaluatorIds: string[] = []
): TipOffer[] {
  // Candidate pool of tips
  const candidates: Array<{
    evaluatorId: string;
    senderName: string;
    senderTitle: string;
    flavorText: string;
    conditionDescription: string;
    scope: TipScope;
    basePayout: number;
    conflictsWith: string[];
  }> = [
    {
      evaluatorId: 'hat_trick',
      senderName: 'Sal from Section 104',
      senderTitle: 'Die-Hard Arena Regular',
      flavorText:
        'Hey Maestro! We want to see fireworks! Give us three unanswered goals in a row and I\'ll slip you a fat roll of twenties!',
      conditionDescription: 'One team must score 3 consecutive unanswered goals.',
      scope: 'FULL_MATCH',
      basePayout: 550,
      conflictsWith: ['clean_sheet'],
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
      conflictsWith: ['clean_sheet'],
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
      conflictsWith: ['clean_sheet'],
    },
    {
      evaluatorId: 'bloody_period_3',
      senderName: 'Sully The Enforcer" (Ret.)',
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
      flavorText:
        'Keep it close, kid. Home needs to win by EXACTLY one goal. Don\'t let \'em run away with it!',
      conditionDescription: 'Home Team must win by EXACTLY 1 goal.',
      scope: 'FULL_MATCH',
      basePayout: 750,
      conflictsWith: ['blowout'],
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
      conflictsWith: ['home_wins', 'blowout', 'clean_sheet'],
    },
  ];

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
    });
  }

  return picked;
}
