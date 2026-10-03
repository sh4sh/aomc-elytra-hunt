import { describe, expect, it } from 'vitest';
import { JavaRandom } from '../src/generation/java-random';

describe('JavaRandom', () => {
  // Expected values from a real JVM: new Random(856461443495910397L)
  it('matches java.util.Random', () => {
    const r = new JavaRandom(856461443495910397n);
    expect(r.nextInt(100)).toBe(32);
    expect(r.nextInt(16)).toBe(14);
    expect(r.nextLong()).toBe(-4553092227910252303n);
    expect(r.nextDouble()).toBe(0.7810473135842467);
  });

  it('skip(n) equals n calls to next()', () => {
    const a = new JavaRandom(42n);
    const b = new JavaRandom(42n);
    for (let i = 0; i < 17292; i++) a.next(32);
    b.skip(17292);
    expect(b.nextLong()).toBe(a.nextLong());
  });
});
