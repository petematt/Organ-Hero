import { SeededRNG } from '../sim/rng';
import { OrderId, Team } from '../sim/types';

export interface OfficialOrderDef {
  id: OrderId;
  title: string;
  shortLabel: string;
  description: string;
  /** When true, the directive's subject team is randomly Home or Away per match. */
  usesRandomTeam?: boolean;
}

export const OFFICIAL_ORDERS: OfficialOrderDef[] = [
  {
    id: 'home_wins',
    title: 'Home Ice Advantage',
    shortLabel: 'Home Wins',
    description: 'Ensure the Home Team wins the match in regulation (ties fail).',
  },
  {
    id: 'blood_on_ice',
    title: 'Blood on the Ice',
    shortLabel: '5+ Fights',
    description: 'Provoke at least 5 fights across the match.',
  },
  {
    id: 'clean_sheet',
    title: 'Family Night',
    shortLabel: 'Home Wins & <2 Fights',
    description:
      'Keep it family-friendly! Home Team must win the match with fewer than 2 total fights.',
    usesRandomTeam: true,
  },
  {
    id: 'blowout',
    title: 'Statement Blowout',
    shortLabel: 'Home Wins by 3+',
    description: 'Home Team must win the match by 3 or more goals.',
    usesRandomTeam: true,
  },
  {
    id: 'bring_the_noise',
    title: 'Bring the Noise',
    shortLabel: 'Avg Crowd ≥ 80%',
    description: 'Finish the match with an Average Crowd Volume of at least 80%.',
  },
  {
    id: 'no_repeat_songs',
    title: 'Fresh Setlist',
    shortLabel: 'Home Wins & 0 Repeats',
    description:
      'Home Team must win without playing any duplicate songs back-to-back.',
    usesRandomTeam: true,
  },
  {
    id: 'comeback_win',
    title: 'Third-Period Comeback',
    shortLabel: 'Home: Trail P2 → Win',
    description:
      'Home Team must be losing going into the final period and then win the match.',
    usesRandomTeam: true,
  },
];

export function getOrderById(id: OrderId): OfficialOrderDef {
  return OFFICIAL_ORDERS.find((o) => o.id === id) ?? OFFICIAL_ORDERS[0];
}

export function teamLabel(team: Team): string {
  return team === 'home' ? 'Home' : 'Away';
}

/**
 * Deterministically picks the subject team of a directive from the match seed.
 * `home_wins` (and any non-team directive) is always Home.
 */
