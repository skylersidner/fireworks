/**
 * The particle upload policy (yoshi-end-review-cpu-cost.md Q2, option A; Skyler 2026-11-17).
 *
 * Pixi's `ParticleContainer` keeps two vertex buffers: dynamic properties are uploaded every
 * frame, static ones only when the container is marked dirty (`update()`). Under the CSP-safe
 * `pixi.js/unsafe-eval` polyfill each property is its own pass over every particle, so marking a
 * property dynamic that never changes costs a full pass per frame (about 11% of the main thread at
 * the 40k cap). Every stage particle shares one texture (the same `uvs`) and none is rotated, so
 * those two are static. Position, size (`vertex`) and tint/alpha (`color`) change every frame.
 *
 * Pixi-free so it is specced without a renderer; `pixi-renderer.ts` is the only user.
 */
export const PARTICLE_DYNAMIC_PROPERTIES = {
  position: true,
  vertex: true,
  color: true,
  rotation: false,
  uvs: false,
} as const;

/**
 * When the static buffer must be re-uploaded. Its contents per slot are identical for every
 * particle (same texture frame, rotation 0), so a slot written once stays right whichever Particle
 * later sits in it. Only a count above every count uploaded so far brings unwritten slots into the
 * draw. Pixi forces a static upload itself when the count outgrows its buffer, but slots between the
 * last upload and that buffer size need this explicit mark. A renderer rebuild (context restore)
 * makes a new container and a new mark.
 */
export class StaticUploadMark {
  private high = 0;

  /** True, and remembers `n`, when `n` exceeds the previous high: call `ParticleContainer.update()`. */
  grows(n: number): boolean {
    if (n <= this.high) return false;
    this.high = n;
    return true;
  }
}
