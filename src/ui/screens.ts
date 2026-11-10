import {
  evaluateOrder,
  getOrderById,
  OFFICIAL_ORDERS,
} from '../game/orders';
import { buildStatsSummary, PeriodStatsSummary } from '../game/stats';
import { MatchSimulation } from '../sim/match';
import { OrderId } from '../sim/types';

import { MatchScheduleEntry } from '../campaign/schedule';

export interface ScreenCallbacks {
  onTakeSeat: () => void;
  onStartMatchWithOrder: (orderId: OrderId) => void;
  onContinueNextPeriod: () => void;
  onPlayAgainSameSeed: () => void;
  onPlayAgainNewSeed: () => void;
  onChangeOrder: () => void;
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
    this.contentEl.innerHTML = '';
  }

  public isOpen(): boolean {
    return !this.backdropEl.classList.contains('hidden');
  }

  /**
   * 1. Initial "Tap to Take Your Seat" screen to unlock Web Audio on iOS/Android.
   */
  public showStartSeatScreen(): void {
    this.backdropEl.classList.remove('hidden');
    this.contentEl.innerHTML = `
      <div class="modal-inner start-seat-modal">
        <div class="modal-eyebrow">STADIUM PIPE ORGAN CONSOLE</div>
        <h2 class="modal-title">ORGAN MVP: AN ICE HOCKEY JOURNEY</h2>
        <p class="modal-lead">
          You sit high in the Organist's Perch overlooking a chaotic 3v3 hockey match.
          You don't control the skaters directly—instead, watch <strong>who has possession</strong>
          and play the right stadium organ song at the right moment to shift player moods,
          ignite brawls, and fulfill management's Official Orders.
        </p>
        <div class="seat-tips-grid">
          <div class="seat-tip">
            <strong>♪ [1] Charge! Fanfare</strong>
            <span>Boosts Focus &amp; Aggression for the <em>possessing</em> (or last-touch) team.</span>
          </div>
          <div class="seat-tip">
            <strong>♫ [2] Hold the Line</strong>
            <span>Boosts Goalie &amp; Defense for the <em>defending</em> team.</span>
          </div>
          <div class="seat-tip">
            <strong>♬ [3] Grudge Toccata</strong>
            <span>Spikes Aggression &amp; drops Focus on <em>both</em> teams to spark brawls &amp; power plays.</span>
          </div>
        </div>
        <div class="modal-actions">
          <button id="btn-take-seat" class="primary-cta-btn" type="button">
            🎹 TAP TO TAKE YOUR SEAT
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
    seed: number,
    campaignMatch?: MatchScheduleEntry | null,
    officialRepPct?: number
  ): void {
    this.backdropEl.classList.remove('hidden');
    let selectedId: OrderId = assignedOrderId;

    const renderClipboard = () => {
      const currentOrder = getOrderById(selectedId);
      const optionsHtml = OFFICIAL_ORDERS.map(
        (o) => `
          <button
            type="button"
            class="order-option-btn ${o.id === selectedId ? 'selected' : ''}"
            data-order-id="${o.id}"
          >
            <div class="order-opt-top">
              <strong>${o.title}</strong>
              ${
                o.id === assignedOrderId
                  ? '<span class="assigned-pill">ASSIGNED</span>'
                  : ''
              }
            </div>
            <div class="order-opt-desc">${o.description}</div>
          </button>
        `
      ).join('');

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
          <div class="modal-eyebrow">PRE-MATCH MANAGEMENT DIRECTIVE • SEED #${seed}</div>
          <h2 class="modal-title">📋 OFFICIAL ORDERS</h2>
          ${campaignHeaderHtml}
          <div class="active-order-spotlight">
            <div class="spotlight-label">MANAGEMENT DIRECTIVE:</div>
            <div class="spotlight-title">${currentOrder.title}</div>
            <div class="spotlight-desc">${currentOrder.description}</div>
          </div>
          <div class="order-picker-section">
            <div class="picker-heading">Switch Directive (For Testing):</div>
            <div class="order-options-list">
              ${optionsHtml}
            </div>
          </div>
          <div class="modal-actions">
            <button id="btn-drop-puck" class="primary-cta-btn" type="button">
              🏒 DROP THE PUCK (START PERIOD 1)
            </button>
          </div>
        </div>
      `;

      this.contentEl.querySelectorAll('.order-option-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = (btn as HTMLElement).dataset.orderId as OrderId;
          if (id) {
            selectedId = id;
            renderClipboard();
          }
        });
      });

      document.getElementById('btn-drop-puck')?.addEventListener('click', () => {
        this.hide();
        this.callbacks.onStartMatchWithOrder(selectedId);
      });
    };

    renderClipboard();
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
  public showGameBreakdown(sim: MatchSimulation): void {
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
        <div class="modal-eyebrow">FINAL BUZZER • SEED #${sim.rng.initialSeed}</div>
        <h2 class="modal-title">
          ${orderEval.passed ? '✅ OFFICIAL ORDER COMPLETED!' : '❌ OFFICIAL ORDER FAILED'}
        </h2>

        <div class="order-final-banner ${orderEval.passed ? 'banner-pass' : 'banner-fail'}">
          <strong>${orderDef.title}:</strong> ${orderEval.reason}
        </div>

        <div class="breakdown-score-banner">
          <div class="b-team home">HOME <span>${sim.homeScore}</span></div>
          <div class="b-vs">${sim.homeScore === sim.awayScore ? 'TIE' : 'FINAL'}</div>
          <div class="b-team away"><span>${sim.awayScore}</span> AWAY</div>
        </div>

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

        <div class="modal-actions multi-actions">
          <button id="btn-replay-new-seed" class="primary-cta-btn" type="button">
            🔄 Play Again (New Seed)
          </button>
          <button id="btn-replay-same-seed" class="secondary-cta-btn" type="button">
            🔁 Replay Same Seed (#${sim.rng.initialSeed})
          </button>
          <button id="btn-change-order" class="secondary-cta-btn" type="button">
            📋 Change Order
          </button>
        </div>
      </div>
    `;

    document.getElementById('btn-replay-new-seed')?.addEventListener('click', () => {
      this.hide();
      this.callbacks.onPlayAgainNewSeed();
    });
    document.getElementById('btn-replay-same-seed')?.addEventListener('click', () => {
      this.hide();
      this.callbacks.onPlayAgainSameSeed();
    });
    document.getElementById('btn-change-order')?.addEventListener('click', () => {
      this.hide();
      this.callbacks.onChangeOrder();
    });
  }

  /**
   * 5. Pause Overlay showing current Seed and quick actions.
   */
  public showPauseModal(sim: MatchSimulation): void {
    this.backdropEl.classList.remove('hidden');
    const orderDef = getOrderById(sim.orderId);
    this.contentEl.innerHTML = `
      <div class="modal-inner pause-modal">
        <div class="modal-eyebrow">MATCH PAUSED • SEED #${sim.rng.initialSeed}</div>
        <h2 class="modal-title">ORGANIST PERCH PAUSED</h2>
        <p class="modal-lead">
          Active Directive: <strong>${orderDef.title}</strong> — ${orderDef.description}
        </p>
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
        this.callbacks.onChangeOrder();
      });
  }
}
