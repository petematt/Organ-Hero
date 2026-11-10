import { OrganSynth } from './audio/organSynth';
import { CampaignManager } from './campaign/campaignState';
import { buildRosterForMatch } from './campaign/teams';
import { GameConfig, loadConfig, saveConfig } from './config';
import { evaluateOrder, pickRandomOrder } from './game/orders';
import { MatchSimulation } from './sim/match';
import { SeededRNG } from './sim/rng';
import { OrderId, SongId } from './sim/types';
import { DebugPanelController } from './ui/debugPanel';
import { HudController } from './ui/hud';
import { RinkRenderer } from './ui/rinkRenderer';
import { ScreenModalManager } from './ui/screens';

function parseUrlParams(): {
  seed: number | null;
  debug: boolean;
  autostart: boolean;
  screen: string | null;
} {
  const params = new URLSearchParams(window.location.search);
  const seedRaw = params.get('seed');
  const parsedSeed = seedRaw !== null ? parseInt(seedRaw, 10) : NaN;
  const debug = params.get('debug') === '1';
  const autostart = params.get('autostart') === '1';
  const screen = params.get('screen');
  return {
    seed: Number.isNaN(parsedSeed) ? null : parsedSeed,
    debug,
    autostart,
    screen,
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
  private campaign: CampaignManager;
  private currentMatchRecorded: boolean = false;

  private speedMultiplier: 1 | 2 = 2; // Default 2x per user spec
  private isPaused: boolean = true;
  private hasStartedMatch: boolean = false;
  private lastFrameTimeMs: number = performance.now();
  private simAccumulatorSec: number = 0;

  constructor() {
    this.cfg = loadConfig();
    this.campaign = new CampaignManager();
    const urlOpts = parseUrlParams();
    this.currentSeed =
      urlOpts.seed ?? Math.floor(1000 + Math.random() * 9000);

    const campMatch = this.campaign.getCurrentMatch();
    if (campMatch) {
      this.cfg.roster = buildRosterForMatch(campMatch.homeTeam, campMatch.awayTeam);
      this.cfg.maxSongSlots = this.campaign.getState().maxSongSlots;
      this.cfg.equippedSongs = [...this.campaign.getState().equippedSongs];
    }

    const initialOrder = campMatch
      ? campMatch.assignedOrderId
      : pickRandomOrder(new SeededRNG(this.currentSeed)).id;
    this.sim = new MatchSimulation(this.cfg, this.currentSeed, initialOrder);
    this.synth = new OrganSynth();
    this.bindAudioHooks();

    const canvas = document.getElementById('rink-canvas') as HTMLCanvasElement;
    this.renderer = new RinkRenderer(canvas, {
      onContinueNextPeriod: () => {
        this.sim.startNextPeriod();
        this.isPaused = false;
        this.hud.update(this.sim);
      },
      onPlayAgainSameSeed: () => {
        this.startNewMatch(this.currentSeed, this.sim.orderId);
      },
      onPlayAgainNewSeed: () => {
        this.currentSeed = Math.floor(1000 + Math.random() * 9000);
        const nextCampMatch = this.campaign.getCurrentMatch();
        const assigned = nextCampMatch
          ? nextCampMatch.assignedOrderId
          : pickRandomOrder(new SeededRNG(this.currentSeed)).id;
        this.startNewMatch(this.currentSeed, assigned);
      },
      onChangeOrder: () => {
        this.isPaused = true;
        const cm = this.campaign.getCurrentMatch();
        this.screens.showOrderClipboard(
          this.sim.orderId,
          this.currentSeed,
          cm,
          this.campaign.getOfficialReputationPct()
        );
      },
    });
    this.hud = new HudController();

    this.screens = new ScreenModalManager({
      onTakeSeat: () => {
        this.synth.unlock();
        void this.enterFullscreenIfPossible();
        const cm = this.campaign.getCurrentMatch();
        const assigned = cm
          ? cm.assignedOrderId
          : pickRandomOrder(new SeededRNG(this.currentSeed)).id;
        this.screens.showOrderClipboard(
          assigned,
          this.currentSeed,
          cm,
          this.campaign.getOfficialReputationPct()
        );
      },
      onStartMatchWithOrder: (orderId: OrderId) => {
        void this.enterFullscreenIfPossible();
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
        const cm = this.campaign.getCurrentMatch();
        const assigned = cm
          ? cm.assignedOrderId
          : pickRandomOrder(new SeededRNG(this.currentSeed)).id;
        this.screens.showOrderClipboard(
          assigned,
          this.currentSeed,
          cm,
          this.campaign.getOfficialReputationPct()
        );
      },
      onChangeOrder: () => {
        this.isPaused = true;
        const cm = this.campaign.getCurrentMatch();
        this.screens.showOrderClipboard(
          this.sim.orderId,
          this.currentSeed,
          cm,
          this.campaign.getOfficialReputationPct()
        );
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
        this.syncPassBtnState();
        this.hud.update(this.sim);
      },
      onRestartWithSeed: (seed: number) => {
        this.currentSeed = seed;
        this.screens.hide();
        this.renderer.resetIceSummaryImmediate();
        this.startNewMatch(this.currentSeed, this.sim.orderId);
      },
    });

    if (urlOpts.debug) {
      this.debugPanel.toggle(true);
    }

    this.bindControls();
    this.syncPassBtnState();
    this.hud.update(this.sim);
    if (urlOpts.autostart) {
      this.screens.hide();
      this.startNewMatch(this.currentSeed, initialOrder);
      for (let i = 0; i < 240; i++) {
        this.sim.step(1 / 60);
      }
      this.hud.update(this.sim);
    } else if (urlOpts.screen === 'clipboard') {
      this.screens.showOrderClipboard(initialOrder, this.currentSeed);
    } else {
      this.screens.showStartSeatScreen();
    }

    requestAnimationFrame((t) => this.loop(t));
  }

  private syncPassBtnState(): void {
    const passBtn = document.getElementById('btn-pass-toggle');
    if (passBtn) {
      passBtn.classList.toggle('active-toggle', Boolean(this.cfg.enablePassing));
    }
  }

  private togglePassing(): void {
    this.cfg.enablePassing = !this.cfg.enablePassing;
    this.sim.cfg.enablePassing = this.cfg.enablePassing;
    saveConfig(this.cfg);
    this.syncPassBtnState();
    if (this.debugPanel.isOpen()) {
      this.debugPanel.render();
    }
  }

  private isFullscreenActive(): boolean {
    const doc = document as Document & { webkitFullscreenElement?: Element };
    return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
  }

  private async enterFullscreenIfPossible(): Promise<void> {
    if (this.isFullscreenActive()) return;
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      }
    } catch {
      // Ignore if blocked by browser or unsupported
    }
    this.updateFullscreenBtnState();
    setTimeout(() => this.renderer.resize(), 80);
  }

  private async toggleFullscreen(): Promise<void> {
    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void>;
    };
    try {
      if (this.isFullscreenActive()) {
        if (doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        }
      } else {
        await this.enterFullscreenIfPossible();
      }
    } catch {
      // Ignore errors
    }
    this.updateFullscreenBtnState();
    setTimeout(() => this.renderer.resize(), 80);
  }

  private updateFullscreenBtnState(): void {
    const fsBtn = document.getElementById('btn-fullscreen');
    if (fsBtn) {
      fsBtn.classList.toggle('active-toggle', this.isFullscreenActive());
    }
  }

  private bindAudioHooks(): void {
    this.sim.audioHooks = {
      onWhistle: () => this.synth.playWhistle(),
      onGoalHorn: () => this.synth.playGoalHorn(),
      onSongPlay: (songId, cueHit, stale) => {
        this.synth.playSong(songId, cueHit, stale);
        if (cueHit) {
          this.campaign.recordCueHit(songId);
        }
      },
    };
  }

  private startNewMatch(seed: number, orderId: OrderId): void {
    this.currentSeed = seed;
    this.currentMatchRecorded = false;
    this.renderer.resetIceSummaryImmediate();

    const campMatch = this.campaign.getCurrentMatch();
    if (campMatch) {
      this.cfg.roster = buildRosterForMatch(campMatch.homeTeam, campMatch.awayTeam);
      this.cfg.maxSongSlots = this.campaign.getState().maxSongSlots;
      this.cfg.equippedSongs = [...this.campaign.getState().equippedSongs];
    }

    this.sim = new MatchSimulation(this.cfg, seed, orderId);
    this.bindAudioHooks();
    this.hasStartedMatch = true;
    this.isPaused = false;
    this.simAccumulatorSec = 0;
    this.hud.update(this.sim);
    setTimeout(() => this.renderer.resize(), 20);
  }

  private bindControls(): void {
    // Song buttons via Pointer Event delegation on .music-stand-buttons
    const musicStandEl = document.querySelector('.music-stand-buttons');
    musicStandEl?.addEventListener('pointerdown', (e) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest<HTMLButtonElement>('[data-song]');
      if (!btn) return;
      e.preventDefault();
      const songId = btn.dataset.song as SongId | undefined;
      if (songId) {
        this.triggerSong(songId);
      }
    });

    // Speed toggle (1x / 2x, default 2x)
    const speedBtn = document.getElementById('btn-speed-toggle')!;
    speedBtn.addEventListener('click', () => {
      this.speedMultiplier = this.speedMultiplier === 2 ? 1 : 2;
      speedBtn.textContent = `${this.speedMultiplier}x`;
      speedBtn.classList.toggle('active-toggle', this.speedMultiplier === 2);
    });

    // Team Passing toggle (default ON)
    const passBtn = document.getElementById('btn-pass-toggle');
    passBtn?.addEventListener('click', () => {
      this.togglePassing();
    });

    // Overhead stat bars toggle (default ON)
    const barsBtn = document.getElementById('btn-bars-toggle')!;
    barsBtn.addEventListener('click', () => {
      this.renderer.showStatBars = !this.renderer.showStatBars;
      barsBtn.classList.toggle('active-toggle', this.renderer.showStatBars);
    });

    // Fullscreen toggle button
    const fsBtn = document.getElementById('btn-fullscreen');
    fsBtn?.addEventListener('click', () => {
      void this.toggleFullscreen();
    });

    document.addEventListener('fullscreenchange', () => {
      this.updateFullscreenBtnState();
      this.renderer.resize();
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

    // Keyboard shortcuts (1..N for active song slots, P for passing toggle, Space for pause, F for fullscreen, ` for debug)
    window.addEventListener('keydown', (e) => {
      if (
        document.activeElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
      ) {
        return;
      }
      const slotIdx = ['1', '2', '3', '4', '5', '6'].indexOf(e.key);
      if (slotIdx !== -1) {
        const loadout = this.sim.getActiveSongLoadout();
        if (slotIdx < loadout.length) {
          this.triggerSong(loadout[slotIdx]);
        }
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        this.togglePassing();
      } else if (e.key === ' ') {
        e.preventDefault();
        this.togglePause();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        void this.toggleFullscreen();
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
      this.sim.phase === 'MATCH_OVER' ||
      this.renderer.isSummaryOrZamboniActive()
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
      this.sim.phase === 'MATCH_OVER' ||
      this.renderer.isSummaryOrZamboniActive()
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
          if (this.sim.phase === 'PERIOD_END' || this.sim.phase === 'MATCH_OVER') {
            this.isPaused = true;
            if (this.sim.phase === 'MATCH_OVER' && !this.currentMatchRecorded) {
              this.currentMatchRecorded = true;
              const campMatch = this.campaign.getCurrentMatch();
              if (campMatch) {
                const evalRes = evaluateOrder(this.sim.orderId, {
                  homeGoals: this.sim.homeScore,
                  awayGoals: this.sim.awayScore,
                  totalFights: this.sim.events.filter(
                    (e) => e.type === 'FIGHT'
                  ).length,
                  averageCrowdVolume:
                    this.sim.crowdSamples.reduce((a, b) => a + b.volume, 0) /
                    (this.sim.crowdSamples.length || 1),
                  isMatchOver: true,
                });
                const baseSalary = evalRes.passed
                  ? Math.round(campMatch.baseSalary * campMatch.payoutMultiplier)
                  : 0;
                this.campaign.recordMatchEnd({
                  homeScore: this.sim.homeScore,
                  awayScore: this.sim.awayScore,
                  officialOrderId: this.sim.orderId,
                  officialOrderPassed: evalRes.passed,
                  baseSalaryEarned: baseSalary,
                  tipsOffered: 0,
                  tipsPassed: 0,
                  tipEarnings: 0,
                  totalEarnings: baseSalary,
                });
              }
            }
            this.renderer.beginIceSummary(this.sim);
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
