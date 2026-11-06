import { SeededRNG } from '../sim/rng';
import { OrderId } from '../sim/types';

export interface OfficialOrderDef {
  id: OrderId;
  title: string;
  shortLabel: string;
  description: string;
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
    shortLabel: '3+ Fights',
    description: 'Provoke at least 3 fights across the match.',
  },
  {
    id: 'clean_sheet',
    title: 'Clean Sheet Protocol',
    shortLabel: 'Home Wins & <2 Fights',
    description: 'Home Team must win the match with fewer than 2 total fights.',
  },
  {
    id: 'blowout',
    title: 'Statement Blowout',
    shortLabel: 'Home Wins by 2+',
    description: 'Home Team must win the match by 2 or more goals.',
  },
  {
    id: 'bring_the_noise',
    title: 'Bring the Noise',
    shortLabel: 'Avg Crowd ≥ 65%',
    description: 'Finish the match with an Average Crowd Volume of at least 65%.',
  },
];

export function getOrderById(id: OrderId): OfficialOrderDef {
  return OFFICIAL_ORDERS.find((o) => o.id === id) ?? OFFICIAL_ORDERS[0];
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
}

export type OrderLiveStatus = 'ON_TRACK' | 'AT_RISK' | 'FAILED' | 'PASSED';

export interface OrderEvaluationResult {
  passed: boolean;
  liveStatus: OrderLiveStatus;
  reason: string;
}

/**
 * Evaluates an Official Order both live during the match and at the final buzzer.
 * Note: Tie = neither team wins, so any order requiring a Home win fails on a tie.
 */
export function evaluateOrder(
  orderId: OrderId,
  snap: OrderEvaluationSnapshot
): OrderEvaluationResult {
  const { homeGoals, awayGoals, totalFights, averageCrowdVolume, isMatchOver } = snap;
  const diff = homeGoals - awayGoals;
  const avgRounded = Math.round(averageCrowdVolume);

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
      const passed = totalFights >= 3;
      if (isMatchOver) {
        return {
          passed,
          liveStatus: passed ? 'PASSED' : 'FAILED',
          reason: passed
            ? `${totalFights} fights broke out (target: 3+). The crowd got their spectacle!`
            : `Only ${totalFights} of 3 required fights occurred.`,
        };
      }
      return {
        passed,
        liveStatus: passed ? 'ON_TRACK' : 'AT_RISK',
        reason: `${totalFights} / 3 fights triggered`,
      };
    }

    case 'clean_sheet': {
      const tooManyFights = totalFights >= 2;
      const homeWinning = homeGoals > awayGoals;
      const passed = homeWinning && !tooManyFights;
      if (isMatchOver) {
        if (passed) {
          return {
            passed: true,
            liveStatus: 'PASSED',
            reason: `Home won ${homeGoals}–${awayGoals} with only ${totalFights} fight(s).`,
          };
        }
        const why = tooManyFights
          ? `${totalFights} fights broke out (limit: < 2)`
          : homeGoals === awayGoals
          ? `Match ended in a ${homeGoals}–${awayGoals} tie`
          : `Home lost ${homeGoals}–${awayGoals}`;
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
        liveStatus: homeWinning ? 'ON_TRACK' : 'AT_RISK',
        reason: `Score ${homeGoals}–${awayGoals}, Fights: ${totalFights}/1 max`,
      };
    }

    case 'blowout': {
      const passed = diff >= 2;
      if (isMatchOver) {
        return {
          passed,
          liveStatus: passed ? 'PASSED' : 'FAILED',
          reason: passed
            ? `Home won ${homeGoals}–${awayGoals} (+${diff} goal margin)!`
            : `Final score ${homeGoals}–${awayGoals} (needed Home win by 2+ goals).`,
        };
      }
      return {
        passed,
        liveStatus: passed ? 'ON_TRACK' : 'AT_RISK',
        reason: `Home margin: ${diff >= 0 ? '+' : ''}${diff} (need +2)`,
      };
    }

    case 'bring_the_noise': {
      const passed = averageCrowdVolume >= 65;
      if (isMatchOver) {
        return {
          passed,
          liveStatus: passed ? 'PASSED' : 'FAILED',
          reason: passed
            ? `Average Crowd Volume reached ${avgRounded}% (target: ≥ 65%)!`
            : `Average Crowd Volume was ${avgRounded}% (needed ≥ 65%).`,
        };
      }
      return {
        passed,
        liveStatus: passed ? 'ON_TRACK' : 'AT_RISK',
        reason: `Avg Crowd Volume: ${avgRounded}% (need 65%+)`,
      };
    }
  }
}
