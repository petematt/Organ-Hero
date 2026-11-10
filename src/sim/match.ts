import { cloneConfig, GameConfig } from '../config';
import {
  ALL_SONG_IDS,
  doesSongAffectTeam,
  getPowerPlayState,
  getSongStatModifiers,
  isSongValidOnIce,
  oppositeTeam,
  resolveSongTarget,
  SONGS,
} from '../game/songs';
import {
  composeEffectiveStat,
  computeCritSaveChance,
  computeFightChance,
  computeGoalChance,
  computeGoalieBlockChance,
  computePassAccuracy,
  computePassTendency,
  computeRedirectLatency,
  computeShooterAccuracy,
  computeSkateSpeed,
  computeStealChance,
  decayMoodOffset,
} from './formulas';
import {
  applyPuckFriction,
  AWAY_GOAL_X,
  CENTER_X,
  CENTER_Y,
  clampSkaterToBoards,
  collidePuckWithBoards,
  computeReboundVelocity,
  createCurvedPathToGoal,
  dist,
  evalBezier,
  getOpponentGoalPos,
  getOwnGoalPos,
  HOME_GOAL_X,
  normalize,
  RINK_HEIGHT,
  RINK_WIDTH,
} from './physics';
import { clamp, SeededRNG } from './rng';
import {
  ActiveCueState,
  ActiveSongState,
  CalloutBadge,
  CueType,
  MatchEvent,
  MatchPhase,
  OrderId,
  PlayerEntity,
  PuckState,
  SongId,
  Team,
  Vec2,
} from './types';
import { OpposingOrganistController } from './opposingOrganist';

export interface MatchAudioHooks {
  onWhistle?: () => void;
  onGoalHorn?: () => void;
  onSongPlay?: (songId: SongId, cueHit: boolean, stale: boolean) => void;
  onPuckAction?: (type: 'pass' | 'shot' | 'steal') => void;
  onFightImpact?: () => void;
  onPenaltyWhistle?: () => void;
  onPeriodBuzzer?: () => void;
}

export class MatchSimulation {
  public cfg: GameConfig;
  public rng: SeededRNG;
  public orderId: OrderId;
  public audioHooks: MatchAudioHooks = {};
  public opposingOrganist: OpposingOrganistController | null = null;
  public overtimeOvertureTriggeredThisPeriod: boolean = false;

  public period: number = 1;
  public periodTimeRemainingSec: number;
  public phase: MatchPhase = 'FACEOFF_COUNTDOWN';
  public phaseTimerSec: number = 0;

  public homeScore: number = 0;
  public awayScore: number = 0;

  public players: PlayerEntity[] = [];
  public puck: PuckState;

  public currentPossessor: Team | null = null;
  public lastPossessor: Team | null = null;

  public activeSong: ActiveSongState | null = null;
  public lastPlayedSongId: SongId | null = null;
  public silenceTimerSec: number = 0;

  public activeCue: ActiveCueState | null = null;
  public crowdVolume: number;
  public crowdSamples: { period: number; volume: number }[] = [];
  private crowdSampleAccumSec: number = 0;

  public events: MatchEvent[] = [];
  public callouts: CalloutBadge[] = [];
  private nextCalloutId: number = 1;

  constructor(
    cfg: GameConfig = cloneConfig(),
    seed: number = 1337,
    orderId: OrderId = 'home_wins'
  ) {
    this.cfg = cfg;
    this.rng = new SeededRNG(seed);
    this.orderId = orderId;
    this.periodTimeRemainingSec = cfg.periodDurationSec;
    this.crowdVolume = cfg.initialCrowdVolume;

    this.puck = {
      pos: { x: CENTER_X, y: CENTER_Y },
      vel: { x: 0, y: 0 },
      carrierId: null,
      inFlightShotFrom: null,
      isScoringShot: false,
      shotStartPos: null,
      shooterAccuracy: 0,
      shooterId: null,
      inFlightPassToId: null,
      inFlightPassFromId: null,
      trail: [],
    };

    this.initPlayers();
    this.setupFaceoff();
    this.crowdSamples.push({ period: 1, volume: this.crowdVolume });
  }

  private getDefaultSpot(team: Team, role: 'striker' | 'goalie', indexInTeam: number): Vec2 {
    if (role === 'goalie') {
      return {
        x: team === 'home' ? HOME_GOAL_X + 12 : AWAY_GOAL_X - 12,
        y: CENTER_Y,
      };
    }
    const xOffset = team === 'home' ? -95 : 95;
    const yOffset = indexInTeam === 0 ? -55 : 55;
    return {
      x: CENTER_X + xOffset,
      y: CENTER_Y + yOffset,
    };
  }

  private initPlayers(): void {
    this.players = [];
    let homeStrikerIdx = 0;
    let awayStrikerIdx = 0;

    for (const base of this.cfg.roster) {
      const idx =
        base.role === 'striker'
          ? base.team === 'home'
            ? homeStrikerIdx++
            : awayStrikerIdx++
          : 0;
      const spot = this.getDefaultSpot(base.team, base.role, idx);
      this.players.push({
        id: base.id,
        name: base.name,
        number: base.number,
        team: base.team,
        role: base.role,
        pos: { ...spot },
        vel: { x: 0, y: 0 },
        homeSpot: { ...spot },
        baseFocus: base.focus,
        baseAggression: base.aggression,
        moodFocusOffset: 0,
        moodAggressionOffset: 0,
        stamina: 1.0,
        focus: base.focus,
        aggression: base.aggression,
        mode: 'DEFENDING',
        stateTimer: 0,
        possessionTimer: 0,
        passCheckTimer: 0,
        fightPartnerId: null,
        isFightInstigator: false,
        collisionCooldown: 0,
        attackPath: null,
        reactionTimer: 0,
        reactionColor: '#ffffff',
      });
    }
  }

  public setupFaceoff(): void {
    this.puck.carrierId = null;
    this.puck.inFlightShotFrom = null;
    this.puck.isScoringShot = false;
    this.puck.shotStartPos = null;
    this.puck.shooterId = null;
    this.puck.inFlightPassToId = null;
    this.puck.inFlightPassFromId = null;
    this.puck.pos = { x: CENTER_X, y: CENTER_Y };
    this.puck.vel = { x: 0, y: 0 };
    this.puck.trail = [];
    this.currentPossessor = null;

    for (const p of this.players) {
      p.attackPath = null;
      p.possessionTimer = 0;
      p.passCheckTimer = 0;
      p.fightPartnerId = null;
      p.isFightInstigator = false;
      if (p.mode === 'PENALTY_BOX') {
        // Stay in penalty box across mid-period faceoffs until timer expires
        p.pos = this.getPenaltyBoxPos(p.team, p.id);
        p.vel = { x: 0, y: 0 };
      } else {
        p.mode = 'DEFENDING';
        p.stateTimer = 0;
        p.pos = { ...p.homeSpot };
        p.vel = { x: 0, y: 0 };
      }
    }

    this.phase = 'FACEOFF_COUNTDOWN';
    this.phaseTimerSec = this.cfg.faceoffCountdownRealSec * 2; // 3 game seconds (~1.5s at 2x)

    if (this.homeScore <= this.awayScore && !this.activeCue) {
      const loadout = this.getActiveSongLoadout();
      if (loadout.includes('underdog_draw')) {
        this.triggerCue(
          'FACEOFF_DRAW',
          'underdog_draw',
          'home',
          'FACEOFF DRAW! PLAY UNDERDOG DRAW FOR PUCK DROP CONTROL!'
        );
      }
    }
  }

  private getPenaltyBoxPos(team: Team, playerId: string): Vec2 {
    const slotOffset = playerId.endsWith('2') ? 20 : -20;
    return {
      x: team === 'home' ? CENTER_X - 75 + slotOffset : CENTER_X + 75 + slotOffset,
      y: 28,
    };
  }

  public startNextPeriod(): void {
    if (this.period >= 3) {
      this.phase = 'MATCH_OVER';
      return;
    }
    this.period += 1;
    this.periodTimeRemainingSec = this.cfg.periodDurationSec;
    this.activeCue = null;
    this.overtimeOvertureTriggeredThisPeriod = false;

    // Restore stamina and clear all penalties / brawls / stuns between periods
    for (const p of this.players) {
      p.stamina = 1.0;
      p.mode = 'DEFENDING';
      p.stateTimer = 0;
      p.possessionTimer = 0;
      p.passCheckTimer = 0;
      p.fightPartnerId = null;
      p.isFightInstigator = false;
      p.collisionCooldown = 0;
    }

    this.setupFaceoff();
  }

  public spawnCallout(text: string, pos: Vec2, color: string = '#f8fafc', durationSec: number = 2.2): void {
    this.callouts.push({
      id: this.nextCalloutId++,
      text,
      pos: { x: pos.x, y: pos.y },
      color,
      remainingSec: durationSec,
      totalSec: durationSec,
    });
  }

