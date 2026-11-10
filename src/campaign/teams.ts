import { PlayerBaselineConfig } from '../config';

export interface CampaignTeamProfile {
  id: string;
  name: string;
  city: string;
  shortName: string;
  primaryColor: string;
  secondaryColor: string;
  personalityNote: string;
  scoutReport: {
    strength: string;
    weakness: string;
    organistTip: string;
  };
  goalie: {
    name: string;
    number: number;
    focus: number;
    aggression: number;
  };
  strikers: [
    { name: string; number: number; focus: number; aggression: number },
    { name: string; number: number; focus: number; aggression: number },
  ];
}

export const HOME_TEAM: CampaignTeamProfile = {
  id: 'home_harmonizers',
  name: 'Port Sound Harmonizers',
  city: 'Port Sound',
  shortName: 'Harmonizers',
  primaryColor: '#0284c7', // Sky Blue
  secondaryColor: '#f59e0b', // Amber/Gold
  personalityNote: 'Your home squad! Disciplined and rhythmic, thriving on organ momentum.',
  scoutReport: {
    strength: 'Excels on quick counter-attacks and disciplined defensive structure.',
    weakness: 'Vulnerable to momentum collapses when the crowd goes cold.',
    organistTip: 'Keep crowd volume high to unlock their offensive speed.',
  },
  goalie: {
    name: 'Brick Wall" Bixby',
    number: 1,
    focus: 0.55,
    aggression: 0.20,
  },
  strikers: [
    { name: 'Ace" Miller', number: 9, focus: 0.58, aggression: 0.42 },
    { name: 'Slag" Kowalski', number: 24, focus: 0.48, aggression: 0.60 },
  ],
};

export const RIVAL_TEAMS: CampaignTeamProfile[] = [
  {
    id: 'walleyes',
    name: 'Ironclad Walleyes',
    city: 'Lake Erie',
    shortName: 'Walleyes',
    primaryColor: '#334155', // Slate
    secondaryColor: '#38bdf8', // Light blue
    personalityNote: 'A brick-wall defensive team that plays low-scoring, frustrating hockey.',
    scoutReport: {
      strength: 'Immovable veteran goalie with elite focus on straight-on shots.',
      weakness: 'Slow reaction to cross-crease passes and one-timer redirects.',
      organistTip: 'Use Madeyalook to rattle the goalie, or Tic-Tac-Toe to exploit slow lateral movement.',
    },
    goalie: {
      name: 'Oleg The Dam" Volkov',
      number: 30,
      focus: 0.72,
      aggression: 0.15,
    },
    strikers: [
      { name: 'Gunnar Lind', number: 11, focus: 0.52, aggression: 0.35 },
      { name: 'Dirk Vance', number: 17, focus: 0.46, aggression: 0.48 },
    ],
  },
  {
    id: 'bruisers',
    name: 'Thunder Bay Bruisers',
    city: 'Thunder Bay',
    shortName: 'Bruisers',
    primaryColor: '#b91c1c', // Crimson
    secondaryColor: '#1e293b', // Dark slate
    personalityNote: 'Notorious brawlers who care more about smashing bodies than scoring goals.',
    scoutReport: {
      strength: 'Brutal body-checks, frequent fights, and devastating intimidation hits.',
      weakness: 'Prone to reckless penalties and catastrophic shorthanded collapses.',
      organistTip: 'Grudge Toccata will bait them into penalties; punish them with Power Play Polka.',
    },
    goalie: {
      name: 'Rusty" McPhee',
      number: 35,
      focus: 0.44,
      aggression: 0.50,
    },
    strikers: [
      { name: 'Tank" O\'Reilly', number: 44, focus: 0.38, aggression: 0.88 },
      { name: 'Spike" Vane', number: 27, focus: 0.42, aggression: 0.80 },
    ],
  },
  {
    id: 'blizzards',
    name: 'Rapid City Blizzards',
    city: 'Rapid City',
    shortName: 'Blizzards',
    primaryColor: '#06b6d4', // Cyan
    secondaryColor: '#f1f5f9', // Crisp White
    personalityNote: 'Speed demons with lightning-quick transition skating and tape-to-tape passing.',
    scoutReport: {
      strength: 'Fastest skaters in the league; lethal on open-ice odd-man rushes.',
      weakness: 'Fragile stamina; they burn out rapidly in third periods if forechecked hard.',
      organistTip: 'Hold the Line absorbs their early rush; exhaust them and take over late.',
    },
    goalie: {
      name: 'Mikael Quick',
      number: 31,
      focus: 0.50,
      aggression: 0.25,
    },
    strikers: [
      { name: 'Flash" Fontaine', number: 8, focus: 0.65, aggression: 0.32 },
      { name: 'Lars Aero" Nygaard', number: 88, focus: 0.62, aggression: 0.36 },
    ],
  },
  {
    id: 'vipers',
    name: 'Metro Vipers',
    city: 'Metro City',
    shortName: 'Vipers',
    primaryColor: '#059669', // Emerald
    secondaryColor: '#fbbf24', // Amber
    personalityNote: 'Cunning opportunists who capitalize on turnovers and defensive lapses.',
    scoutReport: {
      strength: 'Lethal sniper accuracy; rarely miss high-danger slot opportunities.',
      weakness: 'Passive defensive coverage; easily disoriented along the boards.',
      organistTip: 'Hit The Siren\'s Waltz when their puck carrier is trapped to force catastrophic turnovers.',
    },
    goalie: {
      name: 'Felix Siphon',
      number: 1,
      focus: 0.52,
      aggression: 0.30,
    },
    strikers: [
      { name: 'Viper" Vance', number: 91, focus: 0.68, aggression: 0.50 },
      { name: 'Chet Needle', number: 19, focus: 0.60, aggression: 0.45 },
    ],
  },
  {
    id: 'caribous',
    name: 'Quebec Caribous',
    city: 'Quebec',
    shortName: 'Caribous',
    primaryColor: '#2563eb', // Royal Blue
    secondaryColor: '#94a3b8', // Silver
    personalityNote: 'Old-school heavy trappers with grinding defensive patience.',
    scoutReport: {
      strength: 'Disruptive poke checks and constant stick-checking clogging the neutral zone.',
      weakness: 'Static offense with low scoring upside; struggle if they fall behind early.',
      organistTip: 'Play Charge! early to take the lead, forcing them to abandon their turtle defense.',
    },
    goalie: {
      name: 'Luc Trappier',
      number: 33,
      focus: 0.60,
      aggression: 0.18,
    },
    strikers: [
      { name: 'Guy Tremblay', number: 14, focus: 0.54, aggression: 0.52 },
      { name: 'Rene Bouchard', number: 22, focus: 0.50, aggression: 0.55 },
    ],
  },
  {
    id: 'titans',
    name: 'Titanium Titans',
    city: 'Capital City',
    shortName: 'Titans',
    primaryColor: '#18181b', // Zinc Black
    secondaryColor: '#f97316', // Neon Orange
    personalityNote: 'The reigning powerhouse franchise with elite athletes at every position.',
    scoutReport: {
      strength: 'Virtually flawless balanced stats across focus, stamina, and physical aggression.',
      weakness: 'Overconfident and arrogant when leading; susceptible to sudden momentum swings.',
      organistTip: 'You need full organ combos and clutch cue execution to conquer this juggernaut.',
    },
    goalie: {
      name: 'Goliath" Sterling',
      number: 39,
      focus: 0.75,
      aggression: 0.35,
    },
    strikers: [
      { name: 'Rex Titan" Vance', number: 99, focus: 0.70, aggression: 0.65 },
      { name: 'Dante Cross', number: 77, focus: 0.68, aggression: 0.62 },
    ],
  },
];

