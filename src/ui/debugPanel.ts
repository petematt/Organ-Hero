import {
  GameConfig,
  resetConfigStorage,
  saveConfig,
} from '../config';
import { ALL_SONG_IDS, SONGS } from '../game/songs';
import { SongId } from '../sim/types';

type NumericConfigKey = Exclude<
  keyof GameConfig,
  'roster' | 'equippedSongs' | 'enablePassing'
>;

interface SliderSpec {
  key: NumericConfigKey;
  label: string;
  min: number;
  max: number;
  step: number;
}

const SLIDER_GROUPS: { title: string; items: SliderSpec[] }[] = [
  {
    title: 'Core Probability & Speed Multipliers',
    items: [
      { key: 'G_goalieBlock', label: 'G (Goalie Block)', min: 0.1, max: 1.5, step: 0.05 },
      { key: 'C_critSaveChance', label: 'C (Goalie Crit Catch)', min: 0.0, max: 1.5, step: 0.05 },
      { key: 'S_skateSpeed', label: 'S (Base Skate Speed)', min: 100, max: 400, step: 10 },
      { key: 'R_redirectLatency', label: 'R (Redirect Stun s)', min: 0.2, max: 3.0, step: 0.1 },
      { key: 'A_shooterAccuracy', label: 'A (Shooter Accuracy)', min: 0.2, max: 1.5, step: 0.05 },
      { key: 'F_fightChance', label: 'F (Fight Chance)', min: 0.0, max: 1.5, step: 0.05 },
      { key: 'T_stealChance', label: 'T (Steal Chance)', min: 0.0, max: 1.5, step: 0.05 },
      { key: 'P_passTendency', label: 'P (Pass Tendency)', min: 0.0, max: 1.5, step: 0.05 },
      { key: 'P_passAccuracy', label: 'P_acc (Pass Accuracy)', min: 0.1, max: 1.5, step: 0.05 },
    ],
  },
  {
    title: 'Song Modifiers & Timings (Game Sec)',
    items: [
      { key: 'periodDurationSec', label: 'Period Length (sec)', min: 30, max: 240, step: 15 },
      { key: 'songActiveDurationSec', label: 'Song Duration (sec)', min: 4, max: 20, step: 1 },
      { key: 'cueWindowDurationSec', label: 'Cue Window (sec)', min: 2, max: 10, step: 0.5 },
      { key: 'brawlDurationSec', label: 'Brawl Duration (sec)', min: 2, max: 12, step: 1 },
      { key: 'penaltyDurationSec', label: 'Penalty Box (sec)', min: 10, max: 60, step: 5 },
      { key: 'goalieHoldDurationSec', label: 'Goalie Hold (sec)', min: 0.4, max: 3.0, step: 0.2 },
      { key: 'chargeFocusBonus', label: 'Charge +Focus', min: 0, max: 0.6, step: 0.05 },
      { key: 'chargeAggressionBonus', label: 'Charge +Aggression', min: 0, max: 0.6, step: 0.05 },
      { key: 'holdGoalieFocusBonus', label: 'Hold +Goalie Focus', min: 0, max: 0.6, step: 0.05 },
      { key: 'grudgeAggressionBonus', label: 'Grudge +Aggression', min: 0, max: 0.6, step: 0.05 },
      { key: 'polkaFocusBonus', label: 'Polka +Focus (PP)', min: 0, max: 0.6, step: 0.05 },
      { key: 'polkaAggressionBonus', label: 'Polka +Agg (PP)', min: 0, max: 0.6, step: 0.05 },
      { key: 'killClockGoalieFocusBonus', label: 'Kill Clock +Goalie Foc', min: 0, max: 0.6, step: 0.05 },
      { key: 'killClockStrikerFocusBonus', label: 'Kill Clock +Striker Foc', min: 0, max: 0.6, step: 0.05 },
      { key: 'madeyalookGoalieFocusDelta', label: 'Madeyalook Goalie ΔFoc', min: -0.6, max: 0, step: 0.05 },
    ],
  },
  {
    title: 'Rink Physics & Mood Drift',
    items: [
      { key: 'maxPossessionSec', label: 'Max Possession (sec)', min: 1.5, max: 8.0, step: 0.5 },
      { key: 'minShotDistance', label: 'Min Shot Dist (px)', min: 100, max: 350, step: 10 },
      { key: 'moodHalfLifeSec', label: 'Mood Half-Life (sec)', min: 2, max: 20, step: 1 },
      { key: 'pushStrength', label: 'Push Strength', min: 10, max: 90, step: 5 },
    ],
  },
];