  public getActiveSongLoadout(): SongId[] {
    const limit = clamp(Math.round(this.cfg.maxSongSlots ?? 3), 1, 6);
    const raw =
      Array.isArray(this.cfg.equippedSongs) && this.cfg.equippedSongs.length > 0
        ? this.cfg.equippedSongs
        : ALL_SONG_IDS;
    const result: SongId[] = [];
    for (const id of raw) {
      if (SONGS[id] && !result.includes(id)) {
        result.push(id);
      }
      if (result.length >= limit) break;
    }
    for (const fallback of ALL_SONG_IDS) {
      if (result.length >= limit) break;
      if (!result.includes(fallback)) {
        result.push(fallback);
      }
    }
    return result;
  }

  public triggerCue(
    type: CueType,
    matchingSong: SongId,
    recommendedTarget: 'home' | 'away' | 'both',
    bannerText: string
  ): void {
    if (!this.getActiveSongLoadout().includes(matchingSong)) {
      return;
    }
    this.activeCue = {
      type,
      matchingSong,
      recommendedTarget,
      bannerText,
      remainingSec: this.cfg.cueWindowDurationSec,
    };
  }

  public isOnCooldown(): boolean {
    return this.activeSong !== null && this.activeSong.remainingSec > 0;
  }

  public getSongCooldownRemainingSec(): number {
    return this.activeSong ? Math.max(0, this.activeSong.remainingSec) : 0;
  }

  /**
   * Player taps one of the Organ Song buttons.
   */
  public playSong(songId: SongId): ActiveSongState {
    const target = resolveSongTarget(
      songId,
      this.currentPossessor,
      this.lastPossessor,
      this.players
    );
    const validOnIce = isSongValidOnIce(songId, this.players);

    const cueHit =
      validOnIce &&
      this.activeCue !== null &&
      this.activeCue.matchingSong === songId;
    const stale = this.lastPlayedSongId === songId;

    let multiplier = validOnIce ? 1.0 : 0.0;
    if (cueHit) multiplier *= 2.0;
    if (stale) multiplier *= 0.5;

    this.activeSong = {
      songId,
      target,
      remainingSec: this.cfg.songActiveDurationSec,
      durationSec: this.cfg.songActiveDurationSec,
      multiplier,
      cueHit,
      stale,
    };

    this.lastPlayedSongId = songId;
    this.silenceTimerSec = 0;

    if (!validOnIce) {
      this.spawnCallout(
        'NO POWER PLAY! (NO EFFECT)',
        { x: CENTER_X, y: 70 },
        '#94a3b8',
        2.4
      );
    } else if (cueHit) {
      if (this.opposingOrganist && this.activeCue?.type === 'RIVAL_ORGANIST_ATTACK') {
        this.opposingOrganist.onPlayerCounterHit(this);
      }
      this.activeCue = null;
      this.adjustCrowdVolume(this.cfg.cueHitCrowdBoost);
      this.spawnCallout('★ CUE HIT! 2x EFFECT! ★', { x: CENTER_X, y: 70 }, '#facc15', 2.6);
    } else if (stale) {
      this.adjustCrowdVolume(this.cfg.staleCrowdPenalty);
      this.spawnCallout('CROWD BORED! (STALE)', { x: CENTER_X, y: 70 }, '#fb7185', 2.6);
    } else {
      this.adjustCrowdVolume(this.cfg.songBaseCrowdBoost);
    }

    const songColor = SONGS[songId].color;

    // Instant stamina boost & visual reaction on affected players when song effect is valid
    if (validOnIce) {
      for (const p of this.players) {
        if (doesSongAffectTeam(target, p.team)) {
          if (songId === 'madeyalook' && p.role !== 'goalie') {
            continue;
          }
          p.reactionTimer = 1.8;
          p.reactionColor = songColor;
          if (songId === 'hold_the_line' && p.role === 'goalie') {
            p.stamina = clamp(
              p.stamina + this.cfg.holdGoalieStaminaInstant * multiplier,
              0,
              1
            );
          } else if (songId === 'kill_the_clock' && p.role === 'goalie') {
            p.stamina = clamp(
              p.stamina + this.cfg.killClockGoalieStaminaInstant * multiplier,
              0,
              1
            );
          } else if (songId === 'second_wind') {
            p.stamina = clamp(
              p.stamina + 0.40 * multiplier,
              0,
              1
            );
          }
        }
      }
    }

    this.updateEffectiveStats(0);

    this.events.push({
      type: 'SONG_PLAYED',
      period: this.period,
      timeRemainingSec: this.periodTimeRemainingSec,
      activeSongId: songId,
      activeSongTarget: target,
      songId,
      cueHit,
      stale,
    });

    this.audioHooks.onSongPlay?.(songId, cueHit, stale);
    return this.activeSong;
  }

  private adjustCrowdVolume(delta: number): void {
    this.crowdVolume = clamp(this.crowdVolume + delta, 0, 100);
  }

  public getAverageCrowdVolume(): number {
    if (this.crowdSamples.length === 0) return this.crowdVolume;
    const sum = this.crowdSamples.reduce((acc, s) => acc + s.volume, 0);
    return sum / this.crowdSamples.length;
  }

  public getTotalFights(): number {
    return this.events.filter((e) => e.type === 'FIGHT').length;
  }

  /**
   * Advances the simulation by dtSec (in game seconds).
   */
  public step(dtSec: number): void {
    if (this.phase === 'PERIOD_END' || this.phase === 'MATCH_OVER') {
      return;
    }

    // Update callout badges
    for (let i = this.callouts.length - 1; i >= 0; i--) {
      const c = this.callouts[i];
      c.remainingSec -= dtSec;
      c.pos.y -= 14 * dtSec;
      if (c.remainingSec <= 0) {
        this.callouts.splice(i, 1);
      }
    }

    // Update active song timer
    if (this.activeSong) {
      this.activeSong.remainingSec -= dtSec;
      if (this.activeSong.remainingSec <= 0) {
        this.activeSong = null;
      }
    } else {
      this.silenceTimerSec += dtSec;
      if (this.silenceTimerSec > this.cfg.silenceDecayThresholdSec) {
        this.adjustCrowdVolume(-this.cfg.silenceCrowdDecayPerSec * dtSec);
      }
    }

    // Update situational cue timer
    if (this.activeCue) {
      this.activeCue.remainingSec -= dtSec;
      if (this.activeCue.remainingSec <= 0) {
        this.activeCue = null;
      }
    }

    if (this.opposingOrganist) {
      this.opposingOrganist.step(dtSec, this);
    }

    // Update player effective stats & mood drift
    this.updateEffectiveStats(dtSec);

    // Handle Faceoff countdown or Goal celebration phases
    if (this.phase === 'FACEOFF_COUNTDOWN') {
      this.phaseTimerSec -= dtSec;
      if (this.phaseTimerSec <= 0) {
        this.phase = 'PLAYING';
        let angle = this.rng.range(0, Math.PI * 2);
        let nudgeSpeed = this.rng.range(45, 95);
        if (this.activeSong?.songId === 'underdog_draw') {
          const homeStriker = this.players.find(
            (p) => p.team === 'home' && p.role === 'striker' && p.mode !== 'PENALTY_BOX'
          );
          if (homeStriker) {
            angle = Math.atan2(homeStriker.pos.y - this.puck.pos.y, homeStriker.pos.x - this.puck.pos.x);
            nudgeSpeed = 135;
          }
        }
        this.puck.vel = {
          x: Math.cos(angle) * nudgeSpeed,
          y: Math.sin(angle) * nudgeSpeed,
        };
        this.audioHooks.onWhistle?.();
      }
      return;
    }

    if (this.phase === 'GOAL_CELEBRATION') {
      this.phaseTimerSec -= dtSec;
      if (this.phaseTimerSec <= 0) {
        this.setupFaceoff();
      }
      return;
    }

    // Phase === 'PLAYING': advance period clock
    this.periodTimeRemainingSec = Math.max(0, this.periodTimeRemainingSec - dtSec);

    // Final 30 seconds cue for overtime_overture
    if (
      this.periodTimeRemainingSec <= 30 &&
      !this.overtimeOvertureTriggeredThisPeriod &&
      !this.activeCue
    ) {
      this.overtimeOvertureTriggeredThisPeriod = true;
      const loadout = this.getActiveSongLoadout();
      if (loadout.includes('overtime_overture')) {
        this.triggerCue(
          'FINAL_30_SECONDS',
          'overtime_overture',
          'both',
          'FINAL 30 SECONDS! PLAY OVERTIME OVERTURE FOR CLUTCH SURGE!'
        );
      }
    }

    // Sample crowd volume every 1.0 game second
    this.crowdSampleAccumSec += dtSec;
    if (this.crowdSampleAccumSec >= 1.0) {
      this.crowdSampleAccumSec -= 1.0;
      this.crowdSamples.push({
        period: this.period,
        volume: this.crowdVolume,
      });
    }

    // Step players & puck
    this.stepPlayers(dtSec);
    this.resolveSkaterCollisions();
    this.stepPuck(dtSec);

    // Check period end
    if (this.periodTimeRemainingSec <= 0) {
      this.audioHooks.onPeriodBuzzer?.();
      if (this.period >= 3) {
        this.phase = 'MATCH_OVER';
      } else {
        this.phase = 'PERIOD_END';
      }
    }
  }

