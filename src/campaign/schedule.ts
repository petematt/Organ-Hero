import { OrderId, SongId } from '../sim/types';
import { CampaignTeamProfile, HOME_TEAM, RIVAL_TEAMS } from './teams';

export type SeasonTier = 'PRESEASON' | 'REGULAR' | 'PLAYOFF' | 'CHAMPIONSHIP';

export interface OpposingOrganistDef {
  name: string;
  title: string;
  avatarColor: string;
  playIntervalSec: number;
  favoredSongs: SongId[];
  tauntMessage: string;
}

export interface MatchScheduleEntry {
  matchNumber: number; // 1-indexed (1 to 17)
  tier: SeasonTier;
  tierLabel: string;
  homeTeam: CampaignTeamProfile;
  awayTeam: CampaignTeamProfile;
  assignedOrderId: OrderId;
  baseSalary: number;
  payoutMultiplier: number;
  hasOpposingOrganist: boolean;
  opposingOrganist?: OpposingOrganistDef;
}

export const OPPOSING_ORGANISTS: Record<string, OpposingOrganistDef> = {
  hiss: {
    name: 'Maestro Von Hiss',
    title: 'Away Press Box Virtuoso',
    avatarColor: '#f43f5e',
    playIntervalSec: 22,
    favoredSongs: ['hold_the_line', 'madeyalook'],
    tauntMessage: 'Your pipes sound squeaky today, kid!',
  },
  rick: {
    name: 'Rowdy" Rick Racket',
    title: 'Stadium Rock Organist',
    avatarColor: '#ea580c',
    playIntervalSec: 18,
    favoredSongs: ['charge', 'grudge_toccata'],
    tauntMessage: 'Turn the decibels up! You can\'t drown me out!',
  },
  valkyrie: {
    name: 'Valkyrie Vance',
    title: 'Grand Cathedral Laureate',
    avatarColor: '#8b5cf6',
    playIntervalSec: 15,
    favoredSongs: ['charge', 'power_play_polka', 'hold_the_line'],
    tauntMessage: 'Bow down to the true master of the arena organ!',
  },
};

/**
 * Builds the canonical 17-match schedule for a campaign run.
 */
