import { SongId } from '../sim/types';
import { CampaignManager } from './campaignState';

export interface StandUpgradeTier {
  slots: number;
  name: string;
  cost: number;
  desc: string;
}

export const STAND_UPGRADE_LADDER: StandUpgradeTier[] = [
  {
    slots: 3,
    name: 'Concert Music Stand',
    cost: 450,
    desc: 'Expands console to 3 simultaneous active song slots.',
  },
  {
    slots: 4,
    name: 'Dual-Tier Console',
    cost: 1000,
    desc: 'Expands console to 4 simultaneous active song slots.',
  },
  {
    slots: 5,
    name: 'Master Console & Bookshelf',
    cost: 1800,
    desc: 'Expands console to 5 simultaneous active song slots.',
  },
  {
    slots: 6,
    name: 'Grand Cathedral 3-Tier Console',
    cost: 3000,
    desc: 'Unlocks maximum console capacity with all 6 song slots active.',
  },
];

export interface SongShopItem {
  id: SongId;
  title: string;
  cost: number;
  desc: string;
}

export const SONG_SHOP_CATALOG: SongShopItem[] = [
  {
    id: 'grudge_toccata',
    title: 'Grudge Toccata (Chaos Brawl)',
    cost: 350,
    desc: 'Spikes aggression and drops focus on both teams to provoke dust-cloud brawls.',
  },
  {
    id: 'power_play_polka',
    title: 'Power Play Polka (Man Advantage)',
    cost: 400,
    desc: 'Supercharges one-timers and offensive cycle for the team on the power play.',
  },
  {
    id: 'kill_the_clock',
    title: 'Kill the Clock (Penalty Kill)',
    cost: 400,
    desc: 'Boosts shorthanded goalie stamina and triggers defensive puck clears.',
  },
  {
    id: 'madeyalook',
    title: 'Madeyalook (Goalie Distraction)',
    cost: 500,
    desc: 'Taunts the opposing goalie, cutting their focus and causing goal concessions.',
  },
];

export function getNextStandUpgrade(currentSlots: number): StandUpgradeTier | null {
  return STAND_UPGRADE_LADDER.find((u) => u.slots > currentSlots) ?? null;
}

export function canAfford(mgr: CampaignManager, cost: number): boolean {
  return mgr.getState().bankroll >= cost;
}

export function purchaseStandUpgrade(mgr: CampaignManager): {
  success: boolean;
  message: string;
} {
  const currentSlots = mgr.getState().maxSongSlots;
  const next = getNextStandUpgrade(currentSlots);
  if (!next) {
    return { success: false, message: 'Music stand already at maximum capacity!' };
  }
  if (!canAfford(mgr, next.cost)) {
    return {
      success: false,
      message: `Insufficient funds ($${mgr.getState().bankroll} / $${next.cost})`,
    };
  }

  mgr.purchaseUpgrade(`stand_${next.slots}`, next.cost);
  mgr.setMaxSongSlots(next.slots);
  return {
    success: true,
    message: `Upgraded to ${next.name} (${next.slots} slots)!`,
  };
}

export function purchaseSong(
  mgr: CampaignManager,
  songId: SongId
): { success: boolean; message: string } {
  const item = SONG_SHOP_CATALOG.find((s) => s.id === songId);
  if (!item) return { success: false, message: 'Song not found.' };

  if (mgr.getState().unlockedSongs.includes(songId)) {
    return { success: false, message: 'Song already unlocked!' };
  }
  if (!canAfford(mgr, item.cost)) {
    return {
      success: false,
      message: `Insufficient funds ($${mgr.getState().bankroll} / $${item.cost})`,
    };
  }

  mgr.purchaseUpgrade(`song_${songId}`, item.cost);
  mgr.unlockSong(songId);
  return { success: true, message: `Acquired sheet music for ${item.title}!` };
}
