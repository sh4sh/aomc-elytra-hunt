// Minecraft's improved Perlin noise and 2D simplex noise.
// Ported from cubiomes (noise.c, MIT licence) so results match the game bit for bit.

import { JavaRandom } from './java-random';

export const lerp = (t: number, a: number, b: number): number => a + t * (b - a);

const fade = (d: number): number => d * d * d * (d * (d * 6.0 - 15.0) + 10.0);

function grad(idx: number, a: number, b: number, c: number): number {
  switch (idx & 0xf) {
    case 0: return a + b;
    case 1: return -a + b;
    case 2: return a - b;
    case 3: return -a - b;
    case 4: return a + c;
    case 5: return -a + c;
    case 6: return a - c;
    case 7: return -a - c;
    case 8: return b + c;
    case 9: return -b + c;
    case 10: return b - c;
    case 11: return -b - c;
    case 12: return a + b;
    case 13: return -b + c;
    case 14: return -a + b;
    default: return -b - c;
  }
}

const SKEW = 0.5 * (Math.sqrt(3) - 1.0);
const UNSKEW = (3.0 - Math.sqrt(3)) / 6.0;

function simplexGrad(idx: number, x: number, y: number, d: number): number {
  let con = d - x * x - y * y;
  if (con < 0) return 0;
  con *= con;
  return con * con * grad(idx, x, y, 0);
}

export class PerlinNoise {
  private readonly a: number;
  private readonly b: number;
  private readonly c: number;
  private readonly d = new Uint8Array(257);
  private readonly h2: number;
  private readonly d2: number;
  private readonly t2: number;

  constructor(rng: JavaRandom) {
    this.a = rng.nextDouble() * 256.0;
    this.b = rng.nextDouble() * 256.0;
    this.c = rng.nextDouble() * 256.0;
    const d = this.d;
    for (let i = 0; i < 256; i++) d[i] = i;
    for (let i = 0; i < 256; i++) {
      const j = rng.nextInt(256 - i) + i;
      const n = d[i];
      d[i] = d[j];
      d[j] = n;
    }
    d[256] = d[0];
    const i2 = Math.floor(this.b);
    this.d2 = this.b - i2;
    this.h2 = i2 & 255;
    this.t2 = fade(this.d2);
  }

  sample(d1: number, d2: number, d3: number, yamp: number, ymin: number): number {
    let h2: number, t2: number;
    if (d2 === 0.0) {
      d2 = this.d2;
      h2 = this.h2;
      t2 = this.t2;
    } else {
      d2 += this.b;
      const i2 = Math.floor(d2);
      d2 -= i2;
      h2 = i2 & 255;
      t2 = fade(d2);
    }

    d1 += this.a;
    d3 += this.c;
    const i1 = Math.floor(d1);
    const i3 = Math.floor(d3);
    d1 -= i1;
    d3 -= i3;
    const h1 = i1 & 255;
    const h3 = i3 & 255;
    const t1 = fade(d1);
    const t3 = fade(d3);

    if (yamp) {
      const yclamp = ymin < d2 ? ymin : d2;
      d2 -= Math.floor(yclamp / yamp) * yamp;
    }

    const idx = this.d;
    const a1 = (idx[h1] + h2) & 255;
    const b1 = (idx[h1 + 1] + h2) & 255;
    const a2 = (idx[a1] + h3) & 255;
    const a3 = (idx[a1 + 1] + h3) & 255;
    const b2 = (idx[b1] + h3) & 255;
    const b3 = (idx[b1 + 1] + h3) & 255;

    let l1 = grad(idx[a2], d1, d2, d3);
    const l2 = grad(idx[b2], d1 - 1, d2, d3);
    let l3 = grad(idx[a3], d1, d2 - 1, d3);
    const l4 = grad(idx[b3], d1 - 1, d2 - 1, d3);
    let l5 = grad(idx[a2 + 1], d1, d2, d3 - 1);
    const l6 = grad(idx[b2 + 1], d1 - 1, d2, d3 - 1);
    let l7 = grad(idx[a3 + 1], d1, d2 - 1, d3 - 1);
    const l8 = grad(idx[b3 + 1], d1 - 1, d2 - 1, d3 - 1);

    l1 = lerp(t1, l1, l2);
    l3 = lerp(t1, l3, l4);
    l5 = lerp(t1, l5, l6);
    l7 = lerp(t1, l7, l8);

    l1 = lerp(t2, l1, l3);
    l5 = lerp(t2, l5, l7);

    return lerp(t3, l1, l5);
  }

  simplex2D(x: number, y: number): number {
    const hf = (x + y) * SKEW;
    const hx = Math.floor(x + hf);
    const hz = Math.floor(y + hf);
    const mhxz = (hx + hz) * UNSKEW;
    const x0 = x - (hx - mhxz);
    const y0 = y - (hz - mhxz);
    const offx = x0 > y0 ? 1 : 0;
    const offz = 1 - offx;
    const x1 = x0 - offx + UNSKEW;
    const y1 = y0 - offz + UNSKEW;
    const x2 = x0 - 1.0 + 2.0 * UNSKEW;
    const y2 = y0 - 1.0 + 2.0 * UNSKEW;
    const d = this.d;
    const gi0 = d[0xff & (d[0xff & hz] + hx)];
    const gi1 = d[0xff & (d[0xff & (hz + offz)] + hx + offx)];
    const gi2 = d[0xff & (d[0xff & (hz + 1)] + hx + 1)];
    let t = 0;
    t += simplexGrad(gi0 % 12, x0, y0, 0.5);
    t += simplexGrad(gi1 % 12, x1, y1, 0.5);
    t += simplexGrad(gi2 % 12, x2, y2, 0.5);
    return 70.0 * t;
  }
}
