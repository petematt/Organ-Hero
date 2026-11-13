import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneConfig } from '../../config';
import { MatchSimulation } from '../match';
import { RINK_HEIGHT } from '../physics';
import { PlayerEntity } from '../types';
import { SONGS } from '../../game/songs';
import { HudController } from '../../ui/hud';
import { RinkRenderer } from '../../ui/rinkRenderer';
import { ScreenModalManager } from '../../ui/screens';
import { TipOffer } from '../../campaign/tips';
import { CampaignManager } from '../../campaign/campaignState';

class MockElement {
  public innerHTML: string = '';
  public classList = {
    add: vi.fn(),
    remove: vi.fn(),
    contains: vi.fn().mockReturnValue(false),
  };
  public addEventListener = vi.fn();
  public querySelectorAll = vi.fn().mockReturnValue([]);
  public get textContent(): string {
    return this.innerHTML.replace(/<[^>]*>/g, '').trim();
  }
}

describe('End-of-Game UI Improvements', () => {
  let sim: MatchSimulation;
  let backdropEl: MockElement;
  let contentEl: MockElement;
  let elementMap: Map<string, MockElement>;

  beforeEach(() => {
    backdropEl = new MockElement();
    contentEl = new MockElement();
    elementMap = new Map();
    elementMap.set('modal-backdrop', backdropEl);
    elementMap.set('modal-content', contentEl);

    (globalThis as unknown as { document: unknown }).document = {
      getElementById: (id: string) => {
        if (!elementMap.has(id)) {
          elementMap.set(id, new MockElement());
        }
        return elementMap.get(id);
      },
    };

    const cfg = cloneConfig();
    sim = new MatchSimulation(cfg, 4242, 'home_wins');
    sim.period = 3;
    sim.periodTimeRemainingSec = 0;
    sim.phase = 'MATCH_OVER';
    sim.homeScore = 3;
    sim.awayScore = 2;
  });

  it('drops the seed number from the end-of-game modal header', () => {
    const screens = new ScreenModalManager({
      onTakeSeat: vi.fn(),
      onStartMatchWithOrder: vi.fn(),
      onContinueNextPeriod: vi.fn(),
      onPlayAgainNewSeed: vi.fn(),
      onResumeFromPause: vi.fn(),
    });

    screens.showGameBreakdown(sim);

    expect(contentEl.innerHTML).toContain('FINAL BUZZER');
    expect(contentEl.innerHTML).not.toContain('SEED #');
    expect(contentEl.innerHTML).not.toContain('4242');
  });

  it('renders sections in exact required order: 1. Score, 2. Stats box, 3. Official orders, 4. Bribes (if taken), 5. Continue button', () => {
    const screens = new ScreenModalManager({
      onTakeSeat: vi.fn(),
      onStartMatchWithOrder: vi.fn(),
      onContinueNextPeriod: vi.fn(),
      onPlayAgainNewSeed: vi.fn(),
      onResumeFromPause: vi.fn(),
    });

    const activeTips: TipOffer[] = [
      {
        id: 'tip-1',
        senderName: 'Slick Sal',
        senderTitle: 'Local Bookie',
        flavorText: 'Keep it close.',
        conditionDescription: 'Home team wins by 1 goal',
        bribePayout: 500,
        unofficialRepDelta: 1,
        scope: 'FULL_MATCH',
        evaluatorId: 'eval-1',
        liveProgressText: '1 goal lead',
        conflictsWithOfficial: false,
        status: 'PASSED',
      },
    ];

    screens.showGameBreakdown(sim, activeTips);

    const html = contentEl.innerHTML;

    // Check positions of sections in the generated markup
    const scoreIdx = html.indexOf('breakdown-score-banner');
    const statsTableIdx = html.indexOf('period-summary-table');
    const organImpactIdx = html.indexOf('impact-callout-box');
    const ordersIdx = html.indexOf('order-final-banner');
    const bribesIdx = html.indexOf('bribes-final-box');
    const continueBtnIdx = html.indexOf('btn-game-over-continue');

    expect(scoreIdx).toBeGreaterThan(-1);
    expect(statsTableIdx).toBeGreaterThan(-1);
    expect(organImpactIdx).toBeGreaterThan(-1);
    expect(ordersIdx).toBeGreaterThan(-1);
    expect(bribesIdx).toBeGreaterThan(-1);
    expect(continueBtnIdx).toBeGreaterThan(-1);

    // Section 1: Score must be first
    expect(scoreIdx).toBeLessThan(statsTableIdx);
    // Section 2: Period & final stats box
    expect(statsTableIdx).toBeLessThan(ordersIdx);
    expect(organImpactIdx).toBeLessThan(ordersIdx);
    // Section 3: Official orders
    expect(ordersIdx).toBeLessThan(bribesIdx);
    // Section 4: Bribes
    expect(bribesIdx).toBeLessThan(continueBtnIdx);
    // Section 5: Continue button
    expect(continueBtnIdx).toBeGreaterThan(bribesIdx);

    // Verify Continue button is present with correct label
    expect(html).toContain('id="btn-game-over-continue"');
    expect(html).toContain('Continue');

    // Verify replay seed and change orders buttons are dropped
    expect(html).not.toContain('btn-replay-same-seed');
    expect(html).not.toContain('btn-change-order');
    expect(html).not.toContain('btn-replay-new-seed');
  });

  it('omits the bribes section when no bribes were taken', () => {
    const screens = new ScreenModalManager({
      onTakeSeat: vi.fn(),
      onStartMatchWithOrder: vi.fn(),
      onContinueNextPeriod: vi.fn(),
      onPlayAgainNewSeed: vi.fn(),
      onResumeFromPause: vi.fn(),
    });

    const activeTips: TipOffer[] = [
      {
        id: 'tip-unaccepted',
        senderName: 'Anonymous',
        senderTitle: 'Shady Fan',
        flavorText: 'Hey you',
        conditionDescription: 'Unaccepted bribe',
        bribePayout: 300,
        unofficialRepDelta: 1,
        scope: 'FULL_MATCH',
        evaluatorId: 'eval-2',
        liveProgressText: 'Pending',
        conflictsWithOfficial: false,
        status: 'OFFERED',
      },
    ];

    screens.showGameBreakdown(sim, activeTips);

    expect(contentEl.innerHTML).not.toContain('bribes-final-box');
    expect(contentEl.innerHTML).not.toContain('Under-The-Table Bribes');
  });

  it('cleans up the intro modal (showStartSeatScreen) per UI specifications', () => {
    const screens = new ScreenModalManager({
      onTakeSeat: vi.fn(),
      onStartMatchWithOrder: vi.fn(),
      onContinueNextPeriod: vi.fn(),
      onPlayAgainNewSeed: vi.fn(),
      onResumeFromPause: vi.fn(),
    });

    screens.showStartSeatScreen();
    const html = contentEl.innerHTML;

    // 1. Only show the 2 songs the player has access to (Charge! Fanfare and Hold the Line)
    expect(html).toContain('<strong>Charge! Fanfare</strong>');
    expect(html).toContain('<strong>Hold the Line</strong>');
    expect(html).not.toContain('Grudge Toccata');

    // 2. Drop emoji/symbols and numbers in brackets from song cells
    expect(html).not.toContain('[1]');
    expect(html).not.toContain('[2]');
    expect(html).not.toContain('[3]');
    expect(html).not.toContain('♪');
    expect(html).not.toContain('♫');
    expect(html).not.toContain('♬');

    // 3. Button text is just "Continue" with no emoji
    expect(html).toContain('id="btn-take-seat"');
    expect(html).not.toContain('🎹');
    expect(html).not.toContain('TAP TO TAKE YOUR SEAT');
    const btnMatch = html.match(/<button id="btn-take-seat"[^>]*>([\s\S]*?)<\/button>/);
    expect(btnMatch).not.toBeNull();
    expect(btnMatch![1].trim()).toBe('Continue');

    // 4. Remove "Stadium pipe organ console"
    expect(html.toLowerCase()).not.toContain('stadium pipe organ console');

    // 5. Show "Your organ repertoire" heading after game description and before song tiles
    const leadIdx = html.indexOf('class="modal-lead"');
    const headingIdx = html.indexOf('<h3 class="seat-repertoire-heading">Your organ repertoire</h3>');
    const tilesIdx = html.indexOf('class="seat-tips-grid"');
    expect(leadIdx).toBeGreaterThan(-1);
    expect(headingIdx).toBeGreaterThan(leadIdx);
    expect(tilesIdx).toBeGreaterThan(headingIdx);
  });

  it('cleans up the official orders modal (showOrderClipboard) per UI specifications', () => {
    const onStartMatchWithOrder = vi.fn();
    const screens = new ScreenModalManager({
      onTakeSeat: vi.fn(),
      onStartMatchWithOrder,
      onContinueNextPeriod: vi.fn(),
      onPlayAgainNewSeed: vi.fn(),
      onResumeFromPause: vi.fn(),
    });

    screens.showOrderClipboard('home_wins', 4242);
    const html = contentEl.innerHTML;

    // 1. Remove "pre-match management directive" and seed information line
    expect(html.toLowerCase()).not.toContain('pre-match management directive');
    expect(html.toLowerCase()).not.toContain('seed #');
    expect(html).not.toContain('4242');

    // 2. Title changed to "Commissioner's Official Orders" with no emoji
    expect(html).toContain(`<h2 class="modal-title">Commissioner's Official Orders</h2>`);
    expect(html).not.toContain('📋');

    // 3. Drop the "switch directive" section
    expect(html.toLowerCase()).not.toContain('switch directive');
    expect(html).not.toContain('order-picker-section');
    expect(html).not.toContain('order-option-btn');

    // 4. Update button to "Drop the puck" with no emoji and no parenthetical
    expect(html).toContain('id="btn-drop-puck"');
    expect(html).not.toContain('🏒');
    expect(html).not.toContain('(START PERIOD 1)');
    const btnMatch = html.match(/<button id="btn-drop-puck"[^>]*>([\s\S]*?)<\/button>/);
    expect(btnMatch).not.toBeNull();
    expect(btnMatch![1].trim()).toBe('Drop the puck');
  });

  it('renders Locker-Room Corkboard & Greaseboard semantic layout across Pause, Shop, and Season modals without nested .modal-card', () => {
    const store: Record<string, string> = {};
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    };

    const screens = new ScreenModalManager({
      onTakeSeat: vi.fn(),
      onStartMatchWithOrder: vi.fn(),
      onContinueNextPeriod: vi.fn(),
      onPlayAgainNewSeed: vi.fn(),
      onResumeFromPause: vi.fn(),
    });

    const mgr = new CampaignManager();

    // Shop modal should add wide-board-host, render pinned sheets & setlist chips, and NOT double-nest .modal-card
    screens.showOrganLoftShop(mgr, vi.fn());
    expect(contentEl.classList.add).toHaveBeenCalledWith('wide-board-host');
    expect(contentEl.innerHTML).toContain('shop-board-grid');
    expect(contentEl.innerHTML).toContain('scout-report-card');
    expect(contentEl.innerHTML).toContain('setlist-chip');
    expect(contentEl.innerHTML).toContain('CHARGE! FANFARE');
    expect(contentEl.innerHTML).not.toContain('class="modal-card');

    // Pause modal should render cork-pinned-sheet cards in a 2-column pause-board-grid
    screens.showPauseModal(sim, []);
    expect(contentEl.innerHTML).toContain('pause-board-grid');
    expect(contentEl.innerHTML).toContain('directive-pin-card');
    expect(contentEl.innerHTML).toContain('bribes-pin-card');

    // Season summary modal should render 4 pinned stat cards and proper singular/plural labels
    screens.showSeasonEndSummaryModal(mgr, vi.fn());
    expect(contentEl.innerHTML).toContain('season-stats-grid');
    expect(contentEl.innerHTML).toContain('0 tips');
    expect(contentEl.innerHTML).toContain('2/6 slots');
  });
});

