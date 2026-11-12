import {
  evaluateOrder,
  getOrderById,
} from '../game/orders';
import { buildStatsSummary, PeriodStatsSummary } from '../game/stats';
import { SONGS } from '../game/songs';
import { MatchSimulation } from '../sim/match';
import { OrderId } from '../sim/types';

import { CampaignManager } from '../campaign/campaignState';
import { MatchScheduleEntry } from '../campaign/schedule';
import {
  getNextStandUpgrade,
  purchaseSong,
  purchaseStandUpgrade,
  SONG_SHOP_CATALOG,
} from '../campaign/shop';
import { TipOffer } from '../campaign/tips';

export interface ScreenCallbacks {
  onTakeSeat: () => void;
  onStartMatchWithOrder: (orderId: OrderId) => void;
  onContinueNextPeriod: () => void;
  onPlayAgainSameSeed?: () => void;
  onPlayAgainNewSeed: () => void;
  onChangeOrder?: () => void;
  onResumeFromPause: () => void;
}

export class ScreenModalManager {
  private backdropEl = document.getElementById('modal-backdrop')!;
  private contentEl = document.getElementById('modal-content')!;
  private callbacks: ScreenCallbacks;

  constructor(callbacks: ScreenCallbacks) {
    this.callbacks = callbacks;
  }

  public hide(): void {
    this.backdropEl.classList.add('hidden');
    this.contentEl.classList.remove('tip-note-host');
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
    this.contentEl.classList.add('tip-note-host');
    this.backdropEl.classList.remove('hidden');
    const conflictHtml = tip.conflictsWithOfficial
      ? `<div class="tip-conflict-warning">
          ⚠️ <strong>MORAL HAZARD:</strong> This demand conflicts with management's Official Order!
         </div>`
      : '';

    this.contentEl.innerHTML = `
      <div class="tip-note-card">
        <div class="tip-note-eyebrow">
          <span>📎 CONFIDENTIAL PROPOSITION</span>
          <span>SLIPPED UNDER BOOTH DOOR</span>
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
          🎯 DEMAND: <span class="tip-note-demand-text">${tip.conditionDescription}</span>
        </div>

        ${conflictHtml}

        <div class="tip-note-actions">
          <button id="btn-accept-tip" class="tip-btn-accept" type="button">
            🤝 ACCEPT BRIBE (+$${tip.bribePayout})
          </button>
          <button id="btn-decline-tip" class="tip-btn-decline" type="button">
            🗑️ DECLINE
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
    this.contentEl.classList.remove('tip-note-host');
    this.backdropEl.classList.remove('hidden');
    this.contentEl.innerHTML = `
      <div class="modal-inner start-seat-modal">
        <h2 class="modal-title">ORGAN MVP: AN ICE HOCKEY JOURNEY</h2>
        <p class="modal-lead">
          You sit high in the Organist's Perch overlooking a chaotic 3v3 hockey match.
          You don't control the skaters directly—instead, watch <strong>who has possession</strong>
          and play the right stadium organ song at the right moment to shift player moods,
          ignite brawls, and fulfill management's Official Orders.
        </p>
        <h3 class="seat-repertoire-heading">Your organ repertoire</h3>
        <div class="seat-tips-grid">
          <div class="seat-tip">
            <strong>Charge! Fanfare</strong>
            <span>Boosts Focus &amp; Aggression for the <em>possessing</em> (or last-touch) team.</span>
          </div>
          <div class="seat-tip">
            <strong>Hold the Line</strong>
            <span>Boosts Goalie &amp; Defense for the <em>defending</em> team.</span>
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
    _seed?: number,
    campaignMatch?: MatchScheduleEntry | null,
    officialRepPct?: number
  ): void {
    this.contentEl.classList.remove('tip-note-host');
    this.backdropEl.classList.remove('hidden');

    const currentOrder = getOrderById(assignedOrderId);

    const campaignHeaderHtml = campaignMatch
      ? `
        <div class="campaign-match-banner" style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 8px; padding: 10px 14px; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; font-weight: 700; color: #38bdf8; letter-spacing: 0.08em; text-transform: uppercase;">
            <span>MATCH ${campaignMatch.matchNumber} OF 17 • ${campaignMatch.tierLabel}</span>
            <span style="color: ${officialRepPct !== undefined && officialRepPct < 75 ? '#fb7185' : '#4ade80'}">JOB SECURITY: ${officialRepPct ?? 100}%</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px;">
            <div style="font-size: 16px; font-weight: 800; color: #f8fafc;">
              <span style="color: #38bdf8">${campaignMatch.homeTeam.shortName}</span>
              <span style="color: #64748b; font-size: 13px; margin: 0 4px;">vs</span>
              <span style="color: ${campaignMatch.awayTeam.primaryColor}">${campaignMatch.awayTeam.name}</span>
            </div>
            <div style="font-size: 13px; font-weight: 800; color: #facc15;">
              SALARY: $${Math.round(campaignMatch.baseSalary * campaignMatch.payoutMultiplier)}
            </div>
          </div>
          ${
            campaignMatch.hasOpposingOrganist && campaignMatch.opposingOrganist
              ? `<div style="margin-top: 6px; font-size: 11px; color: #fb7185; background: rgba(244,63,94,0.12); padding: 4px 8px; border-radius: 4px; border-left: 3px solid #f43f5e;">
                  ⚠️ OPPOSING ORGANIST: <strong>${campaignMatch.opposingOrganist.name}</strong> (${campaignMatch.opposingOrganist.title}) in the visitor box!
                 </div>`
              : ''
          }
        </div>
      `
      : '';

    this.contentEl.innerHTML = `
      <div class="modal-inner clipboard-modal">
        <h2 class="modal-title">Commissioner's Official Orders</h2>
        ${campaignHeaderHtml}
        <div class="active-order-spotlight">
          <div class="spotlight-label">MANAGEMENT DIRECTIVE:</div>
          <div class="spotlight-title">${currentOrder.title}</div>
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
        <line x1="0" y1="${h * 0.35}" x2="${w}" y2="${h * 0.35}" stroke="rgba(148,163,184,0.25)" stroke-dasharray="3,3" />
        <polyline fill="none" stroke="#38bdf8" stroke-width="2.5" points="${pts}" />
      </svg>
    `;
  }

