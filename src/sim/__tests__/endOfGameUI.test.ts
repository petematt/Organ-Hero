import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneConfig } from '../../config';
import { MatchSimulation } from '../match';
import { ScreenModalManager } from '../../ui/screens';
import { TipOffer } from '../../campaign/tips';

class MockElement {
  public innerHTML: string = '';
  public classList = {
    add: vi.fn(),
    remove: vi.fn(),
    contains: vi.fn().mockReturnValue(false),
  };
  public addEventListener = vi.fn();
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
});


