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

  it('aria-disabled shows the progress cursor and keeps its look (no opacity)', () => {
    const rule = btn.match(/&\[aria-disabled=['"]true['"]\] \{([^}]*)\}/);
    expect(rule?.[1].trim()).toBe('@apply cursor-progress;');
  });
});