  private updateEffectiveStats(dtSec: number): void {
    for (const p of this.players) {
      if (dtSec > 0) {
        p.moodFocusOffset = decayMoodOffset(
          p.moodFocusOffset,
          dtSec,
          this.cfg.moodHalfLifeSec
        );
        p.moodAggressionOffset = decayMoodOffset(
          p.moodAggressionOffset,
          dtSec,
          this.cfg.moodHalfLifeSec
        );
        if (p.reactionTimer > 0) {
          p.reactionTimer = Math.max(0, p.reactionTimer - dtSec);
        }
        if (p.collisionCooldown > 0) {
          p.collisionCooldown = Math.max(0, p.collisionCooldown - dtSec);
        }
      }

      let songFocus = 0;
      let songAgg = 0;
      if (this.activeSong) {
        const mods = getSongStatModifiers(
          this.activeSong.songId,
          this.activeSong.target,
          this.activeSong.multiplier,
          p.team,
          p.role,
          this.cfg,
          this.players
        );
        songFocus = mods.focusDelta;
        songAgg = mods.aggressionDelta;

        if (
          this.activeSong.songId === 'overtime_overture' &&
          this.periodTimeRemainingSec <= 30
        ) {
          songFocus *= 1.6;
          songAgg *= 1.8;
        }
      }

      if (this.opposingOrganist && this.opposingOrganist.activeSongId) {
        const rivalMods = getSongStatModifiers(
          this.opposingOrganist.activeSongId,
          'away',
          1.0,
          p.team,
          p.role,
          this.cfg,
          this.players
        );
        songFocus += rivalMods.focusDelta;
        songAgg += rivalMods.aggressionDelta;
      }

      p.focus = composeEffectiveStat(p.baseFocus, p.moodFocusOffset, songFocus);
      p.aggression = composeEffectiveStat(
        p.baseAggression,
        p.moodAggressionOffset,
        songAgg
      );
    }
  }

