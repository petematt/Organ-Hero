import { OrganSynth } from './audio/organSynth';
import { GameConfig, loadConfig } from './config';
import { pickRandomOrder } from './game/orders';
import { MatchSimulation } from './sim/match';
import { SeededRNG } from './sim/rng';
import { OrderId, SongId } from './sim/types';
import { DebugPanelController } from './ui/debugPanel';
import { HudController } from './ui/hud';
import { RinkRenderer } from './ui/rinkRenderer';
import { ScreenModalManager } from './ui/screens';

function parseUrlParams(): { seed: number | null; debug: boolean } {
  const params = new URLSearchParams(window.location.search);
  const seedRaw = params.get('seed');
  const parsedSeed = seedRaw !== null ? parseInt(seedRaw, 10) : NaN;
  const debug = params.get('debug') === '1';
  return {
    seed: Number.isNaN(parsedSeed) ? null : parsedSeed,
    debug,
  };
}

class OrganHeroApp {
  private cfg: GameConfig;
  private currentSeed: number;
  private sim: MatchSimulation;
  private renderer: RinkRenderer;
  private hud: HudController;
  private screens: ScreenModalManager;
  private debugPanel: DebugPanelController;
  private synth: OrganSynth;

  private speedMultiplier: 1 | 2 = 2; // Default 2x per user spec
  private isPaused: boolean = true;
  private hasStartedMatch: boolean = false;
  private lastFrameTimeMs: number = performance.now();
  private simAccumulatorSec: number = 0;

  constructor() {
    this.cfg = loadConfig();
    const urlOpts = parseUrlParams();
    this.currentSeed =
      urlOpts.seed ?? Math.floor(1000 + Math.random() * 9000);

    const initialOrder = pickRandomOrder(new SeededRNG(this.currentSeed)).id;
    this.sim = new MatchSimulation(this.cfg, this.currentSeed, initialOrder);
    this.synth = new OrganSynth();
    this.bindAudioHooks();

    const canvas = document.getElementById('rink-canvas') as HTMLCanvasElement;
    this.renderer = new RinkRenderer(canvas);
    this.hud = new HudController();

    this.screens = new ScreenModalManager({
      onTakeSeat: () => {
        this.synth.unlock();
        const assigned = pickRandomOrder(new SeededRNG(this.currentSeed)).id;
        this.screens.showOrderClipboard(assigned, this.currentSeed);
      },
      onStartMatchWithOrder: (orderId: OrderId) => {
        this.startNewMatch(this.currentSeed, orderId);
      },
      onContinueNextPeriod: () => {
        this.sim.startNextPeriod();
        this.isPaused = false;
      },
      onPlayAgainSameSeed: () => {
        this.startNewMatch(this.currentSeed, this.sim.orderId);
      },
      onPlayAgainNewSeed: () => {
        this.currentSeed = Math.floor(1000 + Math.random() * 9000);
        const assigned = pickRandomOrder(new SeededRNG(this.currentSeed)).id;
        this.screens.showOrderClipboard(assigned, this.currentSeed);
      },
      onChangeOrder: () => {
        this.isPaused = true;
        this.screens.showOrderClipboard(this.sim.orderId, this.currentSeed);
      },
      onResumeFromPause: () => {
        this.isPaused = false;
      },
    });

    this.debugPanel = new DebugPanelController({
      getConfig: () => this.cfg,
      getCurrentSeed: () => this.currentSeed,
      onConfigChange: (newCfg: GameConfig) => {
        this.cfg = newCfg;
        this.sim.cfg = newCfg;
      },
      onRestartWithSeed: (seed: number) => {
        this.currentSeed = seed;
        this.screens.hide();
        this.startNewMatch(this.currentSeed, this.sim.orderId);
      },
    });

    if (urlOpts.debug) {
      this.debugPanel.toggle(true);
    }

    this.bindControls();
    this.hud.update(this.sim);
    this.screens.showStartSeatScreen();

    requestAnimationFrame((t) => this.loop(t));
  }

  private bindAudioHooks(): void {
    this.sim.audioHooks = {
      onWhistle: () => this.synth.playWhistle(),
      onGoalHorn: () => this.synth.playGoalHorn(),
      onSongPlay: (songId, cueHit, stale) =>
        this.synth.playSong(songId, cueHit, stale),
    };
  }

  private startNewMatch(seed: number, orderId: OrderId): void {
    this.currentSeed = seed;
    this.sim = new MatchSimulation(this.cfg, seed, orderId);
    this.bindAudioHooks();
    this.hasStartedMatch = true;
    this.isPaused = false;
    this.simAccumulatorSec = 0;
    this.hud.update(this.sim);
  }

