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
});
