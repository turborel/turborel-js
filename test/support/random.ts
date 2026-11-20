/**
 * A case generator of a fixed seed, so every run makes the same cases
 * (RULES.md R-TEST-5): xorshift32, shared by the test files that make
 * cases (R-TEST-7).
 */

/** Numbers drawn from a fixed seed, the same on every run. */
export class Cases {
  private state: number;

  /** @param seed - the seed, not 0 */
  constructor(seed: number) {
    this.state = seed >>> 0 === 0 ? 1 : seed >>> 0;
  }

  /** @returns the next 32-bit number */
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  /**
   * A number from 0 to `n` - 1.
   *
   * @param n - how many it may be
   * @returns it
   */
  below(n: number): number {
    return this.next() % n;
  }

  /**
   * `n` octets.
   *
   * @param n - how many
   * @returns them
   */
  bytes(n: number): Uint8Array {
    return Uint8Array.from({ length: n }, () => this.below(256));
  }

  /**
   * `bytes` changed in one place: a byte flipped, one taken out, one put in, or the end cut off.
   *
   * @param bytes - the original
   * @returns a copy, changed
   */
  mutate(bytes: Uint8Array): Uint8Array {
    const at = this.below(bytes.byteLength + 1);
    switch (this.below(4)) {
      case 0: {
        const copy = Uint8Array.from(bytes);
        if (at < copy.byteLength) copy[at] = (copy[at] ?? 0) ^ (1 << this.below(8));
        return copy;
      }
      case 1:
        return Uint8Array.from([...bytes.subarray(0, at), ...bytes.subarray(at + 1)]);
      case 2:
        return Uint8Array.from([...bytes.subarray(0, at), this.below(256), ...bytes.subarray(at)]);
      default:
        return bytes.slice(0, at);
    }
  }
}
