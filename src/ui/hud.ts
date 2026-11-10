import { TipOffer } from '../campaign/tips';
import { evaluateOrder, getOrderById } from '../game/orders';
import {
  getPowerPlayState,
  isSongValidOnIce,
  resolveSongTarget,
  SONGS,
} from '../game/songs';
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
  private hudTipBoxEl = document.getElementById('hud-tip-box');
  private hudTipTitleEl = document.getElementById('hud-tip-title');
  private hudTipStatusEl = document.getElementById('hud-tip-status');

  private edgeTintEl = document.getElementById('edge-tint')!;

  private musicStandButtonsEl = document.querySelector(
    '.music-stand-buttons'
  ) as HTMLElement;
  private renderedLoadoutKey: string = '';

  private ensureSongButtons(loadout: SongId[]): void {
    const key = loadout.join(',');
    if (key === this.renderedLoadoutKey) return;
    this.renderedLoadoutKey = key;

    this.musicStandButtonsEl.style.gridTemplateColumns = `repeat(${loadout.length}, minmax(0, 1fr))`;
    this.musicStandButtonsEl.innerHTML = loadout
      .map((songId) => {
        const sDef = SONGS[songId];
        return `
          <button
            id="btn-song-${songId}"
            class="song-btn song-${songId}"
            type="button"
            data-song="${songId}"
            style="--song-accent: ${sDef.color}"
          >
            <div class="song-btn-top">
              <span class="song-title">${sDef.buttonTitle}</span>
              <span id="stale-badge-${songId}" class="stale-badge hidden">STALE</span>
            </div>
            <div class="song-btn-desc">${sDef.shortDesc}</div>
            <div class="song-btn-target">
              <span id="target-label-${songId}" class="target-pill target-home">HOME</span>
            </div>
            <div class="song-progress-bar">
              <div id="progress-${songId}" class="song-progress-fill"></div>
            </div>
          </button>
        `;
      })
      .join('');
  }

  public update(sim: MatchSimulation, activeTips?: TipOffer[]): void {
    const loadout = sim.getActiveSongLoadout();
    this.ensureSongButtons(loadout);

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

    // Active Intermission Tip Status
    const acceptedTip = activeTips?.find(
      (t) => t.status === 'ACCEPTED' || t.status === 'PASSED'
    );
    if (acceptedTip && this.hudTipBoxEl && this.hudTipTitleEl && this.hudTipStatusEl) {
      this.hudTipBoxEl.classList.remove('hidden');
      this.hudTipTitleEl.textContent = acceptedTip.conditionDescription;
      this.hudTipTitleEl.title = `${acceptedTip.senderName}: ${acceptedTip.flavorText} (${acceptedTip.liveProgressText})`;
      if (acceptedTip.status === 'PASSED') {
        this.hudTipStatusEl.textContent = `DONE (+$${acceptedTip.bribePayout})`;
        this.hudTipStatusEl.className = 'tip-status-pill status-track';
      } else {
        this.hudTipStatusEl.textContent = `+$${acceptedTip.bribePayout}`;
        this.hudTipStatusEl.className = 'tip-status-pill status-risk';
      }
    } else if (this.hudTipBoxEl) {
      this.hudTipBoxEl.classList.add('hidden');
    }

    // Screen-edge tint while a song is active
    if (sim.activeSong) {
      const sDef = SONGS[sim.activeSong.songId];
      const validNow = isSongValidOnIce(sim.activeSong.songId, sim.players);
      this.edgeTintEl.style.boxShadow = validNow
        ? `inset 0 0 36px ${sDef.color}55`
        : 'none';
    } else {
      this.edgeTintEl.style.boxShadow = 'none';
    }

    const pp = getPowerPlayState(sim.players);

    // Update Song Button live / locked target pills, cue glows, stale badges, and progress bars
    for (const id of loadout) {
      const btn = document.getElementById(
        `btn-song-${id}`
      ) as HTMLButtonElement | null;
      const targetLabelEl = document.getElementById(`target-label-${id}`);
      const staleBadge = document.getElementById(`stale-badge-${id}`);
      const progFill = document.getElementById(`progress-${id}`);
      if (!btn || !targetLabelEl || !staleBadge || !progFill) continue;

      const sDef = SONGS[id];
      const validOnIce = isSongValidOnIce(id, sim.players);
      const isActive = sim.activeSong?.songId === id;
      const isCueMatch = validOnIce && sim.activeCue?.matchingSong === id;
      const isStale = sim.lastPlayedSongId === id;

      const liveTarget = resolveSongTarget(
        id,
        sim.currentPossessor,
        sim.lastPossessor,
        sim.players
      );
      const effectiveTarget =
        isActive && sim.activeSong ? sim.activeSong.target : liveTarget;

      if (sDef.requiresPowerPlay && !pp.isPowerPlay) {
        targetLabelEl.textContent = 'NO POWER PLAY';
        targetLabelEl.className = 'target-pill target-inactive';
      } else if (id === 'grudge_toccata') {
        targetLabelEl.textContent = 'BOTH TEAMS';
        targetLabelEl.className = `target-pill target-both${
          isActive ? ' is-locked' : ''
        }`;
      } else if (id === 'power_play_polka') {
        targetLabelEl.textContent = `${effectiveTarget.toUpperCase()} (PP)`;
        targetLabelEl.className = `target-pill target-${effectiveTarget}${
          isActive ? ' is-locked' : ''
        }`;
      } else if (id === 'kill_the_clock') {
        targetLabelEl.textContent = `${effectiveTarget.toUpperCase()} (PK)`;
        targetLabelEl.className = `target-pill target-${effectiveTarget}${
          isActive ? ' is-locked' : ''
        }`;
      } else if (id === 'madeyalook') {
        targetLabelEl.textContent = `${effectiveTarget.toUpperCase()} (Goalie)`;
        targetLabelEl.className = `target-pill target-${effectiveTarget}${
          isActive ? ' is-locked' : ''
        }`;
      } else if (id === 'charge') {
        targetLabelEl.textContent = isActive
          ? `${effectiveTarget.toUpperCase()}`
          : `${effectiveTarget.toUpperCase()} (${
              sim.currentPossessor ? 'Poss' : 'Last'
            })`;
        targetLabelEl.className = `target-pill target-${effectiveTarget}${
          isActive ? ' is-locked' : ''
        }`;
      } else {
        targetLabelEl.textContent = isActive
          ? `${effectiveTarget.toUpperCase()}`
          : `${effectiveTarget.toUpperCase()} (Def)`;
        targetLabelEl.className = `target-pill target-${effectiveTarget}${
          isActive ? ' is-locked' : ''
        }`;
      }

      btn.classList.toggle('is-active', isActive);
      btn.classList.toggle('is-cue-glow', isCueMatch);
      btn.classList.toggle('is-pp-disabled', Boolean(sDef.requiresPowerPlay && !pp.isPowerPlay));
      staleBadge.classList.toggle('hidden', !isStale);

      if (isActive && sim.activeSong) {
        const pct =
          (sim.activeSong.remainingSec / sim.activeSong.durationSec) * 100;
        progFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
      } else {
        progFill.style.width = '0%';
      }
    }
  }
}


