// The polyfill first, exactly as pixi-renderer.ts loads it, so the upload passes are the CSP-safe ones.
import 'pixi.js/unsafe-eval';
import { Particle, ParticleBuffer, ParticleContainer, Texture } from 'pixi.js';
import { PARTICLE_DYNAMIC_PROPERTIES, StaticUploadMark } from './particle-upload';

/**
 * Lean particle upload (yoshi-end-review-cpu-cost.md Q2 option A; Skyler 2026-11-17): `uvs` and
 * `rotation` are static, and the static buffer is re-uploaded only when the particle count passes
 * its previous high. Checked against the pinned Pixi 8.23.0 `ParticleBuffer` itself: a mirror of
 * what each `setDataWithSize` handed the GPU must equal a full static upload for every slot drawn,
 * over counts that grow, shrink, regrow and outgrow the buffer. Negative controls (no high-water
 * update, or no static upload at all) are recorded in `luigi-end-review-cpu-fixes.md`.
 */
interface BufferInternals {
  /** `size` is in elements (Pixi Buffer: `_updateSize = size * BYTES_PER_ELEMENT`). */
  _staticBuffer: { setDataWithSize(data: Float32Array, size: number, sync: boolean): void };
  _staticStride: number;
}

function properties() {
  const pc = new ParticleContainer({
    texture: Texture.WHITE,
    dynamicProperties: { ...PARTICLE_DYNAMIC_PROPERTIES },
  });
  return pc._properties;
}

function particles(n: number): Particle[] {
  return Array.from(
    { length: n },
    (_, i) => new Particle({ texture: Texture.WHITE, anchorX: 0.5, anchorY: 0.5, x: i, y: i }),
  );
}

/** A ParticleBuffer plus a mirror of the floats its static GPU buffer holds. */
function trackedBuffer(size: number) {
  const buffer = new ParticleBuffer({ size, properties: properties() });
  const internals = buffer as unknown as BufferInternals;
  let gpu = new Float32Array(0);
  const original = internals._staticBuffer.setDataWithSize.bind(internals._staticBuffer);
  internals._staticBuffer.setDataWithSize = (data, floats, sync) => {
    if (gpu.length < floats) {
      const grown = new Float32Array(floats);
      grown.set(gpu);
      gpu = grown;
    }
    gpu.set(data.subarray(0, floats));
    original(data, floats, sync);
  };
  // Floats per particle in the static buffer (4 vertices a quad).
  const perParticle = internals._staticStride * 4;
  return { buffer, gpu: () => gpu, perParticle };
}

/** The static floats a full upload writes for `n` particles. */
function fullStatic(n: number, pool: Particle[]): Float32Array {
  const { buffer, perParticle } = trackedBuffer(n);
  buffer.update(pool.slice(0, n), true);
  return buffer.staticAttributeBuffer.float32View.slice(0, n * perParticle);
}

describe('lean particle upload (static uvs and rotation, high-water static upload)', () => {
  it('only position, vertex and color are dynamic', () => {
    expect(PARTICLE_DYNAMIC_PROPERTIES).toEqual({
      position: true,
      vertex: true,
      color: true,
      rotation: false,
      uvs: false,
    });
    const props = properties();
    expect(
      Object.entries(props)
        .filter(([, p]) => p.dynamic)
        .map(([k]) => k)
        .sort(),
    ).toEqual(['color', 'position', 'vertex']);
    expect(props['uvs'].dynamic).toBe(false);
    expect(props['rotation'].dynamic).toBe(false);
  });

  it('StaticUploadMark is true only above every count before it', () => {
    const mark = new StaticUploadMark();
    expect([0, 3, 3, 2, 5, 4, 5, 6, 0, 6].map((n) => mark.grows(n))).toEqual([
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  it('what the GPU holds equals a full static upload for every drawn slot, as the count moves', () => {
    const pool = particles(64);
    // Starts at 8 slots: 20 and 64 outgrow it (Pixi forces those); 6 -> 10 grows inside it.
    const { buffer, gpu, perParticle } = trackedBuffer(8);
    const mark = new StaticUploadMark();
    let staticUploads = 0;
    for (const n of [3, 6, 2, 6, 10, 4, 10, 20, 1, 15, 20, 64, 30, 64, 7]) {
      // ParticleContainerPipe.execute: buffer.update(children, container._childrenDirty), where the
      // renderer sets the dirty flag (pc.update()) only when the mark grows.
      const upload = mark.grows(n);
      if (upload) staticUploads++;
      buffer.update(pool.slice(0, n), upload);
      expect(Array.from(gpu().subarray(0, n * perParticle)), `n=${n}`).toEqual(
        Array.from(fullStatic(n, pool)),
      );
    }
    // Five highs (3, 6, 10, 20, 64) out of fifteen frames.
    expect(staticUploads).toBe(5);
  });

  it('the static slots hold the same floats for every particle (why any particle may reuse one)', () => {
    const pool = particles(5);
    pool[3].x = 999;
    pool[3].scaleX = 7;
    pool[3].tint = 0x123456;
    const all = fullStatic(5, pool);
    const per = all.length / 5;
    for (let i = 1; i < 5; i++) {
      expect(Array.from(all.subarray(i * per, (i + 1) * per))).toEqual(
        Array.from(all.subarray(0, per)),
      );
    }
  });
});
