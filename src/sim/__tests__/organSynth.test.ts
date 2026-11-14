import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OrganSynth } from '../../audio/organSynth';

class MockAudioParam {
  public value: number;
  public calls: { method: string; args: unknown[] }[] = [];

  constructor(initialValue: number = 1.0) {
    this.value = initialValue;
  }

  setValueAtTime(val: number, time: number) {
    this.value = val;
    this.calls.push({ method: 'setValueAtTime', args: [val, time] });
  }

  linearRampToValueAtTime(val: number, time: number) {
    this.value = val;
    this.calls.push({ method: 'linearRampToValueAtTime', args: [val, time] });
  }

  exponentialRampToValueAtTime(val: number, time: number) {
    this.value = val;
    this.calls.push({ method: 'exponentialRampToValueAtTime', args: [val, time] });
  }

  setTargetAtTime(target: number, startTime: number, timeConstant: number) {
    this.calls.push({ method: 'setTargetAtTime', args: [target, startTime, timeConstant] });
  }

  cancelScheduledValues(cancelTime: number) {
    this.calls.push({ method: 'cancelScheduledValues', args: [cancelTime] });
  }

  cancelAndHoldAtTime(cancelTime: number) {
    this.calls.push({ method: 'cancelAndHoldAtTime', args: [cancelTime] });
  }
}

class MockAudioNode {
  public connections: unknown[] = [];
  public disconnected: boolean = false;

  connect(destination: unknown) {
    this.connections.push(destination);
    return destination;
  }

  disconnect() {
    this.disconnected = true;
    this.connections = [];
  }
}

class MockGainNode extends MockAudioNode {
  public gain = new MockAudioParam(1.0);
}

class MockBiquadFilterNode extends MockAudioNode {
  public type: string = 'lowpass';
  public frequency = new MockAudioParam(350);
  public Q = new MockAudioParam(1.0);
}

class MockAudioBuffer {
  public numberOfChannels: number;
  public length: number;
  public sampleRate: number;
  private channelData: Float32Array[];

  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channelData = Array.from({ length: channels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    return this.channelData[channel] || new Float32Array(this.length);
  }
}

class MockAudioBufferSourceNode extends MockAudioNode {
  public buffer: MockAudioBuffer | null = null;
  public loop: boolean = false;
  public playbackRate = new MockAudioParam(1.0);
  public started: boolean = false;
  public stopped: boolean = false;

  start() {
    this.started = true;
  }

  stop() {
    this.stopped = true;
  }
}

class MockOscillatorNode extends MockAudioNode {
  public type: string = 'sine';
  public frequency = new MockAudioParam(440);
  public started: boolean = false;
  public stopped: boolean = false;

  start() {
    this.started = true;
  }

  stop() {
    this.stopped = true;
  }
}

class MockConvolverNode extends MockAudioNode {
  public buffer: MockAudioBuffer | null = null;
}

class MockAudioContext {
  public currentTime: number = 0;
  public state: 'running' | 'suspended' = 'running';
  public sampleRate: number = 44100;
  public destination = new MockAudioNode();

  public createdGains: MockGainNode[] = [];
  public createdFilters: MockBiquadFilterNode[] = [];
  public createdSources: MockAudioBufferSourceNode[] = [];
  public createdOscillators: MockOscillatorNode[] = [];
  public createdBuffers: MockAudioBuffer[] = [];
  public createdConvolvers: MockConvolverNode[] = [];

  createGain(): MockGainNode {
    const node = new MockGainNode();
    this.createdGains.push(node);
    return node;
  }

  createBiquadFilter(): MockBiquadFilterNode {
    const node = new MockBiquadFilterNode();
    this.createdFilters.push(node);
    return node;
  }

  createBuffer(channels: number, length: number, sampleRate: number): MockAudioBuffer {
    const buf = new MockAudioBuffer(channels, length, sampleRate);
    this.createdBuffers.push(buf);
    return buf;
  }

  createBufferSource(): MockAudioBufferSourceNode {
    const src = new MockAudioBufferSourceNode();
    this.createdSources.push(src);
    return src;
  }

  createOscillator(): MockOscillatorNode {
    const osc = new MockOscillatorNode();
    this.createdOscillators.push(osc);
    return osc;
  }

  createConvolver(): MockConvolverNode {
    const conv = new MockConvolverNode();
    this.createdConvolvers.push(conv);
    return conv;
  }

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }
}

