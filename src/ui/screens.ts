import {
  evaluateOrder,
  getOrderDisplay,
  resolveOrderTargetTeam,
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

function pluralWord(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
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
    this.resetHostClasses();
    this.backdropEl.classList.remove('hidden');
    this.contentEl.innerHTML = `
      <div class="modal-inner start-seat-modal">
        <div class="cork-pinned-sheet welcome-sheet">
          <div class="modal-eyebrow">1988 MUNICIPAL ARENA • ORGANIST BOOTH</div>
          <h2 class="modal-title">ORGAN MVP: AN ICE HOCKEY JOURNEY</h2>
          <p class="modal-lead">
            You sit high in the Organist's Perch overlooking a chaotic 3v3 hockey match.
            You don't control the skaters directly—instead, watch <strong>who has possession</strong>
            and play the right stadium organ song at the right moment to shift player moods,
            ignite brawls, and fulfill management's Official Orders.
          </p>
        </div>
        <h3 class="seat-repertoire-heading">Your organ repertoire</h3>
        <div class="seat-tips-grid">
          <div class="seat-tip tip-pin-gold">
            <strong>Charge! Fanfare</strong>
            <span>Boosts Focus &amp; Aggression for the <em>possessing</em> (or last-touch) team.</span>
          </div>
          <div class="seat-tip tip-pin-blue">
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
    seed?: number,
    campaignMatch?: MatchScheduleEntry | null,
    officialRepPct?: number
  ): void {
    this.resetHostClasses();
    this.backdropEl.classList.remove('hidden');

    const targetTeam = resolveOrderTargetTeam(assignedOrderId, seed ?? 0);
    const currentOrder = getOrderDisplay(assignedOrderId, targetTeam);
    const teamBadge = currentOrder.usesRandomTeam
      ? `<span class="assigned-pill ${targetTeam === 'away' ? 'pill-away' : 'pill-home'}">${targetTeam === 'away' ? 'AWAY TEAM' : 'HOME TEAM'}</span>`
      : '';

    const repPct = officialRepPct ?? 100;
    const campaignHeaderHtml = campaignMatch
      ? `
        <div class="campaign-match-banner greaseboard-card">
          <div class="greaseboard-meta-row">
            <span class="greaseboard-tag">MATCH ${campaignMatch.matchNumber} OF 17 • ${campaignMatch.tierLabel}</span>
            <span class="order-status-pill ${repPct < 75 ? 'status-fail' : 'status-track'}">JOB SECURITY: ${repPct}%</span>
          </div>
          <div class="greaseboard-matchup-row">
            <div class="matchup-teams-line">
              <span class="matchup-home-tag">${campaignMatch.homeTeam.shortName}</span>
              <span class="matchup-vs">VS</span>
              <span class="matchup-away-tag">
                <span class="team-color-swatch" style="background: ${campaignMatch.awayTeam.primaryColor};"></span>
                ${campaignMatch.awayTeam.name}
              </span>
            </div>
            <div class="cash-stipend-tag">
              BASE: $${campaignMatch.baseSalary} • BONUS: +$${campaignMatch.orderBonus}
            </div>
          </div>
          ${
            campaignMatch.hasOpposingOrganist && campaignMatch.opposingOrganist
              ? `<div class="visitor-warning-slip">
                  ⚠️ OPPOSING ORGANIST: <strong>${campaignMatch.opposingOrganist.name}</strong> (${campaignMatch.opposingOrganist.title}) in the visitor box!
                 </div>`
              : ''
          }
        </div>
      `
      : '';

    this.contentEl.innerHTML = `
      <div class="modal-inner clipboard-modal">
        <div class="cork-header-strip">
          <h2 class="modal-title">Commissioner's Official Orders</h2>
        </div>
        ${campaignHeaderHtml}
        <div class="active-order-spotlight">
          <div class="spotlight-label">MANAGEMENT DIRECTIVE:</div>
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
        <div class="modal-eyebrow">END OF PERIOD ${sim.period} • STAMINA RESTORED</div>
        <h2 class="modal-title">PERIOD ${sim.period} BREAKDOWN</h2>

        <div class="breakdown-score-banner">
          <div class="b-team home">HOME <span>${sim.homeScore}</span></div>
          <div class="b-vs">VS</div>
          <div class="b-team away"><span>${sim.awayScore}</span> AWAY</div>
        </div>

        <div class="breakdown-columns">
          <div class="breakdown-col pin-red">
            <h3>Rink Sheet (Period ${sim.period})</h3>
            <ul class="stat-kv-list">
              <li><span>Goals (Home / Away)</span><strong>${pStats.homeGoals} – ${pStats.awayGoals}</strong></li>
              <li><span>Shots on Goal</span><strong>${pStats.homeShots} – ${pStats.awayShots}</strong></li>
              <li><span>Goalie Saves</span><strong>${pStats.homeSaves} – ${pStats.awaySaves}</strong></li>
              <li><span>Brawls / Penalty Mins</span><strong>${pStats.fights} / ${pStats.penaltyMinutes} PIM</strong></li>
            </ul>
          </div>

          <div class="breakdown-col pin-blue">
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
        <div class="bribes-final-box">
          <div class="bribes-final-heading">
            Under-The-Table Bribes (${acceptedTips.length} Taken)
          </div>
          ${acceptedTips
            .map((tip) => {
              const passed = tip.status === 'PASSED';
              const pillClass = passed ? 'status-track' : 'status-fail';
              const payoutText = passed ? `+$${tip.bribePayout}` : 'FAILED ($0)';
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
        <div class="modal-eyebrow">FINAL BUZZER</div>

        <!-- SECTION 1: Score -->
        <div class="breakdown-score-banner">
          <div class="b-team home">HOME <span>${sim.homeScore}</span></div>
          <div class="b-vs">${sim.homeScore === sim.awayScore ? 'TIE' : 'FINAL'}</div>
          <div class="b-team away"><span>${sim.awayScore}</span> AWAY</div>
        </div>

        <!-- SECTION 2: Period / Final Stats Box -->
        <div class="game-stats-grid">
          <div class="cork-table-sheet">
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

          <div class="impact-callout-box">
            <h3>🎹 Full-Match Organ Impact</h3>
            <ul>
              ${totalStats.impactLines.map((line) => `<li>${line}</li>`).join('')}
              <li>Cue Hits: <strong>${totalStats.cueHits}</strong> • Stale Repeats: <strong>${totalStats.stalePlays}</strong></li>
            </ul>
          </div>
        </div>

        <!-- SECTION 3: Official Orders -->
        <div class="order-final-banner ${orderEval.passed ? 'banner-pass' : 'banner-fail'}">
          <div class="order-final-top">
            <strong>Directive: ${orderDef.title}</strong>
            <span class="order-status-pill ${orderEval.passed ? 'status-track' : 'status-fail'}">
              ${orderEval.passed ? 'COMPLETED' : 'FAILED'}
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
        ? '<span class="order-status-pill status-track">ON TRACK</span>'
        : '<span class="order-status-pill status-fail">FAILED</span>';

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
                    <span class="order-status-pill ${pillClass}">${tip.status}</span>
                  </div>
                </div>
              `;
            })
            .join('');

    this.contentEl.innerHTML = `
      <div class="modal-inner pause-modal">
        <div class="modal-eyebrow">MATCH PAUSED • SEED #${sim.rng.initialSeed} • PERIOD ${sim.period}</div>
        <h2 class="modal-title">ORGANIST PERCH PAUSED</h2>

        <div class="pause-board-grid">
          <!-- Official Directive Section -->
          <div class="cork-pinned-sheet directive-pin-card">
            <div class="pin-card-header">
              <span class="pin-card-kicker">Official Arena Directive</span>
              ${orderStatusPill}
            </div>
            <div class="pin-card-title">${orderDef.title}</div>
            <div class="pin-card-desc">${orderDef.description}</div>
            <div class="pin-card-progress">Progress: ${orderEval.reason}</div>
          </div>

          <!-- Under-the-Table Propositions Section -->
          <div class="cork-pinned-sheet bribes-pin-card">
            <div class="pin-card-header">
              <span class="pin-card-kicker">Under-The-Table Bribes &amp; Tips (${acceptedTips.length} Active)</span>
            </div>
            ${tipsHtml}
          </div>
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
              <div class="shop-item-title">${nextUpgrade.name} (${nextUpgrade.slots} ${pluralWord(nextUpgrade.slots, 'Slot')})</div>
              <div class="shop-item-desc">${nextUpgrade.desc}</div>
            </div>
            <button
              id="btn-buy-stand"
              type="button"
              class="primary-cta-btn shop-buy-btn"
              ${state.bankroll < nextUpgrade.cost ? 'disabled' : ''}
            >
              UPGRADE ($${nextUpgrade.cost})
            </button>
          </div>
        `
        : `
          <div class="shop-max-banner">
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
                <div class="shop-catalog-row">
                  <div class="shop-item-copy">
                    <div class="shop-item-title">${s.title}</div>
                    <div class="shop-item-desc">${s.desc}</div>
                  </div>
                  <button
                    class="btn-buy-song secondary-cta-btn shop-buy-btn"
                    data-song-id="${s.id}"
                    type="button"
                    ${state.bankroll < s.cost ? 'disabled' : ''}
                  >
                    BUY ($${s.cost})
                  </button>
                </div>
              `
              )
              .join('')
          : '<div class="empty-catalog-note">All sheet music acquired!</div>';

      // Loadout checkboxes for unlocked songs
      const repertoireHtml = state.unlockedSongs
        .map((sid) => {
          const isEquipped = state.equippedSongs.includes(sid);
          const sDef = SONGS[sid];
          const songLabel = sDef ? sDef.title : sid.toUpperCase();
          const accentColor = sDef ? sDef.color : '#eab308';
          return `
            <label class="setlist-chip ${isEquipped ? 'is-equipped' : ''}" style="--chip-accent: ${accentColor};">
              <input type="checkbox" class="equip-checkbox" data-song-id="${sid}" ${isEquipped ? 'checked' : ''} />
              <span class="setlist-check-box" aria-hidden="true">${isEquipped ? '✓' : ''}</span>
              <span class="setlist-chip-label">${songLabel}</span>
            </label>
          `;
        })
        .join('');

      // Scouting info for next match
      const scoutHtml = nextMatch
        ? `
          <div class="cork-pinned-sheet scout-report-card">
            <div class="scout-kicker">
              NEXT MATCH ${nextMatch.matchNumber} OF 17 • ${nextMatch.tierLabel}
            </div>
            <div class="scout-opponent-title">
              VS.
              <span class="team-color-swatch" style="background: ${nextMatch.awayTeam.primaryColor};"></span>
              <span>${nextMatch.awayTeam.name}</span>
            </div>
            <div class="scout-notes-list">
              <div><strong>STRENGTH:</strong> ${nextMatch.awayTeam.scoutReport.strength}</div>
              <div><strong>WEAKNESS:</strong> ${nextMatch.awayTeam.scoutReport.weakness}</div>
              <div class="scout-highlight-tip"><strong>ORGANIST TIP:</strong> ${nextMatch.awayTeam.scoutReport.organistTip}</div>
            </div>
          </div>
        `
        : '<div class="cork-pinned-sheet scout-complete-card">Season matches complete!</div>';

      this.contentEl.innerHTML = `
        <div class="modal-inner shop-modal">
          <div class="shop-header-bar">
            <div>
              <div class="modal-eyebrow">POST-MATCH HEADQUARTERS</div>
              <h2 class="modal-title">🎹 ORGAN LOFT WORKSHOP</h2>
            </div>
            <div class="shop-wallet-cluster">
              <div class="cash-bankroll-badge">$${state.bankroll}</div>
              <div class="shop-rep-row">
                <span class="order-status-pill ${officialRep < 75 ? 'status-fail' : 'status-track'}">JOB SECURITY: ${officialRep}%</span>
                <span class="street-cred-pill">STREET CRED: LVL ${state.unofficialRepLevel}</span>
              </div>
            </div>
          </div>

          <div class="shop-board-grid">
            <div class="shop-col">
              ${scoutHtml}

              <div class="cork-pinned-sheet shop-section-card">
                <div class="pin-card-kicker">
                  Console Music Stand Capacity (${currentSlots} Active ${pluralWord(currentSlots, 'Slot')})
                </div>
                ${nextUpgradeHtml}
              </div>
            </div>

            <div class="shop-col">
              <div class="cork-pinned-sheet shop-section-card">
                <div class="pin-card-kicker">
                  Active Console Loadout (${state.equippedSongs.length} / ${state.maxSongSlots} Equipped)
                </div>
                <div class="setlist-chips-wrap">
                  ${repertoireHtml}
                </div>
              </div>

              <div class="cork-pinned-sheet shop-section-card">
                <div class="pin-card-kicker">
                  Sheet Music Library (Buy New Anthems)
                </div>
                <div class="shop-catalog-list">
                  ${songsToBuyHtml}
                </div>
              </div>
            </div>
          </div>

          <div class="modal-actions">
            <button id="btn-proceed-match" class="primary-cta-btn" type="button">
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
      .map((sid) => {
        const sDef = SONGS[sid];
        const lvl = mgr.getSongMasteryLevel(sid);
        const pillClass =
          lvl === 'MASTERED' ? 'status-track' : lvl === 'FAMILIAR' ? 'status-risk' : 'mastery-novice';
        return `
          <div class="season-song-row" style="--song-tab: ${sDef.color};">
            <div>
              <strong class="season-song-title">${sDef.title}</strong>
              <div class="season-song-desc">${sDef.shortDesc}</div>
            </div>
            <span class="order-status-pill ${pillClass}">
              ${lvl === 'MASTERED' ? '★ MASTERED' : lvl}
            </span>
          </div>
        `;
      })
      .join('');

    const officialPct = mgr.getOfficialReputationPct();

    this.contentEl.innerHTML = `
      <div class="modal-inner season-summary-modal">
        <div class="cork-pinned-sheet season-hero-sheet ${isSuccess ? 'is-champion' : 'is-dismissed'}">
          <div class="season-trophy-icon" aria-hidden="true">
            ${isSuccess ? '🏆' : '❌'}
          </div>
          <div class="modal-eyebrow">
            ${isSuccess ? '1988 MUNICIPAL ARENA • CAMPAIGN FINALE' : 'SEASON DISQUALIFICATION'}
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
          <div class="cork-pinned-sheet season-stat-card pin-red">
            <div class="pin-card-kicker">Career Matches</div>
            <div class="season-stat-big">
              ${history.length} <span class="season-stat-sub">/ 17 (${wins}W - ${losses}L - ${ties}T)</span>
            </div>
          </div>

          <div class="cork-pinned-sheet season-stat-card pin-blue">
            <div class="pin-card-kicker">Official Directives</div>
            <div class="season-stat-big ${officialPct >= 75 ? 'ink-green' : 'ink-red'}">
              ${officialPct}% <span class="season-stat-sub">(${state.officialOrdersCompleted}/${state.officialOrdersTotal} Passed)</span>
            </div>
          </div>

          <div class="cork-pinned-sheet season-stat-card pin-gold">
            <div class="pin-card-kicker">Street Cred &amp; Tips</div>
            <div class="season-stat-big ink-blue">
              Lvl ${state.unofficialRepLevel}/5 <span class="season-stat-sub">(${state.totalTipsCompleted} ${pluralWord(state.totalTipsCompleted, 'tip')}, +$${state.totalTipEarnings.toLocaleString()})</span>
            </div>
          </div>

          <div class="cork-pinned-sheet season-stat-card pin-green">
            <div class="pin-card-kicker">Career Bankroll &amp; Stand</div>
            <div class="season-stat-big ink-green">
              $${state.bankroll.toLocaleString()} <span class="season-stat-sub">(${state.maxSongSlots}/6 ${pluralWord(state.maxSongSlots, 'slot')})</span>
            </div>
          </div>
        </div>

        <div class="cork-pinned-sheet season-repertoire-sheet">
          <div class="season-rep-header">
            <span class="pin-card-kicker">Song Repertoire (${state.unlockedSongs.length} Unlocked)</span>
            <span class="season-mastered-count">${masteredCount} Mastered</span>
          </div>
          <div class="season-songs-scroll">
            ${songsHtml}
          </div>
        </div>

        <div class="modal-actions center-actions">
          <button id="btn-restart-season" class="primary-cta-btn" type="button">
            🎹 START NEW CAMPAIGN SEASON
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

