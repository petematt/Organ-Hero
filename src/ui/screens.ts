import {
  evaluateOrder,
  getOrderDisplay,
  OrderLiveStatus,
  resolveOrderTargetTeam,
} from '../game/orders';
import { buildStatsSummary, PeriodStatsSummary } from '../game/stats';
import { SONGS } from '../game/songs';
import { MatchSimulation } from '../sim/match';
import { OrderId, SongId } from '../sim/types';

import { CampaignManager } from '../campaign/campaignState';
import { MatchScheduleEntry } from '../campaign/schedule';
import {
  getNextStandUpgrade,
  purchaseSong,
  purchaseStandUpgrade,
  SONG_SHOP_CATALOG,
} from '../campaign/shop';
import { TipOffer } from '../campaign/tips';
import {
  getSongEffectLine,
  getSongTitleCase,
  renderSongStaffSvg,
} from './sheetMusicSvg';

export interface ScreenCallbacks {
  onTakeSeat: () => void;
  onStartMatchWithOrder: (orderId: OrderId) => void;
  onContinueNextPeriod: () => void;
  onPlayAgainSameSeed?: () => void;
  onPlayAgainNewSeed: () => void;
  onChangeOrder?: () => void;
  onResumeFromPause: () => void;
}

function pluralWord(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

function formatLiveStatus(status: OrderLiveStatus): string {
  switch (status) {
    case 'ON_TRACK':
      return 'On Track';
    case 'AT_RISK':
      return 'At Risk';
    case 'PASSED':
      return 'Passed';
    case 'FAILED':
      return 'Failed';
  }
}

function formatTipStatus(status: TipOffer['status']): string {
  switch (status) {
    case 'ACCEPTED':
      return 'Accepted';
    case 'PASSED':
      return 'Passed';
    case 'FAILED':
      return 'Failed';
    case 'DECLINED':
      return 'Declined';
    default:
      return 'Offered';
  }
}

function formatMasteryLabel(lvl: 'UNKNOWN' | 'FAMILIAR' | 'MASTERED'): string {
  if (lvl === 'MASTERED') return '★ Mastered';
  if (lvl === 'FAMILIAR') return 'Familiar';
  return 'New';
}

export class ScreenModalManager {
  private backdropEl = document.getElementById('modal-backdrop')!;
  private contentEl = document.getElementById('modal-content')!;
  private callbacks: ScreenCallbacks;

  constructor(callbacks: ScreenCallbacks) {
    this.callbacks = callbacks;
  }

  private resetHostClasses(): void {
    this.contentEl.classList.remove('tip-note-host');
    this.contentEl.classList.remove('wide-board-host');
  }

  public hide(): void {
    this.backdropEl.classList.add('hidden');
    this.resetHostClasses();
    this.contentEl.innerHTML = '';
  }

  public isOpen(): boolean {
    return !this.backdropEl.classList.contains('hidden');
  }

  /**
   * Handwritten confidential note slipped under the organ booth door during intermission.
   */
  public showIntermissionTipNote(
    tip: TipOffer,
    onAccept: () => void,
    onDecline: () => void
  ): void {
    this.resetHostClasses();
    this.contentEl.classList.add('tip-note-host');
    this.backdropEl.classList.remove('hidden');
    const conflictHtml = tip.conflictsWithOfficial
      ? `<div class="tip-conflict-warning">
          ⚠️ <strong>Moral hazard:</strong> This demand conflicts with management's Official Order!
         </div>`
      : '';

    this.contentEl.innerHTML = `
      <div class="tip-note-card">
        <div class="tip-note-eyebrow">
          <span>📎 Confidential proposition</span>
          <span>Slipped under booth door</span>
        </div>

        <div class="tip-note-header">
          <div>
            <div class="tip-note-sender">${tip.senderName}</div>
            <div class="tip-note-role">${tip.senderTitle}</div>
          </div>
          <div class="tip-note-payout">
            +$${tip.bribePayout}
          </div>
        </div>

        <div class="tip-note-quote">
          "${tip.flavorText}"
        </div>

        <div class="tip-note-demand">
          🎯 Demand: <span class="tip-note-demand-text">${tip.conditionDescription}</span>
        </div>

        ${conflictHtml}

        <div class="tip-note-actions">
          <button id="btn-accept-tip" class="tip-btn-accept" type="button">
            🤝 Accept Bribe (+$${tip.bribePayout})
          </button>
          <button id="btn-decline-tip" class="tip-btn-decline" type="button">
            🗑️ Decline
          </button>
        </div>
      </div>
    `;

    document.getElementById('btn-accept-tip')?.addEventListener('click', () => {
      this.hide();
      onAccept();
    });

    document.getElementById('btn-decline-tip')?.addEventListener('click', () => {
      this.hide();
      onDecline();
    });
  }

  /**
   * 1. Initial intro screen to unlock Web Audio on iOS/Android.
   */
  public showStartSeatScreen(): void {
    this.resetHostClasses();
    this.backdropEl.classList.remove('hidden');
    this.contentEl.innerHTML = `
      <div class="modal-inner start-seat-modal">
        <div class="cork-pinned-sheet welcome-sheet tilt-neg-sm">
          <div class="modal-eyebrow">1988 Municipal Arena · Organist Booth</div>
          <h2 class="modal-title">Organ Hero: An Ice Hockey Journey</h2>
          <p class="modal-lead">
            You sit high in the Organist's Perch overlooking a chaotic 3v3 hockey match.
            You don't control the skaters directly—instead, watch <strong>who has possession</strong>
            and play the right stadium organ song at the right moment to shift player moods,
            ignite brawls, and fulfill management's Official Orders.
          </p>
        </div>
        <h3 class="seat-repertoire-heading">Your organ repertoire</h3>
        <div class="seat-tips-grid">
          <div class="seat-tip sheet-music-strip tip-pin-gold tilt-pos-sm" style="--strip-accent: #d97706;">
            <div class="sheet-strip-copy">
              <strong>Charge! Fanfare</strong>
              <span class="sheet-strip-sep" aria-hidden="true">—</span>
              <span class="sheet-strip-effect">Boosts Focus &amp; Aggression for the <em>possessing</em> (or last-touch) team.</span>
            </div>
            <div class="sheet-strip-staff">
              ${renderSongStaffSvg('charge')}
            </div>
          </div>
          <div class="seat-tip sheet-music-strip tip-pin-blue tilt-neg-xs" style="--strip-accent: #0d9488;">
            <div class="sheet-strip-copy">
              <strong>Hold the Line</strong>
              <span class="sheet-strip-sep" aria-hidden="true">—</span>
              <span class="sheet-strip-effect">Boosts Goalie &amp; Defense for the <em>defending</em> team.</span>
            </div>
            <div class="sheet-strip-staff">
              ${renderSongStaffSvg('hold_the_line')}
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button id="btn-take-seat" class="primary-cta-btn" type="button">
            Continue
          </button>
        </div>
      </div>
    `;

    document.getElementById('btn-take-seat')?.addEventListener('click', () => {
      this.callbacks.onTakeSeat();
    });
  }

  /**
   * 2. Pre-Match Official Orders Clipboard with Campaign Match Context.
   */
  public showOrderClipboard(
    assignedOrderId: OrderId,
    seed?: number,
    campaignMatch?: MatchScheduleEntry | null,
    officialRepPct?: number
  ): void {
    this.resetHostClasses();
    this.backdropEl.classList.remove('hidden');

    const targetTeam = resolveOrderTargetTeam(assignedOrderId, seed ?? 0);
    const currentOrder = getOrderDisplay(assignedOrderId, targetTeam);
    const teamBadge = currentOrder.usesRandomTeam
      ? `<span class="assigned-pill ${targetTeam === 'away' ? 'pill-away' : 'pill-home'}">${targetTeam === 'away' ? 'Away Team' : 'Home Team'}</span>`
      : '';

    const repPct = officialRepPct ?? 100;
    const campaignHeaderHtml = campaignMatch
      ? `
        <div class="campaign-match-banner greaseboard-card tilt-neg-xs">
          <div class="greaseboard-meta-row">
            <span class="greaseboard-tag">Match ${campaignMatch.matchNumber} of 17 · ${campaignMatch.tierLabel}</span>
            <span class="order-status-pill ${repPct < 75 ? 'status-fail' : 'status-track'}">Job Security: ${repPct}%</span>
          </div>
          <div class="greaseboard-matchup-row">
            <div class="matchup-teams-line">
              <span class="matchup-home-tag">${campaignMatch.homeTeam.shortName}</span>
              <span class="matchup-vs">vs.</span>
              <span class="matchup-away-tag">
                <span class="team-color-swatch" style="background: ${campaignMatch.awayTeam.primaryColor};"></span>
                ${campaignMatch.awayTeam.name}
              </span>
            </div>
            <div class="cash-stipend-tag">
              Base: $${campaignMatch.baseSalary} · Bonus: +$${campaignMatch.orderBonus}
            </div>
          </div>
          ${
            campaignMatch.hasOpposingOrganist && campaignMatch.opposingOrganist
              ? `<div class="visitor-warning-slip">
                  ⚠️ Opposing organist: <strong>${campaignMatch.opposingOrganist.name}</strong> (${campaignMatch.opposingOrganist.title}) in the visitor box!
                 </div>`
              : ''
          }
        </div>
      `
      : '';

    this.contentEl.innerHTML = `
      <div class="modal-inner clipboard-modal">
        <div class="cork-header-strip tilt-pos-xs">
          <h2 class="modal-title">Commissioner's Official Orders</h2>
        </div>
        ${campaignHeaderHtml}
        <div class="active-order-spotlight tilt-pos-sm">
          <div class="spotlight-label">Management Directive</div>
          <div class="spotlight-title">${currentOrder.title}${teamBadge}</div>
          <div class="spotlight-desc">${currentOrder.description}</div>
        </div>
        <div class="modal-actions">
          <button id="btn-drop-puck" class="primary-cta-btn" type="button">
            Drop the puck
          </button>
        </div>
      </div>
    `;

    document.getElementById('btn-drop-puck')?.addEventListener('click', () => {
      this.hide();
      this.callbacks.onStartMatchWithOrder(assignedOrderId);
    });
  }

  private renderSparklineSvg(values: number[]): string {
    if (values.length === 0) return '';
    const w = 260;
    const h = 44;
    const pts = values
      .map((v, i) => {
        const x =
          values.length === 1 ? w / 2 : (i / (values.length - 1)) * (w - 8) + 4;
        const y = h - 4 - (Math.max(0, Math.min(100, v)) / 100) * (h - 8);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    return `
      <svg class="sparkline-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
        <line x1="0" y1="${h * 0.35}" x2="${w}" y2="${h * 0.35}" stroke="rgba(185, 28, 28, 0.35)" stroke-dasharray="4,3" />
        <polyline fill="none" stroke="#1d4ed8" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" points="${pts}" />
      </svg>
    `;
  }

  /**
   * 3. Between-Period Breakdown Modal.
   */
  public showPeriodBreakdown(sim: MatchSimulation): void {
    this.resetHostClasses();
    this.contentEl.classList.add('wide-board-host');
    this.backdropEl.classList.remove('hidden');
    const pStats = buildStatsSummary(sim.events, sim.crowdSamples, sim.period);
    const orderDef = getOrderDisplay(sim.orderId, sim.orderTargetTeam);
    const orderEval = evaluateOrder(sim.orderId, sim.getOrderEvaluationSnapshot(false));

    const statusBadgeClass =
      orderEval.liveStatus === 'ON_TRACK'
        ? 'status-track'
        : orderEval.liveStatus === 'AT_RISK'
        ? 'status-risk'
        : 'status-fail';

    this.contentEl.innerHTML = `
      <div class="modal-inner breakdown-modal">
        <div class="board-header-cluster">
          <div class="modal-eyebrow">End of Period ${sim.period} · Stamina Restored</div>
          <h2 class="modal-title">Period ${sim.period} Breakdown</h2>
        </div>

        <div class="breakdown-score-banner tilt-neg-xs">
          <div class="b-team home">Home <span>${sim.homeScore}</span></div>
          <div class="b-vs">vs.</div>
          <div class="b-team away"><span>${sim.awayScore}</span> Away</div>
        </div>

        <div class="breakdown-columns">
          <div class="breakdown-col pin-red tilt-neg-sm">
            <h3>Rink Sheet (Period ${sim.period})</h3>
            <ul class="stat-kv-list">
              <li><span>Goals (Home / Away)</span><strong>${pStats.homeGoals} – ${pStats.awayGoals}</strong></li>
              <li><span>Shots on Goal</span><strong>${pStats.homeShots} – ${pStats.awayShots}</strong></li>
              <li><span>Goalie Saves</span><strong>${pStats.homeSaves} – ${pStats.awaySaves}</strong></li>
              <li><span>Brawls / Penalty Mins</span><strong>${pStats.fights} / ${pStats.penaltyMinutes}m</strong></li>
            </ul>
          </div>

          <div class="breakdown-col pin-blue tilt-pos-sm">
            <h3>Organist Scorecard</h3>
            <ul class="stat-kv-list">
              <li><span>Songs Played (C / H / G)</span><strong>${pStats.songsPlayed.charge} / ${pStats.songsPlayed.hold_the_line} / ${pStats.songsPlayed.grudge_toccata}</strong></li>
              <li><span>Situational Cue Hits</span><strong>${pStats.cueHits} ★</strong></li>
              <li><span>Stale Repeats</span><strong>${pStats.stalePlays}</strong></li>
              <li><span>Period Crowd Avg</span><strong>${Math.round(pStats.avgCrowdVolume)}%</strong></li>
            </ul>
            <div class="sparkline-box">
              ${this.renderSparklineSvg(pStats.crowdSparkline)}
            </div>
          </div>
        </div>

        <div class="impact-callout-box tilt-neg-xs">
          <h3>🎹 Your Organ's Impact This Period</h3>
          <ul>
            ${pStats.impactLines.map((line) => `<li>${line}</li>`).join('')}
          </ul>
        </div>

        <div class="order-check-row tilt-pos-xs">
          <div>
            <strong>Directive: ${orderDef.title}</strong>
            <div class="order-reason-sub">${orderEval.reason}</div>
          </div>
          <span class="order-status-pill ${statusBadgeClass}">${formatLiveStatus(orderEval.liveStatus)}</span>
        </div>

        <div class="modal-actions">
          <button id="btn-next-period" class="primary-cta-btn" type="button">
            ▶ Start Period ${sim.period + 1}
          </button>
        </div>
      </div>
    `;

    document.getElementById('btn-next-period')?.addEventListener('click', () => {
      this.hide();
      this.callbacks.onContinueNextPeriod();
    });
  }

  /**
   * 4. Final Game Breakdown Modal (After Period 3).
   */
  public showGameBreakdown(
    sim: MatchSimulation,
    activeTips: TipOffer[] = []
  ): void {
    this.resetHostClasses();
    this.contentEl.classList.add('wide-board-host');
    this.backdropEl.classList.remove('hidden');
    const totalStats = buildStatsSummary(sim.events, sim.crowdSamples);
    const p1 = buildStatsSummary(sim.events, sim.crowdSamples, 1);
    const p2 = buildStatsSummary(sim.events, sim.crowdSamples, 2);
    const p3 = buildStatsSummary(sim.events, sim.crowdSamples, 3);

    const orderDef = getOrderDisplay(sim.orderId, sim.orderTargetTeam);
    const orderEval = evaluateOrder(sim.orderId, sim.getOrderEvaluationSnapshot(true));

    const acceptedTips = activeTips.filter(
      (t) => t.status === 'ACCEPTED' || t.status === 'PASSED' || t.status === 'FAILED'
    );

    const bribesHtml =
      acceptedTips.length > 0
        ? `
        <div class="bribes-final-box tilt-neg-xs">
          <div class="bribes-final-heading">
            Under-the-Table Bribes (${acceptedTips.length} taken)
          </div>
          ${acceptedTips
            .map((tip) => {
              const passed = tip.status === 'PASSED';
              const pillClass = passed ? 'status-track' : 'status-fail';
              const payoutText = passed ? `+$${tip.bribePayout}` : 'Failed ($0)';
              return `
                <div class="bribe-row-item">
                  <div>
                    <strong class="bribe-sender-line">${tip.senderName} (${tip.senderTitle})</strong>
                    <div class="bribe-cond-line">${tip.conditionDescription}</div>
                  </div>
                  <div class="bribe-payout-col">
                    <span class="order-status-pill ${pillClass}">${payoutText}</span>
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>
      `
        : '';

    const periodRow = (label: string, s: PeriodStatsSummary) => `
      <tr>
        <td>${label}</td>
        <td>${s.homeGoals}–${s.awayGoals}</td>
        <td>${s.homeShots}–${s.awayShots}</td>
        <td>${s.homeSaves}–${s.awaySaves}</td>
        <td>${s.fights} (${s.penaltyMinutes}m)</td>
        <td>${Math.round(s.avgCrowdVolume)}%</td>
      </tr>
    `;

    this.contentEl.innerHTML = `
      <div class="modal-inner breakdown-modal game-over-modal">
        <!-- Header (Seed dropped) -->
        <div class="board-header-cluster">
          <div class="modal-eyebrow">End of Regulation</div>
          <h2 class="modal-title">FINAL BUZZER</h2>
        </div>

        <!-- SECTION 1: Score -->
        <div class="breakdown-score-banner tilt-pos-xs">
          <div class="b-team home">Home <span>${sim.homeScore}</span></div>
          <div class="b-vs">${sim.homeScore === sim.awayScore ? 'Tie' : 'Final'}</div>
          <div class="b-team away"><span>${sim.awayScore}</span> Away</div>
        </div>

        <!-- SECTION 2: Period / Final Stats Box -->
        <div class="game-stats-grid">
          <div class="cork-table-sheet tilt-neg-sm">
            <table class="period-summary-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Goals</th>
                  <th>Shots</th>
                  <th>Saves</th>
                  <th>Fights (PIM)</th>
                  <th>Crowd Avg</th>
                </tr>
              </thead>
              <tbody>
                ${periodRow('P1', p1)}
                ${periodRow('P2', p2)}
                ${periodRow('P3', p3)}
                <tr class="total-row">
                  <td><strong>Total</strong></td>
                  <td><strong>${totalStats.homeGoals}–${totalStats.awayGoals}</strong></td>
                  <td><strong>${totalStats.homeShots}–${totalStats.awayShots}</strong></td>
                  <td><strong>${totalStats.homeSaves}–${totalStats.awaySaves}</strong></td>
                  <td><strong>${totalStats.fights} (${totalStats.penaltyMinutes}m)</strong></td>
                  <td><strong>${Math.round(sim.getAverageCrowdVolume())}%</strong></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="impact-callout-box tilt-pos-sm">
            <h3>🎹 Full-Match Organ Impact</h3>
            <ul>
              ${totalStats.impactLines.map((line) => `<li>${line}</li>`).join('')}
              <li>Cue Hits: <strong>${totalStats.cueHits}</strong> · Stale Repeats: <strong>${totalStats.stalePlays}</strong></li>
            </ul>
          </div>
        </div>

        <!-- SECTION 3: Official Orders -->
        <div class="order-final-banner ${orderEval.passed ? 'banner-pass' : 'banner-fail'} tilt-neg-xs">
          <div class="order-final-top">
            <strong>Directive: ${orderDef.title}</strong>
            <span class="order-status-pill ${orderEval.passed ? 'status-track' : 'status-fail'}">
              ${orderEval.passed ? 'Completed' : 'Failed'}
            </span>
          </div>
          <div class="order-final-reason">${orderEval.reason}</div>
        </div>

        <!-- SECTION 4: Bribes (if any taken) -->
        ${bribesHtml}

        <!-- SECTION 5: Final Section - Continue Button -->
        <div class="modal-actions">
          <button id="btn-game-over-continue" class="primary-cta-btn" type="button">
            Continue
          </button>
        </div>
      </div>
    `;

    document.getElementById('btn-game-over-continue')?.addEventListener('click', () => {
      this.hide();
      this.callbacks.onPlayAgainNewSeed();
    });
  }

  /**
   * 5. Pause Overlay showing current Seed and quick actions.
   */
  public showPauseModal(
    sim: MatchSimulation,
    activeTips: TipOffer[] = []
  ): void {
    this.resetHostClasses();
    this.contentEl.classList.add('wide-board-host');
    this.backdropEl.classList.remove('hidden');
    const orderDef = getOrderDisplay(sim.orderId, sim.orderTargetTeam);
    const orderEval = evaluateOrder(sim.orderId, sim.getOrderEvaluationSnapshot(sim.phase === 'MATCH_OVER'));
    const orderStatusPill =
      orderEval.liveStatus === 'ON_TRACK'
        ? '<span class="order-status-pill status-track">On Track</span>'
        : '<span class="order-status-pill status-fail">Failed</span>';

    const acceptedTips = activeTips.filter(
      (t) => t.status === 'ACCEPTED' || t.status === 'PASSED' || t.status === 'FAILED'
    );
    const tipsHtml =
      acceptedTips.length === 0
        ? '<div class="empty-bribes-note">No under-the-table tips accepted this match.</div>'
        : acceptedTips
            .map((tip) => {
              const pillClass =
                tip.status === 'PASSED'
                  ? 'status-track'
                  : tip.status === 'FAILED'
                  ? 'status-fail'
                  : 'status-risk';
              return `
                <div class="sticky-tip-card">
                  <div class="sticky-tip-top">
                    <strong>${tip.senderName} (${tip.senderTitle})</strong>
                    <span class="sticky-tip-cash">+$${tip.bribePayout}</span>
                  </div>
                  <div class="sticky-tip-cond">${tip.conditionDescription}</div>
                  <div class="sticky-tip-foot">
                    <span>${tip.liveProgressText || 'In progress...'}</span>
                    <span class="order-status-pill ${pillClass}">${formatTipStatus(tip.status)}</span>
                  </div>
                </div>
              `;
            })
            .join('');

    this.contentEl.innerHTML = `
      <div class="modal-inner pause-modal">
        <div class="board-header-cluster">
          <div class="modal-eyebrow">Match Paused · Seed #${sim.rng.initialSeed} · Period ${sim.period}</div>
          <h2 class="modal-title">Organist Perch Paused</h2>
        </div>

        <div class="pause-board-grid">
          <!-- Official Directive Section -->
          <div class="cork-pinned-sheet directive-pin-card tilt-neg-sm">
            <div class="pin-card-header">
              <span class="pin-card-kicker">Official Arena Directive</span>
              ${orderStatusPill}
            </div>
            <div class="pin-card-title">${orderDef.title}</div>
            <div class="pin-card-desc">${orderDef.description}</div>
            <div class="pin-card-progress">Progress: ${orderEval.reason}</div>
          </div>

          <!-- Under-the-Table Propositions Section -->
          <div class="cork-pinned-sheet bribes-pin-card tilt-pos-sm">
            <div class="pin-card-header">
              <span class="pin-card-kicker">Under-the-Table Bribes &amp; Tips (${acceptedTips.length} active)</span>
            </div>
            ${tipsHtml}
          </div>
        </div>

        <div class="modal-actions multi-actions">
          <button id="btn-resume-match" class="primary-cta-btn" type="button">
            ▶ Resume Match
          </button>
          <button id="btn-pause-change-order" class="secondary-cta-btn" type="button">
            Restart / Change Order
          </button>
        </div>
      </div>
    `;

    document.getElementById('btn-resume-match')?.addEventListener('click', () => {
      this.hide();
      this.callbacks.onResumeFromPause();
    });
    document
      .getElementById('btn-pause-change-order')
      ?.addEventListener('click', () => {
        this.hide();
        this.callbacks.onChangeOrder?.();
      });
  }

  /**
   * 6. Organ Loft Workshop & Console Upgrade Shop.
   */
  public showOrganLoftShop(
    mgr: CampaignManager,
    onProceedNextMatch: () => void
  ): void {
    this.resetHostClasses();
    this.contentEl.classList.add('wide-board-host');
    this.backdropEl.classList.remove('hidden');

    const render = () => {
      const state = mgr.getState();
      const currentSlots = state.maxSongSlots;
      const nextUpgrade = getNextStandUpgrade(currentSlots);
      const nextMatch = mgr.getCurrentMatch();
      const officialRep = mgr.getOfficialReputationPct();

      const nextUpgradeHtml = nextUpgrade
        ? `
          <div class="shop-upgrade-row">
            <div class="shop-item-copy">
              <div class="shop-item-title">${nextUpgrade.name} (${nextUpgrade.slots} ${pluralWord(nextUpgrade.slots, 'slot')})</div>
              <div class="shop-item-desc">${nextUpgrade.desc}</div>
            </div>
            <button
              id="btn-buy-stand"
              type="button"
              class="primary-cta-btn shop-buy-btn"
              ${state.bankroll < nextUpgrade.cost ? 'disabled' : ''}
            >
              Upgrade ($${nextUpgrade.cost})
            </button>
          </div>
        `
        : `
          <div class="shop-max-banner">
            ★ Grand Cathedral Console: Max capacity reached (6 slots) ★
          </div>
        `;

      // Song catalog for purchase — single-line sheet music strips
      const buyableSongs = SONG_SHOP_CATALOG.filter(
        (s) => !state.unlockedSongs.includes(s.id)
      );

      const songsToBuyHtml =
        buyableSongs.length > 0
          ? buyableSongs
              .map((s, idx) => {
                const sDef = SONGS[s.id];
                const accent = sDef ? sDef.color : '#eab308';
                const tiltClass = idx % 2 === 0 ? 'tilt-pos-xs' : 'tilt-neg-xs';
                return `
                  <div class="shop-catalog-row sheet-music-strip ${tiltClass}" style="--strip-accent: ${accent};">
                    <div class="sheet-strip-copy">
                      <strong class="shop-item-title">${getSongTitleCase(s.id)}</strong>
                      <span class="sheet-strip-sep" aria-hidden="true">—</span>
                      <span class="sheet-strip-effect">${getSongEffectLine(s.id)}</span>
                    </div>
                    <div class="sheet-strip-staff">
                      ${renderSongStaffSvg(s.id)}
                    </div>
                    <button
                      class="btn-buy-song secondary-cta-btn shop-buy-btn"
                      data-song-id="${s.id}"
                      type="button"
                      ${state.bankroll < s.cost ? 'disabled' : ''}
                    >
                      Buy ($${s.cost})
                    </button>
                  </div>
                `;
              })
              .join('')
          : '<div class="empty-catalog-note">All sheet music acquired!</div>';

      // Loadout checkboxes for unlocked songs — single-line sheet music strips
      const repertoireHtml = state.unlockedSongs
        .map((sid, idx) => {
          const isEquipped = state.equippedSongs.includes(sid);
          const sDef = SONGS[sid];
          const accentColor = sDef ? sDef.color : '#eab308';
          const tiltClass = idx % 2 === 0 ? 'tilt-neg-xs' : 'tilt-pos-xs';
          return `
            <label class="setlist-chip sheet-music-strip ${isEquipped ? 'is-equipped' : ''} ${tiltClass}" style="--strip-accent: ${accentColor};">
              <input type="checkbox" class="equip-checkbox" data-song-id="${sid}" ${isEquipped ? 'checked' : ''} />
              <span class="setlist-check-box" aria-hidden="true">${isEquipped ? '✓' : ''}</span>
              <div class="sheet-strip-copy">
                <strong class="setlist-chip-label">${getSongTitleCase(sid)}</strong>
                <span class="sheet-strip-sep" aria-hidden="true">—</span>
                <span class="sheet-strip-effect">${getSongEffectLine(sid)}</span>
              </div>
              <div class="sheet-strip-staff">
                ${renderSongStaffSvg(sid)}
              </div>
            </label>
          `;
        })
        .join('');

      // Scouting info for next match
      const scoutHtml = nextMatch
        ? `
          <div class="cork-pinned-sheet scout-report-card tilt-neg-sm">
            <div class="scout-kicker">
              Next Match ${nextMatch.matchNumber} of 17 · ${nextMatch.tierLabel}
            </div>
            <div class="scout-opponent-title">
              vs.
              <span class="team-color-swatch" style="background: ${nextMatch.awayTeam.primaryColor};"></span>
              <span>${nextMatch.awayTeam.name}</span>
            </div>
            <div class="scout-notes-list">
              <div><strong>Strength:</strong> ${nextMatch.awayTeam.scoutReport.strength}</div>
              <div><strong>Weakness:</strong> ${nextMatch.awayTeam.scoutReport.weakness}</div>
              <div class="scout-highlight-tip"><strong>Organist tip:</strong> ${nextMatch.awayTeam.scoutReport.organistTip}</div>
            </div>
          </div>
        `
        : '<div class="cork-pinned-sheet scout-complete-card">Season matches complete!</div>';

      this.contentEl.innerHTML = `
        <div class="modal-inner shop-modal">
          <div class="shop-header-bar">
            <div>
              <div class="modal-eyebrow">Post-Match Headquarters</div>
              <h2 class="modal-title">Organ Loft Workshop</h2>
            </div>
            <div class="shop-wallet-cluster">
              <div class="cash-bankroll-badge">$${state.bankroll}</div>
              <div class="shop-rep-row">
                <span class="order-status-pill ${officialRep < 75 ? 'status-fail' : 'status-track'}">Job Security: ${officialRep}%</span>
                <span class="street-cred-pill">Street Cred: Lvl ${state.unofficialRepLevel}</span>
              </div>
            </div>
          </div>

          <div class="shop-board-grid">
            <div class="shop-col">
              ${scoutHtml}

              <div class="cork-pinned-sheet shop-section-card tilt-pos-sm">
                <div class="pin-card-kicker">
                  Console Music Stand (${currentSlots} active ${pluralWord(currentSlots, 'slot')})
                </div>
                ${nextUpgradeHtml}
              </div>
            </div>

            <div class="shop-col shop-music-col">
              <div class="unboxed-board-section">
                <div class="board-scrawl-heading">
                  Active Console Loadout <span>(${state.equippedSongs.length}/${state.maxSongSlots} equipped)</span>
                </div>
                <div class="setlist-chips-wrap">
                  ${repertoireHtml}
                </div>
              </div>

              <div class="unboxed-board-section">
                <div class="board-scrawl-heading">
                  Sheet Music Library <span>(Buy new anthems)</span>
                </div>
                <div class="shop-catalog-list">
                  ${songsToBuyHtml}
                </div>
              </div>
            </div>
          </div>

          <div class="modal-actions">
            <button id="btn-proceed-match" class="primary-cta-btn" type="button">
              ${nextMatch ? `Proceed to Match ${nextMatch.matchNumber} →` : 'View Season Summary →'}
            </button>
          </div>
        </div>
      `;

      // Bind stand upgrade
      document.getElementById('btn-buy-stand')?.addEventListener('click', () => {
        const res = purchaseStandUpgrade(mgr);
        if (res.success) render();
      });

      // Bind buy song buttons
      this.contentEl.querySelectorAll('.btn-buy-song').forEach((btn) => {
        btn.addEventListener('click', () => {
          const sid = (btn as HTMLElement).dataset.songId as SongId;
          if (sid) {
            const res = purchaseSong(mgr, sid);
            if (res.success) render();
          }
        });
      });

      // Bind equip checkboxes
      this.contentEl.querySelectorAll('.equip-checkbox').forEach((cb) => {
        cb.addEventListener('change', () => {
          const sid = (cb as HTMLElement).dataset.songId as SongId;
          const isChecked = (cb as HTMLInputElement).checked;
          const cur = [...mgr.getState().equippedSongs];
          if (isChecked && !cur.includes(sid)) {
            if (cur.length < mgr.getState().maxSongSlots) {
              cur.push(sid);
              mgr.setEquippedSongs(cur);
            } else {
              (cb as HTMLInputElement).checked = false;
            }
          } else if (!isChecked && cur.includes(sid)) {
            if (cur.length > 1) {
              // Ensure at least 1 song is equipped
              const filtered = cur.filter((s) => s !== sid);
              mgr.setEquippedSongs(filtered);
            } else {
              (cb as HTMLInputElement).checked = true;
            }
          }
          render();
        });
      });

      // Bind proceed
      document.getElementById('btn-proceed-match')?.addEventListener('click', () => {
        this.hide();
        onProceedNextMatch();
      });
    };

    render();
  }

  public showSeasonEndSummaryModal(
    mgr: CampaignManager,
    onRestartSeason: () => void
  ): void {
    this.resetHostClasses();
    this.contentEl.classList.add('wide-board-host');
    this.backdropEl.classList.remove('hidden');

    const state = mgr.getState();
    const isSuccess = state.isSeasonCompleted && !state.isDisqualified;
    const history = state.matchHistory;

    let wins = 0;
    let losses = 0;
    let ties = 0;
    for (const h of history) {
      if (h.homeScore > h.awayScore) wins++;
      else if (h.homeScore < h.awayScore) losses++;
      else ties++;
    }

    const masteredCount = state.unlockedSongs.filter(
      (s) => mgr.getSongMasteryLevel(s) === 'MASTERED'
    ).length;

    const songsHtml = state.unlockedSongs
      .map((sid, idx) => {
        const sDef = SONGS[sid];
        const lvl = mgr.getSongMasteryLevel(sid);
        const pillClass =
          lvl === 'MASTERED' ? 'status-track' : lvl === 'FAMILIAR' ? 'status-risk' : 'mastery-novice';
        const tiltClass = idx % 2 === 0 ? 'tilt-neg-xs' : 'tilt-pos-xs';
        return `
          <div class="season-song-row sheet-music-strip ${tiltClass}" style="--strip-accent: ${sDef.color};">
            <div class="sheet-strip-copy">
              <strong class="season-song-title">${getSongTitleCase(sid)}</strong>
              <span class="sheet-strip-sep" aria-hidden="true">—</span>
              <span class="sheet-strip-effect">${getSongEffectLine(sid)}</span>
            </div>
            <div class="sheet-strip-staff">
              ${renderSongStaffSvg(sid)}
            </div>
            <span class="order-status-pill ${pillClass}">
              ${formatMasteryLabel(lvl)}
            </span>
          </div>
        `;
      })
      .join('');

    const officialPct = mgr.getOfficialReputationPct();

    this.contentEl.innerHTML = `
      <div class="modal-inner season-summary-modal">
        <div class="cork-pinned-sheet season-hero-sheet ${isSuccess ? 'is-champion' : 'is-dismissed'} tilt-neg-xs">
          <div class="season-trophy-icon" aria-hidden="true">
            ${isSuccess ? '🏆' : '❌'}
          </div>
          <div class="modal-eyebrow">
            ${isSuccess ? '1988 Municipal Arena · Campaign Finale' : 'Season Disqualification'}
          </div>
          <h2 class="modal-title season-headline">
            ${isSuccess ? 'Hall of Fame Organist' : 'Relegated & Dismissed'}
          </h2>
          <p class="season-lead-copy">
            ${
              isSuccess
                ? 'From a humble cramped loft in Preseason to the thunderous climax of the Memorial Cup Final, your organ gave the Harmonizers their soul!'
                : (state.disqualificationReason || 'Official reputation fell below qualification standards.')
            }
          </p>
        </div>

        <div class="season-stats-grid">
          <div class="cork-pinned-sheet season-stat-card pin-red tilt-neg-sm">
            <div class="pin-card-kicker">Career Matches</div>
            <div class="season-stat-big">
              ${history.length} <span class="season-stat-sub">/ 17 (${wins}W - ${losses}L - ${ties}T)</span>
            </div>
          </div>

          <div class="cork-pinned-sheet season-stat-card pin-blue tilt-pos-sm">
            <div class="pin-card-kicker">Official Directives</div>
            <div class="season-stat-big ${officialPct >= 75 ? 'ink-green' : 'ink-red'}">
              ${officialPct}% <span class="season-stat-sub">(${state.officialOrdersCompleted}/${state.officialOrdersTotal} passed)</span>
            </div>
          </div>

          <div class="cork-pinned-sheet season-stat-card pin-gold tilt-neg-xs">
            <div class="pin-card-kicker">Street Cred &amp; Tips</div>
            <div class="season-stat-big ink-blue">
              Lvl ${state.unofficialRepLevel}/5 <span class="season-stat-sub">(${state.totalTipsCompleted} ${pluralWord(state.totalTipsCompleted, 'tip')}, +$${state.totalTipEarnings.toLocaleString()})</span>
            </div>
          </div>

          <div class="cork-pinned-sheet season-stat-card pin-green tilt-pos-sm">
            <div class="pin-card-kicker">Career Bankroll &amp; Stand</div>
            <div class="season-stat-big ink-green">
              $${state.bankroll.toLocaleString()} <span class="season-stat-sub">(${state.maxSongSlots}/6 ${pluralWord(state.maxSongSlots, 'slot')})</span>
            </div>
          </div>
        </div>

        <div class="unboxed-board-section season-repertoire-section">
          <div class="season-rep-header">
            <span class="board-scrawl-heading">Song Repertoire <span>(${state.unlockedSongs.length} unlocked)</span></span>
            <span class="season-mastered-count">${masteredCount} Mastered</span>
          </div>
          <div class="season-songs-scroll">
            ${songsHtml}
          </div>
        </div>

        <div class="modal-actions center-actions">
          <button id="btn-restart-season" class="primary-cta-btn" type="button">
            Start New Campaign Season
          </button>
        </div>
      </div>
    `;

    document.getElementById('btn-restart-season')?.addEventListener('click', () => {
      this.hide();
      onRestartSeason();
    });
  }
}