interface RecordedStroke {
  strokeStyle: unknown;
  shadowColor: string;
  shadowBlur: number;
  lineWidth: number;
  globalAlpha: number;
  lineDash: number[];
}

function createMockCanvasEnvironment() {
  const strokes: RecordedStroke[] = [];

  const createCtx = () => {
    const stateStack: Array<{
      strokeStyle: unknown;
      fillStyle: unknown;
      shadowColor: string;
      shadowBlur: number;
      lineWidth: number;
      globalAlpha: number;
      lineDash: number[];
    }> = [];

    const state = {
      strokeStyle: '#000000' as unknown,
      fillStyle: '#000000' as unknown,
      shadowColor: 'transparent',
      shadowBlur: 0,
      lineWidth: 1,
      globalAlpha: 1,
      lineDash: [] as number[],
      lineDashOffset: 0,
      font: '12px sans-serif',
      textAlign: 'left',
      textBaseline: 'alphabetic',
    };

    const gradientStub = {
      addColorStop: vi.fn(),
    };

    return new Proxy(state, {
      get(target, prop: string) {
        if (prop === 'save') {
          return () => {
            stateStack.push({
              ...target,
              lineDash: [...target.lineDash],
            });
          };
        }
        if (prop === 'restore') {
          return () => {
            const prev = stateStack.pop();
            if (prev) {
              Object.assign(target, prev);
            }
          };
        }
        if (prop === 'setLineDash') {
          return (dash: number[]) => {
            target.lineDash = [...dash];
          };
        }
        if (prop === 'stroke') {
          return () => {
            strokes.push({
              strokeStyle: target.strokeStyle,
              shadowColor: target.shadowColor,
              shadowBlur: target.shadowBlur,
              lineWidth: target.lineWidth,
              globalAlpha: target.globalAlpha,
              lineDash: [...target.lineDash],
            });
          };
        }
        if (
          prop === 'createLinearGradient' ||
          prop === 'createRadialGradient'
        ) {
          return () => gradientStub;
        }
        if (prop === 'measureText') {
          return (text: string) => ({ width: text.length * 7 });
        }
        if (prop in target) {
          return (target as Record<string, unknown>)[prop];
        }
        return vi.fn();
      },
      set(target, prop: string, value: unknown) {
        (target as Record<string, unknown>)[prop] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
  };

  const createCanvas = () =>
    ({
      width: 1280,
      height: 720,
      style: { width: '', height: '', cursor: '' },
      parentElement: {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 1280,
          height: 720,
        }),
      },
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 1280,
        height: 720,
      }),
      getContext: () => createCtx(),
      addEventListener: vi.fn(),
      setPointerCapture: vi.fn(),
    }) as unknown as HTMLCanvasElement;

  return { createCanvas, strokes };
}