  private stepPlayers(dtSec: number): void {
    const holdingGoalie = this.players.find(
      (pl) => pl.role === 'goalie' && pl.mode === 'HOLDING_PUCK'
    );

    for (const p of this.players) {
      if (p.role === 'goalie') {
        p.stamina = clamp(p.stamina - this.cfg.goalieStaminaDrainPerSec * dtSec, 0, 1);

        if (p.mode === 'HOLDING_PUCK') {
          if (this.puck.carrierId !== p.id) {
            p.mode = 'DEFENDING';
            p.stateTimer = 0;
            continue;
          }
          // Goalie holds the puck in the glove while opposing strikers retreat
          const holdTargetY = CENTER_Y;
          p.pos.y += (holdTargetY - p.pos.y) * Math.min(1, dtSec * 6);
          p.pos.x = p.homeSpot.x;
          p.stateTimer -= dtSec;
          if (p.stateTimer <= 0) {
            this.releaseGoalieOutletPass(p);
          }
          continue;
        }

        // Visual tracking along the goal mouth
        const targetY = clamp(this.puck.pos.y, CENTER_Y - 25, CENTER_Y + 25);
        p.pos.y += (targetY - p.pos.y) * Math.min(1, dtSec * 8);
        p.pos.x = p.homeSpot.x;
        continue;
      }

      // Striker state machine
      if (p.mode === 'PENALTY_BOX') {
        p.stamina = clamp(
          p.stamina + this.cfg.penaltyBoxStaminaRecoveryPerSec * dtSec,
          0,
          1
        );
        p.pos = this.getPenaltyBoxPos(p.team, p.id);
        p.vel = { x: 0, y: 0 };
        p.stateTimer -= dtSec;
        if (p.stateTimer <= 0) {
          p.mode = 'DEFENDING';
          p.stateTimer = 0;
          p.collisionCooldown = 1.0;
          p.pos = {
            x: p.team === 'home' ? CENTER_X - 60 : CENTER_X + 60,
            y: 48,
          };
          p.moodAggressionOffset += this.cfg.moodLeaveBoxAggression;
          this.spawnCallout(`#${p.number} BACK ON ICE`, p.pos, '#38bdf8', 1.8);
        }
        continue;
      }

      if (p.mode === 'FIGHTING') {
        p.vel = { x: 0, y: 0 };
        p.stateTimer -= dtSec;

        // Ongoing punch cadence during the brawl
        if (p.isFightInstigator) {
          p.fightPunchCooldown = (p.fightPunchCooldown ?? 0.35) - dtSec;
          if (p.fightPunchCooldown <= 0) {
            p.fightPunchCooldown = 0.36 + this.rng.range(0, 0.24);
            this.audioHooks.onFightImpact?.();
          }
        }

        if (p.stateTimer <= 0) {
          if (p.isFightInstigator) {
            p.mode = 'PENALTY_BOX';
            p.stateTimer = this.cfg.penaltyDurationSec;
            p.fightPartnerId = null;
            p.isFightInstigator = false;
            p.pos = this.getPenaltyBoxPos(p.team, p.id);
            this.audioHooks.onPenaltyWhistle?.();
            this.events.push({
              type: 'PENALTY',
              period: this.period,
              timeRemainingSec: this.periodTimeRemainingSec,
              team: p.team,
              playerId: p.id,
              activeSongId: this.activeSong?.songId ?? null,
              activeSongTarget: this.activeSong?.target ?? null,
            });
            this.spawnCallout(
              `#${p.number} PENALTY BOX (30s)`,
              { x: p.pos.x, y: p.pos.y + 24 },
              '#fb923c',
              2.5
            );
            const pp = getPowerPlayState(this.players);
            if (pp.isPowerPlay) {
              const loadout = this.getActiveSongLoadout();
              if (loadout.includes('power_play_polka') && pp.powerPlayTeam) {
                this.triggerCue(
                  'POWER_PLAY',
                  'power_play_polka',
                  pp.powerPlayTeam,
                  `POWER PLAY (${pp.powerPlayTeam.toUpperCase()})! PLAY POWER PLAY POLKA!`
                );
              } else if (loadout.includes('kill_the_clock') && pp.penaltyKillTeam) {
                this.triggerCue(
                  'PENALTY_KILL',
                  'kill_the_clock',
                  pp.penaltyKillTeam,
                  `SHORTHANDED (${pp.penaltyKillTeam.toUpperCase()})! PLAY KILL THE CLOCK!`
                );
              }
            }
          } else {
            p.stamina = clamp(p.stamina - this.cfg.brawlLoserStaminaHit, 0, 1);
            p.mode = 'STUNNED';
            p.stateTimer = computeRedirectLatency(p.focus, p.aggression, this.cfg);
            p.fightPartnerId = null;
          }
        }
        continue;
      }

      // Active on-ice striker drains stamina
      p.stamina = clamp(p.stamina - this.cfg.strikerStaminaDrainPerSec * dtSec, 0, 1);

      if (p.mode === 'STUNNED') {
        p.vel = { x: p.vel.x * 0.85, y: p.vel.y * 0.85 };
        p.pos.x += p.vel.x * dtSec;
        p.pos.y += p.vel.y * dtSec;
        const clamped = clampSkaterToBoards(p.pos, p.vel, this.cfg.skaterRadius);
        p.pos = clamped.pos;
        p.vel = clamped.vel;
        this.enforceCreaseAndGoalieZones(p);
        p.stateTimer -= dtSec;
        if (p.stateTimer <= 0) {
          p.mode = 'DEFENDING';
          p.stateTimer = 0;
        }
        continue;
      }

      const maxSpeed = computeSkateSpeed(p.stamina, p.aggression, this.cfg);

      if (p.mode === 'POSSESSING') {
        if (this.puck.carrierId !== p.id) {
          p.mode = 'DEFENDING';
          continue;
        }

        p.possessionTimer += dtSec;
        p.passCheckTimer -= dtSec;
        if (!p.attackPath) {
          p.attackPath = createCurvedPathToGoal(p.pos, p.team, this.rng);
        }

        // Evaluate passing to an open / better-positioned teammate if passing is enabled
        if (
          this.cfg.enablePassing &&
          p.possessionTimer >= 0.25 &&
          p.passCheckTimer <= 0
        ) {
          if (this.tryPassPuck(p)) {
            continue;
          }
        }

        const t = clamp(p.possessionTimer / this.cfg.maxPossessionSec, 0, 1);
        const lookAheadT = clamp(t + 0.18, 0, 1);
        const targetPt = evalBezier(p.attackPath, lookAheadT);
        const dir = normalize({
          x: targetPt.x - p.pos.x,
          y: targetPt.y - p.pos.y,
        });

        p.vel = { x: dir.x * maxSpeed, y: dir.y * maxSpeed };
        p.pos.x += p.vel.x * dtSec;
        p.pos.y += p.vel.y * dtSec;
        const clamped = clampSkaterToBoards(p.pos, p.vel, this.cfg.skaterRadius);
        p.pos = clamped.pos;
        p.vel = clamped.vel;

        if (this.enforceCreaseAndGoalieZones(p)) {
          continue;
        }

        // Sirens Waltz Bewitchment: Opposing puck carrier turns 180 and shoots own goal!
        if (
          this.activeSong?.songId === 'sirens_waltz' &&
          doesSongAffectTeam(this.activeSong.target, p.team) &&
          p.team === 'away'
        ) {
          const ownGoal = getOwnGoalPos(p.team);
          const dirToOwn = normalize({
            x: ownGoal.x - p.pos.x,
            y: ownGoal.y - p.pos.y,
          });
          p.vel = { x: dirToOwn.x * maxSpeed, y: dirToOwn.y * maxSpeed };
          p.pos.x += p.vel.x * dtSec;
          p.pos.y += p.vel.y * dtSec;
          p.reactionTimer = 1.0;
          p.reactionColor = '#ec4899';
          const distToOwn = dist(p.pos, ownGoal);
          if (p.possessionTimer >= 2.0 || distToOwn <= 140) {
            this.shootPuck(p, true);
            continue;
          }
          continue;
        }

        // Check Breakaway cue
        this.checkBreakawayCue(p);

        const oppGoal = getOpponentGoalPos(p.team);
        const distToGoal = dist(p.pos, oppGoal);

        // Check Sirens Waltz cue when opponent crosses center ice
        if (
          !this.activeCue &&
          p.team === 'away' &&
          p.pos.x < CENTER_X + 60 &&
          p.pos.x > 320
        ) {
          const loadout = this.getActiveSongLoadout();
          if (loadout.includes('sirens_waltz')) {
            this.triggerCue(
              'CARRIER_TRAPPED',
              'sirens_waltz',
              'away',
              "OPPONENT IN THE TRAP! PLAY THE SIREN'S WALTZ TO CONFUSE!"
            );
          }
        }

        // Check The Fortress cue when opponent gets into dangerous shooting range
        if (!this.activeCue && p.team === 'away' && distToGoal <= 175) {
          const loadout = this.getActiveSongLoadout();
          if (loadout.includes('the_fortress')) {
            this.triggerCue(
              'DANGER_SLOT_SHOT',
              'the_fortress',
              'home',
              'HIGH DANGER CHANCE! PLAY THE FORTRESS FOR GLOVE CATCH!'
            );
          }
        }

        if (
          p.possessionTimer >= this.cfg.maxPossessionSec ||
          distToGoal <= this.cfg.minShotDistance
        ) {
          this.shootPuck(p);
        }
        continue;
      }

      // DEFENDING mode
      let targetPos: Vec2 = this.puck.pos;

      if (holdingGoalie) {
        if (holdingGoalie.team !== p.team) {
          // Opposing goalie caught the puck on a Critical Save -> strikers must retreat toward neutral ice!
          const retreatX =
            holdingGoalie.team === 'home' ? CENTER_X + 45 : CENTER_X - 45;
          const retreatY = p.homeSpot.y;
          targetPos = { x: retreatX, y: retreatY };
        } else {
          // Friendly goalie caught the puck -> skate into open outlet wing lanes to receive the outlet pass!
          const outletX =
            holdingGoalie.team === 'home' ? 285 : RINK_WIDTH - 285;
          const outletY = p.homeSpot.y < CENTER_Y ? 88 : RINK_HEIGHT - 88;
          targetPos = { x: outletX, y: outletY };
        }
      } else if (this.puck.inFlightPassToId === p.id) {
        // Incoming pass targeted at this striker: skate toward the puck to receive it cleanly
        targetPos = {
          x: this.puck.pos.x + this.puck.vel.x * 0.08,
          y: this.puck.pos.y + this.puck.vel.y * 0.08,
        };
      } else if (this.puck.carrierId) {
        const carrier = this.players.find((pl) => pl.id === this.puck.carrierId);
        if (carrier) {
          if (carrier.team === p.team) {
            // Teammate has possession: skate into a supporting offensive wing lane
            const oppGoal = getOpponentGoalPos(p.team);
            const wingY = carrier.pos.y < CENTER_Y ? CENTER_Y + 85 : CENTER_Y - 85;
            targetPos = {
              x: (carrier.pos.x + oppGoal.x) * 0.5,
              y: wingY,
            };
          } else {
            // Opponent has possession: intercept carrier
            targetPos = carrier.pos;
          }
        }
      }

      const toTargetDist = dist(p.pos, targetPos);
      if (holdingGoalie && toTargetDist < 8) {
        p.vel = { x: 0, y: 0 };
      } else {
        const dir = normalize({
          x: targetPos.x - p.pos.x,
          y: targetPos.y - p.pos.y,
        });
        p.vel = { x: dir.x * maxSpeed, y: dir.y * maxSpeed };
      }
      p.pos.x += p.vel.x * dtSec;
      p.pos.y += p.vel.y * dtSec;
      const clamped = clampSkaterToBoards(p.pos, p.vel, this.cfg.skaterRadius);
      p.pos = clamped.pos;
      p.vel = clamped.vel;

      // Enforce crease exclusion & opposing goalie stun BEFORE loose puck pickup
      if (this.enforceCreaseAndGoalieZones(p)) {
        continue;
      }

      // Check loose puck pickup (stunned players never trigger collisions with the puck,
      // and a passer on cooldown does not immediately re-grab their own outgoing pass)
      const isPasserOnCooldown =
        this.puck.inFlightPassFromId === p.id && p.collisionCooldown > 0;
      const pickupRadius =
        this.cfg.skaterRadius +
        this.cfg.puckRadius +
        (this.puck.inFlightPassToId === p.id ? 10 : 2);

      if (
        (p.mode as string) !== 'STUNNED' &&
        !isPasserOnCooldown &&
        this.puck.carrierId === null &&
        dist(p.pos, this.puck.pos) <= pickupRadius
      ) {
        this.gainPossession(p);
      }
    }
  }

  /**
   * Keeps all skaters out of both goal creases (only the goalie is allowed in the crease).
   * If a skater gets too close to the opposing crease or touches the opposing goalie,
   * they are knocked back outside the crease and become STUNNED.
   * Returns true if the player is now STUNNED.
   */
  private enforceCreaseAndGoalieZones(p: PlayerEntity): boolean {
    if (p.role === 'goalie') return false;

    const minCreaseDist = this.cfg.creaseRadius + this.cfg.skaterRadius;
    const minGoalieDist = this.cfg.skaterRadius * 2 + 2;
    const goalTeams: Team[] = ['home', 'away'];

    for (const goalTeam of goalTeams) {
      const creaseCenter: Vec2 = {
        x: goalTeam === 'home' ? HOME_GOAL_X : AWAY_GOAL_X,
        y: CENTER_Y,
      };
      const goalie = this.players.find(
        (pl) => pl.role === 'goalie' && pl.team === goalTeam
      );

      const dCrease = dist(p.pos, creaseCenter);
      const dGoalie = goalie ? dist(p.pos, goalie.pos) : Infinity;

      if (dCrease < minCreaseDist || dGoalie < minGoalieDist) {
        // Compute outward normal from crease center toward the ice in front of the goal
        const rawDx = p.pos.x - creaseCenter.x;
        const frontDx =
          goalTeam === 'home' ? Math.max(6, rawDx) : Math.min(-6, rawDx);
        const rawDy = p.pos.y - creaseCenter.y;
        const norm = normalize({ x: frontDx, y: rawDy });

        if (goalTeam !== p.team) {
          // Opposing crease / opposing goalie contact -> knock back and STUN!
          p.pos = {
            x: creaseCenter.x + norm.x * (minCreaseDist + 3),
            y: clamp(
              creaseCenter.y + norm.y * (minCreaseDist + 3),
              this.cfg.skaterRadius,
              RINK_HEIGHT - this.cfg.skaterRadius
            ),
          };

          if (this.puck.carrierId === p.id) {
            this.puck.carrierId = null;
            this.currentPossessor = null;
            this.puck.pos = {
              x: creaseCenter.x + norm.x * (minCreaseDist + 8),
              y: clamp(
                creaseCenter.y + norm.y * (minCreaseDist + 8),
                this.cfg.puckRadius,
                RINK_HEIGHT - this.cfg.puckRadius
              ),
            };
            this.puck.vel = {
              x: norm.x * 160,
              y: norm.y * 160,
            };
          }

          if (p.mode !== 'STUNNED') {
            p.mode = 'STUNNED';
            p.stateTimer = Math.max(
              1.2,
              computeRedirectLatency(p.focus, p.aggression, this.cfg)
            );
            p.possessionTimer = 0;
            p.attackPath = null;
            p.vel = { x: norm.x * 95, y: norm.y * 95 };
            this.spawnCallout('CREASE STUN!', p.pos, '#fb923c', 1.6);
          }
          return true;
        } else {
          // Own team's crease -> only the goalie is allowed inside; slide skater outside the arc
          p.pos = {
            x: creaseCenter.x + norm.x * minCreaseDist,
            y: clamp(
              creaseCenter.y + norm.y * minCreaseDist,
              this.cfg.skaterRadius,
              RINK_HEIGHT - this.cfg.skaterRadius
            ),
          };
          const dot = p.vel.x * norm.x + p.vel.y * norm.y;
          if (dot < 0) {
            p.vel.x -= dot * norm.x;
            p.vel.y -= dot * norm.y;
          }
        }
      }
    }

    return p.mode === 'STUNNED';
  }

