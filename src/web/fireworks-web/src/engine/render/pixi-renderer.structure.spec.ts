import 'pixi.js/unsafe-eval';
import { TickerPlugin } from 'pixi.js';

/**
 * The renderer wiring for render-on-change and the lean upload (yoshi-end-review-cpu-cost.md Q1,
 * Q2), which jsdom can't run (no WebGL). Read as text from pixi-renderer.ts, each rule with a
 * negative control on a mutated copy, plus one check against Pixi's own TickerPlugin: the removal
 * call matches how Pixi registers its per-tick present, so the stage never presents twice a frame
 * or on a frame the host skipped.
 */
interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}
declare const process: { cwd(): string; getBuiltinModule(id: 'node:fs'): NodeFs };
const SOURCE = process
  .getBuiltinModule('node:fs')
  .readFileSync(`${process.cwd()}/src/engine/render/pixi-renderer.ts`, 'utf8');

const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The rule violations in a renderer source, empty when it is wired as required. */
function violations(src: string): string[] {
  const c = code(src);
  const out: string[] = [];
  if (
    !/new ParticleContainer\(\{[^}]*dynamicProperties: \{ \.\.\.PARTICLE_DYNAMIC_PROPERTIES \}/.test(
      c,
    )
  )
    out.push('ParticleContainer is not built from PARTICLE_DYNAMIC_PROPERTIES');
  const updates = c.match(/[^\n]*\.pc\.update\(\)[^\n]*/g) ?? [];
  if (
    updates.length !== 1 ||
    !/if \(this\.staticUpload\.grows\(P\.n\)\) this\.pc\.update\(\);/.test(updates[0])
  )
    out.push('pc.update() is not called exactly once, under the static-upload mark');
  if (!/app\.ticker\.remove\(app\.render, app\);/.test(c))
    out.push("Pixi's per-tick present is not removed");
  const render = /\n {2}render\([^)]*\): void \{([\s\S]*?)\n {2}\}/.exec(c)?.[1] ?? '';
  if (!/this\.trail\.draw\([^)]*\);\s*this\.app\.render\(\);/.test(render))
    out.push('render() does not present after drawing the trail');
  if ((c.match(/\.render\(\)/g) ?? []).length !== 1)
    out.push('the stage is presented somewhere other than render()');
  return out;
}

describe('pixi-renderer wiring (render on change, lean upload)', () => {
  it('the shipped renderer follows every rule', () => {
    expect(violations(SOURCE)).toEqual([]);
  });

  it('negative controls: each rule sees its mutation in the real text', () => {
    const swap = (from: string, to: string) => {
      expect(SOURCE.split(from), from).toHaveLength(2);
      return SOURCE.replace(from, to);
    };
    expect(
      violations(
        swap(
          'dynamicProperties: { ...PARTICLE_DYNAMIC_PROPERTIES }',
          'dynamicProperties: { position: true }',
        ),
      ),
    ).toEqual(['ParticleContainer is not built from PARTICLE_DYNAMIC_PROPERTIES']);
    expect(
      violations(swap('if (this.staticUpload.grows(P.n)) this.pc.update();', 'this.pc.update();')),
    ).toEqual(['pc.update() is not called exactly once, under the static-upload mark']);
    expect(violations(swap('app.ticker.remove(app.render, app);', ''))).toEqual([
      "Pixi's per-tick present is not removed",
    ]);
    expect(
      violations(
        swap(
          '    this.trail.draw(this.worldRoot, persistence);\n    this.app.render();',
          '    this.trail.draw(this.worldRoot, persistence);',
        ),
      ),
    ).toEqual([
      'render() does not present after drawing the trail',
      'the stage is presented somewhere other than render()',
    ]);
    expect(
      violations(
        swap(
          '      const resized = this.handleResize();',
          '      const resized = this.handleResize();\n      this.app.render();',
        ),
      ),
    ).toEqual(['the stage is presented somewhere other than render()']);
  });

  it("the removal matches Pixi 8.23's TickerPlugin registration (no per-tick present left)", () => {
    class App {
      render(): void {
        // stands in for Application.prototype.render
      }
    }
    const app = new App() as App & {
      ticker: { count: number; remove(fn: unknown, ctx: unknown): void; destroy(): void };
    };
    TickerPlugin.init.call(app as never, { autoStart: false });
    expect(app.ticker.count).toBe(1);
    app.ticker.remove(app.render, {}); // the wrong context leaves it (control)
    expect(app.ticker.count).toBe(1);
    app.ticker.remove(app.render, app);
    expect(app.ticker.count).toBe(0);
    app.ticker.destroy();
  });
});
