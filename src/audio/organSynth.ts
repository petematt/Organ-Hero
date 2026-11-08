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
  private unlocked: boolean = false;

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
        this.masterGain.gain.value = 0.28;
        this.masterGain.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      this.unlocked = true;
    } catch {
      // AudioContext blocked or unsupported
    }
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
    const peak = 0.22 * gainScale;
    noteGain.gain.setValueAtTime(0.001, startTime);
    noteGain.gain.linearRampToValueAtTime(peak, startTime + 0.025);
    noteGain.gain.setValueAtTime(peak * 0.85, startTime + Math.max(0.03, duration - 0.05));
    noteGain.gain.exponentialRampToValueAtTime(0.0008, startTime + duration);
    noteGain.connect(this.masterGain);

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
    } else {
      // Madeyalook: Taunting "Nyah-nyah-nyah-nyah-nyah-nyah!" goalie distraction motif
      sequence = [
        { freq: 783.99, durationSec: 0.16, delaySec: 0.0, chord: [392.0] }, // G5 "Made"
        { freq: 659.25, durationSec: 0.16, delaySec: 0.18, chord: [329.63] }, // E5 "ya"
        { freq: 880.0, durationSec: 0.24, delaySec: 0.36, chord: [440.0, 523.25] }, // A5 "look!"
        { freq: 783.99, durationSec: 0.15, delaySec: 0.64, chord: [392.0] }, // G5
        { freq: 659.25, durationSec: 0.15, delaySec: 0.81, chord: [329.63] }, // E5
        { freq: 523.25, durationSec: 0.48, delaySec: 0.98, chord: [261.63, 329.63, 392.0] }, // C5 raspberry resolve
      ];
    }

    for (const step of sequence) {
      this.playOrganNote(
        step.freq,
        now + step.delaySec,
        step.durationSec,
        detune,
        gainScale
      );
      if (step.chord) {
        for (const cFreq of step.chord) {
          this.playOrganNote(
            cFreq,
            now + step.delaySec,
            step.durationSec,
            detune,
            gainScale * 0.65
          );
        }
      }
    }
  }

  public playGoalHorn(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime + 0.01;
    // Deep brass stadium foghorn blast (two pulses)
    const freqs = [116.54, 146.83, 233.08]; // Bb2 + D3 + Bb3
    for (const pulseOffset of [0, 0.55]) {
      const dur = pulseOffset === 0 ? 0.45 : 0.75;
      const start = now + pulseOffset;
      const hornGain = ctx.createGain();
      hornGain.gain.setValueAtTime(0.001, start);
      hornGain.gain.linearRampToValueAtTime(0.32, start + 0.03);
      hornGain.gain.setValueAtTime(0.28, start + dur - 0.08);
      hornGain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      hornGain.connect(this.masterGain);

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
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime + 0.01;
    const dur = 0.28;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    gain.connect(this.masterGain);

    // Referee pea-whistle warble around 2800 Hz
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2850, now);
    lfo.frequency.setValueAtTime(42, now);
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    osc.connect(gain);

    osc.start(now);
    lfo.start(now);
    osc.stop(now + dur + 0.02);
    lfo.stop(now + dur + 0.02);
  }
}