export function getTeamById(teamId: string): CampaignTeamProfile {
  if (teamId === HOME_TEAM.id) return HOME_TEAM;
  return RIVAL_TEAMS.find((t) => t.id === teamId) ?? RIVAL_TEAMS[0];
}

/**
 * Builds the PlayerBaselineConfig array for a match given Home and Away teams.
 */
export function buildRosterForMatch(
  homeTeam: CampaignTeamProfile,
  awayTeam: CampaignTeamProfile
): PlayerBaselineConfig[] {
  return [
    {
      id: 'home-s1',
      name: homeTeam.strikers[0].name,
      number: homeTeam.strikers[0].number,
      team: 'home',
      role: 'striker',
      focus: homeTeam.strikers[0].focus,
      aggression: homeTeam.strikers[0].aggression,
    },
    {
      id: 'home-s2',
      name: homeTeam.strikers[1].name,
      number: homeTeam.strikers[1].number,
      team: 'home',
      role: 'striker',
      focus: homeTeam.strikers[1].focus,
      aggression: homeTeam.strikers[1].aggression,
    },
    {
      id: 'home-g',
      name: homeTeam.goalie.name,
      number: homeTeam.goalie.number,
      team: 'home',
      role: 'goalie',
      focus: homeTeam.goalie.focus,
      aggression: homeTeam.goalie.aggression,
    },
    {
      id: 'away-s1',
      name: awayTeam.strikers[0].name,
      number: awayTeam.strikers[0].number,
      team: 'away',
      role: 'striker',
      focus: awayTeam.strikers[0].focus,
      aggression: awayTeam.strikers[0].aggression,
    },
    {
      id: 'away-s2',
      name: awayTeam.strikers[1].name,
      number: awayTeam.strikers[1].number,
      team: 'away',
      role: 'striker',
      focus: awayTeam.strikers[1].focus,
      aggression: awayTeam.strikers[1].aggression,
    },
    {
      id: 'away-g',
      name: awayTeam.goalie.name,
      number: awayTeam.goalie.number,
      team: 'away',
      role: 'goalie',
      focus: awayTeam.goalie.focus,
      aggression: awayTeam.goalie.aggression,
    },
  ];
}