  /**
   * 3. Between-Period Breakdown Modal.
   */
  public showPeriodBreakdown(sim: MatchSimulation): void {
    this.contentEl.classList.remove('tip-note-host');
    this.backdropEl.classList.remove('hidden');
    const pStats = buildStatsSummary(sim.events, sim.crowdSamples, sim.period);
    const orderDef = getOrderById(sim.orderId);
    const orderEval = evaluateOrder(sim.orderId, {
      homeGoals: sim.homeScore,
      awayGoals: sim.awayScore,
      totalFights: sim.getTotalFights(),
      averageCrowdVolume: sim.getAverageCrowdVolume(),
      isMatchOver: false,
    });

    const statusBadgeClass =
      orderEval.liveStatus === 'ON_TRACK'
        ? 'status-track'
        : orderEval.liveStatus === 'AT_RISK'
        ? 'status-risk'
        : 'status-fail';

    this.contentEl.innerHTML = `
      <div class="modal-inner breakdown-modal">
        <div class="modal-eyebrow">END OF PERIOD ${sim.period} • STAMINA RESTORED</div>
        <h2 class="modal-title">PERIOD ${sim.period} BREAKDOWN</h2>

        <div class="breakdown-score-banner">
          <div class="b-team home">HOME <span>${sim.homeScore}</span></div>
          <div class="b-vs">VS</div>
          <div class="b-team away"><span>${sim.awayScore}</span> AWAY</div>
        </div>

        <div class="breakdown-columns">
          <div class="breakdown-col">
            <h3>Ice Telemetry (Period ${sim.period})</h3>
            <ul class="stat-kv-list">
              <li><span>Goals (Home / Away)</span><strong>${pStats.homeGoals} – ${pStats.awayGoals}</strong></li>
              <li><span>Shots on Goal</span><strong>${pStats.homeShots} – ${pStats.awayShots}</strong></li>
              <li><span>Goalie Saves</span><strong>${pStats.homeSaves} – ${pStats.awaySaves}</strong></li>
              <li><span>Brawls / Penalty Mins</span><strong>${pStats.fights} / ${pStats.penaltyMinutes} PIM</strong></li>
            </ul>
          </div>

          <div class="breakdown-col">
            <h3>Organist Performance</h3>
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

        <div class="impact-callout-box">
          <h3>🎹 Your Organ's Impact This Period</h3>
          <ul>
            ${pStats.impactLines.map((line) => `<li>${line}</li>`).join('')}
          </ul>
        </div>

        <div class="order-check-row">
          <div>
            <strong>Directive: ${orderDef.title}</strong>
            <div class="order-reason-sub">${orderEval.reason}</div>
          </div>
          <span class="order-status-pill ${statusBadgeClass}">${orderEval.liveStatus.replace('_', ' ')}</span>
        </div>

        <div class="modal-actions">
          <button id="btn-next-period" class="primary-cta-btn" type="button">
            ▶ START PERIOD ${sim.period + 1}
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
    this.contentEl.classList.remove('tip-note-host');
    this.backdropEl.classList.remove('hidden');
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

    const acceptedTips = activeTips.filter(
      (t) => t.status === 'ACCEPTED' || t.status === 'PASSED' || t.status === 'FAILED'
    );

    const bribesHtml =
      acceptedTips.length > 0
        ? `
        <div class="bribes-final-box" style="margin-top: 12px; background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(148, 163, 184, 0.2); border-left: 3px solid #facc15; border-radius: 6px; padding: 10px 14px; text-align: left;">
          <div style="font-size: 11px; font-weight: 800; color: #facc15; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em;">
            Under-The-Table Bribes (${acceptedTips.length} Taken)
          </div>
          ${acceptedTips
            .map((tip) => {
              const passed = tip.status === 'PASSED';
              const pillClass = passed ? 'status-track' : 'status-fail';
              const payoutText = passed ? `+$${tip.bribePayout}` : 'FAILED ($0)';
              return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.06);">
                  <div>
                    <strong style="color: #f8fafc; font-size: 12px;">${tip.senderName} (${tip.senderTitle})</strong>
                    <div style="font-size: 11px; color: #cbd5e1;">${tip.conditionDescription}</div>
                  </div>
                  <div style="text-align: right;">
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
        <div class="modal-eyebrow">FINAL BUZZER</div>

        <!-- SECTION 1: Score -->
        <div class="breakdown-score-banner">
          <div class="b-team home">HOME <span>${sim.homeScore}</span></div>
          <div class="b-vs">${sim.homeScore === sim.awayScore ? 'TIE' : 'FINAL'}</div>
          <div class="b-team away"><span>${sim.awayScore}</span> AWAY</div>
        </div>

        <!-- SECTION 2: Period / Final Stats Box -->
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

        <div class="impact-callout-box">
          <h3>🎹 Full-Match Organ Impact</h3>
          <ul>
            ${totalStats.impactLines.map((line) => `<li>${line}</li>`).join('')}
            <li>Cue Hits: <strong>${totalStats.cueHits}</strong> • Stale Repeats: <strong>${totalStats.stalePlays}</strong></li>
          </ul>
        </div>

        <!-- SECTION 3: Official Orders -->
        <div class="order-final-banner ${orderEval.passed ? 'banner-pass' : 'banner-fail'}">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <strong>Directive: ${orderDef.title}</strong>
            <span class="order-status-pill ${orderEval.passed ? 'status-track' : 'status-fail'}">
              ${orderEval.passed ? 'COMPLETED' : 'FAILED'}
            </span>
          </div>
          <div style="font-size: 12px; color: #cbd5e1;">${orderEval.reason}</div>
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
    this.contentEl.classList.remove('tip-note-host');
    this.backdropEl.classList.remove('hidden');
    const orderDef = getOrderById(sim.orderId);
    const orderEval = evaluateOrder(sim.orderId, {
      homeGoals: sim.homeScore,
      awayGoals: sim.awayScore,
      totalFights: sim.getTotalFights(),
      averageCrowdVolume: sim.getAverageCrowdVolume(),
      isMatchOver: sim.phase === 'MATCH_OVER',
    });
    const orderStatusPill =
      orderEval.liveStatus === 'ON_TRACK'
        ? '<span class="order-status-pill status-track">ON TRACK</span>'
        : '<span class="order-status-pill status-fail">FAILED</span>';

    const acceptedTips = activeTips.filter(
      (t) => t.status === 'ACCEPTED' || t.status === 'PASSED' || t.status === 'FAILED'
    );
    const tipsHtml =
      acceptedTips.length === 0
        ? '<div style="font-size: 12px; color: #94a3b8; font-style: italic; padding: 6px 0;">No under-the-table tips accepted this match.</div>'
        : acceptedTips
            .map((tip) => {
              const pillClass =
                tip.status === 'PASSED'
                  ? 'status-track'
                  : tip.status === 'FAILED'
                  ? 'status-fail'
                  : 'status-track';
              return `
                <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(148, 163, 184, 0.2); border-left: 3px solid #facc15; border-radius: 6px; padding: 8px 12px; margin-bottom: 8px;">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                    <strong style="color: #f8fafc; font-size: 13px;">${tip.senderName} (${tip.senderTitle})</strong>
                    <span style="font-size: 11px; font-weight: 800; color: #facc15;">+$${tip.bribePayout}</span>
                  </div>
                  <div style="font-size: 12px; color: #cbd5e1; margin-bottom: 4px;">${tip.conditionDescription}</div>
                  <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
                    <span style="color: #94a3b8;">${tip.liveProgressText || 'In progress...'}</span>
                    <span class="order-status-pill ${pillClass}">${tip.status}</span>
                  </div>
                </div>
              `;
            })
            .join('');

    this.contentEl.innerHTML = `
      <div class="modal-inner pause-modal" style="max-width: 580px; text-align: left;">
        <div class="modal-eyebrow">MATCH PAUSED • SEED #${sim.rng.initialSeed} • PERIOD ${sim.period}</div>
        <h2 class="modal-title" style="margin-bottom: 12px;">ORGANIST PERCH PAUSED</h2>

        <!-- Official Directive Section -->
        <div style="background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 8px; padding: 12px; margin-bottom: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <div style="font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase;">Official Arena Directive</div>
            ${orderStatusPill}
          </div>
          <div style="font-size: 14px; font-weight: 900; color: #f8fafc;">${orderDef.title}</div>
          <div style="font-size: 12px; color: #cbd5e1; margin: 3px 0 6px 0;">${orderDef.description}</div>
          <div style="font-size: 11px; color: #38bdf8; font-weight: 700;">Progress: ${orderEval.reason}</div>
        </div>

        <!-- Under-the-Table Propositions Section -->
        <div style="margin-bottom: 16px;">
          <div style="font-size: 11px; font-weight: 800; color: #facc15; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.05em;">
            Under-The-Table Bribes &amp; Tips (${acceptedTips.length} Active)
          </div>
          ${tipsHtml}
        </div>

        <div class="modal-actions multi-actions">
          <button id="btn-resume-match" class="primary-cta-btn" type="button">
            ▶ Resume Match
          </button>
          <button id="btn-pause-change-order" class="secondary-cta-btn" type="button">
            📋 Restart / Change Order
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
    this.contentEl.classList.remove('tip-note-host');
    this.backdropEl.classList.remove('hidden');

    const render = () => {
      const state = mgr.getState();
      const currentSlots = state.maxSongSlots;
      const nextUpgrade = getNextStandUpgrade(currentSlots);
      const nextMatch = mgr.getCurrentMatch();
      const officialRep = mgr.getOfficialReputationPct();

      const nextUpgradeHtml = nextUpgrade
        ? `
          <div style="background: rgba(30, 41, 59, 0.7); border: 1px solid #475569; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-size: 13px; font-weight: 800; color: #f8fafc;">${nextUpgrade.name} (${nextUpgrade.slots} Slots)</div>
              <div style="font-size: 11px; color: #94a3b8;">${nextUpgrade.desc}</div>
            </div>
            <button
              id="btn-buy-stand"
              type="button"
              class="primary-cta-btn"
              style="padding: 6px 14px; font-size: 12px; white-space: nowrap; ${state.bankroll < nextUpgrade.cost ? 'opacity: 0.5; cursor: not-allowed;' : ''}"
              ${state.bankroll < nextUpgrade.cost ? 'disabled' : ''}
            >
              UPGRADE ($${nextUpgrade.cost})
            </button>
          </div>
        `
        : `
          <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; color: #34d399; font-weight: 700; font-size: 12px; text-align: center;">
            ★ GRAND CATHEDRAL CONSOLE: MAXIMUM CAPACITY REACHED (6 SLOTS) ★
          </div>
        `;

      // Song catalog for purchase
      const buyableSongs = SONG_SHOP_CATALOG.filter(
        (s) => !state.unlockedSongs.includes(s.id)
      );

      const songsToBuyHtml =
        buyableSongs.length > 0
          ? buyableSongs
              .map(
                (s) => `
                <div style="background: rgba(30, 41, 59, 0.5); border: 1px solid #334155; border-radius: 6px; padding: 8px 12px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <div style="font-size: 12px; font-weight: 800; color: #f8fafc;">${s.title}</div>
                    <div style="font-size: 11px; color: #94a3b8;">${s.desc}</div>
                  </div>
                  <button
                    class="btn-buy-song secondary-cta-btn"
                    data-song-id="${s.id}"
                    type="button"
                    style="padding: 4px 10px; font-size: 11px; white-space: nowrap; ${state.bankroll < s.cost ? 'opacity: 0.5; cursor: not-allowed;' : ''}"
                    ${state.bankroll < s.cost ? 'disabled' : ''}
                  >
                    BUY ($${s.cost})
                  </button>
                </div>
              `
              )
              .join('')
          : '<div style="font-size: 11px; color: #94a3b8; font-style: italic;">All sheet music acquired!</div>';

      // Loadout checkboxes for unlocked songs
      const repertoireHtml = state.unlockedSongs
        .map((sid) => {
          const isEquipped = state.equippedSongs.includes(sid);
          return `
            <label style="display: flex; align-items: center; gap: 8px; background: rgba(15, 23, 42, 0.6); border: 1px solid ${isEquipped ? '#38bdf8' : '#334155'}; border-radius: 6px; padding: 6px 10px; cursor: pointer;">
              <input type="checkbox" class="equip-checkbox" data-song-id="${sid}" ${isEquipped ? 'checked' : ''} />
              <span style="font-size: 12px; font-weight: 700; color: ${isEquipped ? '#38bdf8' : '#cbd5e1'};">${sid.toUpperCase()}</span>
            </label>
          `;
        })
        .join('');

      // Scouting info for next match
      const scoutHtml = nextMatch
        ? `
          <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 8px; padding: 10px 14px; margin-bottom: 14px;">
            <div style="font-size: 10px; font-weight: 800; color: #38bdf8; letter-spacing: 0.08em; text-transform: uppercase;">
              NEXT MATCH ${nextMatch.matchNumber} OF 17 • ${nextMatch.tierLabel}
            </div>
            <div style="font-size: 15px; font-weight: 800; color: #f8fafc; margin-top: 2px;">
              VS. <span style="color: ${nextMatch.awayTeam.primaryColor}">${nextMatch.awayTeam.name}</span>
            </div>
            <div style="font-size: 11px; color: #cbd5e1; margin-top: 4px; line-height: 1.4;">
              <div><strong>STRENGTH:</strong> ${nextMatch.awayTeam.scoutReport.strength}</div>
              <div><strong>WEAKNESS:</strong> ${nextMatch.awayTeam.scoutReport.weakness}</div>
              <div style="color: #facc15;"><strong>ORGANIST TIP:</strong> ${nextMatch.awayTeam.scoutReport.organistTip}</div>
            </div>
          </div>
        `
        : '<div style="font-size: 13px; color: #4ade80;">Season matches complete!</div>';

      this.contentEl.innerHTML = `
        <div class="modal-card shop-modal" style="max-width: 680px; max-height: 90vh; overflow-y: auto;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 8px; margin-bottom: 12px;">
            <div>
              <div class="modal-eyebrow">POST-MATCH HEADQUARTERS</div>
              <h2 class="modal-title" style="margin: 0; font-size: 18px;">🎹 ORGAN LOFT WORKSHOP</h2>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 18px; font-weight: 900; color: #facc15;">$${state.bankroll}</div>
              <div style="font-size: 10px; font-weight: 700; color: ${officialRep < 75 ? '#fb7185' : '#4ade80'};">
                JOB SECURITY: ${officialRep}% • STREET CRED: LVL ${state.unofficialRepLevel}
              </div>
            </div>
          </div>

          ${scoutHtml}

          <div style="margin-bottom: 14px;">
            <div style="font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; margin-bottom: 6px;">
              Console Music Stand Capacity (${currentSlots} Active Slots)
            </div>
            ${nextUpgradeHtml}
          </div>

          <div style="margin-bottom: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <div style="font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase;">
                Active Console Loadout (${state.equippedSongs.length} / ${state.maxSongSlots} Equipped)
              </div>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
              ${repertoireHtml}
            </div>
          </div>

          <div style="margin-bottom: 14px;">
            <div style="font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; margin-bottom: 6px;">
              Sheet Music Library (Buy New Anthems)
            </div>
            ${songsToBuyHtml}
          </div>

          <div class="modal-actions">
            <button id="btn-proceed-match" class="primary-cta-btn" type="button" style="padding: 10px 20px; font-size: 13px; font-weight: 800;">
              🏒 ${nextMatch ? `PROCEED TO MATCH ${nextMatch.matchNumber}` : 'VIEW SEASON SUMMARY'}
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
          const sid = (btn as HTMLElement).dataset.songId as any;
          if (sid) {
            const res = purchaseSong(mgr, sid);
            if (res.success) render();
          }
        });
      });

      // Bind equip checkboxes
      this.contentEl.querySelectorAll('.equip-checkbox').forEach((cb) => {
        cb.addEventListener('change', () => {
          const sid = (cb as HTMLElement).dataset.songId as any;
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
      .map((sid) => {
        const sDef = SONGS[sid];
        const lvl = mgr.getSongMasteryLevel(sid);
        const badgeColor =
          lvl === 'MASTERED' ? '#facc15' : lvl === 'FAMILIAR' ? '#38bdf8' : '#94a3b8';
        return `
          <div style="background: rgba(15,23,42,0.6); padding: 8px 12px; border-radius: 6px; border-left: 3px solid ${sDef.color}; display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <div>
              <strong style="color: #f8fafc; font-size: 13px;">${sDef.title}</strong>
              <div style="font-size: 11px; color: #94a3b8;">${sDef.shortDesc}</div>
            </div>
            <span style="font-size: 11px; font-weight: 800; color: ${badgeColor}; padding: 2px 6px; border: 1px solid ${badgeColor}; border-radius: 4px;">
              ${lvl === 'MASTERED' ? '★ MASTERED' : lvl}
            </span>
          </div>
        `;
      })
      .join('');

    this.contentEl.innerHTML = `
      <div class="modal-inner" style="max-width: 680px; max-height: 90vh; overflow-y: auto; padding: 24px; text-align: left;">
        <div style="text-align: center; margin-bottom: 18px;">
          <div style="font-size: 40px; line-height: 1; margin-bottom: 8px;">
            ${isSuccess ? '🏆' : '❌'}
          </div>
          <div style="font-size: 11px; font-weight: 800; color: #94a3b8; letter-spacing: 0.1em; text-transform: uppercase;">
            ${isSuccess ? '1988 MUNICIPAL ARENA • CAMPAIGN FINALE' : 'SEASON DISQUALIFICATION'}
          </div>
          <h2 style="font-size: 24px; font-weight: 900; color: ${isSuccess ? '#facc15' : '#f87171'}; margin: 4px 0 8px 0; text-transform: uppercase;">
            ${isSuccess ? 'Hall of Fame Organist' : 'Relegated & Dismissed'}
          </h2>
          <p style="font-size: 13px; color: #cbd5e1; max-width: 520px; margin: 0 auto; line-height: 1.4;">
            ${
              isSuccess
                ? 'From a humble cramped loft in Preseason to the thunderous climax of the Memorial Cup Final, your organ gave the Harmonizers their soul!'
                : (state.disqualificationReason || 'Official reputation fell below qualification standards.')
            }
          </p>
        </div>

        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 18px;">
          <div style="background: rgba(30,41,59,0.7); border: 1px solid rgba(148,163,184,0.15); border-radius: 8px; padding: 12px;">
            <div style="font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; margin-bottom: 4px;">Career Matches</div>
            <div style="font-size: 18px; font-weight: 900; color: #f8fafc;">
              ${history.length} <span style="font-size: 13px; color: #94a3b8;">/ 17 (${wins}W - ${losses}L - ${ties}T)</span>
            </div>
          </div>

          <div style="background: rgba(30,41,59,0.7); border: 1px solid rgba(148,163,184,0.15); border-radius: 8px; padding: 12px;">
            <div style="font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; margin-bottom: 4px;">Official Directives</div>
            <div style="font-size: 18px; font-weight: 900; color: ${mgr.getOfficialReputationPct() >= 75 ? '#34d399' : '#f87171'};">
              ${mgr.getOfficialReputationPct()}% <span style="font-size: 13px; color: #94a3b8;">(${state.officialOrdersCompleted}/${state.officialOrdersTotal} Passed)</span>
            </div>
          </div>

          <div style="background: rgba(30,41,59,0.7); border: 1px solid rgba(148,163,184,0.15); border-radius: 8px; padding: 12px;">
            <div style="font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; margin-bottom: 4px;">Street Cred & Tips</div>
            <div style="font-size: 18px; font-weight: 900; color: #38bdf8;">
              Lvl ${state.unofficialRepLevel}/5 <span style="font-size: 13px; color: #94a3b8;">(${state.totalTipsCompleted} tips, +$${state.totalTipEarnings.toLocaleString()})</span>
            </div>
          </div>

          <div style="background: rgba(30,41,59,0.7); border: 1px solid rgba(148,163,184,0.15); border-radius: 8px; padding: 12px;">
            <div style="font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; margin-bottom: 4px;">Career Bankroll & Stand</div>
            <div style="font-size: 18px; font-weight: 900; color: #facc15;">
              $${state.bankroll.toLocaleString()} <span style="font-size: 13px; color: #94a3b8;">(${state.maxSongSlots}/6 slots)</span>
            </div>
          </div>
        </div>

        <div style="margin-bottom: 20px;">
          <div style="font-size: 12px; font-weight: 800; color: #94a3b8; text-transform: uppercase; margin-bottom: 8px; display: flex; justify-content: space-between;">
            <span>Song Repertoire (${state.unlockedSongs.length} Unlocked)</span>
            <span style="color: #facc15;">${masteredCount} Mastered</span>
          </div>
          <div style="max-height: 180px; overflow-y: auto;">
            ${songsHtml}
          </div>
        </div>

        <div style="text-align: center;">
          <button id="btn-restart-season" class="primary-cta-btn" type="button" style="padding: 12px 28px; font-size: 14px; font-weight: 900;">
            🎹 START NEW CAMPAIGN SEASON
          </button>
        </div>
      </div>
    `;

    document.getElementById('btn-restart-season')?.addEventListener('click', () => {
      this.hide();
      onRestartSeason();
    });

    this.contentEl.classList.remove('tip-note-host');
    this.backdropEl.classList.remove('hidden');
  }
}

