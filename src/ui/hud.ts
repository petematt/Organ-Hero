import { evaluateOrder, getOrderById } from '../game/orders';
import { resolveSongTarget, SONGS } from '../game/songs';
import { MatchSimulation } from '../sim/match';
import { SongId } from '../sim/types';

export class HudController {
  private scoreHomeEl = document.getElementById('score-home')!;
  private scoreAwayEl = document.getElementById('score-away')!;
  private periodLabelEl = document.getElementById('period-label')!;
  private clockDisplayEl = document.getElementById('clock-display')!;
  private cueBannerEl = document.getElementById('cue-banner')!;
  private cueTextEl = document.getElementById('cue-text')!;

  private crowdPctEl = document.getElementById('crowd-pct')!;
  private crowdBarFillEl = document.getElementById('crowd-bar-fill')!;
  private hudOrderTitleEl = document.getElementById('hud-order-title')!;
  private hudOrderStatusEl = document.getElementById('hud-order-status')!;

  private possBannerEl = document.getElementById('possession-banner')!;
  private possDotEl = document.getElementById('poss-dot')!;
  private possLabelEl = document.getElementById('poss-label')!;
  private activeSongPillEl = document.getElementById('active-song-pill')!;
  private activeSongTextEl = document.getElementById('active-song-text')!;
  private edgeTintEl = document.getElementById('edge-tint')!;

  private targetLabelChargeEl = document.getElementById('target-label-charge')!;
  private targetLabelHoldEl = document.getElementById('target-label-hold')!;
  private targetLabelGrudgeEl = document.getElementById('target-label-grudge')!;

  private songBtns: Record<SongId, HTMLButtonElement> = {
    charge: document.getElementById('btn-song-charge') as HTMLButtonElement,
    hold_the_line: document.getElementById('btn-song-hold') as HTMLButtonElement,
    grudge_toccata: document.getElementById('btn-song-grudge') as HTMLButtonElement,
  };

  private staleBadges: Record<SongId, HTMLElement> = {
    charge: document.getElementById('stale-badge-charge')!,
    hold_the_line: document.getElementById('stale-badge-hold_the_line')!,
    grudge_toccata: document.getElementById('stale-badge-grudge_toccata')!,
  };

  private progressFills: Record<SongId, HTMLElement> = {
    charge: document.getElementById('progress-charge')!,
    hold_the_line: document.getElementById('progress-hold_the_line')!,
    grudge_toccata: document.getElementById('progress-grudge_toccata')!,
  };

