import { SongId } from '../sim/types';

interface NoteStep {
  freq: number;
  durationSec: number;
  delaySec: number;
  chord?: number[];
}

export class OrganSynth {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private organGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private unlocked: boolean = false;
  private crowdGain: GainNode | null = null;
  private crowdFilter: BiquadFilterNode | null = null;
  private crowdSurgeGain: GainNode | null = null;
  private crowdRunning: boolean = false;
  private lastCrowdTargetGain: number = -1;
  private lastCrowdTargetFreq: number = -1;

  // Analytical surge envelope state for glitch-free overlapping surges
  private surgeStartTime: number = 0;
  private surgeStartVal: number = 1.0;
  private surgePeakVal: number = 1.0;
  private surgeAttackSec: number = 0.08;
  private surgeHoldSec: number = 0.04;
  private surgeDecayTau: number = 0.40;

  public unlock(): void {
    try {
      if (!this.ctx) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 1.0;
        this.masterGain.connect(this.ctx.destination);

        this.organGain = this.ctx.createGain();
        this.organGain.gain.value = 0.98;
        this.organGain.connect(this.masterGain);

        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 0.95;
        this.sfxGain.connect(this.masterGain);

        this.initCrowdAmbiance(this.ctx);
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      this.unlocked = true;
    } catch {
      // AudioContext blocked or unsupported
    }
  }

  private initCrowdAmbiance(ctx: AudioContext): void {
    if (this.crowdRunning) return;
    try {
      const buffer = this.createCrowdBuffer(ctx);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      this.crowdFilter = ctx.createBiquadFilter();
      this.crowdFilter.type = 'lowpass';
      this.crowdFilter.frequency.value = 550;
      this.crowdFilter.Q.value = 0.7;

      // Slow organic acoustic drift
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.2;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 60;
      lfo.connect(lfoGain);
      lfoGain.connect(this.crowdFilter.frequency);
      lfo.start();

      this.crowdGain = ctx.createGain();
      this.crowdGain.gain.value = 0.10;

      this.crowdSurgeGain = ctx.createGain();
      this.crowdSurgeGain.gain.value = 1.0;

      source.connect(this.crowdFilter);
      this.crowdFilter.connect(this.crowdGain);
      this.crowdGain.connect(this.crowdSurgeGain);
      if (this.masterGain) {
        this.crowdSurgeGain.connect(this.masterGain);
      } else {
        this.crowdSurgeGain.connect(ctx.destination);
      }

      source.start();
      this.crowdRunning = true;
    } catch {
      // Audio buffer / source creation blocked or unsupported
    }
  }