  private bindControls(): void {
    // Song buttons via Pointer Events
    const songMap: { id: string; song: SongId }[] = [
      { id: 'btn-song-charge', song: 'charge' },
      { id: 'btn-song-hold', song: 'hold_the_line' },
      { id: 'btn-song-grudge', song: 'grudge_toccata' },
    ];

    for (const item of songMap) {
      const btn = document.getElementById(item.id);
      btn?.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.triggerSong(item.song);
      });
    }

    // Speed toggle (1x / 2x, default 2x)
    const speedBtn = document.getElementById('btn-speed-toggle')!;
    speedBtn.addEventListener('click', () => {
      this.speedMultiplier = this.speedMultiplier === 2 ? 1 : 2;
      speedBtn.textContent = `${this.speedMultiplier}x`;
      speedBtn.classList.toggle('active-toggle', this.speedMultiplier === 2);
    });

    // Overhead stat bars toggle (default ON)
    const barsBtn = document.getElementById('btn-bars-toggle')!;
    barsBtn.addEventListener('click', () => {
      this.renderer.showStatBars = !this.renderer.showStatBars;
      barsBtn.textContent = `Bars: ${this.renderer.showStatBars ? 'ON' : 'OFF'}`;
      barsBtn.classList.toggle('active-toggle', this.renderer.showStatBars);
    });

    // Pause button
    const pauseBtn = document.getElementById('btn-pause')!;
    pauseBtn.addEventListener('click', () => {
      this.togglePause();
    });

    // Debug button
    const debugBtn = document.getElementById('btn-debug')!;
    debugBtn.addEventListener('click', () => {
      this.debugPanel.toggle();
    });

    // Keyboard shortcuts (1/2/3 for songs, Space for pause, ` for debug)
    window.addEventListener('keydown', (e) => {
      if (
        document.activeElement &&
        ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)
      ) {
        return;
      }
      if (e.key === '1') {
        this.triggerSong('charge');
      } else if (e.key === '2') {
        this.triggerSong('hold_the_line');
      } else if (e.key === '3') {
        this.triggerSong('grudge_toccata');
      } else if (e.key === ' ') {
        e.preventDefault();
        this.togglePause();
      } else if (e.key === '`') {
        e.preventDefault();
        this.debugPanel.toggle();
      }
    });

    // Auto-pause on visibility change / blur
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.hasStartedMatch && !this.isPaused) {
        this.togglePause(true);
      }
    });
  }

  private triggerSong(songId: SongId): void {
    if (this.isPaused || !this.hasStartedMatch) return;
    if (
      this.sim.phase === 'PERIOD_END' ||
      this.sim.phase === 'MATCH_OVER'
    ) {
      return;
    }
    this.synth.unlock();
    this.sim.playSong(songId);
    this.hud.update(this.sim);
  }

  private togglePause(forcePause?: boolean): void {
    if (!this.hasStartedMatch) return;
    if (
      this.sim.phase === 'PERIOD_END' ||
      this.sim.phase === 'MATCH_OVER'
    ) {
      return;
    }

    const nextPaused = forcePause !== undefined ? forcePause : !this.isPaused;
    this.isPaused = nextPaused;
    if (this.isPaused) {
      this.screens.showPauseModal(this.sim);
    } else {
      this.screens.hide();
    }
  }

  private isPortraitBlocked(): boolean {
    return window.innerHeight > window.innerWidth && window.innerWidth <= 900;
  }

  private loop(nowMs: number): void {
    const rawDtSec = Math.min(0.1, Math.max(0, (nowMs - this.lastFrameTimeMs) / 1000));
    this.lastFrameTimeMs = nowMs;

    const portraitBlocked = this.isPortraitBlocked();

    if (!this.isPaused && this.hasStartedMatch && !portraitBlocked) {
      const fixedStep = 1 / 60;
      this.simAccumulatorSec += rawDtSec * this.speedMultiplier;

      while (this.simAccumulatorSec >= fixedStep) {
        this.simAccumulatorSec -= fixedStep;
        const prevPhase = this.sim.phase;
        this.sim.step(fixedStep);

        if (prevPhase !== this.sim.phase) {
          if (this.sim.phase === 'PERIOD_END') {
            this.isPaused = true;
            this.screens.showPeriodBreakdown(this.sim);
            break;
          } else if (this.sim.phase === 'MATCH_OVER') {
            this.isPaused = true;
            this.screens.showGameBreakdown(this.sim);
            break;
          }
        }
      }

      this.hud.update(this.sim);
    }

    this.renderer.render(this.sim, rawDtSec);
    requestAnimationFrame((t) => this.loop(t));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new OrganHeroApp();
});