  public update(sim: MatchSimulation): void {
    this.scoreHomeEl.textContent = String(sim.homeScore);
    this.scoreAwayEl.textContent = String(sim.awayScore);
    this.periodLabelEl.textContent = `P${sim.period}`;

    const totalSecs = Math.ceil(sim.periodTimeRemainingSec);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    this.clockDisplayEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

    // Situational Cue Banner
    if (sim.activeCue) {
      this.cueBannerEl.classList.remove('hidden');
      this.cueTextEl.textContent = sim.activeCue.bannerText;
    } else {
      this.cueBannerEl.classList.add('hidden');
    }

    // Crowd Volume
    const crowdRounded = Math.round(sim.crowdVolume);
    this.crowdPctEl.textContent = `${crowdRounded}%`;
    this.crowdBarFillEl.style.width = `${crowdRounded}%`;
    this.crowdBarFillEl.className =
      'crowd-bar-fill ' +
      (crowdRounded >= 65
        ? 'crowd-high'
        : crowdRounded <= 30
        ? 'crowd-low'
        : 'crowd-mid');

    // Active Official Order Status
    const orderDef = getOrderById(sim.orderId);
    const evalRes = evaluateOrder(sim.orderId, {
      homeGoals: sim.homeScore,
      awayGoals: sim.awayScore,
      totalFights: sim.getTotalFights(),
      averageCrowdVolume: sim.getAverageCrowdVolume(),
      isMatchOver: sim.phase === 'MATCH_OVER',
    });

    this.hudOrderTitleEl.textContent = orderDef.shortLabel;
    this.hudOrderTitleEl.title = `${orderDef.title}: ${orderDef.description} (${evalRes.reason})`;

    if (evalRes.liveStatus === 'ON_TRACK' || evalRes.liveStatus === 'PASSED') {
      this.hudOrderStatusEl.textContent = 'OK';
      this.hudOrderStatusEl.className = 'order-status-pill status-track';
    } else if (evalRes.liveStatus === 'AT_RISK') {
      this.hudOrderStatusEl.textContent = 'RISK';
      this.hudOrderStatusEl.className = 'order-status-pill status-risk';
    } else {
      this.hudOrderStatusEl.textContent = 'FAIL';
      this.hudOrderStatusEl.className = 'order-status-pill status-fail';
    }

    // Compact Possession Indicator on the Organ Console
    if (sim.currentPossessor !== null) {
      const teamUpper = sim.currentPossessor.toUpperCase();
      this.possBannerEl.className = `possession-banner poss-solid poss-${sim.currentPossessor}`;
      this.possDotEl.textContent = '●';
      this.possLabelEl.textContent = `${teamUpper} POSS`;
    } else if (sim.lastPossessor !== null) {
      const teamUpper = sim.lastPossessor.toUpperCase();
      this.possBannerEl.className = `possession-banner poss-loose poss-${sim.lastPossessor}`;
      this.possDotEl.textContent = '◌';
      this.possLabelEl.textContent = `${teamUpper} LAST`;
    } else {
      this.possBannerEl.className = 'possession-banner poss-none';
      this.possDotEl.textContent = '●';
      this.possLabelEl.textContent = 'HOME DROP';
    }

    // Active song pill & screen-edge tint
    if (sim.activeSong) {
      const sDef = SONGS[sim.activeSong.songId];
      const rem = (sim.activeSong.remainingSec * 0.5).toFixed(1);
      const lockLabel = sim.activeSong.target.toUpperCase();
      this.activeSongPillEl.classList.remove('hidden');
      this.activeSongTextEl.textContent = `♪ ${sDef.shortTitle} → ${lockLabel} (${rem}s)`;
      this.edgeTintEl.style.boxShadow = `inset 0 0 36px ${sDef.color}55`;
    } else {
      this.activeSongPillEl.classList.add('hidden');
      this.edgeTintEl.style.boxShadow = 'none';
    }

    // Update Song Button live / locked target labels, cue glows, stale badges, and progress bars
    const liveChargeTarget = resolveSongTarget(
      'charge',
      sim.currentPossessor,
      sim.lastPossessor
    );
    const liveHoldTarget = resolveSongTarget(
      'hold_the_line',
      sim.currentPossessor,
      sim.lastPossessor
    );

    this.targetLabelChargeEl.textContent =
      sim.activeSong?.songId === 'charge'
        ? `🔒 ${sim.activeSong.target.toUpperCase()}`
        : `${liveChargeTarget.toUpperCase()} (${
            sim.currentPossessor ? 'Poss' : 'Last'
          })`;

    this.targetLabelHoldEl.textContent =
      sim.activeSong?.songId === 'hold_the_line'
        ? `🔒 ${sim.activeSong.target.toUpperCase()}`
        : `${liveHoldTarget.toUpperCase()} (Def)`;

    this.targetLabelGrudgeEl.textContent =
      sim.activeSong?.songId === 'grudge_toccata'
        ? '🔒 BOTH'
        : 'BOTH TEAMS';

    const songIds: SongId[] = ['charge', 'hold_the_line', 'grudge_toccata'];
    for (const id of songIds) {
      const btn = this.songBtns[id];
      const staleBadge = this.staleBadges[id];
      const progFill = this.progressFills[id];

      const isActive = sim.activeSong?.songId === id;
      const isCueMatch = sim.activeCue?.matchingSong === id;
      const isStale = sim.lastPlayedSongId === id;

      btn.classList.toggle('is-active', isActive);
      btn.classList.toggle('is-cue-glow', isCueMatch);
      staleBadge.classList.toggle('hidden', !isStale);

      if (isActive && sim.activeSong) {
        const pct =
          (sim.activeSong.remainingSec / sim.activeSong.durationSec) * 100;
        progFill.style.width = `${ Math.max(0, Math.min(100, pct)) }%`;
      } else {
        progFill.style.width = '0%';
      }
    }
  }
}