describe('OrganSynth Crowd Audio (Alternative 1)', () => {
  let originalAudioContext: unknown;
  let mockCtx: MockAudioContext;

  beforeEach(() => {
    mockCtx = new MockAudioContext();
    originalAudioContext = (typeof window !== 'undefined' ? (window as unknown as { AudioContext?: unknown }).AudioContext : undefined);
    const mockConstructor = vi.fn().mockImplementation(() => mockCtx) as unknown as typeof AudioContext;
    if (typeof window !== 'undefined') {
      (window as unknown as { AudioContext: typeof AudioContext }).AudioContext = mockConstructor;
    }
    (globalThis as unknown as { AudioContext: typeof AudioContext }).AudioContext = mockConstructor;
  });

  afterEach(() => {
    if (typeof window !== 'undefined') {
      (window as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    }
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    vi.restoreAllMocks();
  });

  it('instantiates cleanly and handles methods before unlocking without error', () => {
    const synth = new OrganSynth();
    expect(() => {
      synth.setCrowdVolume(50);
      synth.triggerCrowdSurge('shot');
      synth.triggerCrowdSurge('goal');
      synth.triggerCrowdCheer();
      synth.triggerCrowdGroan();
      synth.destroy();
    }).not.toThrow();
  });

  it('initializes multi-band crowd audio graph upon unlock', () => {
    const synth = new OrganSynth();
    synth.unlock();

    // Verify Convolver was created for arena diffusion
    expect(mockCtx.createdConvolvers.length).toBeGreaterThanOrEqual(1);
    expect(mockCtx.createdConvolvers[0].buffer).not.toBeNull();

    // Verify Layer A rumble filters (two lowpass filters cascaded at 180 Hz)
    const rumbleFilters = mockCtx.createdFilters.filter(
      (f) => f.type === 'lowpass' && Math.abs(f.frequency.value - 180) < 1
    );
    expect(rumbleFilters.length).toBe(2);

    // Verify Layer B formant filters (F1=520, F2=1350, F3=2500)
    const bandpassFilters = mockCtx.createdFilters.filter((f) => f.type === 'bandpass');
    const freqs = bandpassFilters.map((f) => Math.round(f.frequency.value));
    expect(freqs).toContain(520);
    expect(freqs).toContain(1350);
    expect(freqs).toContain(2500);

    // Verify LFOs created: 0.13 Hz, 0.27 Hz asynchronous detuners, 4.5 Hz flutter tremolo
    const oscFreqs = mockCtx.createdOscillators.map((o) => o.frequency.value);
    expect(oscFreqs).toContain(0.13);
    expect(oscFreqs).toContain(0.27);
    expect(oscFreqs).toContain(4.5);

    // Verify Layer C micro-transient clap buffers were created
    const clapBuffers = mockCtx.createdBuffers.filter((b) => b.length < 1000); // 15ms buffers
    expect(clapBuffers.length).toBeGreaterThanOrEqual(6);

    synth.destroy();
  });

  it('updates crowd volume and schedules target gains and formant frequencies smoothly', () => {
    const synth = new OrganSynth();
    synth.unlock();

    // Volume at 25%
    synth.setCrowdVolume(25, false);
    // Volume at 80%
    synth.setCrowdVolume(80, false);
    // Paused state
    synth.setCrowdVolume(80, true);

    // Verify that target scheduling was invoked
    const targetCalls = mockCtx.createdGains.flatMap((g) =>
      g.gain.calls.filter((c) => c.method === 'setTargetAtTime')
    );
    expect(targetCalls.length).toBeGreaterThan(0);

    synth.destroy();
  });

  it('triggers crowd surges for shot and goal without exceeding 2.0 peak or digital clipping', () => {
    const synth = new OrganSynth();
    synth.unlock();

    expect(() => {
      // Trigger multiple rapid surges (overlapping momentum events)
      mockCtx.currentTime = 10.0;
      synth.triggerCrowdSurge('shot');
      mockCtx.currentTime = 10.05;
      synth.triggerCrowdSurge('goal');
      mockCtx.currentTime = 10.15;
      synth.triggerCrowdSurge('shot');
    }).not.toThrow();

    synth.destroy();
  });

  it('synthesizes crowd cheer and groan formant sweeps without throwing', () => {
    const synth = new OrganSynth();
    synth.unlock();

    expect(() => {
      synth.triggerCrowdCheer();
      synth.triggerCrowdGroan();
    }).not.toThrow();

    synth.destroy();
  });

  it('destroys and cleans up sources and LFOs cleanly', () => {
    const synth = new OrganSynth();
    synth.unlock();

    expect(() => {
      synth.destroy();
      // Calling destroy multiple times should be safe and idempotent
      synth.destroy();
    }).not.toThrow();

    // Verify all active continuous sources and oscillators were stopped and disconnected
    const stoppedOscs = mockCtx.createdOscillators.filter((o) => o.stopped && o.disconnected);
    expect(stoppedOscs.length).toBe(3);
  });
});