  private checkBreakawayCue(carrier: PlayerEntity): void {
    if (this.activeCue !== null) return;
    const inAttackingThird =
      carrier.team === 'home' ? carrier.pos.x > 640 : carrier.pos.x < 360;
    if (!inAttackingThird) return;

    const defendersAhead = this.players.filter(
      (d) =>
        d.role === 'striker' &&
        d.team !== carrier.team &&
        d.mode !== 'PENALTY_BOX' &&
        d.mode !== 'FIGHTING' &&
        (carrier.team === 'home' ? d.pos.x > carrier.pos.x : d.pos.x < carrier.pos.x)
    );
    if (defendersAhead.length === 0) {
      const loadout = this.getActiveSongLoadout();
      const pp = getPowerPlayState(this.players);
      if (
        pp.isPowerPlay &&
        pp.powerPlayTeam === carrier.team &&
        loadout.includes('power_play_polka')
      ) {
        this.triggerCue(
          'POWER_PLAY',
          'power_play_polka',
          carrier.team,
          `POWER PLAY BREAKAWAY (${carrier.team.toUpperCase()})! PLAY POWER PLAY POLKA!`
        );
      } else if (loadout.includes('charge')) {
        this.triggerCue(
          'BREAKAWAY',
          'charge',
          carrier.team,
          `BREAKAWAY (${carrier.team.toUpperCase()})! PLAY CHARGE!`
        );
      } else if (loadout.includes('madeyalook')) {
        const defTeam = oppositeTeam(carrier.team);
        this.triggerCue(
          'GOALIE_TAUNT',
          'madeyalook',
          defTeam,
          `BREAKAWAY! TAUNT ${defTeam.toUpperCase()} GOALIE — PLAY MADEYALOOK!`
        );
      }
    }
  }

  public gainPossession(striker: PlayerEntity): void {
    // Stunned, fighting, or penalized players never trigger collisions with the puck
    if (
      striker.mode === 'STUNNED' ||
      striker.mode === 'FIGHTING' ||
      striker.mode === 'PENALTY_BOX'
    ) {
      return;
    }
    // Do not allow defenders to casually intercept an unstoppable scoring snipe in flight
    if (this.puck.isScoringShot && this.puck.inFlightShotFrom !== null) {
      return;
    }

    const receivedCleanPass = this.puck.inFlightPassToId === striker.id;
    if (receivedCleanPass) {
      striker.moodFocusOffset += this.cfg.oneTimerFocusBonus;
      striker.reactionTimer = 1.0;
      striker.reactionColor = '#38bdf8';
    }

    const wasCarriedByOther = this.puck.carrierId !== striker.id;
    if (wasCarriedByOther) {
      this.audioHooks.onPuckAction?.('pass');
    }

    this.puck.carrierId = striker.id;
    this.puck.inFlightShotFrom = null;
    this.puck.isScoringShot = false;
    this.puck.shotStartPos = null;
    this.puck.shooterId = null;
    this.puck.inFlightPassToId = null;
    this.puck.inFlightPassFromId = null;
    this.currentPossessor = striker.team;
    this.lastPossessor = striker.team;

    striker.mode = 'POSSESSING';
    striker.possessionTimer = receivedCleanPass ? this.cfg.maxPossessionSec * 0.45 : 0;
    striker.passCheckTimer = this.cfg.passCheckIntervalSec;
    striker.attackPath = createCurvedPathToGoal(striker.pos, striker.team, this.rng);
  }

  /**
   * Evaluates whether a possessing striker should pass to an open teammate.
   * Uses existing Focus and Aggression stats:
   * - pass_tendency = P_passTendency * focus * (1 - 0.5 * aggression)
   * - pass_accuracy = P_passAccuracy * focus * (0.5 + 0.5 * stamina)
   */
  public tryPassPuck(carrier: PlayerEntity): boolean {
    if (!this.cfg.enablePassing) return false;

    const teammate = this.players.find(
      (p) =>
        p.role === 'striker' &&
        p.team === carrier.team &&
        p.id !== carrier.id &&
        p.mode === 'DEFENDING'
    );
    if (!teammate) return false;

    const distBetween = dist(carrier.pos, teammate.pos);
    if (distBetween < 60) return false;

    const oppGoal = getOpponentGoalPos(carrier.team);
    const carrierGoalDist = dist(carrier.pos, oppGoal);
    const teammateGoalDist = dist(teammate.pos, oppGoal);

    const activeOpponents = this.players.filter(
      (d) =>
        d.role === 'striker' &&
        d.team !== carrier.team &&
        d.mode === 'DEFENDING'
    );

    let minOppDistToCarrier = Infinity;
    let minOppDistToTeammate = Infinity;
    for (const opp of activeOpponents) {
      minOppDistToCarrier = Math.min(minOppDistToCarrier, dist(opp.pos, carrier.pos));
      minOppDistToTeammate = Math.min(minOppDistToTeammate, dist(opp.pos, teammate.pos));
    }

    const isPressured = minOppDistToCarrier < 95 && minOppDistToTeammate > 60;
    const isTeammateBetterPositioned =
      teammateGoalDist < carrierGoalDist - 20 && minOppDistToTeammate > 60;

    if (!isPressured && !isTeammateBetterPositioned) {
      return false;
    }

    if (carrier.team === 'home' && !this.activeCue) {
      const loadout = this.getActiveSongLoadout();
      if (loadout.includes('tic_tac_toe')) {
        this.triggerCue(
          'OPEN_PASS_LANE',
          'tic_tac_toe',
          'home',
          'PASSING LANE OPEN! PLAY TIC-TAC-TOE FOR CRISP PASS!'
        );
      }
    }

    carrier.passCheckTimer = this.cfg.passCheckIntervalSec;
    const isTicTacToeActive =
      this.activeSong?.songId === 'tic_tac_toe' &&
      doesSongAffectTeam(this.activeSong.target, carrier.team);

    const tendency = isTicTacToeActive
      ? 0.95
      : computePassTendency(
          carrier.focus,
          carrier.aggression,
          this.cfg
        );
    if (!this.rng.rollAgainst(tendency)) {
      return false;
    }

    this.passPuck(carrier, teammate, false);
    return true;
  }

