// Seeded PRNG, tileable value noise, and gradient noise for procedural generation.
const NoiseGen = (() => {
  function mulberry32(seed) {
    return function next() {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function seedFrom(id) {
    const s = String(id);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h || 1;
  }

  function makeValueNoise(seed) {
    const SIZE = 256;
    const rng = mulberry32(seed);
    const table = new Float32Array(SIZE * SIZE);
    for (let i = 0; i < table.length; i++) table[i] = rng();

    function smoothstep(t) { return t * t * (3 - 2 * t); }

    function sample(nx, ny) {
      const ix  = Math.floor(nx) & (SIZE - 1);
      const iy  = Math.floor(ny) & (SIZE - 1);
      const fx  = smoothstep(nx - Math.floor(nx));
      const fy  = smoothstep(ny - Math.floor(ny));
      const ix1 = (ix + 1) & (SIZE - 1);
      const iy1 = (iy + 1) & (SIZE - 1);
      const v00 = table[iy  * SIZE + ix ];
      const v10 = table[iy  * SIZE + ix1];
      const v01 = table[iy1 * SIZE + ix ];
      const v11 = table[iy1 * SIZE + ix1];
      return v00 + fx * (v10 - v00) + fy * (v01 - v00 + fx * (v11 - v10 - v01 + v00));
    }

    return { sample };
  }

  function makeTileableValueNoise(seed, W, H) {
    const rng = mulberry32(seed);
    const table = new Float32Array(W * H);
    for (let i = 0; i < table.length; i++) table[i] = rng();

    function smoothstep(t) { return t * t * (3 - 2 * t); }

    function sample(nx, ny) {
      const ix  = Math.floor(nx) % W;
      const iy  = Math.floor(ny) % H;
      const fx  = smoothstep(nx - Math.floor(nx));
      const fy  = smoothstep(ny - Math.floor(ny));
      const ix1 = (ix + 1) % W;
      const iy1 = (iy + 1) % H;
      const v00 = table[iy  * W + ix ];
      const v10 = table[iy  * W + ix1];
      const v01 = table[iy1 * W + ix ];
      const v11 = table[iy1 * W + ix1];
      return v00 + fx * (v10 - v00) + fy * (v01 - v00 + fx * (v11 - v10 - v01 + v00));
    }

    return { sample };
  }

  // 2D Perlin gradient noise. Output is normalised to approximately [0, 1].
  // Contours are isotropic (no axis-aligned bias), making it better for
  // organic terrain shapes than value noise.
  function makeGradientNoise(seed) {
    const SIZE = 256;
    const rng  = mulberry32(seed);

    // Permutation table, Fisher-Yates shuffled, doubled to avoid index wrapping.
    const perm = new Uint8Array(SIZE * 2);
    for (let i = 0; i < SIZE; i++) perm[i] = i;
    for (let i = SIZE - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
    }
    for (let i = 0; i < SIZE; i++) perm[SIZE + i] = perm[i];

    // 8 gradient directions (4 axis + 4 diagonal).
    const GX = new Float32Array([ 1, -1,  1, -1,  1, -1,  0,  0]);
    const GY = new Float32Array([ 1,  1, -1, -1,  0,  0,  1, -1]);

    // Quintic fade — smoother than smoothstep, eliminates second-derivative
    // discontinuities that cause banding at grid boundaries.
    function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

    function dot(gi, dx, dy) {
      const idx = gi & 7;
      return GX[idx] * dx + GY[idx] * dy;
    }

    function sample(nx, ny) {
      const ix = Math.floor(nx) & (SIZE - 1);
      const iy = Math.floor(ny) & (SIZE - 1);
      const fx = nx - Math.floor(nx);
      const fy = ny - Math.floor(ny);
      const u  = fade(fx);
      const v  = fade(fy);

      const n00 = dot(perm[perm[ix    ] + iy    ], fx,     fy    );
      const n10 = dot(perm[perm[ix + 1] + iy    ], fx - 1, fy    );
      const n01 = dot(perm[perm[ix    ] + iy + 1], fx,     fy - 1);
      const n11 = dot(perm[perm[ix + 1] + iy + 1], fx - 1, fy - 1);

      const lerp = n00 + u * (n10 - n00) + v * ((n01 + u * (n11 - n01)) - (n00 + u * (n10 - n00)));
      // Raw output is roughly [-0.707, 0.707]; normalise to [0, 1].
      return lerp * 0.7071 + 0.5;
    }

    return { sample };
  }

  return { seedFrom, makeValueNoise, makeTileableValueNoise, makeGradientNoise, mulberry32 };
})();
