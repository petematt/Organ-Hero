export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export class SeededRNG {
  private state: number;
  public readonly initialSeed: number;

  constructor(seed: number = 1337) {
    this.initialSeed = seed >>> 0;
    this.state = this.initialSeed || 1;
  }

  /**
   * Returns a uniform float in [0, 1) using mulberry32.
   */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Returns a uniform float in [min, max).
   */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Returns -1 or +1 with 50/50 probability.
   */
  sign(): -1 | 1 {
    return this.next() < 0.5 ? -1 : 1;
  }

  /**
   * Corrected "Roll against X":
   * Picks a uniform random number in [0, 1) and returns true if < clamp(x, 0, 1).
   */
  rollAgainst(x: number): boolean {
    const threshold = clamp(x, 0, 1);
    if (threshold <= 0) return false;
    if (threshold >= 1) return true;
    return this.next() < threshold;
  }
}