export function resolveOrderTargetTeam(orderId: OrderId, seed: number): Team {
  const def = getOrderById(orderId);
  if (!def.usesRandomTeam) return 'home';
  let h = (seed | 0) ^ 0x9e3779b9;
  for (let i = 0; i < orderId.length; i++) {
    h = Math.imul(h ^ orderId.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  h ^= h >>> 15;
  return (h & 1) === 0 ? 'home' : 'away';
}

/**
 * Returns the directive definition with its label/description tailored to the
 * subject team (Home or Away).
 */
export function getOrderDisplay(
  orderId: OrderId,
  targetTeam: Team = 'home'
): OfficialOrderDef {
  const def = getOrderById(orderId);
  if (!def.usesRandomTeam || targetTeam === 'home') return def;
  return {
    ...def,
    shortLabel: def.shortLabel.replace(/Home/g, 'Away'),
    description: def.description.replace(/Home Team/g, 'Away Team'),
  };
}

export function pickRandomOrder(rng: SeededRNG): OfficialOrderDef {
  const idx = Math.floor(rng.next() * OFFICIAL_ORDERS.length);
  return OFFICIAL_ORDERS[idx] ?? OFFICIAL_ORDERS[0];
}

export interface OrderEvaluationSnapshot {
  homeGoals: number;
  awayGoals: number;
  totalFights: number;
  averageCrowdVolume: number;
  isMatchOver: boolean;
  /** Subject team of the directive (defaults to 'home'). */
  targetTeam?: Team;
  /** Number of back-to-back duplicate song plays so far. */
  stalePlays?: number;
  period?: number;
  isPeriodEnd?: boolean;
  homeGoalsAfterP2?: number;
  awayGoalsAfterP2?: number;
}

export type OrderLiveStatus = 'ON_TRACK' | 'AT_RISK' | 'FAILED' | 'PASSED';

export interface OrderEvaluationResult {
  passed: boolean;
  liveStatus: OrderLiveStatus;
  reason: string;
}

/**
 * Evaluates an Official Order both live during the match and at the final buzzer.
 * Note: Tie = neither team wins, so any order requiring a win fails on a tie.
 */
export function evaluateOrder(
  orderId: OrderId,
  snap: OrderEvaluationSnapshot
): OrderEvaluationResult {
  const { homeGoals, awayGoals, totalFights, averageCrowdVolume, isMatchOver } = snap;
  // home_wins is always about the Home Team
  const target: Team = orderId === 'home_wins' ? 'home' : snap.targetTeam ?? 'home';
  const name = teamLabel(target);
  const favored = target === 'home' ? homeGoals : awayGoals;
  const opp = target === 'home' ? awayGoals : homeGoals;
  const scoreStr = `${favored}–${opp}`;
  const diff = favored - opp;
  const avgRounded = Math.round(averageCrowdVolume);
  const tied = favored === opp;

  switch (orderId) {
    case 'home_wins': {
      const passed = homeGoals > awayGoals;
      if (isMatchOver) {
        if (passed) {
          return {
            passed: true,
            liveStatus: 'PASSED',
            reason: `Home won ${homeGoals}–${awayGoals}. Management is pleased!`,
          };
        }
        const tieMsg =
          homeGoals === awayGoals
            ? `Match ended in a ${homeGoals}–${awayGoals} tie (neither team wins).`
            : `Home lost ${homeGoals}–${awayGoals}.`;
        return {
          passed: false,
          liveStatus: 'FAILED',
          reason: `${tieMsg} Order required a Home victory.`,
        };
      }
      return {
        passed,
        liveStatus: passed ? 'ON_TRACK' : 'AT_RISK',
        reason: passed
          ? `Home leads ${homeGoals}–${awayGoals}`
          : `Home trails or is tied (${homeGoals}–${awayGoals})`,
      };
    }

    case 'blood_on_ice': {
      const passed = totalFights >= 5;
      if (isMatchOver) {
        return {
          passed,
          liveStatus: passed ? 'PASSED' : 'FAILED',
          reason: passed
            ? `${totalFights} fights broke out (target: 5+). The crowd got their spectacle!`
            : `Only ${totalFights} of 5 required fights occurred.`,
        };
      }
      return {
        passed,
        liveStatus: passed ? 'ON_TRACK' : 'AT_RISK',
        reason: `${totalFights} / 5 fights triggered`,
      };
    }

    case 'clean_sheet': {
      const tooManyFights = totalFights >= 2;
      const winning = favored > opp;
      const passed = winning && !tooManyFights;
      if (isMatchOver) {
        if (passed) {
          return {
            passed: true,
            liveStatus: 'PASSED',
            reason: `${name} won ${scoreStr} with only ${totalFights} ${totalFights === 1 ? 'fight' : 'fights'}.`,
          };
        }
        const why = tooManyFights
          ? `${totalFights} fights broke out (limit: < 2)`
          : tied
          ? `Match ended in a ${scoreStr} tie`
          : `${name} lost ${scoreStr}`;
        return {
          passed: false,
          liveStatus: 'FAILED',
          reason: `Order failed: ${why}.`,
        };
      }
      if (tooManyFights) {
        return {
          passed: false,
          liveStatus: 'FAILED',
          reason: `${totalFights} fights already (limit < 2)!`,
        };
      }
      return {
        passed,
        liveStatus: winning ? 'ON_TRACK' : 'AT_RISK',
        reason: `${name} score ${scoreStr}, Fights: ${totalFights}/1 max`,
      };
    }

    case 'blowout': {
      const passed = diff >= 3;
      if (isMatchOver) {
        return {
          passed,
          liveStatus: passed ? 'PASSED' : 'FAILED',
          reason: passed
            ? `${name} won ${scoreStr} (+${diff} goal margin)!`
            : `Final score ${scoreStr} (needed ${name} win by 3+ goals).`,
        };
      }
      return {
        passed,
        liveStatus: passed ? 'ON_TRACK' : 'AT_RISK',
        reason: `${name} margin: ${diff >= 0 ? '+' : ''}${diff} (need +3)`,
      };
    }

    case 'bring_the_noise': {
      const passed = averageCrowdVolume >= 80;
      if (isMatchOver) {
        return {
          passed,
          liveStatus: passed ? 'PASSED' : 'FAILED',
          reason: passed
            ? `Average Crowd Volume reached ${avgRounded}% (target: ≥ 80%)!`
            : `Average Crowd Volume was ${avgRounded}% (needed ≥ 80%).`,
        };
      }
      return {
        passed,
        liveStatus: passed ? 'ON_TRACK' : 'AT_RISK',
        reason: `Avg Crowd Volume: ${avgRounded}% (need 80%+)`,
      };
    }

    case 'no_repeat_songs': {
      const repeats = snap.stalePlays ?? 0;
      const winning = favored > opp;
      if (repeats > 0) {
        return {
          passed: false,
          liveStatus: 'FAILED',
          reason: `${repeats} back-to-back song ${repeats === 1 ? 'repeat' : 'repeats'} (limit: 0).`,
        };
      }
      if (isMatchOver) {
        if (winning) {
          return {
            passed: true,
            liveStatus: 'PASSED',
            reason: `${name} won ${scoreStr} with a fresh setlist (0 repeats).`,
          };
        }
        return {
          passed: false,
          liveStatus: 'FAILED',
          reason: tied
            ? `Match ended in a ${scoreStr} tie (neither team wins).`
            : `${name} lost ${scoreStr}.`,
        };
      }
      return {
        passed: winning,
        liveStatus: winning ? 'ON_TRACK' : 'AT_RISK',
        reason: `${name} score ${scoreStr}, repeats: 0`,
      };
    }

    case 'comeback_win': {
      const period = snap.period ?? (isMatchOver ? 3 : 1);
      const p2Over =
        isMatchOver || period >= 3 || (period === 2 && !!snap.isPeriodEnd);
      const favP2 = target === 'home' ? snap.homeGoalsAfterP2 : snap.awayGoalsAfterP2;
      const oppP2 = target === 'home' ? snap.awayGoalsAfterP2 : snap.homeGoalsAfterP2;
      const favAfterP2 = favP2 ?? favored;
      const oppAfterP2 = oppP2 ?? opp;

      if (!p2Over) {
        const trailing = favored < opp;
        return {
          passed: false,
          liveStatus: trailing ? 'ON_TRACK' : 'AT_RISK',
          reason: trailing
            ? `${name} trails ${scoreStr}. Hold it close into Period 3!`
            : `${name} must be trailing entering Period 3 (${scoreStr})`,
        };
      }
      if (favAfterP2 >= oppAfterP2) {
        return {
          passed: false,
          liveStatus: 'FAILED',
          reason: `${name} entered Period 3 at ${favAfterP2}–${oppAfterP2}; needed to be trailing.`,
        };
      }
      const passed = favored > opp;
      if (isMatchOver) {
        return {
          passed,
          liveStatus: passed ? 'PASSED' : 'FAILED',
          reason: passed
            ? `Comeback complete! ${name} rallied from ${favAfterP2}–${oppAfterP2} to win ${scoreStr}.`
            : `${name} could not rally: final ${scoreStr}.`,
        };
      }
      return {
        passed,
        liveStatus: passed ? 'ON_TRACK' : 'AT_RISK',
        reason: `${name} trailed ${favAfterP2}–${oppAfterP2} after P2; now ${scoreStr}`,
      };
    }
  }
}
