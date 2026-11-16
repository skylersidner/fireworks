// @vitest-environment node
export {};

declare const process: {
  cwd(): string;
  getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, encoding: 'utf8'): string };
};
const css = process
  .getBuiltinModule('node:fs')
  .readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');
const btn = css.slice(css.indexOf('  .btn {'), css.indexOf('  .btn-primary {'));

/** `.btn` while a save is in flight: `aria-disabled`, not `disabled` (phase-5.md §2.2; Rosalina D3). */
describe('.btn and aria-disabled', () => {
  it('sees the .btn block', () => {
    expect(btn).toContain('@apply cursor-pointer');
  });

  it('hover skips disabled and aria-disabled buttons', () => {
    expect(btn).toMatch(/&:hover:not\(:disabled\):not\(\[aria-disabled=['"]true['"]\]\) \{/);
    expect(btn).not.toMatch(/&:hover:not\(:disabled\) \{/);
  });

  // phase-7.md §3.4 (R4, D5): two looks. Unavailable is the default and matches :disabled; busy
  // (.btn-busy, in flight) keeps the full look with the progress cursor.
  it('aria-disabled looks unavailable by default (not-allowed, 45%), like :disabled', () => {
    const rule = btn.match(/\n    &\[aria-disabled=['"]true['"]\] \{([^}]*)\}/);
    expect(rule?.[1].trim()).toBe('@apply cursor-not-allowed opacity-45;');
    const disabled = btn.match(/&:disabled \{([^}]*)\}/);
    expect(disabled?.[1].trim()).toBe(rule?.[1].trim());
  });

  it('.btn-busy keeps the full look with the progress cursor', () => {
    const rule = btn.match(/&\.btn-busy\[aria-disabled=['"]true['"]\] \{([^}]*)\}/);
    expect(rule?.[1].trim()).toBe('@apply cursor-progress opacity-100;');
  });

  // Negative control: the Phase 5 rule (progress only) would fail the unavailable check.
  it('the old progress-only rule fails the unavailable check', () => {
    const unavailable = "&[aria-disabled='true'] {\n      @apply cursor-not-allowed opacity-45;";
    expect(btn).toContain(unavailable);
    const old = btn.replace(
      unavailable,
      "&[aria-disabled='true'] {\n      @apply cursor-progress;",
    );
    expect(old).not.toBe(btn);
    const rule = old.match(/\n    &\[aria-disabled=['"]true['"]\] \{([^}]*)\}/);
    expect(rule?.[1].trim()).not.toBe('@apply cursor-not-allowed opacity-45;');
  });
});

describe('reduced motion and touch (phase-7.md §4, §5.2)', () => {
  it('the switch knob has no transition under prefers-reduced-motion (R6)', () => {
    const knob = css.slice(css.indexOf('  .switch {'));
    expect(knob).toMatch(/&::after \{[^}]*transition-transform motion-reduce:transition-none;/);
  });

  it('no keyframes, animate- utilities or smooth scrolling anywhere in styles.css (7h.5)', () => {
    expect(css).not.toMatch(/@keyframes|animate-|scroll-behavior:\s*smooth/);
  });

  // Toad, Phase 7 C3: 7h.5 says anywhere in src, not only styles.css. A template class
  // (`animate-pulse`), a component style or a `behavior: 'smooth'` scroll call would animate too.
  it('no keyframes, animate- utilities or smooth scrolling in any source file (7h.5)', () => {
    const fs = process.getBuiltinModule('node:fs') as unknown as {
      readdirSync(
        p: string,
        o: { withFileTypes: true },
      ): { name: string; isDirectory(): boolean }[];
      readFileSync(p: string, e: 'utf8'): string;
    };
    const files: { path: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|html|css|scss)$/.test(e.name) && !e.name.endsWith('.spec.ts'))
          files.push({ path: p, text: fs.readFileSync(p, 'utf8') });
      }
    };
    walk(`${process.cwd()}/src`);
    const BANNED = /@keyframes|\banimate-|scroll-behavior:\s*smooth|behavior:\s*['"]smooth['"]/;
    const hits = (list: typeof files) => list.filter((f) => BANNED.test(f.text)).map((f) => f.path);
    expect(files.some((f) => f.path.endsWith('/timeline/timeline.ts'))).toBe(true);
    expect(hits(files)).toEqual([]);
    // Negative control: one of each spelling is caught.
    expect(
      hits([
        { path: 'a.html', text: '<span class="animate-pulse"></span>' },
        { path: 'b.ts', text: "el.scrollIntoView({ behavior: 'smooth' });" },
        { path: 'c.scss', text: '@keyframes spin { to { rotate: 1turn; } }' },
      ]),
    ).toEqual(['a.html', 'b.ts', 'c.scss']);
  });

  const coarse = css.slice(css.indexOf('@media (pointer: coarse)'));
  it('under a coarse pointer, buttons are 44x44 with manipulation, fields 44px tall at 16px', () => {
    expect(css).toContain('@media (pointer: coarse)');
    const block = (sel: string) =>
      coarse.match(new RegExp(`\\n\\s*${sel} \\{([^}]*)\\}`))?.[1] ?? '';
    expect(block('\\.btn')).toMatch(
      /min-height: 44px;\s*min-width: 44px;\s*touch-action: manipulation;/,
    );
    expect(coarse).toMatch(
      /\.field,\s*select,\s*input\[type='number'\] \{\s*min-height: 44px;\s*font-size: 16px;/,
    );
    expect(block('\\.touch-row')).toContain('min-height: 44px;');
    expect(block('\\.touch-link')).toContain('min-height: 44px;');
    expect(block('\\.touch-gap')).toContain('gap: 8px;');
    expect(coarse).toMatch(/::-webkit-slider-thumb \{[^}]*width: 24px;\s*height: 24px;/);
  });
});

describe('the coarse block is unlayered (beats utilities like min-w-0 and text-caption)', () => {
  const depthAt = (text: string, at: number) =>
    [...text.slice(0, at)].reduce((d, c) => d + (c === '{' ? 1 : c === '}' ? -1 : 0), 0);
  it('sits at brace depth 0, outside every @layer', () => {
    expect(depthAt(css, css.indexOf('@media (pointer: coarse)'))).toBe(0);
  });
  it('negative control: inside @layer components it would be at depth 1', () => {
    const layered = css.replace(
      '@media (pointer: coarse)',
      '@layer components { @media (pointer: coarse)',
    );
    expect(depthAt(layered, layered.indexOf('@media (pointer: coarse)'))).toBe(1);
  });
});

/**
 * C2-1 (Rosalina, phase-7.md §15): inside the coarse block the generic `input[type='range']::…`
 * rules (0,1,2) beat a bare `.scrub-range::…` (0,1,1), so the scrub got a round 24px thumb on an
 * opaque 4px track over the overview. Each scrub rule must out-rank its generic twin. jsdom can't
 * compute pseudo-element styles; the Chromium touch check is the runtime evidence.
 */
describe('the coarse scrub rules out-rank the generic range rules (C2-1)', () => {
  const coarse = css.slice(css.indexOf('@media (pointer: coarse)'));
  /** [ids, classes + attributes + pseudo-classes, types + pseudo-elements] for these simple selectors. */
  const specificity = (sel: string): [number, number, number] => {
    const ids = (sel.match(/#[\w-]+/g) ?? []).length;
    const classes = (sel.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+/g) ?? []).length;
    const types =
      (sel.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) ?? []).length +
      (sel.match(/::[\w-]+/g) ?? []).length;
    return [ids, classes, types];
  };
  const beats = (a: [number, number, number], b: [number, number, number]) =>
    a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
  const pseudos = [
    '::-webkit-slider-runnable-track',
    '::-webkit-slider-thumb',
    '::-moz-range-track',
    '::-moz-range-thumb',
  ];
  const selectorFor = (text: string, pseudo: string, marker: string) =>
    [...text.matchAll(/\n\s*([^{}\n]+?) \{/g)]
      .map((m) => m[1].trim())
      .find((sel) => sel.endsWith(pseudo) && sel.includes(marker));

  it('every scrub pseudo-element rule beats the generic one, and keeps the 24x32 clear-track values', () => {
    for (const pseudo of pseudos) {
      const generic = selectorFor(coarse, pseudo, "input[type='range']");
      const scrub = selectorFor(coarse, pseudo, 'scrub-range');
      expect([pseudo, generic, scrub].every(Boolean)).toBe(true);
      expect([pseudo, beats(specificity(scrub!), specificity(generic!))]).toEqual([pseudo, true]);
    }
    expect(coarse).toMatch(
      /scrub-range[^{]*::-webkit-slider-thumb \{\s*width: 24px;\s*height: 32px;/,
    );
    expect(coarse).toMatch(
      /scrub-range[^{]*::-webkit-slider-runnable-track \{\s*height: 32px;\s*background: transparent;/,
    );
  });

  it('negative control: the old bare `.scrub-range::…` selectors lose', () => {
    expect(
      beats(
        specificity('.scrub-range::-webkit-slider-thumb'),
        specificity("input[type='range']::-webkit-slider-thumb"),
      ),
    ).toBe(false);
    expect(specificity("input[type='range']::-webkit-slider-thumb")).toEqual([0, 1, 2]);
    expect(specificity("input.scrub-range[type='range']::-webkit-slider-thumb")).toEqual([0, 2, 2]);
  });
});