export class DebugPanelController {
  private drawerEl = document.getElementById('debug-drawer')!;
  private bodyEl = document.getElementById('debug-body')!;
  private getConfig: () => GameConfig;
  private onConfigChange: (newCfg: GameConfig) => void;
  private onRestartWithSeed: (seed: number) => void;
  private getCurrentSeed: () => number;

  private getShowStatBars?: () => boolean;
  private onToggleStatBars?: (show: boolean) => void;

  constructor(opts: {
    getConfig: () => GameConfig;
    getCurrentSeed: () => number;
    onConfigChange: (newCfg: GameConfig) => void;
    onRestartWithSeed: (seed: number) => void;
    getShowStatBars?: () => boolean;
    onToggleStatBars?: (show: boolean) => void;
  }) {
    this.getConfig = opts.getConfig;
    this.getCurrentSeed = opts.getCurrentSeed;
    this.onConfigChange = opts.onConfigChange;
    this.onRestartWithSeed = opts.onRestartWithSeed;
    this.getShowStatBars = opts.getShowStatBars;
    this.onToggleStatBars = opts.onToggleStatBars;

    document.getElementById('btn-close-debug')?.addEventListener('click', () => {
      this.toggle(false);
    });
  }

  public isOpen(): boolean {
    return !this.drawerEl.classList.contains('hidden');
  }

  public toggle(force?: boolean): void {
    const next = force !== undefined ? force : !this.isOpen();
    this.drawerEl.classList.toggle('hidden', !next);
    if (next) {
      this.render();
    }
  }

  private normalizeEquippedSongs(cfg: GameConfig): SongId[] {
    const list: SongId[] = [];
    for (const id of cfg.equippedSongs ?? []) {
      if (SONGS[id] && !list.includes(id)) {
        list.push(id);
      }
    }
    for (const id of ALL_SONG_IDS) {
      if (!list.includes(id)) {
        list.push(id);
      }
    }
    return list;
  }