  public passPuck(
    passer: PlayerEntity,
    receiver: PlayerEntity,
    isGoalieOutlet: boolean = false
  ): void {
    const isTicTacToe =
      this.activeSong?.songId === 'tic_tac_toe' &&
      doesSongAffectTeam(this.activeSong.target, passer.team);

    const accuracy =
      isGoalieOutlet || isTicTacToe
        ? 1.0
        : computePassAccuracy(passer.focus, passer.stamina, this.cfg);
    const isAccurate = isGoalieOutlet || isTicTacToe || this.rng.rollAgainst(accuracy);

    const passDist = dist(passer.pos, receiver.pos);
    const leadSec = clamp(passDist / Math.max(200, this.cfg.passSpeed), 0.06, 0.32);
    const aimX = clamp(
      receiver.pos.x + receiver.vel.x * leadSec,
      HOME_GOAL_X + 48,
      AWAY_GOAL_X - 48
    );
    const aimY = clamp(
      receiver.pos.y + receiver.vel.y * leadSec,
      36,
      RINK_HEIGHT - 36
    );

    let dir = normalize({
      x: aimX - passer.pos.x,
      y: aimY - passer.pos.y,
    });

    if (!isAccurate) {
      const errAngle = this.rng.sign() * this.rng.range(0.32, 0.55);
      const cosA = Math.cos(errAngle);
      const sinA = Math.sin(errAngle);
      dir = {
        x: dir.x * cosA - dir.y * sinA,
        y: dir.x * sinA + dir.y * cosA,
      };
    }

    const speed = isAccurate ? this.cfg.passSpeed : this.cfg.passSpeed * 0.78;

    passer.mode = 'DEFENDING';
    passer.stateTimer = 0;
    passer.possessionTimer = 0;
    passer.passCheckTimer = this.cfg.passCheckIntervalSec;
    passer.attackPath = null;
    passer.collisionCooldown = 0.45;

    const launchOffset =
      passer.role === 'goalie'
        ? this.cfg.creaseRadius + this.cfg.puckRadius + 4
        : this.cfg.skaterRadius + this.cfg.puckRadius + 4;
    const launchOrigin =
      passer.role === 'goalie'
        ? {
            x: passer.team === 'home' ? HOME_GOAL_X : AWAY_GOAL_X,
            y: CENTER_Y,
          }
        : passer.pos;

    const launchPos = {
      x: clamp(
        launchOrigin.x + dir.x * launchOffset,
        this.cfg.puckRadius + 4,
        RINK_WIDTH - this.cfg.puckRadius - 4
      ),
      y: clamp(
        launchOrigin.y + dir.y * launchOffset,
        this.cfg.puckRadius + 4,
        RINK_HEIGHT - this.cfg.puckRadius - 4
      ),
    };

    this.puck.carrierId = null;
    this.currentPossessor = null;
    this.lastPossessor = passer.team;
    this.puck.inFlightShotFrom = null;
    this.puck.isScoringShot = false;
    this.puck.shotStartPos = null;
    this.puck.shooterId = null;
    this.puck.inFlightPassToId = isAccurate ? receiver.id : null;
    this.puck.inFlightPassFromId = passer.id;
    this.puck.pos = launchPos;
    this.puck.vel = { x: dir.x * speed, y: dir.y * speed };
    this.puck.trail = [{ ...launchPos }];

    this.events.push({
      type: 'PASS',
      period: this.period,
      timeRemainingSec: this.periodTimeRemainingSec,
      team: passer.team,
      playerId: passer.id,
      targetPlayerId: receiver.id,
      activeSongId: this.activeSong?.songId ?? null,
      activeSongTarget: this.activeSong?.target ?? null,
    });

    this.audioHooks.onPuckAction?.('pass');
    this.spawnCallout(
      isGoalieOutlet ? 'OUTLET PASS!' : isAccurate ? 'PASS!' : 'WILD PASS!',
      passer.pos,
      isAccurate ? '#38bdf8' : '#fb923c',
      1.4
    );
  }

  public releaseGoalieOutletPass(goalie: PlayerEntity): void {
    goalie.mode = 'DEFENDING';
    goalie.stateTimer = 0;

    const teammates = this.players.filter(
      (p) =>
        p.role === 'striker' &&
        p.team === goalie.team &&
        p.mode !== 'PENALTY_BOX' &&
        p.mode !== 'FIGHTING' &&
        p.mode !== 'STUNNED'
    );

    if (teammates.length > 0) {
      // Pick the most open friendly striker (furthest from opposing defenders)
      const opponents = this.players.filter(
        (d) =>
          d.role === 'striker' &&
          d.team !== goalie.team &&
          d.mode !== 'PENALTY_BOX' &&
          d.mode !== 'FIGHTING'
      );
      let bestTarget = teammates[0];
      let bestClearance = -1;
      for (const tm of teammates) {
        let minOppDist = 9999;
        for (const opp of opponents) {
          minOppDist = Math.min(minOppDist, dist(tm.pos, opp.pos));
        }
        if (minOppDist > bestClearance) {
          bestClearance = minOppDist;
          bestTarget = tm;
        }
      }
      this.passPuck(goalie, bestTarget, true);
      return;
    }

    // Fallback if both teammates are in the penalty box or fighting: clear puck toward center ice
    const dirX = goalie.team === 'home' ? 1 : -1;
    const clearAngle = this.rng.sign() * 0.35;
    const vx = dirX * Math.cos(clearAngle) * this.cfg.passSpeed;
    const vy = Math.sin(clearAngle) * this.cfg.passSpeed;
    const creaseX = goalie.team === 'home' ? HOME_GOAL_X : AWAY_GOAL_X;
    this.puck.carrierId = null;
    this.currentPossessor = null;
    this.lastPossessor = goalie.team;
    this.puck.inFlightPassToId = null;
    this.puck.inFlightPassFromId = goalie.id;
    this.puck.pos = {
      x: creaseX + dirX * (this.cfg.creaseRadius + this.cfg.puckRadius + 6),
      y: CENTER_Y,
    };
    this.puck.vel = { x: vx, y: vy };
    this.spawnCallout('GOALIE CLEAR!', goalie.pos, '#38bdf8', 1.4);
  }

  public shootPuck(striker: PlayerEntity, isOwnGoal: boolean = false): void {
    const oppGoal = isOwnGoal ? getOwnGoalPos(striker.team) : getOpponentGoalPos(striker.team);
    const defTeam = isOwnGoal ? striker.team : oppositeTeam(striker.team);
    const goalie = this.players.find(
      (p) => p.role === 'goalie' && p.team === defTeam
    );

    const shooterAccuracy = isOwnGoal ? 0.95 : computeShooterAccuracy(striker.focus, this.cfg);
    const blockChance = isOwnGoal
      ? 0.05
      : goalie
      ? computeGoalieBlockChance(goalie.focus, goalie.stamina, this.cfg)
      : 0;
    const goalChance = isOwnGoal ? 0.90 : computeGoalChance(shooterAccuracy, blockChance, this.cfg);

    // Pre-roll at shot release so we know immediately if this shot is going in!
    const isScoringShot = this.rng.rollAgainst(goalChance);

    const scatterY = isScoringShot
      ? this.rng.range(-10, 10)
      : this.rng.range(-18, 18) * (1 - striker.focus * 0.6);

    const targetX = isScoringShot
      ? defTeam === 'home'
        ? HOME_GOAL_X - 14
        : AWAY_GOAL_X + 14
      : oppGoal.x;

    const aimPoint = { x: targetX, y: oppGoal.y + scatterY };
    const dir = normalize({
      x: aimPoint.x - striker.pos.x,
      y: aimPoint.y - striker.pos.y,
    });
    const baseSpeed = this.cfg.shotBaseSpeed * (0.6 + 0.4 * striker.focus);
    const speed = isScoringShot ? baseSpeed * 1.22 : baseSpeed;

    striker.mode = 'DEFENDING';
    striker.possessionTimer = 0;
    striker.attackPath = null;
    striker.collisionCooldown = 0.35;

    const launchPos = {
      x: striker.pos.x + dir.x * (this.cfg.skaterRadius + 4),
      y: striker.pos.y + dir.y * (this.cfg.skaterRadius + 4),
    };

    this.puck.carrierId = null;
    this.currentPossessor = null;
    this.lastPossessor = striker.team;
    this.puck.inFlightShotFrom = striker.team;
    this.puck.isScoringShot = isScoringShot;
    this.puck.shotStartPos = { ...launchPos };
    this.puck.shooterAccuracy = shooterAccuracy;
    this.puck.shooterId = striker.id;
    this.puck.inFlightPassToId = null;
    this.puck.inFlightPassFromId = null;
    this.puck.pos = launchPos;
    this.puck.vel = { x: dir.x * speed, y: dir.y * speed };
    this.puck.trail = [{ ...launchPos }];

    if (isOwnGoal) {
      this.spawnCallout('🌀 BEWITCHED! OWN GOAL SHOT!', striker.pos, '#ec4899', 2.0);
    } else if (isScoringShot) {
      striker.reactionTimer = 1.2;
      striker.reactionColor = '#facc15';
      this.spawnCallout('⚡ SNIPE! ⚡', striker.pos, '#facc15', 1.1);
    }

    this.audioHooks.onPuckAction?.('shot');
    this.events.push({
      type: 'SHOT',
      period: this.period,
      timeRemainingSec: this.periodTimeRemainingSec,
      team: striker.team,
      playerId: striker.id,
      activeSongId: this.activeSong?.songId ?? null,
      activeSongTarget: this.activeSong?.target ?? null,
    });

    if (!isScoringShot && !isOwnGoal) {
      this.triggerCue(
        'SHOT_OR_REBOUND',
        'hold_the_line',
        defTeam,
        `SHOT INCOMING! PLAY HOLD THE LINE (${defTeam.toUpperCase()})!`
      );
    }
  }

