import { beforeEach, describe, expect, it } from 'vitest';
import { CampaignManager } from '../../campaign/campaignState';
import { buildCampaignSchedule } from '../../campaign/schedule';
import { buildRosterForMatch, HOME_TEAM, RIVAL_TEAMS } from '../../campaign/teams';
import { evaluateTip, generateIntermissionTips, TipOffer } from '../../campaign/tips';
import { MatchEvent } from '../../sim/types';

class LocalStorageMock {
  private store: Record<string, string> = {};
  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = value;
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
}

describe('Phase 2A: Campaign Core Architecture', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: LocalStorageMock }).localStorage = new LocalStorageMock();
  });

  it('initializes a fresh campaign state with 2-slot stand and starting songs', () => {
    const mgr = new CampaignManager();
    const state = mgr.getState();

    expect(state.currentMatchIndex).toBe(0);
    expect(state.bankroll).toBe(0);
    expect(state.officialOrdersCompleted).toBe(0);
    expect(state.officialOrdersTotal).toBe(0);
    expect(state.maxSongSlots).toBe(2);
    expect(state.unlockedSongs).toEqual(['charge', 'hold_the_line']);
    expect(state.equippedSongs).toEqual(['charge', 'hold_the_line']);
    expect(mgr.getOfficialReputationPct()).toBe(100);
  });

  it('builds a complete 17-match schedule across Preseason, Regular, Playoffs, and Championship', () => {
    const schedule = buildCampaignSchedule();
    expect(schedule.length).toBe(17);

    // Preseason
    expect(schedule[0].tier).toBe('PRESEASON');
    expect(schedule[1].tier).toBe('PRESEASON');

    // Regular season
    for (let i = 2; i <= 12; i++) {
      expect(schedule[i].tier).toBe('REGULAR');
    }

    // Opposing organist appearances
    expect(schedule[6].hasOpposingOrganist).toBe(true); // Match 7
    expect(schedule[9].hasOpposingOrganist).toBe(true); // Match 10
    expect(schedule[12].hasOpposingOrganist).toBe(true); // Match 13

    // Playoffs
    expect(schedule[13].tier).toBe('PLAYOFF');
    expect(schedule[14].tier).toBe('PLAYOFF');
    expect(schedule[15].tier).toBe('PLAYOFF');
    expect(schedule[14].hasOpposingOrganist).toBe(true); // Match 15
    expect(schedule[15].hasOpposingOrganist).toBe(true); // Match 16

    // Championship
    expect(schedule[16].tier).toBe('CHAMPIONSHIP');
    expect(schedule[16].hasOpposingOrganist).toBe(true); // Match 17
    expect(schedule[16].payoutMultiplier).toBe(4.0);
  });

  it('builds unique team rosters for match simulation with distinct player stats', () => {
    const walleyes = RIVAL_TEAMS[0];
    const roster = buildRosterForMatch(HOME_TEAM, walleyes);

    expect(roster.length).toBe(6);
    const homeGoalie = roster.find((p) => p.id === 'home-g');
    const awayGoalie = roster.find((p) => p.id === 'away-g');

    expect(homeGoalie?.team).toBe('home');
    expect(awayGoalie?.team).toBe('away');
    expect(awayGoalie?.name).toBe('Oleg The Dam" Volkov');
    expect(awayGoalie?.focus).toBe(0.72); // Brick-wall goalie
  });

  it('tracks Official Reputation and enforces the 75% playoff qualification gate after Match 13', () => {
    const mgr = new CampaignManager();

    // Simulate 12 wins, 1 loss (12/13 = 92% > 75%)
    for (let i = 1; i <= 12; i++) {
      mgr.recordMatchEnd({
        homeScore: 3,
        awayScore: 1,
        officialOrderId: 'home_wins',
        officialOrderPassed: true,
        baseSalaryEarned: 350,
        tipsOffered: 0,
        tipsPassed: 0,
        tipEarnings: 0,
        totalEarnings: 350,
      });
    }

    // Match 13: loss
    const outcome = mgr.recordMatchEnd({
      homeScore: 1,
      awayScore: 2,
      officialOrderId: 'home_wins',
      officialOrderPassed: false,
      baseSalaryEarned: 0,
      tipsOffered: 0,
      tipsPassed: 0,
      tipEarnings: 0,
      totalEarnings: 0,
    });

    expect(mgr.getOfficialReputationPct()).toBe(92);
    expect(outcome.playoffQualified).toBe(true);
    expect(outcome.disqualified).toBe(false);
    expect(outcome.nextMatch?.matchNumber).toBe(14);
  });

  it('disqualifies players who fail the 75% playoff gate after Match 13', () => {
    const mgr = new CampaignManager();

    // 8 wins, 5 fails = 8/13 = 61.5% < 75%
    for (let i = 1; i <= 13; i++) {
      const passed = i <= 8;
      const res = mgr.recordMatchEnd({
        homeScore: passed ? 2 : 1,
        awayScore: passed ? 1 : 2,
        officialOrderId: 'home_wins',
        officialOrderPassed: passed,
        baseSalaryEarned: passed ? 400 : 0,
        tipsOffered: 0,
        tipsPassed: 0,
        tipEarnings: 0,
        totalEarnings: passed ? 400 : 0,
      });

      if (i === 13) {
        expect(res.playoffQualified).toBe(false);
        expect(res.disqualified).toBe(true);
        expect(res.seasonEnded).toBe(true);
        expect(mgr.getState().isDisqualified).toBe(true);
      }
    }
  });

  it('tracks cue hits on songs without advancing on non-cue plays', () => {
    const mgr = new CampaignManager();
    expect(mgr.getSongMasteryLevel('charge')).toBe('UNKNOWN');

    for (let i = 0; i < 4; i++) {
      mgr.recordCueHit('charge');
    }
    expect(mgr.getSongMasteryLevel('charge')).toBe('FAMILIAR');

    for (let i = 0; i < 5; i++) {
      mgr.recordCueHit('charge');
    }
    expect(mgr.getSongMasteryLevel('charge')).toBe('MASTERED');
  });
});