  public render(): void {
    const cfg = this.getConfig();
    const seed = this.getCurrentSeed();
    const maxSlots = Math.max(1, Math.min(6, Math.round(cfg.maxSongSlots ?? 3)));
    const equipped = this.normalizeEquippedSongs(cfg);

    const slotSelectsHtml = Array.from({ length: maxSlots }, (_, slotIdx) => {
      const currentSongId = equipped[slotIdx] ?? ALL_SONG_IDS[slotIdx];
      const optionsHtml = ALL_SONG_IDS.map(
        (id) =>
          `<option value="${id}" ${
            id === currentSongId ? 'selected' : ''
          }>${SONGS[id].shortTitle}${SONGS[id].requiresPowerPlay ? ' (PP)' : ''}</option>`
      ).join('');
      return `
        <label class="debug-slider-row">
          <span class="d-label">Slot [${slotIdx + 1}]</span>
          <select class="debug-song-select" data-slot-idx="${slotIdx}">
            ${optionsHtml}
          </select>
        </label>
      `;
    }).join('');

    const groupsHtml = SLIDER_GROUPS.map(
      (g) => `
        <div class="debug-section">
          <h3>${g.title}</h3>
          ${g.items
            .map((it) => {
              const val = cfg[it.key] as number;
              return `
                <label class="debug-slider-row">
                  <span class="d-label">${it.label}</span>
                  <input
                    type="range"
                    min="${it.min}"
                    max="${it.max}"
                    step="${it.step}"
                    value="${val}"
                    data-config-key="${it.key}"
                  />
                  <span class="d-val" id="dval-${it.key}">${val}</span>
                </label>
              `;
            })
            .join('')}
        </div>
      `
    ).join('');

    const rosterHtml = cfg.roster
      .map(
        (r, idx) => `
          <div class="debug-roster-card">
            <strong>${r.team.toUpperCase()} #${r.number} ${r.name} (${r.role})</strong>
            <label class="debug-slider-row">
              <span class="d-label">Base Focus</span>
              <input
                type="range"
                min="0.1"
                max="0.95"
                step="0.05"
                value="${r.focus}"
                data-roster-idx="${idx}"
                data-roster-field="focus"
              />
              <span class="d-val" id="rval-${idx}-focus">${r.focus.toFixed(2)}</span>
            </label>
            ${
              r.role === 'striker'
                ? `
            <label class="debug-slider-row">
              <span class="d-label">Base Aggression</span>
              <input
                type="range"
                min="0.1"
                max="0.95"
                step="0.05"
                value="${r.aggression}"
                data-roster-idx="${idx}"
                data-roster-field="aggression"
              />
              <span class="d-val" id="rval-${idx}-aggression">${r.aggression.toFixed(2)}</span>
            </label>`
                : ''
            }
          </div>
        `
      )
      .join('');

    this.bodyEl.innerHTML = `
      <div class="debug-section">
        <h3>Deterministic RNG Seed &amp; Mechanics</h3>
        <div class="debug-seed-row">
          <input id="input-seed-val" type="number" value="${seed}" />
          <button id="btn-restart-seed" class="hud-btn active-toggle" type="button">
            Restart w/ Seed
          </button>
        </div>
        <label class="debug-slider-row" style="margin-top: 8px; cursor: pointer;">
          <span class="d-label">Enable Team Passing</span>
          <input
            id="chk-enable-passing"
            type="checkbox"
            ${cfg.enablePassing ? 'checked' : ''}
          />
          <span class="d-val" id="dval-enablePassing">${cfg.enablePassing ? 'ON' : 'OFF'}</span>
        </label>
        <label class="debug-slider-row" style="margin-top: 8px; cursor: pointer;">
          <span class="d-label">Show Overhead Stat Bars</span>
          <input
            id="chk-show-bars"
            type="checkbox"
            ${this.getShowStatBars ? (this.getShowStatBars() ? 'checked' : '') : 'checked'}
          />
          <span class="d-val" id="dval-showBars">${this.getShowStatBars ? (this.getShowStatBars() ? 'ON' : 'OFF') : 'ON'}</span>
        </label>
      </div>

      <div class="debug-section">
        <h3>Song Loadout &amp; Slot Limit</h3>
        <label class="debug-slider-row">
          <span class="d-label">Max Song Slots</span>
          <input
            id="input-max-song-slots"
            type="range"
            min="1"
            max="6"
            step="1"
            value="${maxSlots}"
          />
          <span class="d-val" id="dval-maxSongSlots">${maxSlots}</span>
        </label>
        ${slotSelectsHtml}
      </div>

      ${groupsHtml}

      <div class="debug-section">
        <h3>Player Baseline Personalities</h3>
        ${rosterHtml}
      </div>

      <div class="debug-section">
        <h3>Share / Reset Configuration</h3>
        <div class="debug-btn-row">
          <button id="btn-copy-cfg" class="hud-btn" type="button">Copy JSON</button>
          <button id="btn-paste-cfg" class="hud-btn" type="button">Paste JSON</button>
          <button id="btn-reset-cfg" class="hud-btn" type="button">Reset Defaults</button>
        </div>
        <div id="debug-status-msg" class="debug-status-msg"></div>
      </div>
    `;

    // Bind Enable Passing checkbox
    const passChk = document.getElementById('chk-enable-passing') as HTMLInputElement | null;
    passChk?.addEventListener('change', () => {
      const updated = this.getConfig();
      updated.enablePassing = passChk.checked;
      saveConfig(updated);
      this.onConfigChange(updated);
      const valSpan = document.getElementById('dval-enablePassing');
      if (valSpan) valSpan.textContent = updated.enablePassing ? 'ON' : 'OFF';
    });

    // Bind Show Overhead Stat Bars checkbox
    const barsChk = document.getElementById('chk-show-bars') as HTMLInputElement | null;
    barsChk?.addEventListener('change', () => {
      const isChecked = barsChk.checked;
      this.onToggleStatBars?.(isChecked);
      const valSpan = document.getElementById('dval-showBars');
      if (valSpan) valSpan.textContent = isChecked ? 'ON' : 'OFF';
    });

    // Bind Max Song Slots slider
    document.getElementById('input-max-song-slots')?.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const num = parseInt(target.value, 10);
      if (!Number.isNaN(num)) {
        const updated = this.getConfig();
        updated.maxSongSlots = Math.max(1, Math.min(6, num));
        updated.equippedSongs = this.normalizeEquippedSongs(updated);
        saveConfig(updated);
        this.onConfigChange(updated);
        this.render();
      }
    });

    // Bind per-slot song selection dropdowns (swapping duplicates cleanly)
    this.bodyEl.querySelectorAll('select[data-slot-idx]').forEach((sel) => {
      sel.addEventListener('change', (e) => {
        const target = e.target as HTMLSelectElement;
        const slotIdx = parseInt(target.dataset.slotIdx || '0', 10);
        const chosenSong = target.value as SongId;
        const updated = this.getConfig();
        const nextEquipped = this.normalizeEquippedSongs(updated);
        const existingIdx = nextEquipped.indexOf(chosenSong);
        if (existingIdx !== -1 && existingIdx !== slotIdx) {
          const prevSong = nextEquipped[slotIdx];
          nextEquipped[existingIdx] = prevSong;
        }
        nextEquipped[slotIdx] = chosenSong;
        updated.equippedSongs = nextEquipped;
        saveConfig(updated);
        this.onConfigChange(updated);
        this.render();
      });
    });

    // Bind scalar sliders
    this.bodyEl.querySelectorAll('input[data-config-key]').forEach((input) => {
      input.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const key = target.dataset.configKey as NumericConfigKey;
        const num = parseFloat(target.value);
        if (!Number.isNaN(num)) {
          const updated = this.getConfig();
          (updated[key] as number) = num;
          saveConfig(updated);
          this.onConfigChange(updated);
          const valSpan = document.getElementById(`dval-${key}`);
          if (valSpan) valSpan.textContent = String(num);
        }
      });
    });

    // Bind roster baseline sliders
    this.bodyEl.querySelectorAll('input[data-roster-idx]').forEach((input) => {
      input.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const idx = parseInt(target.dataset.rosterIdx || '0', 10);
        const field = target.dataset.rosterField as 'focus' | 'aggression';
        const num = parseFloat(target.value);
        if (!Number.isNaN(num)) {
          const updated = this.getConfig();
          updated.roster[idx][field] = num;
          saveConfig(updated);
          this.onConfigChange(updated);
          const valSpan = document.getElementById(`rval-${idx}-${field}`);
          if (valSpan) valSpan.textContent = num.toFixed(2);
        }
      });
    });

    document.getElementById('btn-restart-seed')?.addEventListener('click', () => {
      const seedInput = document.getElementById('input-seed-val') as HTMLInputElement;
      const parsed = parseInt(seedInput.value, 10);
      this.onRestartWithSeed(Number.isNaN(parsed) ? 1337 : parsed);
    });

    document.getElementById('btn-reset-cfg')?.addEventListener('click', () => {
      const defaults = resetConfigStorage();
      this.onConfigChange(defaults);
      this.render();
      this.setStatus('Reset to default tuning values.');
    });

    document.getElementById('btn-copy-cfg')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(this.getConfig(), null, 2));
        this.setStatus('Copied config JSON to clipboard!');
      } catch {
        this.setStatus('Clipboard access denied.');
      }
    });

    document.getElementById('btn-paste-cfg')?.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        const parsed = JSON.parse(text) as Partial<GameConfig>;
        const merged: GameConfig = { ...this.getConfig(), ...parsed };
        saveConfig(merged);
        this.onConfigChange(merged);
        this.render();
        this.setStatus('Applied config JSON from clipboard!');
      } catch {
        this.setStatus('Invalid JSON in clipboard.');
      }
    });
  }

  private setStatus(msg: string): void {
    const el = document.getElementById('debug-status-msg');
    if (el) el.textContent = msg;
  }
}