  private resolveSkaterCollisions(): void {
    const activeStrikers = this.players.filter(
      (p) =>
        p.role === 'striker' &&
        p.mode !== 'PENALTY_BOX' &&
        p.mode !== 'FIGHTING' &&
        p.mode !== 'STUNNED'
    );

    const minDist = this.cfg.skaterRadius * 2;

    for (let i = 0; i < activeStrikers.length; i++) {
      for (let j = i + 1; j < activeStrikers.length; j++) {
        const a = activeStrikers[i];
        const b = activeStrikers[j];
        const d = dist(a.pos, b.pos);
        if (d >= minDist || d < 1e-5) continue;

        const overlap = minDist - d;
        const nx = (b.pos.x - a.pos.x) / d;
        const ny = (b.pos.y - a.pos.y) / d;

        // Gently separate overlapping circles
        a.pos.x -= nx * (overlap * 0.5);
        a.pos.y -= ny * (overlap * 0.5);
        b.pos.x += nx * (overlap * 0.5);
        b.pos.y += ny * (overlap * 0.5);

        // Teammates only gently separate
        if (a.team === b.team) continue;

        // Opponent collision
        if (
          a.collisionCooldown > 0 ||
          b.collisionCooldown > 0 ||
          a.mode === 'STUNNED' ||
          b.mode === 'STUNNED'
        ) {
          continue;
        }

        a.collisionCooldown = 0.45;
        b.collisionCooldown = 0.45;
        a.stamina = clamp(a.stamina - this.cfg.strikerCollisionStaminaDrain, 0, 1);
        b.stamina = clamp(b.stamina - this.cfg.strikerCollisionStaminaDrain, 0, 1);

        const aHasPuck = this.puck.carrierId === a.id;
        const bHasPuck = this.puck.carrierId === b.id;

        if (aHasPuck || bHasPuck) {
          const carrier = aHasPuck ? a : b;
          const defender = aHasPuck ? b : a;
          this.handleCarrierCollision(defender, carrier);
        } else {
          // Neither has possession: push each other push_strength away
          const push = this.cfg.pushStrength * 0.5;
          a.pos.x = clamp(a.pos.x - nx * push, this.cfg.skaterRadius, RINK_WIDTH - this.cfg.skaterRadius);
          a.pos.y = clamp(a.pos.y - ny * push, this.cfg.skaterRadius, RINK_HEIGHT - this.cfg.skaterRadius);
          b.pos.x = clamp(b.pos.x + nx * push, this.cfg.skaterRadius, RINK_WIDTH - this.cfg.skaterRadius);
          b.pos.y = clamp(b.pos.y + ny * push, this.cfg.skaterRadius, RINK_HEIGHT - this.cfg.skaterRadius);

          a.moodAggressionOffset += this.cfg.moodPushedAggression;
          b.moodAggressionOffset += this.cfg.moodPushedAggression;
        }
      }
    }
  }

  public handleCarrierCollision(defender: PlayerEntity, carrier: PlayerEntity): void {
    const stealChance = computeStealChance(defender.focus, defender.aggression, this.cfg);
    if (this.rng.rollAgainst(stealChance)) {
      // Steal succeeds!
      carrier.mode = 'STUNNED';
      carrier.stateTimer = computeRedirectLatency(
        carrier.focus,
        carrier.aggression,
        this.cfg
      );
      carrier.possessionTimer = 0;
      carrier.attackPath = null;
      carrier.moodAggressionOffset += this.cfg.moodRobbedAggression;
      carrier.moodFocusOffset += this.cfg.moodRobbedFocus;

      defender.moodFocusOffset += this.cfg.moodStealFocus;
      this.gainPossession(defender);

      this.events.push({
        type: 'STEAL',
        period: this.period,
        timeRemainingSec: this.periodTimeRemainingSec,
        team: defender.team,
        playerId: defender.id,
        activeSongId: this.activeSong?.songId ?? null,
        activeSongTarget: this.activeSong?.target ?? null,
      });

      this.audioHooks.onPuckAction?.('steal');
      this.spawnCallout('STEAL!', defender.pos, '#2dd4bf', 1.8);
      this.triggerCue(
        'TEMPER_FLARING',
        'grudge_toccata',
        'both',
        'TEMPER FLARING AFTER ROBBERY! PLAY GRUDGE TOCCATA!'
      );
      return;
    }

    // Steal failed -> roll against fight_chance
    const fightChance = computeFightChance(defender.focus, defender.aggression, this.cfg);
    if (this.rng.rollAgainst(fightChance)) {
      this.startFight(defender, carrier);
    } else {
      // Defender stops moving for redirect_latency
      defender.mode = 'STUNNED';
      defender.stateTimer = computeRedirectLatency(
        defender.focus,
        defender.aggression,
        this.cfg
      );
      this.triggerCue(
        'TEMPER_FLARING',
        'grudge_toccata',
        'both',
        'HEAVY HIT — TEMPERS FLARING! PLAY GRUDGE TOCCATA!'
      );
    }
  }

  public startFight(instigator: PlayerEntity, victim: PlayerEntity): void {
    instigator.mode = 'FIGHTING';
    instigator.stateTimer = this.cfg.brawlDurationSec;
    instigator.fightPartnerId = victim.id;
    instigator.isFightInstigator = true;
    instigator.fightPunchCooldown = 0.35;
    instigator.vel = { x: 0, y: 0 };
    instigator.attackPath = null;

    victim.mode = 'FIGHTING';
    victim.stateTimer = this.cfg.brawlDurationSec;
    victim.fightPartnerId = instigator.id;
    victim.isFightInstigator = false;
    victim.vel = { x: 0, y: 0 };
    victim.attackPath = null;

    // Pop puck loose
    this.puck.carrierId = null;
    this.currentPossessor = null;
    const angle = this.rng.range(0, Math.PI * 2);
    this.puck.vel = {
      x: Math.cos(angle) * 180,
      y: Math.sin(angle) * 180,
    };

    this.adjustCrowdVolume(this.cfg.fightCrowdBoost);

    this.events.push({
      type: 'FIGHT',
      period: this.period,
      timeRemainingSec: this.periodTimeRemainingSec,
      team: instigator.team,
      playerId: instigator.id,
      activeSongId: this.activeSong?.songId ?? null,
      activeSongTarget: this.activeSong?.target ?? null,
    });

    this.audioHooks.onFightImpact?.();
    const mid = {
      x: (instigator.pos.x + victim.pos.x) * 0.5,
      y: (instigator.pos.y + victim.pos.y) * 0.5 - 28,
    };
    const brawlColor = instigator.team === 'home' ? '#38bdf8' : '#f43f5e';
    const instigatorTeamName = instigator.team === 'home' ? 'HOME' : 'AWAY';
    this.spawnCallout(
      `🥊 BRAWL! (${instigatorTeamName} PENALTY) 🥊`,
      mid,
      brawlColor,
      3.0
    );
  }

