// @vitest-environment node
/**
 * Touch sizes in px, not rem (phase-7.md §5.2; Toad C4). The root font is 13px (`styles.css`
 * `html, body { font: 13px/1.4 }`), so every rem-based Tailwind spacing utility is 0.8125× its
 * nominal px: `gap-2` is 6.5px and `size-11` / `min-h-11` are 35.75px. A coarse-pointer rule that
 * promises 44px targets or 8px gaps must use raw px (`min-h-[44px]`, `gap-[8px]`) or a px class
 * from `styles.css` (`.btn`, `.touch-row`, `.touch-link`, `.touch-gap`). Computed sizes in a real
 * browser are checked by the touch gate script; this guard stops the rem spelling coming back.
 */
interface Dirent {
  name: string;
  isDirectory(): boolean;
}
interface NodeFs {
  readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  readFileSync(path: string, encoding: 'utf8'): string;
}
declare const process: { cwd(): string; getBuiltinModule(id: 'node:fs'): NodeFs };
const fs = process.getBuiltinModule('node:fs');
const SRC = `${process.cwd()}/src`;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|html)$/.test(e.name) && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

const files = walk(`${SRC}/app`).map((p) => ({
  path: p.slice(SRC.length + 1),
  text: fs.readFileSync(p, 'utf8'),
}));

/** A rem-based size or gap utility behind the coarse-pointer variant, e.g. `pointer-coarse:gap-2`. */
export const COARSE_REM =
  /pointer-coarse:(?:gap(?:-[xy])?|size|min-[hw]|h|w)-(?:\d+(?:\.\d+)?|px)(?![\w.[-])/g;

/** The 44px target spelled as rem anywhere (`size-11` is 35.75px here), coarse or not. */
export const REM_44 = /(?<![\w-])(?:size|min-[hw]|h|w)-11(?![\w.[-])/g;

/** A rem-based gap utility at any pointer, e.g. `gap-2` (6.5px here). */
const REM_GAP = /(?<![\w:-])gap(?:-[xy])?-(?:\d+(?:\.\d+)?|px)(?![\w.[-])/;

function hits(re: RegExp, text: string): string[] {
  return [...text.matchAll(re)].map((m) => m[0]);
}

describe('touch targets and gaps use px under the 13px root (phase-7.md §5.2)', () => {
  it('sees the template sources', () => {
    expect(files.some((f) => f.path.endsWith('app.html'))).toBe(true);
    expect(files.filter((f) => f.text.includes('pointer-coarse:')).length).toBeGreaterThan(5);
  });

  it('no rem-based size or gap utility behind pointer-coarse:', () => {
    const found = files.flatMap((f) => hits(COARSE_REM, f.text).map((h) => `${f.path}: ${h}`));
    expect(found).toEqual([]);
  });

  it('no 44px target spelled as a rem -11 utility', () => {
    const found = files.flatMap((f) => hits(REM_44, f.text).map((h) => `${f.path}: ${h}`));
    expect(found).toEqual([]);
  });

  it('the toast dismiss button is 44px with touch-action: manipulation under coarse pointers', () => {
    const app = files.find((f) => f.path === 'app/app.html')!.text;
    const dismiss = [...app.matchAll(/<button[^>]*data-testid="toast-dismiss"[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(dismiss).toHaveLength(2);
    for (const b of dismiss) {
      expect(b).toContain('pointer-coarse:size-[44px]');
      expect(b).toContain('pointer-coarse:touch-manipulation');
    }
  });

  // The message page's action row holds 44px buttons side by side (phase 8 fix round): its gap is
  // the 8px touch gap at every pointer, so it is raw px (`gap-2` would be 6.5px). The coarse-only
  // patterns above don't see an unconditional gap, so this pins the row itself.
  it('the message page action row gaps its buttons by 8px, not a rem gap', () => {
    const page = files.find((f) => f.path === 'app/shared/message-page/message-page.ts')!.text;
    const row = /<div class="([^"]*)"><ng-content \/><\/div>/.exec(page)?.[1] ?? '';
    expect(row.split(/\s+/)).toContain('gap-[8px]');
    expect(row).not.toMatch(REM_GAP);
    expect('mt-4 flex flex-wrap gap-2').toMatch(REM_GAP); // negative control: the pre-fix spelling
    expect('mt-4 flex flex-wrap gap-[8px]').not.toMatch(REM_GAP);
  });

  // Negative control: the pre-fix spellings from Toad's C4 finding must trip both patterns, and the
  // px spellings must not.
  it('the pre-fix rem spellings trip the guard; the px spellings do not', () => {
    const before =
      'gap-2 pointer-coarse:min-h-11 | pointer-coarse:gap-2 | pointer-coarse:size-11 | pointer-coarse:gap-x-1.5 | flex size-11 -translate-x-1/2';
    expect(hits(COARSE_REM, before)).toEqual([
      'pointer-coarse:min-h-11',
      'pointer-coarse:gap-2',
      'pointer-coarse:size-11',
      'pointer-coarse:gap-x-1.5',
    ]);
    expect(hits(REM_44, before)).toEqual(['min-h-11', 'size-11', 'size-11']);
    const after =
      'pointer-coarse:min-h-[44px] pointer-coarse:gap-[8px] pointer-coarse:size-[44px] size-[44px] touch-gap';
    expect(hits(COARSE_REM, after)).toEqual([]);
    expect(hits(REM_44, after)).toEqual([]);
  });
});
