import { deepFreeze } from './freeze';
import { newShell, type ShellDocument } from './shell';

/**
 * The ten prototype presets (prototypes/fireworks-prototype.html, `PRESETS`), value for value.
 * Frozen deeply so a caller that forgets to clone cannot edit a preset in place. Order matters to
 * the random auto-show, which picks `PRESETS[(r() * PRESETS.length) | 0]`.
 */
export const PRESETS: readonly ShellDocument[] = deepFreeze([
  newShell('Peony', { breaks: [{ color1: 'red', color2: 'gold', changeAt: 0.65 }] }),
  newShell('Chrysanthemum', {
    breaks: [
      {
        color1: 'silver',
        color2: 'blue',
        changeAt: 0.7,
        trail: 'tail',
        stars: 140,
        speed: 230,
        burn: 1.8,
      },
    ],
  }),
  newShell('Willow', {
    burstHeight: 0.72,
    breaks: [
      { color1: 'gold', trail: 'glitter', stars: 110, speed: 210, burn: 3.6, drag: 1.5, size: 0.8 },
    ],
  }),
  newShell('Palm', {
    burstHeight: 0.6,
    breaks: [
      {
        pattern: 'palm',
        color1: 'gold',
        trail: 'tail',
        stars: 9,
        speed: 270,
        burn: 2.2,
        drag: 0.8,
        size: 1.8,
      },
    ],
  }),
  newShell('Ring', {
    breaks: [{ pattern: 'ring', color1: 'cyan', stars: 70, speed: 230, burn: 1.4 }],
  }),
  newShell('Crossette', {
    breaks: [
      {
        color1: 'green',
        trail: 'tail',
        stars: 28,
        speed: 210,
        burn: 1.0,
        drag: 1.0,
        effect: 'crossette',
        size: 1.2,
      },
    ],
  }),
  newShell('Crackling Heart', {
    breaks: [
      {
        pattern: 'heart',
        color1: 'pink',
        stars: 90,
        speed: 200,
        burn: 1.5,
        drag: 1.0,
        effect: 'crackle',
      },
    ],
  }),
  newShell('Strobe', {
    breaks: [
      {
        color1: 'white',
        stars: 150,
        speed: 220,
        burn: 2.4,
        drag: 1.2,
        effect: 'strobe',
        size: 0.8,
      },
    ],
  }),
  newShell('Rainbow', {
    breaks: [{ color1: 'rainbow', stars: 160, speed: 240, burn: 1.7, trail: 'tail' }],
  }),
  newShell('Triple Break', {
    burstHeight: 0.55,
    breaks: [
      { color1: 'blue', stars: 80, speed: 170, burn: 1.2 },
      { pattern: 'ring', color1: 'gold', stars: 60, speed: 210, burn: 1.3, delay: 0.7 },
      { color1: 'white', stars: 120, speed: 240, burn: 1.0, effect: 'crackle', delay: 0.8 },
    ],
  }),
]);