  private stepPuck(dtSec: number): void {
    if (this.puck.carrierId !== null) {
      const carrier = this.players.find((p) => p.id === this.puck.carrierId);
      if (carrier && carrier.role === 'goalie' && carrier.mode === 'HOLDING_PUCK') {
        const gloveOffsetX = carrier.team === 'home' ? 12 : -12;
        this.puck.pos = {
          x: carrier.pos.x + gloveOffsetX,
          y: carrier.pos.y + 4,
        };
        this.puck.vel = { x: 0, y: 0 };
        this.recordPuckTrail();
        return;
      } else if (carrier && carrier.mode === 'POSSESSING') {
        const dir = normalize(carrier.vel);
        this.puck.pos = {
          x: clamp(carrier.pos.x + dir.x * 14, this.cfg.puckRadius, RINK_WIDTH - this.cfg.puckRadius),
          y: clamp(carrier.pos.y + dir.y * 14, this.cfg.puckRadius, RINK_HEIGHT - this.cfg.puckRadius),
        };
        this.puck.vel = { ...carrier.vel };
        this.recordPuckTrail();
        return;
      } else {
        this.puck.carrierId = null;
        this.currentPossessor = null;
      }
    }

    // Loose or shot puck integration
    this.puck.pos.x += this.puck.vel.x * dtSec;
    this.puck.pos.y += this.puck.vel.y * dtSec;
    if (!this.puck.isScoringShot) {
      this.puck.vel = applyPuckFriction(this.puck.vel, dtSec, this.cfg);
      if (Math.hypot(this.puck.vel.x, this.puck.vel.y) < 35) {
        this.puck.inFlightPassToId = null;
        this.puck.inFlightPassFromId = null;
      }
    }

    // Check shot interception by opposing goalie or goal-line crossing into net
    if (this.puck.inFlightShotFrom !== null) {
      const defendingTeam = oppositeTeam(this.puck.inFlightShotFrom);
      const goalie = this.players.find(
        (p) => p.role === 'goalie' && p.team === defendingTeam
      );
      if (goalie) {
        if (this.puck.isScoringShot) {
          // Scoring shot flies past the crease and only registers once it crosses into the back of the net!
          const crossedIntoNet =
            (defendingTeam === 'home' && this.puck.pos.x <= HOME_GOAL_X - 8) ||
            (defendingTeam === 'away' && this.puck.pos.x >= AWAY_GOAL_X + 8);
          if (crossedIntoNet) {
            this.recordPuckTrail();
            this.completeGoal(goalie);
            return;
          }
        } else {
          // Saved shot is intercepted at the goalie crease
          const reachedGoalieCrease =
            dist(this.puck.pos, goalie.pos) <= this.cfg.creaseRadius ||
            (defendingTeam === 'home' && this.puck.pos.x <= HOME_GOAL_X + 14) ||
            (defendingTeam === 'away' && this.puck.pos.x >= AWAY_GOAL_X - 14);

          if (reachedGoalieCrease) {
            this.resolveGoalieSave(goalie);
            return;
          }
        }
      }
    }

    if (!this.puck.isScoringShot) {
      const bounced = collidePuckWithBoards(
        this.puck.pos,
        this.puck.vel,
        this.cfg.puckRadius,
        this.cfg.boardRestitution
      );
      this.puck.pos = bounced.pos;
      this.puck.vel = bounced.vel;
      if (bounced.bounced) {
        this.puck.inFlightShotFrom = null;
        this.puck.inFlightPassToId = null;
        this.puck.inFlightPassFromId = null;
      }

      // If a loose puck drifts into either goalie-only crease, the goalie pokes it out
      const goalTeams: Team[] = ['home', 'away'];
      for (const goalTeam of goalTeams) {
        const creaseCenter: Vec2 = {
          x: goalTeam === 'home' ? HOME_GOAL_X : AWAY_GOAL_X,
          y: CENTER_Y,
        };
        if (dist(this.puck.pos, creaseCenter) <= this.cfg.creaseRadius) {
          const rawDx = this.puck.pos.x - creaseCenter.x;
          const frontDx =
            goalTeam === 'home' ? Math.max(6, rawDx) : Math.min(-6, rawDx);
          const norm = normalize({
            x: frontDx,
            y: this.puck.pos.y - creaseCenter.y,
          });
          this.puck.pos = {
            x: creaseCenter.x + norm.x * (this.cfg.creaseRadius + this.cfg.puckRadius + 2),
            y: clamp(
              creaseCenter.y + norm.y * (this.cfg.creaseRadius + this.cfg.puckRadius + 2),
              this.cfg.puckRadius,
              RINK_HEIGHT - this.cfg.puckRadius
            ),
          };
          const incomingSpeed = Math.hypot(this.puck.vel.x, this.puck.vel.y);
          this.puck.vel = computeReboundVelocity(
            goalTeam,
            this.puck.pos.y,
            Math.max(240, incomingSpeed),
            this.cfg,
            this.rng
          );
          this.puck.inFlightShotFrom = null;
          this.puck.inFlightPassToId = null;
          this.puck.inFlightPassFromId = null;
        }
      }
    }

    this.recordPuckTrail();
  }

  private recordPuckTrail(): void {
    this.puck.trail.push({ x: this.puck.pos.x, y: this.puck.pos.y });
    const maxLen = this.puck.isScoringShot ? 22 : 10;
    while (this.puck.trail.length > maxLen) {
      this.puck.trail.shift();
    }
  }

  private completeGoal(goalie: PlayerEntity): void {
    const attackingTeam = oppositeTeam(goalie.team);
    if (attackingTeam === 'home') {
      this.homeScore += 1;
    } else {
      this.awayScore += 1;
    }

    this.adjustCrowdVolume(this.cfg.goalCrowdBoost);

    // Apply mood shifts
    for (const p of this.players) {
      if (p.id === this.puck.shooterId) {
        p.moodFocusOffset += this.cfg.moodGoalScorerFocus;
      }
      if (p.team === attackingTeam && p.role === 'striker') {
        p.moodAggressionOffset += this.cfg.moodGoalTeamAggression;
      }
      if (p.team === goalie.team) {
        if (p.role === 'goalie') {
          p.moodFocusOffset += this.cfg.moodConcedeGoalieFocus;
        } else {
          p.moodAggressionOffset += this.cfg.moodConcedeTeamAggression;
        }
      }
    }

    this.events.push({
      type: 'GOAL',
      period: this.period,
      timeRemainingSec: this.periodTimeRemainingSec,
      team: attackingTeam,
      playerId: this.puck.shooterId ?? undefined,
      activeSongId: this.activeSong?.songId ?? null,
      activeSongTarget: this.activeSong?.target ?? null,
    });

    this.puck.inFlightShotFrom = null;
    this.puck.isScoringShot = false;
    this.puck.inFlightPassToId = null;
    this.puck.inFlightPassFromId = null;
    this.puck.vel = { x: 0, y: 0 };
    this.puck.pos = {
      x: goalie.team === 'home' ? HOME_GOAL_X - 11 : AWAY_GOAL_X + 11,
      y: clamp(this.puck.pos.y, CENTER_Y - 22, CENTER_Y + 22),
    };

    this.spawnCallout(
      `🚨 GOAL ${attackingTeam.toUpperCase()}! 🚨`,
      { x: CENTER_X, y: CENTER_Y - 20 },
      attackingTeam === 'home' ? '#38bdf8' : '#f87171',
      2.6
    );
    this.audioHooks.onGoalHorn?.();

    this.phase = 'GOAL_CELEBRATION';
    this.phaseTimerSec = 2.6;
  }

  private resolveGoalieSave(goalie: PlayerEntity): void {
    const isTheFortressActive =
      this.activeSong?.songId === 'the_fortress' &&
      doesSongAffectTeam(this.activeSong.target, goalie.team);

    const critChance = isTheFortressActive
      ? 1.0
      : computeCritSaveChance(
          goalie.focus,
          goalie.stamina,
          this.cfg
        );
    const isCritSave = isTheFortressActive || this.rng.rollAgainst(critChance);

    this.puck.inFlightShotFrom = null;
    this.puck.isScoringShot = false;
    this.puck.shotStartPos = null;
    this.puck.shooterId = null;
    this.puck.inFlightPassToId = null;
    this.puck.inFlightPassFromId = null;

    if (isCritSave) {
      // CRITICAL SAVE (GLOVE CATCH & HOLD):
      // Goalie catches and holds the puck, forcing opposing strikers to retreat
      // before the goalie sends an outlet pass to a teammate!
      goalie.mode = 'HOLDING_PUCK';
      goalie.stateTimer = this.cfg.goalieHoldDurationSec;
      goalie.stamina = clamp(
        goalie.stamina - this.cfg.goalieSaveStaminaDrain,
        0,
        1
      );
      goalie.moodFocusOffset += this.cfg.moodSaveGoalieFocus;
      goalie.reactionTimer = 1.4;
      goalie.reactionColor = '#facc15';

      this.puck.carrierId = goalie.id;
      this.currentPossessor = goalie.team;
      this.lastPossessor = goalie.team;
      const gloveOffsetX = goalie.team === 'home' ? 12 : -12;
      this.puck.pos = {
        x: goalie.pos.x + gloveOffsetX,
        y: goalie.pos.y + 4,
      };
      this.puck.vel = { x: 0, y: 0 };

      this.events.push({
        type: 'SAVE',
        period: this.period,
        timeRemainingSec: this.periodTimeRemainingSec,
        team: goalie.team,
        playerId: goalie.id,
        isCritSave: true,
        activeSongId: this.activeSong?.songId ?? null,
        activeSongTarget: this.activeSong?.target ?? null,
      });

      this.spawnCallout('🧤 CRIT SAVE! (HOLD)', goalie.pos, '#facc15', 1.8);
      this.triggerCue(
        'BREAKAWAY',
        'charge',
        goalie.team,
        `GLOVE CATCH! PLAY CHARGE (${goalie.team.toUpperCase()}) FOR COUNTER-ATTACK!`
      );
      return;
    }

    // STANDARD REBOUND SAVE: BLOCKED / REDIRECTED AT 60 DEGREES TOWARD HORIZONTAL CENTER LINE
    const incomingSpeed = Math.hypot(this.puck.vel.x, this.puck.vel.y);
    this.puck.vel = computeReboundVelocity(
      goalie.team,
      this.puck.pos.y,
      incomingSpeed,
      this.cfg,
      this.rng
    );

    goalie.stamina = clamp(
      goalie.stamina - this.cfg.goalieSaveStaminaDrain,
      0,
      1
    );
    goalie.moodFocusOffset += this.cfg.moodSaveGoalieFocus;

    this.events.push({
      type: 'SAVE',
      period: this.period,
      timeRemainingSec: this.periodTimeRemainingSec,
      team: goalie.team,
      playerId: goalie.id,
      isCritSave: false,
      activeSongId: this.activeSong?.songId ?? null,
      activeSongTarget: this.activeSong?.target ?? null,
    });

    this.spawnCallout('BIG SAVE!', goalie.pos, '#2dd4bf', 1.8);
    this.triggerCue(
      'SHOT_OR_REBOUND',
      'hold_the_line',
      goalie.team,
      `REBOUND LOOSE! PLAY HOLD THE LINE (${goalie.team.toUpperCase()})!`
    );
  }
}