  private createCrowdBuffer(ctx: AudioContext): AudioBuffer {
    const sampleRate = ctx.sampleRate || 44100;
    const bufferLength = sampleRate * 4; // 4 seconds looping stereo buffer
    const buffer = ctx.createBuffer(2, bufferLength, sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferLength; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
        data[i] = pink * 0.22;
      }
    }
    return buffer;
  }

  public setCrowdVolume(crowdVolume: number, isPaused: boolean = false): void {
    if (!this.unlocked) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (!this.crowdRunning) {
      this.initCrowdAmbiance(ctx);
    }

    const norm = Math.max(0, Math.min(1, (crowdVolume ?? 50) / 100));
    // Warm arena crowd bed (~ -26 dBFS at 50%, ~ -22.5 dBFS at 100%) supporting the -13.5 dBFS organ
    const targetGain = isPaused ? 0.035 : 0.085 + norm * 0.145;
    const targetFreq = isPaused ? 360 : 480 + norm * 540;

    const now = ctx.currentTime;
    if (this.crowdGain && Math.abs(targetGain - this.lastCrowdTargetGain) > 0.001) {
      this.lastCrowdTargetGain = targetGain;
      this.crowdGain.gain.setTargetAtTime(targetGain, now, 0.2);
    }
    if (this.crowdFilter && Math.abs(targetFreq - this.lastCrowdTargetFreq) > 1.5) {
      this.lastCrowdTargetFreq = targetFreq;
      this.crowdFilter.frequency.setTargetAtTime(targetFreq, now, 0.25);
    }
  }

  private getCurrentSurgeValue(now: number): number {
    if (this.surgePeakVal <= 1.0001) return 1.0;
    const elapsed = now - this.surgeStartTime;
    if (elapsed <= 0) return this.surgeStartVal;
    if (elapsed < this.surgeAttackSec) {
      const frac = elapsed / this.surgeAttackSec;
      return this.surgeStartVal + (this.surgePeakVal - this.surgeStartVal) * frac;
    }
    if (elapsed < this.surgeAttackSec + this.surgeHoldSec) {
      return this.surgePeakVal;
    }
    const decayElapsed = elapsed - (this.surgeAttackSec + this.surgeHoldSec);
    const val = 1.0 + (this.surgePeakVal - 1.0) * Math.exp(-decayElapsed / this.surgeDecayTau);
    return val < 1.0005 ? 1.0 : val;
  }

  /**
   * Spikes crowd excitement up to ~2x baseline following a shot or a goal:
   * Quick rise in volume, brief rounded crest, and smooth asymptotic decay back to baseline
   * without touching crowdFilter (avoiding multi-stage cutoffs or filter stomping).
   */
  public triggerCrowdSurge(type: 'shot' | 'goal'): void {
    if (!this.unlocked) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.crowdSurgeGain || !this.crowdRunning) return;

    const now = ctx.currentTime;
    const surgeGain = this.crowdSurgeGain.gain;
    const currentVal = this.getCurrentSurgeValue(now);

    const targetPeak = type === 'goal' ? 2.0 : 1.8;
    const peakVal = Math.min(2.0, Math.max(currentVal, targetPeak));
    const attackSec = type === 'goal' ? 0.08 : 0.07;
    const holdSec = type === 'goal' ? 0.08 : 0.03;
    const decayTau = type === 'goal' ? 0.55 : 0.36;

    const paramWithHold = surgeGain as AudioParam & {
      cancelAndHoldAtTime?: (cancelTime: number) => AudioParam;
    };
    if (typeof paramWithHold.cancelAndHoldAtTime === 'function') {
      paramWithHold.cancelAndHoldAtTime(now);
    } else {
      surgeGain.cancelScheduledValues(now);
    }

    surgeGain.setValueAtTime(currentVal, now);
    surgeGain.linearRampToValueAtTime(peakVal, now + attackSec);
    surgeGain.setTargetAtTime(1.0, now + attackSec + holdSec, decayTau);

    this.surgeStartTime = now;
    this.surgeStartVal = currentVal;
    this.surgePeakVal = peakVal;
    this.surgeAttackSec = attackSec;
    this.surgeHoldSec = holdSec;
    this.surgeDecayTau = decayTau;
  }

  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      this.unlock();
    }
    if (this.ctx && this.ctx.state === 'suspended' && this.unlocked) {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private playOrganNote(
    freq: number,
    startTime: number,
    duration: number,
    detuneCents: number = 0,
    gainScale: number = 1.0
  ): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const noteGain = ctx.createGain();
    const peak = 0.60 * gainScale;
    noteGain.gain.setValueAtTime(0.001, startTime);
    noteGain.gain.linearRampToValueAtTime(peak, startTime + 0.025);
    noteGain.gain.setValueAtTime(peak * 0.85, startTime + Math.max(0.03, duration - 0.05));
    noteGain.gain.exponentialRampToValueAtTime(0.0008, startTime + duration);
    noteGain.connect(this.organGain ?? this.masterGain);

    // 8' fundamental (triangle/sawtooth blend), 4' octave (sine), 2' super-octave (square low)
    const partials: { ratio: number; type: OscillatorType; weight: number }[] = [
      { ratio: 1, type: 'sawtooth', weight: 0.45 },
      { ratio: 2, type: 'sine', weight: 0.35 },
      { ratio: 3, type: 'triangle', weight: 0.12 },
      { ratio: 4, type: 'sine', weight: 0.15 },
    ];

    for (const p of partials) {
      const osc = ctx.createOscillator();
      const pGain = ctx.createGain();
      osc.type = p.type;
      osc.frequency.setValueAtTime(freq * p.ratio, startTime);
      osc.detune.setValueAtTime(detuneCents, startTime);
      pGain.gain.value = p.weight;
      osc.connect(pGain);
      pGain.connect(noteGain);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.02);
    }
  }

  public playSong(songId: SongId, cueHit: boolean, stale: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + 0.01;
    const detune = stale ? -35 : cueHit ? 8 : 0;
    const gainScale = stale ? 0.65 : cueHit ? 1.15 : 0.95;

    let sequence: NoteStep[] = [];

    if (songId === 'charge') {
      // Classic Stadium "da-da-da-DA-da-DA!" fanfare in G major / C major
      sequence = [
        { freq: 392.0, durationSec: 0.14, delaySec: 0.0 }, // G4
        { freq: 523.25, durationSec: 0.14, delaySec: 0.15 }, // C5
        { freq: 659.25, durationSec: 0.14, delaySec: 0.30 }, // E5
        { freq: 783.99, durationSec: 0.28, delaySec: 0.45, chord: [523.25, 659.25] }, // G5
        { freq: 659.25, durationSec: 0.16, delaySec: 0.76 }, // E5
        { freq: 783.99, durationSec: 0.65, delaySec: 0.95, chord: [523.25, 659.25, 1046.5] }, // G5 + C6
      ];
    } else if (songId === 'hold_the_line') {
      // Rhythmic defensive chant ("DE-FENSE! *clap clap* DE-FENSE!")
      sequence = [
        { freq: 293.66, durationSec: 0.26, delaySec: 0.0, chord: [440.0, 587.33] }, // D4 power
        { freq: 261.63, durationSec: 0.32, delaySec: 0.30, chord: [392.0, 523.25] }, // C4 power
        { freq: 349.23, durationSec: 0.18, delaySec: 0.72, chord: [523.25] }, // F4
        { freq: 392.0, durationSec: 0.18, delaySec: 0.94, chord: [587.33] }, // G4
        { freq: 293.66, durationSec: 0.48, delaySec: 1.16, chord: [440.0, 587.33] }, // D4 resolve
      ];
    } else if (songId === 'grudge_toccata') {
      // Grudge Toccata: Bach-style D minor dramatic chromatic motif
      sequence = [
        { freq: 587.33, durationSec: 0.11, delaySec: 0.0 }, // D5
        { freq: 554.37, durationSec: 0.11, delaySec: 0.11 }, // C#5
        { freq: 587.33, durationSec: 0.32, delaySec: 0.22, chord: [293.66] }, // D5
        { freq: 523.25, durationSec: 0.13, delaySec: 0.58 }, // C5
        { freq: 466.16, durationSec: 0.13, delaySec: 0.71 }, // Bb4
        { freq: 440.0, durationSec: 0.13, delaySec: 0.84 }, // A4
        { freq: 392.0, durationSec: 0.13, delaySec: 0.97 }, // G4
        { freq: 369.99, durationSec: 0.16, delaySec: 1.10 }, // F#4
        { freq: 392.0, durationSec: 0.50, delaySec: 1.27, chord: [293.66, 466.16, 587.33] }, // Gm/D minor slam
      ];
    } else if (songId === 'power_play_polka') {
      // Power Play Polka: Upbeat stadium oom-pah polka in F major
      sequence = [
        { freq: 174.61, durationSec: 0.13, delaySec: 0.0, chord: [349.23] }, // F3 oom
        { freq: 523.25, durationSec: 0.12, delaySec: 0.15, chord: [349.23, 440.0] }, // C5 pah
        { freq: 261.63, durationSec: 0.13, delaySec: 0.30, chord: [349.23] }, // C4 oom
        { freq: 587.33, durationSec: 0.12, delaySec: 0.45, chord: [349.23, 466.16] }, // D5 pah
        { freq: 174.61, durationSec: 0.13, delaySec: 0.60, chord: [349.23] }, // F3 oom
        { freq: 659.25, durationSec: 0.12, delaySec: 0.75, chord: [392.0, 523.25] }, // E5 pah
        { freq: 698.46, durationSec: 0.45, delaySec: 0.92, chord: [349.23, 440.0, 523.25] }, // F5 polka triumph!
      ];
    } else if (songId === 'kill_the_clock') {
      // Kill the Clock: Ticking clockwork staccato organ ostinato in A minor
      sequence = [
        { freq: 440.0, durationSec: 0.11, delaySec: 0.0, chord: [220.0] }, // A4 tick
        { freq: 329.63, durationSec: 0.11, delaySec: 0.18 }, // E4 tock
        { freq: 440.0, durationSec: 0.11, delaySec: 0.36, chord: [220.0] }, // A4 tick
        { freq: 329.63, durationSec: 0.11, delaySec: 0.54 }, // E4 tock
        { freq: 466.16, durationSec: 0.11, delaySec: 0.72, chord: [233.08] }, // Bb4 tick
        { freq: 329.63, durationSec: 0.11, delaySec: 0.90 }, // E4 tock
        { freq: 440.0, durationSec: 0.42, delaySec: 1.08, chord: [220.0, 329.63, 523.25] }, // Am lockdown chord
      ];
    } else if (songId === 'madeyalook') {
      // Madeyalook: Taunting "Nyah-nyah-nyah-nyah-nyah-nyah!" goalie distraction motif
      sequence = [
        { freq: 783.99, durationSec: 0.16, delaySec: 0.0, chord: [392.0] }, // G5 "Made"
        { freq: 659.25, durationSec: 0.16, delaySec: 0.18, chord: [329.63] }, // E5 "ya"
        { freq: 880.0, durationSec: 0.24, delaySec: 0.36, chord: [440.0, 523.25] }, // A5 "look!"
        { freq: 783.99, durationSec: 0.15, delaySec: 0.64, chord: [392.0] }, // G5
        { freq: 659.25, durationSec: 0.15, delaySec: 0.81, chord: [329.63] }, // E5
        { freq: 523.25, durationSec: 0.48, delaySec: 0.98, chord: [261.63, 329.63, 392.0] }, // C5 raspberry resolve
      ];
    } else if (songId === 'underdog_draw') {
      // Underdog Draw: Fast ascending rally call
      sequence = [
        { freq: 466.16, durationSec: 0.12, delaySec: 0.0 }, // Bb4
        { freq: 587.33, durationSec: 0.12, delaySec: 0.13 }, // D5
        { freq: 698.46, durationSec: 0.12, delaySec: 0.26 }, // F5
        { freq: 932.33, durationSec: 0.40, delaySec: 0.39, chord: [466.16, 587.33] }, // Bb5 triumph!
      ];
    } else if (songId === 'second_wind') {
      // Second Wind: Soothing uplifting waltz arpeggio
      sequence = [
        { freq: 329.63, durationSec: 0.22, delaySec: 0.0, chord: [164.81] }, // E4
        { freq: 440.0, durationSec: 0.22, delaySec: 0.22 }, // A4
        { freq: 554.37, durationSec: 0.22, delaySec: 0.44 }, // C#5
        { freq: 659.25, durationSec: 0.50, delaySec: 0.66, chord: [220.0, 329.63] }, // E5 oxygen restore
      ];
    } else if (songId === 'tic_tac_toe') {
      // Tic-Tac-Toe: Rapid bouncy 3-note passing cadence
      sequence = [
        { freq: 523.25, durationSec: 0.12, delaySec: 0.0, chord: [261.63] }, // C5 (tic)
        { freq: 659.25, durationSec: 0.12, delaySec: 0.16, chord: [329.63] }, // E5 (tac)
        { freq: 783.99, durationSec: 0.35, delaySec: 0.32, chord: [392.0, 523.25, 1046.5] }, // G5 (toe - one timer!)
      ];
    } else if (songId === 'the_fortress') {
      // The Fortress: Resonant Cathedral power chord (glove catch lockdown)
      sequence = [
        { freq: 261.63, durationSec: 0.70, delaySec: 0.0, chord: [130.81, 196.0, 392.0, 523.25] }, // Grand C minor anchor
        { freq: 392.0, durationSec: 0.60, delaySec: 0.72, chord: [196.0, 311.13, 622.25] }, // Eb minor resolve
      ];
    } else if (songId === 'sirens_waltz') {
      // Siren's Waltz: Eerie descending chromatic whole-tone trill
      sequence = [
        { freq: 740.0, durationSec: 0.18, delaySec: 0.0 }, // F#5
        { freq: 659.25, durationSec: 0.18, delaySec: 0.18 }, // E5
        { freq: 587.33, durationSec: 0.18, delaySec: 0.36 }, // D5
        { freq: 523.25, durationSec: 0.45, delaySec: 0.54, chord: [261.63, 369.99] }, // C5 tritone bewitchment!
      ];
    } else if (songId === 'overtime_overture') {
      // Overtime Overture: Dramatic accelerating staccato gallop
      sequence = [
        { freq: 293.66, durationSec: 0.10, delaySec: 0.0, chord: [146.83] }, // D4
        { freq: 349.23, durationSec: 0.10, delaySec: 0.12 }, // F4
        { freq: 440.0, durationSec: 0.10, delaySec: 0.24 }, // A4
        { freq: 587.33, durationSec: 0.10, delaySec: 0.36 }, // D5
        { freq: 698.46, durationSec: 0.12, delaySec: 0.48 }, // F5
        { freq: 880.0, durationSec: 0.45, delaySec: 0.62, chord: [293.66, 440.0, 587.33] }, // D5 climax
      ];
    }

    for (const step of sequence) {
      const chordCount = step.chord ? step.chord.length : 0;
      const chordWeight = 0.55;
      const polyNorm = 1 / Math.sqrt(1 + chordCount * chordWeight * chordWeight * 0.85);
      this.playOrganNote(
        step.freq,
        now + step.delaySec,
        step.durationSec,
        detune,
        gainScale * polyNorm
      );
      if (step.chord) {
        step.chord.forEach((cFreq, idx) => {
          // 1.5ms micro-humanize stagger avoids constructive phase-0 crest spikes on dense chords
          const voiceOffset = (idx + 1) * 0.0015;
          this.playOrganNote(
            cFreq,
            now + step.delaySec + voiceOffset,
            Math.max(0.05, step.durationSec - voiceOffset),
            detune + (idx % 2 === 0 ? 1.5 : -1.5),
            gainScale * chordWeight * polyNorm
          );
        });
      }
    }
  }

  private playNoiseTransient(
    ctx: AudioContext,
    dest: AudioNode,
    startTime: number,
    duration: number,
    filterFreq: number,
    peakGain: number
  ): void {
    const sampleRate = ctx.sampleRate || 44100;
    const length = Math.max(1, Math.floor(sampleRate * duration));
    const noiseBuffer = ctx.createBuffer(1, length, sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, startTime);
    filter.Q.setValueAtTime(1.8, startTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(dest);

    source.start(startTime);
    source.stop(startTime + duration + 0.01);
  }

  public playGoalHorn(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const dest = this.sfxGain ?? this.masterGain ?? ctx.destination;

    const now = ctx.currentTime + 0.01;
    // Deep brass stadium foghorn blast (two pulses, matched to organ loudness)
    const freqs = [116.54, 146.83, 233.08]; // Bb2 + D3 + Bb3
    for (const pulseOffset of [0, 0.55]) {
      const dur = pulseOffset === 0 ? 0.45 : 0.85;
      const start = now + pulseOffset;
      const hornGain = ctx.createGain();
      hornGain.gain.setValueAtTime(0.001, start);
      hornGain.gain.linearRampToValueAtTime(0.29, start + 0.03);
      hornGain.gain.setValueAtTime(0.27, start + dur - 0.08);
      hornGain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      hornGain.connect(dest);

      for (const f of freqs) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f, start);
        osc.connect(hornGain);
        osc.start(start);
        osc.stop(start + dur + 0.02);
      }
    }
  }

  public playWhistle(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const dest = this.sfxGain ?? this.masterGain ?? ctx.destination;

    const now = ctx.currentTime + 0.005;
    const dur = 0.28;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.30, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    gain.connect(dest);

    // Referee pea-whistle warble around 2850 Hz
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2850, now);
    lfo.frequency.setValueAtTime(42, now);
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    osc.connect(gain);

    osc.start(now);
    lfo.start(now);
    osc.stop(now + dur + 0.02);
    lfo.stop(now + dur + 0.02);
  }

  private playImpulseClick(
    ctx: AudioContext,
    dest: AudioNode,
    startTime: number,
    freq: number,
    durationSec: number,
    gain: number,
    q: number = 3.0
  ): void {
    const sampleRate = ctx.sampleRate || 44100;
    const length = Math.max(1, Math.floor(sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    // Ultra-snappy acoustic transient impulse (instantaneous spike + exponential decay)
    const decayConst = 1 / (durationSec * 0.22);
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const decay = Math.exp(-t * decayConst);
      // Sharp initial impulse spike for first 3 samples followed by rapid decay
      const spike = i === 0 ? 1.0 : i === 1 ? -0.7 : i === 2 ? 0.35 : 0;
      const noise = (Math.random() * 2 - 1) * 0.85;
      data[i] = (spike * 0.65 + noise * 0.35) * decay;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Fixed resonant bandpass filter (blade acoustic resonance — NO sweeping pitch!)
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, startTime);
    filter.Q.setValueAtTime(q, startTime);

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(gain, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(dest);

    source.start(startTime);
    source.stop(startTime + durationSec + 0.005);
  }

  public playPuckClick(type: 'pass' | 'shot' | 'steal'): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const dest = this.sfxGain ?? this.masterGain ?? ctx.destination;

    const now = ctx.currentTime + 0.001;
    const jitter = 0.94 + Math.random() * 0.12;

    if (type === 'shot') {
      // Slap shot / hard wrist shot: sharp, high-velocity stick-on-puck crack
      // 1. Ice contact pre-click (3ms before puck strike)
      this.playImpulseClick(ctx, dest, now, 2400 * jitter, 0.014, 0.55, 2.2);
      // 2. Main composite blade strike crack (instantaneous, sharp crack!)
      this.playImpulseClick(ctx, dest, now + 0.002, 3400 * jitter, 0.020, 0.95, 3.2);
      // 3. High blade snap transient
      this.playImpulseClick(ctx, dest, now + 0.002, 4800 * jitter, 0.012, 0.70, 2.8);
      // 4. Solid vulcanized rubber body pop (tight, fixed frequency — not a sweeping bloop)
      this.playImpulseClick(ctx, dest, now + 0.003, 1350 * jitter, 0.016, 0.75, 2.0);
    } else if (type === 'pass') {
      // Tape-on-puck pass / trap click: clean, dry, crisp acoustic pop (12ms)
      this.playImpulseClick(ctx, dest, now, 3100 * jitter, 0.011, 0.85, 3.0);
      this.playImpulseClick(ctx, dest, now, 1800 * jitter, 0.014, 0.65, 2.5);
    } else {
      // Steal / poke check: blade-on-stick clash (two rapid sharp carbon fiber clicks)
      this.playImpulseClick(ctx, dest, now, 3800 * jitter, 0.009, 0.88, 3.8);
      this.playImpulseClick(ctx, dest, now + 0.008, 4400 * jitter, 0.009, 0.75, 4.0);
    }
  }

  /**
   * Synthesizes the iconic resonant metallic goalpost / crossbar 'PING!':
   * Dual tuned high-Q resonant ringing modes (~2950 Hz & ~4180 Hz) with an instantaneous hard transient impact.
   */
  public playPostPing(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const dest = this.sfxGain ?? this.masterGain ?? ctx.destination;
    const now = ctx.currentTime + 0.001;
    const jitter = 0.98 + Math.random() * 0.04;

    // 1. Initial puck-on-steel strike transient clicks
    this.playImpulseClick(ctx, dest, now, 5200 * jitter, 0.015, 0.95, 3.5);
    this.playImpulseClick(ctx, dest, now + 0.001, 3800 * jitter, 0.020, 0.85, 3.0);

    // 2. High-resonance dual-mode metallic ringing sine oscillators with exponential decay
    const modes = [
      { freq: 2950 * jitter, gain: 0.65, decaySec: 0.52 },
      { freq: 4180 * jitter, gain: 0.40, decaySec: 0.42 },
      { freq: 980 * jitter, gain: 0.28, decaySec: 0.32 },
    ];

    for (const m of modes) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(m.freq, now);

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(m.gain, now);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + m.decaySec);

      osc.connect(gainNode);
      gainNode.connect(dest);

      osc.start(now);
      osc.stop(now + m.decaySec + 0.01);
    }
  }

  /**
   * Synthesizes a heavy goalie pad rebound save:
   * Dampened surface slap (synthetic leather / composite) coupled with a deep low-frequency pad body thump.
   */
  public playPadSaveThud(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const dest = this.sfxGain ?? this.masterGain ?? ctx.destination;
    const now = ctx.currentTime + 0.001;
    const jitter = 0.95 + Math.random() * 0.10;

    // Surface pad slap
    this.playImpulseClick(ctx, dest, now, 1600 * jitter, 0.025, 0.95, 2.0);
    this.playImpulseClick(ctx, dest, now + 0.002, 2800 * jitter, 0.015, 0.70, 2.5);

    // Low-end pad body thud
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(125 * jitter, now);
    osc.frequency.exponentialRampToValueAtTime(55 * jitter, now + 0.09);

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.85, now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);

    osc.connect(gainNode);
    gainNode.connect(dest);

    osc.start(now);
    osc.stop(now + 0.12);
  }

  /**
   * Synthesizes a crisp goalie glove pocket snatch / catch snap:
   * Sharp leather pocket click into rapid acoustic deadening.
   */
  public playGloveCatchSnap(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const dest = this.sfxGain ?? this.masterGain ?? ctx.destination;
    const now = ctx.currentTime + 0.001;
    const jitter = 0.95 + Math.random() * 0.10;

    this.playImpulseClick(ctx, dest, now, 2800 * jitter, 0.012, 0.98, 3.2);
    this.playImpulseClick(ctx, dest, now + 0.003, 1950 * jitter, 0.020, 0.85, 2.5);
    this.playImpulseClick(ctx, dest, now + 0.005, 340 * jitter, 0.028, 0.60, 1.8);
  }

  /**
   * Synthesizes a collective disappointed arena crowd groan ('OHHHH!'):
   * Descending vocal formant filter sweep with pink noise.
   */
  public triggerCrowdGroan(): void {
    if (!this.unlocked) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const dest = this.masterGain ?? ctx.destination;
    const now = ctx.currentTime;

    const durationSec = 0.65;
    const sampleRate = ctx.sampleRate || 44100;
    const length = Math.floor(sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.0990460;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.18;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Formant filter: sweeps from 620 Hz down to 360 Hz (authentic crowd 'Oooh...' drop)
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(620, now);
    filter.frequency.exponentialRampToValueAtTime(360, now + durationSec);
    filter.Q.setValueAtTime(3.2, now);

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.001, now);
    gainNode.gain.linearRampToValueAtTime(0.38, now + 0.10);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(dest);

    source.start(now);
    source.stop(now + durationSec + 0.02);
  }

  public triggerCrowdCheer(): void {
    this.triggerCrowdSurge('shot');
  }

  public playFightImpact(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const dest = this.sfxGain ?? this.masterGain ?? ctx.destination;

    const now = ctx.currentTime + 0.003;
    const pitchVar = 0.88 + Math.random() * 0.24;
    const isDouble = Math.random() < 0.38;
    const punches = isDouble ? [0, 0.09 + Math.random() * 0.05] : [0];

    for (const offset of punches) {
      const pStart = now + offset;
      const dur = 0.14;

      // Heavy visceral punch thud
      const thudGain = ctx.createGain();
      thudGain.gain.setValueAtTime(0.001, pStart);
      thudGain.gain.linearRampToValueAtTime(0.68, pStart + 0.012);
      thudGain.gain.exponentialRampToValueAtTime(0.001, pStart + dur);
      thudGain.connect(dest);

      const thudOsc = ctx.createOscillator();
      thudOsc.type = 'triangle';
      thudOsc.frequency.setValueAtTime(210 * pitchVar, pStart);
      thudOsc.frequency.exponentialRampToValueAtTime(40, pStart + dur);
      thudOsc.connect(thudGain);
      thudOsc.start(pStart);
      thudOsc.stop(pStart + dur + 0.02);

      // Punch slap / glove crack
      const slapGain = ctx.createGain();
      slapGain.gain.setValueAtTime(0.001, pStart);
      slapGain.gain.linearRampToValueAtTime(0.52, pStart + 0.005);
      slapGain.gain.exponentialRampToValueAtTime(0.001, pStart + 0.045);
      slapGain.connect(dest);

      const slapOsc = ctx.createOscillator();
      slapOsc.type = 'sawtooth';
      slapOsc.frequency.setValueAtTime(950 * pitchVar, pStart);
      slapOsc.frequency.exponentialRampToValueAtTime(140, pStart + 0.045);
      slapOsc.connect(slapGain);
      slapOsc.start(pStart);
      slapOsc.stop(pStart + 0.055);

      // Meat impact crunch
      this.playNoiseTransient(ctx, dest, pStart, 0.038, 1400, 0.52);
    }
  }

  public playPenaltyWhistle(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const dest = this.sfxGain ?? this.masterGain ?? ctx.destination;

    const now = ctx.currentTime + 0.005;
    // Distinct double-burst referee blast for penalties
    const bursts = [
      { start: now, dur: 0.11, freq: 2750 },
      { start: now + 0.15, dur: 0.25, freq: 3100 },
    ];

    for (const b of bursts) {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, b.start);
      gain.gain.linearRampToValueAtTime(0.28, b.start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, b.start + b.dur);
      gain.connect(dest);

      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(b.freq, b.start);
      lfo.frequency.setValueAtTime(45, b.start);
      lfoGain.gain.value = 180;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      osc.connect(gain);

      osc.start(b.start);
      lfo.start(b.start);
      osc.stop(b.start + b.dur + 0.02);
      lfo.stop(b.start + b.dur + 0.02);
    }
  }

  public playPeriodBuzzer(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const dest = this.sfxGain ?? this.masterGain ?? ctx.destination;

    const now = ctx.currentTime + 0.008;
    const dur = 2.5; // Full 2.5 second arena horn buzzer blast (matched to organ loudness)

    const buzzerGain = ctx.createGain();
    buzzerGain.gain.setValueAtTime(0.001, now);
    buzzerGain.gain.linearRampToValueAtTime(0.21, now + 0.03);
    buzzerGain.gain.setValueAtTime(0.195, now + dur - 0.15);
    buzzerGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    buzzerGain.connect(dest);

    // Resonant lowpass arena horn filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(920, now);
    filter.Q.setValueAtTime(2.2, now);
    filter.connect(buzzerGain);

    // Thick 5-oscillator detuned harmonic buzzer chord
    const freqs = [128, 131.5, 256, 263, 384];
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, now);
      osc.connect(filter);
      osc.start(now);
      osc.stop(now + dur + 0.04);
    }
  }
}