export function buildCampaignSchedule(): MatchScheduleEntry[] {
  const [walleyes, bruisers, blizzards, vipers, caribous, titans] = RIVAL_TEAMS;

  return [
    // Preseason (Matches 1-2)
    {
      matchNumber: 1,
      tier: 'PRESEASON',
      tierLabel: 'Preseason Match 1 of 2',
      homeTeam: HOME_TEAM,
      awayTeam: walleyes,
      assignedOrderId: 'home_wins',
      baseSalary: 250,
      payoutMultiplier: 1.0,
      hasOpposingOrganist: false,
    },
    {
      matchNumber: 2,
      tier: 'PRESEASON',
      tierLabel: 'Preseason Match 2 of 2',
      homeTeam: HOME_TEAM,
      awayTeam: blizzards,
      assignedOrderId: 'bring_the_noise',
      baseSalary: 250,
      payoutMultiplier: 1.0,
      hasOpposingOrganist: false,
    },

    // Regular Season (Matches 3-13)
    {
      matchNumber: 3,
      tier: 'REGULAR',
      tierLabel: 'Regular Season Game 1',
      homeTeam: HOME_TEAM,
      awayTeam: vipers,
      assignedOrderId: 'home_wins',
      baseSalary: 350,
      payoutMultiplier: 1.0,
      hasOpposingOrganist: false,
    },
    {
      matchNumber: 4,
      tier: 'REGULAR',
      tierLabel: 'Regular Season Game 2',
      homeTeam: HOME_TEAM,
      awayTeam: bruisers,
      assignedOrderId: 'blood_on_ice',
      baseSalary: 375,
      payoutMultiplier: 1.0,
      hasOpposingOrganist: false,
    },
    {
      matchNumber: 5,
      tier: 'REGULAR',
      tierLabel: 'Regular Season Game 3',
      homeTeam: HOME_TEAM,
      awayTeam: caribous,
      assignedOrderId: 'clean_sheet',
      baseSalary: 400,
      payoutMultiplier: 1.0,
      hasOpposingOrganist: false,
    },
    {
      matchNumber: 6,
      tier: 'REGULAR',
      tierLabel: 'Regular Season Game 4',
      homeTeam: HOME_TEAM,
      awayTeam: walleyes,
      assignedOrderId: 'blowout',
      baseSalary: 425,
      payoutMultiplier: 1.0,
      hasOpposingOrganist: false,
    },
    {
      matchNumber: 7,
      tier: 'REGULAR',
      tierLabel: 'Rivalry Clash (Opposing Organist)',
      homeTeam: HOME_TEAM,
      awayTeam: bruisers,
      assignedOrderId: 'home_wins',
      baseSalary: 500,
      payoutMultiplier: 1.2,
      hasOpposingOrganist: true,
      opposingOrganist: OPPOSING_ORGANISTS.rick,
    },
    {
      matchNumber: 8,
      tier: 'REGULAR',
      tierLabel: 'Regular Season Game 6',
      homeTeam: HOME_TEAM,
      awayTeam: blizzards,
      assignedOrderId: 'bring_the_noise',
      baseSalary: 450,
      payoutMultiplier: 1.0,
      hasOpposingOrganist: false,
    },
    {
      matchNumber: 9,
      tier: 'REGULAR',
      tierLabel: 'Regular Season Game 7',
      homeTeam: HOME_TEAM,
      awayTeam: vipers,
      assignedOrderId: 'clean_sheet',
      baseSalary: 475,
      payoutMultiplier: 1.0,
      hasOpposingOrganist: false,
    },
    {
      matchNumber: 10,
      tier: 'REGULAR',
      tierLabel: 'Showdown at the Summit',
      homeTeam: HOME_TEAM,
      awayTeam: titans,
      assignedOrderId: 'home_wins',
      baseSalary: 550,
      payoutMultiplier: 1.3,
      hasOpposingOrganist: true,
      opposingOrganist: OPPOSING_ORGANISTS.hiss,
    },
    {
      matchNumber: 11,
      tier: 'REGULAR',
      tierLabel: 'Regular Season Game 9',
      homeTeam: HOME_TEAM,
      awayTeam: caribous,
      assignedOrderId: 'blowout',
      baseSalary: 500,
      payoutMultiplier: 1.0,
      hasOpposingOrganist: false,
    },
    {
      matchNumber: 12,
      tier: 'REGULAR',
      tierLabel: 'Regular Season Game 10',
      homeTeam: HOME_TEAM,
      awayTeam: walleyes,
      assignedOrderId: 'clean_sheet',
      baseSalary: 525,
      payoutMultiplier: 1.0,
      hasOpposingOrganist: false,
    },
    {
      matchNumber: 13,
      tier: 'REGULAR',
      tierLabel: 'Regular Season Finale (Playoff Cut)',
      homeTeam: HOME_TEAM,
      awayTeam: titans,
      assignedOrderId: 'home_wins',
      baseSalary: 600,
      payoutMultiplier: 1.5,
      hasOpposingOrganist: true,
      opposingOrganist: OPPOSING_ORGANISTS.rick,
    },

    // Playoffs (Matches 14-16) - Gate: ≥75% Official Rep
    {
      matchNumber: 14,
      tier: 'PLAYOFF',
      tierLabel: 'Playoff Quarterfinal (Game 1)',
      homeTeam: HOME_TEAM,
      awayTeam: vipers,
      assignedOrderId: 'home_wins',
      baseSalary: 800,
      payoutMultiplier: 2.0,
      hasOpposingOrganist: false,
    },
    {
      matchNumber: 15,
      tier: 'PLAYOFF',
      tierLabel: 'Playoff Semifinal (Game 2)',
      homeTeam: HOME_TEAM,
      awayTeam: bruisers,
      assignedOrderId: 'home_wins',
      baseSalary: 950,
      payoutMultiplier: 2.0,
      hasOpposingOrganist: true,
      opposingOrganist: OPPOSING_ORGANISTS.rick,
    },
    {
      matchNumber: 16,
      tier: 'PLAYOFF',
      tierLabel: 'Playoff Conference Final (Game 3)',
      homeTeam: HOME_TEAM,
      awayTeam: blizzards,
      assignedOrderId: 'blowout',
      baseSalary: 1100,
      payoutMultiplier: 2.0,
      hasOpposingOrganist: true,
      opposingOrganist: OPPOSING_ORGANISTS.hiss,
    },

    // Championship (Match 17) - Gate: ≥90% Official Rep
    {
      matchNumber: 17,
      tier: 'CHAMPIONSHIP',
      tierLabel: 'The Memorial Cup Championship',
      homeTeam: HOME_TEAM,
      awayTeam: titans,
      assignedOrderId: 'home_wins',
      baseSalary: 2500,
      payoutMultiplier: 4.0,
      hasOpposingOrganist: true,
      opposingOrganist: OPPOSING_ORGANISTS.valkyrie,
    },
  ];
}
