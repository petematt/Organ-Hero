import { doesSongAffectTeam, SONGS } from '../game/songs';
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
import { PlayerEntity } from '../sim/types';

export class RinkRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  public showStatBars: boolean = true; // Default ON per user requirement
  private animTime: number = 0;

  // Dynamic camera zoom & focus state for scoring shots and goal impacts
  private camZoom: number = 1.0;
  private camFocusX: number = CENTER_X;
  private camFocusY: number = CENTER_Y;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not initialize 2D canvas context');
    }
    this.ctx = context;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  public resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Letterbox to preserve 1000 x 425 rink aspect ratio with a small margin
    const targetAspect = RINK_WIDTH / RINK_HEIGHT;
    let drawW = rect.width;
    let drawH = rect.height;

    if (drawW / Math.max(1, drawH) > targetAspect) {
      drawW = drawH * targetAspect;
    } else {
      drawH = drawW / targetAspect;
    }

    this.canvas.style.width = `${Math.floor(drawW)}px`;
    this.canvas.style.height = `${Math.floor(drawH)}px`;
    this.canvas.width = Math.max(1, Math.floor(drawW * dpr));
    this.canvas.height = Math.max(1, Math.floor(drawH * dpr));
  }

  public render(sim: MatchSimulation, realDtSec: number): void {
    this.animTime += realDtSec;
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // Compute camera zoom & focus target
    let targetZoom = 1.0;
    let targetFocusX = CENTER_X;
    let targetFocusY = CENTER_Y;

    if (sim.puck.inFlightShotFrom !== null && sim.puck.isScoringShot) {
      targetZoom = 1.14;
      const goalX =
        sim.puck.inFlightShotFrom === 'home' ? AWAY_GOAL_X - 85 : HOME_GOAL_X + 85;
      targetFocusX = sim.puck.pos.x * 0.35 + goalX * 0.65;
      targetFocusY = CENTER_Y + (sim.puck.pos.y - CENTER_Y) * 0.35;
    } else if (sim.phase === 'GOAL_CELEBRATION' && sim.phaseTimerSec > 1.1) {
      targetZoom = 1.16;
      targetFocusX =
        sim.puck.pos.x < CENTER_X ? HOME_GOAL_X + 95 : AWAY_GOAL_X - 95;
      targetFocusY = CENTER_Y;
    }

    const lerpRate = Math.min(1, realDtSec * 9.5);
    this.camZoom += (targetZoom - this.camZoom) * lerpRate;
    this.camFocusX += (targetFocusX - this.camFocusX) * lerpRate;
    this.camFocusY += (targetFocusY - this.camFocusY) * lerpRate;

    // Screen shake punch right as the puck slams into the back of the net
    let shakeX = 0;
    let shakeY = 0;
    if (sim.phase === 'GOAL_CELEBRATION' && sim.phaseTimerSec > 1.9) {
      const intensity = ((sim.phaseTimerSec - 1.9) / 0.7) * 6.5;
      shakeX = Math.sin(this.animTime * 95) * intensity;
      shakeY = Math.cos(this.animTime * 115) * intensity;
    }

    ctx.save();
    ctx.clearRect(0, 0, cw, ch);

    const pad = 6;
    const scaleX = (cw - pad * 2) / RINK_WIDTH;
    const scaleY = (ch - pad * 2) / RINK_HEIGHT;
    const scale = Math.min(scaleX, scaleY);
    const offsetX = (cw - RINK_WIDTH * scale) * 0.5;
    const offsetY = (ch - RINK_HEIGHT * scale) * 0.5;

    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Apply camera zoom & impact shake around the focus target
    ctx.translate(CENTER_X + shakeX, CENTER_Y + shakeY);
    ctx.scale(this.camZoom, this.camZoom);
    ctx.translate(-this.camFocusX, -this.camFocusY);

    this.drawIceAndMarkings(ctx, sim);
    this.drawPenaltyBoxes(ctx, sim);
    this.drawPuckTrailAndPuck(ctx, sim);

    // Draw players sorted by Y for clean layering
    const sortedPlayers = [...sim.players].sort((a, b) => a.pos.y - b.pos.y);
    for (const p of sortedPlayers) {
      this.drawPlayer(ctx, p, sim);
    }

    this.drawBrawlClouds(ctx, sim);
    this.drawGoalImpact(ctx, sim);
    this.drawCallouts(ctx, sim);
    this.drawPhaseBanner(ctx, sim);

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

    // Crisp stadium ice gradient
    const iceGrad = ctx.createLinearGradient(0, 0, 0, RINK_HEIGHT);
    iceGrad.addColorStop(0, '#e6f1f8');
    iceGrad.addColorStop(0.5, '#f2f8fc');
    iceGrad.addColorStop(1, '#dcebf5');
    ctx.fillStyle = iceGrad;
    ctx.fill();
    ctx.clip();

    // Active song subtle ice tint
    if (sim.activeSong) {
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

  private drawPenaltyBoxes(
    ctx: CanvasRenderingContext2D,
    sim: MatchSimulation
  ): void {
    ctx.save();
    // Top center penalty boxes (Home left of center, Away right of center)
    const boxes: { x: number; label: string; color: string }[] = [
      { x: CENTER_X - 115, label: 'HOME PENALTY BOX', color: '#1d4ed8' },
      { x: CENTER_X + 35, label: 'AWAY PENALTY BOX', color: '#b91c1c' },
    ];

    for (const b of boxes) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2;
      ctx.fillRect(b.x, 4, 80, 32);
      ctx.strokeRect(b.x, 4, 80, 32);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '700 8px "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(b.label, b.x + 40, 13);
    }

    // Draw countdown timers for any player in PENALTY_BOX
    for (const p of sim.players) {
      if (p.mode === 'PENALTY_BOX') {
        ctx.fillStyle = '#fbbf24';
        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(
          `${Math.ceil(p.stateTimer)}s`,
          p.pos.x,
          p.pos.y + 18
        );
      }
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
      // Standard puck motion trail
      for (let i = 0; i < trail.length - 1; i++) {
        const alpha = ((i + 1) / trail.length) * 0.35;
        ctx.fillStyle =
          sim.puck.inFlightShotFrom !== null
            ? `rgba(245, 158, 11, ${alpha + 0.15})`
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
    sim: MatchSimulation
  ): void {
    ctx.save();
    const r = p.role === 'goalie' ? sim.cfg.skaterRadius + 2 : sim.cfg.skaterRadius;

    // 1. Speed streaks when buffed by an active song or moving fast
    const speed = Math.hypot(p.vel.x, p.vel.y);
    const isBuffedBySong =
      sim.activeSong !== null && doesSongAffectTeam(sim.activeSong.target, p.team);
    if (p.role === 'striker' && speed > 140 && (isBuffedBySong || speed > 195)) {
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

    // 2. Under-player mood ring
    this.drawMoodRing(ctx, p, r);

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

    // 4. Puck carrier indicator ring
    if (sim.puck.carrierId === p.id) {
      ctx.strokeStyle = '#facc15';
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
    if (this.showStatBars && p.mode !== 'PENALTY_BOX') {
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

      ctx.save();
      // Cartoon brawl dust cloud puffs
      for (let i = 0; i < 6; i++) {
        const ang = this.animTime * 6 + (i * Math.PI) / 3;
        const px = mx + Math.cos(ang) * 14;
        const py = my + Math.sin(ang) * 10;
        ctx.fillStyle = i % 2 === 0 ? 'rgba(241, 245, 249, 0.88)' : 'rgba(251, 113, 133, 0.78)';
        ctx.beginPath();
        ctx.arc(px, py, 14 + (i % 3) * 4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#be123c';
      ctx.font = '700 13px "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💥 BRAWL! 💥', mx, my);
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
