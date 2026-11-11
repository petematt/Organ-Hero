import { evaluateOrder, getOrderById } from '../game/orders';
import { doesSongAffectTeam, SONGS } from '../game/songs';
import { buildStatsSummary, PeriodStatsSummary } from '../game/stats';
import { MatchSimulation } from '../sim/match';
import {
  AWAY_GOAL_X,
  CENTER_X,
  CENTER_Y,
  GOAL_HALF_WIDTH,
  HOME_GOAL_X,
  RINK_CORNER_RADIUS,
  RINK_HEIGHT,
  RINK_WIDTH,
} from '../sim/physics';
import { clamp } from '../sim/rng';
import { PlayerEntity, Team, Vec2 } from '../sim/types';

export interface IceSummaryCallbacks {
  onContinueNextPeriod: () => void;
  onPlayAgainNewSeed: () => void;
  onPlayAgainSameSeed: () => void;
  onChangeOrder: () => void;
  onOpenShop?: () => void;
}

interface IceButton {
  id: string;
  label: string;
  rect: { x: number; y: number; w: number; h: number };
  primary: boolean;
  onClick: () => void;
}

interface CornerSnowFlake {
  x: number;
  y: number;
  r: number;
  alpha: number;
}

function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export class RinkRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  public showStatBars: boolean = true; // Default ON per user requirement
  private animTime: number = 0;

  // Dynamic camera zoom & focus state for scoring shots and goal impacts
  private camZoom: number = 1.0;
  private camFocusX: number = CENTER_X;
  private camFocusY: number = CENTER_Y;

  // Intermission & Game-End on-ice summary state
  private callbacks: IceSummaryCallbacks | null = null;
  private isIceSummaryActive: boolean = false;
  private summaryEnterElapsedSec: number = 0;
  private intermissionZoomBlend: number = 0; // 0 = normal play view, 1 = full-screen center ice
  private skateOffStartPos: Map<string, Vec2> = new Map();

  // Vertical drag scrolling on zoomed-in ice
  private iceScrollFocusY: number = 148;
  private iceScrollVelY: number = 0;
  private isDraggingIce: boolean = false;
  private dragLastClientY: number = 0;
  private dragTotalDistPx: number = 0;
  private hoveredButtonId: string | null = null;
  private iceButtons: IceButton[] = [];

  // Zamboni big-eraser & camera pullback state
  private isZamboniClearing: boolean = false;
  private zamboniProgress: number = 0;
  private zamboniStartScrollY: number = CENTER_Y;
  private zamboniOnFinish: (() => void) | null = null;

  // Dynamic ice wear (skate cuts & corner snow mounds) cleared by Zamboni
  private iceWearCanvas: HTMLCanvasElement;
  private iceWearCtx: CanvasRenderingContext2D;
  private cornerSnowFlakes: CornerSnowFlake[] = [];
  private cornerSnowLevel: number = 0; // 0.0 (fresh ice) to 1.0 (heavy wear/snow)
  private ambientScratchTimerSec: number = 0;

  // Cached screen-to-rink transform parameters for pointer hit testing & drag scaling
  private lastScreenCenterX: number = 0;
  private lastScreenCenterY: number = 0;
  private lastCssScale: number = 1;
  private penaltyBoxExpand: Record<Team, number> = { home: 0, away: 0 };

  // Offscreen canvas used so the Zamboni's 2-loop path erases the on-ice stats like a real squeegee
  private summaryCanvas: HTMLCanvasElement;
  private summaryCtx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement, callbacks?: IceSummaryCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks ?? null;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not initialize 2D canvas context');
    }
    this.ctx = context;

    this.summaryCanvas = document.createElement('canvas');
    const sCtx = this.summaryCanvas.getContext('2d');
    if (!sCtx) {
      throw new Error('Could not initialize offscreen summary 2D context');
    }
    this.summaryCtx = sCtx;

    this.iceWearCanvas = document.createElement('canvas');
    this.iceWearCanvas.width = RINK_WIDTH;
    this.iceWearCanvas.height = RINK_HEIGHT;
    const iwCtx = this.iceWearCanvas.getContext('2d');
    if (!iwCtx) {
      throw new Error('Could not initialize offscreen ice wear 2D context');
    }
    this.iceWearCtx = iwCtx;
    this.initCornerSnowFlakes();

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindIcePointerEvents();
  }

  public setCallbacks(callbacks: IceSummaryCallbacks): void {
    this.callbacks = callbacks;
  }

  public isSummaryOrZamboniActive(): boolean {
    return this.isIceSummaryActive || this.isZamboniClearing;
  }

  /**
   * Triggered when a period ends (PERIOD_END) or the match ends (MATCH_OVER).
   * Players skate off the ice, UI above/below retracts, and camera zooms in on center ice.
   */
  public beginIceSummary(sim: MatchSimulation): void {
    this.isIceSummaryActive = true;
    this.isZamboniClearing = false;
    this.zamboniProgress = 0;
    this.summaryEnterElapsedSec = 0;
    this.iceScrollFocusY = 148;
    this.iceScrollVelY = 0;
    this.hoveredButtonId = null;

    this.skateOffStartPos.clear();
    for (const p of sim.players) {
      this.skateOffStartPos.set(p.id, { x: p.pos.x, y: p.pos.y });
    }

    const viewport = document.getElementById('app-viewport');
    viewport?.classList.add('ice-focus-mode');
  }

  /**
   * Immediately exits on-ice summary mode without Zamboni (e.g. when resetting from debug panel).
   */
  public resetIceSummaryImmediate(): void {
    this.isIceSummaryActive = false;
    this.isZamboniClearing = false;
    this.zamboniProgress = 0;
    this.intermissionZoomBlend = 0;
    this.iceButtons = [];
    this.clearIceWear();
    const viewport = document.getElementById('app-viewport');
    viewport?.classList.remove('ice-focus-mode');
  }

  /**
   * Starts the synchronized camera pullback + Zamboni eraser sweep across center ice.
   */
  public startZamboniSweep(onFinish: () => void): void {
    if (this.isZamboniClearing) return;
    this.isZamboniClearing = true;
    this.zamboniProgress = 0;
    this.zamboniStartScrollY = this.iceScrollFocusY;
    this.zamboniOnFinish = onFinish;
    this.hoveredButtonId = null;
    this.canvas.style.cursor = 'default';
  }

  private bindIcePointerEvents(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.isIceSummaryActive || this.isZamboniClearing) return;
      this.isDraggingIce = true;
      this.dragLastClientY = e.clientY;
      this.dragTotalDistPx = 0;
      this.iceScrollVelY = 0;
      this.canvas.setPointerCapture(e.pointerId);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.isIceSummaryActive || this.isZamboniClearing) {
        if (this.canvas.style.cursor !== 'default') {
          this.canvas.style.cursor = 'default';
        }
        return;
      }

      if (this.isDraggingIce) {
        const dyPx = e.clientY - this.dragLastClientY;
        this.dragLastClientY = e.clientY;
        this.dragTotalDistPx += Math.abs(dyPx);

        const deltaRinkY = dyPx / Math.max(0.2, this.lastCssScale);
        this.iceScrollFocusY = clamp(
          this.iceScrollFocusY - deltaRinkY,
          128,
          296
        );
        this.iceScrollVelY = -deltaRinkY * 35;
        return;
      }

      // Hover state for on-ice action buttons
      const pt = this.clientToRinkCoords(e.clientX, e.clientY);
      const hit = this.findHitIceButton(pt.x, pt.y);
      this.hoveredButtonId = hit ? hit.id : null;
      this.canvas.style.cursor = hit ? 'pointer' : 'grab';
    });

    const handlePointerUp = (e: PointerEvent) => {
      if (!this.isDraggingIce) return;
      this.isDraggingIce = false;
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }

      if (
        this.isIceSummaryActive &&
        !this.isZamboniClearing &&
        this.dragTotalDistPx < 10 &&
        this.summaryEnterElapsedSec > 0.45
      ) {
        const pt = this.clientToRinkCoords(e.clientX, e.clientY);
        const hit = this.findHitIceButton(pt.x, pt.y);
        if (hit) {
          hit.onClick();
        }
      }
    };

    this.canvas.addEventListener('pointerup', handlePointerUp);
    this.canvas.addEventListener('pointercancel', handlePointerUp);

    // Wheel scrolling support on desktop
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.isIceSummaryActive || this.isZamboniClearing) return;
        e.preventDefault();
        const deltaRinkY = (e.deltaY * 0.65) / Math.max(0.2, this.lastCssScale);
        this.iceScrollFocusY = clamp(
          this.iceScrollFocusY + deltaRinkY,
          128,
          296
        );
      },
      { passive: false }
    );
  }

  private clientToRinkCoords(clientX: number, clientY: number): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;
    return {
      x: this.camFocusX + (cssX - this.lastScreenCenterX) / Math.max(0.1, this.lastCssScale),
      y: this.camFocusY + (cssY - this.lastScreenCenterY) / Math.max(0.1, this.lastCssScale),
    };
  }

  private findHitIceButton(rinkX: number, rinkY: number): IceButton | null {
    for (const btn of this.iceButtons) {
      if (
        rinkX >= btn.rect.x &&
        rinkX <= btn.rect.x + btn.rect.w &&
        rinkY >= btn.rect.y &&
        rinkY <= btn.rect.y + btn.rect.h
      ) {
        return btn;
      }
    }
    return null;
  }

  public resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.style.width = `${Math.floor(rect.width)}px`;
    this.canvas.style.height = `${Math.floor(rect.height)}px`;
    const pixelW = Math.max(1, Math.floor(rect.width * dpr));
    const pixelH = Math.max(1, Math.floor(rect.height * dpr));
    this.canvas.width = pixelW;
    this.canvas.height = pixelH;
    this.summaryCanvas.width = pixelW;
    this.summaryCanvas.height = pixelH;
  }

  public render(sim: MatchSimulation, realDtSec: number): void {
    this.animTime += realDtSec;
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewW = cw / dpr;
    const viewH = ch / dpr;

    // Update Intermission / Game-End zoom & Zamboni state
    if (this.isIceSummaryActive) {
      this.summaryEnterElapsedSec += realDtSec;

      if (this.isZamboniClearing) {
        // 2-loop Zamboni resurfacing + synchronized camera pullback (4.6 real seconds)
        const zamboniDurationSec = 4.6;
        this.zamboniProgress = Math.min(
          1,
          this.zamboniProgress + realDtSec / zamboniDurationSec
        );
        // Pull out smoothly so the full rink is visible as the Zamboni loops, reaching 0.0 right as Zamboni finishes
        this.intermissionZoomBlend = Math.pow(1 - this.zamboniProgress, 1.85);

        // Bring HUD & Organ Console back into frame during the final pass as zoom finishes returning to normal
        if (this.zamboniProgress >= 0.72) {
          const viewport = document.getElementById('app-viewport');
          viewport?.classList.remove('ice-focus-mode');
        }

        if (this.zamboniProgress >= 1) {
          const finishCb = this.zamboniOnFinish;
          this.isIceSummaryActive = false;
          this.isZamboniClearing = false;
          this.zamboniProgress = 0;
          this.intermissionZoomBlend = 0;
          this.zamboniOnFinish = null;
          this.iceButtons = [];
          this.clearIceWear();
          const viewport = document.getElementById('app-viewport');
          viewport?.classList.remove('ice-focus-mode');
          finishCb?.();
        }
      } else {
        // Zooming in on center ice after period/match ends (1.05 real seconds)
        const enterProg = Math.min(1, this.summaryEnterElapsedSec / 1.05);
        this.intermissionZoomBlend = easeInOutCubic(enterProg);

        // Apply drag inertia when not actively dragging
        if (!this.isDraggingIce && Math.abs(this.iceScrollVelY) > 0.5) {
          this.iceScrollFocusY = clamp(
            this.iceScrollFocusY + this.iceScrollVelY * realDtSec,
            128,
            296
          );
          this.iceScrollVelY *= Math.pow(0.08, realDtSec);
        }
      }
    } else {
      this.intermissionZoomBlend = 0;
    }

    // Compute normal play layout bounds between HUD and Organ Console
    const hudEl = document.getElementById('jumbotron-hud');
    const consoleEl = document.getElementById('organ-console');
    const hudH = hudEl ? hudEl.offsetHeight : 44;
    const consoleH = consoleEl ? consoleEl.offsetHeight : 58;

    const pad = 6;
    const availW = Math.max(100, viewW - pad * 2);
    const availH = Math.max(80, viewH - hudH - consoleH - pad * 2);
    const baseCssScale = Math.min(availW / RINK_WIDTH, availH / RINK_HEIGHT);

    const playCenterX = viewW * 0.5;
    const playCenterY = hudH + pad + availH * 0.5;

    // Full-screen center-ice zoom scale: fills 100% of screen with the ice sheet while fitting the 340-unit wide stats board
    const fullIceCssScale = Math.min(
      viewW / 355,
      Math.max(viewW / 580, viewH / 225)
    );

    // Compute active gameplay camera zoom & focus target
    let gameplayZoom = 1.0;
    let gameplayFocusX = CENTER_X;
    let gameplayFocusY = CENTER_Y;

    if (!this.isIceSummaryActive) {
      if (sim.puck.inFlightShotFrom !== null && sim.puck.isScoringShot) {
        gameplayZoom = 1.14;
        const goalX =
          sim.puck.inFlightShotFrom === 'home'
            ? AWAY_GOAL_X - 85
            : HOME_GOAL_X + 85;
        gameplayFocusX = sim.puck.pos.x * 0.35 + goalX * 0.65;
        gameplayFocusY = CENTER_Y + (sim.puck.pos.y - CENTER_Y) * 0.35;
      } else if (sim.phase === 'GOAL_CELEBRATION' && sim.phaseTimerSec > 1.1) {
        gameplayZoom = 1.16;
        gameplayFocusX =
          sim.puck.pos.x < CENTER_X ? HOME_GOAL_X + 95 : AWAY_GOAL_X - 95;
        gameplayFocusY = CENTER_Y;
      }
    }

    const lerpRate = Math.min(1, realDtSec * 9.5);
    this.camZoom += (gameplayZoom - this.camZoom) * lerpRate;

    if (this.isIceSummaryActive) {
      const targetSummaryY = this.isZamboniClearing
        ? this.zamboniStartScrollY * this.intermissionZoomBlend +
          CENTER_Y * (1 - this.intermissionZoomBlend)
        : CENTER_Y * (1 - this.intermissionZoomBlend) +
          this.iceScrollFocusY * this.intermissionZoomBlend;
      this.camFocusX = CENTER_X;
      this.camFocusY = targetSummaryY;
    } else {
      this.camFocusX += (gameplayFocusX - this.camFocusX) * lerpRate;
      this.camFocusY += (gameplayFocusY - this.camFocusY) * lerpRate;
    }

    // Screen shake punch right as the puck slams into the back of the net
    let shakeX = 0;
    let shakeY = 0;
    if (
      !this.isIceSummaryActive &&
      sim.phase === 'GOAL_CELEBRATION' &&
      sim.phaseTimerSec > 1.9
    ) {
      const intensity = ((sim.phaseTimerSec - 1.9) / 0.7) * 6.5;
      shakeX = Math.sin(this.animTime * 95) * intensity;
      shakeY = Math.cos(this.animTime * 115) * intensity;
    }

    // Blend between normal gameplay scale/center and full-screen center-ice scale/center
    const playScale = baseCssScale * this.camZoom;
    const activeCssScale =
      playScale * (1 - this.intermissionZoomBlend) +
      fullIceCssScale * this.intermissionZoomBlend;

    const screenCenterX =
      playCenterX * (1 - this.intermissionZoomBlend) +
      viewW * 0.5 * this.intermissionZoomBlend;
    const screenCenterY =
      playCenterY * (1 - this.intermissionZoomBlend) +
      viewH * 0.5 * this.intermissionZoomBlend;

    this.lastScreenCenterX = screenCenterX;
    this.lastScreenCenterY = screenCenterY;
    this.lastCssScale = activeCssScale;

    if (!this.isIceSummaryActive) {
      this.updateIceWear(sim, realDtSec);
    }

    for (const team of ['home', 'away'] as const) {
      const hasPenalty = sim.players.some(
        (p) => p.team === team && p.mode === 'PENALTY_BOX'
      );
      const target = hasPenalty ? 1 : 0;
      if (realDtSec <= 0 || this.animTime <= 0.05) {
        this.penaltyBoxExpand[team] = target;
      } else {
        const rate = hasPenalty ? 9.0 : 7.0;
        this.penaltyBoxExpand[team] +=
          (target - this.penaltyBoxExpand[team]) * Math.min(1, realDtSec * rate);
        if (Math.abs(target - this.penaltyBoxExpand[team]) < 0.005) {
          this.penaltyBoxExpand[team] = target;
        }
      }
    }

    ctx.save();
    ctx.clearRect(0, 0, cw, ch);

    ctx.scale(dpr, dpr);
    ctx.translate(screenCenterX, screenCenterY);
    ctx.scale(activeCssScale, activeCssScale);
    ctx.translate(-this.camFocusX + shakeX, -this.camFocusY + shakeY);

    this.drawIceAndMarkings(ctx, sim);
    this.drawPenaltyBoxes(ctx, sim);

    // Draw on-ice breakdown & Zamboni resurfacer directly on the ice surface!
    if (this.isIceSummaryActive) {
      this.drawOnIceSummaryAndZamboni(ctx, sim);
    } else {
      this.drawPuckTrailAndPuck(ctx, sim);
    }

    // Draw players (during intermission, they skate off toward the bottom bench doors and exit!)
    this.drawAllPlayers(ctx, sim);
    this.drawPenaltyBoxTimers(ctx, sim);

    if (!this.isIceSummaryActive) {
      this.drawPhaseBanner(ctx, sim);
      this.drawBrawlClouds(ctx, sim);
      this.drawGoalImpact(ctx, sim);
      this.drawCallouts(ctx, sim);
    }

    ctx.restore();
  }

  private drawAllPlayers(
    ctx: CanvasRenderingContext2D,
    sim: MatchSimulation
  ): void {
    if (this.isIceSummaryActive) {
      // Players skate off the ice during the first 1.0s of intermission
      const skateProg = clamp(this.summaryEnterElapsedSec / 0.95, 0, 1);
      if (skateProg >= 1) {
        return; // All players have exited through the bench doors
      }

      const sortedPlayers = [...sim.players].sort((a, b) => a.pos.y - b.pos.y);
      for (const p of sortedPlayers) {
        const start = this.skateOffStartPos.get(p.id) ?? p.pos;
        const benchDoor: Vec2 = {
          x: p.team === 'home' ? CENTER_X - 58 : CENTER_X + 58,
          y: RINK_HEIGHT + 28,
        };
        const curPos: Vec2 = {
          x: start.x + (benchDoor.x - start.x) * skateProg,
          y: start.y + (benchDoor.y - start.y) * skateProg,
        };
        const tempPlayer: PlayerEntity = {
          ...p,
          pos: curPos,
          vel: {
            x: benchDoor.x - start.x,
            y: benchDoor.y - start.y,
          },
          mode: 'DEFENDING',
          reactionTimer: 0,
        };
        ctx.save();
        ctx.globalAlpha = 1 - Math.pow(skateProg, 2.5);
        this.drawPlayer(ctx, tempPlayer, sim, false);
        ctx.restore();
      }
      return;
    }

    const sortedPlayers = [...sim.players].sort((a, b) => a.pos.y - b.pos.y);
    for (const p of sortedPlayers) {
      this.drawPlayer(ctx, p, sim, true);
    }
  }

  /**
   * Draws the Period Breakdown or Final Game Breakdown painted onto center ice.
   * When the Zamboni is active, it drives a 2-loop resurfacing pattern (entering from the left,
   * completing an outer loop and inner loop at ~1/4 rink height width, then exiting to the right),
   * erasing the on-ice breakdown text along its path like a giant squeegee.
   */
  private drawOnIceSummaryAndZamboni(
    ctx: CanvasRenderingContext2D,
    sim: MatchSimulation
  ): void {
    const fadeAlpha = this.isZamboniClearing
      ? 1.0
      : clamp((this.summaryEnterElapsedSec - 0.25) / 0.65, 0, 1);

    if (fadeAlpha <= 0.01) return;

    ctx.save();
    this.roundedRinkPath(ctx);
    ctx.clip();

    if (!this.isZamboniClearing) {
      ctx.save();
      ctx.globalAlpha = fadeAlpha;
      this.iceButtons = [];
      if (sim.phase === 'MATCH_OVER') {
        this.drawGameBreakdownOnIce(ctx, sim);
      } else {
        this.drawPeriodBreakdownOnIce(ctx, sim);
      }
      ctx.restore();
      this.drawIceScrollIndicator(ctx, fadeAlpha);
      ctx.restore();
      return;
    }

    // Zamboni is active: render the on-ice stats to summaryCanvas, then erase the swept 2-loop path
    if (
      this.summaryCanvas.width !== this.canvas.width ||
      this.summaryCanvas.height !== this.canvas.height
    ) {
      this.summaryCanvas.width = this.canvas.width;
      this.summaryCanvas.height = this.canvas.height;
    }

    const totalLen = this.getZamboniTotalLength();
    const currentDist = this.zamboniProgress * totalLen;
    // The rear conditioner squeegee bar is 48 units behind the Zamboni center
    const eraseDist = Math.max(0, currentDist - 48);
    // Zamboni conditioner swath width is ~1/4 of the rink height (425 / 4 = 106.25 -> 110 with overlap)
    const swathWidth = 110;

    const sCtx = this.summaryCtx;
    sCtx.save();
    sCtx.setTransform(1, 0, 0, 1, 0, 0);
    sCtx.clearRect(0, 0, this.summaryCanvas.width, this.summaryCanvas.height);
    sCtx.setTransform(ctx.getTransform());

    this.iceButtons = [];
    if (sim.phase === 'MATCH_OVER') {
      this.drawGameBreakdownOnIce(sCtx, sim);
    } else {
      this.drawPeriodBreakdownOnIce(sCtx, sim);
    }

    if (eraseDist > 0) {
      sCtx.save();
      sCtx.globalCompositeOperation = 'destination-out';
      sCtx.strokeStyle = '#000000';
      sCtx.lineWidth = swathWidth;
      sCtx.lineCap = 'round';
      sCtx.lineJoin = 'round';
      sCtx.beginPath();
      this.traceZamboniPathUpTo(sCtx, eraseDist);
      sCtx.stroke();
      sCtx.restore();

      // Clear scratches from iceWearCanvas along the Zamboni's squeegee swath
      this.iceWearCtx.save();
      this.iceWearCtx.globalCompositeOperation = 'destination-out';
      this.iceWearCtx.strokeStyle = '#000000';
      this.iceWearCtx.lineWidth = swathWidth;
      this.iceWearCtx.lineCap = 'round';
      this.iceWearCtx.lineJoin = 'round';
      this.iceWearCtx.beginPath();
      this.traceZamboniPathUpTo(this.iceWearCtx, eraseDist);
      this.iceWearCtx.stroke();
      this.iceWearCtx.restore();

      // Corner ice shavings clear as the Zamboni cleans the rink
      this.cornerSnowLevel = Math.max(0, 1 - this.zamboniProgress);
    }
    sCtx.restore();

    // 1. Draw the remaining (unerased) on-ice breakdown from summaryCanvas
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.summaryCanvas, 0, 0);
    ctx.restore();

    // 2. Draw the glistening wet resurfaced ice wake along the swept path and the Zamboni machine itself
    this.drawZamboniAndWetWake(ctx, currentDist, eraseDist, swathWidth);

    ctx.restore();
  }

  private drawPeriodBreakdownOnIce(
    ctx: CanvasRenderingContext2D,
    sim: MatchSimulation
  ): void {
    const pStats = buildStatsSummary(sim.events, sim.crowdSamples, sim.period);
    const orderDef = getOrderById(sim.orderId);
    const orderEval = evaluateOrder(sim.orderId, {
      homeGoals: sim.homeScore,
      awayGoals: sim.awayScore,
      totalFights: sim.getTotalFights(),
      averageCrowdVolume: sim.getAverageCrowdVolume(),
      isMatchOver: false,
    });

    const bx = CENTER_X - 166;
    const bw = 332;

    // Frosted center-ice stencil backdrop so markings show through subtly while text is ultra-crisp
    ctx.fillStyle = 'rgba(11, 20, 34, 0.84)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bx, 42, bw, 342, 10);
    ctx.fill();
    ctx.stroke();

    // Header
    ctx.fillStyle = '#facc15';
    ctx.font = '700 7.5px "Chakra Petch", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(
      `END OF PERIOD ${sim.period} • PLAYERS AT BENCH • STAMINA RESTORED`,
      bx + 12,
      56
    );

    // Drag-to-scroll badge
    ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx + bw - 92, 48, 80, 13, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#bae6fd';
    ctx.font = '700 6.5px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⇅ DRAG TO SCROLL', bx + bw - 52, 56.5);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 15px "Chakra Petch", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`PERIOD ${sim.period} ICE BREAKDOWN`, bx + 12, 74);

    // Score Banner (y = 82..114)
    ctx.fillStyle = 'rgba(6, 11, 20, 0.9)';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx + 12, 82, bw - 24, 30, 6);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = '700 11px "Chakra Petch", sans-serif';
    ctx.fillStyle = '#60a5fa';
    ctx.fillText(`HOME  ${sim.homeScore}`, CENTER_X - 58, 101);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 8px "Chakra Petch", sans-serif';
    ctx.fillText('VS', CENTER_X, 100);
    ctx.fillStyle = '#f87171';
    ctx.font = '700 11px "Chakra Petch", sans-serif';
    ctx.fillText(`${sim.awayScore}  AWAY`, CENTER_X + 58, 101);

    // Two Columns: Ice Telemetry & Organist Performance (y = 118..208)
    const colW = (bw - 30) * 0.5;
    const leftX = bx + 12;
    const rightX = leftX + colW + 6;

    for (const cx of [leftX, rightX]) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(cx, 118, colW, 88, 6);
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = '#fde047';
    ctx.font = '700 8.5px "Chakra Petch", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`ICE TELEMETRY (P${sim.period})`, leftX + 8, 131);
    ctx.fillText('ORGANIST PERFORMANCE', rightX + 8, 131);

    const drawKvRow = (
      x: number,
      y: number,
      w: number,
      label: string,
      val: string
    ) => {
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '500 8px "Inter", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label, x + 8, y);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 8px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(val, x + w - 8, y);
    };

    drawKvRow(
      leftX,
      146,
      colW,
      'Goals (H / A)',
      `${pStats.homeGoals} – ${pStats.awayGoals}`
    );
    drawKvRow(
      leftX,
      160,
      colW,
      'Shots on Goal',
      `${pStats.homeShots} – ${pStats.awayShots}`
    );
    drawKvRow(
      leftX,
      174,
      colW,
      'Goalie Saves',
      `${pStats.homeSaves} – ${pStats.awaySaves}`
    );
    drawKvRow(
      leftX,
      188,
      colW,
      'Brawls / PIM',
      `${pStats.fights} / ${pStats.penaltyMinutes}m`
    );

    drawKvRow(
      rightX,
      145,
      colW,
      'Songs (C/H/G)',
      `${pStats.songsPlayed.charge}/${pStats.songsPlayed.hold_the_line}/${pStats.songsPlayed.grudge_toccata}`
    );
    drawKvRow(rightX, 157, colW, 'Cue Hits', `${pStats.cueHits} ★`);
    drawKvRow(rightX, 169, colW, 'Stale Plays', `${pStats.stalePlays}`);
    drawKvRow(
      rightX,
      181,
      colW,
      'Crowd Avg',
      `${Math.round(pStats.avgCrowdVolume)}%`
    );

    // Mini Sparkline inside Right Column (y = 186..202)
    this.drawCanvasSparkline(
      ctx,
      pStats.crowdSparkline,
      rightX + 8,
      185,
      colW - 16,
      16
    );

    // Organ Impact Box (y = 212..282)
    ctx.fillStyle = 'rgba(30, 41, 59, 0.78)';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx + 12, 212, bw - 24, 68, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fde047';
    ctx.font = '700 8.5px "Chakra Petch", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText("🎹 YOUR ORGAN'S IMPACT THIS PERIOD", bx + 20, 225);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '500 7.8px "Inter", sans-serif';
    const impactLines = pStats.impactLines.slice(0, 3);
    for (let i = 0; i < impactLines.length; i++) {
      ctx.fillText(`• ${impactLines[i]}`, bx + 20, 239 + i * 13);
    }

    // Official Order Status Row (y = 286..324)
    ctx.fillStyle = 'rgba(6, 11, 20, 0.9)';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx + 12, 286, bw - 24, 36, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 8.5px "Chakra Petch", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`DIRECTIVE: ${orderDef.title.toUpperCase()}`, bx + 20, 300);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 7.5px "Inter", sans-serif';
    ctx.fillText(orderEval.reason, bx + 20, 313);

    const statusColor =
      orderEval.liveStatus === 'ON_TRACK'
        ? '#22c55e'
        : orderEval.liveStatus === 'AT_RISK'
        ? '#eab308'
        : '#ef4444';
    ctx.fillStyle = statusColor + '33';
    ctx.strokeStyle = statusColor;
    ctx.beginPath();
    ctx.roundRect(bx + bw - 82, 295, 62, 18, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 7.5px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      orderEval.liveStatus.replace('_', ' '),
      bx + bw - 51,
      306.5
    );

    // On-Ice Continue Button (y = 332..372)
    const btnRect = { x: bx + 12, y: 332, w: bw - 24, h: 38 };
    const continueBtn: IceButton = {
      id: 'continue-period',
      label: `▶ CONTINUE TO PERIOD ${sim.period + 1} (SEND ZAMBONI)`,
      rect: btnRect,
      primary: true,
      onClick: () => {
        this.startZamboniSweep(() => {
          this.callbacks?.onContinueNextPeriod();
        });
      },
    };
    this.iceButtons.push(continueBtn);
    this.drawIceButton(ctx, continueBtn);
  }

  private drawGameBreakdownOnIce(
    ctx: CanvasRenderingContext2D,
    sim: MatchSimulation
  ): void {
    const totalStats = buildStatsSummary(sim.events, sim.crowdSamples);
    const p1 = buildStatsSummary(sim.events, sim.crowdSamples, 1);
    const p2 = buildStatsSummary(sim.events, sim.crowdSamples, 2);
    const p3 = buildStatsSummary(sim.events, sim.crowdSamples, 3);

    const orderDef = getOrderById(sim.orderId);
    const orderEval = evaluateOrder(sim.orderId, {
      homeGoals: sim.homeScore,
      awayGoals: sim.awayScore,
      totalFights: sim.getTotalFights(),
      averageCrowdVolume: sim.getAverageCrowdVolume(),
      isMatchOver: true,
    });

    const bx = CENTER_X - 166;
    const bw = 332;

    ctx.fillStyle = 'rgba(11, 20, 34, 0.86)';
    ctx.strokeStyle = orderEval.passed
      ? 'rgba(74, 222, 128, 0.75)'
      : 'rgba(248, 113, 113, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bx, 38, bw, 350, 10);
    ctx.fill();
    ctx.stroke();

    // Eyebrow & Drag Hint
    ctx.fillStyle = '#facc15';
    ctx.font = '700 7.5px "Chakra Petch", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(
      `FINAL BUZZER • SEED #${sim.rng.initialSeed}`,
      bx + 12,
      52
    );

    ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx + bw - 92, 44, 80, 13, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#bae6fd';
    ctx.font = '700 6.5px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⇅ DRAG TO SCROLL', bx + bw - 52, 52.5);

    // Main Result Title
    ctx.fillStyle = orderEval.passed ? '#4ade80' : '#f87171';
    ctx.font = '700 13.5px "Chakra Petch", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(
      orderEval.passed
        ? '✅ OFFICIAL ORDER COMPLETED!'
        : '❌ OFFICIAL ORDER FAILED',
      bx + 12,
      69
    );

    // Order Banner (y = 75..98)
    ctx.fillStyle = orderEval.passed
      ? 'rgba(34, 197, 94, 0.18)'
      : 'rgba(239, 68, 68, 0.18)';
    ctx.strokeStyle = orderEval.passed ? '#4ade80' : '#f87171';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx + 12, 75, bw - 24, 22, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = '600 7.8px "Inter", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(
      `${orderDef.title}: ${orderEval.reason}`,
      bx + 18,
      88.5
    );

    // Final Score Banner (y = 102..130)
    ctx.fillStyle = 'rgba(6, 11, 20, 0.9)';
    ctx.strokeStyle = '#334155';
    ctx.beginPath();
    ctx.roundRect(bx + 12, 102, bw - 24, 28, 6);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = '700 11px "Chakra Petch", sans-serif';
    ctx.fillStyle = '#60a5fa';
    ctx.fillText(`HOME  ${sim.homeScore}`, CENTER_X - 62, 119.5);
    ctx.fillStyle = '#fde047';
    ctx.font = '700 8px "Chakra Petch", sans-serif';
    ctx.fillText(
      sim.homeScore === sim.awayScore ? 'TIE' : 'FINAL',
      CENTER_X,
      119
    );
    ctx.fillStyle = '#f87171';
    ctx.font = '700 11px "Chakra Petch", sans-serif';
    ctx.fillText(`${sim.awayScore}  AWAY`, CENTER_X + 62, 119.5);

    // Per-Period Summary Table (y = 135..220)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.strokeStyle = '#334155';
    ctx.beginPath();
    ctx.roundRect(bx + 12, 135, bw - 24, 84, 6);
    ctx.fill();
    ctx.stroke();

    const cols = [
      bx + 32,
      bx + 82,
      bx + 134,
      bx + 186,
      bx + 244,
      bx + 298,
    ];
    const headers = ['PER', 'GOALS', 'SHOTS', 'SAVES', 'FIGHTS', 'CROWD'];
    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 7.2px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < headers.length; i++) {
      ctx.fillText(headers[i], cols[i], 147);
    }

    const drawTableRow = (
      label: string,
      s: PeriodStatsSummary,
      y: number,
      isBold: boolean,
      crowdOverride?: number
    ) => {
      ctx.fillStyle = isBold ? '#fde047' : '#e2e8f0';
      ctx.font = `${isBold ? '700' : '500'} 7.8px "JetBrains Mono", monospace`;
      const crowdVal = Math.round(crowdOverride ?? s.avgCrowdVolume);
      const vals = [
        label,
        `${s.homeGoals}–${s.awayGoals}`,
        `${s.homeShots}–${s.awayShots}`,
        `${s.homeSaves}–${s.awaySaves}`,
        `${s.fights} (${s.penaltyMinutes}m)`,
        `${crowdVal}%`,
      ];
      for (let i = 0; i < vals.length; i++) {
        ctx.fillText(vals[i], cols[i], y);
      }
    };

    drawTableRow('P1', p1, 162, false);
    drawTableRow('P2', p2, 177, false);
    drawTableRow('P3', p3, 192, false);
    drawTableRow(
      'TOT',
      totalStats,
      209,
      true,
      sim.getAverageCrowdVolume()
    );

    // Full-Match Organ Impact Box (y = 224..294)
    ctx.fillStyle = 'rgba(30, 41, 59, 0.78)';
    ctx.strokeStyle = '#475569';
    ctx.beginPath();
    ctx.roundRect(bx + 12, 224, bw - 24, 70, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fde047';
    ctx.font = '700 8.5px "Chakra Petch", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('🎹 FULL-MATCH ORGAN IMPACT', bx + 20, 237);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '500 7.5px "Inter", sans-serif';
    const lines = [
      ...totalStats.impactLines.slice(0, 3),
      `Cue Hits: ${totalStats.cueHits} ★  •  Stale Repeats: ${totalStats.stalePlays}`,
    ];
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(`• ${lines[i]}`, bx + 20, 250 + i * 12);
    }

    // Action Buttons on the Ice (y = 300..378)
    const btnNewSeed: IceButton = {
      id: 'play-again-new-seed',
      label: this.callbacks?.onOpenShop
        ? '🏆 ADVANCE TO ORGAN LOFT & SHOP (SEND ZAMBONI)'
        : '🔄 PLAY AGAIN — NEW SEED (SEND ZAMBONI)',
      rect: { x: bx + 12, y: 302, w: bw - 24, h: 34 },
      primary: true,
      onClick: () => {
        this.startZamboniSweep(() => {
          if (this.callbacks?.onOpenShop) {
            this.callbacks.onOpenShop();
          } else {
            this.callbacks?.onPlayAgainNewSeed();
          }
        });
      },
    };

    const halfW = (bw - 30) * 0.5;
    const btnSameSeed: IceButton = {
      id: 'play-again-same-seed',
      label: `🔁 REPLAY SEED #${sim.rng.initialSeed}`,
      rect: { x: bx + 12, y: 342, w: halfW, h: 32 },
      primary: false,
      onClick: () => {
        this.startZamboniSweep(() => {
          this.callbacks?.onPlayAgainSameSeed();
        });
      },
    };

    const btnChangeOrder: IceButton = {
      id: 'change-order',
      label: '📋 CHANGE ORDER',
      rect: { x: bx + 18 + halfW, y: 342, w: halfW, h: 32 },
      primary: false,
      onClick: () => {
        this.startZamboniSweep(() => {
          this.callbacks?.onChangeOrder();
        });
      },
    };

    this.iceButtons.push(btnNewSeed, btnSameSeed, btnChangeOrder);
    for (const b of this.iceButtons) {
      this.drawIceButton(ctx, b);
    }
  }

  private drawIceButton(ctx: CanvasRenderingContext2D, btn: IceButton): void {
    const isHovered = this.hoveredButtonId === btn.id;
    ctx.save();
    if (btn.primary) {
      ctx.fillStyle = isHovered ? '#fde047' : '#eab308';
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 1.5;
    } else {
      ctx.fillStyle = isHovered ? '#334155' : '#1e293b';
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 1.2;
    }
    ctx.beginPath();
    ctx.roundRect(btn.rect.x, btn.rect.y, btn.rect.w, btn.rect.h, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = btn.primary ? '#090d14' : '#f8fafc';
    ctx.font = `700 ${btn.primary ? '10px' : '8.5px'} "Chakra Petch", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      btn.label,
      btn.rect.x + btn.rect.w * 0.5,
      btn.rect.y + btn.rect.h * 0.5 + 0.5
    );
    ctx.restore();
  }

  private drawCanvasSparkline(
    ctx: CanvasRenderingContext2D,
    values: number[],
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    if (values.length === 0) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.35);
    ctx.lineTo(x + w, y + h * 0.35);
    ctx.stroke();

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
      const px =
        values.length === 1 ? x + w * 0.5 : x + (i / (values.length - 1)) * w;
      const py = y + h - (clamp(values[i], 0, 100) / 100) * h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawIceScrollIndicator(
    ctx: CanvasRenderingContext2D,
    alpha: number
  ): void {
    const trackX = CENTER_X + 172;
    const trackY = this.camFocusY - 65;
    const trackH = 130;
    const scrollNorm = clamp((this.iceScrollFocusY - 128) / (296 - 128), 0, 1);
    const thumbH = 34;
    const thumbY = trackY + scrollNorm * (trackH - thumbH);

    ctx.save();
    ctx.globalAlpha = alpha * 0.85;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    ctx.beginPath();
    ctx.roundRect(trackX, trackY, 5, trackH, 3);
    ctx.fill();

    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.roundRect(trackX, thumbY, 5, thumbH, 3);
    ctx.fill();
    ctx.restore();
  }

  private getZamboniSegments(): Array<
    | {
        type: 'line';
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        length: number;
      }
    | {
        type: 'arc';
        cx: number;
        cy: number;
        r: number;
        startAngle: number;
        endAngle: number;
        ccw: boolean;
        length: number;
      }
  > {
    // Rink is 1000 x 425. Zamboni conditioner width is ~108 (~1/4 of 425).
    // Loop 1 (Outer loop): Left->Right along top (y=52), right endzone turn, Right->Left along bottom (y=373), left endzone turn.
    // Loop 2 (Inner loop): Left->Right along upper-mid (y=140), right inner turn, Right->Left along lower-mid (y=285), left inner turn.
    // Exit: Left->Right along center ice (y=212.5) exiting off the right side of the rink.
    const r1 = (373 - 52) * 0.5; // 160.5
    const r2 = (373 - 140) * 0.5; // 116.5
    const r3 = (285 - 140) * 0.5; // 72.5
    const r4 = (285 - CENTER_Y) * 0.5; // 36.25

    return [
      {
        type: 'line',
        x1: -95,
        y1: 52,
        x2: 835,
        y2: 52,
        length: 835 - -95,
      },
      {
        type: 'arc',
        cx: 835,
        cy: 212.5,
        r: r1,
        startAngle: -Math.PI * 0.5,
        endAngle: Math.PI * 0.5,
        ccw: false,
        length: Math.PI * r1,
      },
      {
        type: 'line',
        x1: 835,
        y1: 373,
        x2: 120,
        y2: 373,
        length: 835 - 120,
      },
      {
        type: 'arc',
        cx: 120,
        cy: 256.5,
        r: r2,
        startAngle: Math.PI * 0.5,
        endAngle: Math.PI * 1.5,
        ccw: false,
        length: Math.PI * r2,
      },
      {
        type: 'line',
        x1: 120,
        y1: 140,
        x2: 845,
        y2: 140,
        length: 845 - 120,
      },
      {
        type: 'arc',
        cx: 845,
        cy: 212.5,
        r: r3,
        startAngle: -Math.PI * 0.5,
        endAngle: Math.PI * 0.5,
        ccw: false,
        length: Math.PI * r3,
      },
      {
        type: 'line',
        x1: 845,
        y1: 285,
        x2: 135,
        y2: 285,
        length: 845 - 135,
      },
      {
        type: 'arc',
        cx: 135,
        cy: 248.75,
        r: r4,
        startAngle: Math.PI * 0.5,
        endAngle: Math.PI * 1.5,
        ccw: false,
        length: Math.PI * r4,
      },
      {
        type: 'line',
        x1: 135,
        y1: CENTER_Y,
        x2: 1095,
        y2: CENTER_Y,
        length: 1095 - 135,
      },
    ];
  }

  private getZamboniTotalLength(): number {
    let sum = 0;
    for (const seg of this.getZamboniSegments()) {
      sum += seg.length;
    }
    return sum;
  }

  private traceZamboniPathUpTo(
    ctx: CanvasRenderingContext2D,
    maxDist: number
  ): void {
    const segments = this.getZamboniSegments();
    let remaining = maxDist;
    ctx.moveTo(-95, 52);

    for (const seg of segments) {
      if (remaining <= 0) break;
      const segDist = Math.min(remaining, seg.length);
      const frac = segDist / seg.length;

      if (seg.type === 'line') {
        ctx.lineTo(
          seg.x1 + (seg.x2 - seg.x1) * frac,
          seg.y1 + (seg.y2 - seg.y1) * frac
        );
      } else {
        const endA = seg.startAngle + (seg.endAngle - seg.startAngle) * frac;
        ctx.arc(seg.cx, seg.cy, seg.r, seg.startAngle, endA, seg.ccw);
      }
      remaining -= segDist;
    }
  }

  private traceZamboniPathWindow(
    ctx: CanvasRenderingContext2D,
    startDist: number,
    endDist: number
  ): void {
    if (endDist <= startDist) return;
    const segments = this.getZamboniSegments();
    let cursor = 0;
    let started = false;

    for (const seg of segments) {
      const segStart = cursor;
      const segEnd = cursor + seg.length;
      cursor = segEnd;

      if (segEnd <= startDist) continue;
      if (segStart >= endDist) break;

      const f0 = clamp((startDist - segStart) / seg.length, 0, 1);
      const f1 = clamp((endDist - segStart) / seg.length, 0, 1);
      if (f1 <= f0) continue;

      if (seg.type === 'line') {
        const sx = seg.x1 + (seg.x2 - seg.x1) * f0;
        const sy = seg.y1 + (seg.y2 - seg.y1) * f0;
        const ex = seg.x1 + (seg.x2 - seg.x1) * f1;
        const ey = seg.y1 + (seg.y2 - seg.y1) * f1;
        if (!started) {
          ctx.moveTo(sx, sy);
          started = true;
        }
        ctx.lineTo(ex, ey);
      } else {
        const a0 = seg.startAngle + (seg.endAngle - seg.startAngle) * f0;
        const a1 = seg.startAngle + (seg.endAngle - seg.startAngle) * f1;
        if (!started) {
          ctx.moveTo(
            seg.cx + Math.cos(a0) * seg.r,
            seg.cy + Math.sin(a0) * seg.r
          );
          started = true;
        }
        ctx.arc(seg.cx, seg.cy, seg.r, a0, a1, seg.ccw);
      }
    }
  }

  private sampleZamboniPose(dist: number): {
    x: number;
    y: number;
    angle: number;
  } {
    const segments = this.getZamboniSegments();
    let remaining = clamp(dist, 0, this.getZamboniTotalLength());

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (remaining <= seg.length || i === segments.length - 1) {
        const frac = clamp(remaining / seg.length, 0, 1);
        if (seg.type === 'line') {
          return {
            x: seg.x1 + (seg.x2 - seg.x1) * frac,
            y: seg.y1 + (seg.y2 - seg.y1) * frac,
            angle: Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1),
          };
        } else {
          const theta =
            seg.startAngle + (seg.endAngle - seg.startAngle) * frac;
          return {
            x: seg.cx + Math.cos(theta) * seg.r,
            y: seg.cy + Math.sin(theta) * seg.r,
            angle: theta + Math.PI * 0.5,
          };
        }
      }
      remaining -= seg.length;
    }

    return { x: 1095, y: CENTER_Y, angle: 0 };
  }

  /**
   * Draws the wet-ice resurfacing wake along the 2-loop path and the Zamboni machine itself
   * (sized at ~1/4 the rink height = ~106 units wide).
   */
  private drawZamboniAndWetWake(
    ctx: CanvasRenderingContext2D,
    currentDist: number,
    eraseDist: number,
    swathWidth: number
  ): void {
    ctx.save();

    // 1. Freshly resurfaced glistening wet ice sheet along the entire swept path so far
    if (eraseDist > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.lineWidth = swathWidth - 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      this.traceZamboniPathUpTo(ctx, eraseDist);
      ctx.stroke();

      // Extra-wet glossy water wake immediately behind the conditioner bar (last 850 units)
      const wakeStart = Math.max(0, eraseDist - 850);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
      ctx.lineWidth = swathWidth - 6;
      ctx.beginPath();
      this.traceZamboniPathWindow(ctx, wakeStart, eraseDist);
      ctx.stroke();

      // Specular white center reflection rib along the fresh water wake
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
      ctx.lineWidth = swathWidth * 0.34;
      ctx.beginPath();
      this.traceZamboniPathWindow(
        ctx,
        Math.max(0, eraseDist - 520),
        eraseDist
      );
      ctx.stroke();
      ctx.restore();
    }

    // 2. Sample Zamboni position and heading angle along the 2-loop trajectory
    const pose = this.sampleZamboniPose(currentDist);
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.angle);

    // In local Zamboni space:
    // +X is forward (direction of travel), Y is perpendicular width.
    // Conditioner width is 108 units (~1/4 of RINK_HEIGHT = 425), spanning y = [-54, +54].
    const halfSwath = swathWidth * 0.5; // 55
    const halfBodyW = 48; // Chassis width = 96 (~1/4 rink height)
    const rearX = -46;
    const frontX = 66;
    const bodyLen = frontX - rearX; // 112

    // Headlight beams shining ahead (+X) onto the uncleaned ice/stats
    const beamGrad = ctx.createLinearGradient(frontX, 0, frontX + 68, 0);
    beamGrad.addColorStop(0, 'rgba(254, 240, 138, 0.58)');
    beamGrad.addColorStop(1, 'rgba(254, 240, 138, 0)');
    ctx.fillStyle = beamGrad;
    for (const ly of [-28, 28]) {
      ctx.beginPath();
      ctx.moveTo(frontX - 2, ly - 8);
      ctx.lineTo(frontX + 68, ly - 24);
      ctx.lineTo(frontX + 68, ly + 24);
      ctx.lineTo(frontX - 2, ly + 8);
      ctx.closePath();
      ctx.fill();
    }

    // Rear Conditioner Squeegee & Water Spreader Bar at x = [-56, -42], y = [-55, +55] (the "big eraser" blade)
    ctx.fillStyle = '#0ea5e9';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.roundRect(-56, -halfSwath, 14, swathWidth, 4);
    ctx.fill();
    ctx.stroke();

    // Brass spreader towel bar along the rear conditioner
    ctx.fillStyle = '#eab308';
    ctx.fillRect(-52, -halfSwath + 5, 5, swathWidth - 10);

    // Water mist spray droplets trailing behind the conditioner bar
    ctx.fillStyle = '#e0f2fe';
    for (let i = 0; i < 9; i++) {
      const my = -halfSwath + 9 + (i * (swathWidth - 18)) / 8;
      const mx = -61 - Math.abs(Math.sin(this.animTime * 24 + i * 1.3)) * 5;
      ctx.beginPath();
      ctx.arc(mx, my, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4 Heavy-duty studded ice tires (top and bottom of chassis)
    ctx.fillStyle = '#090d14';
    // Rear tires
    ctx.fillRect(-30, -halfBodyW - 5, 24, 7);
    ctx.fillRect(-30, halfBodyW - 2, 24, 7);
    // Front tires
    ctx.fillRect(26, -halfBodyW - 5, 24, 7);
    ctx.fillRect(26, halfBodyW - 2, 24, 7);

    // Main Zamboni Chassis (Crisp Arena White & Dark Slate border)
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.roundRect(rearX, -halfBodyW, bodyLen, halfBodyW * 2, 12);
    ctx.fill();
    ctx.stroke();

    // Front Snow Dump Tank (Stadium Blue, x = [-4, 58], y = [-41, +41])
    ctx.fillStyle = '#1d4ed8';
    ctx.strokeStyle = '#1e3a8a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-4, -halfBodyW + 7, 62, (halfBodyW - 7) * 2, 8);
    ctx.fill();
    ctx.stroke();

    // Snow conveyor auger vents on front tank
    ctx.strokeStyle = 'rgba(147, 197, 253, 0.45)';
    ctx.lineWidth = 1.5;
    for (let vx = 8; vx <= 46; vx += 9) {
      ctx.beginPath();
      ctx.moveTo(vx, -halfBodyW + 14);
      ctx.lineTo(vx, halfBodyW - 14);
      ctx.stroke();
    }

    // Gold racing stripe & ZAMBONI badge across the tank
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.roundRect(6, -13, 44, 26, 4);
    ctx.fill();

    // Keep "ZAMBONI" text right-side-up whether driving Left->Right or Right->Left
    ctx.save();
    ctx.translate(28, 0);
    if (Math.cos(pose.angle) < 0) {
      ctx.rotate(Math.PI);
    }
    ctx.fillStyle = '#090d14';
    ctx.font = '700 9.5px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ZAMBONI', 0, 0.5);
    ctx.restore();

    // Rear Operator Cab & Console (x = [-38, -8], y = [-30, +30])
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-38, -30, 28, 60, 6);
    ctx.fill();
    ctx.stroke();

    // Steering wheel
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(-16, 0, 5.5, 0, Math.PI * 2);
    ctx.stroke();

    // Driver helmet & shoulders at the controls
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.roundRect(-32, -12, 11, 24, 5);
    ctx.fill();

    ctx.fillStyle = '#eab308';
    ctx.strokeStyle = '#090d14';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(-25, 0, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Flashing amber warning beacon on corner of cab
    const strobeAlpha = 0.45 + 0.55 * Math.abs(Math.sin(this.animTime * 14));
    ctx.fillStyle = `rgba(245, 158, 11, ${strobeAlpha.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(-33, -23, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private roundedRinkPath(ctx: CanvasRenderingContext2D): void {
    const r = RINK_CORNER_RADIUS;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(RINK_WIDTH - r, 0);
    ctx.arcTo(RINK_WIDTH, 0, RINK_WIDTH, r, r);
    ctx.lineTo(RINK_WIDTH, RINK_HEIGHT - r);
    ctx.arcTo(RINK_WIDTH, RINK_HEIGHT, RINK_WIDTH - r, RINK_HEIGHT, r);
    ctx.lineTo(r, RINK_HEIGHT);
    ctx.arcTo(0, RINK_HEIGHT, 0, RINK_HEIGHT - r, r);
    ctx.lineTo(0, r);
    ctx.arcTo(0, 0, r, 0, r);
    ctx.closePath();
  }

  private drawIceAndMarkings(
    ctx: CanvasRenderingContext2D,
    sim: MatchSimulation
  ): void {
    ctx.save();
    this.roundedRinkPath(ctx);

    // Stadium ice gradient: slightly more blue and darker tone for authentic scratch contrast
    const iceGrad = ctx.createLinearGradient(0, 0, 0, RINK_HEIGHT);
    iceGrad.addColorStop(0, '#c3dced');
    iceGrad.addColorStop(0.5, '#d3e7f6');
    iceGrad.addColorStop(1, '#bcd6ea');
    ctx.fillStyle = iceGrad;
    ctx.fill();
    ctx.clip();

    // Active song subtle ice tint
    if (sim.activeSong && !this.isIceSummaryActive) {
      const songColor = SONGS[sim.activeSong.songId].color;
      ctx.fillStyle = songColor + '16';
      ctx.fillRect(0, 0, RINK_WIDTH, RINK_HEIGHT);
    }

    // Goal lines (red, thin)
    ctx.strokeStyle = 'rgba(220, 38, 38, 0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(HOME_GOAL_X, 0);
    ctx.lineTo(HOME_GOAL_X, RINK_HEIGHT);
    ctx.moveTo(AWAY_GOAL_X, 0);
    ctx.lineTo(AWAY_GOAL_X, RINK_HEIGHT);
    ctx.stroke();

    // Blue lines (attacking thirds at 340 and 660)
    ctx.fillStyle = 'rgba(37, 99, 235, 0.45)';
    ctx.fillRect(340 - 4, 0, 8, RINK_HEIGHT);
    ctx.fillRect(660 - 4, 0, 8, RINK_HEIGHT);

    // Center red line
    ctx.fillStyle = 'rgba(220, 38, 38, 0.55)';
    ctx.fillRect(CENTER_X - 4, 0, 8, RINK_HEIGHT);

    // Center ice circle
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.55)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(CENTER_X, CENTER_Y, 62, 0, Math.PI * 2);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = '#1d4ed8';
    ctx.beginPath();
    ctx.arc(CENTER_X, CENTER_Y, 6, 0, Math.PI * 2);
    ctx.fill();

    // Goal creases (Home left, Away right)
    ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.strokeStyle = 'rgba(220, 38, 38, 0.7)';
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.arc(HOME_GOAL_X, CENTER_Y, sim.cfg.creaseRadius, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(AWAY_GOAL_X, CENTER_Y, sim.cfg.creaseRadius, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Goal nets
    ctx.fillStyle = 'rgba(15, 23, 42, 0.18)';
    ctx.strokeStyle = '#be123c';
    ctx.lineWidth = 4;
    // Home net
    ctx.beginPath();
    ctx.rect(HOME_GOAL_X - 22, CENTER_Y - GOAL_HALF_WIDTH, 22, GOAL_HALF_WIDTH * 2);
    ctx.fill();
    ctx.stroke();
    // Away net
    ctx.beginPath();
    ctx.rect(AWAY_GOAL_X, CENTER_Y - GOAL_HALF_WIDTH, 22, GOAL_HALF_WIDTH * 2);
    ctx.fill();
    ctx.stroke();

    // Dynamic ice wear (skate blade scratches & banked corner snow shavings)
    this.drawIceWearAndCornerShavings(ctx);

    ctx.restore();

    // Outer rink boards border
    ctx.save();
    this.roundedRinkPath(ctx);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = '#f59e0b'; // Yellow kickplate highlight
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  public clearIceWear(): void {
    this.iceWearCtx.clearRect(0, 0, RINK_WIDTH, RINK_HEIGHT);
    this.cornerSnowLevel = 0;
    this.ambientScratchTimerSec = 0;
  }

  private initCornerSnowFlakes(): void {
    this.cornerSnowFlakes = [];
    const r = RINK_CORNER_RADIUS; // 95
    const corners = [
      { cx: r, cy: r, startAngle: Math.PI },
      { cx: RINK_WIDTH - r, cy: r, startAngle: 1.5 * Math.PI },
      { cx: RINK_WIDTH - r, cy: RINK_HEIGHT - r, startAngle: 0 },
      { cx: r, cy: RINK_HEIGHT - r, startAngle: 0.5 * Math.PI },
    ];

    let seed = 4289;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    for (const c of corners) {
      for (let i = 0; i < 48; i++) {
        const theta = c.startAngle + rnd() * (0.5 * Math.PI);
        const dist = 60 + Math.pow(rnd(), 0.55) * 33;
        const x = c.cx + Math.cos(theta) * dist;
        const y = c.cy + Math.sin(theta) * dist;
        const flakeR = 1.5 + rnd() * 2.8;
        const alpha = 0.55 + rnd() * 0.45;
        this.cornerSnowFlakes.push({ x, y, r: flakeR, alpha });
      }
    }
  }

  public stepIceWear(sim: MatchSimulation, dt: number): void {
    this.updateIceWear(sim, dt);
  }

  private updateIceWear(sim: MatchSimulation, dt: number): void {
    if (this.isIceSummaryActive || this.isZamboniClearing) return;

    // 1. Match progress builds corner snow and ice shavings
    const periodDuration = Math.max(1, sim.cfg.periodDurationSec ?? 120);
    const periodProgress = 1 - clamp(sim.periodTimeRemainingSec / periodDuration, 0, 1);
    this.cornerSnowLevel = Math.max(this.cornerSnowLevel, periodProgress);

    // 2. Skater blade scratches
    for (const p of sim.players) {
      if (p.mode === 'PENALTY_BOX') continue;
      const vx = p.vel.x;
      const vy = p.vel.y;
      const spdSq = vx * vx + vy * vy;
      if (spdSq < 400) continue; // must be actively skating (> 20 px/s)

      if (Math.random() > 0.45) continue;

      const spd = Math.sqrt(spdSq);
      const heading = Math.atan2(vy, vx);
      const perpX = -Math.sin(heading);
      const perpY = Math.cos(heading);

      const bladeOffset = Math.random() < 0.5 ? 2.5 : -2.5;
      const sx = p.pos.x + perpX * bladeOffset;
      const sy = p.pos.y + perpY * bladeOffset;
      const len = Math.min(18, 5 + spd * 0.055 + Math.random() * 7);
      const jitter = (Math.random() - 0.5) * 0.22;
      const ex = sx - Math.cos(heading + jitter) * len;
      const ey = sy - Math.sin(heading + jitter) * len;

      this.iceWearCtx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      this.iceWearCtx.lineWidth = 1.1 + Math.random() * 0.7;
      this.iceWearCtx.beginPath();
      this.iceWearCtx.moveTo(sx, sy);
      this.iceWearCtx.lineTo(ex, ey);
      this.iceWearCtx.stroke();

      const inCorner =
        (p.pos.x < 140 || p.pos.x > RINK_WIDTH - 140) &&
        (p.pos.y < 140 || p.pos.y > RINK_HEIGHT - 140);
      if (inCorner) {
        this.cornerSnowLevel = Math.min(1.0, this.cornerSnowLevel + 0.0025);
      }
    }

    // 3. Periodic ambient fine hairline cuts across active zones
    this.ambientScratchTimerSec += dt;
    if (this.ambientScratchTimerSec >= 0.18) {
      this.ambientScratchTimerSec = 0;
      const count = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const rx = 120 + Math.random() * (RINK_WIDTH - 240);
        const ry = 45 + Math.random() * (RINK_HEIGHT - 90);
        const angle = Math.random() * Math.PI * 2;
        const rlen = 6 + Math.random() * 16;
        this.iceWearCtx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
        this.iceWearCtx.lineWidth = 0.95;
        this.iceWearCtx.beginPath();
        this.iceWearCtx.moveTo(rx, ry);
        this.iceWearCtx.lineTo(rx + Math.cos(angle) * rlen, ry + Math.sin(angle) * rlen);
        this.iceWearCtx.stroke();
      }
    }
  }

  private drawIceWearAndCornerShavings(ctx: CanvasRenderingContext2D): void {
    // 1. Skate scratches from offscreen canvas
    ctx.drawImage(this.iceWearCanvas, 0, 0);

    // 2. Corner snow accumulations & shavings
    if (this.cornerSnowLevel > 0.005) {
      this.drawCornerSnow(ctx);
    }
  }

  private drawCornerSnow(ctx: CanvasRenderingContext2D): void {
    const snowAlpha = clamp(this.cornerSnowLevel, 0, 1);
    const r = RINK_CORNER_RADIUS; // 95

    const corners: {
      cx: number;
      cy: number;
      startAngle: number;
      endAngle: number;
    }[] = [
      // Top-Left
      { cx: r, cy: r, startAngle: Math.PI, endAngle: 1.5 * Math.PI },
      // Top-Right
      { cx: RINK_WIDTH - r, cy: r, startAngle: 1.5 * Math.PI, endAngle: 2 * Math.PI },
      // Bottom-Right
      { cx: RINK_WIDTH - r, cy: RINK_HEIGHT - r, startAngle: 0, endAngle: 0.5 * Math.PI },
      // Bottom-Left
      { cx: r, cy: RINK_HEIGHT - r, startAngle: 0.5 * Math.PI, endAngle: Math.PI },
    ];

    ctx.save();

    for (const c of corners) {
      // Soft powdery snow gradient banked against the inside curve of the corner boards
      const grad = ctx.createRadialGradient(c.cx, c.cy, 38, c.cx, c.cy, r);
      grad.addColorStop(0, 'rgba(215, 235, 252, 0)');
      grad.addColorStop(0.35, `rgba(224, 242, 254, ${(0.35 * snowAlpha).toFixed(3)})`);
      grad.addColorStop(0.7, `rgba(240, 248, 255, ${(0.68 * snowAlpha).toFixed(3)})`);
      grad.addColorStop(1, `rgba(255, 255, 255, ${(0.88 * snowAlpha).toFixed(3)})`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, r, c.startAngle, c.endAngle);
      ctx.arc(c.cx, c.cy, 38, c.endAngle, c.startAngle, true);
      ctx.closePath();
      ctx.fill();
    }

    // Individual crisp crystalline snow speckles / ice shavings
    for (const flake of this.cornerSnowFlakes) {
      const alpha = flake.alpha * snowAlpha;
      if (alpha <= 0.02) continue;
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1.0, alpha * 1.15).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(flake.x, flake.y, flake.r * (0.65 + snowAlpha * 0.35), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawPenaltyBoxes(
    ctx: CanvasRenderingContext2D,
    sim: MatchSimulation
  ): void {
    if (this.isIceSummaryActive && this.intermissionZoomBlend > 0.6) return;
    ctx.save();
    // Top center penalty boxes: Home centered at 425, Away centered at 575
    const boxes: {
      team: Team;
      cx: number;
      label: string;
      primaryColor: string;
      alertColor: string;
      trimColor: string;
    }[] = [
      {
        team: 'home',
        cx: CENTER_X - 75,
        label: 'HOME PENALTY',
        primaryColor: '#1d4ed8',
        alertColor: '#38bdf8',
        trimColor: '#60a5fa',
      },
      {
        team: 'away',
        cx: CENTER_X + 75,
        label: 'AWAY PENALTY',
        primaryColor: '#b91c1c',
        alertColor: '#ef4444',
        trimColor: '#fca5a5',
      },
    ];

    for (const b of boxes) {
      const hasPenalty = sim.players.some(
        (p) => p.team === b.team && p.mode === 'PENALTY_BOX'
      );
      const expand = this.penaltyBoxExpand[b.team];

      // Collapsed empty bench: tiny 80x9 strip hugging the top boards; Expanded: 96x55 box
      const boxW = 80 + 16 * expand;
      const boxH = 9 + 46 * expand;
      const bx = b.cx - boxW * 0.5;
      const by = 2;

      ctx.fillStyle =
        expand > 0.15
          ? `rgba(15, 23, 42, ${(0.72 + 0.22 * expand).toFixed(2)})`
          : 'rgba(15, 23, 42, 0.72)';
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 3 + 3 * expand);
      ctx.fill();

      // Outer border (subtle trim when collapsed, bright glowing alert when occupied)
      ctx.strokeStyle = hasPenalty ? b.alertColor : b.primaryColor;
      ctx.lineWidth = 1.2 + 1.3 * expand;
      if (hasPenalty && expand > 0.2) {
        ctx.shadowColor =
          b.team === 'home'
            ? 'rgba(56, 189, 248, 0.55)'
            : 'rgba(239, 68, 68, 0.55)';
        ctx.shadowBlur = 6 * expand;
      } else {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (expand < 0.35) {
        // Slim collapsed empty bench seat plank detail (takes almost zero screen space)
        ctx.strokeStyle = b.trimColor + '88';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(bx + 8, by + boxH * 0.5);
        ctx.lineTo(bx + boxW - 8, by + boxH * 0.5);
        ctx.stroke();
      } else {
        const contentAlpha = clamp((expand - 0.35) / 0.65, 0, 1);
        ctx.save();
        ctx.globalAlpha = contentAlpha;

        // Top title banner header
        ctx.fillStyle = 'rgba(30, 41, 59, 0.92)';
        ctx.beginPath();
        ctx.roundRect(bx + 1, by + 1, boxW - 2, 13, [5, 5, 0, 0]);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = '700 8.5px "Chakra Petch", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(b.label, b.cx, by + 10);

        ctx.restore();
      }
    }
    ctx.restore();
  }

  private drawPenaltyBoxTimers(
    ctx: CanvasRenderingContext2D,
    sim: MatchSimulation
  ): void {
    if (this.isIceSummaryActive && this.intermissionZoomBlend > 0.6) return;
    const penalized = sim.players.filter((p) => p.mode === 'PENALTY_BOX');
    if (penalized.length === 0) return;

    ctx.save();
    for (const p of penalized) {
      const expand = this.penaltyBoxExpand[p.team];
      const alpha = clamp((expand - 0.35) / 0.65, 0, 1);
      if (alpha <= 0.01) continue;

      const seatPos = sim.getPenaltyBoxPos(p.team, p.id);
      const remainingSec = Math.max(0, Math.ceil(p.stateTimer));
      const text = `${remainingSec}s`;

      const pillW = 38;
      const pillH = 15;
      const pillX = seatPos.x - pillW * 0.5;
      const pillY = 40; // Positioned cleanly inside the penalty box slot underneath y=28

      ctx.save();
      ctx.globalAlpha = alpha;

      // High-contrast obsidian pill with bright glowing amber border
      ctx.fillStyle = '#020617';
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillW, pillH, 4);
      ctx.fill();

      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.8;
      ctx.shadowColor = 'rgba(245, 158, 11, 0.75)';
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Digital neon clock readout
      ctx.fillStyle = '#fef08a';
      ctx.font = '800 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, seatPos.x, pillY + pillH * 0.5 + 0.5);

      ctx.restore();
    }
    ctx.restore();
  }

  private drawPuckTrailAndPuck(
    ctx: CanvasRenderingContext2D,
    sim: MatchSimulation
  ): void {
    ctx.save();
    const trail = sim.puck.trail;

    // Check if we should render the blazing scoring-shot streak (in flight OR lingering right after impact)
    const isScoringInFlight =
      sim.puck.inFlightShotFrom !== null && sim.puck.isScoringShot;
    const isScoringLinger =
      sim.phase === 'GOAL_CELEBRATION' && sim.phaseTimerSec > 1.85;
    const streakAlpha = isScoringInFlight
      ? 1.0
      : isScoringLinger
      ? Math.max(0, (sim.phaseTimerSec - 1.85) / 0.75)
      : 0;

    if (streakAlpha > 0 && sim.puck.shotStartPos) {
      const start = sim.puck.shotStartPos;
      const end = sim.puck.pos;

      // 1. Muzzle flash starburst at shot release point
      ctx.save();
      ctx.globalAlpha = streakAlpha;
      ctx.fillStyle = '#fef08a';
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(start.x, start.y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 2. Three-layer blazing laser/comet streak from stick to puck
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const drawStreakPath = () => {
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        for (const pt of trail) {
          ctx.lineTo(pt.x, pt.y);
        }
        ctx.lineTo(end.x, end.y);
      };

      // Outer plasma glow
      ctx.strokeStyle = `rgba(245, 158, 11, ${0.42 * streakAlpha})`;
      ctx.lineWidth = 18;
      drawStreakPath();
      ctx.stroke();

      // Mid fiery gold beam
      ctx.strokeStyle = `rgba(250, 204, 21, ${0.9 * streakAlpha})`;
      ctx.lineWidth = 9;
      drawStreakPath();
      ctx.stroke();

      // Inner white-hot core
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.98 * streakAlpha})`;
      ctx.lineWidth = 3.5;
      drawStreakPath();
      ctx.stroke();

      // 3. Speed spark embers along the trail
      for (let i = 0; i < trail.length; i += 2) {
        const pt = trail[i];
        const offset = (i % 4 === 0 ? 1 : -1) * (5 + (i % 3) * 2);
        ctx.fillStyle = i % 4 === 0 ? '#ffffff' : '#fde047';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y + offset, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else if (trail.length > 1) {
      // Standard or pass puck motion trail
      for (let i = 0; i < trail.length - 1; i++) {
        const alpha = ((i + 1) / trail.length) * 0.35;
        ctx.fillStyle =
          sim.puck.inFlightShotFrom !== null
            ? `rgba(245, 158, 11, ${alpha + 0.15})`
            : sim.puck.inFlightPassFromId !== null
            ? `rgba(56, 189, 248, ${alpha + 0.2})`
            : `rgba(15, 23, 42, ${alpha})`;
        ctx.beginPath();
        ctx.arc(
          trail[i].x,
          trail[i].y,
          sim.cfg.puckRadius * (0.4 + (0.6 * i) / trail.length),
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }

    // Subtle pass target guide line when an accurate pass is in flight
    if (sim.puck.carrierId === null && sim.puck.inFlightPassToId !== null) {
      const receiver = sim.players.find((pl) => pl.id === sim.puck.inFlightPassToId);
      if (receiver) {
        ctx.save();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(sim.puck.pos.x, sim.puck.pos.y);
        ctx.lineTo(receiver.pos.x, receiver.pos.y);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Loose / Scoring puck highlight ring
    if (sim.puck.carrierId === null) {
      if (isScoringInFlight) {
        ctx.fillStyle = 'rgba(250, 204, 21, 0.55)';
        ctx.beginPath();
        ctx.arc(
          sim.puck.pos.x,
          sim.puck.pos.y,
          sim.cfg.puckRadius + 9,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
      ctx.strokeStyle = isScoringInFlight
        ? '#ffffff'
        : sim.puck.inFlightShotFrom !== null
        ? 'rgba(245, 158, 11, 0.85)'
        : 'rgba(14, 165, 233, 0.55)';
      ctx.lineWidth = isScoringInFlight ? 3 : 2;
      ctx.beginPath();
      ctx.arc(sim.puck.pos.x, sim.puck.pos.y, sim.cfg.puckRadius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = isScoringInFlight ? '#fef08a' : '#090d16';
    ctx.beginPath();
    ctx.arc(sim.puck.pos.x, sim.puck.pos.y, sim.cfg.puckRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawGoalImpact(
    ctx: CanvasRenderingContext2D,
    sim: MatchSimulation
  ): void {
    if (sim.phase !== 'GOAL_CELEBRATION') return;
    const elapsed = 2.6 - sim.phaseTimerSec;
    if (elapsed < 0 || elapsed > 1.4) return;

    const prog = elapsed / 1.4;
    const alpha = Math.max(0, 1 - prog);
    const ix = sim.puck.pos.x;
    const iy = sim.puck.pos.y;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Outer golden shockwave ring
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 5 * (1 - prog * 0.6);
    ctx.beginPath();
    ctx.arc(ix, iy, 10 + prog * 95, 0, Math.PI * 2);
    ctx.stroke();

    // Inner white-hot shockwave ring
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3 * (1 - prog * 0.5);
    ctx.beginPath();
    ctx.arc(ix, iy, 6 + prog * 55, 0, Math.PI * 2);
    ctx.stroke();

    // Radial celebration spark burst
    for (let i = 0; i < 12; i++) {
      const ang = (i * Math.PI * 2) / 12 + prog * 0.4;
      const r1 = 12 + prog * 35;
      const r2 = 22 + prog * 75;
      ctx.strokeStyle = i % 2 === 0 ? '#fde047' : '#38bdf8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ix + Math.cos(ang) * r1, iy + Math.sin(ang) * r1);
      ctx.lineTo(ix + Math.cos(ang) * r2, iy + Math.sin(ang) * r2);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawPlayer(
    ctx: CanvasRenderingContext2D,
    p: PlayerEntity,
    sim: MatchSimulation,
    drawBars: boolean = true
  ): void {
    ctx.save();
    const r = p.role === 'goalie' ? sim.cfg.skaterRadius + 2 : sim.cfg.skaterRadius;

    // 1. Speed streaks when buffed by an active song or moving fast (skip for penalized players heading to box)
    const speed = Math.hypot(p.vel.x, p.vel.y);
    const isBuffedBySong =
      sim.activeSong !== null && doesSongAffectTeam(sim.activeSong.target, p.team);
    if (
      p.role === 'striker' &&
      p.mode !== 'PENALTY_BOX' &&
      speed > 140 &&
      (isBuffedBySong || speed > 195)
    ) {
      const dirX = -p.vel.x / speed;
      const dirY = -p.vel.y / speed;
      ctx.strokeStyle = isBuffedBySong
        ? SONGS[sim.activeSong!.songId].color + '99'
        : 'rgba(56, 189, 248, 0.45)';
      ctx.lineWidth = 3;
      for (const side of [-6, 0, 6]) {
        const perpX = -dirY * side;
        const perpY = dirX * side;
        ctx.beginPath();
        ctx.moveTo(p.pos.x + perpX + dirX * r, p.pos.y + perpY + dirY * r);
        ctx.lineTo(
          p.pos.x + perpX + dirX * (r + 18),
          p.pos.y + perpY + dirY * (r + 18)
        );
        ctx.stroke();
      }
    }

    // 2. Under-player mood ring (skip when penalized)
    if (p.mode !== 'PENALTY_BOX') {
      this.drawMoodRing(ctx, p, r);
    }

    // 3. Strong song tap flare ring & musical note particles
    if (p.reactionTimer > 0) {
      const prog = 1 - p.reactionTimer / 1.8;
      const flareRadius = r + 6 + prog * 24;
      const alpha = Math.max(0, (1 - prog) * 0.85);
      ctx.strokeStyle = p.reactionColor;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, flareRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Musical notes rising
      ctx.fillStyle = p.reactionColor;
      ctx.font = '700 13px sans-serif';
      ctx.fillText('♪', p.pos.x - 16, p.pos.y - r - 8 - prog * 18);
      ctx.fillText('♫', p.pos.x + 12, p.pos.y - r - 4 - prog * 22);
      ctx.globalAlpha = 1;
    }

    // 4. Puck carrier / Goalie glove-hold indicator ring
    if (sim.puck.carrierId === p.id && !this.isIceSummaryActive) {
      ctx.strokeStyle = p.mode === 'HOLDING_PUCK' ? '#2dd4bf' : '#facc15';
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, r + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 5. Player jersey body
    const primaryColor = p.team === 'home' ? '#1d4ed8' : '#dc2626';
    const trimColor = p.team === 'home' ? '#60a5fa' : '#fca5a5';

    ctx.fillStyle = primaryColor;
    ctx.strokeStyle = p.mode === 'STUNNED' ? '#94a3b8' : '#0f172a';
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    if (p.role === 'goalie') {
      // Goalie rounded pad silhouette
      ctx.roundRect(p.pos.x - r, p.pos.y - r, r * 2, r * 2, 6);
    } else {
      ctx.arc(p.pos.x, p.pos.y, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();

    // Inner shoulder stripe
    ctx.strokeStyle = trimColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.pos.x, p.pos.y, r - 3.5, 0, Math.PI * 2);
    ctx.stroke();

    // Jersey number
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 11px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(p.number), p.pos.x, p.pos.y + 0.5);

    // Stun stars
    if (p.mode === 'STUNNED') {
      ctx.fillStyle = '#fde047';
      ctx.font = '700 10px sans-serif';
      ctx.fillText('★ ★', p.pos.x, p.pos.y - r - 4);
    }

    // 6. Overhead Stat Bars (FOC / STA / AGG) when enabled (default ON)
    if (drawBars && this.showStatBars && p.mode !== 'PENALTY_BOX') {
      this.drawOverheadStatBars(ctx, p, r, sim);
    }

    ctx.restore();
  }

  private drawMoodRing(
    ctx: CanvasRenderingContext2D,
    p: PlayerEntity,
    r: number
  ): void {
    const pulse = 0.5 + 0.5 * Math.sin(this.animTime * 8);

    if (p.aggression >= 0.7) {
      // Crimson pulse = fight risk
      ctx.strokeStyle = `rgba(244, 63, 94, ${0.55 + 0.35 * pulse})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, r + 4 + pulse * 2.5, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.focus >= 0.7) {
      // Cyan glow = sniper/wall focus
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.75)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, r + 3.5, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.stamina <= 0.3) {
      // Amber dim ring = exhausted
      ctx.strokeStyle = 'rgba(217, 119, 6, 0.7)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, r + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawOverheadStatBars(
    ctx: CanvasRenderingContext2D,
    p: PlayerEntity,
    r: number,
    sim: MatchSimulation
  ): void {
    const boxW = 38;
    const barH = 3.5;
    const gap = 1.5;
    const totalH = p.role === 'goalie' ? barH * 2 + gap + 4 : barH * 3 + gap * 2 + 4;
    const x = p.pos.x - boxW * 0.5;
    const y = p.pos.y - r - totalH - 6;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
    ctx.strokeStyle =
      p.reactionTimer > 0 ? p.reactionColor : 'rgba(148, 163, 184, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - 3, y - 2, boxW + 6, totalH, 3);
    ctx.fill();
    ctx.stroke();

    const rows: { val: number; color: string }[] = [
      { val: p.focus, color: '#38bdf8' }, // FOC (Cyan)
      { val: p.stamina, color: '#4ade80' }, // STA (Green)
    ];
    if (p.role === 'striker') {
      rows.push({ val: p.aggression, color: '#fb7185' }); // AGG (Crimson)
    }

    for (let i = 0; i < rows.length; i++) {
      const ry = y + i * (barH + gap);
      ctx.fillStyle = 'rgba(51, 65, 85, 0.85)';
      ctx.fillRect(x, ry, boxW, barH);
      ctx.fillStyle = rows[i].color;
      ctx.fillRect(x, ry, Math.max(1, boxW * rows[i].val), barH);
    }

    // Show +/- arrow indicator while song is affecting this player
    if (
      sim.activeSong &&
      doesSongAffectTeam(sim.activeSong.target, p.team)
    ) {
      const songId = sim.activeSong.songId;
      const symbol =
        songId === 'charge'
          ? '▲FOC ▲AGG'
          : songId === 'hold_the_line'
          ? '▲DEF'
          : '▲▲AGG';
      ctx.fillStyle = SONGS[songId].color;
      ctx.font = '700 8px "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(symbol, p.pos.x, y - 5);
    }
  }

  private drawBrawlClouds(
    ctx: CanvasRenderingContext2D,
    sim: MatchSimulation
  ): void {
    const fighters = sim.players.filter((p) => p.mode === 'FIGHTING');
    if (fighters.length < 2) return;

    const drawnPairs = new Set<string>();
    for (const f of fighters) {
      if (!f.fightPartnerId) continue;
      const key = [f.id, f.fightPartnerId].sort().join('--');
      if (drawnPairs.has(key)) continue;
      drawnPairs.add(key);

      const partner = sim.players.find((p) => p.id === f.fightPartnerId);
      if (!partner) continue;

      const mx = (f.pos.x + partner.pos.x) * 0.5;
      const my = (f.pos.y + partner.pos.y) * 0.5;

      const instigator = f.isFightInstigator ? f : partner.isFightInstigator ? partner : f;
      const isHome = instigator.team === 'home';
      const brawlColor = isHome ? '#38bdf8' : '#f43f5e';
      const dustColor = isHome ? 'rgba(56, 189, 248, 0.78)' : 'rgba(251, 113, 133, 0.78)';

      ctx.save();
      // Cartoon brawl dust cloud puffs
      for (let i = 0; i < 6; i++) {
        const ang = this.animTime * 6 + (i * Math.PI) / 3;
        const px = mx + Math.cos(ang) * 14;
        const py = my + Math.sin(ang) * 10;
        ctx.fillStyle = i % 2 === 0 ? 'rgba(241, 245, 249, 0.90)' : dustColor;
        ctx.beginPath();
        ctx.arc(px, py, 14 + (i % 3) * 4, 0, Math.PI * 2);
        ctx.fill();
      }

      const brawlText = '💥 BRAWL! 💥';
      ctx.font = '800 13px "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.lineWidth = 3.5;
      ctx.strokeText(brawlText, mx, my);
      ctx.fillStyle = brawlColor;
      ctx.fillText(brawlText, mx, my);
      ctx.restore();
    }
  }

  private drawCallouts(ctx: CanvasRenderingContext2D, sim: MatchSimulation): void {
    ctx.save();
    for (const c of sim.callouts) {
      const alpha = Math.min(1, c.remainingSec / 0.5);
      ctx.globalAlpha = alpha;
      ctx.font = '700 14px "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      const textW = ctx.measureText(c.text).width;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(c.pos.x - textW * 0.5 - 10, c.pos.y - 12, textW + 20, 24, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = c.color;
      ctx.fillText(c.text, c.pos.x, c.pos.y + 4);
    }
    ctx.restore();
  }

  private drawPhaseBanner(
    ctx: CanvasRenderingContext2D,
    sim: MatchSimulation
  ): void {
    if (sim.phase !== 'FACEOFF_COUNTDOWN' && sim.phase !== 'GOAL_CELEBRATION') {
      return;
    }
    ctx.save();
    const label =
      sim.phase === 'FACEOFF_COUNTDOWN'
        ? `FACEOFF — DROP IN ${Math.max(1, Math.ceil(sim.phaseTimerSec * 0.5))}...`
        : '🚨 GOAL SCORED! 🚨';

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = sim.phase === 'GOAL_CELEBRATION' ? '#f43f5e' : '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(CENTER_X - 150, CENTER_Y - 68, 300, 34, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 15px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, CENTER_X, CENTER_Y - 51);
    ctx.restore();
  }
}
