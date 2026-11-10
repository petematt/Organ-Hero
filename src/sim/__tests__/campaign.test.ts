import { beforeEach, describe, expect, it } from 'vitest';
import { CampaignManager } from '../../campaign/campaignState';
import { buildCampaignSchedule } from '../../campaign/schedule';
import { buildRosterForMatch, HOME_TEAM, RIVAL_TEAMS } from '../../campaign/teams';
import { purchaseSong, purchaseStandUpgrade } from '../../campaign/shop';
import { evaluateTip, generateIntermissionTips, TipOffer } from '../../campaign/tips';
import { cloneConfig } from '../../config';
import { getSongTooltip, SONGS } from '../../game/songs';
import { MatchSimulation } from '../../sim/match';
import { OpposingOrganistController } from '../../sim/opposingOrganist';
import { MatchEvent, SongId } from '../../sim/types';

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

beforeEach(() => {
  (globalThis as unknown as { localStorage: LocalStorageMock }).localStorage = new LocalStorageMock();
});

describe('Phase 2A: Campaign Core Architecture', () => {

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

describe('Phase 2C: The Organ Loft Shop & Music Stand Upgrades', () => {
  it('manages stand upgrades from 2 to 3 slots and deducts bankroll', () => {
    const mgr = new CampaignManager();
    expect(mgr.getState().maxSongSlots).toBe(2);

    // Give bankroll
    mgr.getState().bankroll = 1000;

    const res = purchaseStandUpgrade(mgr);
    expect(res.success).toBe(true);
    expect(mgr.getState().maxSongSlots).toBe(3);
    expect(mgr.getState().bankroll).toBe(1000 - 450);

    // Try upgrading to 4 slots with remaining $550 (needs $1000)
    const res2 = purchaseStandUpgrade(mgr);
    expect(res2.success).toBe(false);
    expect(mgr.getState().maxSongSlots).toBe(3);
  });

  it('allows purchasing sheet music and equipping unlocked songs within slot limits', () => {
    const mgr = new CampaignManager();
    mgr.getState().bankroll = 1000;

    expect(mgr.getState().unlockedSongs).not.toContain('grudge_toccata');

    const buyRes = purchaseSong(mgr, 'grudge_toccata');
    expect(buyRes.success).toBe(true);
    expect(mgr.getState().unlockedSongs).toContain('grudge_toccata');
    expect(mgr.getState().bankroll).toBe(1000 - 350);

    // Currently stand has 2 slots, equipped with charge and hold_the_line
    expect(mgr.getState().maxSongSlots).toBe(2);

    // Equip grudge_toccata and charge
    mgr.setEquippedSongs(['grudge_toccata', 'charge']);
    expect(mgr.getState().equippedSongs).toEqual(['grudge_toccata', 'charge']);

    // Attempting to equip 3 songs when maxSongSlots is 2 clamps to 2
    mgr.setEquippedSongs(['grudge_toccata', 'charge', 'hold_the_line']);
    expect(mgr.getState().equippedSongs.length).toBe(2);
  });
});

describe('Phase 2D: Expanded Song Repertoire, Mastery Meter & Opposing Organist', () => {
  it('includes all 12 songs with unique IDs and complete definitions', () => {
    const expectedIds: SongId[] = [
      'charge',
      'hold_the_line',
      'grudge_toccata',
      'power_play_polka',
      'kill_the_clock',
      'madeyalook',
      'underdog_draw',
      'second_wind',
      'tic_tac_toe',
      'the_fortress',
      'sirens_waltz',
      'overtime_overture',
    ];

    for (const id of expectedIds) {
      expect(SONGS[id]).toBeDefined();
      expect(SONGS[id].title).toBeTruthy();
      expect(SONGS[id].shortDesc).toBeTruthy();
    }
  });

  it('tracks song mastery level strictly on on-cue hits', () => {
    const mgr = new CampaignManager();
    expect(mgr.getSongMasteryLevel('underdog_draw')).toBe('UNKNOWN');
    expect(getSongTooltip('underdog_draw', 'UNKNOWN')).toContain('rumored to help');

    // 1-3 hits: still UNKNOWN
    mgr.recordCueHit('underdog_draw');
    mgr.recordCueHit('underdog_draw');
    mgr.recordCueHit('underdog_draw');
    expect(mgr.getSongMasteryLevel('underdog_draw')).toBe('UNKNOWN');

    // 4 hits: becomes FAMILIAR
    mgr.recordCueHit('underdog_draw');
    expect(mgr.getSongMasteryLevel('underdog_draw')).toBe('FAMILIAR');
    expect(getSongTooltip('underdog_draw', 'FAMILIAR')).toContain('2x multiplier');

    // 9 hits: becomes MASTERED
    for (let i = 0; i < 5; i++) {
      mgr.recordCueHit('underdog_draw');
    }
    expect(mgr.getSongMasteryLevel('underdog_draw')).toBe('MASTERED');
    expect(getSongTooltip('underdog_draw', 'MASTERED')).toContain('MASTERED');
  });

  it('restores stamina across skaters when second_wind is played', () => {
    const cfg = cloneConfig();
    const sim = new MatchSimulation(cfg, 42, 'home_wins');

    // Drain home striker stamina
    const homeStriker = sim.players.find((p) => p.team === 'home' && p.role === 'striker')!;
    homeStriker.stamina = 0.20;

    sim.playSong('second_wind');
    expect(homeStriker.stamina).toBeGreaterThan(0.20 + 0.35);
  });

  it('guarantees critical glove save when the_fortress is active', () => {
    const cfg = cloneConfig();
    const sim = new MatchSimulation(cfg, 42, 'home_wins');

    const homeGoalie = sim.players.find((p) => p.team === 'home' && p.role === 'goalie')!;
    homeGoalie.focus = 0.1;
    homeGoalie.stamina = 0.1;

    // Away has possession, so defending team is Home
    sim.currentPossessor = 'away';
    sim.playSong('the_fortress');
    expect(sim.activeSong?.songId).toBe('the_fortress');
    expect(sim.activeSong?.target).toBe('home');

    (sim as unknown as { resolveGoalieSave: (g: typeof homeGoalie) => void }).resolveGoalieSave(homeGoalie);
    expect(homeGoalie.mode).toBe('HOLDING_PUCK');
    expect(sim.events.some((e) => e.type === 'SAVE' && e.isCritSave)).toBe(true);
  });

  it('opposing organist triggers rival tunes and is silenced by player counter hit', () => {
    const cfg = cloneConfig();
    const sim = new MatchSimulation(cfg, 42, 'home_wins');
    sim.phase = 'PLAYING';

    const controller = new OpposingOrganistController({
      name: 'Rival Ray',
      title: 'Visiting Booth Virtuoso',
      avatarColor: '#f43f5e',
      playIntervalSec: 10,
      favoredSongs: ['charge'],
      tauntMessage: 'Loves loud fanfares.',
    });
    sim.opposingOrganist = controller;

    // Advance controller cooldown to zero
    controller.cooldownSec = 0.1;
    controller.step(0.2, sim);

    expect(controller.activeSongId).toBe('charge');
    expect(controller.songRemainingSec).toBeGreaterThan(0);
    expect(sim.activeCue?.type).toBe('RIVAL_ORGANIST_ATTACK');

    // Player hits counter tune (hold_the_line counters charge)
    sim.playSong('hold_the_line');
    expect(controller.activeSongId).toBeNull();
    expect(controller.songRemainingSec).toBe(0);
  });
});

