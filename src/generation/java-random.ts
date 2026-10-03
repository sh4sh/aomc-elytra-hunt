// java.util.Random. The 48-bit LCG state needs BigInt: seed * multiplier overflows 2^53.

const MULT = 0x5deece66dn;
const ADD = 0xbn;
const MASK = (1n << 48n) - 1n;

export class JavaRandom {
  private seed: bigint;

  constructor(seed: bigint) {
    this.seed = (seed ^ MULT) & MASK;
  }

  next(bits: number): number {
    this.seed = (this.seed * MULT + ADD) & MASK;
    return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)));
  }

  nextInt(bound: number): number {
    const m = bound - 1;
    if ((m & bound) === 0) {
      return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    }
    let bits: number, val: number;
    do {
      bits = this.next(31);
      val = bits % bound;
    } while (((bits - val + m) | 0) < 0);
    return val;
  }

  nextLong(): bigint {
    return BigInt.asIntN(64, (BigInt(this.next(32)) << 32n) + BigInt(this.next(32)));
  }

  nextDouble(): number {
    return (this.next(26) * 0x8000000 + this.next(27)) / 0x20000000000000;
  }

  /** Advance the state as if next() had been called n times. */
  skip(n: number): void {
    let m = 1n;
    let a = 0n;
    let im = MULT;
    let ia = ADD;
    for (let k = BigInt(n); k; k >>= 1n) {
      if (k & 1n) {
        m = (m * im) & MASK;
        a = (im * a + ia) & MASK;
      }
      ia = ((im + 1n) * ia) & MASK;
      im = (im * im) & MASK;
    }
    this.seed = (this.seed * m + a) & MASK;
  }
}