describe('Phase 2B: Intermission Tips & Evaluators', () => {
  it('correctly evaluates Team Hat Trick (3 consecutive unanswered goals)', () => {
    const tip: TipOffer = {
      id: 'tip1',
      senderName: 'Sal',
      senderTitle: 'Fan',
      flavorText: 'Fireworks!',
      bribePayout: 550,
      unofficialRepDelta: 1,
      conditionDescription: '3 consecutive unanswered goals',
      scope: 'FULL_MATCH',
      status: 'ACCEPTED',
      evaluatorId: 'hat_trick',
      liveProgressText: '',
      conflictsWithOfficial: false,
    };

    // 2 home goals, 1 away goal, 2 home goals -> max streak is 2 -> not passed
    const events1: MatchEvent[] = [
      { period: 1, timeRemainingSec: 100, type: 'GOAL', team: 'home', activeSongId: null, activeSongTarget: null },
      { period: 1, timeRemainingSec: 50, type: 'GOAL', team: 'home', activeSongId: null, activeSongTarget: null },
      { period: 2, timeRemainingSec: 90, type: 'GOAL', team: 'away', activeSongId: null, activeSongTarget: null },
      { period: 2, timeRemainingSec: 40, type: 'GOAL', team: 'home', activeSongId: null, activeSongTarget: null },
      { period: 2, timeRemainingSec: 10, type: 'GOAL', team: 'home', activeSongId: null, activeSongTarget: null },
    ];

    const res1 = evaluateTip(tip, {
      period: 2,
      homeScore: 4,
      awayScore: 1,
      events: events1,
      players: [],
      isMatchOver: false,
    });
    expect(res1.passed).toBe(false);

    // Now Home scores a 3rd consecutive unanswered goal
    const events2: MatchEvent[] = [
      ...events1,
      { period: 3, timeRemainingSec: 80, type: 'GOAL', team: 'home', activeSongId: null, activeSongTarget: null },
    ];
    const res2 = evaluateTip(tip, {
      period: 3,
      homeScore: 5,
      awayScore: 1,
      events: events2,
      players: [],
      isMatchOver: true,
    });
    expect(res2.passed).toBe(true);
    expect(res2.status).toBe('PASSED');
  });

  it('correctly evaluates 2x Blowout (target team >= 2x other team goals)', () => {
    const tip: TipOffer = {
      id: 'tip2',
      senderName: 'Tony',
      senderTitle: 'Oddsmaker',
      flavorText: 'Blowout!',
      bribePayout: 600,
      unofficialRepDelta: 1,
      conditionDescription: '>= 2x goals',
      scope: 'FULL_MATCH',
      status: 'ACCEPTED',
      evaluatorId: 'two_x_blowout',
      liveProgressText: '',
      conflictsWithOfficial: false,
    };

    // 3 - 2 is not 2x
    const res1 = evaluateTip(tip, {
      period: 3,
      homeScore: 3,
      awayScore: 2,
      events: [],
      players: [],
      isMatchOver: true,
    });
    expect(res1.passed).toBe(false);

    // 4 - 2 is 2x!
    const res2 = evaluateTip(tip, {
      period: 3,
      homeScore: 4,
      awayScore: 2,
      events: [],
      players: [],
      isMatchOver: true,
    });
    expect(res2.passed).toBe(true);

    // 3 - 0 is 2x! (3 >= 0 * 2 and 3 >= 2)
    const res3 = evaluateTip(tip, {
      period: 3,
      homeScore: 3,
      awayScore: 0,
      events: [],
      players: [],
      isMatchOver: true,
    });
    expect(res3.passed).toBe(true);
  });

  it('correctly evaluates Penalty Box Congestion (3 strikers in penalty box simultaneously)', () => {
    const tip: TipOffer = {
      id: 'tip3',
      senderName: 'Jimmy',
      senderTitle: 'Rink Rat',
      flavorText: 'Box congestion',
      bribePayout: 700,
      unofficialRepDelta: 1,
      conditionDescription: '3 strikers in box simultaneously',
      scope: 'FULL_MATCH',
      status: 'ACCEPTED',
      evaluatorId: 'penalty_box_congestion',
      liveProgressText: '',
      conflictsWithOfficial: false,
    };

    const mockPlayers = [
      { role: 'striker', mode: 'PENALTY_BOX' },
      { role: 'striker', mode: 'PENALTY_BOX' },
      { role: 'striker', mode: 'DEFENDING' },
      { role: 'goalie', mode: 'DEFENDING' },
    ] as any;

    const res1 = evaluateTip(tip, {
      period: 2,
      homeScore: 1,
      awayScore: 1,
      events: [],
      players: mockPlayers,
      isMatchOver: false,
    });
    expect(res1.passed).toBe(false);

    // 3rd striker joins penalty box!
    mockPlayers[2].mode = 'PENALTY_BOX';
    const res2 = evaluateTip(tip, {
      period: 2,
      homeScore: 1,
      awayScore: 1,
      events: [],
      players: mockPlayers,
      isMatchOver: false,
    });
    expect(res2.passed).toBe(true);
    expect(res2.status).toBe('PASSED');
  });

  it('generates tips with escalated payouts at higher street cred levels', () => {
    const tipsLvl1 = generateIntermissionTips(1, 1, 'home_wins', 42);
    const tipsLvl4 = generateIntermissionTips(1, 4, 'home_wins', 42);

    expect(tipsLvl1.length).toBeGreaterThanOrEqual(1);
    expect(tipsLvl4.length).toBe(2); // High roller unlocked 2 offers
    expect(tipsLvl4[0].bribePayout).toBeGreaterThan(tipsLvl1[0].bribePayout);
  });
});
