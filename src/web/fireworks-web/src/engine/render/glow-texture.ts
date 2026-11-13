import { Texture } from 'pixi.js';

/** Width of the glow texture in pixels; particle scale is `px / GLOW_TEXTURE_SIZE`. */
export const GLOW_TEXTURE_SIZE = 64;

/**
 * The soft radial dot every particle is drawn with (prototype `makeDotTexture`): a 64 px white
 * radial gradient that additive blending turns into a glow.
 */
export function createGlowTexture(): Texture {
  const s = GLOW_TEXTURE_SIZE;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  if (!g) {
    throw new Error('2D canvas is unavailable.');
  }
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.12, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.08)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  return Texture.from(c);
}
