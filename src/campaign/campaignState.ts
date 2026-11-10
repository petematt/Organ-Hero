import { SongId } from '../sim/types';
import { buildCampaignSchedule, MatchScheduleEntry } from './schedule';
import { TipConditionContext, TipOffer, evaluateTip } from './tips';

export const CAMPAIGN_STORAGE_KEY = 'organ_hero_campaign_v2';

export interface CampaignMatchRecord {
  matchNumber: number;
  tier: string;
  opponentId: string;
  opponentName: string;
  homeScore: number;
  awayScore: number;
  officialOrderId: string;
  officialOrderPassed: boolean;
  baseSalaryEarned: number;
  tipsOffered: number;
  tipsPassed: number;
  tipEarnings: number;
  totalEarnings: number;
}

export interface CampaignState {
  version: 2;
  currentMatchIndex: number; // 0-based, 0 to 16
  bankroll: number;
  officialOrdersCompleted: number;
  officialOrdersTotal: number;
  unofficialRepLevel: number;
  totalTipsCompleted: number;
  totalTipEarnings: number;

  // Equipment & Repertoire
  maxSongSlots: number; // Starts at 2
  unlockedSongs: SongId[]; // Starts at ['charge', 'hold_the_line']
  equippedSongs: SongId[]; // Starts at ['charge', 'hold_the_line']
  songMasteryOnCueHits: Record<string, number>; // Only increments on cue hits!
  purchasedUpgrades: string[];

  // Match History
  matchHistory: CampaignMatchRecord[];
  isSeasonCompleted: boolean;
  isDisqualified: boolean;
  disqualificationReason?: string;
}

export function createInitialCampaignState(): CampaignState {
  return {
    version: 2,
    currentMatchIndex: 0,
    bankroll: 0,
    officialOrdersCompleted: 0,
    officialOrdersTotal: 0,
    unofficialRepLevel: 1,
    totalTipsCompleted: 0,
    totalTipEarnings: 0,

    maxSongSlots: 2,
    unlockedSongs: ['charge', 'hold_the_line'],
    equippedSongs: ['charge', 'hold_the_line'],
    songMasteryOnCueHits: {
      charge: 0,
      hold_the_line: 0,
    },
    purchasedUpgrades: [],

    matchHistory: [],
    isSeasonCompleted: false,
    isDisqualified: false,
  };
}

export class CampaignManager {
  private state: CampaignState;
  private schedule: MatchScheduleEntry[];

  constructor() {
    this.schedule = buildCampaignSchedule();
    this.state = this.loadState();
  }

  public getState(): CampaignState {
    return this.state;
  }

  public getSchedule(): MatchScheduleEntry[] {
    return this.schedule;
  }

  public getCurrentMatch(): MatchScheduleEntry | null {
    if (this.state.currentMatchIndex >= this.schedule.length) {
      return null;
    }
    return this.schedule[this.state.currentMatchIndex];
  }

  public getOfficialReputationPct(): number {
    if (this.state.officialOrdersTotal === 0) return 100;
    return Math.round(
      (this.state.officialOrdersCompleted / this.state.officialOrdersTotal) * 100
    );
  }

  public canEnterPlayoffs(): boolean {
    return this.getOfficialReputationPct() >= 75;
  }

  public canEnterChampionship(): boolean {
    return this.getOfficialReputationPct() >= 90;
  }

  public recordCueHit(songId: SongId): void {
    const current = this.state.songMasteryOnCueHits[songId] ?? 0;
    this.state.songMasteryOnCueHits[songId] = current + 1;
    this.saveState();
  }

  public getSongMasteryHits(songId: SongId): number {
    return this.state.songMasteryOnCueHits[songId] ?? 0;
  }

  public getSongMasteryLevel(songId: SongId): 'UNKNOWN' | 'FAMILIAR' | 'MASTERED' {
    const hits = this.getSongMasteryHits(songId);
    if (hits >= 9) return 'MASTERED';
    if (hits >= 4) return 'FAMILIAR';
    return 'UNKNOWN';
  }

  // Active match tips
  private currentActiveTips: TipOffer[] = [];

  public getActiveTips(): TipOffer[] {
    return this.currentActiveTips;
  }

  public addTipOffers(offers: TipOffer[]): void {
    this.currentActiveTips.push(...offers);
  }

  public acceptTip(tipId: string): void {
    const tip = this.currentActiveTips.find((t) => t.id === tipId);
    if (tip) {
      tip.status = 'ACCEPTED';
    }
  }

  public declineTip(tipId: string): void {
    const tip = this.currentActiveTips.find((t) => t.id === tipId);
    if (tip) {
      tip.status = 'DECLINED';
    }
  }

  public evaluateActiveTips(ctx: TipConditionContext): void {
    for (const tip of this.currentActiveTips) {
      if (tip.status === 'ACCEPTED') {
        const evalRes = evaluateTip(tip, ctx);
        tip.status = evalRes.status;
        tip.liveProgressText = evalRes.progressText;
      }
    }
  }

  public clearActiveTips(): void {
    this.currentActiveTips = [];
  }

