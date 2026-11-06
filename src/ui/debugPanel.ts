import {
  GameConfig,
  resetConfigStorage,
  saveConfig,
} from '../config';

interface SliderSpec {
  key: Exclude<keyof GameConfig, 'roster'>;
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
      { key: 'S_skateSpeed', label: 'S (Base Skate Speed)', min: 100, max: 400, step: 10 },
      { key: 'R_redirectLatency', label: 'R (Redirect Stun s)', min: 0.2, max: 3.0, step: 0.1 },
      { key: 'A_shooterAccuracy', label: 'A (Shooter Accuracy)', min: 0.2, max: 1.5, step: 0.05 },
      { key: 'F_fightChance', label: 'F (Fight Chance)', min: 0.0, max: 1.5, step: 0.05 },
      { key: 'T_stealChance', label: 'T (Steal Chance)', min: 0.0, max: 1.5, step: 0.05 },
    ],
  },
  {
    title: 'Song Modifiers & Timings (Game Sec)',
    items: [
      { key: 'songActiveDurationSec', label: 'Song Duration (s)', min: 4, max: 20, step: 1 },
      { key: 'cueWindowDurationSec', label: 'Cue Window (s)', min: 2, max: 10, step: 0.5 },
      { key: 'brawlDurationSec', label: 'Brawl Duration (s)', min: 2, max: 12, step: 1 },
      { key: 'penaltyDurationSec', label: 'Penalty Box (s)', min: 10, max: 60, step: 5 },
      { key: 'chargeFocusBonus', label: 'Charge +Focus', min: 0, max: 0.6, step: 0.05 },
      { key: 'chargeAggressionBonus', label: 'Charge +Aggression', min: 0, max: 0.6, step: 0.05 },
      { key: 'holdGoalieFocusBonus', label: 'Hold +Goalie Focus', min: 0, max: 0.6, step: 0.05 },
      { key: 'grudgeAggressionBonus', label: 'Grudge +Aggression', min: 0, max: 0.6, step: 0.05 },
    ],
  },
  {
    title: 'Rink Physics & Mood Drift',
    items: [
      { key: 'maxPossessionSec', label: 'Max Possession (s)', min: 1.5, max: 8.0, step: 0.5 },
      { key: 'minShotDistance', label: 'Min Shot Dist (px)', min: 100, max: 350, step: 10 },
      { key: 'moodHalfLifeSec', label: 'Mood Half-Life (s)', min: 2, max: 20, step: 1 },
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

  constructor(opts: {
    getConfig: () => GameConfig;
    getCurrentSeed: () => number;
    onConfigChange: (newCfg: GameConfig) => void;
    onRestartWithSeed: (seed: number) => void;
  }) {
    this.getConfig = opts.getConfig;
    this.getCurrentSeed = opts.getCurrentSeed;
    this.onConfigChange = opts.onConfigChange;
    this.onRestartWithSeed = opts.onRestartWithSeed;

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

  public render(): void {
    const cfg = this.getConfig();
    const seed = this.getCurrentSeed();

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
        <h3>Deterministic RNG Seed</h3>
        <div class="debug-seed-row">
          <input id="input-seed-val" type="number" value="${seed}" />
          <button id="btn-restart-seed" class="hud-btn active-toggle" type="button">
            Restart w/ Seed
          </button>
        </div>
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

    // Bind scalar sliders
    this.bodyEl.querySelectorAll('input[data-config-key]').forEach((input) => {
      input.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const key = target.dataset.configKey as Exclude<keyof GameConfig, 'roster'>;
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