describe('Game UI Cleanup', () => {
  const fsMod = (
    globalThis as unknown as {
      process: {
        getBuiltinModule: (name: string) => {
          readFileSync: (filePath: string, encoding: string) => string;
        };
      };
    }
  ).process.getBuiltinModule('node:fs');
  const indexHtml = fsMod.readFileSync('index.html', 'utf8');
  const styleCss = fsMod.readFileSync('src/style.css', 'utf8');

  it('removes the orders and tips callouts at the top of the screen and screen-edge tint from index.html', () => {
    expect(indexHtml).not.toContain('id="hud-order-box"');
    expect(indexHtml).not.toContain('id="hud-tip-box"');
    expect(indexHtml).not.toContain('id="hud-order-title"');
    expect(indexHtml).not.toContain('id="hud-tip-title"');
    expect(indexHtml).not.toContain('id="edge-tint"');
    expect(styleCss).not.toContain('.edge-tint');
  });

  it('updates HudController cleanly without orders/tips callouts or edge-tint DOM nodes', () => {
    const elementMap = new Map<string, Record<string, unknown>>();
    const makeDomNode = (): Record<string, unknown> => ({
      textContent: '',
      innerHTML: '',
      className: '',
      title: '',
      disabled: false,
      style: { width: '', boxShadow: '', background: '' },
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
        toggle: vi.fn(),
        contains: vi.fn().mockReturnValue(false),
      },
      addEventListener: vi.fn(),
      appendChild: vi.fn(),
      querySelector: () => makeDomNode(),
    });

    (globalThis as unknown as { document: unknown }).document = {
      getElementById: (id: string) => {
        // Explicitly return null for removed elements to prove HudController never queries them
        if (
          id === 'hud-order-box' ||
          id === 'hud-order-title' ||
          id === 'hud-order-status' ||
          id === 'hud-tip-box' ||
          id === 'hud-tip-title' ||
          id === 'hud-tip-status' ||
          id === 'edge-tint'
        ) {
          return null;
        }
        if (!elementMap.has(id)) {
          elementMap.set(id, makeDomNode());
        }
        return elementMap.get(id);
      },
      querySelector: () => makeDomNode(),
      createElement: () => makeDomNode(),
    };

    const sim = new MatchSimulation(cloneConfig(), 4242, 'home_wins');
    sim.playSong('charge');
    const hud = new HudController();

    expect(() => hud.update(sim)).not.toThrow();
  });

  it('horizontally centers text and content inside song buttons in style.css', () => {
    const songBtnBlock = styleCss.match(/\.song-btn\s*\{([\s\S]*?)\}/);
    expect(songBtnBlock).not.toBeNull();
    expect(songBtnBlock![1]).toContain('text-align: center');
    expect(songBtnBlock![1]).toContain('align-items: center');

    const songBtnTopBlock = styleCss.match(/\.song-btn-top\s*\{([\s\S]*?)\}/);
    expect(songBtnTopBlock).not.toBeNull();
    expect(songBtnTopBlock![1]).toContain('justify-content: center');

    const songBtnDescBlock = styleCss.match(/\.song-btn-desc\s*\{([\s\S]*?)\}/);
    expect(songBtnDescBlock).not.toBeNull();
    expect(songBtnDescBlock![1]).toContain('text-align: center');

    const songBtnTargetBlock = styleCss.match(/\.song-btn-target\s*\{([\s\S]*?)\}/);
    expect(songBtnTargetBlock).not.toBeNull();
    expect(songBtnTargetBlock![1]).toContain('justify-content: center');
  });

  it('pulses the stadium walls with glowing energy when a song is active', () => {
    const { createCanvas, strokes } = createMockCanvasEnvironment();
    (globalThis as unknown as { window: unknown }).window = {
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
    };
    (globalThis as unknown as { document: unknown }).document = {
      createElement: () => createCanvas(),
      getElementById: () => ({
        offsetHeight: 48,
        classList: { add: vi.fn(), remove: vi.fn() },
      }),
    };

    const renderer = new RinkRenderer(createCanvas());
    const sim = new MatchSimulation(cloneConfig(), 4242, 'home_wins');
    sim.phase = 'PLAYING';

    // Baseline without active song: no stadium wall shadow glow in song color
    strokes.length = 0;
    renderer.render(sim, 0.05);
    const chargeColor = SONGS.charge.color;
    const baselineGlowStrokes = strokes.filter(
      (s) => s.shadowColor === chargeColor && s.shadowBlur > 0
    );
    expect(baselineGlowStrokes.length).toBe(0);

    // Activate Charge! song: stadium walls emit pulsing neon glow & traveling surges
    sim.playSong('charge');
    strokes.length = 0;
    renderer.render(sim, 0.12);

    const activeGlowStrokes = strokes.filter(
      (s) =>
        s.strokeStyle === chargeColor &&
        s.shadowColor === chargeColor &&
        s.shadowBlur >= 10
    );
    expect(activeGlowStrokes.length).toBeGreaterThanOrEqual(2);

    // Verify pulsing changes intensity over time
    const firstBlur = activeGlowStrokes[0].shadowBlur;
    strokes.length = 0;
    renderer.render(sim, 0.18);
    const nextGlowStrokes = strokes.filter(
      (s) =>
        s.strokeStyle === chargeColor &&
        s.shadowColor === chargeColor &&
        s.shadowBlur >= 10
    );
    expect(nextGlowStrokes[0].shadowBlur).not.toBeCloseTo(firstBlur, 3);
  });

  it('animates players skating onto the ice from off-ice when setting up for each period to start', () => {
    const { createCanvas } = createMockCanvasEnvironment();
    (globalThis as unknown as { window: unknown }).window = {
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
    };
    (globalThis as unknown as { document: unknown }).document = {
      createElement: () => createCanvas(),
      getElementById: () => ({
        offsetHeight: 48,
        classList: { add: vi.fn(), remove: vi.fn() },
      }),
    };

    const renderer = new RinkRenderer(createCanvas());
    const sim = new MatchSimulation(cloneConfig(), 4242, 'home_wins');
    expect(sim.phase).toBe('FACEOFF_COUNTDOWN');

    const drawnPositionsByFrame: Array<Map<string, { x: number; y: number }>> = [];
    const origDrawPlayer = (
      renderer as unknown as {
        drawPlayer: (
          ctx: CanvasRenderingContext2D,
          p: PlayerEntity,
          s: MatchSimulation,
          showReactions: boolean
        ) => void;
      }
    ).drawPlayer.bind(renderer);

    vi.spyOn(
      renderer as unknown as {
        drawPlayer: (
          ctx: CanvasRenderingContext2D,
          p: PlayerEntity,
          s: MatchSimulation,
          showReactions: boolean
        ) => void;
      },
      'drawPlayer'
    ).mockImplementation((ctx, p, s, showReactions) => {
      const currentMap = drawnPositionsByFrame[drawnPositionsByFrame.length - 1];
      if (currentMap) {
        currentMap.set(p.id, { x: p.pos.x, y: p.pos.y });
      }
      origDrawPlayer(ctx, p, s, showReactions);
    });

    renderer.beginPeriodSkateOn();
    expect(renderer.isSkateOnEntranceActive()).toBe(true);

    const homeGoalie = sim.players.find(
      (p) => p.team === 'home' && p.role === 'goalie'
    )!;

    // Early frame (0.08s into period setup): skaters are entering from near/beyond bottom boards (y > homeSpot.y)
    drawnPositionsByFrame.push(new Map());
    renderer.render(sim, 0.08);
    const earlyPositions = drawnPositionsByFrame[0];
    const goalieEarly = earlyPositions.get(homeGoalie.id);
    expect(goalieEarly).toBeDefined();
    expect(goalieEarly!.y).toBeGreaterThan(RINK_HEIGHT - 40);
    expect(goalieEarly!.y).toBeGreaterThan(homeGoalie.homeSpot.y + 100);

    // Mid-entrance frame (0.55s total): skaters are gliding smoothly toward their faceoff spots
    drawnPositionsByFrame.push(new Map());
    renderer.render(sim, 0.47);
    const midPositions = drawnPositionsByFrame[1];
    const goalieMid = midPositions.get(homeGoalie.id)!;
    expect(goalieMid.y).toBeLessThan(goalieEarly!.y);
    expect(goalieMid.y).toBeGreaterThan(homeGoalie.homeSpot.y);

    // Completion frame (> 1.15s total): entrance completes and players are settled at exact homeSpots
    drawnPositionsByFrame.push(new Map());
    renderer.render(sim, 0.7);
    expect(renderer.isSkateOnEntranceActive()).toBe(false);
    const finalPositions = drawnPositionsByFrame[2];
    for (const p of sim.players) {
      expect(finalPositions.get(p.id)).toEqual(p.homeSpot);
    }
  });

  it('smoothly collapses the penalty box as players exit the ice when a period ends', () => {
    const { createCanvas } = createMockCanvasEnvironment();
    (globalThis as unknown as { window: unknown }).window = {
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
    };
    (globalThis as unknown as { document: unknown }).document = {
      createElement: () => createCanvas(),
      getElementById: () => ({
        offsetHeight: 48,
        classList: { add: vi.fn(), remove: vi.fn() },
      }),
    };

    const renderer = new RinkRenderer(createCanvas());
    const sim = new MatchSimulation(cloneConfig(), 4242, 'home_wins');
    sim.phase = 'PLAYING';

    const pHome = sim.players.find((p) => p.team === 'home')!;
    pHome.mode = 'PENALTY_BOX';
    pHome.stateTimer = 20;

    // Render several frames during active play to expand the penalty box to 1.0
    for (let i = 0; i < 15; i++) {
      renderer.render(sim, 0.05);
    }
    expect(renderer.getPenaltyBoxExpand('home')).toBeCloseTo(1.0, 1);

    // Period ends: trigger intermission ice summary
    sim.phase = 'PERIOD_END';
    sim.periodTimeRemainingSec = 0;
    renderer.beginIceSummary(sim);

    // At start of skate-off (0.0s), initial expansion is recorded
    renderer.render(sim, 0.0);
    expect(renderer.getPenaltyBoxExpand('home')).toBeCloseTo(1.0, 1);

    // Halfway through skate-off (~0.475s of 0.95s duration), penalty box is halfway collapsed
    renderer.render(sim, 0.475);
    expect(renderer.getPenaltyBoxExpand('home')).toBeCloseTo(0.5, 1);

    // At skate-off completion (0.95s total), penalty box is fully collapsed to 0
    renderer.render(sim, 0.475);
    expect(renderer.getPenaltyBoxExpand('home')).toBe(0);

    // Stays collapsed for remaining intermission frames
    renderer.render(sim, 0.5);
    expect(renderer.getPenaltyBoxExpand('home')).toBe(0);
  });

  it('deactivates penalty alert styling and suppresses countdown timers during period end', () => {
    const { createCanvas, strokes } = createMockCanvasEnvironment();
    (globalThis as unknown as { window: unknown }).window = {
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
    };
    (globalThis as unknown as { document: unknown }).document = {
      createElement: () => createCanvas(),
      getElementById: () => ({
        offsetHeight: 48,
        classList: { add: vi.fn(), remove: vi.fn() },
      }),
    };

    const renderer = new RinkRenderer(createCanvas());
    const sim = new MatchSimulation(cloneConfig(), 4242, 'home_wins');
    sim.phase = 'PLAYING';

    const pHome = sim.players.find((p) => p.team === 'home')!;
    pHome.mode = 'PENALTY_BOX';
    pHome.stateTimer = 25;

    // Normal play with active penalty: outer border gets alert glow
    renderer.render(sim, 0.3);
    const homeAlertColor = '#38bdf8';
    const activeGlows = strokes.filter(
      (s) => s.strokeStyle === homeAlertColor && s.shadowBlur > 0
    );
    expect(activeGlows.length).toBeGreaterThan(0);

    // Now period ends
    sim.phase = 'PERIOD_END';
    renderer.beginIceSummary(sim);
    strokes.length = 0;

    // Render during intermission skate-off
    renderer.render(sim, 0.2);
    const periodEndGlows = strokes.filter(
      (s) => s.strokeStyle === homeAlertColor && s.shadowBlur > 0
    );
    // Glow is deactivated during period end; border uses primary trim
    expect(periodEndGlows.length).toBe(0);
  });

  it('resets penalty box collapse state on resetIceSummaryImmediate', () => {
    const { createCanvas } = createMockCanvasEnvironment();
    (globalThis as unknown as { window: unknown }).window = {
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
    };
    (globalThis as unknown as { document: unknown }).document = {
      createElement: () => createCanvas(),
      getElementById: () => ({
        offsetHeight: 48,
        classList: { add: vi.fn(), remove: vi.fn() },
      }),
    };

    const renderer = new RinkRenderer(createCanvas());
    const sim = new MatchSimulation(cloneConfig(), 4242, 'home_wins');
    sim.phase = 'PLAYING';
    const pHome = sim.players.find((p) => p.team === 'home')!;
    pHome.mode = 'PENALTY_BOX';
    for (let i = 0; i < 10; i++) renderer.render(sim, 0.05);

    renderer.resetIceSummaryImmediate();
    expect(renderer.getPenaltyBoxExpand('home')).toBe(0);
    expect(renderer.getPenaltyBoxExpand('away')).toBe(0);
  });
});



