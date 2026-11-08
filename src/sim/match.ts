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
  computeFightChance,
  computeGoalChance,
  computeGoalieBlockChance,
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

export interface MatchAudioHooks {
  onWhistle?: () => void;
  onGoalHorn?: () => void;
  onSongPlay?: (songId: SongId, cueHit: boolean, stale: boolean) => void;
}

export class MatchSimulation {
  public cfg: GameConfig;
  public rng: SeededRNG;
  public orderId: OrderId;
  public audioHooks: MatchAudioHooks = {};

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
    this.puck.pos = { x: CENTER_X, y: CENTER_Y };
    this.puck.vel = { x: 0, y: 0 };
    this.puck.trail = [];
    this.currentPossessor = null;

    for (const p of this.players) {
      p.attackPath = null;
      p.possessionTimer = 0;
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
  }

  private getPenaltyBoxPos(team: Team, playerId: string): Vec2 {
    const slotOffset = playerId.endsWith('2') ? 18 : -18;
    return {
      x: team === 'home' ? CENTER_X - 75 + slotOffset : CENTER_X + 75 + slotOffset,
      y: 20,
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

    // Restore stamina and clear all penalties / brawls / stuns between periods
    for (const p of this.players) {
      p.stamina = 1.0;
      p.mode = 'DEFENDING';
      p.stateTimer = 0;
      p.possessionTimer = 0;
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
    this.activeCue = {
      type,
      matchingSong,
      recommendedTarget,
      bannerText,
      remainingSec: this.cfg.cueWindowDurationSec,
    };
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

    // Update player effective stats & mood drift
    this.updateEffectiveStats(dtSec);

    // Handle Faceoff countdown or Goal celebration phases
    if (this.phase === 'FACEOFF_COUNTDOWN') {
      this.phaseTimerSec -= dtSec;
      if (this.phaseTimerSec <= 0) {
        this.phase = 'PLAYING';
        const angle = this.rng.range(0, Math.PI * 2);
        const nudgeSpeed = this.rng.range(45, 95);
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
      this.audioHooks.onWhistle?.();
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
    for (const p of this.players) {
      if (p.role === 'goalie') {
        p.stamina = clamp(p.stamina - this.cfg.goalieStaminaDrainPerSec * dtSec, 0, 1);
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
        if (p.stateTimer <= 0) {
          if (p.isFightInstigator) {
            p.mode = 'PENALTY_BOX';
            p.stateTimer = this.cfg.penaltyDurationSec;
            p.fightPartnerId = null;
            p.isFightInstigator = false;
            p.pos = this.getPenaltyBoxPos(p.team, p.id);
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
        if (!p.attackPath) {
          p.attackPath = createCurvedPathToGoal(p.pos, p.team, this.rng);
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

        // Check Breakaway cue
        this.checkBreakawayCue(p);

        const oppGoal = getOpponentGoalPos(p.team);
        const distToGoal = dist(p.pos, oppGoal);
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
      if (this.puck.carrierId) {
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

      const dir = normalize({
        x: targetPos.x - p.pos.x,
        y: targetPos.y - p.pos.y,
      });
      p.vel = { x: dir.x * maxSpeed, y: dir.y * maxSpeed };
      p.pos.x += p.vel.x * dtSec;
      p.pos.y += p.vel.y * dtSec;
      const clamped = clampSkaterToBoards(p.pos, p.vel, this.cfg.skaterRadius);
      p.pos = clamped.pos;
      p.vel = clamped.vel;

      // Enforce crease exclusion & opposing goalie stun BEFORE loose puck pickup
      if (this.enforceCreaseAndGoalieZones(p)) {
        continue;
      }

      // Check loose puck pickup (stunned players never trigger collisions with the puck)
      if (
        (p.mode as string) !== 'STUNNED' &&
        this.puck.carrierId === null &&
        dist(p.pos, this.puck.pos) <= this.cfg.skaterRadius + this.cfg.puckRadius + 2
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
    this.puck.carrierId = striker.id;
    this.puck.inFlightShotFrom = null;
    this.puck.isScoringShot = false;
    this.puck.shotStartPos = null;
    this.puck.shooterId = null;
    this.currentPossessor = striker.team;
    this.lastPossessor = striker.team;

    striker.mode = 'POSSESSING';
    striker.possessionTimer = 0;
    striker.attackPath = createCurvedPathToGoal(striker.pos, striker.team, this.rng);
  }

  public shootPuck(striker: PlayerEntity): void {
    const oppGoal = getOpponentGoalPos(striker.team);
    const defTeam = oppositeTeam(striker.team);
    const goalie = this.players.find(
      (p) => p.role === 'goalie' && p.team === defTeam
    );

    const shooterAccuracy = computeShooterAccuracy(striker.focus, this.cfg);
    const blockChance = goalie
      ? computeGoalieBlockChance(goalie.focus, goalie.stamina, this.cfg)
      : 0;
    const goalChance = computeGoalChance(shooterAccuracy, blockChance, this.cfg);

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
    this.puck.pos = launchPos;
    this.puck.vel = { x: dir.x * speed, y: dir.y * speed };
    this.puck.trail = [{ ...launchPos }];

    if (isScoringShot) {
      striker.reactionTimer = 1.2;
      striker.reactionColor = '#facc15';
      this.spawnCallout('⚡ SNIPE! ⚡', striker.pos, '#facc15', 1.1);
    }

    this.events.push({
      type: 'SHOT',
      period: this.period,
      timeRemainingSec: this.periodTimeRemainingSec,
      team: striker.team,
      playerId: striker.id,
      activeSongId: this.activeSong?.songId ?? null,
      activeSongTarget: this.activeSong?.target ?? null,
    });

    if (!isScoringShot) {
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

    const mid = {
      x: (instigator.pos.x + victim.pos.x) * 0.5,
      y: (instigator.pos.y + victim.pos.y) * 0.5,
    };
    this.spawnCallout('🥊 BRAWL! 🥊', mid, '#f43f5e', 3.0);
  }

  private stepPuck(dtSec: number): void {
    if (this.puck.carrierId !== null) {
      const carrier = this.players.find((p) => p.id === this.puck.carrierId);
      if (carrier && carrier.mode === 'POSSESSING') {
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
          // Saved shot is intercepted at the goalie crease and redirected at 60 degrees
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
    // BLOCKED / REDIRECTED AT 60 DEGREES TOWARD HORIZONTAL CENTER LINE
    const incomingSpeed = Math.hypot(this.puck.vel.x, this.puck.vel.y);
    this.puck.vel = computeReboundVelocity(
      goalie.team,
      this.puck.pos.y,
      incomingSpeed,
      this.cfg,
      this.rng
    );
    this.puck.inFlightShotFrom = null;
    this.puck.isScoringShot = false;
    this.puck.shotStartPos = null;
    this.puck.shooterId = null;

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