  public getCompletedTipsCountAndEarnings(): { count: number; earnings: number } {
    let count = 0;
    let earnings = 0;
    for (const tip of this.currentActiveTips) {
      if (tip.status === 'PASSED') {
        count++;
        earnings += tip.bribePayout;
      }
    }
    return { count, earnings };
  }

  public recordMatchEnd(record: Omit<CampaignMatchRecord, 'matchNumber' | 'tier' | 'opponentId' | 'opponentName'>): {
    nextMatch: MatchScheduleEntry | null;
    seasonEnded: boolean;
    playoffQualified: boolean;
    championshipQualified: boolean;
    disqualified: boolean;
    message: string;
  } {
    const currentMatch = this.getCurrentMatch();
    if (!currentMatch) {
      return {
        nextMatch: null,
        seasonEnded: true,
        playoffQualified: false,
        championshipQualified: false,
        disqualified: false,
        message: 'Season already completed.',
      };
    }

    // Update totals
    this.state.officialOrdersTotal++;
    if (record.officialOrderPassed) {
      this.state.officialOrdersCompleted++;
    }
    this.state.totalTipsCompleted += record.tipsPassed;
    this.state.totalTipEarnings += record.tipEarnings;
    this.state.bankroll += record.totalEarnings;

    // Check street cred progression (every 2 tips completed advances 1 level up to level 5)
    this.state.unofficialRepLevel = Math.min(
      5,
      1 + Math.floor(this.state.totalTipsCompleted / 2)
    );

    const fullRecord: CampaignMatchRecord = {
      matchNumber: currentMatch.matchNumber,
      tier: currentMatch.tier,
      opponentId: currentMatch.awayTeam.id,
      opponentName: currentMatch.awayTeam.name,
      ...record,
    };
    this.state.matchHistory.push(fullRecord);

    const matchNum = currentMatch.matchNumber;
    let seasonEnded = false;
    let playoffQualified = true;
    let championshipQualified = true;
    let disqualified = false;
    let message = '';

    // Check Playoff Cut after Match 13
    if (matchNum === 13) {
      playoffQualified = this.canEnterPlayoffs();
      if (!playoffQualified) {
        disqualified = true;
        seasonEnded = true;
        this.state.isDisqualified = true;
        this.state.disqualificationReason = `Official Reputation was only ${this.getOfficialReputationPct()}% (target: ≥75%). Management dismissed you before the playoffs!`;
        message = this.state.disqualificationReason;
      } else {
        message = `Congratulations! Official Reputation of ${this.getOfficialReputationPct()}% punched your ticket to the Playoffs!`;
      }
    } else if (matchNum === 16) {
      // Check Championship Cut after Match 16
      championshipQualified = this.canEnterChampionship();
      if (!championshipQualified) {
        disqualified = true;
        seasonEnded = true;
        this.state.isDisqualified = true;
        this.state.disqualificationReason = `Official Reputation was only ${this.getOfficialReputationPct()}% (target: ≥90%). Eliminated just shy of the Memorial Cup!`;
        message = this.state.disqualificationReason;
      } else {
        message = `Monumental achievement! With ${this.getOfficialReputationPct()}% Official Reputation, you advance to the Championship Match!`;
      }
    } else if (matchNum >= 17) {
      seasonEnded = true;
      this.state.isSeasonCompleted = true;
      message = 'Season complete! You have finished the 17-match organ odyssey!';
    }

    if (!disqualified && !seasonEnded) {
      this.state.currentMatchIndex++;
    }

    this.saveState();

    return {
      nextMatch: this.getCurrentMatch(),
      seasonEnded,
      playoffQualified,
      championshipQualified,
      disqualified,
      message,
    };
  }

  public purchaseUpgrade(upgradeId: string, cost: number): boolean {
    if (this.state.bankroll < cost) return false;
    this.state.bankroll -= cost;
    this.state.purchasedUpgrades.push(upgradeId);
    this.saveState();
    return true;
  }

  public setMaxSongSlots(slots: number): void {
    this.state.maxSongSlots = slots;
    this.saveState();
  }

  public unlockSong(songId: SongId): void {
    if (!this.state.unlockedSongs.includes(songId)) {
      this.state.unlockedSongs.push(songId);
    }
    if (
      this.state.equippedSongs.length < this.state.maxSongSlots &&
      !this.state.equippedSongs.includes(songId)
    ) {
      this.state.equippedSongs.push(songId);
    }
    this.saveState();
  }

  public setEquippedSongs(songs: SongId[]): void {
    this.state.equippedSongs = songs.slice(0, this.state.maxSongSlots);
    this.saveState();
  }

  public resetCampaign(): void {
    this.state = createInitialCampaignState();
    this.saveState();
  }

  public loadState(): CampaignState {
    try {
      if (typeof localStorage !== 'undefined') {
        const serialized = localStorage.getItem(CAMPAIGN_STORAGE_KEY);
        if (serialized) {
          const parsed = JSON.parse(serialized) as CampaignState;
          if (parsed.version === 2) {
            return parsed;
          }
        }
      }
    } catch {
      // fallback to initial state on corrupted storage
    }
    const fresh = createInitialCampaignState();
    return fresh;
  }

  public saveState(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(this.state));
      }
    } catch {
      // ignore storage write errors
    }
  }
}
